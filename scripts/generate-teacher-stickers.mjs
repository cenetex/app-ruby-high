#!/usr/bin/env node
// Generate sticker-style portraits via OpenRouter image generation.
//
// Targets:
//   --target=teachers (default)  Ruby + Sally + Edward
//   --target=students            Lyra, Sami, Ravi, Indra, Mika, Noor
//   --target=all                 both
//
// Variants:
//   --variant=full  (default)  3/4 body hero pose
//   --variant=face            tight head/shoulders crop, for chat avatars
//   --variant=both            generate both sets
//
// Pass specific ids to limit:
//   node scripts/generate-teacher-stickers.mjs --target=students --variant=full lyra noor
//
// Always uses Nano Banana 2 (google/gemini-3.1-flash-image-preview) — the
// model that actually honors the "transparent PNG" request.

import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TEACHERS_DIR = resolve(ROOT, "assets", "teachers");
const STUDENTS_DIR = resolve(ROOT, "assets", "students");

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("Error: OPENROUTER_API_KEY env var is required.");
  process.exit(1);
}
const MODEL = process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-3.1-flash-image-preview";
const REFERER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
const TITLE = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

const args = process.argv.slice(2);
const force = args.includes("--force");
const variantArg = args.find((a) => a.startsWith("--variant=")) ?? "--variant=full";
const variant = variantArg.split("=")[1];
const targetArg = args.find((a) => a.startsWith("--target=")) ?? "--target=teachers";
const target = targetArg.split("=")[1];
const onlyIds = args.filter((a) => !a.startsWith("--"));

// Plain-background portraits (no transparency wrestling). Each character gets
// a flat solid background tinted to their accent — JRPG dialog-portrait style.
function backgroundRules(bg) {
  return [
    `OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT ${bg.color} background (${bg.name}).`,
    "The background fills the whole frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border.",
    "The character is centered, fully on top of the solid background. No transparency, no checkerboard.",
    "Bold black 5px outline around the character is the divider between figure and background.",
  ].join(" ");
}

function sharedStyleFace(bg) {
  return [
    "JRPG-style dialog portrait — head and shoulders, tight crop on the face.",
    "Anime-influenced. Bold black outline 5px. Vibrant flat colors with subtle cel shading.",
    "Expressive face with personality, slight characteristic smile or smirk.",
    "Centered composition, head fills frame, neck and shoulders visible.",
    "No text, no logo, no signature, no caption.",
    backgroundRules(bg),
  ].join(" ");
}

function sharedStyleFull(bg) {
  return [
    "JRPG-style standing portrait — FULL BODY 3/4 view from head to ankles or knees.",
    "Tall portrait orientation. Character occupies the vertical frame, ground line implied not drawn.",
    "Anime-influenced. Bold black outline 5px. Vibrant flat colors with subtle cel shading.",
    "Dynamic relaxed pose, character looks confident and inviting.",
    "Expressive face with personality.",
    "No text, no logo, no signature, no caption.",
    backgroundRules(bg),
  ].join(" ");
}

// Per-character background — JRPG dialog vibes. Each picks a color that
// complements the character's palette without competing.
const BG_RUBY        = { color: "#fdeef0", name: "warm pale pink" };
const BG_SALLY       = { color: "#e6f4f1", name: "pale mint" };
const BG_EDWARD      = { color: "#efe8d8", name: "warm parchment cream" };
const BG_LYRA        = { color: "#fdeef5", name: "soft pink" };
const BG_SAMI        = { color: "#dfe6ec", name: "muted slate gray" };
const BG_RAVI        = { color: "#fdf0d8", name: "soft butter yellow" };
const BG_INDRA       = { color: "#e8efe5", name: "soft sage" };
const BG_MIKA        = { color: "#dff3ee", name: "fresh pale teal" };
const BG_NOOR        = { color: "#e7dfeb", name: "soft pale lilac" };

const TEACHERS = [
  {
    id: "ruby",
    bg: BG_RUBY,
    description: [
      "Ruby — host of Ruby High, a friendly mischievous young woman teacher.",
      "Shoulder-length pink bob hair with straight bangs. Round wireframe glasses.",
      "White lab coat over a black mini dress. Pink lace-up boots.",
      "Warm confident smile, hands clasped near her chest.",
      "Ruby red color accent.",
    ].join(" "),
  },
  {
    id: "sally-science",
    bg: BG_SALLY,
    description: [
      "Sally Science — STEM teacher at Ruby High, sharp graduate-TA energy.",
      "Shoulder-length wavy chestnut brown hair. Yellow-tinted safety goggles pushed up on her head.",
      "White lab coat with sleeves rolled up over a teal shirt. Practical pants and lab boots.",
      "Holding a glowing blue Erlenmeyer flask in one hand, other hand pointing up enthusiastically.",
      "Open-mouth grin showing teeth, freckles across nose.",
      "Cyan and teal color accents.",
    ].join(" "),
  },
  {
    id: "professor-edward",
    bg: BG_EDWARD,
    description: [
      "Professor Edward — older male literature professor at Ruby High.",
      "Neat short gray hair with side part. Well-trimmed gray beard.",
      "Round wire-frame reading glasses perched low on nose.",
      "Brown tweed jacket with leather elbow patches over a cream button-up shirt and dark green tie. Brown wool slacks and brown leather shoes.",
      "Holding an open hardcover book in both hands.",
      "Thoughtful gentle expression with a faint amused half-smile.",
      "Warm umber and forest green color accents.",
    ].join(" "),
  },
];

const STUDENTS = [
  {
    id: "lyra",
    bg: BG_LYRA,
    description: [
      "Lyra — anxious overachiever, junior at Ruby High.",
      "Long straight rose-pink hair tied in a high ponytail with a black scrunchie. Square thin-frame glasses.",
      "Light gray oversized hoodie over a pleated navy school skirt. White knee socks and clean white sneakers.",
      "Clutching a stack of color-coded index cards in one hand, the other hand near her chin in a worried thinking gesture.",
      "Slightly furrowed brow, anxious tight-lipped smile.",
      "Pink and gray color accents.",
    ].join(" "),
  },
  {
    id: "sami",
    bg: BG_SAMI,
    description: [
      "Sami — dry sarcastic chill kid, junior at Ruby High.",
      "Short messy dark brown hair falling over one eye. Faded red-and-black flannel shirt unbuttoned over a vintage band t-shirt.",
      "Loose dark jeans, scuffed black canvas sneakers. Single small silver hoop earring.",
      "Hands shoved in pockets, weight shifted to one leg, slight smirk and one eyebrow raised.",
      "Looking off to the side like they just heard something dumb.",
      "Charcoal and faded red color accents.",
    ].join(" "),
  },
  {
    id: "ravi",
    bg: BG_RAVI,
    description: [
      "Ravi — loud enthusiastic showoff, junior at Ruby High.",
      "Curly black hair, deep brown skin, big bright eyes. Burgundy varsity letter jacket with cream sleeves over a white t-shirt.",
      "Khaki pants and clean white high-top sneakers. Round wristwatch with a leather strap.",
      "Both arms slightly raised in mid-explanation, mouth open in a huge confident grin.",
      "Energetic wide stance, like he's already mid-tangent.",
      "Burgundy and gold color accents.",
    ].join(" "),
  },
  {
    id: "indra",
    bg: BG_INDRA,
    description: [
      "Indra — quiet observant nerd, junior at Ruby High.",
      "Long straight black hair pulled into a low side braid. Light olive skin. Round gold-frame glasses.",
      "Crisp white button-up shirt under a dark forest-green knit cardigan. Long pleated charcoal skirt and small black ankle boots.",
      "Holding a single hardcover book with a finger marking a page. Calm, level expression — eyes that quietly notice everything.",
      "Faint subtle smile that suggests she already knows the answer.",
      "Forest green and gold color accents.",
    ].join(" "),
  },
  {
    id: "mika",
    bg: BG_MIKA,
    description: [
      "Mika — bright supportive jock energy, junior at Ruby High.",
      "Short tousled blonde hair with sun-bleached tips. Tan athletic build. Bright teal letterman jacket over a plain white tank top.",
      "Loose-fit cargo shorts, white athletic sneakers, a colorful friendship bracelet on each wrist.",
      "Big enthusiastic open-mouth smile, one arm raised in a thumbs-up, the other hand on hip.",
      "Stance squared toward camera, projecting hype-supportive teammate vibes.",
      "Teal and warm yellow color accents.",
    ].join(" "),
  },
  {
    id: "noor",
    bg: BG_NOOR,
    description: [
      "Noor — deadpan one-liner master, junior at Ruby High.",
      "Shoulder-length dark hair with bangs cut blunt and straight across. Olive skin. Subtle eyeliner.",
      "Black turtleneck under a dark plum oversized blazer. Black wide-leg pants and black combat boots.",
      "Arms crossed, weight on one leg. Completely flat unimpressed expression — eyebrow slightly raised, mouth a deadpan straight line.",
      "She has just delivered the joke and is waiting for the room to catch up.",
      "Plum, black, and silver color accents.",
    ].join(" "),
  },
];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function callOpenRouter(prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "HTTP-Referer": REFERER,
      "X-Title": TITLE,
    },
    body: JSON.stringify({
      model: MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: prompt }],
      // OpenRouter counts image tokens against this; if your account is
      // close to its limit, set OPENROUTER_IMAGE_MAX_TOKENS lower.
      max_tokens: Number(process.env.OPENROUTER_IMAGE_MAX_TOKENS ?? 5000),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text || res.statusText}`);
  }
  const body = await res.json();
  const choice = body?.choices?.[0];
  const images = choice?.message?.images;
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("No images in response. Body: " + JSON.stringify(body).slice(0, 600));
  }
  const url = images[0]?.image_url?.url;
  if (typeof url !== "string") throw new Error("Image url missing");
  const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error("Unexpected image url format: " + url.slice(0, 80));
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

async function generateOne({ id, description, bg, kind }, variantName) {
  const suffix = variantName === "face" ? "-face" : "-full";
  const styleHeader = variantName === "face" ? sharedStyleFace(bg) : sharedStyleFull(bg);
  const dir = kind === "students" ? STUDENTS_DIR : TEACHERS_DIR;
  const path = resolve(dir, `${id}${suffix}.png`);
  if (!force && await exists(path)) {
    console.log(`✓ skip ${id}${suffix}.png (exists, --force to regen)`);
    return;
  }
  const prompt = `${description}\n\nSTYLE: ${styleHeader}`;
  process.stdout.write(`… generating ${id}${suffix}.png ... `);
  const t0 = Date.now();
  try {
    const { buffer } = await callOpenRouter(prompt);
    await mkdir(dir, { recursive: true });
    await writeFile(path, buffer);
    console.log(`done (${(Date.now() - t0)}ms, ${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }
}

async function main() {
  const groups = [];
  if (target === "teachers" || target === "all") groups.push({ kind: "teachers", roster: TEACHERS });
  if (target === "students" || target === "all") groups.push({ kind: "students", roster: STUDENTS });
  if (groups.length === 0) {
    console.error("Unknown --target. Use: teachers | students | all");
    process.exit(1);
  }
  const variants = variant === "both" ? ["full", "face"] : [variant];
  console.log(`Model: ${MODEL}`);
  console.log(`Targets: ${groups.map((g) => g.kind).join(", ")} · variants: ${variants.join(", ")}`);
  for (const group of groups) {
    const targets = onlyIds.length > 0
      ? group.roster.filter((t) => onlyIds.includes(t.id))
      : group.roster;
    if (targets.length === 0) continue;
    console.log(`→ ${group.kind} (${group.kind === "students" ? STUDENTS_DIR : TEACHERS_DIR})`);
    for (const v of variants) {
      for (const t of targets) {
        await generateOne({ ...t, kind: group.kind }, v);
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
