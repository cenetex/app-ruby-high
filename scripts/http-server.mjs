import { bodyLimitForPath } from "./http-limits.mjs";

export function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejected = true;
        const err = new Error("Request body too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

export async function readJsonBody(req, maxBytes) {
  const body = await readRawBody(req, maxBytes);
  return body ? JSON.parse(body) : {};
}

export function readJsonBodyForPath(req, pathname) {
  return readJsonBody(req, bodyLimitForPath(pathname));
}

export function deriveClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}

export function sendJson(res, data, status = 200) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function createRouteContext({ req, res, url, runtime, isSecure, callbackBase }) {
  const apiKeyRaw = req.headers["x-openrouter-key"];
  const apiKeyHeader = Array.isArray(apiKeyRaw) ? (apiKeyRaw[0] ?? null) : (apiKeyRaw ?? null);
  return {
    method: req.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime,
    res,
    cookieHeader: req.headers.cookie ?? null,
    userAgentHeader: req.headers["user-agent"] ?? null,
    visitorHeader: req.headers["x-ruby-high-visitor"] ?? null,
    apiKeyHeader,
    isSecure,
    clientIp: deriveClientIp(req),
    contentTypeHeader: req.headers["content-type"] ?? null,
    originHeader: req.headers.origin ?? null,
    authorizationHeader: req.headers.authorization ?? null,
    stripeSignatureHeader: req.headers["stripe-signature"] ?? null,
    ifNoneMatch: req.headers["if-none-match"] ?? null,
    lastEventIdHeader: req.headers["last-event-id"] ?? null,
    acceptEncoding: req.headers["accept-encoding"] ?? null,
    callbackUrlBuilder: (path) => new URL(callbackBase).origin + path,
    error(_response, message, status = 500) {
      sendJson(res, { error: message }, status);
    },
    json(_response, data, status = 200) {
      sendJson(res, data, status);
    },
    readRawBody: () => readRawBody(req, bodyLimitForPath(url.pathname)),
    readJsonBody: () => readJsonBodyForPath(req, url.pathname),
  };
}

export function buildHealthPayload({ stateStore, facultyService, timestamp = false }) {
  const byFaculty = {};
  if (facultyService?.faculty && facultyService?.bank) {
    for (const faculty of facultyService.faculty()) {
      byFaculty[faculty.id] = facultyService.bank(faculty.id)?.questions.length ?? 0;
    }
  }
  const curriculum = Object.keys(byFaculty).length > 0
    ? {
        pack: "ruby-high-original",
        totalQuestions: Object.values(byFaculty).reduce((sum, count) => sum + count, 0),
        byFaculty,
      }
    : null;
  return {
    ok: true,
    app: "ruby-high",
    build: process.env.RUBY_HIGH_BUILD ?? "dev",
    state: stateStore?.describe?.() ?? "starting",
    curriculum,
    ...(timestamp ? { t: Date.now() } : {}),
  };
}
