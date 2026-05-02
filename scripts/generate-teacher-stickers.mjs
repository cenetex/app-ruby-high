#!/usr/bin/env node
// Generate sticker-style teacher portraits via OpenRouter image generation.
//
// Variants:
//   --variant=full  (default) — 3/4 body, hero pose, for the blackboard side panel
//   --variant=face            — tight head/shoulders crop, for chat avatars
//   --variant=both            — generate both sets
//
// Model defaults to Nano Banana 2 (gemini-3.1-flash-image-preview) which
// honors transparent backgrounds. Override with OPENROUTER_IMAGE_MODEL.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-... node scripts/generate-teacher-stickers.mjs --variant=face
//   OPENROUTER_API_KEY=sk-or-... node scripts/generate-teacher-stickers.mjs --variant=both --force
//   OPENROUTER_API_KEY=sk-or-... node scripts/generate-teacher-stickers.mjs --variant=face ruby

import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = resolve(ROOT, "assets", "teachers");

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
const variantArg = args.find((a) => a.startsWith("--variant="));
const variant = variantArg ? variantArg.split("=")[1] : "full";
const onlyIds = args.filter((a) => !a.startsWith("--"));

const SHARED_STYLE_FACE = [
  "telegram-sticker style headshot portrait",
  "tight crop on face and shoulders",
  "bold thick black outline 5px",
  "vibrant flat colors with subtle cel shading",
  "anime-influenced",
  "expressive face, friendly smile",
  "TRANSPARENT PNG background — no background color, just the character on alpha",
  "centered composition, head fills frame",
  "no text, no logo, no border, no signature, no scenery",
].join(", ");

const SHARED_STYLE_FULL = [
  "telegram-sticker style 3/4 body pose",
  "from waist up, slight dynamic angle, character looks confident and inviting",
  "bold thick black outline 5px",
  "vibrant flat colors with subtle cel shading",
  "anime-influenced",
  "expressive face, slight smile",
  "TRANSPARENT PNG background — no background color, just the character on alpha",
  "centered composition, character fills frame vertically",
  "no text, no logo, no border, no signature, no scenery",
].join(", ");

const TEACHERS = [
  {
    id: "ruby",
    description: [
      "Ruby — host of Ruby High, a friendly mischievous young woman teacher",
      "shoulder-length pink bob hair with straight bangs",
      "wearing a white lab coat over a black mini dress",
      "wireframe round glasses",
      "warm confident smile, hands clasped near her chest",
      "ruby red color accent",
    ].join(", "),
  },
  {
    id: "sally-science",
    description: [
      "Sally Science — STEM teacher at Ruby High, sharp graduate-TA energy",
      "shoulder-length wavy chestnut brown hair",
      "wearing a white lab coat with sleeves rolled up to elbow over a teal shirt",
      "yellow-tinted safety goggles pushed up on top of her head",
      "holding a glowing blue Erlenmeyer flask in one hand, other hand pointing up",
      "enthusiastic open-mouth grin, freckles across nose",
      "cyan and teal color accents",
    ].join(", "),
  },
  {
    id: "professor-edward",
    description: [
      "Professor Edward — older male literature professor at Ruby High",
      "neat short gray hair with side part, well-trimmed gray beard",
      "wearing a brown tweed jacket with leather elbow patches over a cream button-up shirt and dark green tie",
      "round wire-frame reading glasses perched low on nose",
      "holding an open hardcover book in both hands",
      "thoughtful gentle expression with a faint amused half-smile",
      "warm umber and forest green color accents",
    ].join(", "),
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

async function generateOne(teacher, variantName) {
  const suffix = variantName === "face" ? "-face" : "-full";
  const styleHeader = variantName === "face" ? SHARED_STYLE_FACE : SHARED_STYLE_FULL;
  const path = resolve(OUT_DIR, `${teacher.id}${suffix}.png`);
  if (!force && await exists(path)) {
    console.log(`✓ skip ${teacher.id}${suffix}.png (exists, --force to regen)`);
    return;
  }
  const prompt = `${teacher.description}.\n\nSTYLE: ${styleHeader}.`;
  process.stdout.write(`… generating ${teacher.id}${suffix}.png ... `);
  const t0 = Date.now();
  try {
    const { buffer } = await callOpenRouter(prompt);
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path, buffer);
    console.log(`done (${(Date.now() - t0)}ms, ${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }
}

async function main() {
  const targets = onlyIds.length > 0
    ? TEACHERS.filter((t) => onlyIds.includes(t.id))
    : TEACHERS;
  if (targets.length === 0) {
    console.error("No teacher ids matched. Available:", TEACHERS.map((t) => t.id).join(", "));
    process.exit(1);
  }
  const variants = variant === "both" ? ["full", "face"] : [variant];
  console.log(`Model: ${MODEL}`);
  console.log(`Variant(s): ${variants.join(", ")}`);
  console.log(`→ ${OUT_DIR}`);
  for (const v of variants) {
    for (const t of targets) {
      await generateOne(t, v);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
