import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { assetCacheControlFor } from "../routes/assets.js";
import { setGeneratedPortraitAssetLoaderForTest } from "../services/generated-portrait-assets.js";
import { renderViewerHtml } from "../viewer.js";

function makeResponse() {
  const headers = new Map<string, string>();
  let body: string | Buffer | undefined;
  const res = {
    statusCode: 0,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    removeHeader(name: string) {
      headers.delete(name.toLowerCase());
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(value?: string | Buffer) {
      body = value;
      this.headersSent = true;
    },
  };
  return {
    res,
    headers,
    get text() {
      return Buffer.isBuffer(body) ? body.toString("utf8") : (body ?? "");
    },
    get raw() {
      return body;
    },
  };
}

function compactScript(value: string): string {
  return value.replace(/\s+/g, "");
}

function cspDirective(csp: string, name: string): string {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()} `)) ?? "";
}

async function withPrivyBundleFixture(run: () => Promise<void>): Promise<void> {
  const distDir = new URL("../../dist/", import.meta.url);
  const bundleUrl = new URL("viewer-privy-client.global.js", distDir);
  let createdFixture = false;
  try {
    await access(bundleUrl);
  } catch {
    await mkdir(distDir, { recursive: true });
    await writeFile(bundleUrl, "globalThis.RubyHighPrivyClientModule = {};\n");
    createdFixture = true;
  }
  try {
    await run();
  } finally {
    if (createdFixture) await rm(bundleUrl, { force: true });
  }
}

function makeCtx(
  pathname: string,
  response: ReturnType<typeof makeResponse>,
  method = "GET",
  acceptEncoding?: string,
): RouteContext {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    method,
    pathname: url.pathname,
    url,
    runtime: null,
    res: response.res as never,
    cookieHeader: null,
    error: (_res, message, status = 500) => {
      response.res.statusCode = status;
      response.res.end(JSON.stringify({ error: message }));
    },
    json: (_res, data, status = 200) => {
      response.res.statusCode = status;
      response.res.end(JSON.stringify(data));
    },
    acceptEncoding,
    readJsonBody: async () => ({}),
  };
}

describe("PWA surface", () => {
  it("links install metadata and registers the scoped service worker from the viewer", () => {
    const html = renderViewerHtml({
      agentName: "Ruby",
      sessionId: "rh:anonymous",
      apiBase: "/api/apps/ruby-high",
      role: "human",
    });

    expect(html).toContain('rel="manifest" href="/api/apps/ruby-high/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/api/apps/ruby-high/assets/ruby.png"');
    expect(compactScript(html)).toContain(compactScript('["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)'));
    expect(html).toContain("navigator.serviceWorker.getRegistrations()");
    expect(compactScript(html)).toContain(compactScript('navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })'));
  });

  it("serves a valid app manifest", async () => {
    const response = makeResponse();
    const handled = await handleAppRoutes(makeCtx("/api/apps/ruby-high/manifest.webmanifest", response));

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/manifest\+json/);

    const manifest = JSON.parse(response.text);
    expect(manifest.name).toBe("Ruby High");
    expect(manifest.start_url).toBe("/api/apps/ruby-high/viewer");
    expect(manifest.scope).toBe("/api/apps/ruby-high/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons[0].src).toBe("/api/apps/ruby-high/assets/ruby.png");
  });

  it("gzips the viewer shell when the browser accepts gzip", async () => {
    const response = makeResponse();
    const handled = await handleAppRoutes(makeCtx("/api/apps/ruby-high/viewer", response, "GET", "gzip, br"));

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(Buffer.isBuffer(response.raw)).toBe(true);

    const text = gunzipSync(response.raw as Buffer).toString("utf8");
    expect(text).toContain("<title>Ruby High");
    expect(text).toContain("/api/apps/ruby-high/auth/guest");
    const script = text.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const scriptHash = `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
    const scriptSrc = cspDirective(csp, "script-src");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(scriptHash);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("serves transparent teacher sticker assets", async () => {
    const response = makeResponse();
    const handled = await handleAppRoutes(makeCtx("/api/apps/ruby-high/assets/teachers/ruby-sticker.png", response));

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/image\/png/);
    expect(Buffer.isBuffer(response.raw)).toBe(true);

    const body = response.raw as Buffer;
    expect(body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(body.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(body[25]).toBe(6);
  });

  it("keeps built-in student face portraits square PNGs", async () => {
    const studentIds = ["lyra", "sami", "ravi", "indra", "mika", "noor"] as const;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    for (const studentId of studentIds) {
      const body = await readFile(new URL(`../../assets/students/${studentId}-face.png`, import.meta.url));
      expect(body.subarray(0, 8).equals(pngSignature), `${studentId}-face.png should be encoded as PNG`).toBe(true);
      expect(body.subarray(12, 16).toString("ascii"), `${studentId}-face.png should start with IHDR`).toBe("IHDR");
      expect(body.readUInt32BE(16), `${studentId}-face.png width`).toBe(1024);
      expect(body.readUInt32BE(20), `${studentId}-face.png height`).toBe(1024);
    }
  });

  it("serves generated portrait assets through the app route", async () => {
    const restore = setGeneratedPortraitAssetLoaderForTest(async (name) => {
      expect(name).toBe("graduation-photo/e68eb7327208097ea3088baab551269c.png");
      return {
        body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        mime: "image/png",
        etag: "\"generated-test\"",
        cacheControl: "public, max-age=31536000, immutable",
      };
    });
    try {
      const getResponse = makeResponse();
      const getHandled = await handleAppRoutes(makeCtx(
        "/api/apps/ruby-high/assets/generated/graduation-photo/e68eb7327208097ea3088baab551269c.png",
        getResponse,
      ));
      expect(getHandled).toBe(true);
      expect(getResponse.res.statusCode).toBe(200);
      expect(getResponse.headers.get("content-type")).toBe("image/png");
      expect(getResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(getResponse.headers.get("etag")).toBe("\"generated-test\"");
      expect((getResponse.raw as Buffer).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

      const headResponse = makeResponse();
      const headHandled = await handleAppRoutes(makeCtx(
        "/api/apps/ruby-high/assets/generated/graduation-photo/e68eb7327208097ea3088baab551269c.png",
        headResponse,
        "HEAD",
      ));
      expect(headHandled).toBe(true);
      expect(headResponse.res.statusCode).toBe(200);
      expect(headResponse.text).toBe("");

      const notModifiedResponse = makeResponse();
      const notModifiedCtx = makeCtx(
        "/api/apps/ruby-high/assets/generated/graduation-photo/e68eb7327208097ea3088baab551269c.png",
        notModifiedResponse,
      );
      notModifiedCtx.ifNoneMatch = "\"generated-test\"";
      const notModifiedHandled = await handleAppRoutes(notModifiedCtx);
      expect(notModifiedHandled).toBe(true);
      expect(notModifiedResponse.res.statusCode).toBe(304);
      expect(notModifiedResponse.text).toBe("");
    } finally {
      restore();
    }
  });

  it("serves a scoped service worker that leaves stateful APIs network-only", async () => {
    const response = makeResponse();
    const handled = await handleAppRoutes(makeCtx("/api/apps/ruby-high/service-worker.js", response));

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(response.headers.get("service-worker-allowed")).toBe("/api/apps/ruby-high/");
    expect(response.text).toContain('const CACHE_NAME = "ruby-high-pwa-v4";');
    expect(response.text).toContain('const APP_BASE = "/api/apps/ruby-high/";');
    expect(response.text).toContain('"/api/apps/ruby-high/assets/logo.png"');
    expect(response.text).toContain("url.pathname === VIEWER_PATH");
    expect(response.text).toContain('url.pathname.startsWith(APP_BASE + "session/")');
    expect(response.text).toContain('url.pathname === ASSET_PREFIX + "privy-client.global.js"');
    expect(response.text).toContain('response.headers.get("cache-control")');
    expect(response.text).toContain("staleWhileRevalidate(request)");
  });

  it("serves versioned Privy bundles with immutable browser caching", async () => {
    expect(assetCacheControlFor("privy-client.global.js")).toBe("no-cache");
    expect(assetCacheControlFor("privy-client.global.js", true)).toBe("public, max-age=31536000, immutable");

    await withPrivyBundleFixture(async () => {
      const unversioned = makeResponse();
      const unversionedHandled = await handleAppRoutes(makeCtx(
        "/api/apps/ruby-high/assets/privy-client.global.js",
        unversioned,
        "HEAD",
      ));
      expect(unversionedHandled).toBe(true);
      expect(unversioned.res.statusCode).toBe(200);
      expect(unversioned.headers.get("cache-control")).toBe("no-cache");
      expect(unversioned.headers.get("content-type")).toMatch(/text\/javascript/);
      expect(unversioned.text).toBe("");

      const versioned = makeResponse();
      const versionedHandled = await handleAppRoutes(makeCtx(
        "/api/apps/ruby-high/assets/privy-client.global.js?v=build-123",
        versioned,
        "HEAD",
      ));
      expect(versionedHandled).toBe(true);
      expect(versioned.res.statusCode).toBe(200);
      expect(versioned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(versioned.headers.get("etag")).toMatch(/^".+"$/);
      expect(versioned.text).toBe("");
    });
  });

  it("supports HEAD checks for PWA resources", async () => {
    const manifestResponse = makeResponse();
    const manifestHandled = await handleAppRoutes(makeCtx(
      "/api/apps/ruby-high/manifest.webmanifest",
      manifestResponse,
      "HEAD",
    ));
    expect(manifestHandled).toBe(true);
    expect(manifestResponse.res.statusCode).toBe(200);
    expect(manifestResponse.text).toBe("");

    const workerResponse = makeResponse();
    const workerHandled = await handleAppRoutes(makeCtx(
      "/api/apps/ruby-high/service-worker.js",
      workerResponse,
      "HEAD",
    ));
    expect(workerHandled).toBe(true);
    expect(workerResponse.res.statusCode).toBe(200);
    expect(workerResponse.headers.get("service-worker-allowed")).toBe("/api/apps/ruby-high/");
    expect(workerResponse.text).toBe("");

    const assetResponse = makeResponse();
    const assetHandled = await handleAppRoutes(makeCtx(
      "/api/apps/ruby-high/assets/nft/ruby-high-pack.png",
      assetResponse,
      "HEAD",
    ));
    expect(assetHandled).toBe(true);
    expect(assetResponse.res.statusCode).toBe(200);
    expect(assetResponse.headers.get("content-type")).toMatch(/image\/png/);
    expect(assetResponse.text).toBe("");

    const cardAssetResponse = makeResponse();
    const cardAssetHandled = await handleAppRoutes(makeCtx(
      "/api/apps/ruby-high/assets/nft/cards/lyra.png",
      cardAssetResponse,
      "HEAD",
    ));
    expect(cardAssetHandled).toBe(true);
    expect(cardAssetResponse.res.statusCode).toBe(200);
    expect(cardAssetResponse.headers.get("content-type")).toMatch(/image\/png/);
    expect(cardAssetResponse.text).toBe("");
  });
});
