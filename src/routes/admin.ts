import { logMetricsSnapshot } from "../services/logger.js";
import type { AuthService } from "../services/auth-service.js";
import type { RubyHighService } from "../services/ruby-high-service.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export const ADMIN_METRICS_PATH = `${APP_ROUTE_PREFIX}/admin/metrics`;

interface AdminDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function configuredToken(): string | null {
  const raw = process.env.RUBY_HIGH_ADMIN_TOKEN?.trim();
  return raw ? raw : null;
}

function authorized(ctx: RouteContext, token: string): boolean {
  const auth = firstHeader(ctx.authorizationHeader).trim();
  return auth === token || auth === `Bearer ${token}`;
}

export async function handleAdminMetricsRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const token = configuredToken();
  if (!token) {
    ctx.error(ctx.res, "Admin metrics are not configured.", 503);
    return true;
  }
  if (!authorized(ctx, token)) {
    ctx.error(ctx.res, "Unauthorized.", 401);
    return true;
  }
  ctx.json(ctx.res, {
    ok: true,
    generatedAt: new Date().toISOString(),
    auth: deps.auth.analyticsSnapshot(),
    ruby: deps.ruby.analyticsSnapshot(),
    logs: logMetricsSnapshot(),
  });
  return true;
}
