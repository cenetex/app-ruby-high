import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { AuthService } from "../services/auth-service.js";
import { log } from "../services/logger.js";
import {
  HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
  HALL_PASS_CARDS_PER_PACK,
  RubyHighService,
  WELCOME_HALL_PASS_GRANT,
  type HallPassCardBurnInput,
} from "../services/ruby-high-service.js";
import {
  courseSlotCost,
  hostedAiAccessCost,
  hostedAiAccessDurationMs,
  hostedEntitlementStatus,
  hostedImageCost,
  hostedOpenRouterConfigured,
  moreQuestionsCount,
  questionGenerationCost,
} from "../hosted-entitlements.js";
import { publicHallPassNftStatus, verifyHallPassCardBurn } from "../services/hall-pass-nfts.js";
import {
  buildCorePackPurchaseTransaction,
  mintCorePackNft,
  publicCorePackNftStatus,
} from "../services/core-pack-nfts.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export {
  courseSlotCost,
  hostedAiAccessCost,
  hostedAiAccessDurationMs,
  hostedImageCost,
  moreQuestionsCount,
  questionGenerationCost,
} from "../hosted-entitlements.js";

export const BILLING_PREFIX = `${APP_ROUTE_PREFIX}/billing`;

export interface BillingProduct {
  id: string;
  name: string;
  packCount: number;
  cardCount: number;
  hallPasses: number;
  unitAmount: number;
  currency: string;
  description: string;
}

export interface SolanaBillingProduct {
  id: string;
  name: string;
  packCount: number;
  cardCount: number;
  hallPasses: number;
  tokenAmount: string;
  tokenAmountBaseUnits: string;
  tokenSymbol: string;
  description: string;
}

interface BillingDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

interface StripeCheckoutSession {
  id?: string;
  url?: string;
  payment_status?: string;
  client_reference_id?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string | undefined>;
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: StripeCheckoutSession };
}

interface RevenueCatWebhookEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  product_id?: string;
  store?: string;
  environment?: string;
  purchase_environment?: string;
  event_timestamp_ms?: number;
  cancel_reason?: string;
  price?: number;
  currency?: string;
  adjustments?: Array<{
    amount?: number;
    currency?: { code?: string; name?: string; description?: string };
  }>;
  virtual_currency_transaction_id?: string;
}

interface RevenueCatWebhookPayload {
  api_version?: string;
  event?: RevenueCatWebhookEvent;
}

interface SolanaBillingConfig {
  configured: boolean;
  rpcUrl: string;
  recipient: string;
  mint: string;
  symbol: string;
  decimals: number;
  products: SolanaBillingProduct[];
}

interface SolanaTokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
    decimals?: number;
  };
}

interface SolanaParsedTransaction {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preTokenBalances?: SolanaTokenBalance[];
    postTokenBalances?: SolanaTokenBalance[];
  } | null;
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
}

interface SolanaRpcResponse<T> {
  result?: T | null;
  error?: { code?: number; message?: string };
}

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SOLANA_MEMECOIN_MINT = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
const DEFAULT_SOLANA_TREASURY_OWNER = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58ISH = /^[1-9A-HJ-NP-Za-km-z]+$/;
const SOLANA_TOKEN_PRICE_ENVS: Record<string, string> = {
  "card-pack-1": "RUBY_HIGH_SOLANA_HALL_PASS_5_TOKENS",
  "card-pack-3": "RUBY_HIGH_SOLANA_HALL_PASS_20_TOKENS",
  "card-pack-5": "RUBY_HIGH_SOLANA_HALL_PASS_50_TOKENS",
  "card-pack-10": "RUBY_HIGH_SOLANA_HALL_PASS_100_TOKENS",
  "hall-pass-5": "RUBY_HIGH_SOLANA_HALL_PASS_5_TOKENS",
  "hall-pass-20": "RUBY_HIGH_SOLANA_HALL_PASS_20_TOKENS",
  "hall-pass-50": "RUBY_HIGH_SOLANA_HALL_PASS_50_TOKENS",
  "hall-pass-100": "RUBY_HIGH_SOLANA_HALL_PASS_100_TOKENS",
};

const SOLANA_TOKEN_PRICE_DEFAULTS: Record<string, string> = {
  "card-pack-1": "1000000",
  "card-pack-3": "2800000",
  "card-pack-5": "4500000",
  "card-pack-10": "8500000",
  "hall-pass-5": "1000000",
  "hall-pass-20": "2800000",
  "hall-pass-50": "4500000",
  "hall-pass-100": "8500000",
};

function envTrim(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = envTrim(name);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = envTrim(name);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function billingCurrency(): string {
  return envTrim("RUBY_HIGH_STRIPE_CURRENCY")?.toLowerCase() ?? "usd";
}

function revenueCatCurrencyCode(): string {
  return envTrim("RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE") ?? "HLP";
}

function solanaRpcUrl(): string {
  const explicit = envTrim("RUBY_HIGH_SOLANA_RPC_URL");
  if (explicit) return explicit;
  const privyAppId = envTrim("RUBY_HIGH_PRIVY_APP_ID");
  if (privyAppId) {
    return `https://solana-mainnet.rpc.privy.systems?privyAppId=${encodeURIComponent(privyAppId)}`;
  }
  return DEFAULT_SOLANA_RPC_URL;
}

function rpcHostForPublicStatus(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || "configured";
  } catch {
    return value ? "configured" : "";
  }
}

function solanaMemecoinMint(): string {
  return envTrim("RUBY_HIGH_SOLANA_MEMECOIN_MINT") ?? DEFAULT_SOLANA_MEMECOIN_MINT;
}

function solanaTreasuryOwner(): string {
  return envTrim("RUBY_HIGH_SOLANA_TREASURY_OWNER") ?? DEFAULT_SOLANA_TREASURY_OWNER;
}

function solanaMemecoinSymbol(): string {
  return envTrim("RUBY_HIGH_SOLANA_MEMECOIN_SYMBOL") ?? "RUBY";
}

function solanaMemecoinDecimals(): number {
  return readBoundedIntEnv("RUBY_HIGH_SOLANA_MEMECOIN_DECIMALS", 6, 0, 18);
}

export function billingProducts(): BillingProduct[] {
  const currency = billingCurrency();
  const product = (
    hallPasses: number,
    unitAmount: number,
  ): BillingProduct => ({
    id: `hall-pass-${hallPasses}`,
    name: `${hallPasses} Hall Pass${hallPasses === 1 ? "" : "es"}`,
    packCount: 0,
    cardCount: 0,
    hallPasses,
    unitAmount,
    currency,
    description: `${hallPasses} Ruby High Hall Pass${hallPasses === 1 ? "" : "es"} for hosted AI and creator features.`,
  });
  return [
    product(5, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_5_CENTS", 199)),
    product(20, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_20_CENTS", 699)),
    product(50, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_50_CENTS", 1499)),
    product(100, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_100_CENTS", 2499)),
  ];
}

function solanaPackProducts(): BillingProduct[] {
  const currency = billingCurrency();
  const product = (
    packCount: number,
    unitAmount: number,
  ): BillingProduct => {
    const plural = packCount === 1 ? "Pack" : "Packs";
    const cardCount = packCount * HALL_PASS_CARDS_PER_PACK;
    return {
      id: `card-pack-${packCount}`,
      name: `${packCount} ${plural}`,
      packCount,
      cardCount,
      hallPasses: cardCount,
      unitAmount,
      currency,
      description: `${packCount} Ruby High ${plural.toLowerCase()}: three student cards, one teacher card, and one item or location per pack.`,
    };
  };
  return [
    product(1, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_5_CENTS", 199)),
    product(3, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_20_CENTS", 699)),
    product(5, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_50_CENTS", 1499)),
    product(10, readPositiveIntEnv("RUBY_HIGH_HALL_PASS_100_CENTS", 2499)),
  ];
}

function isBase58Address(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && BASE58ISH.test(value);
}

function isSolanaSignature(value: string): boolean {
  return value.length >= 64 && value.length <= 100 && BASE58ISH.test(value);
}

function parseTokenAmountToBaseUnits(raw: string, decimals: number): bigint | null {
  const clean = raw.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean)) return null;
  const [whole, fractional = ""] = clean.split(".");
  if (fractional.length > decimals) return null;
  const multiplier = 10n ** BigInt(decimals);
  const wholeUnits = BigInt(whole) * multiplier;
  const fractionalUnits = fractional
    ? BigInt(fractional.padEnd(decimals, "0"))
    : 0n;
  const units = wholeUnits + fractionalUnits;
  return units > 0n ? units : null;
}

function formatTokenAmount(units: bigint, decimals: number): string {
  if (decimals <= 0) return units.toString();
  const multiplier = 10n ** BigInt(decimals);
  const whole = units / multiplier;
  const fractional = units % multiplier;
  if (fractional === 0n) return whole.toString();
  const fractionalText = fractional.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionalText}`;
}

function solanaTokenAmountForProduct(product: BillingProduct, decimals: number): { display: string; baseUnits: string } | null {
  const envName = SOLANA_TOKEN_PRICE_ENVS[product.id];
  if (!envName) return null;
  const raw = envTrim(envName) ?? SOLANA_TOKEN_PRICE_DEFAULTS[product.id] ?? "1000000";
  const baseUnits = parseTokenAmountToBaseUnits(raw, decimals);
  if (!baseUnits) return null;
  return {
    display: formatTokenAmount(baseUnits, decimals),
    baseUnits: baseUnits.toString(),
  };
}

function solanaBillingConfig(): SolanaBillingConfig {
  const decimals = solanaMemecoinDecimals();
  const mint = solanaMemecoinMint();
  const recipient = solanaTreasuryOwner();
  const symbol = solanaMemecoinSymbol();
  const products = solanaPackProducts().flatMap((product): SolanaBillingProduct[] => {
    const price = solanaTokenAmountForProduct(product, decimals);
    if (!price) return [];
    return [{
      id: product.id,
      name: product.name,
      packCount: product.packCount,
      cardCount: product.cardCount,
      hallPasses: product.hallPasses,
      tokenAmount: price.display,
      tokenAmountBaseUnits: price.baseUnits,
      tokenSymbol: symbol,
      description: product.description,
    }];
  });
  return {
    configured: isBase58Address(mint) && isBase58Address(recipient) && products.length > 0,
    rpcUrl: solanaRpcUrl(),
    recipient,
    mint,
    symbol,
    decimals,
    products,
  };
}

function solanaProductById(productId: string | undefined | null): SolanaBillingProduct | null {
  const id = productId?.trim();
  if (!id) return null;
  return solanaBillingConfig().products.find((product) => product.id === id) ?? null;
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

function solanaPaymentReference(sessionId: string, productId: string): string {
  const digest = createHash("sha256")
    .update(`ruby-high:solana-payment:v1:${sessionId}:${productId}`)
    .digest();
  return base58Encode(digest);
}

function solanaPayUrl(config: SolanaBillingConfig, product: SolanaBillingProduct, reference: string): string {
  const params = new URLSearchParams();
  params.set("amount", product.tokenAmount);
  params.set("spl-token", config.mint);
  params.set("reference", reference);
  params.set("label", "Ruby High");
  params.set("message", `${product.packCount} Ruby High ${product.packCount === 1 ? "Pack" : "Packs"}`);
  return `solana:${config.recipient}?${params.toString()}`;
}

function solanaTransactionKey(signature: string): string {
  return `solana:spl-token-transfer:${signature.trim()}`;
}

function accountKeyPubkey(value: string | { pubkey?: string }): string {
  return typeof value === "string" ? value : value.pubkey ?? "";
}

function solanaTransactionHasReference(transaction: SolanaParsedTransaction, reference: string): boolean {
  const accountKeys = transaction.transaction?.message?.accountKeys;
  return Array.isArray(accountKeys) && accountKeys.some((entry) => accountKeyPubkey(entry) === reference);
}

function solanaTransactionHasAccount(transaction: SolanaParsedTransaction, address: string): boolean {
  const accountKeys = transaction.transaction?.message?.accountKeys;
  return Array.isArray(accountKeys) && accountKeys.some((entry) => accountKeyPubkey(entry) === address);
}

function tokenBalanceAmount(balance: SolanaTokenBalance): bigint {
  const amount = balance.uiTokenAmount?.amount;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return 0n;
  return BigInt(amount);
}

function solanaTreasuryTokenDelta(transaction: SolanaParsedTransaction, config: SolanaBillingConfig): bigint {
  const pre = new Map<number, bigint>();
  const post = new Map<number, bigint>();
  const collect = (balances: SolanaTokenBalance[] | undefined, target: Map<number, bigint>) => {
    if (!Array.isArray(balances)) return;
    for (const balance of balances) {
      if (balance.mint !== config.mint || balance.owner !== config.recipient) continue;
      const index = Math.floor(Number(balance.accountIndex));
      if (!Number.isFinite(index)) continue;
      target.set(index, tokenBalanceAmount(balance));
    }
  };
  collect(transaction.meta?.preTokenBalances, pre);
  collect(transaction.meta?.postTokenBalances, post);
  const indexes = new Set([...pre.keys(), ...post.keys()]);
  let delta = 0n;
  for (const index of indexes) {
    delta += (post.get(index) ?? 0n) - (pre.get(index) ?? 0n);
  }
  return delta;
}

async function fetchSolanaTransaction(config: SolanaBillingConfig, signature: string): Promise<SolanaParsedTransaction | null> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-solana-billing",
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as SolanaRpcResponse<SolanaParsedTransaction>;
  if (!response.ok) {
    throw new Error(`Solana RPC failed with ${response.status}.`);
  }
  if (payload.error) {
    throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  }
  return payload.result ?? null;
}

function signedSolanaTransactionAccountKeys(transactionBase64: string): string[] {
  const raw = transactionBase64.trim();
  if (!raw || raw.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("Signed Solana transaction is missing or invalid.");
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) throw new Error("Signed Solana transaction is invalid.");
  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    return transaction.message.getAccountKeys().staticAccountKeys.map((key) => key.toBase58());
  } catch {
    const transaction = Transaction.from(bytes);
    return transaction.compileMessage().accountKeys.map((key) => key.toBase58());
  }
}

function requireSignedTransactionAccounts(transactionBase64: string, accounts: string[]): void {
  const present = new Set(signedSolanaTransactionAccountKeys(transactionBase64));
  const missing = accounts.filter((account) => account && !present.has(account));
  if (missing.length > 0) {
    throw new Error("Signed Solana transaction does not match this Ruby High checkout.");
  }
}

async function submitSignedSolanaTransactionAttempt(
  config: SolanaBillingConfig,
  transactionBase64: string,
  skipPreflight: boolean,
): Promise<string> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-solana-submit",
      method: "sendTransaction",
      params: [
        transactionBase64.trim(),
        {
          encoding: "base64",
          maxRetries: 5,
          preflightCommitment: "confirmed",
          skipPreflight,
        },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as SolanaRpcResponse<string>;
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  if (!payload.result || !isSolanaSignature(payload.result)) {
    throw new Error("Solana RPC did not return a transaction signature.");
  }
  return payload.result;
}

async function submitSignedSolanaTransaction(config: SolanaBillingConfig, transactionBase64: string): Promise<string> {
  try {
    return await submitSignedSolanaTransactionAttempt(config, transactionBase64, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (!/preflight check is not supported/i.test(message)) throw err;
    return submitSignedSolanaTransactionAttempt(config, transactionBase64, true);
  }
}

async function verifySolanaPayment(
  config: SolanaBillingConfig,
  product: SolanaBillingProduct,
  sessionId: string,
  signature: string,
  expectedPackAssetAddress = "",
): Promise<{ reference: string; receivedBaseUnits: string; slot?: number; blockTime?: number | null }> {
  const cleanSignature = signature.trim();
  if (!isSolanaSignature(cleanSignature)) throw new Error("Invalid Solana transaction signature.");
  const transaction = await fetchSolanaTransaction(config, cleanSignature);
  if (!transaction) throw new Error("Solana transaction was not found yet. Try again after confirmation.");
  if (transaction.meta?.err != null) throw new Error("Solana transaction failed on-chain.");
  const signatures = transaction.transaction?.signatures;
  if (Array.isArray(signatures) && signatures.length > 0 && !signatures.includes(cleanSignature)) {
    throw new Error("Solana RPC returned a different transaction.");
  }
  const reference = solanaPaymentReference(sessionId, product.id);
  if (!solanaTransactionHasReference(transaction, reference)) {
    throw new Error("Solana transaction is missing this Ruby High payment reference.");
  }
  if (expectedPackAssetAddress && !solanaTransactionHasAccount(transaction, expectedPackAssetAddress)) {
    throw new Error("Solana transaction is missing this Ruby High pack NFT.");
  }
  const received = solanaTreasuryTokenDelta(transaction, config);
  const required = BigInt(product.tokenAmountBaseUnits);
  if (received < required) {
    throw new Error(`Solana payment is too small. Need ${product.tokenAmount} ${config.symbol}.`);
  }
  return {
    reference,
    receivedBaseUnits: received.toString(),
    slot: transaction.slot,
    blockTime: transaction.blockTime,
  };
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function safeReturnPath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed, "https://ruby-high.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function absoluteUrl(ctx: RouteContext, path: string): string {
  if (ctx.callbackUrlBuilder) return ctx.callbackUrlBuilder(path);
  return new URL(path, ctx.url?.origin ?? "http://127.0.0.1:3000").toString();
}

function parseStripeSignature(header: string): { timestamp: number; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") timestamp = Number(value);
    if (key === "v1") signatures.push(value);
  }
  return { timestamp, signatures };
}

export function verifyStripeWebhookSignature(rawBody: string, header: string, secret: string, nowMs = Date.now()): void {
  const { timestamp, signatures } = parseStripeSignature(header);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new Error("Malformed Stripe signature.");
  }
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp);
  if (ageSeconds > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error("Expired Stripe signature.");
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const matched = signatures.some((signature) => {
    const actualBuf = Buffer.from(signature, "hex");
    return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
  });
  if (!matched) throw new Error("Invalid Stripe signature.");
}

function stripeMetadata(session: StripeCheckoutSession): Record<string, string | undefined> {
  return session.metadata && typeof session.metadata === "object" ? session.metadata : {};
}

function billingProductById(productId: string | undefined | null): BillingProduct | null {
  const id = productId?.trim();
  if (!id) return null;
  const products = billingProducts();
  const direct = products.find((product) => product.id === id);
  if (direct) return direct;
  const normalized = id.toLowerCase();
  const legacy: Record<string, { hallPasses: number; centsEnv: string; fallbackCents: number }> = {
    "hall_pass_5": { hallPasses: 5, centsEnv: "RUBY_HIGH_HALL_PASS_5_CENTS", fallbackCents: 199 },
    "hall_pass_20": { hallPasses: 20, centsEnv: "RUBY_HIGH_HALL_PASS_20_CENTS", fallbackCents: 699 },
    "hall_pass_50": { hallPasses: 50, centsEnv: "RUBY_HIGH_HALL_PASS_50_CENTS", fallbackCents: 1499 },
    "hall_pass_100": { hallPasses: 100, centsEnv: "RUBY_HIGH_HALL_PASS_100_CENTS", fallbackCents: 2499 },
    "card-pack-1": { hallPasses: 5, centsEnv: "RUBY_HIGH_HALL_PASS_5_CENTS", fallbackCents: 199 },
    "card_pack_1": { hallPasses: 5, centsEnv: "RUBY_HIGH_HALL_PASS_5_CENTS", fallbackCents: 199 },
    "card-pack-3": { hallPasses: 15, centsEnv: "RUBY_HIGH_HALL_PASS_20_CENTS", fallbackCents: 699 },
    "card_pack_3": { hallPasses: 15, centsEnv: "RUBY_HIGH_HALL_PASS_20_CENTS", fallbackCents: 699 },
    "card-pack-5": { hallPasses: 25, centsEnv: "RUBY_HIGH_HALL_PASS_50_CENTS", fallbackCents: 1499 },
    "card_pack_5": { hallPasses: 25, centsEnv: "RUBY_HIGH_HALL_PASS_50_CENTS", fallbackCents: 1499 },
    "card-pack-10": { hallPasses: 50, centsEnv: "RUBY_HIGH_HALL_PASS_100_CENTS", fallbackCents: 2499 },
    "card_pack_10": { hallPasses: 50, centsEnv: "RUBY_HIGH_HALL_PASS_100_CENTS", fallbackCents: 2499 },
  };
  const legacyProduct = legacy[normalized];
  if (!legacyProduct) return null;
  return {
    id,
    name: `${legacyProduct.hallPasses} Hall Pass Legacy Pack`,
    packCount: 0,
    cardCount: 0,
    hallPasses: legacyProduct.hallPasses,
    unitAmount: readPositiveIntEnv(legacyProduct.centsEnv, legacyProduct.fallbackCents),
    currency: billingCurrency(),
    description: `${legacyProduct.hallPasses} Ruby High Hall Passes.`,
  };
}

function integerField(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function validateStripeCheckoutHallPasses(session: StripeCheckoutSession, metadata: Record<string, string | undefined>): BillingProduct {
  const product = billingProductById(
    metadata.hall_pass_product_id
      ?? metadata.hall_pass_pack_id
      ?? metadata.card_pack_id,
  );
  if (!product) throw new Error("Stripe checkout session references an unknown Hall Pass product.");
  const metadataHallPasses = integerField(metadata.hall_passes ?? metadata.card_count);
  if (metadataHallPasses !== product.hallPasses) {
    throw new Error("Stripe checkout session Hall Pass metadata does not match its product.");
  }
  const amountTotal = integerField(session.amount_total);
  if (amountTotal !== product.unitAmount) {
    throw new Error("Stripe checkout session amount does not match its Hall Pass product.");
  }
  const currency = typeof session.currency === "string" ? session.currency.trim().toLowerCase() : "";
  if (currency !== product.currency) {
    throw new Error("Stripe checkout session currency does not match its Hall Pass product.");
  }
  return product;
}

function hallPassesForProductId(productId: string | undefined | null): number | null {
  if (!productId) return null;
  const normalized = productId.trim().toLowerCase();
  const exact: Record<string, number> = {
    "card-pack-1": 5,
    "card_pack_1": 5,
    "card-pack-3": 15,
    "card_pack_3": 15,
    "card-pack-5": 25,
    "card_pack_5": 25,
    "card-pack-10": 50,
    "card_pack_10": 50,
    "hall-pass-5": 5,
    "hall_pass_5": 5,
    "hall-pass-20": 20,
    "hall_pass_20": 20,
    "hall-pass-50": 50,
    "hall_pass_50": 50,
    "hall-pass-100": 100,
    "hall_pass_100": 100,
  };
  if (exact[normalized] != null) return exact[normalized];
  const cardPackMatch = /(?:^|[._-])card[_-]?pack[_-]?(1|3|5|10)$/.exec(normalized);
  if (cardPackMatch) return Number(cardPackMatch[1]) * HALL_PASS_CARDS_PER_PACK;
  const match = /(?:^|[._-])hall[_-]?pass[_-]?(5|20|50|100)$/.exec(normalized);
  return match ? Number(match[1]) : null;
}

function revenueCatSessionId(event: RevenueCatWebhookEvent): string | null {
  const raw = (event.app_user_id || event.original_app_user_id || "").trim();
  if (!raw || raw.startsWith("$RCAnonymousID:")) return null;
  if (raw.startsWith("rh:")) return raw;
  return `rh:user:${raw}`;
}

function revenueCatAuthAllowed(header: string, configured: string): boolean {
  return header === configured || header === `Bearer ${configured}`;
}

function assertRevenueCatWebhookAuth(ctx: RouteContext): void {
  const configured = envTrim("RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH");
  if (!configured) throw new Error("RevenueCat webhook is not configured.");
  const header = firstHeader(ctx.authorizationHeader);
  if (!revenueCatAuthAllowed(header, configured)) throw new Error("Unauthorized RevenueCat webhook.");
}

function fulfillStripeCheckout(ruby: RubyHighService, session: StripeCheckoutSession): {
  sessionId: string;
  amount: number;
  productId: string;
  packCount: number;
  cardCount: number;
  applied: boolean;
} {
  const metadata = stripeMetadata(session);
  const sessionId = metadata.ruby_high_session_id || session.client_reference_id || "";
  if (!session.id) throw new Error("Stripe checkout session is missing an id.");
  if (!sessionId) throw new Error("Stripe checkout session is missing a Ruby High session id.");
  const product = validateStripeCheckoutHallPasses(session, metadata);
  const result = ruby.grantHallPasses(sessionId, {
    amount: product.hallPasses,
    idempotencyKey: `stripe:checkout:${session.id}`,
    source: "stripe",
    description: `${product.hallPasses} Ruby High Hall Pass${product.hallPasses === 1 ? "" : "es"}`,
    metadata: {
      stripeCheckoutSessionId: session.id,
      hallPassProductId: product.id,
      hallPasses: product.hallPasses,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
    },
  });
  return {
    sessionId,
    amount: product.hallPasses,
    productId: product.id,
    packCount: product.packCount,
    cardCount: product.cardCount,
    applied: result.applied,
  };
}

function compactRevenueCatIds(values: Array<string | undefined>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = value?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function revenueCatProductTransactionIds(event: RevenueCatWebhookEvent): string[] {
  return compactRevenueCatIds([event.transaction_id, event.original_transaction_id]);
}

function revenueCatVirtualCurrencyTransactionId(event: RevenueCatWebhookEvent): string | null {
  return compactRevenueCatIds([
    event.virtual_currency_transaction_id,
    event.transaction_id,
    event.original_transaction_id,
    event.id,
  ])[0] ?? null;
}

function revenueCatTransactionKey(prefix: "grant" | "reversal", transactionId: string): string {
  return `revenuecat:${prefix}:${transactionId}:${revenueCatCurrencyCode()}`;
}

function revenueCatWalletTransaction(
  ruby: RubyHighService,
  sessionId: string,
  prefix: "grant" | "reversal",
  transactionIds: string[],
) {
  for (const transactionId of transactionIds) {
    const transaction = ruby.walletTransaction(sessionId, revenueCatTransactionKey(prefix, transactionId));
    if (transaction) return { transactionId, transaction };
  }
  return null;
}

function hallPassDeltaFromResult(result: { transaction: { hallPasses?: number } }): number {
  const delta = Math.floor(Number(result.transaction.hallPasses ?? 0));
  return Number.isFinite(delta) ? delta : 0;
}

async function fulfillRevenueCatWebhook(ruby: RubyHighService, event: RevenueCatWebhookEvent): Promise<{
  applied: boolean;
  sessionId?: string;
  amount?: number;
  requestedAmount?: number;
  productId?: string;
  hallPasses?: number;
  reason?: string;
}> {
  if (event.type === "TEST") return { applied: false, reason: "test-event" };
  const sessionId = revenueCatSessionId(event);
  if (!sessionId) return { applied: false, reason: "missing-app-user-id" };

  const currencyCode = revenueCatCurrencyCode();
  if (event.type === "VIRTUAL_CURRENCY_TRANSACTION") {
    const adjustments = Array.isArray(event.adjustments) ? event.adjustments : [];
    const amount = adjustments.reduce((sum, adjustment) => {
      const code = adjustment.currency?.code;
      if (typeof code !== "string" || code.toUpperCase() !== currencyCode.toUpperCase()) return sum;
      const value = Math.floor(Number(adjustment.amount ?? 0));
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    if (amount === 0) return { applied: false, sessionId, reason: "no-hall-pass-adjustment" };
    const transactionId = revenueCatVirtualCurrencyTransactionId(event);
    if (!transactionId) return { applied: false, sessionId, reason: "missing-transaction-id" };
    const input = {
      amount: Math.abs(amount),
      idempotencyKey: revenueCatTransactionKey(amount > 0 ? "grant" : "reversal", transactionId),
      source: "revenuecat" as const,
      description: `${Math.abs(amount)} Ruby High Card${Math.abs(amount) === 1 ? "" : "s"} via RevenueCat`,
      at: event.event_timestamp_ms,
      metadata: {
        revenueCatEventId: event.id ?? null,
        revenueCatTransactionId: event.transaction_id ?? null,
        revenueCatVirtualCurrencyTransactionId: event.virtual_currency_transaction_id ?? null,
        productId: event.product_id ?? null,
        store: event.store ?? null,
        environment: event.environment ?? event.purchase_environment ?? null,
      },
    };
    const result = amount > 0
      ? ruby.grantHallPasses(sessionId, input)
      : ruby.revokeHallPasses(sessionId, input);
    await ruby.flushSession(sessionId);
    const actualAmount = hallPassDeltaFromResult(result);
    return {
      applied: result.applied,
      sessionId,
      amount: actualAmount,
      ...(actualAmount !== amount ? { requestedAmount: amount } : {}),
      productId: event.product_id,
      hallPasses: result.state.wallet.hallPasses,
    };
  }

  if (event.type === "NON_RENEWING_PURCHASE" || event.type === "CANCELLATION") {
    const amount = hallPassesForProductId(event.product_id);
    if (!amount) return { applied: false, sessionId, productId: event.product_id, reason: "unknown-product" };
    const transactionIds = revenueCatProductTransactionIds(event);
    const transactionId = transactionIds[0];
    if (!transactionId) {
      return { applied: false, sessionId, productId: event.product_id, reason: "missing-transaction-id" };
    }
    const reversal = event.type === "CANCELLATION";
    const existingReversal = revenueCatWalletTransaction(ruby, sessionId, "reversal", transactionIds);
    if (existingReversal) {
      if (!reversal) {
        return {
          applied: false,
          sessionId,
          amount: 0,
          requestedAmount: amount,
          productId: event.product_id,
          hallPasses: ruby.hallPassBalance(sessionId),
          reason: "transaction-already-refunded",
        };
      }
      const actualAmount = hallPassDeltaFromResult({ transaction: existingReversal.transaction });
      const requestedAmount = -amount;
      return {
        applied: false,
        sessionId,
        amount: actualAmount,
        ...(actualAmount !== requestedAmount ? { requestedAmount } : {}),
        productId: event.product_id,
        hallPasses: ruby.hallPassBalance(sessionId),
        reason: "already-reversed",
      };
    }
    if (reversal) {
      const originalGrant = revenueCatWalletTransaction(ruby, sessionId, "grant", transactionIds);
      if (!originalGrant) {
        let markerApplied = false;
        let hallPasses = ruby.hallPassBalance(sessionId);
        for (const candidateId of transactionIds) {
          const marker = ruby.recordWalletMarker(sessionId, {
            idempotencyKey: revenueCatTransactionKey("reversal", candidateId),
            kind: "hall-pass-revoke",
            hallPasses: 0,
            source: "revenuecat",
            description: `${amount} Ruby High Card${amount === 1 ? "" : "s"} RevenueCat refund marker`,
            at: event.event_timestamp_ms,
            display: false,
            metadata: {
              revenueCatEventId: event.id ?? null,
              revenueCatTransactionId: event.transaction_id ?? null,
              revenueCatOriginalTransactionId: event.original_transaction_id ?? null,
              revenueCatMatchedTransactionId: candidateId,
              productId: event.product_id ?? null,
              store: event.store ?? null,
              environment: event.environment ?? event.purchase_environment ?? null,
              cancelReason: event.cancel_reason ?? null,
              requestedHallPasses: -amount,
              reversalStatus: "missing-original-grant",
            },
          });
          markerApplied = markerApplied || marker.applied;
          hallPasses = marker.state.wallet.hallPasses;
        }
        await ruby.flushSession(sessionId);
        return {
          applied: false,
          sessionId,
          amount: 0,
          requestedAmount: -amount,
          productId: event.product_id,
          hallPasses,
          reason: markerApplied ? "missing-original-grant" : "already-reversed",
        };
      }
      const originalAmount = Math.max(0, Math.floor(Number(originalGrant.transaction.hallPasses ?? 0)));
      if (originalAmount <= 0) {
        return {
          applied: false,
          sessionId,
          amount: 0,
          requestedAmount: -amount,
          productId: event.product_id,
          hallPasses: ruby.hallPassBalance(sessionId),
          reason: "missing-original-grant",
        };
      }
      const input = {
        amount: originalAmount,
        idempotencyKey: revenueCatTransactionKey("reversal", originalGrant.transactionId),
        source: "revenuecat" as const,
        description: `${originalAmount} Ruby High Card${originalAmount === 1 ? "" : "s"} via RevenueCat`,
        at: event.event_timestamp_ms,
        metadata: {
          revenueCatEventId: event.id ?? null,
          revenueCatTransactionId: event.transaction_id ?? null,
          revenueCatOriginalTransactionId: event.original_transaction_id ?? null,
          revenueCatMatchedTransactionId: originalGrant.transactionId,
          productId: event.product_id ?? null,
          store: event.store ?? null,
          environment: event.environment ?? event.purchase_environment ?? null,
          cancelReason: event.cancel_reason ?? null,
          price: event.price ?? null,
          currency: event.currency ?? null,
        },
      };
      const result = ruby.revokeHallPasses(sessionId, input);
      await ruby.flushSession(sessionId);
      const requestedAmount = -originalAmount;
      const actualAmount = hallPassDeltaFromResult(result);
      return {
        applied: result.applied,
        sessionId,
        amount: actualAmount,
        ...(actualAmount !== requestedAmount ? { requestedAmount } : {}),
        productId: event.product_id,
        hallPasses: result.state.wallet.hallPasses,
      };
    }
    const input = {
      amount,
      idempotencyKey: revenueCatTransactionKey("grant", transactionId),
      source: "revenuecat" as const,
      description: `${amount} Ruby High Card${amount === 1 ? "" : "s"} via RevenueCat`,
      at: event.event_timestamp_ms,
      metadata: {
        revenueCatEventId: event.id ?? null,
        revenueCatTransactionId: event.transaction_id ?? null,
        revenueCatOriginalTransactionId: event.original_transaction_id ?? null,
        productId: event.product_id ?? null,
        store: event.store ?? null,
        environment: event.environment ?? event.purchase_environment ?? null,
        cancelReason: event.cancel_reason ?? null,
        price: event.price ?? null,
        currency: event.currency ?? null,
      },
    };
    const result = ruby.grantHallPasses(sessionId, input);
    await ruby.flushSession(sessionId);
    const requestedAmount = amount;
    const actualAmount = hallPassDeltaFromResult(result);
    return {
      applied: result.applied,
      sessionId,
      amount: actualAmount,
      ...(actualAmount !== requestedAmount ? { requestedAmount } : {}),
      productId: event.product_id,
      hallPasses: result.state.wallet.hallPasses,
    };
  }

  return { applied: false, sessionId, reason: "ignored-event-type" };
}

function optionalEntitlementsForRequest(ctx: RouteContext, deps: BillingDeps) {
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!token || !record) return hostedEntitlementStatus();
  return hostedEntitlementStatus({
    ruby: deps.ruby,
    sessionId: deps.auth.stateKeyForRecord(record),
  });
}

function authenticatedStateKey(ctx: RouteContext, deps: BillingDeps): string | null {
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!token || !record) return null;
  return deps.auth.stateKeyForRecord(record);
}

function hallPassBurnsFromBody(body: Record<string, unknown>): HallPassCardBurnInput[] {
  const rawBurns = Array.isArray(body.hallPassBurns)
    ? body.hallPassBurns
    : Array.isArray(body.burns)
      ? body.burns
      : [];
  return rawBurns.flatMap((raw): HallPassCardBurnInput[] => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;
    const cardId = typeof record.cardId === "string" ? record.cardId.trim() : "";
    const ownerWalletAddress = typeof record.ownerWalletAddress === "string" ? record.ownerWalletAddress.trim() : "";
    const mintAddress = typeof record.mintAddress === "string" ? record.mintAddress.trim() : "";
    const burnSignature = typeof record.burnSignature === "string" ? record.burnSignature.trim() : "";
    if (!cardId || !isBase58Address(ownerWalletAddress) || !isBase58Address(mintAddress) || !isSolanaSignature(burnSignature)) {
      return [];
    }
    return [{ cardId, ownerWalletAddress, mintAddress, burnSignature }];
  });
}

async function verifyHallPassBurns(burns: HallPassCardBurnInput[]): Promise<void> {
  for (const burn of burns) {
    await verifyHallPassCardBurn(burn);
  }
}

function hallPassBurnConversionKey(burns: HallPassCardBurnInput[]): string {
  const stable = burns
    .map((burn) => `${burn.cardId}:${burn.mintAddress}:${burn.burnSignature}`)
    .sort()
    .join("|");
  return `hall-pass-card-burn:${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

export async function handleBillingRoutes(ctx: RouteContext, deps: BillingDeps): Promise<boolean> {
  if (!ctx.pathname.startsWith(BILLING_PREFIX)) return false;

  if (ctx.method === "GET" && ctx.pathname === `${BILLING_PREFIX}/products`) {
    const entitlements = optionalEntitlementsForRequest(ctx, deps);
    const solana = solanaBillingConfig();
    const corePacks = publicCorePackNftStatus();
    ctx.json(ctx.res, {
      ok: true,
      configured: !!envTrim("RUBY_HIGH_STRIPE_SECRET_KEY"),
      currency: billingCurrency(),
      products: billingProducts(),
      solana: {
        configured: solana.configured && corePacks.configured,
        recipient: solana.recipient,
        mint: solana.mint,
        symbol: solana.symbol,
        decimals: solana.decimals,
        packNfts: corePacks,
        products: solana.products,
      },
      nfts: {
        ...publicHallPassNftStatus(),
        corePacks,
      },
      imageCosts: {
        portrait: hostedImageCost("portrait"),
        diploma: hostedImageCost("diploma"),
      },
      courseSlotCost: courseSlotCost(),
      questionGenerationCost: questionGenerationCost(),
      moreQuestionsCount: moreQuestionsCount(),
      cardBurn: {
        hallPassesPerCard: HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
      },
      hostedAiAccess: {
        configured: entitlements.hosted_ai.configured,
        cost: hostedAiAccessCost(),
        durationMs: hostedAiAccessDurationMs(),
        active: entitlements.hosted_ai.active,
        expiresAt: entitlements.hosted_ai.expiresAt,
        remainingMs: entitlements.hosted_ai.remainingMs,
      },
      entitlements,
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/solana/quote`) {
    const solana = solanaBillingConfig();
    if (!solana.configured) {
      ctx.error(ctx.res, "Solana card billing is not configured.", 503);
      return true;
    }
    const packNfts = publicCorePackNftStatus();
    if (!packNfts.configured) {
      ctx.error(ctx.res, packNfts.reason || "Pack NFT minting is not configured.", 503);
      return true;
    }
    const stateKey = authenticatedStateKey(ctx, deps);
    if (!stateKey) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const product = solanaProductById(typeof body.productId === "string" ? body.productId : "");
    if (!product) {
      ctx.error(ctx.res, "Unknown Solana card pack.", 400);
      return true;
    }
    const ownerWalletAddress = typeof body.ownerWalletAddress === "string" && isBase58Address(body.ownerWalletAddress.trim())
      ? body.ownerWalletAddress.trim()
      : "";
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before minting a pack.", 400);
      return true;
    }
    if (ownerWalletAddress === solana.recipient) {
      ctx.error(ctx.res, "Use a buyer wallet, not the Ruby High treasury wallet, to mint a pack.", 400);
      return true;
    }
    const reference = solanaPaymentReference(stateKey, product.id);
    let preparedTransaction;
    try {
      preparedTransaction = await buildCorePackPurchaseTransaction({
        productId: product.id,
        packCount: product.packCount,
        cardCount: product.cardCount,
        ownerWalletAddress,
        paymentReference: reference,
        tokenMint: solana.mint,
        tokenRecipient: solana.recipient,
        tokenAmount: product.tokenAmount,
        tokenAmountBaseUnits: product.tokenAmountBaseUnits,
        tokenDecimals: solana.decimals,
        tokenSymbol: solana.symbol,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("billing.solana.quote-failed", err, {
        sessionId: stateKey,
        productId: product.id,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, message, message.startsWith("Need ") ? 402 : 502);
      return true;
    }
    const { rpcUrl: _rpcUrl, ...publicPreparedTransaction } = preparedTransaction;
    ctx.json(ctx.res, {
      ok: true,
      product,
      ...publicPreparedTransaction,
      recipient: solana.recipient,
      mint: solana.mint,
      symbol: solana.symbol,
      decimals: solana.decimals,
      rpcHost: rpcHostForPublicStatus(solana.rpcUrl),
      reference,
      solanaPayUrl: solanaPayUrl(solana, product, reference),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/solana/submit`) {
    const solana = solanaBillingConfig();
    if (!solana.configured) {
      ctx.error(ctx.res, "Solana card billing is not configured.", 503);
      return true;
    }
    const packNfts = publicCorePackNftStatus();
    if (!packNfts.configured) {
      ctx.error(ctx.res, packNfts.reason || "Pack NFT minting is not configured.", 503);
      return true;
    }
    const stateKey = authenticatedStateKey(ctx, deps);
    if (!stateKey) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const product = solanaProductById(typeof body.productId === "string" ? body.productId : "");
    if (!product) {
      ctx.error(ctx.res, "Unknown Solana card pack.", 400);
      return true;
    }
    const ownerWalletAddress = typeof body.ownerWalletAddress === "string" && isBase58Address(body.ownerWalletAddress.trim())
      ? body.ownerWalletAddress.trim()
      : "";
    const packAssetAddress = typeof body.packAssetAddress === "string" && isBase58Address(body.packAssetAddress.trim())
      ? body.packAssetAddress.trim()
      : "";
    const signedTransactionBase64 = typeof body.signedTransactionBase64 === "string" ? body.signedTransactionBase64.trim() : "";
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Solana wallet address is required to submit the pack checkout.", 400);
      return true;
    }
    if (ownerWalletAddress === solana.recipient) {
      ctx.error(ctx.res, "Use a buyer wallet, not the Ruby High treasury wallet, to mint a pack.", 400);
      return true;
    }
    try {
      const reference = solanaPaymentReference(stateKey, product.id);
      requireSignedTransactionAccounts(signedTransactionBase64, [
        ownerWalletAddress,
        solana.recipient,
        solana.mint,
        reference,
      ]);
      const signature = await submitSignedSolanaTransaction(solana, signedTransactionBase64);
      ctx.json(ctx.res, { ok: true, signature });
      log.event("billing.solana.transaction-submitted", {
        sessionId: stateKey,
        productId: product.id,
        signature,
        ownerWalletAddress,
        ...(packAssetAddress ? { packAssetAddress } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("billing.solana.submit-failed", err, {
        sessionId: stateKey,
        productId: product.id,
        ownerWalletAddress,
        ...(packAssetAddress ? { packAssetAddress } : {}),
      });
      ctx.error(ctx.res, message, /rpc|blockhash|simulation|preflight|insufficient funds|Attempt to debit/i.test(message) ? 502 : 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/solana/confirm`) {
    const solana = solanaBillingConfig();
    if (!solana.configured) {
      ctx.error(ctx.res, "Solana card billing is not configured.", 503);
      return true;
    }
    const packNfts = publicCorePackNftStatus();
    if (!packNfts.configured) {
      ctx.error(ctx.res, packNfts.reason || "Pack NFT minting is not configured.", 503);
      return true;
    }
    const stateKey = authenticatedStateKey(ctx, deps);
    if (!stateKey) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const ownerWalletAddress = typeof body.ownerWalletAddress === "string" && isBase58Address(body.ownerWalletAddress.trim())
      ? body.ownerWalletAddress.trim()
      : "";
    const packAssetAddress = typeof body.packAssetAddress === "string" && isBase58Address(body.packAssetAddress.trim())
      ? body.packAssetAddress.trim()
      : "";
    const product = solanaProductById(typeof body.productId === "string" ? body.productId : "");
    if (!product) {
      ctx.error(ctx.res, "Unknown Solana card pack.", 400);
      return true;
    }
    if (!signature) {
      ctx.error(ctx.res, "Solana transaction signature is required.", 400);
      return true;
    }
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Solana wallet address is required to mint the pack NFT.", 400);
      return true;
    }
    const idempotencyKey = solanaTransactionKey(signature);
    const existing = deps.ruby.walletTransactionOwner(idempotencyKey);
    if (existing && existing.sessionId !== stateKey) {
      ctx.error(ctx.res, "Solana transaction has already been used for another Ruby High account.", 409);
      return true;
    }
    if (existing) {
      const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey });
      const existingPackAsset = typeof existing.transaction.metadata?.packAssetAddress === "string"
        ? existing.transaction.metadata.packAssetAddress
        : "";
      const existingPack = deps.ruby.hallPassPacks(stateKey).find((pack) => (
        pack.grantTransactionId === idempotencyKey || (!!existingPackAsset && pack.assetAddress === existingPackAsset)
      ));
      const existingCardCount = Math.max(0, Math.floor(Number(
        existing.transaction.metadata?.cardCount ?? existing.transaction.metadata?.hallPassCardCount ?? 0,
      )));
      const existingAmount = Math.max(0, Math.floor(Number(existing.transaction.hallPasses ?? 0))) || existingCardCount;
      ctx.json(ctx.res, {
        ok: true,
        applied: false,
        sessionId: stateKey,
        amount: existingAmount,
        hallPasses: entitlements.hallPasses,
        productId: existing.transaction.metadata?.hallPassPackId ?? product.id,
        packCount: product.packCount,
        cardCount: product.cardCount,
        packSerial: existingPack?.serial ?? existing.transaction.metadata?.packSerial ?? null,
        packAssetAddress: existing.transaction.metadata?.packAssetAddress ?? null,
        packMintSignature: existing.transaction.metadata?.packMintSignature ?? null,
        packRevealVersion: existingPack?.packRevealVersion ?? existing.transaction.metadata?.packRevealVersion ?? null,
        catalogHash: existingPack?.catalogHash ?? existing.transaction.metadata?.catalogHash ?? null,
        commitment: existingPack?.commitment ?? existing.transaction.metadata?.commitment ?? null,
        entropySource: existingPack?.entropySource ?? existing.transaction.metadata?.entropySource ?? null,
        tokenAmount: product.tokenAmount,
        tokenSymbol: solana.symbol,
        entitlements,
      });
      return true;
    }
    try {
      const verification = await verifySolanaPayment(solana, product, stateKey, signature);
      const packMint = await mintCorePackNft({
        productId: product.id,
        packCount: product.packCount,
        cardCount: product.cardCount,
        ownerWalletAddress,
        paymentSignature: signature,
      });
      const result = deps.ruby.recordHallPassPackMint(stateKey, {
        productId: product.id,
        packCount: product.packCount,
        cardCount: product.cardCount,
        ownerWalletAddress: packMint.ownerWalletAddress,
        assetAddress: packMint.assetAddress,
        mintSignature: packMint.mintSignature,
        metadataUri: packMint.metadataUri,
        idempotencyKey,
        source: "solana",
        description: `${product.packCount} Ruby High ${product.packCount === 1 ? "Pack" : "Packs"} via ${solana.symbol}`,
        metadata: {
          solanaSignature: signature,
          solanaMint: solana.mint,
          solanaRecipient: solana.recipient,
          solanaReference: verification.reference,
          solanaRequiredBaseUnits: product.tokenAmountBaseUnits,
          solanaReceivedBaseUnits: verification.receivedBaseUnits,
          solanaTokenAmount: product.tokenAmount,
          solanaTokenSymbol: solana.symbol,
          tokenDebitLabel: `-${product.tokenAmount} ${solana.symbol}`,
          assetCreditLabel: `+${product.packCount} ${product.packCount === 1 ? "Pack" : "Packs"}`,
          packCount: product.packCount,
          cardCount: product.cardCount,
          hallPassPackId: product.id,
          solanaPayer: ownerWalletAddress,
          ...(verification.slot != null ? { solanaSlot: verification.slot } : {}),
          ...(verification.blockTime != null ? { solanaBlockTime: verification.blockTime } : {}),
        },
      });
      await deps.ruby.flushSession(stateKey);
      const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey });
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        sessionId: stateKey,
        amount: product.cardCount,
        hallPasses: result.state.wallet.hallPasses,
        productId: product.id,
        packCount: product.packCount,
        cardCount: product.cardCount,
        packSerial: result.pack?.serial ?? null,
        packAssetAddress: packMint.assetAddress,
        packMintSignature: packMint.mintSignature,
        packMetadataUri: packMint.metadataUri,
        packRevealVersion: result.pack?.packRevealVersion ?? null,
        catalogHash: result.pack?.catalogHash ?? null,
        commitment: result.pack?.commitment ?? null,
        entropySource: result.pack?.entropySource ?? null,
        tokenAmount: product.tokenAmount,
        tokenSymbol: solana.symbol,
        entitlements,
      });
      log.event("billing.solana.pack-minted", {
        sessionId: stateKey,
        productId: product.id,
        signature,
        packAssetAddress: packMint.assetAddress,
        packCount: product.packCount,
        cardCount: product.cardCount,
        applied: result.applied,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("billing.solana.confirm-failed", err, {
        sessionId: stateKey,
        productId: product.id,
        signature,
        ownerWalletAddress,
        packAssetAddress,
      });
      const status = /not found on-chain yet|not found yet|try again after confirmation/i.test(message)
        ? 400
        : message.includes("too small")
        ? 402
        : /mint|nft|rpc|insufficient funds|Attempt to debit|forbidden|403/i.test(message)
          ? 502
          : 400;
      ctx.error(ctx.res, message, status);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${BILLING_PREFIX}/status`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey });
    ctx.json(ctx.res, {
      ok: true,
      hallPasses: entitlements.hallPasses,
      hosted_ai: entitlements.hosted_ai,
      entitlements,
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/welcome`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const result = deps.ruby.claimWelcomeHallPasses(stateKey);
    await deps.ruby.flushSession(stateKey);
    const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey, state: result.state });
    ctx.json(ctx.res, {
      ok: true,
      applied: result.applied,
      amount: WELCOME_HALL_PASS_GRANT,
      hallPasses: result.state.wallet.hallPasses,
      welcomeHallPassesGrantedAt: result.state.wallet.welcomeHallPassesGrantedAt ?? result.transaction.at,
      entitlements,
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/ai-pass`) {
    if (!hostedOpenRouterConfigured()) {
      ctx.error(ctx.res, "Hosted AI is not configured on this server.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const burns = hallPassBurnsFromBody(body);
    try {
      if (burns.length > 0) await verifyHallPassBurns(burns);
      const activation = deps.ruby.activateHostedAiAccess(stateKey, {
        hallPassCost: hostedAiAccessCost(),
        durationMs: hostedAiAccessDurationMs(),
        ...(burns.length > 0 ? { burns } : {}),
      });
      await deps.ruby.flushSession(stateKey);
      const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey });
      ctx.json(ctx.res, {
        ok: true,
        applied: activation.applied,
        hallPassCost: activation.hallPassCost,
        hallPasses: activation.state.wallet.hallPasses,
        expiresAt: activation.expiresAt,
        hosted_ai: entitlements.hosted_ai,
        entitlements,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error(ctx.res, message, message.startsWith("Not enough Cards") || message.startsWith("Not enough Hall Passes") ? 402 : 500);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/card-burn`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const burns = hallPassBurnsFromBody(body);
    if (burns.length <= 0) {
      ctx.error(ctx.res, "Burn at least one minted card for Hall Passes.", 400);
      return true;
    }
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 160)
      : hallPassBurnConversionKey(burns);
    const stateKey = deps.auth.stateKeyForRecord(record);
    try {
      await verifyHallPassBurns(burns);
      const hallPassCredit = burns.length * HALL_PASS_CARD_BURN_HALL_PASS_VALUE;
      const result = deps.ruby.convertBurnedHallPassCardsToHallPasses(stateKey, {
        burns,
        idempotencyKey,
        source: "hall-pass-card",
        description: `${burns.length} Card${burns.length === 1 ? "" : "s"} burned for ${hallPassCredit} Hall Pass${hallPassCredit === 1 ? "" : "es"}`,
      });
      await deps.ruby.flushSession(stateKey);
      const entitlements = hostedEntitlementStatus({ ruby: deps.ruby, sessionId: stateKey });
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        sessionId: stateKey,
        amount: hallPassCredit,
        hallPassesPerCard: HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
        hallPasses: result.state.wallet.hallPasses,
        burnedCards: result.cards?.map((card) => ({
          cardId: card.id,
          characterId: card.characterId,
          characterName: card.characterName,
          burnSignature: card.burnSignature,
        })) ?? [],
        entitlements,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error(ctx.res, message, /not found yet|confirmation|rpc/i.test(message) ? 502 : 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/checkout`) {
    const stripeKey = envTrim("RUBY_HIGH_STRIPE_SECRET_KEY");
    if (!stripeKey) {
      ctx.error(ctx.res, "Stripe billing is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const productId = typeof body.productId === "string" ? body.productId : "";
    const product = billingProducts().find((p) => p.id === productId);
    if (!product) {
      ctx.error(ctx.res, "Unknown Hall Pass product.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const successUrl = absoluteUrl(
      ctx,
      safeReturnPath(body.successUrl, `${APP_ROUTE_PREFIX}/viewer?billing=success`),
    );
    const cancelUrl = absoluteUrl(
      ctx,
      safeReturnPath(body.cancelUrl, `${APP_ROUTE_PREFIX}/viewer?billing=cancel`),
    );
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
    params.set("client_reference_id", stateKey);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", product.currency);
    params.set("line_items[0][price_data][unit_amount]", String(product.unitAmount));
    params.set("line_items[0][price_data][product_data][name]", product.name);
    params.set("line_items[0][price_data][product_data][description]", product.description);
    params.set("metadata[ruby_high_session_id]", stateKey);
    params.set("metadata[hall_pass_product_id]", product.id);
    params.set("metadata[hall_passes]", String(product.hallPasses));
    params.set("payment_intent_data[metadata][ruby_high_session_id]", stateKey);
    params.set("payment_intent_data[metadata][hall_pass_product_id]", product.id);
    params.set("payment_intent_data[metadata][hall_passes]", String(product.hallPasses));

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : `Stripe checkout failed with ${response.status}.`;
      ctx.error(ctx.res, message, 502);
      return true;
    }
    const url = typeof payload.url === "string" ? payload.url : "";
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!url) {
      ctx.error(ctx.res, "Stripe did not return a checkout URL.", 502);
      return true;
    }
    ctx.json(ctx.res, { ok: true, id, url });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/stripe/webhook`) {
    const webhookSecret = envTrim("RUBY_HIGH_STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      ctx.error(ctx.res, "Stripe webhook is not configured.", 503);
      return true;
    }
    if (!ctx.readRawBody) {
      ctx.error(ctx.res, "Raw webhook body is unavailable.", 500);
      return true;
    }
    const rawBody = await ctx.readRawBody();
    const signature = firstHeader(ctx.stripeSignatureHeader);
    try {
      verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      return true;
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      ctx.error(ctx.res, "Invalid Stripe webhook JSON.", 400);
      return true;
    }
    const session = event.data?.object;
    if (
      session &&
      (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded")
    ) {
      if (session.payment_status !== "paid") {
        ctx.json(ctx.res, { received: true, applied: false, reason: "payment-not-paid" });
        return true;
      }
      try {
        const grant = fulfillStripeCheckout(deps.ruby, session);
        await deps.ruby.flushSession(grant.sessionId);
        const state = deps.ruby.getOrCreate(grant.sessionId);
        ctx.json(ctx.res, {
          received: true,
          applied: grant.applied,
          hallPasses: state.wallet.hallPasses,
          productId: grant.productId,
          amount: grant.amount,
          packCount: grant.packCount,
          cardCount: grant.cardCount,
        });
      } catch (err) {
        ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
      }
      return true;
    }
    ctx.json(ctx.res, { received: true, applied: false });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${BILLING_PREFIX}/revenuecat/webhook`) {
    try {
      assertRevenueCatWebhookAuth(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error(ctx.res, message, message.includes("not configured") ? 503 : 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => null)) as RevenueCatWebhookPayload | null;
    const event = body?.event;
    if (!event || typeof event !== "object") {
      ctx.error(ctx.res, "Invalid RevenueCat webhook JSON.", 400);
      return true;
    }
    try {
      const result = await fulfillRevenueCatWebhook(deps.ruby, event);
      ctx.json(ctx.res, { received: true, ...result });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 400);
    }
    return true;
  }

  return false;
}
