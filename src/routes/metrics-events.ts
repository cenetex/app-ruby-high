import { RubyHighService } from "../services/ruby-high-service.js";
import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX } from "./constants.js";

export const METRICS_EVENT_PATH = `${APP_ROUTE_PREFIX}/metrics/event`;

type MetricsEventBody = {
  type?: unknown;
  inactiveMs?: unknown;
  reason?: unknown;
  path?: unknown;
  referrer?: unknown;
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
  const body = (await ctx.readJsonBody().catch(() => ({}))) as MetricsEventBody;
  const type = typeof body?.type === "string" ? body.type : "";
  if (type === "app_open") {
    deps.ruby.recordAppOpen(deps.sessionId, {
      source: "viewer",
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
      inactiveMs: typeof body.inactiveMs === "number" ? body.inactiveMs : Number(body.inactiveMs),
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    ctx.json(ctx.res, { ok: true });
    return true;
  }
  ctx.error(ctx.res, "Unknown metrics event type.", 400);
  return true;
}

function requestHeaderString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}
