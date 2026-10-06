import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { handleChatRoutes } from "../chat-routes.js";
import { ageGroupFromCookie, buildAgeGroupCookie, handleAgeGate } from "../routes/age-gate.js";

afterEach(() => vi.unstubAllEnvs());

const PREFIX = "/api/apps/ruby-high";
const NOW = Date.UTC(2026, 9, 6);

function request(path: string, opts: Partial<RouteContext> = {}) {
  const headers = new Map<string, string>();
  let status = 200;
  let body = "";
  const readJsonBody = vi.fn(async () => ({}));
  const readRawBody = vi.fn(async () => "age=18");
  const getService = vi.fn();
  const ctx: RouteContext = {
    method: "GET",
    pathname: path.split("?")[0]!,
    url: new URL(`https://ruby-high.test${path}`),
    runtime: { getService },
    res: {
      set statusCode(value: number) { status = value; },
      get statusCode() { return status; },
      setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
      end(value = "") { body = value; },
    },
    error(_res, message, code = 500) { status = code; body = JSON.stringify({ error: message }); },
    json(_res, value, code = 200) { status = code; body = JSON.stringify(value); },
    callbackUrlBuilder: (value) => `https://ruby-high.test${value}`,
    readJsonBody,
    readRawBody,
    ...opts,
  };
  return { ctx, headers, readJsonBody, readRawBody, getService, get status() { return status; }, get body() { return body; } };
}

function cookie(group: "eligible" | "restricted", now = Date.now()): string {
  return buildAgeGroupCookie(group, true, now).split(";")[0]!;
}

describe("signed age group", () => {
  it("keeps only a signed group and expiry in the cookie", () => {
    const value = buildAgeGroupCookie("eligible", true, NOW);
    expect(value).toMatch(/^rh_age_group=v1\.eligible\.\d{10}\.[a-f0-9]{64};/);
    expect(value).toContain("Path=/api/apps/ruby-high/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure");
    expect(ageGroupFromCookie(value, NOW)).toBe("eligible");
    expect(ageGroupFromCookie(cookie("restricted", NOW), NOW)).toBe("restricted");
  });

  it("rejects changed, duplicate, expired, future, and old-key cookies", () => {
    const value = cookie("restricted", NOW);
    expect(ageGroupFromCookie(value.replace("restricted", "eligible"), NOW)).toBeNull();
    expect(ageGroupFromCookie(`${value}; ${value}`, NOW)).toBeNull();
    expect(ageGroupFromCookie(value, NOW + 30 * 86400_000)).toBeNull();
    expect(ageGroupFromCookie(value, NOW - 1000)).toBeNull();
    vi.stubEnv("RUBY_HIGH_AGE_GATE_SECRET", "new-secret");
    expect(ageGroupFromCookie(value, NOW)).toBeNull();
  });
});

describe("player age boundary", () => {
  it("serves the neutral form before any viewer script or identity work", async () => {
    const r = request(`${PREFIX}/viewer?rh_source=x&rh_campaign=outreach-v1&code=private`);
    expect(await handleAppRoutes(r.ctx)).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toContain('name="age" type="number" min="0" max="130"');
    expect(r.body).toContain("How old are you?");
    expect(r.body).toContain("rh_source=x&amp;rh_campaign=outreach-v1");
    expect(r.body).not.toContain("private");
    expect(r.body).not.toMatch(/<script|viewer-client|localStorage|fonts\.google|gstatic/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.getService).not.toHaveBeenCalled();
    expect(r.readJsonBody).not.toHaveBeenCalled();
    expect(r.headers.has("set-cookie")).toBe(false);
  });

  it.each([
    ["POST", "/auth/guest"], ["GET", "/auth/me"],
    ["POST", "/auth/privy"], ["POST", "/auth/passkey/register/options"],
    ["POST", "/auth/passkey/login/options"], ["GET", "/auth/callback"],
    ["GET", "/session/test"], ["POST", "/session/test/command"],
    ["POST", "/metrics/event"], ["POST", "/chat/room-turn"],
    ["POST", "/chat/character/generate"], ["POST", "/billing/checkout"],
    ["POST", "/agent/v1/device/approve"],
    ["POST", "/bug-report"], ["POST", "/packs/register"],
  ])("checks %s %s before services or request data", async (method, path) => {
    const r = request(`${PREFIX}${path}`, { method, cookieHeader: "rh_session=existing", authorizationHeader: "Bearer fake" });
    expect(await handleAppRoutes(r.ctx)).toBe(true);
    expect(r.status).toBe(428);
    expect(JSON.parse(r.body).code).toBe("age_check_required");
    expect(r.getService).not.toHaveBeenCalled();
    expect(r.readJsonBody).not.toHaveBeenCalled();
    expect(r.readRawBody).not.toHaveBeenCalled();
  });

  it("keeps a one-time agent launch until the age check is complete", async () => {
    const r = request(`${PREFIX}/agent/v1/launch/one-time-launch`);
    await handleAppRoutes(r.ctx);
    expect(r.status).toBe(200);
    expect(r.body).toContain('name="returnTo" value="/api/apps/ruby-high/agent/v1/launch/one-time-launch"');
    expect(r.getService).not.toHaveBeenCalled();
  });

  it("checks the separately exported chat boundary", async () => {
    const r = request(`${PREFIX}/auth/guest`, { method: "POST" });
    expect(await handleChatRoutes(r.ctx)).toBe(true);
    expect(r.status).toBe(428);
    expect(r.getService).not.toHaveBeenCalled();
  });

  it("lets screened players reach the normal handler", async () => {
    const r = request(`${PREFIX}/session/test/command`, { method: "POST", cookieHeader: cookie("eligible") });
    expect(await handleAgeGate(r.ctx)).toBe(false);
  });

  it.each(["/billing/stripe/webhook", "/billing/revenuecat/webhook", "/auth/delete-account", "/auth/logout", "/agent/v1/device/token"])("keeps the existing auth checks for %s", async (path) => {
    const r = request(`${PREFIX}${path}`, { method: "POST" });
    expect(await handleAgeGate(r.ctx)).toBe(false);
  });

  it("lets bearer agents use their own credential checks", async () => {
    const r = request(`${PREFIX}/agent/v1/state`, { authorizationHeader: "Bearer agent-token" });
    expect(await handleAgeGate(r.ctx)).toBe(false);
  });
});

describe("age form", () => {
  function form(age: string, opts: Partial<RouteContext> = {}) {
    return request(`${PREFIX}/age-check`, {
      method: "POST", originHeader: "https://ruby-high.test", isSecure: true,
      contentTypeHeader: "application/x-www-form-urlencoded",
      readRawBody: vi.fn(async () => `age=${age}`), ...opts,
    });
  }

  it.each(["13", "18", "130"])("accepts age %s and keeps only the group", async (age) => {
    const r = form(age);
    await handleAppRoutes(r.ctx);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${PREFIX}/viewer`);
    expect(ageGroupFromCookie(r.headers.get("set-cookie"))).toBe("eligible");
    expect(r.getService).not.toHaveBeenCalled();
    expect(r.headers.get("set-cookie")).not.toContain(`age=${age}`);
  });

  it.each(["0", "12"])("keeps age %s in the restricted group", async (age) => {
    const r = form(age);
    await handleAppRoutes(r.ctx);
    expect(r.status).toBe(403);
    expect(ageGroupFromCookie(r.headers.get("set-cookie"))).toBe("restricted");
    expect(r.body).toContain("Ruby High serves players age 13 and older.");
    expect(r.getService).not.toHaveBeenCalled();
    const retry = form("18", { cookieHeader: r.headers.get("set-cookie") });
    await handleAppRoutes(retry.ctx);
    expect(retry.status).toBe(403);
    expect(retry.headers.has("set-cookie")).toBe(false);
    expect(retry.readRawBody).not.toHaveBeenCalled();
  });

  it.each(["", "-1", "13.5", "131", "0013", "NaN", "18&age=12"])("asks for a whole age for %s", async (age) => {
    const r = form(age);
    await handleAppRoutes(r.ctx);
    expect(r.status).toBe(400);
    expect(r.headers.has("set-cookie")).toBe(false);
    expect(r.getService).not.toHaveBeenCalled();
  });

  it.each(["https://other.test", "null", ""])("checks form origin %s before reading age", async (originHeader) => {
    const r = form("18", { originHeader });
    await handleAppRoutes(r.ctx);
    expect(r.status).toBe(403);
    expect(r.readRawBody).not.toHaveBeenCalled();
  });

  it("preserves a bounded return link and rejects other destinations", async () => {
    for (const [destination, expected] of [
      [`${PREFIX}/viewer?rh_source=x&code=secret`, `${PREFIX}/viewer?rh_source=x`],
      [`${PREFIX}/agent/v1/connect?user_code=ABCD-EFGH`, `${PREFIX}/agent/v1/connect?user_code=ABCD-EFGH`],
      [`${PREFIX}/agent/v1/launch/one-time-launch`, `${PREFIX}/agent/v1/launch/one-time-launch`],
      ["https://other.test/path", `${PREFIX}/viewer`],
      ["http://[", `${PREFIX}/viewer`],
      [`${PREFIX}/auth/callback?code=secret`, `${PREFIX}/viewer`],
    ]) {
      const r = form("18", { readRawBody: async () => new URLSearchParams({ age: "18", returnTo: destination! }).toString() });
      await handleAppRoutes(r.ctx);
      expect(r.headers.get("location")).toBe(expected);
    }
  });
});
