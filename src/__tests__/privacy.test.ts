import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { privacyConfigurationErrors } from "../routes/privacy.js";

function setContact() {
  vi.stubEnv("RUBY_HIGH_PRIVACY_OPERATOR", "Ruby <High>");
  vi.stubEnv("RUBY_HIGH_PRIVACY_EMAIL", "privacy@example.invalid");
  vi.stubEnv("RUBY_HIGH_PRIVACY_ADDRESS", "123 Test Street");
  vi.stubEnv("RUBY_HIGH_PRIVACY_PHONE", "Test phone");
}
function request(path = "/privacy", method = "GET") {
  const headers = new Map<string, string>();
  const res = { statusCode: 0, body: "", setHeader(key: string, value: string) { headers.set(key.toLowerCase(), value); }, end(body?: string) { this.body = body ?? ""; } };
  const ctx = { pathname: path, method, res, runtime: { getService: () => null }, readJsonBody: vi.fn(), error(_res: unknown, message: string, status = 500) { res.statusCode = status; res.body = message; } } as unknown as RouteContext;
  return { ctx, res, headers };
}
afterEach(() => vi.unstubAllEnvs());
describe("privacy notice", () => {
  it.each(["/privacy", "/privacy/", "/api/apps/ruby-high/privacy"])("opens %s before entry without a session", async path => {
    setContact();
    const r = request(path);
    expect(await handleAppRoutes(r.ctx)).toBe(true);
    expect(r.res.statusCode).toBe(200);
    expect(r.res.body).toContain("Ruby &lt;High&gt;");
    expect(r.res.body).toContain("privacy@example.invalid");
    expect(r.res.body).toContain("90 days");
    expect(r.res.body).not.toMatch(/<script|<form|<input/);
    expect(r.headers.get("set-cookie")).toBeUndefined();
    expect(r.ctx.readJsonBody).not.toHaveBeenCalled();
  });
  it("serves headers only for HEAD", async () => {
    setContact(); const r = request("/privacy", "HEAD");
    await handleAppRoutes(r.ctx);
    expect(r.res.statusCode).toBe(200); expect(r.res.body).toBe("");
  });
  it("keeps the release check open until real contact details are supplied", async () => {
    vi.stubEnv("RUBY_HIGH_PRIVACY_EMAIL", "");
    expect(privacyConfigurationErrors()).toHaveLength(1);
    const r = request(); await handleAppRoutes(r.ctx);
    expect(r.res.statusCode).toBe(503);
  });
  it("rejects indefinite retention in the privacy release check", () => {
    setContact(); vi.stubEnv("RUBY_HIGH_STATE_TTL_SECONDS", "0");
    expect(privacyConfigurationErrors()).toEqual([expect.stringContaining("positive retention")]);
  });
});
