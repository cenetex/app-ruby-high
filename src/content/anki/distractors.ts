/**
 * Anki front/back → multiple-choice question. Calls OpenRouter with a
 * tight prompt to generate three plausible wrong answers, then assembles
 * a BankedQuestion the rest of the system already knows how to play.
 *
 * Cost shape: ~$0.001 per card with claude-haiku-4.5. A 100-card deck
 * runs ~$0.10. Distractor results are cached on the resulting pack so
 * re-imports of the same deck are free (the cache lives in the pack
 * registry; cleared when the user evicts the pack).
 *
 * Failure mode: if the LLM returns an unusable result (parses fail,
 * distractors collide with the correct answer, etc.) we drop the card
 * rather than ship a broken question. Caller sees a per-card success
 * count + skipped count for a "imported 87/100" UX.
 */

import type { BankedQuestion, Choice, Difficulty } from "../../types.js";
import type { AnkiCard } from "./parse.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface DistractorOpts {
  apiKey: string;
  /** Faculty id to stamp on the resulting question — the BankedQuestion
   *  schema requires this so pickQuestion can scope to a faculty. */
  facultyId: string;
  /** Subject label — typically the Anki deck name. Surfaces as the
   *  subject pill on the chalkboard. */
  subject: string;
  /** Difficulty — Anki doesn't carry one, so the caller picks. */
  difficulty?: Difficulty;
  /** OpenRouter model. Defaults to a cheap fast one. */
  model?: string;
  /** Max retries on a parse failure for a single card before giving up. */
  maxRetriesPerCard?: number;
  /** Concurrency cap on the parallel LLM calls. Higher = faster import,
   *  bigger spike on the user's OpenRouter quota. */
  concurrency?: number;
  /** Optional progress callback — invoked once per card with (done, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface DistractorResult {
  questions: BankedQuestion[];
  /** Cards we couldn't generate distractors for. The import UI surfaces
   *  this as "imported X of Y cards; the rest were skipped." */
  skipped: number;
}

/** Generate MC questions for every card in the deck, in parallel under
 *  the concurrency cap. Returns whatever succeeded. */
export async function generateBankFromCards(
  cards: AnkiCard[],
  opts: DistractorOpts,
): Promise<DistractorResult> {
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  const out: BankedQuestion[] = [];
  let skipped = 0;
  let done = 0;
  const queue = [...cards];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const card = queue.shift();
      if (!card) return;
      try {
        const q = await cardToMcQuestion(card, opts);
        if (q) out.push(q);
        else skipped += 1;
      } catch {
        // Hard failure on a single card shouldn't kill the import.
        skipped += 1;
      } finally {
        done += 1;
        opts.onProgress?.(done, cards.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { questions: out, skipped };
}

async function cardToMcQuestion(
  card: AnkiCard,
  opts: DistractorOpts,
): Promise<BankedQuestion | null> {
  const max = opts.maxRetriesPerCard ?? 1;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const distractors = await callOpenRouterForDistractors(card, opts);
      // Validate: 3 unique strings, none equal to the correct answer.
      const cleaned = distractors
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .filter((d) => normalizeAnswer(d) !== normalizeAnswer(card.back));
      const unique = Array.from(new Set(cleaned.map((d) => d.toLowerCase())))
        .map((lower) => cleaned.find((d) => d.toLowerCase() === lower)!);
      if (unique.length < 3) continue; // model under-delivered, retry

      // Shuffle correct + 3 distractors into A/B/C/D and record the slot.
      const all = [card.back, unique[0]!, unique[1]!, unique[2]!];
      const order = shuffle(all);
      const correctIdx = order.findIndex((s) => normalizeAnswer(s) === normalizeAnswer(card.back));
      const correct = (["A", "B", "C", "D"] as Choice[])[correctIdx]!;
      return {
        id: `anki-${card.noteId}`,
        prompt: card.front,
        options: { A: order[0]!, B: order[1]!, C: order[2]!, D: order[3]! },
        correct,
        explanation: undefined,
        subject: opts.subject,
        difficulty: opts.difficulty ?? "medium",
        faculty: opts.facultyId,
      };
    } catch {
      // Retry — typically a transient rate-limit or parse glitch.
      if (attempt === max) return null;
    }
  }
  return null;
}

async function callOpenRouterForDistractors(
  card: AnkiCard,
  opts: DistractorOpts,
): Promise<string[]> {
  const model = opts.model ?? "anthropic/claude-haiku-4.5";
  // A tight prompt that the model can answer in JSON. Distractor count
  // is fixed at 3; same length-class as the correct answer to keep the
  // question fair.
  const userPrompt = [
    `Topic: ${opts.subject || card.deckName || "general knowledge"}.`,
    `Question: ${card.front}`,
    `Correct answer: ${card.back}`,
    `Generate exactly 3 plausible WRONG answers — same general length and style as the correct answer, distinct from each other, and clearly not equivalent to the correct answer.`,
    `Return ONLY a JSON array of 3 strings. No prose, no markdown fences. Example: ["wrong1","wrong2","wrong3"]`,
  ].join("\n");

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "HTTP-Referer": "https://ruby-high.local",
      "X-Title": "Ruby High Anki Import",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You generate plausible distractors for multiple-choice questions. Always respond with ONLY a JSON array of 3 strings." },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.6,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${detail || r.statusText}`);
  }
  const body = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  // Strip code fences if the model added any despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 3 || !parsed.every((d) => typeof d === "string")) {
    throw new Error(`Distractor response not a 3-string array: ${cleaned.slice(0, 200)}`);
  }
  return parsed.slice(0, 3);
}

function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
