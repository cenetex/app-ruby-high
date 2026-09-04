import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverEntry = readFileSync(new URL("../../scripts/server.mjs", import.meta.url), "utf8");
const devServerEntry = readFileSync(new URL("../../scripts/dev-server.mjs", import.meta.url), "utf8");
const httpServer = readFileSync(new URL("../../scripts/http-server.mjs", import.meta.url), "utf8");
const httpLimits = readFileSync(new URL("../../scripts/http-limits.mjs", import.meta.url), "utf8");
const landingServer = readFileSync(new URL("../../scripts/landing.mjs", import.meta.url), "utf8");
const publicBase = readFileSync(new URL("../../scripts/public-base.mjs", import.meta.url), "utf8");
const deployFly = readFileSync(new URL("../../scripts/deploy-fly.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const flyConfig = readFileSync(new URL("../../fly.toml", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../../.github/workflows/deploy-fly.yml", import.meta.url), "utf8");
const smokeWorkflow = readFileSync(new URL("../../.github/workflows/smoke.yml", import.meta.url), "utf8");

describe("production startup guardrails", () => {
  it("keeps readiness unhealthy until services finish booting", () => {
    expect(serverEntry).toContain('url.pathname === "/livez"');
    expect(serverEntry).toMatch(/url\.pathname === "\/health"[\s\S]+url\.pathname === "\/healthz"[\s\S]+url\.pathname === "\/readyz"/);
    expect(serverEntry).toContain('sendJson(res, { ...healthPayload(), ok: false, status: "starting", t: Date.now() }, 503)');
    expect(serverEntry).not.toContain('res.end(JSON.stringify({ ...healthPayload(), status: "starting"');
  });

  it("exposes loaded curriculum counts in host health payloads", () => {
    for (const entry of [serverEntry, devServerEntry]) {
      expect(entry).toContain("buildHealthPayload({ stateStore, facultyService: facultySvc");
    }
    expect(httpServer).toContain('pack: "ruby-high-original"');
    expect(httpServer).toContain("totalQuestions");
    expect(httpServer).toContain("byFaculty");
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

  it("stamps local Fly deploys with a dirty-tree fingerprint when needed", () => {
    const pkg = JSON.parse(packageJson);
    expect(pkg.scripts.deploy).toBe("node scripts/deploy-fly.mjs");
    expect(deployFly).toContain("dirtyFingerprint");
    expect(deployFly).toContain('"status", "--porcelain=v1"');
    expect(deployFly).toContain('`${head}-dirty-${dirtyFingerprint()}`');
    expect(deployFly).toContain("RUBY_HIGH_BUILD=");
  });

  it("copies npm install policy into Docker before npm ci", () => {
    expect(dockerfile).toContain("COPY package.json package-lock.json* .npmrc ./");
  });

  it("keeps the remote Docker context allowlisted and excludes source-only art", () => {
    expect(dockerignore).toMatch(/^\*$/m);
    for (const path of [
      "Dockerfile",
      "package.json",
      "package-lock.json",
      ".npmrc",
      "tsconfig.json",
      "tsup.config.ts",
      "src/**",
      "assets/**",
      "landing/**",
    ]) {
      expect(dockerignore).toContain(`!${path}`);
    }
    expect(dockerignore).toContain("assets/nft/grok-sources/");
  });

  it("packages every runtime script imported by the production server", () => {
    expect(dockerfile).toContain("COPY scripts/server.mjs ./scripts/server.mjs");
    const relativeScriptImports = [...serverEntry.matchAll(/from "\.\/([^"]+\.mjs)"/g)]
      .map((match) => match[1]);
    expect(relativeScriptImports).toContain("http-server.mjs");
    for (const file of relativeScriptImports) {
      expect(dockerfile).toContain(`COPY scripts/${file} ./scripts/${file}`);
      expect(dockerignore).toContain(`!scripts/${file}`);
    }
  });

  it("starts and stops Ruby High background schedulers in production", () => {
    expect(serverEntry).toContain("svc.startPhotoPostScheduler()");
    expect(serverEntry).toContain("svc.startRotationScheduler()");
    expect(serverEntry).toContain("rubySvc?.stop?.()");
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

  it("redirects public traffic to the passkey origin while keeping health checks direct", () => {
    expect(serverEntry).toContain("function redirectToCanonicalHost(req, res, url)");
    expect(serverEntry).toContain("res.statusCode = 308");
    expect(serverEntry).toContain('res.setHeader("Vary", "Host, X-Forwarded-Host")');
    expect(serverEntry.indexOf("if (redirectToCanonicalHost(req, res, url))")).toBeGreaterThan(
      serverEntry.indexOf('url.pathname === "/health"'),
    );
    expect(serverEntry.indexOf("if (redirectToCanonicalHost(req, res, url))")).toBeLessThan(
      serverEntry.indexOf("await serveLandingRequest(req, res, url)"),
    );
  });

  it("runs production smoke checks on the canonical passkey origin", () => {
    const pkg = JSON.parse(packageJson);
    expect(pkg.scripts["smoke:prod"]).toBe("node scripts/smoke.mjs https://ruby-high.ai");
    expect(deployWorkflow).toContain("run: node scripts/smoke.mjs https://ruby-high.ai");
    expect(deployWorkflow).toContain("url: https://ruby-high.ai");
    expect(smokeWorkflow).toContain("run: node scripts/smoke.mjs https://ruby-high.ai");
    for (const source of [deployWorkflow, smokeWorkflow]) {
      expect(source).not.toContain("ruby-high.fly.dev");
    }
  });

  it("uses the shared host JSON body cap helper", () => {
    expect(serverEntry).toContain('from "./http-server.mjs"');
    expect(devServerEntry).toContain('from "./http-server.mjs"');
    expect(httpServer).toContain('import { bodyLimitForPath } from "./http-limits.mjs";');
    expect(httpServer).toContain("readJsonBody(req, bodyLimitForPath(pathname))");
    expect(httpLimits).not.toContain("/packs/import-");
  });

  it("applies baseline HTTP hardening and bounded request parsing", () => {
    expect(httpServer).toContain("applyHttpSecurityHeaders");
    expect(httpServer).toContain('"X-Content-Type-Options", "nosniff"');
    expect(httpServer).toContain('"Referrer-Policy", "strict-origin-when-cross-origin"');
    expect(httpServer).toContain('"Strict-Transport-Security"');
    expect(landingServer).toContain("frame-ancestors 'none'");
    for (const entry of [serverEntry, devServerEntry]) {
      expect(entry).toContain("server.headersTimeout = 15_000");
      expect(entry).toContain("server.requestTimeout = 30_000");
      expect(entry).toContain("server.maxHeadersCount = 100");
    }
  });

  it("trusts proxy identity headers only when explicitly configured", () => {
    expect(httpServer).toContain("deriveClientIp(req, trustProxy = false)");
    expect(serverEntry).toContain("RUBY_HIGH_TRUST_PROXY");
    expect(serverEntry).toContain("trustProxy: TRUST_PROXY");
    expect(serverEntry).toContain('new URL(PUBLIC_BASE).protocol !== "https:"');
    expect(flyConfig).toContain('RUBY_HIGH_TRUST_PROXY = "true"');
    expect(flyConfig).toContain('RUBY_HIGH_PUBLIC_BASE = "https://ruby-high.ai"');
  });

  it("rejects absolute or authority-form request targets", () => {
    expect(httpServer).toContain("parseRequestUrl(raw, base)");
    expect(httpServer).toContain('target.startsWith("//")');
    expect(serverEntry).toContain("parseRequestUrl(req.url, PUBLIC_BASE");
    expect(devServerEntry).toContain("parseRequestUrl(req.url, PUBLIC_BASE)");
  });

  it("does not expose unexpected production exception details", () => {
    expect(serverEntry).toContain('sendJson(res, { error: "Internal server error." }, 500)');
    expect(serverEntry).not.toContain('sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500)');
  });

  it("keeps the dev grade-completion helper available for browser journeys", () => {
    expect(devServerEntry).toContain('url.pathname === "/dev/tick-grade"');
    expect(devServerEntry).toContain("completeCurrentGradeForDev(sessionId)");
    expect(devServerEntry).toContain("rubySvc.graduationGate(sessionId)");
    expect(devServerEntry).toContain("...graduationGate.requiredFacultyIds");
    expect(devServerEntry).toContain("...graduationGate.eligibleFacultyIds");
    expect(devServerEntry).toContain("graduationGate.requiredRooms");
    expect(devServerEntry).toContain("rubySvc.completeGraduation");
    expect(devServerEntry).not.toContain("state.contentPack?.faculty ?? facultySvc.faculty()");
  });
});
