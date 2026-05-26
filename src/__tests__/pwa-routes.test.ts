import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { assetCacheControlFor } from "../routes/assets.js";
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

function makeCtx(
  pathname: string,
  response: ReturnType<typeof makeResponse>,
  method = "GET",
  acceptEncoding?: string,
): RouteContext {
  return {
    method,
    pathname,
    url: new URL(`http://localhost:3000${pathname}`),
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
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(Buffer.isBuffer(response.raw)).toBe(true);

    const text = gunzipSync(response.raw as Buffer).toString("utf8");
    expect(text).toContain("<title>Ruby High");
    expect(text).toContain("/api/apps/ruby-high/auth/guest");
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
    expect(response.text).toContain('url.pathname === ASSET_PREFIX + "privy-client.js"');
    expect(response.text).toContain('url.pathname === ASSET_PREFIX + "privy-client.global.js"');
    expect(response.text).toContain('response.headers.get("cache-control")');
    expect(response.text).toContain("staleWhileRevalidate(request)");
  });

  it("serves versioned Privy bundles with immutable browser caching", () => {
    expect(assetCacheControlFor("privy-client.global.js")).toBe("no-cache");
    expect(assetCacheControlFor("privy-client.global.js", true)).toBe("public, max-age=31536000, immutable");
    expect(assetCacheControlFor("privy-client.js", true)).toBe("public, max-age=31536000, immutable");
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
