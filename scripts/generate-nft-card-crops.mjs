import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const currentCardDir = join(root, "assets", "nft", "cards");
const grokSourceDir = join(root, "assets", "nft", "grok-sources");
const outputDir = join(root, "assets", "nft", "market-cards");
const catalogSource = await readFile(join(root, "src", "services", "hall-pass-card-catalog.ts"), "utf8");
const catalogJs = ts.transpileModule(catalogSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText;
const catalogModule = `data:text/javascript;base64,${Buffer.from(catalogJs, "utf8").toString("base64")}`;
const {
  FIRST_BELL_ALTERNATE_ART_PROFILES,
  HALL_PASS_CARD_CATALOG,
  hallPassCardImageDimensions,
} = await import(catalogModule);

const magick = process.env.MAGICK_BIN || "magick";
const outputSize = 1024;

const sourceArt = {
  lyra: ["students", "lyra-full.png"],
  sami: ["students", "sami-full.png"],
  ravi: ["students", "ravi-full.png"],
  indra: ["students", "indra-full.png"],
  mika: ["students", "mika-full.png"],
  noor: ["students", "noor-full.png"],
  ruby: ["teachers", "ruby-full.png"],
  "sally-science": ["teachers", "sally-science-full.png"],
  "professor-edward": ["teachers", "professor-edward-full.png"],
};

const grokArt = {
  "item-hall-pass": true,
  "item-flashcards": true,
  "item-library-card": true,
  "item-lab-flask": true,
  "item-lunch-tray": true,
  "item-notebook": true,
  "location-homeroom": true,
  "location-science-lab": true,
  "location-library": true,
  "location-cafeteria": true,
  "location-greenhouse": true,
  "location-courtyard": true,
  "captain-null": true,
  eliza: true,
  rati: true,
};

function run(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${binary} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function normalizeCurrentCard(source, output) {
  run(magick, [
    "-quiet",
    source,
    "-auto-orient",
    "-resize", `${outputSize}x`,
    "-strip",
    output,
  ]);
}

function normalizeGeneratedArt(entry, source, output) {
  const size = hallPassCardImageDimensions(entry).replace(" x ", "x");
  run(magick, [
    "-quiet",
    source,
    "-auto-orient",
    "-resize", `${size}^`,
    "-gravity", "center",
    "-extent", size,
    "-strip",
    output,
  ]);
}

async function isReadable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function generatedSourceFor(id) {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const candidate = join(grokSourceDir, `${id}.${ext}`);
    if (await isReadable(candidate)) return candidate;
  }
  return null;
}

function cropSourcePortrait(entry, source, output) {
  const size = hallPassCardImageDimensions(entry).replace(" x ", "x");
  run(magick, [
    "-quiet",
    source,
    "-auto-orient",
    "-resize", `${size}^`,
    "-gravity", "north",
    "-extent", size,
    "-strip",
    output,
  ]);
}

await mkdir(outputDir, { recursive: true });

for (const entry of HALL_PASS_CARD_CATALOG) {
  const output = join(outputDir, `${entry.characterId}.png`);
  if (grokArt[entry.characterId]) {
    const generatedSource = await generatedSourceFor(entry.characterId);
    if (generatedSource) {
      normalizeGeneratedArt(entry, generatedSource, output);
      continue;
    }
    console.warn(`Missing Grok source for ${entry.characterId}; falling back to checked-in card art.`);
  }
  const override = sourceArt[entry.characterId];
  if (override) {
    cropSourcePortrait(entry, join(root, "assets", ...override), output);
    continue;
  }
  normalizeGeneratedArt(entry, join(currentCardDir, `${entry.characterId}.png`), output);
}

let alternateCount = 0;
for (const profile of FIRST_BELL_ALTERNATE_ART_PROFILES) {
  const imageId = profile.imageId || profile.profileId;
  const generatedSource = await generatedSourceFor(imageId);
  if (!generatedSource) {
    console.warn(`Missing Grok source for alternate ${imageId}; skipping market crop.`);
    continue;
  }
  normalizeGeneratedArt(profile, generatedSource, join(outputDir, `${imageId}.png`));
  alternateCount += 1;
}

console.log(`Generated ${HALL_PASS_CARD_CATALOG.length + alternateCount} market card crops in ${outputDir}`);
