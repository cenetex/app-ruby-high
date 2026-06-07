import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const model = process.env.RUBY_HIGH_NFT_IMAGE_MODEL || "x-ai/grok-imagine-image-quality";
const outputDir = join(root, "assets", "nft", "grok-sources");
const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
const timeoutMs = Number(process.env.RUBY_HIGH_NFT_IMAGE_TIMEOUT_MS || 180_000);

const targets = {
  "item-hall-pass": {
    group: "item",
    name: "Hall Pass",
    source: "assets/nft/cards/item-hall-pass.png",
    prompt: "a glowing Ruby High hall pass badge on a red lanyard, on a scratched school office desk, premium collectible object art",
  },
  "item-flashcards": {
    group: "item",
    name: "Flashcards",
    source: "assets/nft/cards/item-flashcards.png",
    prompt: "a stack of colorful study flashcards with handwritten notes, a pen beside them, warm classroom desk lighting",
  },
  "item-library-card": {
    group: "item",
    name: "Library Card",
    source: "assets/nft/cards/item-library-card.png",
    prompt: "a dark green Ruby High library card resting on an open book under a brass reading lamp, cozy library background",
  },
  "item-lab-flask": {
    group: "item",
    name: "Lab Flask",
    source: "assets/nft/cards/item-lab-flask.png",
    prompt: "a blue glowing chemistry flask on a high school science lab bench, glassware and formulas softly visible behind it",
  },
  "item-lunch-tray": {
    group: "item",
    name: "Lunch Tray",
    source: "assets/nft/cards/item-lunch-tray.png",
    prompt: "a Ruby High cafeteria lunch tray with burger, fries, milk carton, and school crest, bright cafeteria background",
  },
  "item-notebook": {
    group: "item",
    name: "Notebook",
    source: "assets/nft/cards/item-notebook.png",
    prompt: "an open student notebook filled with neat doodles, homework checklist, tabs, pen, and sticky notes on a desk",
  },
  "location-homeroom": {
    group: "location",
    name: "Homeroom",
    source: "assets/nft/cards/location-homeroom.png",
    prompt: "a welcoming Ruby High homeroom classroom with desks, chalkboard, school shield, morning light, cozy anime background art",
  },
  "location-science-lab": {
    group: "location",
    name: "Science Lab",
    source: "assets/nft/cards/location-science-lab.png",
    prompt: "a Ruby High science lab classroom with glassware, lab benches, chalkboard equations, bright blue experiment glow",
  },
  "location-library": {
    group: "location",
    name: "Library",
    source: "assets/nft/cards/location-library.png",
    prompt: "a quiet Ruby High library with tall shelves, open books, study tables, sunbeams, warm scholarly atmosphere",
  },
  "location-cafeteria": {
    group: "location",
    name: "Cafeteria",
    source: "assets/nft/cards/location-cafeteria.png",
    prompt: "a Ruby High school cafeteria with warm lights, trays, banners, counter, social lunchtime energy, anime background art",
  },
  "location-greenhouse": {
    group: "location",
    name: "Greenhouse",
    source: "assets/nft/cards/location-greenhouse.png",
    prompt: "a Ruby High greenhouse classroom filled with plants, glass ceiling, hanging planters, biology notes, warm sunlight",
  },
  "location-courtyard": {
    group: "location",
    name: "Courtyard",
    source: "assets/nft/cards/location-courtyard.png",
    prompt: "a Ruby High courtyard with brick school building, clock tower, benches, flowers, sunny day, anime background art",
  },
  "homeroom-snow-day": {
    group: "location",
    name: "Homeroom: Snow Day Bell",
    source: "assets/nft/market-cards/location-homeroom.png",
    prompt: "Ruby High homeroom classroom during a snow day, snow visible through windows, cozy morning light, desks and chalkboard, school-world atmosphere",
  },
  "science-lab-fair-night": {
    group: "location",
    name: "Science Lab: Fair Night",
    source: "assets/nft/market-cards/location-science-lab.png",
    prompt: "Ruby High science lab during science fair night, experiment displays, glowing glassware, project boards without readable text, festive evening school lighting",
  },
  "library-after-hours": {
    group: "location",
    name: "Library: After Hours",
    source: "assets/nft/market-cards/location-library.png",
    prompt: "Ruby High library after hours, moonlight through tall windows, brass reading lamps, quiet stacks, open books, warm shadows",
  },
  "cafeteria-holiday-lunch": {
    group: "location",
    name: "Cafeteria: Holiday Lunch",
    source: "assets/nft/market-cards/location-cafeteria.png",
    prompt: "Ruby High cafeteria decorated for a winter holiday lunch, warm string lights, trays and banners, festive but generic school celebration",
  },
  "greenhouse-spring-bloom": {
    group: "location",
    name: "Greenhouse: Spring Bloom",
    source: "assets/nft/market-cards/location-greenhouse.png",
    prompt: "Ruby High greenhouse in spring bloom, flowering plants, glass ceiling, biology notes, warm sunlight",
  },
  "courtyard-lantern-festival": {
    group: "location",
    name: "Courtyard: Lantern Festival",
    source: "assets/nft/market-cards/location-courtyard.png",
    prompt: "Ruby High courtyard during a lantern festival at dusk, glowing lanterns, brick school facade, benches and flowers, premium wide scene",
  },
  "hall-pass-gold-stamp": {
    group: "item",
    name: "Hall Pass: Gold Stamp",
    source: "assets/nft/market-cards/item-hall-pass.png",
    prompt: "a Ruby High hall pass with a gold stamp and red lanyard on a school office desk, premium collectible object art",
  },
  "flashcards-finals-week": {
    group: "item",
    name: "Flashcards: Finals Week",
    source: "assets/nft/market-cards/item-flashcards.png",
    prompt: "a dense stack of finals week flashcards with tabs, pencil marks, coffee cup, high school desk, clean object-focused collectible art",
  },
  "library-card-midnight": {
    group: "item",
    name: "Library Card: Midnight Loan",
    source: "assets/nft/market-cards/item-library-card.png",
    prompt: "a Ruby High library card under moonlight on an open book, midnight loan atmosphere, brass lamp, premium object art",
  },
  "lab-flask-holiday-reaction": {
    group: "item",
    name: "Lab Flask: Holiday Reaction",
    source: "assets/nft/market-cards/item-lab-flask.png",
    prompt: "a lab flask with a colorful holiday-themed chemistry reaction, safe classroom lab bench, glassware lights, premium object art",
  },
  "notebook-spring-notes": {
    group: "item",
    name: "Notebook: Spring Notes",
    source: "assets/nft/market-cards/item-notebook.png",
    prompt: "an open student notebook with spring notes, pressed flowers, neat doodles and tabs, desk lighting, premium object art",
  },
  "captain-null": {
    group: "rare-teacher",
    name: "Captain Null",
    source: "assets/nft/cards/captain-null.png",
    prompt: "Captain Null, a mysterious astronaut teacher in a black and gold suit, cosmic classroom observatory behind them, premium character portrait",
  },
  "captain-null-eclipse": {
    group: "rare-teacher",
    name: "Captain Null: Eclipse Pass",
    source: "assets/nft/market-cards/captain-null.png",
    prompt: "Captain Null during an eclipse, mysterious astronaut teacher in black and gold suit, cosmic school observatory, premium tall character portrait",
  },
  eliza: {
    group: "rare-teacher",
    name: "Eliza",
    source: "assets/nft/cards/eliza.png",
    prompt: "Eliza, a systems lab teacher with black hair, glasses, white lab coat, holding a transparent tablet, network diagrams behind her",
  },
  rati: {
    group: "rare-teacher",
    name: "Rati",
    source: "assets/nft/cards/rati.png",
    prompt: "Rati, a mythic signal studies teacher with dark hair and round mouse-ear buns, holding a glowing orb marked RATI, golden finance symbols behind her",
  },
};

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
    // .env is optional; process env may already contain the key.
  }
}

function parseArgs() {
  const ids = [];
  let parallel = 1;
  let sample = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--sample") {
      sample = true;
    } else if (arg === "--parallel") {
      parallel = Math.max(1, Number.parseInt(process.argv[index + 1] || "1", 10) || 1);
      index += 1;
    } else if (arg === "--ids") {
      ids.push(...String(process.argv[index + 1] || "").split(",").map((id) => id.trim()).filter(Boolean));
      index += 1;
    } else if (arg && !arg.startsWith("--")) {
      ids.push(arg);
    }
  }
  const selected = ids.length > 0 ? ids : (sample ? ["location-library"] : Object.keys(targets));
  return { ids: selected, parallel };
}

async function dataUrlFor(path) {
  const bytes = await readFile(join(root, path));
  const ext = extname(path).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function imageBytesFromUrl(url) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return { bytes: Buffer.from(match[2] || "", "base64"), ext };
}

async function fetchImageUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image download failed ${response.status} ${response.statusText}`);
  }
  const type = response.headers.get("content-type") || "image/png";
  const ext = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  return { bytes: Buffer.from(await response.arrayBuffer()), ext };
}

function promptFor(target) {
  const aspectInstruction = target.group === "location"
    ? "Composition: wide landscape scene, designed for a 16:9 NFT image."
    : target.group === "rare-teacher"
      ? "Composition: tall character/avatar portrait, designed for a 3:4 NFT image."
      : "Composition: square object-focused collectible image, designed for a 1:1 NFT image.";
  return [
    `Regenerate Ruby High NFT art for: ${target.name}.`,
    `Use the attached image only as composition/reference. Create a clean, high-quality standalone source image, not a screenshot of a card.`,
    target.prompt,
    aspectInstruction,
    "",
    "Style: premium anime-influenced collectible game art, polished lighting, sharp readable subject, cohesive Ruby High school-world aesthetic.",
    "Output: one finished image only. No card border, no stat boxes, no title text, no logo, no watermark, no UI frame, no caption. Keep the main subject fully visible and centered with market-thumbnail-friendly cropping.",
  ].join("\n");
}

async function generateOne(apiKey, id) {
  const target = targets[id];
  if (!target) throw new Error(`unknown target id: ${id}`);
  const reference = await dataUrlFor(target.source);
  const body = {
    model,
    modalities: ["image"],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: promptFor(target) },
        { type: "image_url", image_url: { url: reference } },
      ],
    }],
    image_config: {
      aspect_ratio: target.group === "location" ? "16:9" : target.group === "rare-teacher" ? "3:4" : "1:1",
      image_size: "1K",
    },
    max_tokens: 4000,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(openRouterUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.RUBY_HIGH_OPENROUTER_REFERER || "https://ruby-high.local",
        "X-OpenRouter-Title": "Ruby High NFT Art",
        "X-Title": "Ruby High NFT Art",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  const json = await response.json();
  const imageUrl = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageUrl) throw new Error(`OpenRouter returned no image for ${id}`);
  const image = imageBytesFromUrl(imageUrl) || await fetchImageUrl(imageUrl);
  await mkdir(outputDir, { recursive: true });
  const hash = createHash("sha256").update(image.bytes).digest("hex").slice(0, 12);
  const output = join(outputDir, `${id}.${image.ext}`);
  const hashOutput = join(outputDir, `${id}.${hash}.${image.ext}`);
  await writeFile(output, image.bytes);
  await writeFile(hashOutput, image.bytes);
  return { id, output, hashOutput, bytes: image.bytes.length };
}

async function mapLimit(ids, limit, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, async () => {
    while (next < ids.length) {
      const index = next;
      next += 1;
      out[index] = await fn(ids[index]);
    }
  }));
  return out;
}

loadDotEnv();
const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || process.env.RUBY_HIGH_OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENROUTER_API_KEY, OPENROUTER_KEY, or RUBY_HIGH_OPENROUTER_API_KEY in environment/.env");
}

const { ids, parallel } = parseArgs();
const results = await mapLimit(ids, parallel, (id) => generateOne(apiKey, id));
for (const result of results) {
  console.log(`${result.id} ${result.bytes} ${result.output}`);
}
