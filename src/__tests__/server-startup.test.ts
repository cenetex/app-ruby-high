import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverEntry = readFileSync(new URL("../../scripts/server.mjs", import.meta.url), "utf8");
const devServerEntry = readFileSync(new URL("../../scripts/dev-server.mjs", import.meta.url), "utf8");
const httpServer = readFileSync(new URL("../../scripts/http-server.mjs", import.meta.url), "utf8");
const httpLimits = readFileSync(new URL("../../scripts/http-limits.mjs", import.meta.url), "utf8");
const publicBase = readFileSync(new URL("../../scripts/public-base.mjs", import.meta.url), "utf8");
const deployFly = readFileSync(new URL("../../scripts/deploy-fly.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const flyConfig = readFileSync(new URL("../../fly.toml", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");

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

  it("uses the shared host JSON body cap helper", () => {
    expect(serverEntry).toContain('from "./http-server.mjs"');
    expect(devServerEntry).toContain('from "./http-server.mjs"');
    expect(httpServer).toContain('import { bodyLimitForPath } from "./http-limits.mjs";');
    expect(httpServer).toContain("readJsonBody(req, bodyLimitForPath(pathname))");
    expect(httpLimits).not.toContain("/packs/import-");
  });

  it("keeps the dev grade-completion helper available for browser journeys", () => {
    expect(devServerEntry).toContain('url.pathname === "/dev/tick-grade"');
    expect(devServerEntry).toContain("completeCurrentGradeForDev(sessionId)");
    expect(devServerEntry).toContain("rubySvc.completeGraduation");
  });
});
