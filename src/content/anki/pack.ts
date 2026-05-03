/**
 * Anki deck → ContentPack. Wires the parser + the LLM distractor
 * generator into a single ContentPack the rest of the system already
 * knows how to play. The generated pack has ONE faculty (the deck
 * becomes a single classroom) — multi-deck import is a follow-up.
 *
 * UNWIRED. The pack-store routes (PR C) call buildAnkiPack; nothing in
 * the live system does today. Tests mock OpenRouter and verify the
 * end-to-end deck → pack assembly.
 */

import type { ContentPack, PackFaculty, PackRoom } from "../types.js";
import { generateBankFromCards, type DistractorOpts } from "./distractors.js";
import type { AnkiDeck } from "./parse.js";

export interface BuildAnkiPackOpts {
  apiKey: string;
  /** Override the auto-derived pack id (default: `anki:<slug>-<suffix>`). */
  packId?: string;
  /** Override the auto-derived pack name. Defaults to the deck name. */
  packName?: string;
  /** Faculty display name. Defaults to the deck name. */
  facultyName?: string;
  /** Faculty hex accent color. Defaults to a hash of the deck name so
   *  multiple Anki packs in the channels rail don't all read as the
   *  same blue. */
  accent?: string;
  /** Cap on cards processed (cost cap for the LLM call). Default 100. */
  maxCards?: number;
  /** Forwarded to the distractor generator. */
  concurrency?: number;
  /** Forwarded — fires once per card so the import UI can show progress. */
  onProgress?: (done: number, total: number) => void;
  /** Suffix appended to the auto-derived pack id to disambiguate
   *  re-imports of the same deck name. Tests pass a fixed value;
   *  production passes a short timestamp+random tail. */
  idSuffix?: string;
}

export interface BuildAnkiPackResult {
  pack: ContentPack;
  /** Cards we couldn't generate distractors for. */
  skipped: number;
}

export async function buildAnkiPack(
  deck: AnkiDeck,
  opts: BuildAnkiPackOpts,
): Promise<BuildAnkiPackResult> {
  const cap = Math.max(1, Math.min(500, opts.maxCards ?? 100));
  const cards = deck.cards.slice(0, cap);
  const suffix = opts.idSuffix ?? defaultIdSuffix();
  const baseSlug = slug(opts.packId ?? deck.name);
  const facultyId = `${baseSlug}-${suffix}`;
  const subject = slug(deck.name) || "anki";
  const accent = opts.accent ?? hashedAccent(deck.name);
  const distractorOpts: DistractorOpts = {
    apiKey: opts.apiKey,
    facultyId,
    subject,
    difficulty: "medium",
    concurrency: opts.concurrency,
    onProgress: opts.onProgress,
  };
  const { questions, skipped } = await generateBankFromCards(cards, distractorOpts);

  const faculty: PackFaculty = {
    id: facultyId,
    displayName: opts.facultyName ?? deck.name,
    shortName: shortenName(opts.facultyName ?? deck.name),
    subjects: [subject],
    bio: `Anki-imported deck: ${deck.name}.`,
    accent,
    systemPrompt: anchoredTeacherPrompt(deck.name),
    defaultModel: "anthropic/claude-haiku-4.5",
    questions,
  };
  const room: PackRoom = {
    id: `${facultyId}-room`,
    name: faculty.displayName,
    channelName: baseSlug,
    teacherId: facultyId,
    description: `Anki: ${deck.name}.`,
    teaches: true,
  };
  const pack: ContentPack = {
    id: opts.packId ?? `anki:${facultyId}`,
    name: opts.packName ?? deck.name,
    description: `Imported from Anki: ${deck.name}. ${questions.length} questions.`,
    version: "1.0.0",
    faculty: [faculty],
    rooms: [room],
  };
  return { pack, skipped };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "deck";
}

function shortenName(name: string): string {
  // Take the first comma/colon/dash-separated chunk; cap at 16 chars.
  const head = name.split(/[,:\-–—]/)[0]?.trim() ?? name;
  return head.length > 16 ? head.slice(0, 14) + "…" : head;
}

function defaultIdSuffix(): string {
  // 6-char base36 timestamp+random tail. Collision-resistant within a
  // session without dragging in a UUID dep. Two imports in the same
  // millisecond still differ via Math.random.
  const t = Date.now().toString(36).slice(-4);
  const r = Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, "0");
  return `${t}${r}`;
}

function hashedAccent(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 60, 52);
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)        { r = c; g = x; }
  else if (h < 120)  { r = x; g = c; }
  else if (h < 180)  { g = c; b = x; }
  else if (h < 240)  { g = x; b = c; }
  else if (h < 300)  { r = x; b = c; }
  else               { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function anchoredTeacherPrompt(deckName: string): string {
  return [
    `You are the teacher for an Anki deck called "${deckName}". You run a small classroom drilling this material.`,
    `Your job: pose questions from the bank, react crisply to the student's answers, and keep the class moving.`,
    `Stay in voice as a focused, encouraging tutor specific to the deck topic. No fake biographical detail —`,
    `the deck title is what defines you. If the topic is biology you sound like a bio teacher; if it's law you sound like a law professor.`,
    `Tools: pick_from_bank for the next question. clear_board between rounds. Keep replies tight (1-2 sentences).`,
  ].join(" ");
}
