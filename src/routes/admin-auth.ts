import { constantTimeSecretEqual } from "../services/secret-comparison.js";
import type { RouteContext } from "./context.js";

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Authenticate an admin route and write the canonical failure response. */
export function requireAdminAuth(ctx: RouteContext): string | null {
  const token = process.env.RUBY_HIGH_ADMIN_TOKEN?.trim();
  if (!token) {
    ctx.error(ctx.res, "Admin authentication is not configured.", 503);
    return null;
  }

  const auth = firstHeader(ctx.authorizationHeader).trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!constantTimeSecretEqual(match?.[1]?.trim() ?? auth, token)) {
    ctx.error(ctx.res, "Admin authentication required.", 401);
    return null;
  }

  return token;
}

/** Authenticate the narrow external scheduler wake-up without granting the
 *  workflow access to the rest of the admin surface. */
export function requireSchedulerAuth(ctx: RouteContext): string | null {
  const token = process.env.RUBY_HIGH_SCHEDULER_TOKEN?.trim();
  if (!token) {
    ctx.error(ctx.res, "Scheduler authentication is not configured.", 503);
    return null;
  }

  const auth = firstHeader(ctx.authorizationHeader).trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!constantTimeSecretEqual(match?.[1]?.trim() ?? auth, token)) {
    ctx.error(ctx.res, "Scheduler authentication required.", 401);
    return null;
  }

  return token;
}
