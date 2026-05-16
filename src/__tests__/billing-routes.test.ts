import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBillingRoutes } from "../routes/billing.js";
import type { RouteContext } from "../routes/context.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
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
};

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

function stripeSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
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
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-billing-routes-"));
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
});

afterEach(async () => {
  restoreEnv();
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("billing products", () => {
  it("returns the configured Hall Pass packs and image costs", async () => {
    const handled = await handleBillingRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/billing/products",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.configured).toBe(false);
    expect(lastResponse?.body.products.map((p: any) => p.hallPasses)).toEqual([5, 20, 50, 100]);
    expect(lastResponse?.body.imageCosts).toEqual({ portrait: 1, diploma: 3 });
    expect(lastResponse?.body.hostedAiAccess).toMatchObject({ configured: false, cost: 1, durationMs: 86_400_000 });
    expect(lastResponse?.body.entitlements).toMatchObject({
      hallPasses: 0,
      hosted_ai: { configured: false, active: false, affordable: false, canActivate: false },
      hosted_images: {
        portrait: { configured: false, cost: 1, affordable: false, canUseHosted: false },
        diploma: { configured: false, cost: 3, affordable: false, canUseHosted: false },
      },
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
    });
    expect(lastResponse?.body.hostedAiAccess).toMatchObject({ configured: true, active: false, cost: 1 });
  });
});

describe("AI Day Pass", () => {
  it("spends one Hall Pass to enable hosted AI for 24 hours", async () => {
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
    signInUser("ai-pass-empty");

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
      body: { productId: "hall-pass-20" },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({ status: 200, body: { ok: true, url: "https://checkout.stripe.test/pay" } });
    const params = new URLSearchParams(capturedBody);
    expect(params.get("client_reference_id")).toBe(stateKey);
    expect(params.get("metadata[ruby_high_session_id]")).toBe(stateKey);
    expect(params.get("metadata[hall_pass_pack_id]")).toBe("hall-pass-20");
    expect(params.get("metadata[hall_passes]")).toBe("20");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("699");
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
          amount_total: 699,
          currency: "usd",
          metadata: {
            ruby_high_session_id: stateKey,
            hall_pass_pack_id: "hall-pass-20",
            hall_passes: "20",
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

    expect(lastResponse).toMatchObject({ status: 200, body: { received: true, applied: true, hallPasses: 20 } });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(20);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/stripe/webhook",
      rawBody,
      stripeSignature: signature,
    }), deps());

    expect(lastResponse).toMatchObject({ status: 200, body: { received: true, applied: false, hallPasses: 20 } });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(20);
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

  it("reverses Hall Passes when RevenueCat reports a refund cancellation", async () => {
    process.env.RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH = "Bearer rc-secret";
    ruby.grantHallPasses("rh:user:rc-refund", {
      amount: 50,
      idempotencyKey: "test:rc-refund-seed",
      source: "admin",
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
          app_user_id: "rh:user:rc-refund",
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
      body: { received: true, applied: true, sessionId: "rh:user:rc-refund", amount: -20, hallPasses: 30 },
    });
    expect(ruby.getOrCreate("rh:user:rc-refund").wallet.hallPasses).toBe(30);
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
