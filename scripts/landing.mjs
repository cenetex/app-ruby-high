import { readFile } from "node:fs/promises";

const LANDING_ROOT = new URL("../landing/", import.meta.url);
const SHARED_ASSET_ROOT = new URL("../assets/", import.meta.url);

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

function fileUrlForPath(pathname) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.startsWith("/assets/")) {
    const assetPath = decoded.slice("/assets/".length);
    if (!assetPath || assetPath.startsWith("..") || assetPath.includes("/../")) return null;
    const assetUrl = new URL(assetPath, SHARED_ASSET_ROOT);
    return assetUrl.href.startsWith(SHARED_ASSET_ROOT.href) ? assetUrl : null;
  }
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

function viewerLink(url) {
  const params = new URLSearchParams();
  // Forward only bounded campaign fields. The metrics API applies its fixed
  // vocabulary when the visitor opens the viewer.
  for (const key of ["ref", "rh_source", "rh_campaign", "rh_landing", "rh_entry"]) {
    const value = url.searchParams.get(key)?.trim();
    const limit = key === "ref" ? 120 : 32;
    if (value && value.length <= limit && /^[a-z0-9_-]+$/i.test(value)) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `/api/apps/ruby-high/viewer${query ? `?${query.replaceAll("&", "&amp;")}` : ""}`;
}

async function sendLandingFile(req, res, pathname, url) {
  const fileUrl = fileUrlForPath(pathname);
  if (!fileUrl) {
    sendPlain(res, 404, "Not found");
    return;
  }
  try {
    let body = await readFile(fileUrl);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeFor(fileUrl.pathname));
    res.setHeader("Cache-Control", cacheControlFor(pathname));
    if (fileUrl.pathname.endsWith(".html")) {
      body = Buffer.from(body.toString("utf8").replaceAll(
        'href="/api/apps/ruby-high/viewer"',
        `href="${viewerLink(url)}"`,
      ));
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'self'; font-src 'self'; img-src 'self'",
      );
    }
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

/**
 * Serve a request from the static landing bundle when the path is the root,
 * the share kit, their styles/scripts, or anything under /assets. Returns true when the
 * response was written so the caller can stop; returns false otherwise so
 * the app routes can handle it.
 */
export async function serveLandingRequest(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    await sendLandingFile(req, res, "/index.html", url);
    return true;
  }

  if (url.pathname === "/share" || url.pathname === "/share/") {
    await sendLandingFile(req, res, "/share.html", url);
    return true;
  }

  if (["/styles.css", "/share.css", "/share.js"].includes(url.pathname) || url.pathname.startsWith("/assets/")) {
    await sendLandingFile(req, res, url.pathname, url);
    return true;
  }

  return false;
}
