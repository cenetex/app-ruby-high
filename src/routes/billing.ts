import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import {
  courseSlotCost,
  hostedAiAccessCost,
  hostedAiAccessDurationMs,
  hostedEntitlementStatus,
  hostedImageCost,
  hostedOpenRouterConfigured,
} from "../hosted-entitlements.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export {
  courseSlotCost,
  hostedAiAccessCost,
  hostedAiAccessDurationMs,
  hostedImageCost,
} from "../hosted-entitlements.js";

export const BILLING_PREFIX = `${APP_ROUTE_PREFIX}/billing`;

export interface BillingProduct {
  id: string;
  name: string;
  hallPasses: number;
  unitAmount: number;
  currency: string;
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

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

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

function billingCurrency(): string {
  return envTrim("RUBY_HIGH_STRIPE_CURRENCY")?.toLowerCase() ?? "usd";
}

function revenueCatCurrencyCode(): string {
  return envTrim("RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE") ?? "HLP";
}

export function billingProducts(): BillingProduct[] {
  const currency = billingCurrency();
  return [
    {
      id: "hall-pass-5",
      name: "Cafeteria Sampler",
      hallPasses: 5,
      unitAmount: readPositiveIntEnv("RUBY_HIGH_HALL_PASS_5_CENTS", 199),
      currency,
      description: "5 Hall Passes for custom Ruby High image generation.",
    },
    {
      id: "hall-pass-20",
      name: "Locker Stash",
      hallPasses: 20,
      unitAmount: readPositiveIntEnv("RUBY_HIGH_HALL_PASS_20_CENTS", 699),
      currency,
      description: "20 Hall Passes for portraits, diplomas, and future creative drops.",
    },
    {
      id: "hall-pass-50",
      name: "Honor Roll Bundle",
      hallPasses: 50,
      unitAmount: readPositiveIntEnv("RUBY_HIGH_HALL_PASS_50_CENTS", 1499),
      currency,
      description: "50 Hall Passes for regular creators.",
    },
    {
      id: "hall-pass-100",
      name: "Senior Week Stack",
      hallPasses: 100,
      unitAmount: readPositiveIntEnv("RUBY_HIGH_HALL_PASS_100_CENTS", 2499),
      currency,
      description: "100 Hall Passes for heavy yearbook energy.",
    },
  ];
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

function hallPassesForProductId(productId: string | undefined | null): number | null {
  if (!productId) return null;
  const normalized = productId.trim().toLowerCase();
  const exact: Record<string, number> = {
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
  applied: boolean;
} {
  const metadata = stripeMetadata(session);
  const sessionId = metadata.ruby_high_session_id || session.client_reference_id || "";
  const amount = Math.floor(Number(metadata.hall_passes));
  const productId = metadata.hall_pass_pack_id || "unknown";
  if (!session.id) throw new Error("Stripe checkout session is missing an id.");
  if (!sessionId) throw new Error("Stripe checkout session is missing a Ruby High session id.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Stripe checkout session is missing Hall Pass metadata.");
  const result = ruby.grantHallPasses(sessionId, {
    amount,
    idempotencyKey: `stripe:checkout:${session.id}`,
    source: "stripe",
    description: `${amount} Hall Passes`,
    metadata: {
      stripeCheckoutSessionId: session.id,
      hallPassPackId: productId,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
    },
  });
  return { sessionId, amount, productId, applied: result.applied };
}

function revenueCatTransactionKey(prefix: "grant" | "reversal", event: RevenueCatWebhookEvent): string {
  const transaction = event.transaction_id || event.original_transaction_id || event.virtual_currency_transaction_id || event.id || "unknown";
  return `revenuecat:${prefix}:${transaction}:${revenueCatCurrencyCode()}`;
}

async function fulfillRevenueCatWebhook(ruby: RubyHighService, event: RevenueCatWebhookEvent): Promise<{
  applied: boolean;
  sessionId?: string;
  amount?: number;
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
    const input = {
      amount: Math.abs(amount),
      idempotencyKey: revenueCatTransactionKey(amount > 0 ? "grant" : "reversal", event),
      source: "revenuecat" as const,
      description: `${Math.abs(amount)} Hall Pass${Math.abs(amount) === 1 ? "" : "es"} via RevenueCat`,
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
    return {
      applied: result.applied,
      sessionId,
      amount,
      productId: event.product_id,
      hallPasses: result.state.wallet.hallPasses,
    };
  }

  if (event.type === "NON_RENEWING_PURCHASE" || event.type === "CANCELLATION") {
    const amount = hallPassesForProductId(event.product_id);
    if (!amount) return { applied: false, sessionId, productId: event.product_id, reason: "unknown-product" };
    const reversal = event.type === "CANCELLATION";
    const input = {
      amount,
      idempotencyKey: revenueCatTransactionKey(reversal ? "reversal" : "grant", event),
      source: "revenuecat" as const,
      description: `${amount} Hall Pass${amount === 1 ? "" : "es"} via RevenueCat`,
      at: event.event_timestamp_ms,
      metadata: {
        revenueCatEventId: event.id ?? null,
        revenueCatTransactionId: event.transaction_id ?? null,
        productId: event.product_id ?? null,
        store: event.store ?? null,
        environment: event.environment ?? event.purchase_environment ?? null,
        cancelReason: event.cancel_reason ?? null,
        price: event.price ?? null,
        currency: event.currency ?? null,
      },
    };
    const result = reversal
      ? ruby.revokeHallPasses(sessionId, input)
      : ruby.grantHallPasses(sessionId, input);
    await ruby.flushSession(sessionId);
    return {
      applied: result.applied,
      sessionId,
      amount: reversal ? -amount : amount,
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

export async function handleBillingRoutes(ctx: RouteContext, deps: BillingDeps): Promise<boolean> {
  if (!ctx.pathname.startsWith(BILLING_PREFIX)) return false;

  if (ctx.method === "GET" && ctx.pathname === `${BILLING_PREFIX}/products`) {
    const entitlements = optionalEntitlementsForRequest(ctx, deps);
    ctx.json(ctx.res, {
      ok: true,
      configured: !!envTrim("RUBY_HIGH_STRIPE_SECRET_KEY"),
      currency: billingCurrency(),
      products: billingProducts(),
      imageCosts: {
        portrait: hostedImageCost("portrait"),
        diploma: hostedImageCost("diploma"),
      },
      courseSlotCost: courseSlotCost(),
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
    try {
      const activation = deps.ruby.activateHostedAiAccess(stateKey, {
        hallPassCost: hostedAiAccessCost(),
        durationMs: hostedAiAccessDurationMs(),
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
      ctx.error(ctx.res, message, message.startsWith("Not enough Hall Passes") ? 402 : 500);
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
      ctx.error(ctx.res, "Unknown Hall Pass pack.", 400);
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
    params.set("metadata[hall_pass_pack_id]", product.id);
    params.set("metadata[hall_passes]", String(product.hallPasses));

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
      if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
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
