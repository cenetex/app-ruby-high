import { createHash } from "node:crypto";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet";
import { log } from "./logger.js";

const DEFAULT_ARWEAVE_GATEWAY = "https://arweave.net";
const DEFAULT_IRYS_GATEWAY = "https://gateway.irys.xyz";

export interface DurableNftMetadataInput {
  fallbackUri: string;
  metadata: Record<string, unknown> | null | undefined;
  assetKey: string;
  env?: NodeJS.ProcessEnv;
}

export interface NftMetadataUploadPayload {
  assetKey: string;
  fallbackUri: string;
  metadata: Record<string, unknown>;
  metadataJson: string;
  metadataHash: string;
}

export interface PublicNftMetadataStorageStatus {
  mode: "app-hosted" | "arweave" | "irys-solana" | string;
  durable: boolean;
  configured: boolean;
  gateway?: string;
  reason?: string;
}

let uploaderOverride: ((payload: NftMetadataUploadPayload) => Promise<string>) | null = null;
const uploadedMetadataUris = new Map<string, Promise<string>>();

export function setNftMetadataUploaderForTest(
  uploader: ((payload: NftMetadataUploadPayload) => Promise<string>) | null,
): () => void {
  const previous = uploaderOverride;
  uploaderOverride = uploader;
  uploadedMetadataUris.clear();
  return () => {
    if (uploaderOverride === uploader) uploaderOverride = previous;
    uploadedMetadataUris.clear();
  };
}

export function nftMetadataStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return supportedMetadataStorageMode(metadataStorageMode(env));
}

export function publicNftMetadataStorageStatus(env: NodeJS.ProcessEnv = process.env): PublicNftMetadataStorageStatus {
  const mode = metadataStorageMode(env);
  if (!mode) {
    return {
      mode: "app-hosted",
      durable: false,
      configured: true,
    };
  }
  if (!supportedMetadataStorageMode(mode)) {
    return {
      mode,
      durable: false,
      configured: false,
      reason: `Unsupported NFT metadata storage mode "${mode}".`,
    };
  }
  try {
    assertMetadataStorageConfigured(mode, env);
    return {
      mode,
      durable: true,
      configured: true,
      gateway: metadataGateway(env),
    };
  } catch (err) {
    return {
      mode,
      durable: true,
      configured: false,
      gateway: metadataGateway(env),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function durableNftMetadataUri(input: DurableNftMetadataInput): Promise<string> {
  const env = input.env ?? process.env;
  const fallbackUri = input.fallbackUri.trim();
  const mode = metadataStorageMode(env);
  if (!mode) return fallbackUri;
  if (!supportedMetadataStorageMode(mode)) {
    throw new Error(`Unsupported NFT metadata storage mode "${mode}". Use "arweave", "irys-solana", or unset RUBY_HIGH_NFT_METADATA_STORAGE.`);
  }
  if (!input.metadata) return fallbackUri;
  const assetKey = normalizeAssetKey(input.assetKey);
  const metadata = input.metadata;
  const metadataJson = stableJson(metadata);
  const metadataHash = createHash("sha256").update(metadataJson).digest("hex");
  const cacheKey = `${assetKey}:${metadataHash}`;
  let promise = uploadedMetadataUris.get(cacheKey);
  if (!promise) {
    promise = uploadDurableJson({
      assetKey,
      fallbackUri,
      metadata,
      metadataJson,
      metadataHash,
    }, env).catch((err) => {
      if (uploadedMetadataUris.get(cacheKey) === promise) uploadedMetadataUris.delete(cacheKey);
      throw err;
    });
    uploadedMetadataUris.set(cacheKey, promise);
  }
  return promise;
}

async function uploadDurableJson(payload: NftMetadataUploadPayload, env: NodeJS.ProcessEnv): Promise<string> {
  if (uploaderOverride) return uploaderOverride(payload);
  const mode = metadataStorageMode(env);
  if (mode === "irys-solana") return uploadIrysSolanaJson(payload, env);
  return uploadDirectArweaveJson(payload, env);
}

async function uploadDirectArweaveJson(payload: NftMetadataUploadPayload, env: NodeJS.ProcessEnv): Promise<string> {
  const arweave = arweaveClient(env);
  const jwk = arweaveJwk(env);
  const tx = await arweave.createTransaction({
    data: Buffer.from(payload.metadataJson, "utf8"),
  }, jwk);
  for (const tag of tagsForMetadata(payload)) tx.addTag(tag.name, tag.value);
  await arweave.transactions.sign(tx, jwk);
  const response = await arweave.transactions.post(tx);
  if (![200, 202].includes(response.status)) {
    throw new Error(`Arweave metadata upload failed with ${response.status} ${response.statusText || ""}`.trim());
  }
  const uri = `${metadataGateway(env)}/${tx.id}`;
  log.event("nft.metadata-uploaded", {
    provider: "arweave",
    assetKey: payload.assetKey,
    uri,
    metadataHash: payload.metadataHash,
  });
  return uri;
}

function metadataGateway(env: NodeJS.ProcessEnv): string {
  const fallback = metadataStorageMode(env) === "irys-solana" ? DEFAULT_IRYS_GATEWAY : DEFAULT_ARWEAVE_GATEWAY;
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_NFT_METADATA_GATEWAY) || fallback);
}

function metadataStorageMode(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_NFT_METADATA_STORAGE).toLowerCase();
}

function supportedMetadataStorageMode(mode: string): boolean {
  return mode === "arweave" || mode === "irys-solana";
}

function assertMetadataStorageConfigured(mode: string, env: NodeJS.ProcessEnv): void {
  if (mode === "arweave") {
    arweaveJwk(env);
    return;
  }
  if (mode === "irys-solana") {
    irysSolanaWallet(env);
    return;
  }
  throw new Error(`Unsupported NFT metadata storage mode "${mode}".`);
}

function arweaveClient(env: NodeJS.ProcessEnv) {
  return Arweave.init({
    host: cleanEnv(env.RUBY_HIGH_NFT_METADATA_ARWEAVE_HOST) || "arweave.net",
    port: Math.max(1, Math.floor(Number(cleanEnv(env.RUBY_HIGH_NFT_METADATA_ARWEAVE_PORT) || 443))),
    protocol: cleanEnv(env.RUBY_HIGH_NFT_METADATA_ARWEAVE_PROTOCOL) || "https",
    timeout: 120_000,
    logging: false,
  });
}

function arweaveJwk(env: NodeJS.ProcessEnv): JWKInterface {
  const raw = cleanEnv(env.RUBY_HIGH_NFT_METADATA_ARWEAVE_JWK)
    || cleanEnv(env.RUBY_HIGH_ARWEAVE_JWK)
    || cleanEnv(env.RUBY_HIGH_ARWEAVE_WALLET_JWK)
    || cleanEnv(env.ARWEAVE_JWK);
  if (!raw) {
    throw new Error("NFT metadata storage is set to arweave but no Arweave JWK secret is configured.");
  }
  const parsed = parseJson(raw, "Arweave JWK");
  const jwk = findJwk(parsed);
  if (!jwk) throw new Error("Configured Arweave secret does not contain an RSA JWK.");
  return jwk;
}

async function uploadIrysSolanaJson(payload: NftMetadataUploadPayload, env: NodeJS.ProcessEnv): Promise<string> {
  const irys = await irysSolanaClient(env);
  const tags = tagsForMetadata(payload);
  const data = Buffer.from(payload.metadataJson, "utf8");
  await ensureIrysBalance(irys, data.length, tags, env);
  const receipt = await irys.upload(data, { tags });
  if (!receipt?.id) throw new Error("Irys metadata upload did not return a transaction id.");
  const uri = `${metadataGateway(env)}/${receipt.id}`;
  log.event("nft.metadata-uploaded", {
    provider: "irys-solana",
    assetKey: payload.assetKey,
    uri,
    metadataHash: payload.metadataHash,
  });
  return uri;
}

async function irysSolanaClient(env: NodeJS.ProcessEnv): Promise<any> {
  let builder = Uploader(Solana)
    .withWallet(irysSolanaWallet(env))
    .timeout(120_000)
    .withTokenOptions({ finality: "confirmed" });

  if (cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_NETWORK).toLowerCase() === "devnet") builder = builder.devnet();
  else builder = builder.mainnet();

  builder = builder.withRpc(
    cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_SOLANA_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_NFT_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_RPC_URL)
    || cleanEnv(env.SOLANA_RPC_URL)
    || "https://api.mainnet-beta.solana.com",
  );
  return builder;
}

function irysSolanaWallet(env: NodeJS.ProcessEnv): string | number[] {
  const raw = cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_SOLANA_SECRET_KEY)
    || cleanEnv(env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY)
    || cleanEnv(env.SOLANA_PRIVATE_KEY);
  if (!raw) {
    throw new Error("NFT metadata storage is set to irys-solana but no Solana wallet secret is configured.");
  }
  return findSolanaWalletSecret(parseMaybeJson(raw)) ?? raw;
}

async function ensureIrysBalance(
  irys: any,
  size: number,
  tags: Array<{ name: string; value: string }>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const price = await irys.getPrice(size, { tags });
  const balance = await irys.getLoadedBalance();
  if (balance.gte(price)) return;
  const autoFund = truthyEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_AUTO_FUND);
  const shortage = price.minus(balance);
  if (!autoFund) {
    throw new Error(`Irys metadata balance is short by ${shortage.toString()} atomic SOL units.`);
  }
  const fundingAmount = shortage.plus(price.dividedToIntegerBy(10)).plus(10_000);
  const receipt = await irys.fund(fundingAmount);
  log.event("nft.metadata-irys-funded", {
    amount: fundingAmount.toString(),
    signature: receipt?.id ? String(receipt.id) : "",
  });
}

function findSolanaWalletSecret(value: unknown): string | number[] | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return value as number[];
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["secretKey", "privateKey", "keypair", "wallet", "solanaWallet", "solana_wallet"]) {
    const found = findSolanaWalletSecret(record[key]);
    if (found) return found;
  }
  return null;
}

function findJwk(value: unknown): JWKInterface | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kty === "RSA" && record.n && record.e && record.d) return record as unknown as JWKInterface;
  for (const key of ["jwk", "wallet", "walletJwk", "arweaveWallet", "arweave_wallet", "privateKey"]) {
    const child = record[key];
    if (typeof child === "string") {
      const found = findJwk(parseJson(child, key));
      if (found) return found;
    } else {
      const found = findJwk(child);
      if (found) return found;
    }
  }
  return null;
}

function tagsForMetadata(payload: NftMetadataUploadPayload): Array<{ name: string; value: string }> {
  return [
    { name: "Content-Type", value: "application/json" },
    { name: "App-Name", value: "Ruby High" },
    { name: "Ruby-High-Asset-Key", value: payload.assetKey },
    { name: "Ruby-High-Metadata-Hash", value: payload.metadataHash },
    { name: "Ruby-High-Fallback-URI", value: payload.fallbackUri },
  ];
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function normalizeAssetKey(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function cleanEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function truthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(cleanEnv(value));
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
