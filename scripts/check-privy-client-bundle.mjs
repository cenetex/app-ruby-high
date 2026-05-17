import { readFile } from "node:fs/promises";

const path = new URL("../dist/viewer-privy-client.js", import.meta.url);
const text = await readFile(path, "utf8");

const bareImports = [
  /from\s+["']@privy-io\//,
  /from\s+["']react["']/,
  /from\s+["']react-dom(?:\/client)?["']/,
  /import\(["']@privy-io\//,
  /import\(["']react(?:-dom\/client)?["']\)/,
];

for (const pattern of bareImports) {
  if (pattern.test(text)) {
    throw new Error(`viewer-privy-client.js contains an unbundled browser import matching ${pattern}`);
  }
}

console.log("privy client bundle ok");
