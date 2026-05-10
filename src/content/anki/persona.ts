/**
 * Anki deck → thematic class identity (class name + teacher persona).
 *
 * The bare deck name is often a flat label ("Spanish 101 - Verbs") and
 * the auto-derived faculty falls through to a generic "anchored teacher"
 * prompt that reads as filler. To make the import feel like a real
 * classroom inside Ruby High we sample a handful of cards and ask the
 * LLM to write:
 *
 *   - className     — the channel name + chalkboard subject pill
 *   - teacherName   — the displayName of the new faculty
 *   - teacherTitle  — short prefix or epithet (e.g. "Dr." / "the Cataloguer")
 *   - bio           — one short sentence the player sees on the teacher card
 *   - signature     — MTG-style flavor line in voice
 *   - systemPrompt  — full character system prompt for chat turns
 *
 * One LLM call per import. Cheap (haiku, ~$0.001). Failures fall back
 * to the deck-name-as-name behavior so a missing key or a parse failure
 * never blocks the import — the player still gets a working pack, just
 * less flavorful.
 */

import type { AnkiCard } from "./parse.js";
import { openRouterJson, STUDENT_MODEL, type OpenRouterChatCompletion } from "../../services/openrouter-client.js";

export interface PersonaOpts {
  apiKey: string;
  deckName: string;
  /** A representative slice of the deck. We pass front/back so the LLM
   *  can read the actual content style, not just the deck label. Cap
   *  at ~6 cards to keep the prompt tight. */
  sampleCards: AnkiCard[];
  /** OpenRouter model override. */
  model?: string;
}

export interface PersonaResult {
  className: string;
  teacherName: string;
  teacherTitle?: string;
  bio: string;
  signature: string;
  systemPrompt: string;
}

const MAX_SAMPLES = 6;

/** Generate a thematic persona from a sample of Anki cards. Throws on
 *  network / parse failure — caller decides whether to swallow. */
export async function generateAnkiPersona(opts: PersonaOpts): Promise<PersonaResult> {
  const sample = opts.sampleCards.slice(0, MAX_SAMPLES).map((c, i) => {
    const front = c.front.replace(/\s+/g, " ").slice(0, 240).trim();
    const back  = c.back.replace(/\s+/g, " ").slice(0, 240).trim();
    return `[${i + 1}] Q: ${front}\n    A: ${back}`;
  }).join("\n");

  const userPrompt = [
    `An Anki deck imported into a high-school RPG. Read the deck name and a slice of its cards, then write a thematic teacher persona for the room that drills this material.`,
    ``,
    `Deck name: "${opts.deckName}"`,
    ``,
    `Sample cards (front/back):`,
    sample,
    ``,
    `Return JSON in this exact shape (no other text, no code fences):`,
    `{"className":"...","teacherName":"...","teacherTitle":"...","bio":"...","signature":"...","systemPrompt":"..."}`,
    ``,
    `Field guidance:`,
    `- className: 2-4 words, the channel/room name. Title-cased. Match the SUBJECT, not the deck title verbatim. Examples: "Vertebrate Anatomy" / "Trial Procedure" / "Spanish Conjugations" / "Norse Mythology".`,
    `- teacherName: a single first + last name that fits the subject's voice. Pick something specific and memorable, not generic. Avoid AI-default names like Smith, Johnson, Davis.`,
    `- teacherTitle: optional honorific or epithet — "Dr.", "Coach", "the Reader" — that adds character. Keep it short. Use "" when none fits.`,
    `- bio: 1-2 sentences. Who the teacher is, why they care about THIS material. Tie a small specific to the subject (a study they did, a battle they re-enact, the textbook they hate). Third person.`,
    `- signature: ONE line of MTG-style flavor text in their voice. 6-18 words. No surrounding quote marks.`,
    `- systemPrompt: 4-6 sentences. Same anchored-teacher template ('You are X, you run a small classroom drilling Y...') but in their voice. Include their teaching style, their pet pet-peeve, what they reward in students. Reference at least one concrete detail from the sample cards so the model stays grounded in the actual material. Mention they have pick_from_bank and clear_board tools and should keep replies tight (1-2 sentences).`,
  ].join("\n");

  const body = await openRouterJson<OpenRouterChatCompletion>({
    apiKey: opts.apiKey,
    label: "anki-persona",
    title: "Ruby High Anki Persona",
    body: {
      model: opts.model ?? STUDENT_MODEL,
      messages: [
        { role: "system", content: "You write thematic teacher personas for an RPG school. Output VALID JSON only — no commentary, no code fences, no extra keys." },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 700,
      temperature: 1.0,
    },
  });
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const className = String(parsed.className ?? "").trim();
  const teacherName = String(parsed.teacherName ?? "").trim();
  const teacherTitle = String(parsed.teacherTitle ?? "").trim();
  const bio = String(parsed.bio ?? "").trim();
  const signature = String(parsed.signature ?? "").trim().replace(/^["“'\s]+|["”'\s]+$/g, "");
  const systemPrompt = String(parsed.systemPrompt ?? "").trim();
  if (!className || !teacherName || !bio || !systemPrompt) {
    throw new Error(`Persona response missing required fields: ${cleaned.slice(0, 200)}`);
  }
  return {
    className,
    teacherName,
    teacherTitle: teacherTitle || undefined,
    bio,
    signature,
    systemPrompt,
  };
}
