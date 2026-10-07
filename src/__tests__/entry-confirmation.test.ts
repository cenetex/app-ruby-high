import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleEntryConfirmation } from "../routes/entry-confirmation.js";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { AuthService } from "../services/auth-service.js";
import { StateStore } from "../services/state-store.js";

const BASE = "https://ruby-high.test";
const PREFIX = "/api/apps/ruby-high";
let directory: string;
let store: StateStore;
let auth: AuthService;
let requestId = 0;

function request(path = `${PREFIX}/viewer`, options: {
  method?: string;
  body?: string;
  jsonBody?: unknown;
  origin?: string;
  contentType?: string;
  cookie?: string;
  authService?: boolean;
  authorization?: string;
  agentSession?: string;
} = {}) {
  const url = new URL(path, BASE);
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    body: "",
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value?: string) { this.body = value ?? ""; },
  };
  const readJsonBody = vi.fn(async () => options.jsonBody ?? {});
  const readRawBody = vi.fn(async () => options.body ?? "confirm13Plus=yes");
  const ctx: RouteContext = {
    method: options.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: {
      getService(type: string) {
        if (type === AuthService.serviceType) return options.authService === false ? null : auth;
        if (type === "ruby-high-agent-access" && options.agentSession) {
          return { stateKeyForViewerCookie: () => options.agentSession };
        }
        return null;
      },
    },
    res: response,
    cookieHeader: options.cookie ?? null,
    originHeader: options.origin ?? BASE,
    contentTypeHeader: options.contentType ?? "application/x-www-form-urlencoded",
    authorizationHeader: options.authorization ?? null,
    clientIp: `entry-test-${++requestId}`,
    callbackUrlBuilder: (path) => `${BASE}${path}`,
    isSecure: true,
    readJsonBody,
    readRawBody,
    json(_res, data, status = 200) { response.statusCode = status; response.body = JSON.stringify(data); },
    error(_res, message, status = 500) { response.statusCode = status; response.body = JSON.stringify({ error: message }); },
  };
  return { ctx, response, headers, readJsonBody, readRawBody };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ruby-high-entry-"));
  store = new StateStore(join(directory, "state.json"));
  auth = await AuthService.start({} as never, store);
});

afterEach(async () => {
  await auth.stop();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("13+ entry confirmation", () => {
  it("serves a single confirmation before scripts, cookies, and player records", async () => {
    const route = request();
    expect(await handleAppRoutes(route.ctx)).toBe(true);
    expect(route.response.statusCode).toBe(200);
    expect(route.response.body).toContain("Confirm you are 13+?");
    expect(route.response.body).toContain('name="confirm13Plus" value="yes"');
    expect(route.response.body).not.toMatch(/<script|type="(?:number|date)"|name="(?:age|dob|birth)/i);
    expect(route.headers.get("set-cookie")).toBeUndefined();
    expect(route.headers.get("cache-control")).toBe("no-store");
    expect(route.readJsonBody).not.toHaveBeenCalled();
    expect(await store.loadAuth()).toEqual({ users: [], sessions: [] });
    expect((await store.load()).size).toBe(0);
  });

  it("discards the answer and saves exactly the usual guest and session fields", async () => {
    const route = request(`${PREFIX}/enter`, { method: "POST", body: "confirm13Plus=yes&age=13&birthDate=2013-01-01" });
    expect(await handleEntryConfirmation(route.ctx)).toBe(true);
    expect(route.response.statusCode).toBe(303);
    expect(route.headers.get("location")).toBe(`${PREFIX}/viewer`);
    expect(route.headers.get("set-cookie")).toMatch(/^rh_session=[^;]+;.*HttpOnly.*Secure/);
    await store.flush();
    const saved = await store.loadAuth();
    expect(saved.users).toHaveLength(1);
    expect(saved.sessions).toHaveLength(1);
    expect(Object.keys(saved.users[0]).sort()).toEqual(["createdAt", "label", "lastLoginAt", "provider", "providerUserHash", "userId"]);
    expect(Object.keys(saved.sessions[0]).sort()).toEqual(["createdAt", "expiresAt", "provider", "token", "userId"]);
    const persisted = await readFile(join(directory, "state.json"), "utf8");
    expect(persisted).not.toMatch(/confirm13Plus|birthDate|2013-01-01|"age"|ageGroup|rh_age/);
    expect((await store.load()).size).toBe(0);
  });

  it.each(["", "confirm13Plus=no", "confirm13Plus=true", "confirm13Plus=yes&confirm13Plus=no", "returnTo=" + "x".repeat(1025)])(
    "requires one affirmative button value for %s", async (body) => {
      const route = request(`${PREFIX}/enter`, { method: "POST", body });
      await handleEntryConfirmation(route.ctx);
      expect(route.response.statusCode).toBe(400);
      expect(route.headers.get("set-cookie")).toBeUndefined();
      expect(auth.sessionCount()).toBe(0);
    },
  );

  it.each(["https://other.test", "null", ""])("checks the form origin %s before reading its body", async (origin) => {
    const route = request(`${PREFIX}/enter`, { method: "POST", origin });
    await handleEntryConfirmation(route.ctx);
    expect(route.response.statusCode).toBe(403);
    expect(route.readRawBody).not.toHaveBeenCalled();
    expect(auth.sessionCount()).toBe(0);
  });

  it("requires the plain form content type", async () => {
    const route = request(`${PREFIX}/enter`, { method: "POST", contentType: "application/json" });
    await handleEntryConfirmation(route.ctx);
    expect(route.response.statusCode).toBe(415);
    expect(route.readRawBody).not.toHaveBeenCalled();
  });

  it.each([`${PREFIX}/session`, `${PREFIX}/command`, `${PREFIX}/metrics/event`, `${PREFIX}/auth/passkey/register/options`])(
    "requires entry before player API %s", async (path) => {
      const route = request(path, { method: "POST" });
      expect(await handleAppRoutes(route.ctx)).toBe(true);
      expect(route.response.statusCode).toBe(428);
      expect(JSON.parse(route.response.body).code).toBe("entry_confirmation_required");
      expect(route.readJsonBody).not.toHaveBeenCalled();
      expect(auth.sessionCount()).toBe(0);
    },
  );

  it("opens an existing normal session", async () => {
    const guest = await auth.createGuestSession();
    const route = request(`${PREFIX}/viewer`, { cookie: `rh_session=${guest.token}` });
    expect(await handleEntryConfirmation(route.ctx)).toBe(false);
    expect(route.headers.get("set-cookie")).toBeUndefined();
  });

  it("keeps the normal viewer access for a valid agent session", async () => {
    const route = request(`${PREFIX}/viewer`, { agentSession: "rh:agent:student" });
    expect(await handleEntryConfirmation(route.ctx)).toBe(false);
  });

  it.each([`${PREFIX}/auth/logout`, `${PREFIX}/auth/delete-account`, `${PREFIX}/billing/stripe/webhook`, `${PREFIX}/agent/v1/device/token`])(
    "keeps route-owned checks for %s", async (path) => {
      const route = request(path, { method: "POST" });
      expect(await handleEntryConfirmation(route.ctx)).toBe(false);
    },
  );

  it.each(["https://other.test/", "//other.test/", "/\\other.test/", `${PREFIX}/admin`, `${PREFIX}/auth/start?secret=anything`])(
    "bounds the return link %s", async (returnTo) => {
      const route = request(`${PREFIX}/enter`, { method: "POST", body: new URLSearchParams({ confirm13Plus: "yes", returnTo }).toString() });
      await handleEntryConfirmation(route.ctx);
      expect(route.headers.get("location")).toBe(returnTo.startsWith(`${PREFIX}/auth/start`) ? `${PREFIX}/auth/start` : `${PREFIX}/viewer`);
    },
  );

  it("keeps bounded campaign and agent links", async () => {
    for (const path of [`${PREFIX}/viewer?rh_source=discord&rh_campaign=launch&secret=discard`, `${PREFIX}/agent/v1/connect?user_code=ABCD-1234`, `${PREFIX}/agent/v1/launch/example_token`]) {
      const route = request(path);
      await handleEntryConfirmation(route.ctx);
      expect(route.response.body).toContain(path.replace("&secret=discard", "").replaceAll("&", "&amp;"));
    }
  });

  it("supports the form with a missing session service error", async () => {
    const route = request(`${PREFIX}/enter`, { method: "POST", authService: false });
    await handleEntryConfirmation(route.ctx);
    expect(route.response.statusCode).toBe(503);
    expect(route.headers.get("set-cookie")).toBeUndefined();
  });

});
