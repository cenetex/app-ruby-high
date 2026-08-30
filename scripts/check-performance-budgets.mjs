#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { renderViewerHtml } from "../dist/index.js";

const KiB = 1024;
const budgets = {
  viewerHtml: 100 * KiB,
  viewerClientGzip: 256 * KiB,
  viewerCssGzip: 64 * KiB,
  privyGzip: 1800 * KiB,
  initialImages: 320 * KiB,
};

const html = Buffer.from(renderViewerHtml({
  agentName: "Ruby",
  sessionId: "rh:performance-budget",
  apiBase: "/api/apps/ruby-high",
  role: "human",
  build: "budget",
}), "utf8");
const viewerClient = await readFile(new URL("../dist/viewer-client.js", import.meta.url));
const viewerCss = await readFile(new URL("../dist/viewer.css", import.meta.url));
const privy = await readFile(new URL("../dist/viewer-privy-client.global.js", import.meta.url));
const initialImageBytes = (
  await totalFiles(new URL("../assets/optimized/teachers/", import.meta.url), (name) => name.endsWith("-face.webp"))
) + (
  await totalFiles(new URL("../assets/optimized/students/", import.meta.url), (name) => name.endsWith("-face.webp"))
) + await totalNamedFiles([
  new URL("../assets/optimized/ruby-high-logo.webp", import.meta.url),
  new URL("../assets/optimized/ruby-high-app-icon.webp", import.meta.url),
  new URL("../assets/teachers/ruby-full-sticker.png", import.meta.url),
]);

check("viewer HTML", html.length, budgets.viewerHtml);
check("viewer client (gzip)", gzipSync(viewerClient, { level: 9 }).length, budgets.viewerClientGzip);
check("viewer CSS (gzip)", gzipSync(viewerCss, { level: 9 }).length, budgets.viewerCssGzip);
check("lazy Privy client (gzip)", gzipSync(privy, { level: 9 }).length, budgets.privyGzip);
check("initial images", initialImageBytes, budgets.initialImages);

const htmlText = html.toString("utf8");
if (!htmlText.includes('/assets/viewer-client.js?v=budget')) throw new Error("viewer client is not a versioned external asset");
if (!htmlText.includes('/assets/viewer.css?v=budget')) throw new Error("viewer CSS is not a versioned external asset");
if (htmlText.includes("function runViewerClient")) throw new Error("viewer client was inlined into HTML");
if (htmlText.includes("brand/ruby-high-app-icon.png")) throw new Error("viewer still uses the oversized app icon");

console.log("performance budgets ok");

async function totalFiles(directoryUrl, include = () => true) {
  const names = (await readdir(directoryUrl)).filter(include);
  const sizes = await Promise.all(names.map(async (name) => (await stat(join(directoryUrl.pathname, name))).size));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function totalNamedFiles(fileUrls) {
  const sizes = await Promise.all(fileUrls.map(async (url) => (await stat(url)).size));
  return sizes.reduce((sum, size) => sum + size, 0);
}

function check(label, actual, limit) {
  if (actual > limit) throw new Error(`${label} is ${format(actual)}, above its ${format(limit)} budget`);
  console.log(`${label}: ${format(actual)} / ${format(limit)}`);
}

function format(bytes) {
  return `${(bytes / KiB).toFixed(1)} KiB`;
}
