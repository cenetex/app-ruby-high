import { readFileSync } from "node:fs";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_PROGRAM_ID = "8PqZcrp5KNZBpdpMMM2H5N3QvaZmhyuEL6vCs5MYRATi";
const MAINNET_PROGRAM_ID = "2q5xELTGky988Lz1oLZLpBoQv7DzB7bBxoUdQGRmRATi";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const KNOWN_TOKEN_PROGRAM_ADDRESSES = new Set([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]);
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000n;
const SOURCE_CONFIG_LEN = 150;
const DESTINATION_CONFIG_LEN = 188;
const ACCOUNT_VERSION = 1;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type ExchangeCluster = "devnet" | "mainnet-beta";
export type ExchangeRouteId = "ruby" | "rati" | "kyro";

export interface PublicExchangeRoute {
  id: ExchangeRouteId;
  cluster: ExchangeCluster;
  enabled: boolean;
  configured: boolean;
  status: "enabled" | "configured-disabled" | "missing-config";
  sourceMint: string;
  sourceSymbol: string;
  sourceDisplayName: string;
  sourceDecimals: number;
  destinationMint: string;
  destinationSymbol: string;
  destinationDisplayName: string;
  destinationDecimals: number;
  sourceTokenProgram: string;
  destinationTokenProgram: string;
  compatibilityLabel: string;
  programId: string;
  fixedRatioSourceAmount: string;
  fixedRatioDestinationAmount: string;
  ratioLabel: string;
  rpcHost: string;
  sourceSeller: PublicSourceSellerStatus;
  reason?: string;
}

export interface PublicSourceSellerStatus {
  configured: boolean;
  enabled: boolean;
  priceSol: string;
  mintAmount: string;
  treasury: string;
  sellerAuthority: string;
  sellerSourceTokenAccount: string;
  reason?: string;
}

export interface ExchangeRouteStats {
  generatedAt: string;
  cluster: ExchangeCluster;
  routeId: ExchangeRouteId;
  sourceConfigAddress: string;
  destinationConfigAddress: string;
  mintAuthorityAddress: string;
  sourceConfigExists: boolean;
  destinationConfigExists: boolean;
  sourceEnabled: boolean | null;
  sourceFinalized: boolean | null;
  destinationStatus: string | null;
  migrationCount: string | null;
  sourceBurnedBaseUnits: string | null;
  destinationMintedBaseUnits: string | null;
  destinationTotalMintedBaseUnits: string | null;
  fixedRatioSourceAmount: string | null;
  fixedRatioDestinationAmount: string | null;
  decodeWarning?: string;
}

export interface PublicExchangeStatus {
  ok: true;
  generatedAt: string;
  defaultCluster: ExchangeCluster;
  clusters: Array<{
    id: ExchangeCluster;
    label: string;
    rpcHost: string;
    programId: string;
    routes: PublicExchangeRoute[];
  }>;
}

export interface ExchangeTransactionInput {
  cluster?: string;
  routeId?: string;
  ownerWalletAddress: string;
  amountBaseUnits?: string;
  maxSourceAmountBaseUnits?: string;
  sourceTokenAccountAddress?: string;
  userNonce?: string | number | bigint;
  latestBlockhash?: { blockhash: string; lastValidBlockHeight: number };
}

export interface ExchangeTransactionResult {
  ownerWalletAddress: string;
  cluster: ExchangeCluster;
  routeId: ExchangeRouteId;
  sourceMint: string;
  destinationMint: string;
  programId: string;
  sourceTokenAccountAddress: string;
  destinationTokenAccountAddress: string;
  sourceAmountBaseUnits: string;
  destinationAmountBaseUnits: string;
  maxSourceAmountBaseUnits: string;
  userNonce: string;
  transactionBase64: string;
  transactionEncoding: "base64";
  chain: `solana:${ExchangeCluster}`;
  rpcUrl: string;
}

export interface SourceSaleTransactionInput {
  cluster?: string;
  routeId?: string;
  ownerWalletAddress: string;
  latestBlockhash?: { blockhash: string; lastValidBlockHeight: number };
}

export interface SourceSaleTransactionResult {
  ownerWalletAddress: string;
  cluster: "devnet";
  routeId: ExchangeRouteId;
  sourceMint: string;
  sourceSymbol: string;
  sourceTokenAccountAddress: string;
  sellerAuthorityAddress: string;
  sellerSourceTokenAccountAddress: string;
  treasuryAddress: string;
  sourceAmountBaseUnits: string;
  priceLamports: string;
  priceSol: string;
  transactionBase64: string;
  transactionEncoding: "base64";
  chain: "solana:devnet";
  rpcUrl: string;
}

interface ExchangeRouteConfig {
  id: ExchangeRouteId;
  cluster: ExchangeCluster;
  sourceMint: string;
  sourceSymbol: string;
  sourceDisplayName: string;
  sourceDecimals: number;
  destinationMint: string;
  destinationSymbol: string;
  destinationDisplayName: string;
  destinationDecimals: number;
  sourceTokenProgram: string;
  destinationTokenProgram: string;
  compatibilityLabel: string;
  fixedRatioSourceAmount: bigint;
  fixedRatioDestinationAmount: bigint;
  enabled: boolean;
  reason?: string;
  sourceSeller: PublicSourceSellerStatus;
}

interface ExchangeClusterConfig {
  id: ExchangeCluster;
  label: string;
  rpcUrl: string;
  programId: string;
  routes: ExchangeRouteConfig[];
}

interface SourceAccountChoice {
  tokenAccountAddress: string;
  balanceBaseUnits: bigint;
}

function envTrim(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readBooleanEnv(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = envTrim(name, env);
  if (!raw) return fallback;
  return /^(1|true|yes|on|enabled)$/i.test(raw);
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number, env: NodeJS.ProcessEnv): number {
  const raw = envTrim(name, env);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readPositiveDecimalEnv(name: string, fallback: string, env: NodeJS.ProcessEnv): string {
  const raw = envTrim(name, env);
  if (!raw || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return fallback;
  return raw;
}

function readPositiveBigIntEnv(name: string, fallback: bigint, env: NodeJS.ProcessEnv): bigint {
  const raw = envTrim(name, env);
  if (!raw || !/^[1-9]\d*$/.test(raw)) return fallback;
  return BigInt(raw);
}

function decimalAmountToBaseUnits(value: string, decimals: number, label: string): bigint {
  const clean = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean)) throw new Error(`${label} must be a decimal amount.`);
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) throw new Error(`${label} has too many decimal places.`);
  const base = 10n ** BigInt(decimals);
  return BigInt(whole) * base + BigInt((fraction || "0").padEnd(decimals, "0"));
}

function isSolanaAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function rpcHostForPublicStatus(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || "configured";
  } catch {
    return value ? "configured" : "";
  }
}

function readTokenProgramEnv(name: string, fallback: string, env: NodeJS.ProcessEnv): string {
  const value = envTrim(name, env) ?? fallback;
  return isSolanaAddress(value) && KNOWN_TOKEN_PROGRAM_ADDRESSES.has(value) ? value : fallback;
}

function clusterFromInput(input: string | undefined | null, env: NodeJS.ProcessEnv = process.env): ExchangeCluster {
  const clean = (input || envTrim("RUBY_HIGH_EXCHANGE_DEFAULT_CLUSTER", env) || "devnet").trim();
  return clean === "mainnet" || clean === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

function routeIdFromInput(input: string | undefined | null): ExchangeRouteId {
  const clean = (input || "ruby").trim().toLowerCase();
  if (clean === "rati" || clean === "kyro" || clean === "ruby") return clean;
  throw new Error("Unknown exchange route.");
}

function devnetRouteSourceMint(routeId: ExchangeRouteId, env: NodeJS.ProcessEnv): string {
  const upper = routeId.toUpperCase();
  return envTrim(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_MINT`, env) ?? "";
}

function routeEnabled(cluster: ExchangeCluster, routeId: ExchangeRouteId, env: NodeJS.ProcessEnv): boolean {
  const clusterKey = cluster === "mainnet-beta" ? "MAINNET" : "DEVNET";
  const upper = routeId.toUpperCase();
  const clusterEnabled = readBooleanEnv(`RUBY_HIGH_EXCHANGE_${clusterKey}_ENABLED`, false, env);
  return readBooleanEnv(`RUBY_HIGH_EXCHANGE_${clusterKey}_${upper}_ENABLED`, clusterEnabled, env);
}

function base58Decode(value: string): Uint8Array {
  let bytes = [0];
  for (const char of value) {
    const valueIndex = BASE58_ALPHABET.indexOf(char);
    if (valueIndex < 0) throw new Error("Invalid base58 secret key.");
    let carry = valueIndex;
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

function parseSecretKey(raw: string): Uint8Array {
  const clean = raw.trim();
  if (!clean) throw new Error("Missing secret key.");
  if (clean.startsWith("[") || clean.startsWith("{")) {
    const parsed = JSON.parse(clean) as unknown;
    if (Array.isArray(parsed)) return Uint8Array.from(parsed.map((value) => Number(value)));
    const values = (parsed as { secretKey?: unknown; privateKey?: unknown; keypair?: unknown }).secretKey
      ?? (parsed as { privateKey?: unknown }).privateKey
      ?? (parsed as { keypair?: unknown }).keypair;
    if (Array.isArray(values)) return Uint8Array.from(values.map((value) => Number(value)));
    if (typeof values === "string") return parseSecretKey(values);
  }
  if (/^\d+(?:\s*,\s*\d+)+$/.test(clean)) {
    return Uint8Array.from(clean.split(",").map((value) => Number(value.trim())));
  }
  return base58Decode(clean);
}

function sourceSellerAuthority(routeId: ExchangeRouteId, env: NodeJS.ProcessEnv): Keypair | null {
  const upper = routeId.toUpperCase();
  const raw = envTrim(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_AUTHORITY_SECRET_KEY`, env)
    ?? envTrim("RUBY_HIGH_EXCHANGE_DEVNET_SOURCE_SELLER_AUTHORITY_SECRET_KEY", env);
  const keypairPath = envTrim(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_AUTHORITY_KEYPAIR`, env)
    ?? envTrim("RUBY_HIGH_EXCHANGE_DEVNET_SOURCE_SELLER_AUTHORITY_KEYPAIR", env);
  if (!raw && !keypairPath) return null;
  const secretKey = parseSecretKey(raw ?? readFileSync(keypairPath as string, "utf8"));
  if (secretKey.length === 32) return Keypair.fromSeed(secretKey);
  if (secretKey.length === 64) return Keypair.fromSecretKey(secretKey);
  throw new Error("Devnet source seller authority secret key must be 32 or 64 bytes.");
}

function maybeSourceSellerAuthority(routeId: ExchangeRouteId, env: NodeJS.ProcessEnv): Keypair | null {
  try {
    return sourceSellerAuthority(routeId, env);
  } catch {
    return null;
  }
}

function sourceSellerStatus(
  cluster: ExchangeCluster,
  routeId: ExchangeRouteId,
  sourceMint: string,
  sourceDecimals: number,
  sourceTokenProgramAddress: string,
  env: NodeJS.ProcessEnv,
): PublicSourceSellerStatus {
  if (cluster !== "devnet") {
    return {
      configured: false,
      enabled: false,
      priceSol: "0",
      mintAmount: "0",
      treasury: "",
      sellerAuthority: "",
      sellerSourceTokenAccount: "",
      reason: "Source-token sales are devnet-only.",
    };
  }
  const upper = routeId.toUpperCase();
  const treasury = envTrim(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_TREASURY`, env) ?? "";
  const enabled = readBooleanEnv(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_ENABLED`, false, env);
  const priceSol = readPositiveDecimalEnv(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_PRICE_SOL`, "0.01", env);
  const mintAmount = readPositiveDecimalEnv(`RUBY_HIGH_EXCHANGE_DEVNET_${upper}_SOURCE_SELLER_MINT_AMOUNT`, "1000", env);
  const authority = maybeSourceSellerAuthority(routeId, env);
  const sourceMintValid = isSolanaAddress(sourceMint);
  let amountsValid = true;
  try {
    decimalAmountToBaseUnits(priceSol, 9, "Devnet source seller price");
    decimalAmountToBaseUnits(mintAmount, sourceDecimals, "Devnet source seller amount");
  } catch {
    amountsValid = false;
  }
  const tokenProgram = new PublicKey(sourceTokenProgramAddress);
  const sellerSourceTokenAccount = authority && sourceMintValid
    ? associatedTokenAddress(authority.publicKey, new PublicKey(sourceMint), tokenProgram).toBase58()
    : "";
  const configured = enabled && isSolanaAddress(treasury) && !!authority && sourceMintValid && amountsValid;
  const reason = !enabled
    ? "Devnet source seller is disabled."
    : !isSolanaAddress(treasury)
      ? "Devnet source seller treasury is not configured."
      : !authority
        ? "Devnet source seller authority is not configured."
        : !sourceMintValid
          ? "Devnet source seller source mint is not configured."
          : !amountsValid
            ? "Devnet source seller amount or price is invalid."
            : undefined;
  return {
    configured,
    enabled: configured,
    priceSol,
    mintAmount,
    treasury,
    sellerAuthority: authority?.publicKey.toBase58() ?? "",
    sellerSourceTokenAccount,
    ...(reason ? { reason } : {}),
  };
}

function exchangeClusters(env: NodeJS.ProcessEnv = process.env): ExchangeClusterConfig[] {
  const devnetProgramId = envTrim("RUBY_HIGH_EXCHANGE_DEVNET_PROGRAM_ID", env) ?? DEVNET_PROGRAM_ID;
  const mainnetProgramId = envTrim("RUBY_HIGH_EXCHANGE_MAINNET_PROGRAM_ID", env) ?? MAINNET_PROGRAM_ID;
  const routes = (cluster: ExchangeCluster): ExchangeRouteConfig[] => {
    const devnet = cluster === "devnet";
    const programDefaults = devnet
      ? {
        rati: "7tsUBJDdRQtGh5KE65NUbm7ERw1ieNpGtf2r1ozkRATi",
        kyro: "5NmaAuT96RSCqpz1ujmXRVe8xe24C9ofECbBJkNgKyro",
        ruby: "fqitLg2nec2KwpdAZBEpjdbgoDCT6W4fdUZaibQRuby",
      }
      : {
        rati: "G1NJuxZQihpk6Bc9XLxjFpeiuwMiAPoRKjcBmqL1RATi",
        kyro: "7m5Y29h6pEvzfkgn3hkYqFQNUrL5CofXtrnDJoqCKyro",
        ruby: "2hJY16WZgTQXXo6qBoWoBtZM7fz556cw3qdLgtntRuby",
      };
    const sourceDefaults = devnet
      ? {
        rati: devnetRouteSourceMint("rati", env),
        kyro: devnetRouteSourceMint("kyro", env),
        ruby: devnetRouteSourceMint("ruby", env),
      }
      : {
        rati: "Ci6Y1UX8bY4jxn6YiogJmdCxFEu2jmZhCcG65PStpump",
        kyro: "281Qdc3ZcPQtn8odD9p4GyhzBSko1r5jmQrNU1dQBAGS",
        ruby: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      };
    const prefix = cluster === "mainnet-beta" ? "MAINNET" : "DEVNET";
    const route = (id: ExchangeRouteId, values: {
      sourceSymbol: string;
      sourceDisplayName: string;
      sourceDecimals: number;
      destinationSymbol: string;
      destinationDisplayName: string;
      destinationDecimals: number;
      fixedRatioSourceAmount: bigint;
      fixedRatioDestinationAmount: bigint;
    }): ExchangeRouteConfig => {
      const upper = id.toUpperCase();
      const sourceMint = envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_SOURCE_MINT`, env) ?? sourceDefaults[id];
      const destinationMint = envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_DESTINATION_MINT`, env) ?? programDefaults[id];
      const enabled = routeEnabled(cluster, id, env);
      const sourceDecimals = readBoundedIntEnv(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_SOURCE_DECIMALS`, values.sourceDecimals, 0, 18, env);
      const destinationDecimals = readBoundedIntEnv(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_DESTINATION_DECIMALS`, values.destinationDecimals, 0, 18, env);
      const sourceTokenProgram = readTokenProgramEnv(
        `RUBY_HIGH_EXCHANGE_${prefix}_${upper}_SOURCE_TOKEN_PROGRAM`,
        TOKEN_PROGRAM_ADDRESS,
        env,
      );
      const destinationTokenProgram = readTokenProgramEnv(
        `RUBY_HIGH_EXCHANGE_${prefix}_${upper}_DESTINATION_TOKEN_PROGRAM`,
        TOKEN_PROGRAM_ADDRESS,
        env,
      );
      const fixedRatioSourceAmount = readPositiveBigIntEnv(
        `RUBY_HIGH_EXCHANGE_${prefix}_${upper}_FIXED_RATIO_SOURCE_AMOUNT`,
        values.fixedRatioSourceAmount,
        env,
      );
      const fixedRatioDestinationAmount = readPositiveBigIntEnv(
        `RUBY_HIGH_EXCHANGE_${prefix}_${upper}_FIXED_RATIO_DESTINATION_AMOUNT`,
        values.fixedRatioDestinationAmount,
        env,
      );
      const compatibilityLabel = envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_COMPATIBILITY_LABEL`, env)
        ?? envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_COMPATIBILITY_LABEL`, env)
        ?? "RATi OS / RATi";
      const invalid = [
        isSolanaAddress(sourceMint) ? "" : "source mint",
        isSolanaAddress(destinationMint) ? "" : "destination mint",
        isSolanaAddress(sourceTokenProgram) ? "" : "source token program",
        isSolanaAddress(destinationTokenProgram) ? "" : "destination token program",
      ].filter(Boolean);
      return {
        id,
        cluster,
        sourceMint,
        sourceSymbol: envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_SOURCE_SYMBOL`, env) ?? values.sourceSymbol,
        sourceDisplayName: values.sourceDisplayName,
        sourceDecimals,
        destinationMint,
        destinationSymbol: envTrim(`RUBY_HIGH_EXCHANGE_${prefix}_${upper}_DESTINATION_SYMBOL`, env) ?? values.destinationSymbol,
        destinationDisplayName: values.destinationDisplayName,
        destinationDecimals,
        sourceTokenProgram,
        destinationTokenProgram,
        compatibilityLabel,
        fixedRatioSourceAmount,
        fixedRatioDestinationAmount,
        enabled,
        ...(invalid.length > 0 ? { reason: `Exchange route has invalid ${invalid.join(", ")} configuration.` } : {}),
        sourceSeller: sourceSellerStatus(cluster, id, sourceMint, sourceDecimals, sourceTokenProgram, env),
      };
    };
    return [
      route("ruby", {
        sourceSymbol: "RUBY",
        sourceDisplayName: "Ruby High current source token",
        sourceDecimals: 6,
        destinationSymbol: "Ruby",
        destinationDisplayName: "Canonical Ruby",
        destinationDecimals: 6,
        fixedRatioSourceAmount: 1000n,
        fixedRatioDestinationAmount: 1n,
      }),
      route("rati", {
        sourceSymbol: "$RATi",
        sourceDisplayName: "RATIPUMP source token",
        sourceDecimals: 6,
        destinationSymbol: "RATi",
        destinationDisplayName: "Canonical RATi",
        destinationDecimals: 6,
        fixedRatioSourceAmount: 1000n,
        fixedRatioDestinationAmount: 1n,
      }),
      route("kyro", {
        sourceSymbol: "RATIOS",
        sourceDisplayName: "RATIBAGS source token",
        sourceDecimals: 9,
        destinationSymbol: "Kyro",
        destinationDisplayName: "Canonical Kyro",
        destinationDecimals: 6,
        fixedRatioSourceAmount: 1000n,
        fixedRatioDestinationAmount: 1n,
      }),
    ];
  };
  return [
    {
      id: "devnet",
      label: "Devnet Lab",
      rpcUrl: envTrim("RUBY_HIGH_EXCHANGE_DEVNET_RPC_URL", env) ?? DEFAULT_DEVNET_RPC_URL,
      programId: devnetProgramId,
      routes: routes("devnet"),
    },
    {
      id: "mainnet-beta",
      label: "Mainnet Reference",
      rpcUrl: envTrim("RUBY_HIGH_EXCHANGE_MAINNET_RPC_URL", env)
        ?? envTrim("RUBY_HIGH_SOLANA_RPC_URL", env)
        ?? DEFAULT_MAINNET_RPC_URL,
      programId: mainnetProgramId,
      routes: routes("mainnet-beta"),
    },
  ];
}

function publicRoute(cluster: ExchangeClusterConfig, route: ExchangeRouteConfig): PublicExchangeRoute {
  const programValid = isSolanaAddress(cluster.programId);
  const routeValid = !route.reason
    && isSolanaAddress(route.sourceMint)
    && isSolanaAddress(route.destinationMint)
    && isSolanaAddress(route.sourceTokenProgram)
    && isSolanaAddress(route.destinationTokenProgram);
  const configured = programValid && routeValid;
  const enabled = configured && route.enabled;
  const reason = !programValid
    ? "Exchange program id is invalid."
    : route.reason
      ?? (!route.sourceMint ? "Source mint is not configured." : undefined)
      ?? (!enabled ? "Exchange route is configured but explicitly disabled." : undefined);
  return {
    id: route.id,
    cluster: route.cluster,
    enabled,
    configured,
    status: enabled ? "enabled" : configured ? "configured-disabled" : "missing-config",
    sourceMint: route.sourceMint,
    sourceSymbol: route.sourceSymbol,
    sourceDisplayName: route.sourceDisplayName,
    sourceDecimals: route.sourceDecimals,
    destinationMint: route.destinationMint,
    destinationSymbol: route.destinationSymbol,
    destinationDisplayName: route.destinationDisplayName,
    destinationDecimals: route.destinationDecimals,
    sourceTokenProgram: route.sourceTokenProgram,
    destinationTokenProgram: route.destinationTokenProgram,
    compatibilityLabel: route.compatibilityLabel,
    programId: cluster.programId,
    fixedRatioSourceAmount: route.fixedRatioSourceAmount.toString(),
    fixedRatioDestinationAmount: route.fixedRatioDestinationAmount.toString(),
    ratioLabel: `${route.fixedRatioSourceAmount.toString()}:${route.fixedRatioDestinationAmount.toString()}`,
    rpcHost: rpcHostForPublicStatus(cluster.rpcUrl),
    sourceSeller: route.sourceSeller,
    ...(reason ? { reason } : {}),
  };
}

export function publicExchangeStatus(env: NodeJS.ProcessEnv = process.env): PublicExchangeStatus {
  const clusters = exchangeClusters(env);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    defaultCluster: clusterFromInput(null, env),
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      rpcHost: rpcHostForPublicStatus(cluster.rpcUrl),
      programId: cluster.programId,
      routes: cluster.routes.map((route) => publicRoute(cluster, route)),
    })),
  };
}

function readPublicKey(value: string, label: string): PublicKey {
  const clean = value.trim();
  try {
    return new PublicKey(clean);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function readU64(value: string, label: string): bigint {
  const clean = value.trim();
  if (!/^\d+$/.test(clean)) throw new Error(`${label} must be an unsigned integer.`);
  const parsed = BigInt(clean);
  if (parsed > (1n << 64n) - 1n) throw new Error(`${label} exceeds u64.`);
  return parsed;
}

function writeU64(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value, offset);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function decimalScale(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function sourceAmountForDestination(route: ExchangeRouteConfig, destinationAmountBaseUnits: bigint): bigint {
  const numerator = destinationAmountBaseUnits
    * route.fixedRatioSourceAmount
    * decimalScale(route.sourceDecimals);
  const denominator = route.fixedRatioDestinationAmount * decimalScale(route.destinationDecimals);
  return ceilDiv(numerator, denominator);
}

function destinationAmountForSource(route: ExchangeRouteConfig, sourceAmountBaseUnits: bigint): bigint {
  const numerator = sourceAmountBaseUnits
    * route.fixedRatioDestinationAmount
    * decimalScale(route.destinationDecimals);
  const denominator = route.fixedRatioSourceAmount * decimalScale(route.sourceDecimals);
  return numerator / denominator;
}

function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([
    owner.toBuffer(),
    tokenProgram.toBuffer(),
    mint.toBuffer(),
  ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS))[0];
}

function createAssociatedTokenAccountIdempotentInstruction(input: {
  payer: PublicKey;
  ata: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.ata, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_ADDRESS), isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function createTransferCheckedInstruction(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  writeU64(data, 1, input.amount);
  data[9] = input.decimals;
  return new TransactionInstruction({
    programId: input.tokenProgram,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function createMigrateInstruction(input: {
  programId: PublicKey;
  owner: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  sourceTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  sourceTokenProgram: PublicKey;
  destinationTokenProgram: PublicKey;
  destinationAmountBaseUnits: bigint;
  maxSourceAmountBaseUnits: bigint;
  userNonce: bigint;
}): TransactionInstruction {
  const [configPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("burn-to-mint"),
    Buffer.from("config"),
    Buffer.from("v1"),
  ], input.programId);
  const [sourceConfigPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("source"),
    input.sourceMint.toBuffer(),
    input.destinationMint.toBuffer(),
  ], input.programId);
  const [destinationConfigPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("destination"),
    input.destinationMint.toBuffer(),
  ], input.programId);
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("mint-authority"),
    input.destinationMint.toBuffer(),
  ], input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.owner, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: sourceConfigPda, isSigner: false, isWritable: true },
      { pubkey: destinationConfigPda, isSigner: false, isWritable: true },
      { pubkey: input.sourceTokenAccount, isSigner: false, isWritable: true },
      { pubkey: input.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: input.sourceMint, isSigner: false, isWritable: true },
      { pubkey: input.destinationMint, isSigner: false, isWritable: true },
      { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: input.sourceTokenProgram, isSigner: false, isWritable: false },
      { pubkey: input.destinationTokenProgram, isSigner: false, isWritable: false },
    ],
    data: encodeMigrateInstruction(input.destinationAmountBaseUnits, input.maxSourceAmountBaseUnits, input.userNonce),
  });
}

function encodeMigrateInstruction(
  desiredDestinationAmount: bigint,
  maxSourceAmount: bigint,
  userNonce: bigint,
): Buffer {
  const out = Buffer.alloc(26);
  out[0] = 4;
  writeU64(out, 1, desiredDestinationAmount);
  writeU64(out, 9, maxSourceAmount);
  writeU64(out, 17, userNonce);
  out[25] = 0;
  return out;
}

async function findOwnerTokenAccountForExchange(input: {
  rpcUrl: string;
  ownerWalletAddress: string;
  sourceMint: string;
  requiredBaseUnits: bigint | null;
  sourceSymbol: string;
}): Promise<SourceAccountChoice> {
  const response = await fetch(input.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-token-exchange-accounts",
      method: "getTokenAccountsByOwner",
      params: [
        input.ownerWalletAddress,
        { mint: input.sourceMint },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { value?: Array<{ pubkey?: string; account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> };
  };
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  let best: SourceAccountChoice | null = null;
  for (const account of payload.result?.value ?? []) {
    const tokenAccountAddress = typeof account.pubkey === "string" ? account.pubkey.trim() : "";
    const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (!tokenAccountAddress || typeof amount !== "string" || !/^\d+$/.test(amount)) continue;
    const balanceBaseUnits = BigInt(amount);
    if (balanceBaseUnits <= 0n) continue;
    if (input.requiredBaseUnits != null && balanceBaseUnits < input.requiredBaseUnits) continue;
    if (!best || balanceBaseUnits > best.balanceBaseUnits) {
      best = { tokenAccountAddress, balanceBaseUnits };
    }
  }
  if (!best) {
    throw new Error(input.requiredBaseUnits == null
      ? `This Solana wallet does not have ${input.sourceSymbol} to burn.`
      : `This Solana wallet does not have enough ${input.sourceSymbol} to burn.`);
  }
  return best;
}

async function fetchLatestBlockhash(rpcUrl: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-token-exchange-blockhash",
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { value?: { blockhash?: string; lastValidBlockHeight?: number } };
  };
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  const blockhash = payload.result?.value?.blockhash;
  const lastValidBlockHeight = Number(payload.result?.value?.lastValidBlockHeight);
  if (!blockhash || !Number.isFinite(lastValidBlockHeight)) {
    throw new Error("Solana RPC did not return a recent blockhash.");
  }
  return { blockhash, lastValidBlockHeight: Math.floor(lastValidBlockHeight) };
}

function exchangeRouteById(clusterId: ExchangeCluster, routeId: ExchangeRouteId, env: NodeJS.ProcessEnv): {
  cluster: ExchangeClusterConfig;
  route: ExchangeRouteConfig;
} {
  const cluster = exchangeClusters(env).find((entry) => entry.id === clusterId);
  const route = cluster?.routes.find((entry) => entry.id === routeId);
  if (!cluster || !route) throw new Error("Unknown exchange route.");
  return { cluster, route };
}

export async function buildExchangeTransaction(
  input: ExchangeTransactionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExchangeTransactionResult> {
  const clusterId = clusterFromInput(input.cluster, env);
  const routeId = routeIdFromInput(input.routeId);
  const { cluster, route } = exchangeRouteById(clusterId, routeId, env);
  const publicStatus = publicRoute(cluster, route);
  if (!publicStatus.enabled) {
    throw new Error(publicStatus.reason || "Exchange route is not enabled.");
  }
  const owner = readPublicKey(input.ownerWalletAddress, "Owner Solana wallet");
  const sourceMint = readPublicKey(route.sourceMint, "Exchange source mint");
  const destinationMint = readPublicKey(route.destinationMint, "Exchange destination mint");
  const programId = readPublicKey(cluster.programId, "Exchange program id");
  const sourceTokenProgram = readPublicKey(route.sourceTokenProgram, "Exchange source token program");
  const destinationTokenProgram = readPublicKey(route.destinationTokenProgram, "Exchange destination token program");
  const requestedDestinationAmount = input.amountBaseUnits
    ? readU64(input.amountBaseUnits, "Exchange destination amount")
    : null;
  const requiredSourceForRequest = requestedDestinationAmount == null
    ? null
    : sourceAmountForDestination(route, requestedDestinationAmount);
  const source = input.sourceTokenAccountAddress && requestedDestinationAmount
    ? {
      tokenAccountAddress: readPublicKey(input.sourceTokenAccountAddress, "Source token account").toBase58(),
      balanceBaseUnits: requiredSourceForRequest ?? requestedDestinationAmount,
    }
    : await findOwnerTokenAccountForExchange({
      rpcUrl: cluster.rpcUrl,
      ownerWalletAddress: owner.toBase58(),
      sourceMint: sourceMint.toBase58(),
      requiredBaseUnits: requiredSourceForRequest,
      sourceSymbol: route.sourceSymbol,
    });
  const destinationAmountBaseUnits = requestedDestinationAmount
    ?? destinationAmountForSource(route, source.balanceBaseUnits);
  if (destinationAmountBaseUnits <= 0n) {
    throw new Error(`This Solana wallet does not have enough ${route.sourceSymbol} to mint ${route.destinationSymbol}.`);
  }
  const sourceAmountBaseUnits = sourceAmountForDestination(route, destinationAmountBaseUnits);
  if (source.balanceBaseUnits < sourceAmountBaseUnits) {
    throw new Error(`This Solana wallet does not have enough ${route.sourceSymbol} to burn.`);
  }
  const maxSourceAmountBaseUnits = input.maxSourceAmountBaseUnits
    ? readU64(input.maxSourceAmountBaseUnits, "Exchange max source amount")
    : sourceAmountBaseUnits;
  if (maxSourceAmountBaseUnits < sourceAmountBaseUnits) {
    throw new Error("Exchange max source amount is smaller than the required burn amount.");
  }
  const userNonce = input.userNonce == null
    ? BigInt(Date.now())
    : readU64(String(input.userNonce), "Exchange nonce");
  const destinationTokenAccountAddress = associatedTokenAddress(owner, destinationMint, destinationTokenProgram).toBase58();
  const latestBlockhash = input.latestBlockhash ?? await fetchLatestBlockhash(cluster.rpcUrl);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latestBlockhash.blockhash,
  });
  transaction.add(createAssociatedTokenAccountIdempotentInstruction({
    payer: owner,
    ata: new PublicKey(destinationTokenAccountAddress),
    owner,
    mint: destinationMint,
    tokenProgram: destinationTokenProgram,
  }));
  transaction.add(createMigrateInstruction({
    programId,
    owner,
    sourceMint,
    destinationMint,
    sourceTokenAccount: new PublicKey(source.tokenAccountAddress),
    destinationTokenAccount: new PublicKey(destinationTokenAccountAddress),
    sourceTokenProgram,
    destinationTokenProgram,
    destinationAmountBaseUnits,
    maxSourceAmountBaseUnits,
    userNonce,
  }));
  return {
    ownerWalletAddress: owner.toBase58(),
    cluster: clusterId,
    routeId,
    sourceMint: sourceMint.toBase58(),
    destinationMint: destinationMint.toBase58(),
    programId: programId.toBase58(),
    sourceTokenAccountAddress: source.tokenAccountAddress,
    destinationTokenAccountAddress,
    sourceAmountBaseUnits: sourceAmountBaseUnits.toString(),
    destinationAmountBaseUnits: destinationAmountBaseUnits.toString(),
    maxSourceAmountBaseUnits: maxSourceAmountBaseUnits.toString(),
    userNonce: userNonce.toString(),
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64"),
    transactionEncoding: "base64",
    chain: `solana:${clusterId}`,
    rpcUrl: cluster.rpcUrl,
  };
}

export async function buildSourceSaleTransaction(
  input: SourceSaleTransactionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SourceSaleTransactionResult> {
  const clusterId = clusterFromInput(input.cluster, env);
  if (clusterId !== "devnet") throw new Error("Source-token sales are devnet-only.");
  const routeId = routeIdFromInput(input.routeId);
  const { cluster, route } = exchangeRouteById(clusterId, routeId, env);
  const publicStatus = publicRoute(cluster, route);
  if (!publicStatus.configured) {
    throw new Error(publicStatus.reason || "Exchange route is not configured.");
  }
  if (!route.sourceSeller.enabled) {
    throw new Error(route.sourceSeller.reason || "Devnet source seller is not enabled.");
  }
  const sellerAuthority = sourceSellerAuthority(routeId, env);
  if (!sellerAuthority) throw new Error("Devnet source seller authority is not configured.");
  const owner = readPublicKey(input.ownerWalletAddress, "Owner Solana wallet");
  const treasury = readPublicKey(route.sourceSeller.treasury, "Devnet source seller treasury");
  const sourceMint = readPublicKey(route.sourceMint, "Devnet source mint");
  const sourceTokenProgram = readPublicKey(route.sourceTokenProgram, "Devnet source token program");
  const sourceAmountBaseUnits = decimalAmountToBaseUnits(
    route.sourceSeller.mintAmount,
    route.sourceDecimals,
    "Devnet source seller amount",
  );
  if (sourceAmountBaseUnits <= 0n) throw new Error("Devnet source seller amount must be greater than zero.");
  const priceLamports = decimalAmountToBaseUnits(route.sourceSeller.priceSol, 9, "Devnet source seller price");
  if (priceLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Devnet source seller price is too large.");
  const ownerSourceTokenAccount = associatedTokenAddress(owner, sourceMint, sourceTokenProgram);
  const sellerSourceTokenAccount = associatedTokenAddress(sellerAuthority.publicKey, sourceMint, sourceTokenProgram);
  const latestBlockhash = input.latestBlockhash ?? await fetchLatestBlockhash(cluster.rpcUrl);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latestBlockhash.blockhash,
  });
  transaction.add(createAssociatedTokenAccountIdempotentInstruction({
    payer: owner,
    ata: ownerSourceTokenAccount,
    owner,
    mint: sourceMint,
    tokenProgram: sourceTokenProgram,
  }));
  if (priceLamports > 0n) {
    transaction.add(SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: treasury,
      lamports: Number(priceLamports),
    }));
  }
  transaction.add(createTransferCheckedInstruction({
    source: sellerSourceTokenAccount,
    mint: sourceMint,
    destination: ownerSourceTokenAccount,
    authority: sellerAuthority.publicKey,
    amount: sourceAmountBaseUnits,
    decimals: route.sourceDecimals,
    tokenProgram: sourceTokenProgram,
  }));
  transaction.partialSign(sellerAuthority);
  return {
    ownerWalletAddress: owner.toBase58(),
    cluster: "devnet",
    routeId,
    sourceMint: sourceMint.toBase58(),
    sourceSymbol: route.sourceSymbol,
    sourceTokenAccountAddress: ownerSourceTokenAccount.toBase58(),
    sellerAuthorityAddress: sellerAuthority.publicKey.toBase58(),
    sellerSourceTokenAccountAddress: sellerSourceTokenAccount.toBase58(),
    treasuryAddress: treasury.toBase58(),
    sourceAmountBaseUnits: sourceAmountBaseUnits.toString(),
    priceLamports: priceLamports.toString(),
    priceSol: route.sourceSeller.priceSol,
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64"),
    transactionEncoding: "base64",
    chain: "solana:devnet",
    rpcUrl: cluster.rpcUrl,
  };
}

function readU64FromData(data: Buffer, offset: number): string {
  return data.readBigUInt64LE(offset).toString();
}

function statusLabel(value: number): string {
  if (value === 0) return "planned";
  if (value === 1) return "candidate";
  if (value === 2) return "enabled";
  if (value === 3) return "paused";
  if (value === 4) return "finalized";
  return "unknown";
}

function decodeBase64AccountData(account: unknown): Buffer | null {
  const data = (account as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || typeof data[0] !== "string") return null;
  try {
    return Buffer.from(data[0], "base64");
  } catch {
    return null;
  }
}

async function fetchMultipleAccounts(rpcUrl: string, addresses: string[]): Promise<Array<unknown | null>> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-token-exchange-stats",
      method: "getMultipleAccounts",
      params: [
        addresses,
        { encoding: "base64", commitment: "confirmed" },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { value?: Array<unknown | null> };
  };
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  return payload.result?.value ?? [];
}

export async function exchangeRouteStats(
  clusterInput: string | undefined,
  routeInput: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExchangeRouteStats> {
  const clusterId = clusterFromInput(clusterInput, env);
  const routeId = routeIdFromInput(routeInput);
  const { cluster, route } = exchangeRouteById(clusterId, routeId, env);
  const programId = readPublicKey(cluster.programId, "Exchange program id");
  const sourceMint = readPublicKey(route.sourceMint, "Exchange source mint");
  const destinationMint = readPublicKey(route.destinationMint, "Exchange destination mint");
  const [sourceConfig] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("source"),
    sourceMint.toBuffer(),
    destinationMint.toBuffer(),
  ], programId);
  const [destinationConfig] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("destination"),
    destinationMint.toBuffer(),
  ], programId);
  const [mintAuthority] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("mint-authority"),
    destinationMint.toBuffer(),
  ], programId);
  const stats: ExchangeRouteStats = {
    generatedAt: new Date().toISOString(),
    cluster: clusterId,
    routeId,
    sourceConfigAddress: sourceConfig.toBase58(),
    destinationConfigAddress: destinationConfig.toBase58(),
    mintAuthorityAddress: mintAuthority.toBase58(),
    sourceConfigExists: false,
    destinationConfigExists: false,
    sourceEnabled: null,
    sourceFinalized: null,
    destinationStatus: null,
    migrationCount: null,
    sourceBurnedBaseUnits: null,
    destinationMintedBaseUnits: null,
    destinationTotalMintedBaseUnits: null,
    fixedRatioSourceAmount: null,
    fixedRatioDestinationAmount: null,
  };
  const [sourceAccount, destinationAccount] = await fetchMultipleAccounts(cluster.rpcUrl, [
    stats.sourceConfigAddress,
    stats.destinationConfigAddress,
  ]);
  const sourceData = decodeBase64AccountData(sourceAccount);
  if (sourceData) {
    stats.sourceConfigExists = true;
    if (sourceData.length === SOURCE_CONFIG_LEN && sourceData[0] === ACCOUNT_VERSION) {
      stats.fixedRatioSourceAmount = readU64FromData(sourceData, 100);
      stats.fixedRatioDestinationAmount = readU64FromData(sourceData, 108);
      stats.sourceEnabled = sourceData[116] === 1;
      stats.sourceBurnedBaseUnits = readU64FromData(sourceData, 117);
      stats.destinationMintedBaseUnits = readU64FromData(sourceData, 125);
      stats.migrationCount = readU64FromData(sourceData, 133);
      stats.sourceFinalized = sourceData[142] === 1;
    } else {
      stats.decodeWarning = "Source config account exists but does not match the expected v1 layout.";
    }
  }
  const destinationData = decodeBase64AccountData(destinationAccount);
  if (destinationData) {
    stats.destinationConfigExists = true;
    if (destinationData.length === DESTINATION_CONFIG_LEN && destinationData[0] === ACCOUNT_VERSION) {
      stats.destinationTotalMintedBaseUnits = readU64FromData(destinationData, 147);
      stats.destinationStatus = statusLabel(destinationData[179] ?? -1);
    } else {
      stats.decodeWarning = stats.decodeWarning
        ? `${stats.decodeWarning} Destination config account exists but does not match the expected v1 layout.`
        : "Destination config account exists but does not match the expected v1 layout.";
    }
  }
  return stats;
}
