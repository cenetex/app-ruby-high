import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX, ASSETS_PREFIX, MANIFEST_PATH, SERVICE_WORKER_PATH, VIEWER_PATH } from "./constants.js";
import { VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "../viewer-shell.js";

const AGE_PATH = `${APP_ROUTE_PREFIX}/age-check`;
const COOKIE_NAME = "rh_age_group";
const COOKIE_SECONDS = 30 * 24 * 60 * 60;
const PROCESS_SECRET = randomBytes(32).toString("hex");
type AgeGroup = "eligible" | "restricted";

function secret(): string {
  return process.env.RUBY_HIGH_AGE_GATE_SECRET?.trim() || PROCESS_SECRET;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function buildAgeGroupCookie(group: AgeGroup, secure = false, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + COOKIE_SECONDS;
  const payload = `v1.${group}.${expires}`;
  return `${COOKIE_NAME}=${payload}.${signature(payload)}; Path=${APP_ROUTE_PREFIX}/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function ageGroupFromCookie(header: string | null | undefined, now = Date.now()): AgeGroup | null {
  const cookies = (header ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (cookies.length !== 1) return null;
  const value = cookies[0]!.slice(COOKIE_NAME.length + 1);
  const match = /^v1\.(eligible|restricted)\.(\d{10})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const expires = Number(match[2]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + COOKIE_SECONDS) return null;
  const payload = value.slice(0, value.lastIndexOf("."));
  if (!timingSafeEqual(Buffer.from(match[3]!, "hex"), Buffer.from(signature(payload), "hex"))) return null;
  return match[1] as AgeGroup;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function returnPath(value: string | null | undefined): string {
  if (!value || value.length > 512 || /[\\\r\n]/.test(value)) return VIEWER_PATH;
  let url: URL;
  try {
    url = new URL(value, "https://ruby-high.invalid");
  } catch {
    return VIEWER_PATH;
  }
  // Only the viewer and agent approval page need a return link. OAuth codes,
  // credentials, and other request fields stay outside this form.
  if (url.origin !== "https://ruby-high.invalid") return VIEWER_PATH;
  const allowedKeys = url.pathname === VIEWER_PATH
    ? ["ref", "rh_source", "rh_campaign", "rh_landing", "rh_entry", "role", "tab"]
    : url.pathname === `${APP_ROUTE_PREFIX}/agent/v1/connect`
      ? ["user_code"]
      : null;
  if (!allowedKeys) return VIEWER_PATH;
  const params = new URLSearchParams();
  for (const key of allowedKeys) {
    const item = url.searchParams.get(key);
    if (item && item.length <= 120 && /^[A-Za-z0-9_-]+$/.test(item)) params.set(key, item);
  }
  return `${url.pathname}${params.size ? `?${params}` : ""}`;
}

function sendPage(ctx: RouteContext, group: AgeGroup | null, message = "", status = 200): void {
  const res = ctx.res as { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void };
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", `default-src 'none'; base-uri 'none'; form-action 'self'; style-src 'unsafe-inline'; ${VIEWER_FRAME_ANCESTORS_DIRECTIVE}`);
  const next = returnPath(ctx.url ? `${ctx.url.pathname}${ctx.url.search}` : VIEWER_PATH);
  const content = group === "restricted"
    ? `<h1>Thanks for checking.</h1><p>Ruby High serves players age 13 and older.</p><p><a href="/">Visit the school page</a></p>`
    : `<h1>Welcome to Ruby High</h1><p>Please enter your age.</p><p>We use your age to choose access for this visit. We keep an age-group cookie for 30 days.</p>${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}<form method="post" action="${AGE_PATH}"><label for="age">How old are you?</label><input id="age" name="age" type="number" min="0" max="130" step="1" inputmode="numeric" autocomplete="off" required><input type="hidden" name="returnTo" value="${escapeHtml(next)}"><button type="submit">Continue</button></form>`;
  res.end(ctx.method === "HEAD" ? undefined : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ruby High — Age check</title><style>body{margin:0;background:#1a1c25;color:#f6efe3;font:18px/1.5 system-ui,sans-serif}main{max-width:32rem;margin:8vh auto;padding:2rem}h1{font-size:2rem;line-height:1.2}label,input,button{display:block}input,button{box-sizing:border-box;font:inherit;margin-top:1rem;padding:.7rem;width:100%;border-radius:.5rem}button{background:#f6cf7c;color:#1a1c25;border:0;font-weight:700;cursor:pointer}a{color:#f6cf7c}p[role=alert]{color:#ffd1c7}</style></head><body><main>${content}</main></body></html>`);
}

function firstHeader(value: string | string[] | null | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sameOrigin(ctx: RouteContext): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return false;
  try {
    const expected = ctx.callbackUrlBuilder?.("/") ?? ctx.url?.origin;
    return !!expected && new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

function exempt(ctx: RouteContext): boolean {
  const path = ctx.pathname;
  const read = ctx.method === "GET" || ctx.method === "HEAD";
  if (read && (path.startsWith(ASSETS_PREFIX) || path === MANIFEST_PATH || path === SERVICE_WORKER_PATH
    || path.startsWith(`${APP_ROUTE_PREFIX}/yearbook/`) || path.startsWith(`${APP_ROUTE_PREFIX}/first-bell/`)
    || path.startsWith(`${APP_ROUTE_PREFIX}/nft/metadata/`))) return true;
  if (path === `${APP_ROUTE_PREFIX}/admin` || path.startsWith(`${APP_ROUTE_PREFIX}/admin/`)
    || path.startsWith(`${APP_ROUTE_PREFIX}/x/`)
    || path === `${APP_ROUTE_PREFIX}/nft/internal/cosyworld/wallet-cards`) return true;
  if (ctx.method === "POST" && (path === `${APP_ROUTE_PREFIX}/billing/stripe/webhook`
    || path === `${APP_ROUTE_PREFIX}/billing/revenuecat/webhook`
    || path === `${APP_ROUTE_PREFIX}/auth/delete-account` || path === `${APP_ROUTE_PREFIX}/auth/logout`)) return true;
  if (path.startsWith(`${APP_ROUTE_PREFIX}/agent/v1/`)) {
    const suffix = path.slice(`${APP_ROUTE_PREFIX}/agent/v1`.length);
    if (ctx.method === "POST" && (suffix === "/device/code" || suffix === "/device/token")) return true;
    // Browser approval and launch always pass the age check. The agent's
    // bearer endpoints keep their own credential and scope checks.
    if (suffix !== "/connect" && suffix !== "/device/approve" && !suffix.startsWith("/launch/")) {
      return firstHeader(ctx.authorizationHeader).startsWith("Bearer ");
    }
  }
  return false;
}

/** Runs before any player identity, metrics, game state, or model work. */
export async function handleAgeGate(ctx: RouteContext): Promise<boolean> {
  if (!ctx.pathname.startsWith(`${APP_ROUTE_PREFIX}/`)) return false;
  const group = ageGroupFromCookie(ctx.cookieHeader);
  if (ctx.pathname === AGE_PATH) {
    if (ctx.method === "GET" || ctx.method === "HEAD") {
      sendPage(ctx, group);
      return true;
    }
    if (ctx.method !== "POST") {
      ctx.error(ctx.res, "Use the age-check form.", 405);
      return true;
    }
    if (!sameOrigin(ctx)) {
      ctx.error(ctx.res, "Open the age check from Ruby High.", 403);
      return true;
    }
    if (group === "restricted") {
      sendPage(ctx, group, "", 403);
      return true;
    }
    if (firstHeader(ctx.contentTypeHeader).split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded" || !ctx.readRawBody) {
      ctx.error(ctx.res, "Use the age-check form.", 415);
      return true;
    }
    const raw = await ctx.readRawBody();
    const body = new URLSearchParams(raw);
    const age = body.get("age") ?? "";
    if (raw.length > 1024 || body.getAll("age").length !== 1 || !/^(0|[1-9]\d{0,2})$/.test(age) || Number(age) > 130) {
      sendPage(ctx, null, "Please enter your age as a whole number.", 400);
      return true;
    }
    const result: AgeGroup = Number(age) >= 13 ? "eligible" : "restricted";
    const res = ctx.res as { statusCode: number; setHeader(name: string, value: string): void; end(): void };
    res.setHeader("Set-Cookie", buildAgeGroupCookie(result, ctx.isSecure === true));
    if (result === "restricted") {
      sendPage(ctx, result, "", 403);
      return true;
    }
    res.statusCode = 303;
    res.setHeader("Location", returnPath(body.get("returnTo")));
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return true;
  }
  if (exempt(ctx) || group === "eligible") return false;
  if ((ctx.method === "GET" || ctx.method === "HEAD") && (ctx.pathname === VIEWER_PATH
    || ctx.pathname === `${APP_ROUTE_PREFIX}/auth/start` || ctx.pathname === `${APP_ROUTE_PREFIX}/agent/v1/connect`)) {
    sendPage(ctx, group);
  } else {
    ctx.json(ctx.res, { error: "Please refresh Ruby High and complete the age check.", code: "age_check_required" }, 428);
  }
  return true;
}
