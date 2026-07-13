import { readFile, stat } from "node:fs/promises";
const globalPath = new URL("../dist/viewer-privy-client.global.js", import.meta.url);
const DEFAULT_MAX_GLOBAL_BYTES = 10 * 1024 * 1024;
const maxGlobalBytes = positiveInt(process.env.RUBY_HIGH_PRIVY_CLIENT_GLOBAL_MAX_BYTES, DEFAULT_MAX_GLOBAL_BYTES);
const globalText = await readFile(globalPath, "utf8");
const globalStats = await stat(globalPath);

if (!globalText.includes("RubyHighPrivyClientModule") || !globalText.includes("createRubyHighPrivyClient")) {
  throw new Error("viewer-privy-client.global.js does not expose the Privy client global.");
}

if (globalStats.size > maxGlobalBytes) {
  throw new Error(`viewer-privy-client.global.js is ${formatBytes(globalStats.size)}, above the ${formatBytes(maxGlobalBytes)} limit.`);
}

console.log(`privy client bundle ok (${formatBytes(globalStats.size)} global; limit ${formatBytes(maxGlobalBytes)})`);

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
