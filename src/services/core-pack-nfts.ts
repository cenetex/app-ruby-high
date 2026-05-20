import { createHash } from "node:crypto";
import { create, createCollection, fetchCollectionV1, mplCore } from "@metaplex-foundation/mpl-core";
import { generateSigner, keypairIdentity, publicKey, type TransactionBuilder, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

export const CORE_PACK_NFT_PREFIX = "/api/apps/ruby-high/nft";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]));
const DEFAULT_PUBLIC_BASE_URL = "https://ruby-high.ai";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SYMBOL = "RUBY";

export interface CorePackNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcUrl: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  reason?: string;
}

export interface PublicCorePackNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcConfigured: boolean;
  rpcHost: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  reason?: string;
}

export interface CorePackNftMintInput {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  paymentSignature: string;
}

export interface CorePackNftMintResult {
  ownerWalletAddress: string;
  assetAddress: string;
  mintSignature: string;
  metadataUri: string;
}

export interface CoreCollectionCreateResult {
  collectionAddress: string;
  signature: string;
  metadataUri: string;
}

type CorePackNftMinter = (input: CorePackNftMintInput) => Promise<CorePackNftMintResult>;

let packMinterOverride: CorePackNftMinter | null = null;

export function setCorePackNftMinterForTest(minter: CorePackNftMinter | null): () => void {
  const previous = packMinterOverride;
  packMinterOverride = minter;
  return () => {
    packMinterOverride = previous;
  };
}

export function corePackNftStatus(env: NodeJS.ProcessEnv = process.env): CorePackNftStatus {
  const publicBaseUrl = publicBaseUrlFromEnv(env);
  const rpcUrl = nftRpcUrl(env);
  const symbol = nftSymbol(env);
  const collectionAddress = cleanEnv(env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS);
  const secret = cleanEnv(env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      reason: "RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.",
    };
  }
  if (!collectionAddress) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      reason: "RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS is not set.",
    };
  }
  try {
    const bytes = parseSecretKeyBytes(secret);
    cleanSolanaAddress(collectionAddress, "Core collection address");
    return {
      configured: true,
      publicBaseUrl,
      rpcUrl,
      symbol,
      authorityAddress: addressFromPublicKeyBytes(bytes),
      collectionAddress,
    };
  } catch (err) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      collectionAddress,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function publicCorePackNftStatus(env: NodeJS.ProcessEnv = process.env): PublicCorePackNftStatus {
  const status = corePackNftStatus(env);
  return {
    configured: status.configured,
    publicBaseUrl: status.publicBaseUrl,
    rpcConfigured: !!status.rpcUrl,
    rpcHost: rpcHostForPublicStatus(status.rpcUrl),
    symbol: status.symbol,
    ...(status.authorityAddress ? { authorityAddress: status.authorityAddress } : {}),
    ...(status.collectionAddress ? { collectionAddress: status.collectionAddress } : {}),
    ...(status.reason ? { reason: status.reason } : {}),
  };
}

export function corePackNftMetadataUri(args: {
  productId: string;
  packCount: number;
  cardCount: number;
  paymentSignature: string;
}, env: NodeJS.ProcessEnv = process.env): string {
  const base = publicBaseUrlFromEnv(env);
  const productId = encodeURIComponent(cleanProductId(args.productId));
  const serial = encodeURIComponent(packSerial(args.paymentSignature));
  return `${base}${CORE_PACK_NFT_PREFIX}/metadata/core/pack/${productId}/${serial}.json?packs=${encodeURIComponent(String(args.packCount))}&cards=${encodeURIComponent(String(args.cardCount))}`;
}

export function coreCollectionMetadataUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${publicBaseUrlFromEnv(env)}${CORE_PACK_NFT_PREFIX}/metadata/core/collection.json`;
}

export function corePackNftMetadataForRoute(args: {
  productId: string;
  serial: string;
  packCount?: string;
  cardCount?: string;
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const packCount = Math.max(1, Math.floor(Number(args.packCount ?? 1)));
  const cardCount = Math.max(1, Math.floor(Number(args.cardCount ?? packCount * 4)));
  const serial = normalizeSerial(args.serial);
  const name = packCount === 1 ? `Ruby High Pack #${serial}` : `Ruby High ${packCount}-Pack #${serial}`;
  return {
    name,
    symbol: nftSymbol(process.env),
    description: `${packCount} Ruby High ${packCount === 1 ? "pack" : "packs"} with ${cardCount} cards inside.`,
    image: `${publicBaseUrl}/api/apps/ruby-high/assets/welcome-hall-passes.png`,
    external_url: `${publicBaseUrl}/`,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Type", value: "Pack" },
      { trait_type: "Product", value: cleanProductId(args.productId) },
      { trait_type: "Packs", value: packCount },
      { trait_type: "Cards Inside", value: cardCount },
      { trait_type: "Serial", value: serial },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${publicBaseUrl}/api/apps/ruby-high/assets/welcome-hall-passes.png`, type: "image/png" }],
    },
  };
}

export function corePackCollectionMetadataForRoute(args: {
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  return {
    name: "Ruby High Packs",
    symbol: nftSymbol(process.env),
    description: "Ruby High card packs.",
    image: `${publicBaseUrl}/api/apps/ruby-high/assets/ruby-high-logo.png`,
    external_url: `${publicBaseUrl}/`,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Type", value: "Pack Collection" },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${publicBaseUrl}/api/apps/ruby-high/assets/ruby-high-logo.png`, type: "image/png" }],
    },
  };
}

export async function mintCorePackNft(input: CorePackNftMintInput): Promise<CorePackNftMintResult> {
  if (packMinterOverride) return packMinterOverride(input);
  const config = readCoreMintConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const owner = publicKey(cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet"));
  const collectionAddress = publicKey(config.collectionAddress);
  const collection = await fetchCollectionV1(umi, collectionAddress);
  const asset = generateSigner(umi);
  const metadataUri = corePackNftMetadataUri(input);
  const packCount = Math.max(1, Math.floor(Number(input.packCount || 1)));
  const builder = create(umi, {
    asset,
    collection,
    authority: umi.identity,
    payer: umi.payer,
    owner,
    name: packCount === 1 ? `Ruby High Pack #${packSerial(input.paymentSignature)}` : `Ruby High ${packCount}-Pack #${packSerial(input.paymentSignature)}`,
    uri: metadataUri,
  });
  const sent = await sendAndConfirmCoreTransaction(umi, builder);
  return {
    ownerWalletAddress: owner,
    assetAddress: asset.publicKey,
    mintSignature: base58Encode(sent.signature),
    metadataUri,
  };
}

export async function createCorePackCollection(): Promise<CoreCollectionCreateResult> {
  const config = readCollectionCreateConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const collection = generateSigner(umi);
  const metadataUri = coreCollectionMetadataUri();
  const sent = await sendAndConfirmCoreTransaction(umi, createCollection(umi, {
    collection,
    updateAuthority: umi.identity.publicKey,
    payer: umi.payer,
    name: "Ruby High Packs",
    uri: metadataUri,
  }));
  return {
    collectionAddress: collection.publicKey,
    signature: base58Encode(sent.signature),
    metadataUri,
  };
}

function readCoreMintConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
  collectionAddress: string;
} {
  const status = corePackNftStatus();
  if (!status.configured || !status.collectionAddress) {
    throw new Error(status.reason || "Pack NFT minting is not configured.");
  }
  return {
    authoritySecret: parseSecretKeyBytes(cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY)),
    rpcUrl: status.rpcUrl,
    symbol: status.symbol,
    collectionAddress: status.collectionAddress,
  };
}

async function sendAndConfirmCoreTransaction(umi: Umi, builder: TransactionBuilder): ReturnType<TransactionBuilder["sendAndConfirm"]> {
  try {
    return await builder.sendAndConfirm(umi, {
      send: { skipPreflight: false, maxRetries: 3 },
      confirm: { commitment: "confirmed" },
    });
  } catch (err) {
    if (!isPreflightUnsupportedError(err)) throw err;
    return builder.sendAndConfirm(umi, {
      send: { skipPreflight: true, maxRetries: 3 },
      confirm: { commitment: "confirmed" },
    });
  }
}

function isPreflightUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /preflight check is not supported/i.test(message);
}

function readCollectionCreateConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
} {
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) throw new Error("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.");
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl: nftRpcUrl(process.env),
    symbol: nftSymbol(process.env),
  };
}

function cleanProductId(value: string): string {
  return (typeof value === "string" && value.trim() ? value.trim() : "card-pack-1")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .slice(0, 96);
}

function packSerial(paymentSignature: string): string {
  const digest = createHash("sha256").update(paymentSignature || String(Date.now())).digest("hex");
  return String((Number.parseInt(digest.slice(0, 10), 16) % 900000) + 100000);
}

function normalizeSerial(serial: string): string {
  const parsed = Math.max(1, Math.floor(Number(serial)));
  return Number.isFinite(parsed) ? String(parsed) : "1";
}

function publicBaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_PUBLIC_BASE_URL) || DEFAULT_PUBLIC_BASE_URL);
}

function nftRpcUrl(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_SOLANA_NFT_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_RPC_URL)
    || (cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID)
      ? `https://solana-mainnet.rpc.privy.systems?privyAppId=${encodeURIComponent(cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID))}`
      : DEFAULT_SOLANA_RPC_URL);
}

function nftSymbol(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_SOLANA_NFT_SYMBOL) || DEFAULT_SYMBOL;
}

function rpcHostForPublicStatus(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || "configured";
  } catch {
    return value ? "configured" : "";
  }
}

function cleanBaseUrl(value: string): string {
  const raw = value.trim() || DEFAULT_PUBLIC_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function cleanEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSolanaAddress(value: string, label: string): string {
  const clean = value.trim();
  if (!clean || clean.length < 32 || clean.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(clean)) {
    throw new Error(`${label} is invalid.`);
  }
  return clean;
}

function parseSecretKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.");
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error("NFT authority secret JSON must be an array.");
    bytes = Uint8Array.from(parsed.map((n) => {
      const value = Math.floor(Number(n));
      if (!Number.isFinite(value) || value < 0 || value > 255) {
        throw new Error("NFT authority secret JSON contains an invalid byte.");
      }
      return value;
    }));
  } else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    bytes = base58Decode(trimmed);
  } else {
    bytes = Uint8Array.from(Buffer.from(trimmed, "base64"));
  }
  if (bytes.length !== 64) {
    throw new Error("NFT authority secret key must be 64 bytes.");
  }
  return bytes;
}

function base58Decode(value: string): Uint8Array {
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit == null) throw new Error("Invalid base58 secret key.");
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function addressFromPublicKeyBytes(secretBytes: Uint8Array): string {
  const publicKeyBytes = secretBytes.slice(32);
  return base58Encode(publicKeyBytes);
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out || "1";
}

export function deterministicCorePackMintForTest(input: CorePackNftMintInput): CorePackNftMintResult {
  const digest = createHash("sha256").update(`${input.productId}:${input.paymentSignature}:${input.ownerWalletAddress}`).digest("hex");
  return {
    ownerWalletAddress: input.ownerWalletAddress,
    assetAddress: base58Encode(Buffer.from(digest.slice(0, 64), "hex") as unknown as Uint8Array).padEnd(32, "1").slice(0, 32),
    mintSignature: base58Encode(Buffer.from(digest + digest, "hex") as unknown as Uint8Array).padEnd(64, "1").slice(0, 64),
    metadataUri: corePackNftMetadataUri(input),
  };
}
