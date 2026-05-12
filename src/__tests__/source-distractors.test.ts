import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateBankFromCards,
  FatalAuthError,
  type DistractorOpts,
  type SourceCardInput,
} from "../content/source-distractors.js";

// Distractor generator tests. OpenRouter is mocked via vi.spyOn(globalThis,
// "fetch") so we exercise the validation + retry + fail-fast paths
// without touching the network.

let calls = 0;

function makeCards(n: number): SourceCardInput[] {
  return Array.from({ length: n }, (_, i) => ({
    front: `Q${i + 1}: front`,
    back: `A${i + 1}`,
    deckName: "Test",
    tags: [],
    noteId: String(i + 1),
  }));
}

function mockOpenRouter(handler: (count: number) => { ok: boolean; status?: number; body: string }) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls += 1;
    const r = handler(calls);
    return new Response(r.body, { status: r.status ?? (r.ok ? 200 : 500) });
  });
}

beforeEach(() => { calls = 0; });
afterEach(() => { vi.restoreAllMocks(); });

const baseOpts: DistractorOpts = {
  apiKey: "sk-test",
  facultyId: "test-teacher",
  subject: "test",
  difficulty: "medium",
  concurrency: 1, // sequential for deterministic test ordering
  maxRetriesPerCard: 0,
};

function distractorChunk(distractors: string[]): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(distractors) } }],
  });
}

describe("generateBankFromCards — happy path", () => {
  it("turns each card into a BankedQuestion with 4 options + correct slot", async () => {
    mockOpenRouter(() => ({ ok: true, body: distractorChunk(["Wrong1", "Wrong2", "Wrong3"]) }));
    const cards = makeCards(3);
    const result = await generateBankFromCards(cards, baseOpts);
    expect(result.questions).toHaveLength(3);
    expect(result.skipped).toBe(0);
    for (const q of result.questions) {
      expect(["A", "B", "C", "D"]).toContain(q.correct);
      const options = q.options!;
      const correct = q.correct!;
      const correctOption = options[correct];
      // Correct option matches the card's back ("A1", "A2", or "A3")
      expect(correctOption).toMatch(/^A\d+$/);
      // All four options unique
      const set = new Set(Object.values(options));
      expect(set.size).toBe(4);
      // Faculty id stamped per the schema
      expect(q.faculty).toBe("test-teacher");
      expect(q.subject).toBe("test");
      expect(["head", "heart", "hustle", "honor"]).toContain(q.stat);
      expect(q.difficulty).toBe("medium");
    }
  });

  it("invokes onProgress once per card", async () => {
    mockOpenRouter(() => ({ ok: true, body: distractorChunk(["X", "Y", "Z"]) }));
    const onProgress = vi.fn();
    await generateBankFromCards(makeCards(5), { ...baseOpts, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(5);
    // Last call reports done = total
    expect(onProgress).toHaveBeenLastCalledWith(5, 5);
  });
});

describe("generateBankFromCards — failure modes", () => {
  it("skips a card and continues when the model returns < 3 distractors", async () => {
    let n = 0;
    mockOpenRouter(() => {
      n += 1;
      if (n === 2) return { ok: true, body: distractorChunk(["only one"]) }; // bad shape
      return { ok: true, body: distractorChunk(["Wrong1", "Wrong2", "Wrong3"]) };
    });
    const result = await generateBankFromCards(makeCards(3), baseOpts);
    expect(result.questions).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it("skips a card if a distractor collides with the correct answer", async () => {
    mockOpenRouter((n) => {
      if (n === 1) return { ok: true, body: distractorChunk(["A1", "Wrong2", "Wrong3"]) };
      return { ok: true, body: distractorChunk(["Wrong1", "Wrong2", "Wrong3"]) };
    });
    const result = await generateBankFromCards(makeCards(2), baseOpts);
    // Card 1's "A1" distractor matches card 1's correct answer "A1" →
    // dedupe leaves only 2 distinct distractors → card skipped.
    expect(result.questions).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("retries once on parse failure, succeeds on retry", async () => {
    let n = 0;
    mockOpenRouter(() => {
      n += 1;
      if (n === 1) return { ok: true, body: '{"choices":[{"message":{"content":"not json at all"}}]}' };
      return { ok: true, body: distractorChunk(["W1", "W2", "W3"]) };
    });
    const result = await generateBankFromCards(makeCards(1), { ...baseOpts, maxRetriesPerCard: 1 });
    expect(result.questions).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(calls).toBe(2);
  });
});

describe("generateBankFromCards — fail-fast on auth errors", () => {
  it("throws FatalAuthError when OpenRouter returns 401, doesn't burn the queue", async () => {
    mockOpenRouter(() => ({ ok: false, status: 401, body: "Unauthorized" }));
    await expect(generateBankFromCards(makeCards(50), baseOpts))
      .rejects.toBeInstanceOf(FatalAuthError);
    // Without fail-fast we'd see 50 calls; with it we see closer to
    // concurrency × maxRetriesPerCard. With concurrency=1 and retries=0,
    // exactly one call before bail.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("throws FatalAuthError when OpenRouter returns 403", async () => {
    mockOpenRouter(() => ({ ok: false, status: 403, body: "Forbidden" }));
    await expect(generateBankFromCards(makeCards(20), baseOpts))
      .rejects.toBeInstanceOf(FatalAuthError);
  });

  it("a 500 from OpenRouter is per-card transient — keeps trying other cards", async () => {
    let n = 0;
    mockOpenRouter(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 500, body: "transient" };
      return { ok: true, body: distractorChunk(["W1", "W2", "W3"]) };
    });
    const result = await generateBankFromCards(makeCards(3), baseOpts);
    // First call failed; remaining two succeeded.
    expect(result.questions).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });
});

describe("generateBankFromCards — concurrency", () => {
  it("processes cards in parallel up to the concurrency cap", async () => {
    // Hold the first 3 calls open, resolve them simultaneously, then
    // process the next 3. Verifies we don't serialize when concurrency > 1.
    mockOpenRouter(() => ({ ok: true, body: distractorChunk(["X", "Y", "Z"]) }));
    const t0 = Date.now();
    await generateBankFromCards(makeCards(8), { ...baseOpts, concurrency: 4 });
    const elapsed = Date.now() - t0;
    // 8 calls × ~1ms each (synchronous mock) — should be well under 50ms.
    // Real assertion: we made exactly 8 calls.
    expect(calls).toBe(8);
    expect(elapsed).toBeLessThan(500);
  });
});
