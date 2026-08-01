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
  setCorePackNftVerifierForTest,
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
  NODE_ENV: process.env.NODE_ENV,
  RUBY_HIGH_STRIPE_SECRET_KEY: process.env.RUBY_HIGH_STRIPE_SECRET_KEY,
  RUBY_HIGH_STRIPE_WEBHOOK_SECRET: process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET,
  RUBY_HIGH_STRIPE_CURRENCY: process.env.RUBY_HIGH_STRIPE_CURRENCY,
  RUBY_HIGH_HALL_PASS_5_CENTS: process.env.RUBY_HIGH_HALL_PASS_5_CENTS,
  RUBY_HIGH_HALL_PASS_20_CENTS: process.env.RUBY_HIGH_HALL_PASS_20_CENTS,
  RUBY_HIGH_HALL_PASS_50_CENTS: process.env.RUBY_HIGH_HALL_PASS_50_CENTS,
  RUBY_HIGH_HALL_PASS_100_CENTS: process.env.RUBY_HIGH_HALL_PASS_100_CENTS,
  RUBY_HIGH_OPENROUTER_API_KEY: process.env.RUBY_HIGH_OPENROUTER_API_KEY,
  RUBY_HIGH_HOSTED_AI_HALL_PASS_COST: process.env.RUBY_HIGH_HOSTED_AI_HALL_PASS_COST,
  RUBY_HIGH_HOSTED_AI_DURATION_MS: process.env.RUBY_HIGH_HOSTED_AI_DURATION_MS,
  RUBY_HIGH_HOSTED_AI_DURATION_HOURS: process.env.RUBY_HIGH_HOSTED_AI_DURATION_HOURS,
  RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH: process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH,
  RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE: process.env.RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE,
  RUBY_HIGH_PRIVY_APP_ID: process.env.RUBY_HIGH_PRIVY_APP_ID,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
  RUBY_HIGH_SOLANA_TREASURY_OWNER: process.env.RUBY_HIGH_SOLANA_TREASURY_OWNER,
  RUBY_HIGH_SOLANA_PACK_1_SOL: process.env.RUBY_HIGH_SOLANA_PACK_1_SOL,
  RUBY_HIGH_SOLANA_PACK_3_SOL: process.env.RUBY_HIGH_SOLANA_PACK_3_SOL,
  RUBY_HIGH_SOLANA_PACK_5_SOL: process.env.RUBY_HIGH_SOLANA_PACK_5_SOL,
  RUBY_HIGH_SOLANA_PACK_10_SOL: process.env.RUBY_HIGH_SOLANA_PACK_10_SOL,
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS,
};

let restoreCorePackMinter: (() => void) | null = null;
let restoreCorePackVerifier: (() => void) | null = null;
let restoreCorePackPurchaseBuilder: (() => void) | null = null;
let restoreHallPassBurnVerifier: (() => void) | null = null;
const TEST_SOLANA_OWNER = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
const TEST_PACK_ASSET = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";

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
  contentTypeHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
}): RouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    url: new URL(`http://localhost:3000${opts.path}`),
    runtime: null,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    contentTypeHeader: opts.contentTypeHeader === undefined ? "application/json" : opts.contentTypeHeader,
    originHeader: opts.originHeader ?? null,
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

async function deliverStripeEvent(event: Record<string, unknown>, secret = "whsec_ruby"): Promise<void> {
  const rawBody = JSON.stringify(event);
  await handleBillingRoutes(makeCtx({
    method: "POST",
    path: "/api/apps/ruby-high/billing/stripe/webhook",
    rawBody,
    stripeSignature: stripeSignature(rawBody, secret),
  }), deps());
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
  delete process.env.RUBY_HIGH_SOLANA_TREASURY_OWNER;
  delete process.env.RUBY_HIGH_SOLANA_PACK_1_SOL;
  delete process.env.RUBY_HIGH_SOLANA_PACK_3_SOL;
  delete process.env.RUBY_HIGH_SOLANA_PACK_5_SOL;
  delete process.env.RUBY_HIGH_SOLANA_PACK_10_SOL;
  process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
  process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
  process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
  restoreCorePackMinter = setCorePackNftMinterForTest(async (input) => deterministicCorePackMintForTest(input));
  restoreCorePackVerifier = setCorePackNftVerifierForTest(async (input) => ({
    ownerWalletAddress: input.ownerWalletAddress,
    assetAddress: input.assetAddress,
    mintSignature: input.paymentSignature,
    metadataUri: input.metadataUri || deterministicCorePackMintForTest(input).metadataUri,
    serial: deterministicCorePackMintForTest(input).serial,
  }));
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
  if (restoreCorePackVerifier) restoreCorePackVerifier();
  if (restoreCorePackPurchaseBuilder) restoreCorePackPurchaseBuilder();
  if (restoreHallPassBurnVerifier) restoreHallPassBurnVerifier();
  restoreCorePackMinter = null;
  restoreCorePackVerifier = null;
  restoreCorePackPurchaseBuilder = null;
  restoreHallPassBurnVerifier = null;
  vi.unstubAllGlobals();
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
      recipient: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j",
      symbol: "SOL",
    });
    expect(lastResponse?.body.solana.products.map((p: any) => [p.packCount, p.cardCount, p.hallPasses, p.solAmount, p.priceLamports])).toEqual([
      [1, 5, 5, "0.01", "10000000"],
      [3, 15, 15, "0.028", "28000000"],
      [5, 25, 25, "0.045", "45000000"],
      [10, 50, 50, "0.085", "85000000"],
    ]);
    expect(lastResponse?.body.imageCosts).toEqual({ portrait: 1, diploma: 3 });
    expect(lastResponse?.body.courseSlotCost).toBe(3);
    expect(lastResponse?.body.questionGenerationCost).toBe(1);
    expect(lastResponse?.body.moreQuestionsCount).toBe(6);
    expect(lastResponse?.body.cardBurn).toEqual({ hallPassesPerCard: 5 });
    expect(lastResponse?.body.rubyMigration).toBeUndefined();
    expect(lastResponse?.body.hostedAiAccess).toBeUndefined();
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

  it("requires every SOL pack price to be explicit in production", async () => {
    process.env.NODE_ENV = "production";

    await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
    }), deps());

    expect(lastResponse?.body.solana).toMatchObject({
      configured: false,
      reason: expect.stringContaining("RUBY_HIGH_SOLANA_PACK_1_SOL"),
    });

    process.env.RUBY_HIGH_SOLANA_PACK_1_SOL = "0.02";
    process.env.RUBY_HIGH_SOLANA_PACK_3_SOL = "0.06";
    process.env.RUBY_HIGH_SOLANA_PACK_5_SOL = "0.10";
    process.env.RUBY_HIGH_SOLANA_PACK_10_SOL = "0.20";
    await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
    }), deps());

    expect(lastResponse?.body.solana.configured).toBe(true);

    process.env.RUBY_HIGH_SOLANA_PACK_3_SOL = "not-a-price";
    await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
    }), deps());

    expect(lastResponse?.body.solana).toMatchObject({
      configured: false,
      reason: expect.stringContaining("RUBY_HIGH_SOLANA_PACK_3_SOL"),
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
      hosted_ai: { configured: true, active: true, affordable: true, canActivate: false, cost: 0 },
      hosted_images: {
        portrait: { configured: true, cost: 1, affordable: true, canUseHosted: true },
        diploma: { configured: true, cost: 3, affordable: false, canUseHosted: false },
      },
      creator: { courseSlotCost: 3, questionGenerationCost: 1, moreQuestionsCount: 6 },
    });
    expect(lastResponse?.body.hostedAiAccess).toBeUndefined();
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

  it("rejects cross-origin welcome grants before mutating wallet state", async () => {
    const stateKey = signInUser("welcome-origin-guard");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/welcome",
      cookie: "rh_session=welcome-origin-guard",
      originHeader: "https://evil.example",
    }), deps());

    expect(lastResponse).toEqual({
      status: 403,
      body: { error: "Billing request origin is not allowed." },
    });
    emptyWelcomeHallPasses(stateKey);
  });

  it("rejects non-json welcome grants before mutating wallet state", async () => {
    const stateKey = signInUser("welcome-content-type-guard");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/welcome",
      cookie: "rh_session=welcome-content-type-guard",
      contentTypeHeader: "text/plain",
    }), deps());

    expect(lastResponse).toEqual({
      status: 415,
      body: { error: "Billing requests must be sent as JSON." },
    });
    emptyWelcomeHallPasses(stateKey);
  });
});

describe("Sponsored AI", () => {
  it("retires the old AI pass purchase endpoint", async () => {
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

    expect(lastResponse?.status).toBe(410);
    expect(lastResponse?.body.error).toContain("AI is sponsored");
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(2);
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
      hosted_ai: { configured: true, active: true, affordable: true, canActivate: false },
      entitlements: {
        hallPasses: 3,
        hosted_images: {
          portrait: { canUseHosted: true },
          diploma: { canUseHosted: true },
        },
      },
    });
  });

  it("does not require Hall Passes for sponsored AI availability", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const stateKey = signInUser("ai-pass-empty");
    emptyWelcomeHallPasses(stateKey);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/ai-pass",
      cookie: "rh_session=ai-pass-empty",
    }), deps());

    expect(lastResponse?.status).toBe(410);
    expect(lastResponse?.body.error).toContain("AI is sponsored");
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
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
    expect(params.get("metadata[billing_terms_version]")).toBe("ruby-high-stripe-terms-v1");
    expect(params.get("metadata[hall_pass_product_id]")).toBe("hall-pass-50");
    expect(params.get("metadata[card_pack_id]")).toBeNull();
    expect(params.get("metadata[pack_count]")).toBeNull();
    expect(params.get("metadata[card_count]")).toBeNull();
    expect(params.get("metadata[hall_passes]")).toBe("50");
    expect(params.get("metadata[hall_pass_unit_amount]")).toBe("1499");
    expect(params.get("metadata[hall_pass_currency]")).toBe("usd");
    expect(params.get("payment_intent_data[metadata][ruby_high_session_id]")).toBe(stateKey);
    expect(params.get("payment_intent_data[metadata][billing_terms_version]")).toBe("ruby-high-stripe-terms-v1");
    expect(params.get("payment_intent_data[metadata][hall_pass_product_id]")).toBe("hall-pass-50");
    expect(params.get("payment_intent_data[metadata][card_pack_id]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][pack_count]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][card_count]")).toBeNull();
    expect(params.get("payment_intent_data[metadata][hall_passes]")).toBe("50");
    expect(params.get("payment_intent_data[metadata][hall_pass_unit_amount]")).toBe("1499");
    expect(params.get("payment_intent_data[metadata][hall_pass_currency]")).toBe("usd");
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
      contentTypeHeader: "text/plain",
      originHeader: "https://stripe.example",
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

  it("fulfills the immutable terms captured when Checkout was created", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    process.env.RUBY_HIGH_HALL_PASS_50_CENTS = "2599";
    process.env.RUBY_HIGH_STRIPE_CURRENCY = "cad";
    const stateKey = "rh:user:stripe-snapshotted-terms";

    await deliverStripeEvent({
      id: "evt_snapshotted_terms",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_snapshotted_terms",
          payment_intent: "pi_snapshotted_terms",
          payment_status: "paid",
          client_reference_id: stateKey,
          amount_total: 1499,
          currency: "usd",
          metadata: {
            ruby_high_session_id: stateKey,
            billing_terms_version: "ruby-high-stripe-terms-v1",
            hall_pass_product_id: "hall-pass-50",
            hall_passes: "50",
            hall_pass_unit_amount: "1499",
            hall_pass_currency: "usd",
          },
        },
      },
    });

    expect(lastResponse).toMatchObject({ status: 200, body: { applied: true, hallPasses: 50 } });
    expect(ruby.walletTransaction(stateKey, "stripe:checkout:cs_snapshotted_terms")).toMatchObject({
      amountCents: 1499,
      metadata: {
        stripePaymentIntentId: "pi_snapshotted_terms",
        billingTermsVersion: "ruby-high-stripe-terms-v1",
      },
    });
  });

  it("revokes a refunded Stripe purchase idempotently", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-refund";
    await deliverStripeEvent({
      id: "evt_refund_purchase",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_refund_purchase",
        payment_intent: "pi_refund_purchase",
        payment_status: "paid",
        client_reference_id: stateKey,
        amount_total: 699,
        currency: "usd",
        metadata: {
          ruby_high_session_id: stateKey,
          billing_terms_version: "ruby-high-stripe-terms-v1",
          hall_pass_product_id: "hall-pass-20",
          hall_passes: "20",
          hall_pass_unit_amount: "699",
          hall_pass_currency: "usd",
        },
      } },
    });
    const refundEvent = {
      id: "evt_refund_created",
      created: 1_800_000_000,
      type: "refund.created",
      data: { object: {
        id: "re_refund_purchase",
        payment_intent: "pi_refund_purchase",
        amount: 699,
        status: "succeeded",
      } },
    };

    await deliverStripeEvent(refundEvent);
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ sessionId: stateKey, amount: -20, hallPasses: 0 }] },
    });

    await deliverStripeEvent(refundEvent);
    expect(lastResponse).toMatchObject({ status: 200, body: { applied: false } });
    expect(ruby.hallPassBalance(stateKey)).toBe(0);
  });

  it("restores Hall Passes when a refund fails", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-refund-failed";
    await deliverStripeEvent({
      id: "evt_refund_failed_purchase",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_refund_failed_purchase",
        payment_intent: "pi_refund_failed_purchase",
        payment_status: "paid",
        client_reference_id: stateKey,
        amount_total: 699,
        currency: "usd",
        metadata: {
          ruby_high_session_id: stateKey,
          billing_terms_version: "ruby-high-stripe-terms-v1",
          hall_pass_product_id: "hall-pass-20",
          hall_passes: "20",
          hall_pass_unit_amount: "699",
          hall_pass_currency: "usd",
        },
      } },
    });
    await deliverStripeEvent({
      id: "evt_partial_refund",
      created: 1_800_000_001,
      type: "refund.created",
      data: { object: {
        id: "re_partial_refund",
        payment_intent: "pi_refund_failed_purchase",
        amount: 349,
        status: "pending",
      } },
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(10);

    await deliverStripeEvent({
      id: "evt_partial_refund_failed",
      created: 1_800_000_002,
      type: "refund.failed",
      data: { object: {
        id: "re_partial_refund",
        payment_intent: "pi_refund_failed_purchase",
        amount: 349,
        status: "failed",
      } },
    });

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ amount: 10, hallPasses: 20 }] },
    });
  });

  it("records durable debt when a reversal exceeds the spendable balance", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-refund-outstanding";
    ruby.grantHallPasses(stateKey, {
      amount: 5,
      amountCents: 199,
      idempotencyKey: "stripe:checkout:cs_refund_outstanding",
      source: "stripe",
      metadata: { stripePaymentIntentId: "pi_refund_outstanding", amountTotal: 199 },
    });
    ruby.spendHallPasses(stateKey, {
      amount: 5,
      idempotencyKey: "test:spend-before-stripe-refund",
      source: "admin",
    });
    const refundEvent = {
      id: "evt_refund_outstanding",
      created: 1_800_000_002,
      type: "refund.created",
      data: { object: {
        id: "re_refund_outstanding",
        payment_intent: "pi_refund_outstanding",
        amount: 199,
        status: "succeeded",
      } },
    };

    await deliverStripeEvent(refundEvent);
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ amount: -5, hallPasses: 0 }] },
    });
    expect(ruby.walletTransactions(stateKey).filter((transaction) => (
      transaction.metadata?.stripeReversalAdjustment === true
    ))).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet).toMatchObject({ hallPasses: 0, hallPassDebt: 5 });

    ruby.grantHallPasses(stateKey, {
      amount: 3,
      idempotencyKey: "test:partial-debt-payment",
      source: "admin",
    });
    expect(ruby.getOrCreate(stateKey).wallet).toMatchObject({ hallPasses: 0, hallPassDebt: 2 });

    await deliverStripeEvent(refundEvent);
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: false, reversals: [{ amount: 0, hallPasses: 0 }] },
    });

    ruby.grantHallPasses(stateKey, {
      amount: 3,
      idempotencyKey: "test:finish-debt-payment",
      source: "admin",
    });
    expect(ruby.getOrCreate(stateKey).wallet).toMatchObject({ hallPasses: 1 });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassDebt ?? 0).toBe(0);
  });

  it("backfills historical Stripe purchases before reconciling a refund", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    process.env.RUBY_HIGH_STRIPE_SECRET_KEY = "sk_test_ruby";
    const stateKey = "rh:user:stripe-historical-refund";
    ruby.grantHallPasses(stateKey, {
      amount: 5,
      amountCents: 199,
      idempotencyKey: "stripe:checkout:cs_historical_refund",
      source: "stripe",
      metadata: {
        stripeCheckoutSessionId: "cs_historical_refund",
        hallPassProductId: "hall-pass-5",
        amountTotal: 199,
      },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "cs_historical_refund", payment_intent: "pi_historical_refund" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await deliverStripeEvent({
      id: "evt_historical_refund",
      type: "refund.created",
      data: { object: {
        id: "re_historical_refund",
        payment_intent: "pi_historical_refund",
        amount: 199,
        status: "succeeded",
      } },
    });

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ sessionId: stateKey, amount: -5, hallPasses: 0 }] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_historical_refund&limit=1",
      expect.objectContaining({ headers: { Authorization: "Bearer sk_test_ruby" } }),
    );
    expect(ruby.walletTransaction(stateKey, "stripe:checkout:cs_historical_refund")?.metadata)
      .toMatchObject({ stripePaymentIntentId: "pi_historical_refund" });
  });

  it("reconciles Stripe disputes and restores funds after a win", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-dispute";
    await deliverStripeEvent({
      id: "evt_dispute_purchase",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_dispute_purchase",
        payment_intent: "pi_dispute_purchase",
        payment_status: "paid",
        client_reference_id: stateKey,
        amount_total: 199,
        currency: "usd",
        metadata: {
          ruby_high_session_id: stateKey,
          billing_terms_version: "ruby-high-stripe-terms-v1",
          hall_pass_product_id: "hall-pass-5",
          hall_passes: "5",
          hall_pass_unit_amount: "199",
          hall_pass_currency: "usd",
        },
      } },
    });
    await deliverStripeEvent({
      id: "evt_dispute_created",
      created: 1_800_000_003,
      type: "charge.dispute.created",
      data: { object: {
        id: "dp_dispute_purchase",
        payment_intent: "pi_dispute_purchase",
        amount: 199,
        status: "needs_response",
      } },
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(0);

    await deliverStripeEvent({
      id: "evt_dispute_won",
      created: 1_800_000_004,
      type: "charge.dispute.closed",
      data: { object: {
        id: "dp_dispute_purchase",
        payment_intent: "pi_dispute_purchase",
        amount: 199,
        status: "won",
      } },
    });

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ amount: 5, hallPasses: 5 }] },
    });
  });

  it("does not revoke for an inquiry unless Stripe reports funds withdrawn", async () => {
    process.env.RUBY_HIGH_STRIPE_WEBHOOK_SECRET = "whsec_ruby";
    const stateKey = "rh:user:stripe-inquiry";
    ruby.grantHallPasses(stateKey, {
      amount: 5,
      amountCents: 199,
      idempotencyKey: "stripe:checkout:cs_inquiry_purchase",
      source: "stripe",
      metadata: { stripePaymentIntentId: "pi_inquiry_purchase", amountTotal: 199 },
    });
    const dispute = {
      id: "dp_inquiry_purchase",
      payment_intent: "pi_inquiry_purchase",
      amount: 199,
      status: "warning_needs_response",
    };

    await deliverStripeEvent({
      id: "evt_inquiry_created",
      created: 1_800_000_005,
      type: "charge.dispute.created",
      data: { object: dispute },
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(5);

    await deliverStripeEvent({
      id: "evt_inquiry_funds_withdrawn",
      created: 1_800_000_006,
      type: "charge.dispute.funds_withdrawn",
      data: { object: dispute },
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(0);

    await deliverStripeEvent({
      id: "evt_inquiry_funds_reinstated",
      created: 1_800_000_007,
      type: "charge.dispute.funds_reinstated",
      data: { object: dispute },
    });
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { applied: true, reversals: [{ amount: 5, hallPasses: 5 }] },
    });
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
      body: { productId: "card-pack-1", ownerWalletAddress: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j" },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(lastResponse?.body.error).toContain("buyer wallet");
  });

  it("returns a wallet-funding error when the buyer does not have enough SOL", async () => {
    restoreCorePackPurchaseBuilder = setCorePackPurchaseTransactionBuilderForTest(async () => {
      throw new Error("Transaction simulation failed: insufficient funds for fee");
    });
    signInUser("solana-quote-missing-token");

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-quote-missing-token",
      body: { productId: "card-pack-1", ownerWalletAddress: TEST_SOLANA_OWNER },
    }), deps());

    expect(lastResponse).toEqual({
      status: 402,
      body: { error: "Transaction simulation failed: insufficient funds for fee" },
    });
  });

  it("quotes packs in native SOL with a session payment reference", async () => {
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
      recipient: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j",
      symbol: "SOL",
      rpcHost: "api.mainnet-beta.solana.com",
      product: {
        id: "card-pack-5",
        packCount: 5,
        cardCount: 25,
        hallPasses: 25,
        solAmount: "0.045",
        priceLamports: "45000000",
        symbol: "SOL",
      },
      ownerWalletAddress: TEST_SOLANA_OWNER,
    });
    expect(lastResponse?.body.reference).toEqual(expect.any(String));
    expect(lastResponse?.body.reference).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(lastResponse?.body.solanaPayUrl).toContain("solana:AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j?");
    expect(lastResponse?.body.solanaPayUrl).toContain("amount=0.045");
    expect(lastResponse?.body.solanaPayUrl).not.toContain("spl-token=");
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

  it("prepares a wallet-only SOL payment when a Solana wallet is supplied", async () => {
    const ownerWalletAddress = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
    restoreCorePackPurchaseBuilder = setCorePackPurchaseTransactionBuilderForTest(async (input) => {
      expect(input).toMatchObject({
        productId: "card-pack-1",
        packCount: 1,
        cardCount: 5,
        ownerWalletAddress,
        solRecipient: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j",
        solAmount: "0.01",
        priceLamports: "10000000",
      });
      expect(input.paymentReference).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      return {
        ownerWalletAddress,
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
      recipient: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j",
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

  it("records a wallet-paid Pack NFT after verifying the payment transaction", async () => {
    const stateKey = signInUser("solana-wallet-mint-paid");
    const ownerWalletAddress = TEST_SOLANA_OWNER;
    const packAssetAddress = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const packMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-3/456789.json?packs=3&cards=15";
    stubCorePackPurchaseBuilderForTest({
      expected: {
        productId: "card-pack-3",
        ownerWalletAddress,
      },
    });
    restoreCorePackVerifier?.();
    restoreCorePackVerifier = setCorePackNftVerifierForTest(async (input) => {
      expect(input).toMatchObject({
        productId: "card-pack-3",
        packCount: 3,
        cardCount: 15,
        ownerWalletAddress,
        assetAddress: packAssetAddress,
        metadataUri: packMetadataUri,
      });
      return {
        ownerWalletAddress,
        assetAddress: packAssetAddress,
        mintSignature: input.paymentSignature,
        metadataUri: packMetadataUri,
        serial: 456789,
      };
    });
    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/quote",
      cookie: "rh_session=solana-wallet-mint-paid",
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
          preBalances: [1_000_000_000, 10_000_000_000, 0, 0],
          postBalances: [970_000_000, 10_028_000_000, 0, 0],
        },
        transaction: {
          signatures: [signature],
          message: { accountKeys: [
            { pubkey: ownerWalletAddress },
            { pubkey: "AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j" },
            { pubkey: reference },
            { pubkey: packAssetAddress },
          ] },
        },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-wallet-mint-paid",
      body: {
        productId: "card-pack-3",
        signature,
        ownerWalletAddress,
        packAssetAddress,
        packMetadataUri,
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
        packMintSignature: signature,
        packMetadataUri,
        packRevealVersion: "ruby-high-pack-reveal-v1.1",
        catalogHash: expect.any(String),
        commitment: expect.any(String),
        entropySource: "ruby-high-server-commit-v1",
        solAmount: "0.028",
        symbol: "SOL",
      },
    });
    expect(ruby.walletTransaction(stateKey, `solana:sol-transfer:${signature}`)).toMatchObject({
      source: "solana",
      metadata: {
        packAssetAddress,
        packMintSignature: signature,
        packMetadataUri,
        packSerial: 456789,
        packRevealVersion: "ruby-high-pack-reveal-v1.1",
        catalogHash: expect.any(String),
        commitment: expect.any(String),
        entropySource: "ruby-high-server-commit-v1",
        solanaReference: reference,
        solanaAmountSol: "0.028",
        solanaRequiredLamports: "28000000",
        solanaReceivedLamports: "28000000",
        solanaSymbol: "SOL",
      },
    });

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/solana/confirm",
      cookie: "rh_session=solana-wallet-mint-paid",
      body: {
        productId: "card-pack-3",
        signature,
        ownerWalletAddress,
        packAssetAddress,
        packMetadataUri,
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
    const packMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-5/123456.json?packs=5&cards=25";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-solana-billing",
      result: {
        meta: {
          err: null,
          preBalances: [],
          postBalances: [],
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
      body: {
        productId: "card-pack-5",
        signature,
        ownerWalletAddress: TEST_SOLANA_OWNER,
        packAssetAddress: TEST_PACK_ASSET,
        packMetadataUri,
      },
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

  it("records RevenueCat reversal debt when the wallet has fewer Hall Passes than the refund", async () => {
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
        amount: -20,
        hallPasses: 0,
      },
    });
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions).toContainEqual(expect.objectContaining({
      id: "revenuecat:reversal:tx_rc_partial_refund_20:HLP",
      kind: "hall-pass-revoke",
      hallPasses: -20,
    }));
    expect(ruby.getOrCreate(stateKey).wallet.hallPassDebt).toBe(15);
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
