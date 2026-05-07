/**
 * Anki front/back → multiple-choice question. Called only by the explicit
 * "MC" action in the viewer, not by import. It asks OpenRouter for three
 * plausible wrong answers, then assembles a BankedQuestion the rest of the
 * system already knows how to play.
 *
 * Cost shape: per-card only. Large decks stay cheap to try because this
 * module is invoked one source card at a time unless a caller explicitly
 * chooses the batch helper.
 *
 * Failure modes:
 *  - Single-card LLM error → retry once, then skip. Caller sees a
 *    skipped count for an "imported X of Y" UX.
 *  - 401 / 403 from OpenRouter → fail-fast. The key is bad or the
 *    account is rate-limited; every subsequent call will fail the same
 *    way. The first worker to hit FatalAuthError trips a kill switch
 *    the others see; the import bails instead of grinding through 50
 *    futile calls and burning the user's quota.
 *
 * The pack-store import route no longer invokes this. The viewer command
 * route calls cardToMcQuestion for the active source card and caches it.
 */

import type { BankedQuestion, Choice, Difficulty } from "../../types.js";
import { classifyQuestionStat } from "../../question-stats.js";
import type { AnkiCard } from "./parse.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface DistractorOpts {
  apiKey: string;
  /** Faculty id stamped on the resulting question. The BankedQuestion
   *  schema requires it so pickQuestion can scope to a faculty. */
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
  /** Concurrency cap on the parallel LLM calls. */
  concurrency?: number;
  /** Optional progress callback — invoked once per card with (done, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface DistractorResult {
  questions: BankedQuestion[];
  /** Cards we couldn't generate distractors for. The import UI surfaces
   *  this as "imported X of Y cards." */
  skipped: number;
}

/** Marker thrown by the distractor call when OpenRouter returns 401/403,
 *  meaning every subsequent call will fail the same way (bad/expired key,
 *  account-wide block). The worker pool catches this once and trips a
 *  fail-fast flag so we don't burn through all N calls. */
export class FatalAuthError extends Error {
  constructor(message: string) { super(message); this.name = "FatalAuthError"; }
}

/** Generate MC questions for every card in the deck, in parallel under
 *  the concurrency cap. Returns whatever succeeded; throws FatalAuthError
 *  if the API key is rejected. */
export async function generateBankFromCards(
  cards: AnkiCard[],
  opts: DistractorOpts,
): Promise<DistractorResult> {
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  const out: BankedQuestion[] = [];
  let skipped = 0;
  let done = 0;
  const queue = [...cards];
  let fatal: FatalAuthError | null = null;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (fatal) return; // another worker tripped the kill switch
      const card = queue.shift();
      if (!card) return;
      try {
        const q = await cardToMcQuestion(card, opts);
        if (q) out.push(q);
        else skipped += 1;
      } catch (err) {
        if (err instanceof FatalAuthError) {
          fatal = err;
          return;
        }
        // Per-card transient error — eat it, move on.
        skipped += 1;
      } finally {
        done += 1;
        opts.onProgress?.(done, cards.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (fatal) throw fatal;
  // Cards still in the queue when we bailed early count as skipped.
  skipped += queue.length;
  return { questions: out, skipped };
}

export async function cardToMcQuestion(
  card: AnkiCard,
  opts: DistractorOpts,
): Promise<BankedQuestion | null> {
  const max = opts.maxRetriesPerCard ?? 1;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const distractors = await callOpenRouterForDistractors(card, opts);
      // Validate: 3 unique strings, none equivalent to the correct answer.
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
        stat: classifyQuestionStat({
          prompt: card.front,
          subject: opts.subject,
          correctAnswer: card.back,
        }),
        difficulty: opts.difficulty ?? "medium",
        faculty: opts.facultyId,
      };
    } catch (err) {
      // FatalAuth isn't retryable AND isn't card-local — propagate so the
      // worker pool bails the whole import.
      if (err instanceof FatalAuthError) throw err;
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
    if (r.status === 401 || r.status === 403) {
      throw new FatalAuthError(`OpenRouter ${r.status}: ${detail || r.statusText}`);
    }
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
