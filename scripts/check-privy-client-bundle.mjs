import { readFile, stat } from "node:fs/promises";
import { init, parse } from "es-module-lexer";

const path = new URL("../dist/viewer-privy-client.js", import.meta.url);
const globalPath = new URL("../dist/viewer-privy-client.global.js", import.meta.url);
const DEFAULT_MAX_GLOBAL_BYTES = 10 * 1024 * 1024;
const maxGlobalBytes = positiveInt(process.env.RUBY_HIGH_PRIVY_CLIENT_GLOBAL_MAX_BYTES, DEFAULT_MAX_GLOBAL_BYTES);
const text = await readFile(path, "utf8");
const globalText = await readFile(globalPath, "utf8");
const [moduleStats, globalStats] = await Promise.all([stat(path), stat(globalPath)]);

await init;

const [imports] = parse(text);
const unbundledStaticImports = imports
  .filter((entry) => entry.d === -1)
  .map((entry) => entry.n ?? text.slice(entry.s, entry.e))
  .filter((specifier) => specifier && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.includes(":"));

if (unbundledStaticImports.length > 0) {
  throw new Error(`viewer-privy-client.js contains unbundled browser imports: ${unbundledStaticImports.join(", ")}`);
}

if (!globalText.includes("RubyHighPrivyClientModule") || !globalText.includes("createRubyHighPrivyClient")) {
  throw new Error("viewer-privy-client.global.js does not expose the Privy client global.");
}

if (globalStats.size > maxGlobalBytes) {
  throw new Error(`viewer-privy-client.global.js is ${formatBytes(globalStats.size)}, above the ${formatBytes(maxGlobalBytes)} limit.`);
}

console.log(`privy client bundle ok (${formatBytes(moduleStats.size)} module, ${formatBytes(globalStats.size)} global; limit ${formatBytes(maxGlobalBytes)})`);

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
