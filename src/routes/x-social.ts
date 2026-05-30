import type { XSocialService } from "../services/x-social-service.js";
import type { RouteContext } from "./context.js";
import { X_SOCIAL_CONNECT_PATH, X_SOCIAL_CALLBACK_PATH, X_SOCIAL_PREFIX } from "./constants.js";

function requireAdminAuth(ctx: RouteContext): boolean {
  const token = process.env.RUBY_HIGH_ADMIN_TOKEN;
  if (!token) return false;
  const auth = ctx.authorizationHeader;
  if (typeof auth !== "string") return false;
  if (auth === `Bearer ${token}` || auth === token) return true;
  return false;
}

function sendRedirect(res: unknown, url: string, status = 302): void {
  const r = res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
  if (r.setHeader) {
    r.setHeader("Location", url);
    r.writeHead?.(status, { "Content-Type": "text/plain" });
    r.end?.(`Redirecting to ${url}`);
  }
}

function sendJson(res: unknown, data: unknown, status = 200): void {
  const r = res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
  const body = JSON.stringify(data);
  if (r.setHeader) {
    r.setHeader("Content-Type", "application/json");
    r.writeHead?.(status, { "Content-Type": "application/json" });
    r.end?.(body);
  }
}

function sendError(res: unknown, message: string, status = 400): void {
  sendJson(res, { error: message }, status);
}

/**
 * Handle X social routes dispatched from the master router.
 * Paths:
 *   GET  /x/connect/:teacherId  — start OAuth flow (admin only)
 *   GET  /x/callback            — OAuth callback from X
 *   GET  /x/status/:teacherId   — connection status
 *   POST /x/disconnect/:teacherId — revoke tokens (admin only)
 *   GET  /x/connected            — list all connected teachers
 */
export async function handleXSocialRoutes(
  ctx: RouteContext,
  xSocial: XSocialService,
): Promise<boolean> {
  const pathname = ctx.pathname;

  // GET /x/callback — OAuth callback (no auth required; state param is the proof)
  if (ctx.method === "GET" && pathname === X_SOCIAL_CALLBACK_PATH) {
    const url = new URL(pathname, "http://localhost");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // Re-parse from the actual request URL.
    const reqUrl = ctx.url ?? new URL(pathname, "http://localhost");
    const actualCode = reqUrl.searchParams.get("code") ?? code;
    const actualState = reqUrl.searchParams.get("state") ?? state;

    if (!actualCode || !actualState) {
      sendError(ctx.res, "Missing code or state parameter.", 400);
      return true;
    }

    try {
      await xSocial.handleCallback(actualCode, actualState);
      // Render a success page for the browser.
      const html = `<!doctype html><html><head><title>Connected</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e;color:#eee;text-align:center;}h1{color:#4ade80;}p{color:#94a3b8;}</style></head><body><div><h1> Connected to X</h1><p>The teacher account is now linked. You can close this window.</p></div></body></html>`;
      const r = ctx.res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
      if (r.setHeader) {
        r.setHeader("Content-Type", "text/html; charset=utf-8");
        r.writeHead?.(200, { "Content-Type": "text/html; charset=utf-8" });
        r.end?.(html);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth failed";
      sendError(ctx.res, msg, 400);
    }
    return true;
  }

  // GET /x/connect/:teacherId — start OAuth (admin only)
  if (ctx.method === "GET" && pathname.startsWith(X_SOCIAL_CONNECT_PATH + "/")) {
    if (!requireAdminAuth(ctx)) {
      sendError(ctx.res, "Admin authentication required.", 401);
      return true;
    }
    const teacherId = pathname.slice((X_SOCIAL_CONNECT_PATH + "/").length).split("?")[0];
    if (!teacherId) {
      sendError(ctx.res, "Teacher ID is required.", 400);
      return true;
    }
    try {
      const { url, state } = xSocial.beginConnect(teacherId);
      // If called via fetch (admin panel), return JSON so the client can open the URL.
      // If called via direct browser navigation (no auth header, cookie-based), redirect.
      const isApiCall = typeof ctx.authorizationHeader === "string";
      if (isApiCall) {
        sendJson(ctx.res, { ok: true, url, state });
      } else {
        sendRedirect(ctx.res, url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start OAuth";
      sendError(ctx.res, msg, 500);
    }
    return true;
  }

  // GET /x/status/:teacherId — connection status
  if (ctx.method === "GET" && pathname.startsWith(`${X_SOCIAL_PREFIX}/status/`)) {
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/status/`.length).split("?")[0];
    if (!teacherId) {
      sendError(ctx.res, "Teacher ID is required.", 400);
      return true;
    }
    sendJson(ctx.res, xSocial.getStatus(teacherId));
    return true;
  }

  // GET /x/connected — list all connected teachers (admin only)
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/connected`) {
    if (!requireAdminAuth(ctx)) {
      sendError(ctx.res, "Admin authentication required.", 401);
      return true;
    }
    sendJson(ctx.res, { teachers: xSocial.listConnected() });
    return true;
  }

  // POST /x/disconnect/:teacherId — revoke (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/disconnect/`)) {
    if (!requireAdminAuth(ctx)) {
      sendError(ctx.res, "Admin authentication required.", 401);
      return true;
    }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/disconnect/`.length);
    if (!teacherId) {
      sendError(ctx.res, "Teacher ID is required.", 400);
      return true;
    }
    await xSocial.disconnect(teacherId);
    sendJson(ctx.res, { ok: true });
    return true;
  }

  return false;
}
