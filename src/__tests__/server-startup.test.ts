import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverEntry = readFileSync(new URL("../../scripts/server.mjs", import.meta.url), "utf8");
const devServerEntry = readFileSync(new URL("../../scripts/dev-server.mjs", import.meta.url), "utf8");
const httpLimits = readFileSync(new URL("../../scripts/http-limits.mjs", import.meta.url), "utf8");
const publicBase = readFileSync(new URL("../../scripts/public-base.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const flyConfig = readFileSync(new URL("../../fly.toml", import.meta.url), "utf8");

describe("production startup guardrails", () => {
  it("keeps readiness unhealthy until services finish booting", () => {
    expect(serverEntry).toContain('url.pathname === "/livez"');
    expect(serverEntry).toMatch(/url\.pathname === "\/health"[\s\S]+url\.pathname === "\/healthz"[\s\S]+url\.pathname === "\/readyz"/);
    expect(serverEntry).toContain('sendJson(res, { ...healthPayload(), ok: false, status: "starting", t: Date.now() }, 503)');
    expect(serverEntry).not.toContain('res.end(JSON.stringify({ ...healthPayload(), status: "starting"');
  });

  it("serves a retrying HTML shell for early viewer loads", () => {
    expect(serverEntry).toContain('function sendStartupHtml(res)');
    expect(serverEntry).toContain('res.setHeader("Content-Type", "text/html; charset=utf-8")');
    expect(serverEntry).toContain('res.setHeader("Cache-Control", "no-store, max-age=0")');
    expect(serverEntry).toContain('res.setHeader("Retry-After", "1")');
    expect(serverEntry).toMatch(/req\.method === "GET" && url\.pathname === VIEWER_PATH\) \{\s+sendStartupHtml\(res\);/);
  });

  it("points platform checks at readiness with enough boot grace", () => {
    expect(dockerfile).toContain("--start-period=30s");
    expect(dockerfile).toContain("+'/health'");
    expect(flyConfig).toContain('grace_period = "30s"');
    expect(flyConfig).toContain('path = "/health"');
  });

  it("copies npm install policy into Docker before npm ci", () => {
    expect(dockerfile).toContain("COPY package.json package-lock.json* .npmrc ./");
  });

  it("packages every runtime script imported by the production server", () => {
    expect(dockerfile).toContain("COPY scripts/server.mjs ./scripts/server.mjs");
    const relativeScriptImports = [...serverEntry.matchAll(/from "\.\/([^"]+\.mjs)"/g)]
      .map((match) => match[1]);
    expect(relativeScriptImports).toContain("http-limits.mjs");
    for (const file of relativeScriptImports) {
      expect(dockerfile).toContain(`COPY scripts/${file} ./scripts/${file}`);
    }
  });

  it("normalizes the dead legacy public host before building callbacks", () => {
    expect(publicBase).toContain('export const CANONICAL_PUBLIC_ORIGIN = "https://ruby-high.ai";');
    expect(publicBase).toContain('"rubyhighai.com"');
    expect(publicBase).toContain('"www.rubyhighai.com"');
    expect(serverEntry).toContain("const PUBLIC_BASE = normalizePublicOrigin(process.env.RUBY_HIGH_PUBLIC_BASE);");
    expect(serverEntry).toContain("return normalizePublicOrigin(requestBase) ?? requestBase;");
    expect(devServerEntry).toContain("const PUBLIC_BASE = normalizePublicOrigin(process.env.RUBY_HIGH_PUBLIC_BASE) ?? `http://${HOST}:${PORT}`;");
  });

  it("serves the static landing page at the root from Fly", () => {
    expect(serverEntry).toContain('import { serveLandingRequest } from "./landing.mjs";');
    expect(serverEntry).toMatch(/await serveLandingRequest\(req, res, url\)/);
    expect(serverEntry).not.toContain("isLandingHost");
    expect(serverEntry).not.toContain("ROOT_REDIRECT");
    expect(dockerfile).toContain("COPY landing ./landing");
  });

  it("uses the shared host JSON body cap helper", () => {
    for (const entry of [serverEntry, devServerEntry]) {
      expect(entry).toContain('import { bodyLimitForPath } from "./http-limits.mjs";');
      expect(entry).toContain("readJsonBody(req, bodyLimitForPath(url.pathname))");
    }
    expect(httpLimits).not.toContain("/packs/import-");
  });
});
