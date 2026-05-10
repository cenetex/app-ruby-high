#!/usr/bin/env node
// Production entry point. Same wiring as scripts/dev-server.mjs but with
// container-friendly defaults: binds 0.0.0.0, reads PORT from env, exposes
// /health for the platform's healthcheck, and writes session state to
// `RUBY_HIGH_DATA_DIR` when set. Production runs on Fly.io with DynamoDB
// persistence; the JSON path is retained for local/container fallback.

import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const STATE_PATH = process.env.RUBY_HIGH_STATE_PATH
  ?? (process.env.RUBY_HIGH_DATA_DIR ? `${process.env.RUBY_HIGH_DATA_DIR}/state.json` : null);
const PUBLIC_BASE = process.env.RUBY_HIGH_PUBLIC_BASE ?? null;
const ROOT_REDIRECT = process.env.RUBY_HIGH_ROOT_REDIRECT ?? "/api/apps/ruby-high/viewer";
const APP_ROUTE_PREFIX = "/api/apps/ruby-high";
const VIEWER_PATH = `${APP_ROUTE_PREFIX}/viewer`;

let handleAppRoutes = null;
let stateStore = null;
let facultySvc = null;
let authSvc = null;
let chatSvc = null;
let rubySvc = null;
let bootReady = false;
let bootError = null;

const fakeRuntime = {
  agentId: "ruby-high-server",
  character: { name: "Ruby" },
  getService: (type) => {
    if (type === "ruby-high-faculty") return facultySvc;
    if (type === "ruby-high") return rubySvc;
    if (type === "ruby-high-auth") return authSvc;
    if (type === "ruby-high-chat") return chatSvc;
    return null;
  },
  getSetting: (k) => process.env[k] ?? null,
};

async function bootServices() {
  const mod = await import("../dist/index.js");
  const {
    AuthService,
    ChatService,
    FacultyService,
    RubyHighService,
    createStateStore,
    handleAppRoutes: appRoutes,
  } = mod;
  handleAppRoutes = appRoutes;
  // State backend: defaults to a JSON file. Set
  // RUBY_HIGH_STORE_BACKEND=dynamodb + RUBY_HIGH_DYNAMO_TABLE to persist
  // across container restarts.
  stateStore = createStateStore({ jsonPath: STATE_PATH ?? undefined });
  facultySvc = await FacultyService.start(fakeRuntime);
  authSvc = await AuthService.start(fakeRuntime, stateStore);
  chatSvc = await ChatService.start(fakeRuntime);
  const svc = new RubyHighService(fakeRuntime, stateStore);
  await svc["hydrate"]();
  svc.setFacultyService(facultySvc);
  chatSvc.setRubyHighService(svc);
  rubySvc = svc;
  bootReady = true;
}

// 1 MB cap keeps the host from OOM'ing on malformed or hostile requests.
// Legitimate Ruby High traffic is well under 4 KB per request. Anki imports
// are the exception: they carry a base64 .apkg payload and are route-capped
// in pack-routes.ts at 16 MB.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;
const IMPORT_BODY_HOST_CAP_BYTES = MAX_IMPORT_BODY_BYTES + 1024 * 1024;
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      bytes += c.length;
      if (bytes > maxBytes) {
        rejected = true;
        const err = new Error("Request body too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const buf = Buffer.concat(chunks).toString("utf8");
        resolve(buf ? JSON.parse(buf) : {});
      } catch (err) { reject(err); }
    });
    req.on("error", (err) => { if (!rejected) reject(err); });
  });
}

function deriveBaseFromReq(req) {
  if (PUBLIC_BASE) return PUBLIC_BASE;
  // The platform's edge proxy (Fly / any LB / a custom reverse proxy) sets
  // x-forwarded-* headers; trust the first hop.
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? `${HOST}:${PORT}`).toString().split(",")[0].trim();
  return `${proto}://${host}`;
}

function isSecureReq(req) {
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  return proto === "https";
}

function deriveClientIp(req) {
  // The edge proxy (Fly / LB / reverse proxy) puts the original client IP
  // first in x-forwarded-for. Fall back to the socket address when the header
  // is missing (direct connection on a private network).
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}

function makeRouteContext(req, res, url) {
  const base = deriveBaseFromReq(req);
  // Pull the OpenRouter API key out of the X-Openrouter-Key header. Clients
  // store the key in localStorage (since v0.6 / PR #30) and attach it on
  // every authed request; the server reads it here without persisting.
  // Missing this on the production entry was a silent regression — local
  // dev worked because dev-server.mjs already had the equivalent line, but
  // the production server returned 401 on every signed-in request because
  // ctx.apiKeyHeader was always undefined.
  const apiKeyRaw = req.headers["x-openrouter-key"];
  const apiKeyHeader = Array.isArray(apiKeyRaw) ? (apiKeyRaw[0] ?? null) : (apiKeyRaw ?? null);
  return {
    method: req.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: fakeRuntime,
    res,
    cookieHeader: req.headers.cookie ?? null,
    apiKeyHeader,
    isSecure: isSecureReq(req),
    clientIp: deriveClientIp(req),
    ifNoneMatch: req.headers["if-none-match"] ?? null,
    callbackUrlBuilder: (path) => new URL(base).origin + path,
    error(_r, message, status = 500) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: message }));
    },
    json(_r, data, status = 200) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    },
    readJsonBody: () => readJsonBody(
      req,
      url.pathname === "/api/apps/ruby-high/packs/import-anki"
        ? IMPORT_BODY_HOST_CAP_BYTES
        : MAX_BODY_BYTES,
    ),
  };
}

// /health diagnostic payload. `build` is the short commit SHA the workflow
// injects (RUBY_HIGH_BUILD); when running locally it falls back to "dev".
// `state` is the StateStore backend's own description once boot has loaded it.
function healthPayload() {
  return {
    ok: true,
    app: "ruby-high",
    build: process.env.RUBY_HIGH_BUILD ?? "dev",
    state: stateStore?.describe?.() ?? "starting",
  };
}

function sendJson(res, data, status = 200) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function sendStartupHtml(res) {
  if (res.headersSent) return;
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Retry-After", "1");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="1">
  <title>Ruby High</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #15171f;
      color: #f4f0ea;
      font: 600 18px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 48px));
      padding: 28px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      background: #202332;
      box-shadow: 0 18px 44px rgba(0,0,0,0.32);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #c9ccda;
      font-size: 15px;
      font-weight: 500;
    }
    .bar {
      height: 4px;
      margin-top: 20px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,0.14);
    }
    .bar::before {
      content: "";
      display: block;
      width: 40%;
      height: 100%;
      border-radius: inherit;
      background: #e64040;
      animation: load 1s ease-in-out infinite alternate;
    }
    @keyframes load {
      from { transform: translateX(-25%); }
      to { transform: translateX(175%); }
    }
  </style>
</head>
<body>
  <main>
    <h1>Ruby High</h1>
    <p>Class is opening. This page will retry automatically.</p>
    <div class="bar" aria-hidden="true"></div>
  </main>
  <script>
    setTimeout(() => location.reload(), 1000);
  </script>
</body>
</html>`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  if (req.method === "GET" && url.pathname === "/livez") {
    sendJson(res, {
      ...healthPayload(),
      ok: true,
      status: bootError ? "boot-failed" : bootReady ? "ready" : "starting",
      t: Date.now(),
    });
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/health" || url.pathname === "/healthz" || url.pathname === "/readyz")
  ) {
    if (bootError) {
      sendJson(res, {
        ...healthPayload(),
        ok: false,
        status: "boot-failed",
        error: bootError instanceof Error ? bootError.message : String(bootError),
        t: Date.now(),
      }, 500);
      return;
    }
    if (!bootReady) {
      sendJson(res, { ...healthPayload(), ok: false, status: "starting", t: Date.now() }, 503);
      return;
    }
    sendJson(res, { ...healthPayload(), status: "ready", t: Date.now() });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(302, { Location: ROOT_REDIRECT });
    res.end();
    return;
  }

  if (url.pathname.startsWith(APP_ROUTE_PREFIX)) {
    if (bootError) {
      sendJson(res, { error: "Ruby High boot failed." }, 500);
      return;
    }
    if (!bootReady || !handleAppRoutes) {
      if (req.method === "GET" && url.pathname === VIEWER_PATH) {
        sendStartupHtml(res);
      } else {
        sendJson(res, { error: "Ruby High is starting.", status: "starting" }, 503);
      }
      return;
    }
    const ctx = makeRouteContext(req, res, url);
    try {
      const handled = await handleAppRoutes(ctx);
      if (handled) return;
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }
  }

  if (!res.headersSent) {
    sendJson(res, { error: "Not found", path: url.pathname }, 404);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ruby-high] listening on http://${HOST}:${PORT}`);
  console.log(`[ruby-high] build: ${healthPayload().build}`);
  if (PUBLIC_BASE) console.log(`[ruby-high] public base: ${PUBLIC_BASE}`);
  bootServices()
    .then(() => {
      console.log(`[ruby-high] state: ${healthPayload().state}`);
      console.log("[ruby-high] services ready");
    })
    .catch((err) => {
      bootError = err;
      console.error("[ruby-high] boot failed:", err);
    });
});

// Graceful shutdown so a rolling deploy doesn't sever in-flight SSE rudely.
const shutdown = (sig) => {
  console.log(`[ruby-high] ${sig} received — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
