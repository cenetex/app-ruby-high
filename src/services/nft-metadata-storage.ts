import { createHash } from "node:crypto";
import Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet";
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

export interface PublicNftMetadataStorageStatus {
  mode: "app-hosted" | "arweave" | string;
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
  return metadataStorageMode(env) === "arweave";
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
  if (mode !== "arweave") {
    return {
      mode,
      durable: false,
      configured: false,
      reason: `Unsupported NFT metadata storage mode "${mode}".`,
    };
  }
  try {
    arweaveJwk(env);
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
  if (mode !== "arweave") {
    throw new Error(`Unsupported NFT metadata storage mode "${mode}". Use "arweave" or unset RUBY_HIGH_NFT_METADATA_STORAGE.`);
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
    }, env);
    uploadedMetadataUris.set(cacheKey, promise);
  }
  return promise;
}

async function uploadDurableJson(payload: NftMetadataUploadPayload, env: NodeJS.ProcessEnv): Promise<string> {
  if (uploaderOverride) return uploaderOverride(payload);
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
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_NFT_METADATA_GATEWAY) || DEFAULT_ARWEAVE_GATEWAY);
}

function metadataStorageMode(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_NFT_METADATA_STORAGE).toLowerCase();
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

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
