import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "src", "services", "nft-arweave-assets.ts");

function parseArgs() {
  const args = { sample: 0 };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--sample") {
      args.sample = Math.max(0, Number.parseInt(process.argv[index + 1] || "0", 10) || 0);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readManifest() {
  const text = await readFile(manifestPath, "utf8");
  const entries = [];
  const entryPattern = /"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of text.matchAll(entryPattern)) {
    entries.push({
      asset: JSON.parse(`"${match[1]}"`),
      url: JSON.parse(`"${match[2]}"`),
    });
  }
  return entries;
}

async function checkImage(entry) {
  const response = await fetch(entry.url);
  const contentType = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
  const isImage = response.ok && contentType.toLowerCase().startsWith("image/") && isPng;
  return {
    ...entry,
    ok: isImage,
    status: response.status,
    contentType,
    bytes: bytes.length,
  };
}

const args = parseArgs();
let entries = await readManifest();
if (args.sample > 0) entries = entries.slice(0, args.sample);
if (entries.length === 0) throw new Error("NFT image manifest is empty.");

const results = [];
for (const entry of entries) {
  results.push(await checkImage(entry));
}

for (const result of results) {
  const mark = result.ok ? "ok" : "fail";
  console.log(`${mark} ${result.status} ${result.contentType || "(no content-type)"} ${result.bytes} ${result.asset} ${result.url}`);
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`${failures.length}/${results.length} NFT image URLs did not return PNG image bytes.`);
  process.exit(1);
}

console.log(`All ${results.length} NFT image URLs returned PNG image bytes.`);
