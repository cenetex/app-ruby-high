#!/usr/bin/env node
// Production entry point. Same wiring as scripts/dev-server.mjs but with
// container-friendly defaults: binds 0.0.0.0, reads PORT from env,
// adds /health for fly.io's basic_check, and writes session state to
// /data when running on a fly volume.

import { createServer } from "node:http";
import { URL } from "node:url";
import {
  AuthService,
  ChatService,
  FacultyService,
  RubyHighService,
  StateStore,
  handleAppRoutes,
} from "../dist/index.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const STATE_PATH = process.env.RUBY_HIGH_STATE_PATH
  ?? (process.env.RUBY_HIGH_DATA_DIR ? `${process.env.RUBY_HIGH_DATA_DIR}/state.json` : null);
const PUBLIC_BASE = process.env.RUBY_HIGH_PUBLIC_BASE ?? null;
const ROOT_REDIRECT = process.env.RUBY_HIGH_ROOT_REDIRECT ?? "/api/apps/ruby-high/viewer";

const facultySvc = await FacultyService.start({});
const authSvc = await AuthService.start({});
const chatSvc = await ChatService.start({});

const fakeRuntime = {
  agentId: "ruby-high-server",
  character: { name: "Ruby" },
  getService: (type) => {
    if (type === FacultyService.serviceType) return facultySvc;
    if (type === RubyHighService.serviceType) return rubySvc;
    if (type === AuthService.serviceType) return authSvc;
    if (type === ChatService.serviceType) return chatSvc;
    return null;
  },
  getSetting: (k) => process.env[k] ?? null,
};

const rubySvc = await (async () => {
  const svc = new RubyHighService(fakeRuntime, STATE_PATH ? new StateStore(STATE_PATH) : undefined);
  await svc["hydrate"]();
  svc.setFacultyService(facultySvc);
  return svc;
})();
chatSvc.setRubyHighService(rubySvc);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const buf = Buffer.concat(chunks).toString("utf8");
        resolve(buf ? JSON.parse(buf) : {});
      } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function deriveBaseFromReq(req) {
  if (PUBLIC_BASE) return PUBLIC_BASE;
  // fly's edge proxy sets x-forwarded-* headers.
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? `${HOST}:${PORT}`).toString().split(",")[0].trim();
  return `${proto}://${host}`;
}

function isSecureReq(req) {
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0].trim();
  return proto === "https";
}

function makeRouteContext(req, res, url) {
  const base = deriveBaseFromReq(req);
  return {
    method: req.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: fakeRuntime,
    res,
    cookieHeader: req.headers.cookie ?? null,
    isSecure: isSecureReq(req),
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
    readJsonBody: () => readJsonBody(req),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, app: "ruby-high", t: Date.now() }));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(302, { Location: ROOT_REDIRECT });
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/apps/ruby-high")) {
    const ctx = makeRouteContext(req, res, url);
    try {
      const handled = await handleAppRoutes(ctx);
      if (handled) return;
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }
  }

  if (!res.headersSent) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ruby-high] listening on http://${HOST}:${PORT}`);
  if (PUBLIC_BASE) console.log(`[ruby-high] public base: ${PUBLIC_BASE}`);
  if (STATE_PATH) console.log(`[ruby-high] state -> ${STATE_PATH}`);
  else console.log(`[ruby-high] state -> default (${"~/.ruby-high/state.json"}) — ephemeral on this container`);
});

// Graceful shutdown so fly's deploy doesn't sever in-flight SSE rudely.
const shutdown = (sig) => {
  console.log(`[ruby-high] ${sig} received — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
