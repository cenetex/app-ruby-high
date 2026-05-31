import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { PLAYBOOKS } from "../characters/playbooks.js";
import type { CharacterStats } from "../types.js";
import { log } from "./logger.js";
import {
  openRouterJson,
} from "./openrouter-client.js";
import {
  fetchLlmChatCompletions,
  resolveStudentModel,
  throwLlmResponseError,
} from "./llm-provider.js";

const PORTRAIT_MODEL = process.env.RUBY_HIGH_PORTRAIT_MODEL ?? "google/gemini-3.1-flash-image-preview";
const PORTRAIT_MAX_TOKENS = Number(process.env.RUBY_HIGH_PORTRAIT_MAX_TOKENS ?? 4000);
const PORTRAIT_TIMEOUT_MS = 60_000;

interface PortraitResponse {
  choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
}

interface CharacterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function fetchPortraitOnce(args: {
  apiKey: string;
  prompt: string;
}): Promise<string> {
  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "portrait",
    timeoutMs: PORTRAIT_TIMEOUT_MS,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: args.prompt }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter returned no image (likely a content-filter trip; try a different name/personality).");
  return url;
}

let portraitS3Client: S3Client | null = null;

function getPortraitS3Client(): S3Client | null {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  if (!bucket) return null;
  if (portraitS3Client) return portraitS3Client;
  portraitS3Client = new S3Client({
    region: process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  });
  return portraitS3Client;
}

export async function maybeUploadPortrait(dataUrl: string, kind: "portrait" | "diploma"): Promise<string> {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  const client = getPortraitS3Client();
  if (!bucket || !client) return dataUrl;

  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return dataUrl;

  const mime = match[1] ?? "image/png";
  const bytes = Buffer.from(match[2] ?? "", "base64");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const key = `${kind}/${hash}.${ext}`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } catch (err) {
    log.error("portrait.s3-upload-failed", err, { kind, bucket, key, bytes: bytes.length });
    throw new Error("portrait upload failed: " + (err instanceof Error ? err.message : String(err)));
  }
  const base = process.env.RUBY_HIGH_PORTRAITS_PUBLIC_BASE
    ?? `https://${bucket}.s3.${process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "us-east-1"}.amazonaws.com`;
  return base.replace(/\/+$/, "") + "/" + key;
}

export async function renderCharacterPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const prompt = [
    `JRPG dialog-portrait of ${args.name}, a high schooler at Ruby High.`,
    `Personality: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Dynamic relaxed pose, expressive face that fits the personality.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("portrait.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderTeacherPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const prompt = [
    `JRPG faculty portrait of ${args.name}, a teacher at Ruby High.`,
    `Teaching style: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing faculty portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Confident classroom pose, expressive face, age-appropriate adult teacher.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("teacher-portrait.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderDiplomaImage(args: {
  apiKey: string;
  name: string;
  personality: string;
  bestSubjectFacultyId: string;
}): Promise<string> {
  const accessory = (() => {
    switch (args.bestSubjectFacultyId) {
      case "sally-science": return "holding a beaker that glows faintly green";
      case "professor-edward": return "holding a thick hardcover book against their chest";
      case "ruby":
      default: return "holding a rolled diploma scroll tied with a red ribbon";
    }
  })();
  const prompt = [
    `JRPG dialog-portrait of ${args.name} at their Ruby High graduation.`,
    `Personality: ${args.personality}`,
    "",
    `STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. The character is wearing a high-school graduation cap and gown over their normal clothes — gown is a warm crimson red, cap is matching with a yellow tassel. They are smiling, proud but a little nervous. ${accessory}.`,
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale gold background (#f5e8c2). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("diploma.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderClassPhoto(args: {
  apiKey: string;
  studentImages: Array<{ name: string; imageUrl: string }>;
}): Promise<string> {
  const { apiKey, studentImages } = args;
  if (studentImages.length === 0) throw new Error("No student images provided.");
  // Build a content array with all student images + prompt.
  const contentParts: Array<Record<string, unknown>> = [];
  for (const s of studentImages) {
    contentParts.push({
      type: "image_url",
      image_url: { url: s.imageUrl },
    });
  }
  const nameList = studentImages.map((s) => s.name).join(", ");
  contentParts.push({
    type: "text",
    text: [
      `Arrange these ${studentImages.length} students (${nameList}) into a CLASS PHOTO.`,
      "STYLE: JRPG-style group photo — a single wide horizontal image. Students stand together in 1-2 rows against a SOLID FLAT pale lavender background (#ece6f5). Each student keeps their original appearance, outfit, and art style. 5px bold black outlines. Vibrant flat colors. Everyone visible, no one cut off. Natural group arrangement — some in front, some behind, like a real class photo.",
      "OUTPUT: a single wide image containing all students together. Solid pale lavender background. No text, no names, no labels.",
    ].join("\n"),
  });

  const body = await openRouterJson<PortraitResponse>({
    apiKey,
    label: "class-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2, // composite takes longer
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Class photo generation returned no image.");
  return url;
}

export function highestScoringFaculty(scores: Record<string, { correct: number; total: number }> | undefined): string {
  if (!scores) return "ruby";
  let best: { id: string; ratio: number; total: number } | null = null;
  for (const [id, s] of Object.entries(scores)) {
    if (s.total === 0) continue;
    const ratio = s.correct / s.total;
    if (!best || ratio > best.ratio || (ratio === best.ratio && s.total > best.total)) {
      best = { id, ratio, total: s.total };
    }
  }
  return best ? best.id : "ruby";
}

function randomStatDistribution(): CharacterStats {
  const values = [2, 1, 0, -1];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = values[i]!;
    values[i] = values[j]!;
    values[j] = tmp;
  }
  return { head: values[0]!, heart: values[1]!, hustle: values[2]!, honor: values[3]! };
}

const FORBIDDEN_NAMES_HINT = [
  "Marcus", "Maya", "Mariana", "Emma", "Sarah", "James", "Alex", "Sam", "Jordan", "Liam",
  "Olivia", "Noah", "Ava", "Mia", "Ethan", "Aiden", "Lucas", "Harper", "Sophia",
];

export type CharacterComponent = "name" | "personality" | "arcAnswer" | "flavorQuote" | "stats" | "playbook";
const ALL_COMPONENTS: CharacterComponent[] = ["name", "personality", "arcAnswer", "flavorQuote", "stats", "playbook"];

export interface RolledCharacter {
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote: string;
  personality: string;
}

export async function rollRandomCharacter(args: {
  apiKey: string;
  regen?: CharacterComponent[];
  keep?: Partial<RolledCharacter>;
}): Promise<RolledCharacter> {
  const regenSet = new Set<CharacterComponent>(args.regen && args.regen.length > 0 ? args.regen : ALL_COMPONENTS);
  const keep = args.keep ?? {};

  let playbook = regenSet.has("playbook")
    ? PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!
    : PLAYBOOKS.find((p) => p.id === keep.playbookId);
  if (!playbook) {
    playbook = PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!;
  }
  const stats: CharacterStats = regenSet.has("stats") || !keep.stats
    ? randomStatDistribution()
    : keep.stats;

  const textFields: CharacterComponent[] = ["name", "personality", "arcAnswer", "flavorQuote"];
  const textRegen = textFields.filter((f) => regenSet.has(f));
  if (textRegen.length === 0) {
    const name = String(keep.name ?? "").trim();
    const arcAnswer = String(keep.arcAnswer ?? "").trim();
    const flavorQuote = String(keep.flavorQuote ?? "").trim();
    const personality = String(keep.personality ?? "").trim();
    if (!name || !arcAnswer || !personality) {
      throw new Error("Dice-only reroll requires name, arcAnswer, and personality in `keep`.");
    }
    return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
  }

  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const lockedLines: string[] = [];
  if (!regenSet.has("name") && keep.name) lockedLines.push(`Existing name (do not change): ${keep.name}`);
  if (!regenSet.has("personality") && keep.personality) lockedLines.push(`Existing personality (do not change): ${keep.personality}`);
  if (!regenSet.has("arcAnswer") && keep.arcAnswer) lockedLines.push(`Existing arcAnswer (do not change): ${keep.arcAnswer}`);
  if (!regenSet.has("flavorQuote") && keep.flavorQuote) lockedLines.push(`Existing flavorQuote (do not change): ${keep.flavorQuote}`);

  const schemaFields = textRegen.map((f) => `"${f}":"..."`).join(",");
  const schemaLine = `{${schemaFields}}`;

  const userPrompt = [
    "Roll a random AI student attending Ruby High (a high school RPG). The player inhabits this character. Aim for a real teenager with small specific concerns — the register of group-chat texts, lunch-line gossip, a half-finished homework excuse.",
    "",
    `Playbook (locked): ${playbook.name} — ${playbook.blurb}`,
    `Hook question (locked): "${playbook.hookQuestion}"`,
    `Stats (locked): HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}`,
    ...lockedLines,
    "",
    "Generate JSON containing ONLY the fields below (no other text, no markdown, no code fences). Output exactly this shape:",
    schemaLine,
    "",
    "Field guidance:",
    "- name: ONE first name. Anything goes — common, uncommon, a chosen name, a nickname, a strange spelling. The kind of name a teenager actually has. Examples of the spread: Kit, Theo, Saoirse, Mei, Pip, Yusuf, Birta, Lior, Niamh, Tomás, Arlo, Vic, Ren, Esi, Soren. Skip the AI-default picks: " + FORBIDDEN_NAMES_HINT.join(", ") + ".",
    "- arcAnswer: 1-2 sentences answering the hook in voice. Specific, dorky, small. Examples of the register:",
    `    Overachiever / "Why is Cs not enough?": "honestly if i get an A- i replay it for like a week. last quiz i missed one and didn't sleep. my mom thinks im fine."`,
    `    Slacker / "Who do you not want to disappoint?": "my older brother. he was good at this stuff. its embarrassing how much i think about it."`,
    `    Class Clown / "What can't you say without a joke?": "anytime someone cries i panic and do a bit. did one at my uncle's funeral. my mom is still annoyed."`,
    `    Lifer / "What's the best gossip you've picked up?": "the science wing has a closet with 40 trophies from 1987 and nobody knows why. also Mr. Kelner is on his third divorce."`,
    "    Pull from the same register as the playbook above.",
    "- flavorQuote: ONE short line, 6-18 words. Magic: the Gathering flavor text — captures attitude in a moment, not backstory. Examples of the right shape:",
    `    "I'd rather you be wrong with reasons than right by accident." (Sally Science)`,
    `    "wait what — i KNEW it was c. ok im rewriting my notes." (Lyra)`,
    `    "i'm just here to drink chocolate milk and lose, and im out of chocolate milk."`,
    `    "if mr. patek calls on me one more time im transferring to the moon."`,
    "  No surrounding quote marks — the renderer adds them.",
    "- personality: 2-3 sentences. How they SHOW UP in class — fixations, doodles, what they whisper, who they sit by, their thing. Tie one trait to a high stat (HEAD=sharp / HEART=warm / HUSTLE=quick / HONOR=principled) and one to the low stat. Examples of the register:",
    `    "Always has gum, never offers it. Sits by the broken radiator on purpose because the noise helps her think. Doodles snakes through every verbal lesson and forgets her name is being called."`,
    `    "Knows the lyrics to one (1) song and references it constantly. Visibly stressed when the teacher reorders the day. Will eat anyone's leftover fries without asking."`,
    "    Third person. Same scale as those — kid stuff, not life themes.",
  ].join("\n");

  const r = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    body: {
      model: resolveStudentModel(),
      messages: [
        { role: "system", content: "You generate compact JSON character sheets for a high school RPG. Output VALID JSON only — no commentary, no code fences, no extra keys." },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 480,
      temperature: 1.1,
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "character");
  const body = await r.json() as CharacterResponse;
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: { name?: unknown; arcAnswer?: unknown; flavorQuote?: unknown; personality?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse character JSON: ${(err as Error).message} — body: ${cleaned.slice(0, 200)}`);
  }

  const pick = (field: "name" | "arcAnswer" | "flavorQuote" | "personality"): string => {
    if (regenSet.has(field)) {
      const v = String(parsed[field] ?? "").trim();
      return field === "flavorQuote" ? v.replace(/^["“'\s]+|["”'\s]+$/g, "") : v;
    }
    return String(keep[field] ?? "").trim();
  };
  const name = pick("name");
  const arcAnswer = pick("arcAnswer");
  const flavorQuote = pick("flavorQuote");
  const personality = pick("personality");
  if (!name || !arcAnswer || !personality) {
    throw new Error("Generated character missing required fields.");
  }
  return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
}
