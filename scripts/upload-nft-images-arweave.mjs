import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import Arweave from "arweave";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "src", "services", "nft-arweave-assets.ts");
const arweaveGateway = "https://arweave.net";

const rootNftImages = [
  "assets/nft/ruby-high-first-bell-collection.png",
  "assets/nft/ruby-high-card-back.png",
  "assets/nft/ruby-high-pack.png",
  "assets/nft/ruby-high-pack-opened.png",
  "assets/nft/ruby-high-pack-promo.png",
];

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

function parseArgs() {
  const args = {
    assets: [],
    awsProfile: "",
    awsSecretId: "",
    dryRun: false,
    force: false,
    fundIrys: false,
    includeMarketCards: false,
    includeSheets: false,
    jwkPath: "",
    network: "mainnet",
    provider: "arweave",
    solanaKeypairPath: "",
    solanaRpcUrl: "",
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--asset") {
      args.assets.push(process.argv[index + 1] || "");
      index += 1;
    } else if (arg === "--aws-secret-id") {
      args.awsSecretId = process.argv[index + 1] || "";
      index += 1;
    } else if (arg === "--aws-profile") {
      args.awsProfile = process.argv[index + 1] || "";
      index += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--fund-irys") {
      args.fundIrys = true;
    } else if (arg === "--include-market-cards") {
      args.includeMarketCards = true;
    } else if (arg === "--include-sheets") {
      args.includeSheets = true;
    } else if (arg === "--irys-solana") {
      args.provider = "irys-solana";
    } else if (arg === "--jwk-path") {
      args.jwkPath = process.argv[index + 1] || "";
      index += 1;
    } else if (arg === "--network") {
      args.network = process.argv[index + 1] || "mainnet";
      index += 1;
    } else if (arg === "--provider") {
      args.provider = process.argv[index + 1] || "arweave";
      index += 1;
    } else if (arg === "--solana-keypair-path") {
      args.solanaKeypairPath = process.argv[index + 1] || "";
      index += 1;
    } else if (arg === "--solana-rpc-url") {
      args.solanaRpcUrl = process.argv[index + 1] || "";
      index += 1;
    } else if (arg && !arg.startsWith("--")) {
      args.assets.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function listPngFiles(relativeDir) {
  const absoluteDir = join(root, relativeDir);
  const names = await readdir(absoluteDir);
  return names
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${relativeDir}/${name}`);
}

async function selectedAssets(args) {
  if (args.assets.length > 0) {
    return uniqueSorted(args.assets.map(normalizeInputAssetPath).filter(Boolean));
  }

  const assets = [
    ...rootNftImages,
    ...(await listPngFiles("assets/nft/market-cards")),
    ...(await listPngFiles("assets/nft/cards")),
  ];

  if (args.includeMarketCards) assets.push(...await listPngFiles("assets/nft/market-cards"));
  if (args.includeSheets) {
    assets.push(
      "assets/nft/ruby-high-student-cards.png",
      "assets/nft/ruby-high-teacher-cards.png",
      "assets/nft/ruby-high-special-teacher-cards.png",
      "assets/nft/ruby-high-item-cards.png",
      "assets/nft/ruby-high-location-cards.png",
    );
  }

  return uniqueSorted(assets);
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeInputAssetPath(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.startsWith("api/apps/ruby-high/")) return clean.slice("api/apps/ruby-high/".length);
  if (clean.startsWith("/api/apps/ruby-high/")) return clean.slice("/api/apps/ruby-high/".length);
  return clean.replace(/^\/+/, "");
}

function assetKeyForRelativePath(relativePath) {
  const normalized = relativePath.split(sep).join("/");
  return `api/apps/ruby-high/${normalized}`;
}

function contentTypeForPath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function tagsForAsset(relativePath) {
  return [
    { name: "Content-Type", value: contentTypeForPath(relativePath) },
    { name: "App-Name", value: "Ruby High" },
    { name: "Ruby-High-Asset-Key", value: assetKeyForRelativePath(relativePath) },
    { name: "Ruby-High-Asset-Name", value: basename(relativePath) },
  ];
}

async function readExistingManifest() {
  let text = "";
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    return {};
  }

  const manifest = {};
  const entryPattern = /"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of text.matchAll(entryPattern)) {
    const key = JSON.parse(`"${match[1]}"`);
    const value = JSON.parse(`"${match[2]}"`);
    if (key && value) manifest[key] = value;
  }
  return manifest;
}

async function loadJwk(args) {
  const jwkPath = args.jwkPath || process.env.ARWEAVE_JWK_PATH || "";
  if (jwkPath) return parseJwkSecret(await readFile(jwkPath, "utf8"));

  if (process.env.ARWEAVE_JWK) return parseJwkSecret(process.env.ARWEAVE_JWK);

  const awsSecretId = args.awsSecretId
    || process.env.ARWEAVE_JWK_AWS_SECRET_ID
    || process.env.RUBY_HIGH_ARWEAVE_WALLET_SECRET_ID
    || "";
  if (awsSecretId) return parseJwkSecret(loadAwsSecretString(awsSecretId, args.awsProfile));

  throw new Error(
    "Set ARWEAVE_JWK, ARWEAVE_JWK_PATH, ARWEAVE_JWK_AWS_SECRET_ID, or pass --aws-secret-id.",
  );
}

async function loadSolanaWallet(args) {
  if (process.env.SOLANA_PRIVATE_KEY) return process.env.SOLANA_PRIVATE_KEY.trim();
  const keypairPath = args.solanaKeypairPath
    || process.env.SOLANA_WALLET
    || join(process.env.HOME || "", ".config", "solana", "id.json");
  const parsed = parseJson(await readFile(keypairPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`Solana keypair ${keypairPath} is not a JSON byte array.`);
  return parsed;
}

function loadAwsSecretString(secretId, profile) {
  const profileArgs = profile ? ["--profile", profile] : [];
  try {
    return execFileSync("aws", [
      ...profileArgs,
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      secretId,
      "--query",
      "SecretString",
      "--output",
      "text",
    ], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const status = typeof err?.status === "number" ? ` exit ${err.status}` : "";
    const stderr = typeof err?.stderr?.toString === "function" ? err.stderr.toString().trim() : "";
    const profileLabel = profile ? ` with profile ${profile}` : "";
    throw new Error(`Failed to read AWS secret ${secretId}${profileLabel}.${status}${stderr ? ` ${stderr}` : ""}`);
  }
}

function parseJwkSecret(secretText) {
  const parsed = parseJson(secretText);
  const candidate = findJwk(parsed);
  if (!candidate) throw new Error("Arweave secret did not contain an RSA JWK.");
  return candidate;
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch (err) {
    throw new Error(`Arweave secret is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findJwk(value) {
  if (!value || typeof value !== "object") return null;
  if (value.kty === "RSA" && value.n && value.e && value.d) return value;
  for (const key of ["jwk", "wallet", "walletJwk", "arweaveWallet", "arweave_wallet", "privateKey"]) {
    const child = value[key];
    if (typeof child === "string") {
      const parsed = parseJson(child);
      const found = findJwk(parsed);
      if (found) return found;
    } else {
      const found = findJwk(child);
      if (found) return found;
    }
  }
  return null;
}

function arweaveClient() {
  return Arweave.init({
    host: "arweave.net",
    port: 443,
    protocol: "https",
    timeout: 120_000,
    logging: false,
  });
}

async function irysClient(args) {
  let builder = Uploader(Solana)
    .withWallet(await loadSolanaWallet(args))
    .timeout(120_000)
    .withTokenOptions({ finality: "confirmed" });

  if (args.network === "devnet") builder = builder.devnet();
  else builder = builder.mainnet();

  const rpcUrl = args.solanaRpcUrl
    || process.env.SOLANA_RPC_URL
    || process.env.RPC_URL
    || "https://api.mainnet-beta.solana.com";
  builder = builder.withRpc(rpcUrl);
  return await builder;
}

async function uploadAsset(arweave, jwk, relativePath) {
  const absolutePath = join(root, relativePath);
  const data = await readFile(absolutePath);
  const tx = await arweave.createTransaction({ data }, jwk);
  for (const tag of tagsForAsset(relativePath)) tx.addTag(tag.name, tag.value);
  await arweave.transactions.sign(tx, jwk);
  const response = await arweave.transactions.post(tx);
  if (![200, 202].includes(response.status)) {
    throw new Error(`Arweave rejected ${relativePath}: ${response.status} ${response.statusText || ""}`.trim());
  }
  return `${arweaveGateway}/${tx.id}`;
}

async function uploadAssetWithIrys(irys, relativePath) {
  const data = await readFile(join(root, relativePath));
  const receipt = await irys.upload(data, {
    tags: tagsForAsset(relativePath),
  });
  if (!receipt?.id) throw new Error(`Irys upload did not return an id for ${relativePath}.`);
  return `${arweaveGateway}/${receipt.id}`;
}

async function pricePendingIrysUploads(irys, pendingAssets) {
  let required = null;
  for (const asset of pendingAssets) {
    const data = await readFile(join(root, asset));
    const price = await irys.getPrice(data.length, { tags: tagsForAsset(asset) });
    required = required ? required.plus(price) : price;
  }
  return required ?? await irys.getPrice(0);
}

async function ensureIrysBalance(irys, pendingAssets, shouldFund) {
  const required = await pricePendingIrysUploads(irys, pendingAssets);
  const balance = await irys.getLoadedBalance();
  console.log(`Irys balance: ${balance.toString()} atomic SOL units.`);
  console.log(`Irys required: ${required.toString()} atomic SOL units.`);
  if (balance.gte(required)) return;
  const shortage = required.minus(balance);
  if (!shouldFund) {
    throw new Error(`Irys balance is short by ${shortage.toString()} atomic SOL units. Rerun with --fund-irys to fund then upload.`);
  }
  const fundingAmount = shortage.plus(required.dividedToIntegerBy(10)).plus(10_000);
  console.log(`Funding Irys with ${fundingAmount.toString()} atomic SOL units.`);
  const fundReceipt = await irys.fund(fundingAmount);
  console.log(`Irys funding transaction: ${fundReceipt.id}`);
}

async function writeManifest(manifest) {
  const entries = Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b));
  const lines = entries.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  const text = [
    "// Generated by scripts/upload-nft-images-arweave.mjs.",
    "// Do not edit by hand; rerun the uploader.",
    "export const NFT_ARWEAVE_IMAGE_URIS = {",
    ...lines,
    "} as const satisfies Record<string, string>;",
    "",
    "export function normalizeNftAssetPath(assetPath: string): string {",
    "  const clean = assetPath.trim();",
    "  if (!clean) return \"\";",
    "  let pathname = clean;",
    "  try {",
    "    if (/^https?:\\/\\//i.test(clean)) pathname = new URL(clean).pathname;",
    "  } catch {",
    "    pathname = clean;",
    "  }",
    "  const withoutQuery = pathname.split(\"#\", 1)[0]!.split(\"?\", 1)[0]!;",
    "  return withoutQuery.replace(/^\\/+/, \"\");",
    "}",
    "",
    "export function nftImageUri(",
    "  publicBaseUrl: string,",
    "  assetPath: string,",
    "  arweaveImageUris: Readonly<Record<string, string>> = NFT_ARWEAVE_IMAGE_URIS,",
    "): string {",
    "  const arweaveUri = arweaveImageUris[normalizeNftAssetPath(assetPath)]?.trim();",
    "  if (arweaveUri) return arweaveUri;",
    "  return `${cleanBaseUrl(publicBaseUrl)}${assetPath}`;",
    "}",
    "",
    "function cleanBaseUrl(value: string): string {",
    "  return value.trim().replace(/\\/+$/, \"\");",
    "}",
    "",
  ].join("\n");
  await writeFile(manifestPath, text, "utf8");
}

loadDotEnv();
const args = parseArgs();
const assets = await selectedAssets(args);
const manifest = await readExistingManifest();
const pending = assets.filter((asset) => args.force || !manifest[assetKeyForRelativePath(asset)]);

console.log(`Selected ${assets.length} NFT image assets.`);
if (pending.length === 0) {
  console.log("Manifest already has Arweave URLs for every selected asset.");
  process.exit(0);
}

for (const asset of pending) {
  console.log(`Pending: ${asset}`);
}

if (args.dryRun) process.exit(0);

if (args.provider === "arweave") {
  const jwk = await loadJwk(args);
  const arweave = arweaveClient();
  const walletAddress = await arweave.wallets.jwkToAddress(jwk);
  console.log(`Uploading with Arweave wallet ${walletAddress}.`);

  for (const asset of pending) {
    const assetKey = assetKeyForRelativePath(asset);
    const uri = await uploadAsset(arweave, jwk, asset);
    manifest[assetKey] = uri;
    console.log(`${assetKey} -> ${uri}`);
    await mkdir(join(root, "src", "services"), { recursive: true });
    await writeManifest(manifest);
  }
} else if (args.provider === "irys-solana") {
  const irys = await irysClient(args);
  console.log(`Uploading with Irys Solana wallet ${irys.address}.`);
  await ensureIrysBalance(irys, pending, args.fundIrys);

  for (const asset of pending) {
    const assetKey = assetKeyForRelativePath(asset);
    const uri = await uploadAssetWithIrys(irys, asset);
    manifest[assetKey] = uri;
    console.log(`${assetKey} -> ${uri}`);
    await mkdir(join(root, "src", "services"), { recursive: true });
    await writeManifest(manifest);
  }
} else {
  throw new Error(`Unknown upload provider: ${args.provider}`);
}

console.log(`Wrote ${manifestPath}.`);
