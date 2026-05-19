import { readFile } from "node:fs/promises";

const DEFAULT_LANDING_HOSTS = "rubyhighai.com,www.rubyhighai.com";
const DEFAULT_APP_BASE = "https://ruby-high.ai";
const APP_ROUTE_PREFIX = "/api/apps/ruby-high";
const LANDING_ROOT = new URL("../landing/", import.meta.url);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeHostname(raw) {
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return "";
  if (first.startsWith("[") && first.includes("]")) return first.slice(1, first.indexOf("]"));
  return first.split(":")[0] ?? "";
}

function landingHosts(env = process.env) {
  return new Set(
    (env.RUBY_HIGH_LANDING_HOSTS ?? DEFAULT_LANDING_HOSTS)
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function fileUrlForPath(pathname) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relativePath = decoded === "/" || decoded === "/index.html"
    ? "index.html"
    : decoded.replace(/^\/+/, "");
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("/../")) return null;
  const fileUrl = new URL(relativePath, LANDING_ROOT);
  return fileUrl.href.startsWith(LANDING_ROOT.href) ? fileUrl : null;
}

function extension(pathname) {
  const dot = pathname.lastIndexOf(".");
  return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
}

function contentTypeFor(pathname) {
  return CONTENT_TYPES.get(extension(pathname)) ?? "application/octet-stream";
}

function cacheControlFor(pathname) {
  if (pathname.startsWith("/assets/")) return "public, max-age=86400";
  if (pathname === "/styles.css") return "public, max-age=300";
  return "no-store";
}

function sendPlain(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

async function sendLandingFile(req, res, pathname) {
  const fileUrl = fileUrlForPath(pathname);
  if (!fileUrl) {
    sendPlain(res, 404, "Not found");
    return;
  }
  try {
    const body = await readFile(fileUrl);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeFor(fileUrl.pathname));
    res.setHeader("Cache-Control", cacheControlFor(pathname));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      sendPlain(res, 404, "Not found");
      return;
    }
    sendPlain(res, 500, "Landing page unavailable");
  }
}

export function requestHostname(req) {
  return normalizeHostname(firstHeader(req.headers["x-forwarded-host"] ?? req.headers.host));
}

export function isLandingHost(req, env = process.env) {
  const host = requestHostname(req);
  return !!host && landingHosts(env).has(host);
}

export async function serveLandingRequest(req, res, url, opts = {}) {
  if (!isLandingHost(req, opts.env ?? process.env)) return false;

  if (url.pathname.startsWith(APP_ROUTE_PREFIX)) {
    const appBase = opts.appBase ?? process.env.RUBY_HIGH_APP_BASE ?? DEFAULT_APP_BASE;
    const location = new URL(`${url.pathname}${url.search}`, appBase).toString();
    res.writeHead(req.method === "GET" || req.method === "HEAD" ? 302 : 307, { Location: location });
    res.end();
    return true;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendPlain(res, 405, "Method not allowed");
    return true;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    await sendLandingFile(req, res, "/index.html");
    return true;
  }

  if (url.pathname === "/styles.css" || url.pathname.startsWith("/assets/")) {
    await sendLandingFile(req, res, url.pathname);
    return true;
  }

  if (!extension(url.pathname)) {
    await sendLandingFile(req, res, "/index.html");
    return true;
  }

  sendPlain(res, 404, "Not found");
  return true;
}
