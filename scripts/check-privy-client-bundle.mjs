import { readFile } from "node:fs/promises";
import { init, parse } from "es-module-lexer";

const path = new URL("../dist/viewer-privy-client.js", import.meta.url);
const globalPath = new URL("../dist/viewer-privy-client.global.js", import.meta.url);
const text = await readFile(path, "utf8");
const globalText = await readFile(globalPath, "utf8");

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

console.log("privy client bundle ok");
