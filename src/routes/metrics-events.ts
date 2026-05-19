import { RubyHighService } from "../services/ruby-high-service.js";
import { TokenBucket } from "../services/rate-limit.js";
import { visitorHashFromHeader } from "../services/auth-service.js";
import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX } from "./constants.js";

export const METRICS_EVENT_PATH = `${APP_ROUTE_PREFIX}/metrics/event`;

const METRICS_EVENT_LIMITER = new TokenBucket(60, 1);

type MetricsEventBody = {
  type?: unknown;
  inactiveMs?: unknown;
  reason?: unknown;
  path?: unknown;
  referrer?: unknown;
  shareId?: unknown;
  grade?: unknown;
  packId?: unknown;
  repeatRate?: unknown;
};

export async function handleMetricsEventRoute(
  ctx: RouteContext,
  deps: {
    ruby: RubyHighService;
    sessionId: string;
  },
): Promise<boolean> {
  if (ctx.pathname !== METRICS_EVENT_PATH) return false;
  if (ctx.method !== "POST") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const limitKey = metricsRateLimitKey(ctx.clientIp, deps.sessionId);
  if (!METRICS_EVENT_LIMITER.take(limitKey)) {
    const retryAfter = METRICS_EVENT_LIMITER.retryAfterSeconds(limitKey);
    const res = ctx.res as { setHeader?: (name: string, value: string) => void };
    res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
    ctx.error(ctx.res, "Too many metrics events.", 429);
    return true;
  }
  const body = (await ctx.readJsonBody().catch(() => ({}))) as MetricsEventBody;
  const type = typeof body?.type === "string" ? body.type : "";
  const visitorHash = visitorHashFromHeader(ctx.visitorHeader);
  if (type === "app_open") {
    deps.ruby.recordAppOpen(deps.sessionId, {
      source: "viewer",
      visitorHash,
      path: typeof body.path === "string" ? body.path : undefined,
      referrer: typeof body.referrer === "string" ? body.referrer : undefined,
      userAgent: requestHeaderString(ctx.userAgentHeader),
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "session_resume") {
    deps.ruby.recordSessionResume(deps.sessionId, {
      source: "viewer",
      visitorHash,
      inactiveMs: typeof body.inactiveMs === "number" ? body.inactiveMs : Number(body.inactiveMs),
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "yearbook_open") {
    deps.ruby.recordYearbookOpen(deps.sessionId, {
      visitorHash,
      shareId: typeof body.shareId === "string" ? body.shareId : undefined,
      grade: typeof body.grade === "string" ? body.grade : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "yearbook_copy") {
    deps.ruby.recordYearbookCopy(deps.sessionId, {
      visitorHash,
      shareId: typeof body.shareId === "string" ? body.shareId : undefined,
      grade: typeof body.grade === "string" ? body.grade : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "guest_spotlight_seen") {
    deps.ruby.recordGuestSpotlightSeen(deps.sessionId, {
      visitorHash,
      packId: typeof body.packId === "string" ? body.packId : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "guest_spotlight_started") {
    deps.ruby.recordGuestSpotlightStarted(deps.sessionId, {
      visitorHash,
      packId: typeof body.packId === "string" ? body.packId : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  if (type === "balance_sample") {
    deps.ruby.recordBalanceSample({
      source: "viewer",
      metadata: {
        ...(Number.isFinite(Number(body.repeatRate)) ? { repeatRate: Number(body.repeatRate) } : {}),
      },
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  ctx.error(ctx.res, "Unknown metrics event type.", 400);
  return true;
}

function metricsRateLimitKey(clientIp: string | null | undefined, sessionId: string): string {
  return `${clientIp || "no-ip"}:${sessionId || "anon"}`;
}

function requestHeaderString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}
