#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { buildSpa } from "./build-spa.mjs";

const root = await buildSpa();
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  return resolve(root, clean.replace(/^[/\\]/, ""));
}

async function sendFile(res, file) {
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", extname(file) === ".html" ? "no-store" : "public, max-age=3600");
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
  let file = url.pathname === "/" ? join(root, "index.html") : resolvePath(url.pathname);
  if (!file.startsWith(root)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
    await sendFile(res, file);
  } catch (_err) {
    if (!extname(url.pathname)) {
      await sendFile(res, join(root, "index.html"));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Ruby High offline SPA at http://${host}:${port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
