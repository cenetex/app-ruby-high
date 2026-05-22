import { createHash } from "node:crypto";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import Arweave from "arweave";
import { log } from "./logger.js";

const DEFAULT_ARWEAVE_GATEWAY = "https://arweave.net";

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

let irysClientPromise: Promise<any> | null = null;
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
  const mode = cleanEnv(env.RUBY_HIGH_NFT_METADATA_STORAGE).toLowerCase();
  if (!mode) return false;
  return mode === "irys" || mode === "irys-solana" || mode === "arweave";
}

export async function durableNftMetadataUri(input: DurableNftMetadataInput): Promise<string> {
  const env = input.env ?? process.env;
  const fallbackUri = input.fallbackUri.trim();
  if (!nftMetadataStorageEnabled(env)) return fallbackUri;
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
    }, env);
    uploadedMetadataUris.set(cacheKey, promise);
  }
  return promise;
}

async function uploadDurableJson(payload: NftMetadataUploadPayload, env: NodeJS.ProcessEnv): Promise<string> {
  if (uploaderOverride) return uploaderOverride(payload);
  const mode = cleanEnv(env.RUBY_HIGH_NFT_METADATA_STORAGE).toLowerCase();
  if (mode === "arweave") return uploadDirectArweaveJson(payload, env);
  if (mode !== "irys" && mode !== "irys-solana") return payload.fallbackUri;
  const irys = await irysClient(env);
  const data = Buffer.from(payload.metadataJson, "utf8");
  const tags = tagsForMetadata(payload);
  const price = await irys.getPrice(data.length, { tags });
  const balance = await irys.getLoadedBalance();
  if (typeof balance?.lt === "function" && balance.lt(price)) {
    throw new Error(`Irys metadata balance is short. Required ${price.toString()} atomic units, available ${balance.toString()}.`);
  }
  const receipt = await irys.upload(data, { tags });
  if (!receipt?.id) throw new Error("Irys metadata upload did not return an id.");
  const uri = `${metadataGateway(env)}/${receipt.id}`;
  log.event("nft.metadata-uploaded", {
    provider: "irys",
    assetKey: payload.assetKey,
    uri,
    metadataHash: payload.metadataHash,
  });
  return uri;
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

async function irysClient(env: NodeJS.ProcessEnv): Promise<any> {
  if (irysClientPromise) return irysClientPromise;
  irysClientPromise = (async () => {
    let builder = Uploader(Solana)
      .withWallet(metadataSolanaWallet(env))
      .timeout(120_000)
      .withTokenOptions({ finality: "confirmed" });
    const network = cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_NETWORK).toLowerCase();
    builder = network === "devnet" ? builder.devnet() : builder.mainnet();
    builder = builder.withRpc(metadataRpcUrl(env));
    return builder;
  })();
  return irysClientPromise;
}

function metadataSolanaWallet(env: NodeJS.ProcessEnv): string | number[] {
  const raw = cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_SOLANA_PRIVATE_KEY)
    || cleanEnv(env.SOLANA_PRIVATE_KEY)
    || cleanEnv(env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!raw) {
    throw new Error("NFT metadata storage is enabled but no Solana upload wallet is configured.");
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((value) => Number(value));
    if (Array.isArray(parsed?.secretKey)) return parsed.secretKey.map((value: unknown) => Number(value));
    if (typeof parsed?.privateKey === "string") return parsed.privateKey;
  } catch {
    // Treat non-JSON values as wallet strings accepted by the Irys Solana SDK.
  }
  return raw;
}

function metadataRpcUrl(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_NFT_METADATA_IRYS_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_NFT_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_RPC_URL)
    || "https://api.mainnet-beta.solana.com";
}

function metadataGateway(env: NodeJS.ProcessEnv): string {
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_NFT_METADATA_GATEWAY) || DEFAULT_ARWEAVE_GATEWAY);
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

function arweaveJwk(env: NodeJS.ProcessEnv): Record<string, unknown> {
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

function findJwk(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kty === "RSA" && record.n && record.e && record.d) return record;
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

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
