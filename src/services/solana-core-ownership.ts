import {
  deserializeAssetV1,
  mplCore,
  type AssetV1,
} from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { log } from "./logger.js";

const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const SOLANA_MULTIPLE_ACCOUNTS_LIMIT = 100;

function cleanEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function rpcHost(value: string): string {
  try {
    return new URL(value).host || "configured";
  } catch {
    return "configured";
  }
}

function rpcFailureCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/429|rate.?limit|max usage|quota/i.test(message)) return "rate_limited";
  if (/timed?\s*out|timeout|abort/i.test(message)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(message)) return "dns";
  if (/certificate|tls|ssl/i.test(message)) return "tls";
  if (/ECONNREFUSED|ECONNRESET|connect/i.test(message)) return "connect";
  return "rpc_error";
}

function ownershipRpcUrls(primaryRpcUrl: string, env: NodeJS.ProcessEnv): string[] {
  return [
    cleanEnv(env.RUBY_HIGH_SOLANA_OWNERSHIP_RPC_URL),
    primaryRpcUrl.trim(),
    DEFAULT_SOLANA_RPC_URL,
  ].filter((value, index, values) => !!value && values.indexOf(value) === index);
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchCoreAssetsFromRpc(rpcUrl: string, addresses: readonly string[]): Promise<Map<string, AssetV1>> {
  const umi = createUmi(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    getAccountsChunkSize: SOLANA_MULTIPLE_ACCOUNTS_LIMIT,
  }).use(mplCore());
  const byAddress = new Map<string, AssetV1>();
  for (const addressChunk of chunksOf(addresses, SOLANA_MULTIPLE_ACCOUNTS_LIMIT)) {
    const accounts = await umi.rpc.getAccounts(
      addressChunk.map((address) => publicKey(address)),
      { commitment: "confirmed" },
    );
    for (const account of accounts) {
      if (!account.exists) continue;
      try {
        const asset = deserializeAssetV1(account);
        byAddress.set(String(asset.publicKey), asset);
      } catch {
        // A stale address or a non-Core account must never fail the complete export.
      }
    }
  }
  return byAddress;
}

export async function fetchCurrentCoreAssets(
  rawAddresses: readonly string[],
  primaryRpcUrl: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, AssetV1>> {
  const addresses = rawAddresses
    .map((address) => address.trim())
    .filter((address, index, values) => {
      if (!address || values.indexOf(address) !== index) return false;
      try {
        publicKey(address);
        return true;
      } catch {
        return false;
      }
    });
  if (addresses.length === 0) return new Map();

  const candidates = ownershipRpcUrls(primaryRpcUrl, env);
  let lastCode = "rpc_error";
  for (let index = 0; index < candidates.length; index += 1) {
    const rpcUrl = candidates[index]!;
    try {
      const assets = await fetchCoreAssetsFromRpc(rpcUrl, addresses);
      if (index > 0) {
        log.event("nft.cosyworld-ownership-rpc-recovered", {
          assetKind: label,
          rpcHost: rpcHost(rpcUrl),
          addressCount: addresses.length,
          previousFailure: lastCode,
        });
      }
      return assets;
    } catch (err) {
      lastCode = rpcFailureCode(err);
      log.event("nft.cosyworld-ownership-rpc-failed", {
        assetKind: label,
        rpcHost: rpcHost(rpcUrl),
        addressCount: addresses.length,
        failureCode: lastCode,
        fallbackAvailable: index + 1 < candidates.length,
      });
    }
  }
  throw new Error(`${label} ownership RPC failed (${lastCode}).`);
}
