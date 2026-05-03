/**
 * Anki deck → ContentPack. Wires the parser + the LLM distractor
 * generator into a single ContentPack the rest of the system already
 * knows how to play. The generated pack has ONE faculty (the deck
 * becomes a single classroom) — multi-deck import (one .apkg per
 * faculty for a 3-faculty pack) is a follow-up.
 */

import type { ContentPack, PackFaculty, PackRoom } from "../types.js";
import { generateBankFromCards, type DistractorOpts } from "./distractors.js";
import type { AnkiDeck } from "./parse.js";

export interface BuildAnkiPackOpts {
  apiKey: string;
  /** Override the auto-derived pack id. */
  packId?: string;
  /** Override the auto-derived pack name. Defaults to the deck name. */
  packName?: string;
  /** Faculty display name. Defaults to the deck name. */
  facultyName?: string;
  /** Faculty hex accent color. Defaults to a steady blue. */
  accent?: string;
  /** Cap on cards processed (cost cap for the LLM call). Defaults to 100. */
  maxCards?: number;
  /** Forwarded to the distractor generator. */
  concurrency?: number;
  /** Forwarded — fires once per card so the import UI can show progress. */
  onProgress?: (done: number, total: number) => void;
}

export interface BuildAnkiPackResult {
  pack: ContentPack;
  /** Cards we couldn't generate distractors for. The import UI surfaces
   *  this as "imported X of Y cards." */
  skipped: number;
}

export async function buildAnkiPack(
  deck: AnkiDeck,
  opts: BuildAnkiPackOpts,
): Promise<BuildAnkiPackResult> {
  const cap = Math.max(1, Math.min(500, opts.maxCards ?? 100));
  const cards = deck.cards.slice(0, cap);
  const facultyId = slug(opts.packId ?? deck.name);
  const subject = slug(deck.name) || "anki";
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
    accent: opts.accent ?? "#3aa3e0",
    systemPrompt: anchoredTeacherPrompt(deck.name),
    defaultModel: "anthropic/claude-haiku-4.5",
    questions,
  };
  const room: PackRoom = {
    id: `${facultyId}-room`,
    name: faculty.displayName,
    channelName: facultyId,
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

function anchoredTeacherPrompt(deckName: string): string {
  // The Anki teacher doesn't have a hand-tuned voice — give them a clean
  // generic-but-engaged tutor persona scoped to the deck topic. The
  // group-chat shared-rules block is added by composeForOpenRouter.
  return [
    `You are the teacher for an Anki deck called "${deckName}". You run a small classroom drilling this material.`,
    `Your job: pose questions from the bank, react crisply to the student's answers, and keep the class moving.`,
    `Stay in voice as a focused, encouraging tutor specific to the deck topic. No fake biographical detail —`,
    `the deck title is what defines you. If the topic is biology you sound like a bio teacher; if it's law you sound like a law professor.`,
    `Tools: pick_from_bank for the next question. clear_board between rounds. Keep replies tight (1-2 sentences).`,
  ].join(" ");
}
