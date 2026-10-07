import { AuthService, clientSurfaceFromUserAgent } from "../services/auth-service.js";
import { AgentAccessService } from "../services/agent-access-service.js";
import { getRuntime, tryGetService } from "../services/session-identity.js";
import { TokenBucket } from "../services/rate-limit.js";
import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX, ASSETS_PREFIX, MANIFEST_PATH, SERVICE_WORKER_PATH, VIEWER_PATH } from "./constants.js";
import { VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "../viewer-shell.js";

const ENTER_PATH = `${APP_ROUTE_PREFIX}/enter`;
const ENTRY_LIMITER = new TokenBucket(30, 0.5);

function firstHeader(value: string | string[] | null | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function returnPath(value: string | null | undefined): string {
  if (!value || value.length > 512 || /[\\\r\n]/.test(value)) return VIEWER_PATH;
  let url: URL;
  try { url = new URL(value, "https://ruby-high.invalid"); } catch { return VIEWER_PATH; }
  if (url.origin !== "https://ruby-high.invalid") return VIEWER_PATH;
  const launch = new RegExp(`^${APP_ROUTE_PREFIX}/agent/v1/launch/[A-Za-z0-9_-]{1,160}$`).test(url.pathname);
  const keys = url.pathname === VIEWER_PATH
    ? ["ref", "rh_source", "rh_campaign", "rh_landing", "rh_entry", "role", "tab"]
    : url.pathname === `${APP_ROUTE_PREFIX}/agent/v1/connect` ? ["user_code"]
      : url.pathname === `${APP_ROUTE_PREFIX}/auth/start` || launch ? [] : null;
  if (!keys) return VIEWER_PATH;
  const params = new URLSearchParams();
  for (const key of keys) {
    const item = url.searchParams.get(key);
    if (item && item.length <= 120 && /^[A-Za-z0-9_-]+$/.test(item)) params.set(key, item);
  }
  return `${url.pathname}${params.size ? `?${params}` : ""}`;
}

function sameOrigin(ctx: RouteContext): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return false;
  try {
    const expected = ctx.callbackUrlBuilder?.("/") ?? ctx.url?.origin;
    return !!expected && new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}

function sendPage(ctx: RouteContext, status = 200): void {
  const res = ctx.res as { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void };
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", `default-src 'none'; base-uri 'none'; form-action 'self'; style-src 'unsafe-inline'; ${VIEWER_FRAME_ANCESTORS_DIRECTIVE}`);
  const next = returnPath(ctx.url ? `${ctx.url.pathname}${ctx.url.search}` : VIEWER_PATH);
  res.end(ctx.method === "HEAD" ? undefined : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ruby High — Welcome</title><style>body{margin:0;background:#1a1c25;color:#f6efe3;font:18px/1.5 system-ui,sans-serif}main{max-width:32rem;margin:8vh auto;padding:2rem}h1{font-size:2rem;line-height:1.2}button{box-sizing:border-box;font:inherit;margin-top:1rem;padding:.7rem;width:100%;border-radius:.5rem;background:#f6cf7c;color:#1a1c25;border:0;font-weight:700;cursor:pointer}a{color:#f6cf7c}</style></head><body><main><h1>Confirm you are 13+?</h1><form method="post" action="${ENTER_PATH}"><input type="hidden" name="returnTo" value="${escapeHtml(next)}"><button name="confirm13Plus" value="yes" type="submit">Yes, continue</button></form><p><a href="/">Leave</a> · <a href="${APP_ROUTE_PREFIX}/privacy">Privacy</a></p></main></body></html>`);
}

function exempt(ctx: RouteContext): boolean {
  const path = ctx.pathname;
  const read = ctx.method === "GET" || ctx.method === "HEAD";
  if (read && (path.startsWith(ASSETS_PREFIX) || path === MANIFEST_PATH || path === SERVICE_WORKER_PATH
    || path.startsWith(`${APP_ROUTE_PREFIX}/yearbook/`) || path.startsWith(`${APP_ROUTE_PREFIX}/first-bell/`)
    || path.startsWith(`${APP_ROUTE_PREFIX}/nft/metadata/`) || path === `${APP_ROUTE_PREFIX}/world`
    || path === `${APP_ROUTE_PREFIX}/world/events` || path.startsWith(`${APP_ROUTE_PREFIX}/cohort`))) return true;
  if (path === `${APP_ROUTE_PREFIX}/admin` || path.startsWith(`${APP_ROUTE_PREFIX}/admin/`)
    || path.startsWith(`${APP_ROUTE_PREFIX}/x/`)
    || path === `${APP_ROUTE_PREFIX}/nft/internal/cosyworld/wallet-cards`) return true;
  if (ctx.method === "POST" && (path === `${APP_ROUTE_PREFIX}/billing/stripe/webhook`
    || path === `${APP_ROUTE_PREFIX}/billing/revenuecat/webhook`
    || path === `${APP_ROUTE_PREFIX}/auth/delete-account` || path === `${APP_ROUTE_PREFIX}/auth/logout`
    || path === `${APP_ROUTE_PREFIX}/auth/guest`)) return true;
  if (path.startsWith(`${APP_ROUTE_PREFIX}/agent/v1/`)) {
    const suffix = path.slice(`${APP_ROUTE_PREFIX}/agent/v1`.length);
    if (ctx.method === "POST" && (suffix === "/device/code" || suffix === "/device/token")) return true;
    if (suffix !== "/connect" && suffix !== "/device/approve" && !suffix.startsWith("/launch/")) {
      return firstHeader(ctx.authorizationHeader).startsWith("Bearer ");
    }
  }
  return false;
}

/** The entry answer is used only in this request. Auth stores its usual session. */
export async function handleEntryConfirmation(ctx: RouteContext): Promise<boolean> {
  if (!ctx.pathname.startsWith(`${APP_ROUTE_PREFIX}/`)) return false;
  if (ctx.pathname !== ENTER_PATH && exempt(ctx)) return false;
  // Let the owning route handle malformed path encodings.
  try { decodeURIComponent(ctx.pathname); } catch { return false; }
  const runtime = getRuntime(ctx.runtime);
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);

  if (ctx.pathname === ENTER_PATH) {
    if (ctx.method === "GET" || ctx.method === "HEAD") { sendPage(ctx); return true; }
    if (ctx.method !== "POST") { ctx.error(ctx.res, "Use the confirmation button.", 405); return true; }
    if (!sameOrigin(ctx)) { ctx.error(ctx.res, "Open the confirmation from Ruby High.", 403); return true; }
    if (firstHeader(ctx.contentTypeHeader).split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded" || !ctx.readRawBody) {
      ctx.error(ctx.res, "Use the confirmation button.", 415); return true;
    }
    if (!ENTRY_LIMITER.take(ctx.clientIp ?? "local")) { ctx.error(ctx.res, "Please wait before trying again.", 429); return true; }
    const raw = await ctx.readRawBody();
    if (raw.length > 1024) { sendPage(ctx, 400); return true; }
    const body = new URLSearchParams(raw);
    if (body.getAll("confirm13Plus").length !== 1 || body.get("confirm13Plus") !== "yes") {
      sendPage(ctx, 400); return true;
    }
    if (!auth) { ctx.error(ctx.res, "Ruby High session service is starting.", 503); return true; }
    const { token } = await auth.createGuestSession(auth.parseSessionToken(ctx.cookieHeader), null, clientSurfaceFromUserAgent(ctx.userAgentHeader));
    const res = ctx.res as { statusCode: number; setHeader(name: string, value: string): void; end(): void };
    // Only the ordinary game-session cookie is issued. The submitted answer
    // never reaches account records, metrics, saved game state, or prompts.
    res.setHeader("Set-Cookie", auth.buildSessionCookie(token, { secure: ctx.isSecure === true }));
    res.statusCode = 303;
    res.setHeader("Location", returnPath(body.get("returnTo")));
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return true;
  }

  const session = auth?.resolve(auth.parseSessionToken(ctx.cookieHeader));
  const agentSession = tryGetService<AgentAccessService>(runtime, AgentAccessService.serviceType)?.stateKeyForViewerCookie(ctx.cookieHeader);
  if (session || agentSession) return false;
  if ((ctx.method === "GET" || ctx.method === "HEAD") && (ctx.pathname === VIEWER_PATH
    || ctx.pathname === `${APP_ROUTE_PREFIX}/auth/start` || ctx.pathname === `${APP_ROUTE_PREFIX}/agent/v1/connect`
    || ctx.pathname.startsWith(`${APP_ROUTE_PREFIX}/agent/v1/launch/`))) {
    sendPage(ctx);
    return true;
  }
  // Embedded engine hosts can supply their own identity service. The hosted
  // Ruby High server always registers AuthService.
  if (!auth) return false;
  ctx.json(ctx.res, { error: "Open Ruby High and confirm you are 13+ to start a session.", code: "entry_confirmation_required" }, 428);
  return true;
}
