#!/usr/bin/env node
// Production entry point. Same wiring as scripts/dev-server.mjs but with
// container-friendly defaults: binds 0.0.0.0, reads PORT from env, exposes
// /health for the platform's healthcheck, and writes session state to
// `RUBY_HIGH_DATA_DIR` when set. Production runs on Fly.io with SQLite on a
// mounted volume; the JSON path is retained for local/container fallback.

import { createServer } from "node:http";
import { URL } from "node:url";
import { buildHealthPayload, createRouteContext, sendJson } from "./http-server.mjs";
import { serveLandingRequest } from "./landing.mjs";
import { normalizePublicOrigin } from "./public-base.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const STATE_PATH = process.env.RUBY_HIGH_STATE_PATH
  ?? (process.env.RUBY_HIGH_DATA_DIR ? `${process.env.RUBY_HIGH_DATA_DIR}/state.json` : null);
const PUBLIC_BASE = normalizePublicOrigin(process.env.RUBY_HIGH_PUBLIC_BASE);
const APP_ROUTE_PREFIX = "/api/apps/ruby-high";
const VIEWER_PATH = `${APP_ROUTE_PREFIX}/viewer`;

let handleAppRoutes = null;
let stateStore = null;
let facultySvc = null;
let authSvc = null;
let agentAccessSvc = null;
let chatSvc = null;
let rubySvc = null;
let xSocialSvc = null;
let telegramSvc = null;
let bootReady = false;
let bootError = null;

const fakeRuntime = {
  agentId: "ruby-high-server",
  character: { name: "Ruby" },
  getService: (type) => {
    if (type === "ruby-high-faculty") return facultySvc;
    if (type === "ruby-high") return rubySvc;
    if (type === "ruby-high-auth") return authSvc;
    if (type === "ruby-high-agent-access") return agentAccessSvc;
    if (type === "ruby-high-chat") return chatSvc;
    if (type === "x-social") return xSocialSvc;
    if (type === "telegram") return telegramSvc;
    return null;
  },
  getSetting: (k) => process.env[k] ?? null,
};

async function bootServices() {
  const mod = await import("../dist/index.js");
  const {
    AuthService,
    AgentAccessService,
    ChatService,
    FacultyService,
    RubyHighService,
    TelegramService,
    XSocialService,
    createStateStore,
    handleAppRoutes: appRoutes,
  } = mod;
  handleAppRoutes = appRoutes;
  // State backend: selected by RUBY_HIGH_STORE_BACKEND. Production uses
  // sqlite at RUBY_HIGH_STATE_PATH; json remains the local fallback and
  // dynamodb is retained only for legacy recovery/testing.
  stateStore = await createStateStore({ jsonPath: STATE_PATH ?? undefined });
  facultySvc = await FacultyService.start(fakeRuntime);
  authSvc = await AuthService.start(fakeRuntime, stateStore);
  chatSvc = await ChatService.start(fakeRuntime);
  const svc = new RubyHighService(fakeRuntime, stateStore);
  await svc["hydrate"]();
  svc.startPhotoPostScheduler();
  svc.setFacultyService(facultySvc);
  chatSvc.setRubyHighService(svc);
  rubySvc = svc;
  agentAccessSvc = new AgentAccessService(fakeRuntime, stateStore);
  await agentAccessSvc.hydrate();
  try {
    xSocialSvc = await XSocialService.start(fakeRuntime);
    svc.startRotationScheduler();
  } catch (err) {
    console.error("XSocialService failed to start:", err.message);
    xSocialSvc = null;
  }
  try {
    telegramSvc = await TelegramService.start(fakeRuntime);
  } catch (err) {
    console.error("TelegramService failed to start:", err.message);
    telegramSvc = null;
  }
  bootReady = true;
}




function deriveBaseFromReq(req) {
  if (PUBLIC_BASE) return PUBLIC_BASE;
  // The platform's edge proxy (Fly / any LB / a custom reverse proxy) sets
  // x-forwarded-* headers; trust the first hop.
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? `${HOST}:${PORT}`).toString().split(",")[0].trim();
  const requestBase = `${proto}://${host}`;
  return normalizePublicOrigin(requestBase) ?? requestBase;
}

function isSecureReq(req) {
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  return proto === "https";
}

function makeRouteContext(req, res, url) {
  return createRouteContext({
    req,
    res,
    url,
    runtime: fakeRuntime,
    isSecure: isSecureReq(req),
    callbackBase: deriveBaseFromReq(req),
  });
}


function healthPayload() {
  return buildHealthPayload({ stateStore, facultyService: facultySvc });
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

  if (await serveLandingRequest(req, res, url)) {
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
  server.close(() => {
    void rubySvc?.stop?.()
      .catch((err) => console.error("[ruby-high] shutdown cleanup failed:", err))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
