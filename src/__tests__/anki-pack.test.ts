import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnkiPack } from "../content/anki/pack.js";
import type { AnkiDeck } from "../content/anki/parse.js";

// End-to-end: AnkiDeck → ContentPack via buildAnkiPack. Mocks
// OpenRouter (the only network dependency); verifies the pack shape
// the rest of the system reads.

let calls = 0;

function mockOpenRouter(distractors: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls += 1;
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(distractors) } }],
    });
    return new Response(body, { status: 200 });
  });
}

beforeEach(() => { calls = 0; });
afterEach(() => { vi.restoreAllMocks(); });

const sampleDeck: AnkiDeck = {
  name: "AP Biology — Cells",
  cards: [
    { front: "Powerhouse of the cell?", back: "Mitochondrion", deckName: "AP Biology", noteId: "n1" },
    { front: "DNA → RNA process?", back: "Transcription", deckName: "AP Biology", noteId: "n2" },
    { front: "Site of protein synthesis?", back: "Ribosome", deckName: "AP Biology", noteId: "n3" },
  ],
};

describe("buildAnkiPack — happy path", () => {
  it("produces a ContentPack with one faculty whose questions match the deck", async () => {
    mockOpenRouter(["Lysosome", "Nucleus", "Vacuole"]);
    const { pack, skipped } = await buildAnkiPack(sampleDeck, {
      apiKey: "sk-test",
      idSuffix: "test1",
    });
    expect(skipped).toBe(0);
    expect(pack.faculty).toHaveLength(1);
    const fac = pack.faculty[0]!;
    expect(fac.questions).toHaveLength(3);
    // Each question carries the canonical fields downstream consumers rely on.
    for (const q of fac.questions) {
      expect(q.id).toMatch(/^anki-/);
      expect(["A", "B", "C", "D"]).toContain(q.correct);
      expect(q.options.A).toBeTruthy();
      expect(q.options.B).toBeTruthy();
      expect(q.options.C).toBeTruthy();
      expect(q.options.D).toBeTruthy();
      expect(q.faculty).toBe(fac.id);
    }
  });

  it("derives a stable + unique pack id from the deck name + suffix", async () => {
    mockOpenRouter(["A", "B", "C"]);
    const r1 = await buildAnkiPack(sampleDeck, { apiKey: "k", idSuffix: "abc123" });
    const r2 = await buildAnkiPack(sampleDeck, { apiKey: "k", idSuffix: "def456" });
    // Same deck name, different suffixes → different pack ids → re-imports
    // don't silently overwrite each other.
    expect(r1.pack.id).not.toBe(r2.pack.id);
    expect(r1.pack.id).toContain("abc123");
    expect(r2.pack.id).toContain("def456");
  });

  it("matches faculty.id between the bank questions and the room teacherId", async () => {
    mockOpenRouter(["A", "B", "C"]);
    const { pack } = await buildAnkiPack(sampleDeck, { apiKey: "k", idSuffix: "x" });
    const facId = pack.faculty[0]!.id;
    expect(pack.rooms).toHaveLength(1);
    expect(pack.rooms[0]!.teacherId).toBe(facId);
    expect(pack.rooms[0]!.teaches).toBe(true);
    // Every question is stamped with the same faculty id.
    for (const q of pack.faculty[0]!.questions) {
      expect(q.faculty).toBe(facId);
    }
  });

  it("derives a deterministic accent color from the deck name", async () => {
    mockOpenRouter(["A", "B", "C"]);
    const a = await buildAnkiPack({ ...sampleDeck, name: "AP Biology" }, { apiKey: "k", idSuffix: "1" });
    const b = await buildAnkiPack({ ...sampleDeck, name: "AP Biology" }, { apiKey: "k", idSuffix: "2" });
    const c = await buildAnkiPack({ ...sampleDeck, name: "AP Chemistry" }, { apiKey: "k", idSuffix: "3" });
    // Same name → same accent (deterministic).
    expect(a.pack.faculty[0]!.accent).toBe(b.pack.faculty[0]!.accent);
    // Different name → different accent (almost certainly; not a guarantee
    // but vanishingly unlikely with 360 hue values).
    expect(a.pack.faculty[0]!.accent).not.toBe(c.pack.faculty[0]!.accent);
    // Hex shape sanity.
    expect(a.pack.faculty[0]!.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("respects maxCards cap (cost/quota guard)", async () => {
    mockOpenRouter(["A", "B", "C"]);
    const big: AnkiDeck = {
      name: "Big Deck",
      cards: Array.from({ length: 200 }, (_, i) => ({
        front: `Q${i}`, back: `A${i}`, deckName: "Big Deck", noteId: String(i),
      })),
    };
    await buildAnkiPack(big, { apiKey: "k", idSuffix: "x", maxCards: 10 });
    expect(calls).toBe(10);
  });
});

describe("buildAnkiPack — pack shape compatibility", () => {
  it("the produced pack satisfies the ContentPack interface — faculty + rooms have all required fields", async () => {
    mockOpenRouter(["A", "B", "C"]);
    const { pack } = await buildAnkiPack(sampleDeck, { apiKey: "k", idSuffix: "x" });
    expect(pack.id).toBeTruthy();
    expect(pack.name).toBeTruthy();
    expect(pack.description).toBeTruthy();
    expect(pack.version).toBeTruthy();
    const fac = pack.faculty[0]!;
    expect(fac.id).toBeTruthy();
    expect(fac.displayName).toBeTruthy();
    expect(fac.shortName).toBeTruthy();
    expect(fac.subjects.length).toBeGreaterThan(0);
    expect(fac.bio).toBeTruthy();
    expect(fac.accent).toMatch(/^#/);
    expect(fac.systemPrompt).toBeTruthy();
    expect(fac.defaultModel).toBeTruthy();
    const room = pack.rooms[0]!;
    expect(room.id).toBeTruthy();
    expect(room.name).toBeTruthy();
    expect(room.channelName).toBeTruthy();
    expect(room.description).toBeTruthy();
    expect(typeof room.teaches).toBe("boolean");
  });
});
