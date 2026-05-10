import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { handleAppRoutes, type RouteContext } from "../routes.js";
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
    expect(html).toContain('navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })');
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
    expect(Buffer.isBuffer(response.raw)).toBe(true);

    const text = gunzipSync(response.raw as Buffer).toString("utf8");
    expect(text).toContain("<title>Ruby High");
    expect(text).toContain("/api/apps/ruby-high/auth/guest");
  });

  it("serves a scoped service worker that leaves stateful APIs network-only", async () => {
    const response = makeResponse();
    const handled = await handleAppRoutes(makeCtx("/api/apps/ruby-high/service-worker.js", response));

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(response.headers.get("service-worker-allowed")).toBe("/api/apps/ruby-high/");
    expect(response.text).toContain('const APP_BASE = "/api/apps/ruby-high/";');
    expect(response.text).toContain('"/api/apps/ruby-high/assets/logo.png"');
    expect(response.text).toContain('url.pathname.startsWith(APP_BASE + "session/")');
    expect(response.text).toContain("networkFirst(request)");
    expect(response.text).toContain("staleWhileRevalidate(request)");
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
  });
});
