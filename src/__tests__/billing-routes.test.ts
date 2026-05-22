import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBillingRoutes } from "../routes/billing.js";
import type { RouteContext } from "../routes/context.js";
import { AuthService } from "../services/auth-service.js";
import {
  type CorePackPurchaseTransactionInput,
  type CorePackPurchaseTransactionResult,
  deterministicCorePackMintForTest,
  setCorePackNftMinterForTest,
  setCorePackPurchaseTransactionBuilderForTest,
} from "../services/core-pack-nfts.js";
import { setHallPassNftBurnVerifierForTest } from "../services/hall-pass-nfts.js";
import { RubyHighService, WELCOME_HALL_PASS_GRANT } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack } from "../content/registry.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;

const ORIGINAL_ENV = {
  RUBY_HIGH_STRIPE_SECRET_KEY: process.env.RUBY_HIGH_STRIPE_SECRET_KEY,
  RUBY_HIGH_STRIPE_WEBHOOK_SECRET: process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET,
  RUBY_HIGH_OPENROUTER_API_KEY: process.env.RUBY_HIGH_OPENROUTER_API_KEY,
  RUBY_HIGH_HOSTED_AI_HALL_PASS_COST: process.env.RUBY_HIGH_HOSTED_AI_HALL_PASS_COST,
  RUBY_HIGH_HOSTED_AI_DURATION_MS: process.env.RUBY_HIGH_HOSTED_AI_DURATION_MS,
  RUBY_HIGH_HOSTED_AI_DURATION_HOURS: process.env.RUBY_HIGH_HOSTED_AI_DURATION_HOURS,
  RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH: process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH,
  RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE: process.env.RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE,
  RUBY_HIGH_PRIVY_APP_ID: process.env.RUBY_HIGH_PRIVY_APP_ID,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
  RUBY_HIGH_SOLANA_MEMECOIN_MINT: process.env.RUBY_HIGH_SOLANA_MEMECOIN_MINT,
  RUBY_HIGH_SOLANA_TREASURY_OWNER: process.env.RUBY_HIGH_SOLANA_TREASURY_OWNER,
  RUBY_HIGH_SOLANA_MEMECOIN_SYMBOL: process.env.RUBY_HIGH_SOLANA_MEMECOIN_SYMBOL,
  RUBY_HIGH_SOLANA_MEMECOIN_DECIMALS: process.env.RUBY_HIGH_SOLANA_MEMECOIN_DECIMALS,
  RUBY_HIGH_SOLANA_HALL_PASS_5_TOKENS: process.env.RUBY_HIGH_SOLANA_HALL_PASS_5_TOKENS,
  RUBY_HIGH_SOLANA_HALL_PASS_20_TOKENS: process.env.RUBY_HIGH_SOLANA_HALL_PASS_20_TOKENS,
  RUBY_HIGH_SOLANA_HALL_PASS_50_TOKENS: process.env.RUBY_HIGH_SOLANA_HALL_PASS_50_TOKENS,
  RUBY_HIGH_SOLANA_HALL_PASS_100_TOKENS: process.env.RUBY_HIGH_SOLANA_HALL_PASS_100_TOKENS,
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
};

let restoreCorePackMinter: (() => void) | null = null;
let restoreCorePackPurchaseBuilder: (() => void) | null = null;
let restoreHallPassBurnVerifier: (() => void) | null = null;
const TEST_SOLANA_OWNER = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
const TEST_PACK_ASSET = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
const TEST_SOURCE_TOKEN_ACCOUNT = "FNhC7aog7542La3isBvGF5fd1myzahUwAyUWfoNNHhYV";
const TEST_DESTINATION_TOKEN_ACCOUNT = "3brqp4DSMX92bCRhSDYNowFr1zGbcR7DVA5jMdUKiwyh";

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  body?: any;
  rawBody?: string;
  stripeSignature?: string;
  authorization?: string;
}): RouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    url: new URL(`http://localhost:3000${opts.path}`),
    runtime: null,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    stripeSignatureHeader: opts.stripeSignature ?? null,
    authorizationHeader: opts.authorization ?? null,
    callbackUrlBuilder: (path) => `http://localhost:3000${path}`,
    error: (_res, message, status = 500) => { lastResponse = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { lastResponse = { status, body: data }; },
    readJsonBody: async () => opts.body ?? {},
    readRawBody: async () => opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  };
}

function deps() {
  return { auth, ruby };
}

function signInUser(token: string): string {
  const userId = `billing-${token}`;
  const now = Date.now();
  auth.injectSessionForTest(token, {
    userId,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  });
  return `rh:user:${userId}`;
}

function emptyWelcomeHallPasses(stateKey: string): void {
  expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
}

function stripeSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function stubCorePackPurchaseBuilderForTest(opts: {
  expected?: Partial<CorePackPurchaseTransactionInput>;
  assetAddress?: string;
  metadataUri?: string;
  rpcUrl?: string;
} = {}): void {
  restoreCorePackPurchaseBuilder = setCorePackPurchaseTransactionBuilderForTest(async (input): Promise<CorePackPurchaseTransactionResult> => {
    if (opts.expected) expect(input).toMatchObject(opts.expected);
    return {
      ownerWalletAddress: input.ownerWalletAddress,
      ...(opts.assetAddress ? { assetAddress: opts.assetAddress } : {}),
      ...(opts.metadataUri ? { metadataUri: opts.metadataUri } : {}),
      sourceTokenAccountAddress: TEST_SOURCE_TOKEN_ACCOUNT,
      destinationTokenAccountAddress: TEST_DESTINATION_TOKEN_ACCOUNT,
      transactionBase64: "AQID",
      transactionEncoding: "base64",
      chain: "solana:mainnet",
      rpcUrl: opts.rpcUrl ?? process.env.RUBY_HIGH_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    };
  });
}

function signedCheckoutTransactionForTest(input: {
  ownerWalletAddress: string;
  recipient: string;
  mint: string;
  reference: string;
}): string {
  const owner = new PublicKey(input.ownerWalletAddress);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: "11111111111111111111111111111111",
  });
  transaction.add(new TransactionInstruction({
    programId: new PublicKey("11111111111111111111111111111111"),
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(input.recipient), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  }));
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

beforeEach(async () => {
  restoreEnv();
  delete process.env.RUBY_HIGH_STRIPE_SECRET_KEY;
  delete process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET;
  delete process.env.RUBY_HIGH_OPENROUTER_API_KEY;
  delete process.env.RUBY_HIGH_HOSTED_AI_HALL_PASS_COST;
  delete process.env.RUBY_HIGH_HOSTED_AI_DURATION_MS;
  delete process.env.RUBY_HIGH_HOSTED_AI_DURATION_HOURS;
  delete process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH;
  delete process.env.RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE;
  delete process.env.RUBY_HIGH_PRIVY_APP_ID;
  delete process.env.RUBY_HIGH_SOLANA_RPC_URL;
  delete process.env.RUBY_HIGH_SOLANA_MEMECOIN_MINT;
  delete process.env.RUBY_HIGH_SOLANA_TREASURY_OWNER;
  delete process.env.RUBY_HIGH_SOLANA_MEMECOIN_SYMBOL;
  delete process.env.RUBY_HIGH_SOLANA_MEMECOIN_DECIMALS;
  delete process.env.RUBY_HIGH_SOLANA_HALL_PASS_5_TOKENS;
  delete process.env.RUBY_HIGH_SOLANA_HALL_PASS_20_TOKENS;
  delete process.env.RUBY_HIGH_SOLANA_HALL_PASS_50_TOKENS;
  delete process.env.RUBY_HIGH_SOLANA_HALL_PASS_100_TOKENS;
  process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
  process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
  restoreCorePackMinter = setCorePackNftMinterForTest(async (input) => deterministicCorePackMintForTest(input));
  restoreHallPassBurnVerifier = setHallPassNftBurnVerifierForTest(async (burn) => ({
    signature: burn.burnSignature,
    ownerWalletAddress: burn.ownerWalletAddress,
    mintAddress: burn.mintAddress,
    slot: 123,
  }));
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-billing-routes-"));
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
});

afterEach(async () => {
  restoreEnv();
  if (restoreCorePackMinter) restoreCorePackMinter();
  if (restoreCorePackPurchaseBuilder) restoreCorePackPurchaseBuilder();
  if (restoreHallPassBurnVerifier) restoreHallPassBurnVerifier();
  restoreCorePackMinter = null;
  restoreCorePackPurchaseBuilder = null;
  restoreHallPassBurnVerifier = null;
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("billing products", () => {
  it("returns the configured Ruby High packs and image costs", async () => {
    const handled = await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.configured).toBe(false);
    expect(lastResponse?.body.products.map((p: any) => [p.id, p.packCount, p.cardCount, p.hallPasses])).toEqual([
      ["hall-pass-5", 0, 0, 5],
      ["hall-pass-20", 0, 0, 20],
      ["hall-pass-50", 0, 0, 50],
      ["hall-pass-100", 0, 0, 100],
    ]);
    expect(lastResponse?.body.solana).toMatchObject({
      configured: true,
      mint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      recipient: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      symbol: "RUBY",
      decimals: 6,
    });
    expect(lastResponse?.body.solana.products.map((p: any) => [p.packCount, p.cardCount, p.hallPasses, p.tokenAmount])).toEqual([
      [1, 5, 5, "1000000"],
      [3, 15, 15, "3000000"],
      [5, 25, 25, "5000000"],
      [10, 50, 50, "10000000"],
    ]);
    expect(lastResponse?.body.imageCosts).toEqual({ portrait: 1, diploma: 3 });
    expect(lastResponse?.body.courseSlotCost).toBe(3);
    expect(lastResponse?.body.questionGenerationCost).toBe(1);
    expect(lastResponse?.body.moreQuestionsCount).toBe(6);
    expect(lastResponse?.body.cardBurn).toEqual({ hallPassesPerCard: 5 });
    expect(lastResponse?.body.hostedAiAccess).toMatchObject({ configured: false, cost: 1, durationMs: 604_800_000 });
    expect(lastResponse?.body.entitlements).toMatchObject({
      hallPasses: 0,
      hosted_ai: { configured: false, active: false, affordable: false, canActivate: false },
      hosted_images: {
        portrait: { configured: false, cost: 1, affordable: false, canUseHosted: false },
        diploma: { configured: false, cost: 3, affordable: false, canUseHosted: false },
      },
      creator: { courseSlotCost: 3, questionGenerationCost: 1, moreQuestionsCount: 6 },
    });
  });

  it("returns session entitlement status with billing products when authenticated", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const stateKey = signInUser("products-entitlements");
    ruby.grantHallPasses(stateKey, {
      amount: 2,
      idempotencyKey: "test:products-entitlements",
      source: "admin",
    });

    const handled = await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
      cookie: "rh_session=products-entitlements",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.entitlements).toMatchObject({
      hallPasses: 2,
      hosted_ai: { configured: true, active: false, affordable: true, canActivate: true, cost: 1 },
      hosted_images: {
        portrait: { configured: true, cost: 1, affordable: true, canUseHosted: true },
        diploma: { configured: true, cost: 3, affordable: false, canUseHosted: false },
      },
      creator: { courseSlotCost: 3, questionGenerationCost: 1, moreQuestionsCount: 6 },
    });
    expect(lastResponse?.body.hostedAiAccess).toMatchObject({ configured: true, active: false, cost: 1 });
  });

  it("claims the welcome Hall Pass grant from the Hall Pass page once", async () => {
    const stateKey = signInUser("welcome-claim");
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/welcome",
      cookie: "rh_session=welcome-claim",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: true,
        amount: WELCOME_HALL_PASS_GRANT,
        hallPasses: WELCOME_HALL_PASS_GRANT,
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/welcome",
      cookie: "rh_session=welcome-claim",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: false,
        amount: WELCOME_HALL_PASS_GRANT,
        hallPasses: WELCOME_HALL_PASS_GRANT,
      },
    });
  });
});

describe("AI Access", () => {
  it("spends one Hall Pass to enable hosted AI for one week", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const stateKey = signInUser("ai-pass-alice");
    ruby.grantHallPasses(stateKey, {
      amount: 2,
      idempotencyKey: "test:seed-ai-pass",
      source: "admin",
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/ai-pass",
      cookie: "rh_session=ai-pass-alice",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({ ok: true, applied: true, hallPassCost: 1, hallPasses: 1 });
    expect(lastResponse?.body.entitlements).toMatchObject({
      hallPasses: 1,
      hosted_ai: { configured: true, active: true, affordable: true, canActivate: false },
      hosted_images: {
        portrait: { configured: true, affordable: true },
        diploma: { configured: true, affordable: false },
      },
    });
    const firstExpiry = Number(lastResponse?.body.expiresAt);
    expect(firstExpiry).toBeGreaterThan(Date.now());
    expect(ruby.getOrCreate(stateKey).wallet.hostedAiAccessExpiresAt).toBe(firstExpiry);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/ai-pass",
      cookie: "rh_session=ai-pass-alice",
    }), deps());

    expect(lastResponse?.body).toMatchObject({ ok: true, applied: false, hallPassCost: 1, hallPasses: 1 });
    expect(lastResponse?.body.hosted_ai).toMatchObject({ configured: true, active: true });
    expect(lastResponse?.body.expiresAt).toBe(firstExpiry);
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(1);
  });

  it("returns authenticated hosted entitlement status", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const stateKey = signInUser("status-alice");
    ruby.grantHallPasses(stateKey, {
      amount: 3,
      idempotencyKey: "test:status-alice",
      source: "admin",
    });

    const handled = await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/status",
      cookie: "rh_session=status-alice",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      ok: true,
      hallPasses: 3,
      hosted_ai: { configured: true, active: false, affordable: true, canActivate: true },
      entitlements: {
        hallPasses: 3,
        hosted_images: {
          portrait: { canUseHosted: true },
          diploma: { canUseHosted: true },
        },
      },
    });
  });

  it("rejects hosted AI activation without enough Hall Passes", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const stateKey = signInUser("ai-pass-empty");
    emptyWelcomeHallPasses(stateKey);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/ai-pass",
      cookie: "rh_session=ai-pass-empty",
    }), deps());

    expect(lastResponse?.status).toBe(402);
    expect(lastResponse?.body.error).toContain("Not enough Hall Passes");
  });
});

describe("Stripe Checkout", () => {
  it("creates a Checkout Session with Ruby High fulfillment metadata", async () => {
    process.env.RUBY_HIGH_STRIPE_SECRET_KEY = "sk_test_ruby";
    const stateKey = signInUser("alice");
    let capturedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.test/pay" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const handled = await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/checkout",
      cookie: "rh_session=alice",
      body: { productId: "hall-pass-50" },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({ status: 200, body: { ok: true, url: "https://checkout.stripe.test/pay" } });
    const params = new URLSearchParams(capturedBody);
    expect(params.get("client_reference_id")).toBe(stateKey);
    expect(params.get("metadata[ruby_high_session_id]")).toBe(stateKey);
    expect(params.get("metadata[hall_pass_product_id]")).toBe("hall-pass-50");
    expect(params.get("metadata[card_pack_id]")).toBeNull();
    expect(params.get("metadata[pack_count]")).toBeNull();
    expect(params.get("metadata[card_count]")).toBeNull();
    expect(params.get("metadata[hall_passes]")).toBe("50");
    expect(params.get("payment_intent_data[metadata][ruby_high_session_id]")).toBe(stateKey);
    expect(params.get("payment_intent_data[metadata][hall_pass_product_id]")).toBe("hall-pass-50");
    expect(params.get("payment_intent_data[metadata][card_pack_id]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][pack_count]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][card_count]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][hall_passes]")).toBe("50");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("1499");
  });
});

describe("Stripe webhook", () => {
  it("grants Hall Passes idempotently after a paid Checkout Session", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-alice";
    const rawBody = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_paid_1",
          payment_status: "paid",
          client_reference_id: stateKey,
          amount_total: 1499,
          currency: "usd",
          metadata: {
            ruby_high_session_id: stateKey,
            hall_pass_product_id: "hall-pass-50",
            hall_passes: "50",
          },
        },
      },
    });
    const signature = stripeSignature(rawBody, "whsec_ruby");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/stripe/webhook",
      rawBody,
      stripeSignature: signature,
    }), deps());

    expect(lastResponse).toMatchObject({ status: 200, body: { received: true, applied: true, hallPasses: 50, amount: 50 } });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(50);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.grantTransactionId === "stripe:checkout:cs_paid_1") ?? []).toHaveLength(0);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/stripe/webhook",
      rawBody,
      stripeSignature: signature,
    }), deps());

    expect(lastResponse).toMatchObject({ status: 200, body: { received: true, applied: false, hallPasses: 50, amount: 50 } });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(50);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.grantTransactionId === "stripe:checkout:cs_paid_1") ?? []).toHaveLength(0);
  });

  it("rejects signed Checkout webhooks when pack metadata does not match the paid amount", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-tampered";
    const rawBody = JSON.stringify({
      id: "evt_tampered",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tampered",
          payment_status: "paid",
          client_reference_id: stateKey,
          amount_total: 199,
          currency: "usd",
          metadata: {
            ruby_high_session_id: stateKey,
            card_pack_id: "card-pack-5",
            pack_count: "5",
            card_count: "25",
            hall_pass_pack_id: "card-pack-5",
            hall_passes: "25",
          },
        },
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/stripe/webhook",
      rawBody,
      stripeSignature: stripeSignature(rawBody, "whsec_ruby"),
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("amount does not match");
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
  });

  it("rejects invalid Stripe signatures without mutating a wallet", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:bad-signature";
    const rawBody = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bad",
          payment_status: "paid",
          client_reference_id: stateKey,
          metadata: { ruby_high_session_id: stateKey, hall_passes: "100" },
        },
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/stripe/webhook",
      rawBody,
      stripeSignature: "t=123,v1=bad",
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
  });
});

describe("card burn Hall Pass conversion", () => {
  it("credits five Hall Passes per owner-signed card burn", async () => {
    const stateKey = signInUser("card-burn-credit");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 2,
      idempotencyKey: "solana:pack:test-card-burn-credit",
      source: "solana",
    });
    const card = grant.cards![0]!;
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    ruby.recordHallPassCardMint(stateKey, {
      cardId: card.id,
      ownerWalletAddress: TEST_SOLANA_OWNER,
      mintAddress,
      mintSignature: "5mMintSignature111111111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/card-burn",
      cookie: "rh_session=card-burn-credit",
      body: {
        hallPassBurns: [{
          cardId: card.id,
          ownerWalletAddress: TEST_SOLANA_OWNER,
          mintAddress,
          burnSignature: "44444444444444444444444444444444444444444444444444444444444444444444",
        }],
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: true,
        amount: 5,
        hallPassesPerCard: 5,
        hallPasses: 5,
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.find((candidate) => candidate.id === card.id)).toMatchObject({
      status: "redeemed",
      redeemTransactionId: expect.stringMatching(/^hall-pass-card-burn:/),
    });
  });
});

describe("Solana Hall Pass billing", () => {
  it("requires a connected Solana wallet before quoting a pack NFT checkout", async () => {
    signInUser("solana-quote-no-wallet");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote-no-wallet",
      body: { productId: "card-pack-1" },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("Connect a Solana wallet");
  });

  it("rejects using the Ruby High treasury wallet as the pack buyer", async () => {
    signInUser("solana-quote-treasury-wallet");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote-treasury-wallet",
      body: { productId: "card-pack-1", ownerWalletAddress: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY" },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("buyer wallet");
  });

  it("quotes every pack at 100,000 $RUBY with a session payment reference", async () => {
    const stateKey = signInUser("solana-quote");
    stubCorePackPurchaseBuilderForTest({
      expected: {
        productId: "card-pack-5",
        packCount: 5,
        cardCount: 25,
        ownerWalletAddress: TEST_SOLANA_OWNER,
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote",
      body: { productId: "card-pack-5", ownerWalletAddress: TEST_SOLANA_OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      ok: true,
      recipient: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      mint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      symbol: "RUBY",
      decimals: 6,
      rpcHost: "api.mainnet-beta.solana.com",
      product: {
        id: "card-pack-5",
        packCount: 5,
        cardCount: 25,
        hallPasses: 25,
        tokenAmount: "5000000",
        tokenAmountBaseUnits: "5000000000000",
        tokenSymbol: "RUBY",
      },
      ownerWalletAddress: TEST_SOLANA_OWNER,
    });
    expect(lastResponse?.body.reference).toEqual(expect.any(String));
    expect(lastResponse?.body.reference).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(lastResponse?.body.solanaPayUrl).toContain("solana:1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY?");
    expect(lastResponse?.body.solanaPayUrl).toContain("spl-token=ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump");
    expect(lastResponse?.body.solanaPayUrl).toContain(`reference=${lastResponse?.body.reference}`);
    expect(lastResponse?.body.transactionBase64).toBe("AQID");
    expect(lastResponse?.body.assetAddress).toBeUndefined();
    expect(lastResponse?.body.metadataUri).toBeUndefined();
    expect(lastResponse?.body.rpcUrl).toBeUndefined();
    expect(stateKey).toBe("rh:user:billing-solana-quote");
  });

  it("uses Privy's Solana RPC for browser payment prep when Privy is configured", async () => {
    process.env.RUBY_HIGH_PRIVY_APP_ID = "privy-app-test";
    signInUser("solana-quote-privy-rpc");
    stubCorePackPurchaseBuilderForTest({
      expected: {
        productId: "card-pack-10",
        ownerWalletAddress: TEST_SOLANA_OWNER,
      },
      rpcUrl: "https://solana-mainnet.rpc.privy.systems?privyAppId=privy-app-test",
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote-privy-rpc",
      body: { productId: "card-pack-10", ownerWalletAddress: TEST_SOLANA_OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.rpcHost).toBe("solana-mainnet.rpc.privy.systems");
    expect(lastResponse?.body.rpcUrl).toBeUndefined();
  });

  it("prepares a wallet-only token payment when a Solana wallet is supplied", async () => {
    const ownerWalletAddress = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
    restoreCorePackPurchaseBuilder = setCorePackPurchaseTransactionBuilderForTest(async (input) => {
      expect(input).toMatchObject({
        productId: "card-pack-1",
        packCount: 1,
        cardCount: 5,
        ownerWalletAddress,
        tokenMint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        tokenRecipient: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
        tokenAmount: "1000000",
        tokenAmountBaseUnits: "1000000000000",
        tokenDecimals: 6,
        tokenSymbol: "RUBY",
      });
      expect(input.paymentReference).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      return {
        ownerWalletAddress,
        sourceTokenAccountAddress: "FNhC7aog7542La3isBvGF5fd1myzahUwAyUWfoNNHhYV",
        destinationTokenAccountAddress: "3brqp4DSMX92bCRhSDYNowFr1zGbcR7DVA5jMdUKiwyh",
        transactionBase64: "AQID",
        transactionEncoding: "base64",
        chain: "solana:mainnet",
        rpcUrl: "https://api.mainnet-beta.solana.com",
      };
    });
    signInUser("solana-quote-prepared");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote-prepared",
      body: { productId: "card-pack-1", ownerWalletAddress },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      ok: true,
      ownerWalletAddress,
      transactionBase64: "AQID",
      transactionEncoding: "base64",
      chain: "solana:mainnet",
    });
    expect(lastResponse?.body.assetAddress).toBeUndefined();
  });

  it("submits a wallet-signed pack transaction through the configured Solana RPC", async () => {
    signInUser("solana-submit-signed");
    stubCorePackPurchaseBuilderForTest();
    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-submit-signed",
      body: { productId: "card-pack-1", ownerWalletAddress: TEST_SOLANA_OWNER },
    }), deps());
    const reference = String(lastResponse?.body.reference ?? "");
    const signature = "4".repeat(88);
    const signedTransactionBase64 = signedCheckoutTransactionForTest({
      ownerWalletAddress: TEST_SOLANA_OWNER,
      recipient: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      mint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      reference,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      expect(payload.method).toBe("sendTransaction");
      expect(payload.params[0]).toBe(signedTransactionBase64);
      expect(payload.params[1]).toMatchObject({
        encoding: "base64",
        maxRetries: 5,
        preflightCommitment: "confirmed",
      });
      if (payload.params[1].skipPreflight === false) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: "ruby-high-solana-submit",
          error: { code: -32010, message: "Invalid Request: running preflight check is not supported" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(payload.params[1].skipPreflight).toBe(true);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "ruby-high-solana-submit",
        result: signature,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/submit",
      cookie: "rh_session=solana-submit-signed",
      body: {
        productId: "card-pack-1",
        ownerWalletAddress: TEST_SOLANA_OWNER,
        signedTransactionBase64,
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { ok: true, signature },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects Solana confirmations that are missing the connected wallet", async () => {
    signInUser("solana-paid");
    const signature = "2".repeat(88);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-paid",
      body: { productId: "card-pack-5", signature },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("Solana wallet address");
  });

  it("records a server-minted Pack NFT after verifying the payment transaction", async () => {
    const stateKey = signInUser("solana-server-mint-paid");
    const ownerWalletAddress = TEST_SOLANA_OWNER;
    const packAssetAddress = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const packMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-3/456789.json?packs=3&cards=15";
    const packMintSignature = "6".repeat(88);
    stubCorePackPurchaseBuilderForTest({
      expected: {
        productId: "card-pack-3",
        ownerWalletAddress,
      },
    });
    restoreCorePackMinter?.();
    restoreCorePackMinter = setCorePackNftMinterForTest(async (input) => {
      expect(input).toMatchObject({
        productId: "card-pack-3",
        packCount: 3,
        cardCount: 15,
        ownerWalletAddress,
      });
      return {
        ownerWalletAddress,
        assetAddress: packAssetAddress,
        mintSignature: packMintSignature,
        metadataUri: packMetadataUri,
      };
    });
    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-server-mint-paid",
      body: { productId: "card-pack-3", ownerWalletAddress },
    }), deps());
    const reference = lastResponse?.body.reference;
    const signature = "5".repeat(88);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-solana-billing",
      result: {
        slot: 456,
        blockTime: 1_775_000_111,
        meta: {
          err: null,
          preTokenBalances: [
            {
              accountIndex: 3,
              mint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
              owner: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
              uiTokenAmount: { amount: "0", decimals: 6 },
            },
          ],
          postTokenBalances: [
            {
              accountIndex: 3,
              mint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
              owner: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
              uiTokenAmount: { amount: "3000000000000", decimals: 6 },
            },
          ],
        },
        transaction: {
          signatures: [signature],
          message: { accountKeys: [{ pubkey: reference }] },
        },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-server-mint-paid",
      body: {
        productId: "card-pack-3",
        signature,
        ownerWalletAddress,
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: true,
        sessionId: stateKey,
        amount: 15,
        productId: "card-pack-3",
        packCount: 3,
        cardCount: 15,
        packSerial: 456789,
        packAssetAddress,
        packMintSignature,
        packMetadataUri,
        packRevealVersion: "ruby-high-pack-reveal-v1.1",
        catalogHash: expect.any(String),
        commitment: expect.any(String),
        entropySource: "ruby-high-server-commit-v1",
        tokenAmount: "3000000",
        tokenSymbol: "RUBY",
      },
    });
    expect(ruby.walletTransaction(stateKey, `solana:spl-token-transfer:${signature}`)).toMatchObject({
      source: "solana",
      metadata: {
        packAssetAddress,
        packMintSignature,
        packMetadataUri,
        packSerial: 456789,
        packRevealVersion: "ruby-high-pack-reveal-v1.1",
        catalogHash: expect.any(String),
        commitment: expect.any(String),
        entropySource: "ruby-high-server-commit-v1",
        solanaReference: reference,
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-server-mint-paid",
      body: {
        productId: "card-pack-3",
        signature,
        ownerWalletAddress,
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { ok: true, applied: false, sessionId: stateKey, amount: 15, hallPasses: 0 },
    });
  });

  it("rejects a transaction that is missing the quoted payment reference", async () => {
    signInUser("solana-wrong-ref");
    const signature = "3".repeat(88);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-solana-billing",
      result: {
        meta: {
          err: null,
          preTokenBalances: [],
          postTokenBalances: [],
        },
        transaction: {
          signatures: [signature],
          message: { accountKeys: [{ pubkey: "11111111111111111111111111111111" }] },
        },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-wrong-ref",
      body: { productId: "card-pack-5", signature, ownerWalletAddress: TEST_SOLANA_OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("payment reference");
    expect(ruby.getOrCreate("rh:user:billing-solana-wrong-ref").wallet.hallPasses).toBe(0);
  });
});

describe("RevenueCat webhook", () => {
  it("rejects missing webhook authorization", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      body: { event: { type: "TEST" } },
    }), deps());

    expect(lastResponse?.status).toBe(401);
    expect(lastResponse?.body.error).toContain("Unauthorized RevenueCat webhook");
  });

  it("grants Hall Passes from non-renewing consumable purchases idempotently", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "rc-secret";
    const body = {
      api_version: "1.0",
      event: {
        id: "evt_rc_1",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: "rh:user:rc-alice",
        product_id: "hall_pass_20",
        transaction_id: "tx_rc_20",
        store: "APP_STORE",
        environment: "PRODUCTION",
        event_timestamp_ms: 1_765_000_000_000,
      },
    };

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body,
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { received: true, applied: true, sessionId: "rh:user:rc-alice", amount: 20, hallPasses: 20 },
    });
    expect(ruby.getOrCreate("rh:user:rc-alice").wallet.hallPasses).toBe(20);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body,
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { received: true, applied: false, sessionId: "rh:user:rc-alice", amount: 20, hallPasses: 20 },
    });
    expect(ruby.getOrCreate("rh:user:rc-alice").wallet.hallPasses).toBe(20);
  });

  it("reverses Hall Passes only for a matching RevenueCat purchase", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    const stateKey = "rh:user:rc-refund";

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_refund_purchase",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: stateKey,
          product_id: "hall_pass_20",
          transaction_id: "tx_rc_refund_20",
          store: "PLAY_STORE",
          environment: "PRODUCTION",
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { received: true, applied: true, sessionId: stateKey, amount: 20, hallPasses: 20 },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_refund",
          type: "CANCELLATION",
          app_user_id: stateKey,
          product_id: "hall_pass_20",
          transaction_id: "tx_rc_refund_20",
          cancel_reason: "CUSTOMER_SUPPORT",
          store: "PLAY_STORE",
          environment: "PRODUCTION",
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { received: true, applied: true, sessionId: stateKey, amount: -20, hallPasses: 0 },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
  });

  it("does not debit unrelated Hall Passes for an unmatched RevenueCat cancellation", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    const stateKey = "rh:user:rc-orphan-refund";
    ruby.grantHallPasses(stateKey, {
      amount: 5,
      idempotencyKey: "test:orphan-refund-unrelated-balance",
      source: "admin",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(5);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_orphan_refund",
          type: "CANCELLATION",
          app_user_id: stateKey,
          product_id: "hall_pass_20",
          transaction_id: "tx_rc_orphan_refund_20",
          cancel_reason: "CUSTOMER_SUPPORT",
          store: "PLAY_STORE",
          environment: "PRODUCTION",
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        received: true,
        applied: false,
        sessionId: stateKey,
        amount: 0,
        requestedAmount: -20,
        hallPasses: 5,
        reason: "missing-original-grant",
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(5);
    expect(ruby.walletTransaction(stateKey, "revenuecat:reversal:tx_rc_orphan_refund_20:HLP")).toMatchObject({
      kind: "hall-pass-revoke",
      hallPasses: 0,
    });
    expect(ruby.getOrCreate(stateKey).wallet.transactions ?? []).not.toContainEqual(expect.objectContaining({
      id: "revenuecat:reversal:tx_rc_orphan_refund_20:HLP",
    }));
  });

  it("does not grant a RevenueCat purchase after a refund marker for the same transaction", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    const stateKey = "rh:user:rc-refund-first";
    const eventBase = {
      app_user_id: stateKey,
      product_id: "hall_pass_20",
      store: "PLAY_STORE",
      environment: "PRODUCTION",
    };

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          ...eventBase,
          id: "evt_rc_refund_first",
          type: "CANCELLATION",
          transaction_id: "tx_rc_refund_first_webhook_20",
          original_transaction_id: "tx_rc_refund_first_20",
          cancel_reason: "CUSTOMER_SUPPORT",
        },
      },
    }), deps());

    expect(lastResponse?.body).toMatchObject({
      received: true,
      applied: false,
      amount: 0,
      requestedAmount: -20,
      hallPasses: 0,
      reason: "missing-original-grant",
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          ...eventBase,
          id: "evt_rc_refund_first_purchase",
          type: "NON_RENEWING_PURCHASE",
          transaction_id: "tx_rc_refund_first_20",
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        received: true,
        applied: false,
        sessionId: stateKey,
        amount: 0,
        requestedAmount: 20,
        hallPasses: 0,
        reason: "transaction-already-refunded",
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
    expect(ruby.walletTransaction(stateKey, "revenuecat:reversal:tx_rc_refund_first_20:HLP")).toMatchObject({
      kind: "hall-pass-revoke",
      hallPasses: 0,
    });
    expect(ruby.walletTransaction(stateKey, "revenuecat:grant:tx_rc_refund_first_20:HLP")).toBeNull();
  });

  it("reports the actual RevenueCat reversal delta when the wallet has fewer Hall Passes than the refund", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    const stateKey = "rh:user:rc-partial-refund";
    ruby.grantHallPasses(stateKey, {
      amount: 5,
      idempotencyKey: "test:partial-refund-unrelated-balance",
      source: "admin",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(5);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_partial_refund_purchase",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: stateKey,
          product_id: "hall_pass_20",
          transaction_id: "tx_rc_partial_refund_20",
          store: "PLAY_STORE",
          environment: "PRODUCTION",
        },
      },
    }), deps());
    expect(lastResponse?.body).toMatchObject({ applied: true, amount: 20, hallPasses: 25 });

    ruby.spendHallPasses(stateKey, {
      amount: 20,
      idempotencyKey: "test:spend-before-partial-refund",
      source: "admin",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(5);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_partial_refund",
          type: "CANCELLATION",
          app_user_id: stateKey,
          product_id: "hall_pass_20",
          transaction_id: "tx_rc_partial_refund_20",
          cancel_reason: "CUSTOMER_SUPPORT",
          store: "PLAY_STORE",
          environment: "PRODUCTION",
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        received: true,
        applied: true,
        sessionId: stateKey,
        amount: -5,
        requestedAmount: -20,
        hallPasses: 0,
      },
    });
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions).toContainEqual(expect.objectContaining({
      id: "revenuecat:reversal:tx_rc_partial_refund_20:HLP",
      kind: "hall-pass-revoke",
      hallPasses: -5,
    }));
  });

  it("can fulfill RevenueCat virtual currency transaction events", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    process.env.RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE = "HLP";

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/revenuecat/webhook",
      authorization: "Bearer rc-secret",
      body: {
        api_version: "1.0",
        event: {
          id: "evt_rc_vc",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: "rh:user:rc-vc",
          product_id: "hall_pass_5",
          transaction_id: "tx_rc_vc_5",
          virtual_currency_transaction_id: "vatx_rc_5",
          store: "APP_STORE",
          purchase_environment: "SANDBOX",
          adjustments: [
            { amount: 5, currency: { code: "HLP", name: "Hall Passes" } },
          ],
        },
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { received: true, applied: true, sessionId: "rh:user:rc-vc", amount: 5, hallPasses: 5 },
    });
    expect(ruby.getOrCreate("rh:user:rc-vc").wallet.hallPasses).toBe(5);
  });
});
