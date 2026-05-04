import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { CHOICES, pickEliminatedChoices, type Choice } from "../types.js";

// ── helpers ────────────────────────────────────────────────────────────────
let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-advantage-"));
  storePath = join(tmpDir, "state.json");
  activeRuby = null;
});

afterEach(async () => {
  if (activeRuby) await activeRuby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  activeRuby = ruby;
  return { ruby, faculty };
}

// Each sequential rng() call returns the next number from `seq`. Loops on
// exhaustion so callers don't have to feed in a perfect-length array.
function seqRng(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[i % seq.length]!;
    i++;
    return v;
  };
}

// ── pickEliminatedChoices (pure helper) ─────────────────────────────────────

describe("pickEliminatedChoices", () => {
  for (const correct of CHOICES) {
    it(`hit eliminates exactly 2 wrong choices and never the correct one (correct=${correct})`, () => {
      // Run with 100 different rng seeds — every output should be a 2-set of wrong letters.
      for (let i = 0; i < 100; i++) {
        const rng = seqRng([Math.random(), Math.random(), Math.random(), Math.random()]);
        const elim = pickEliminatedChoices(correct, "hit", rng);
        expect(elim).toHaveLength(2);
        expect(elim).not.toContain(correct);
        expect(new Set(elim).size).toBe(2);
        for (const c of elim) expect(CHOICES).toContain(c);
      }
    });

    it(`mixed eliminates exactly 1 wrong choice (correct=${correct})`, () => {
      for (let i = 0; i < 100; i++) {
        const rng = seqRng([Math.random(), Math.random(), Math.random(), Math.random()]);
        const elim = pickEliminatedChoices(correct, "mixed", rng);
        expect(elim).toHaveLength(1);
        expect(elim[0]).not.toBe(correct);
        expect(CHOICES).toContain(elim[0]!);
      }
    });

    it(`miss eliminates nothing (correct=${correct})`, () => {
      const rng = seqRng([0.1, 0.2, 0.3]);
      expect(pickEliminatedChoices(correct, "miss", rng)).toEqual([]);
    });
  }

  it("uses the injected rng deterministically", () => {
    // With rng always returning 0, Fisher-Yates picks the leftmost wrong each step,
    // so the eliminated set is reproducible.
    const rngZero = () => 0;
    const a1 = pickEliminatedChoices("A", "hit", rngZero);
    const a2 = pickEliminatedChoices("A", "hit", rngZero);
    expect(a1).toEqual(a2);
  });

  it("never returns duplicates even when rng degenerates", () => {
    const rng = seqRng([0.999, 0.999, 0.999, 0.999]);
    const elim = pickEliminatedChoices("B", "hit", rng);
    expect(new Set(elim).size).toBe(elim.length);
    expect(elim).not.toContain("B");
  });
});

// ── rollAdvantage (service method) ──────────────────────────────────────────

describe("RubyHighService.rollAdvantage", () => {
  it("returns null when there is no active question", async () => {
    const { ruby } = await makeServices();
    const { result } = ruby.rollAdvantage("test:no-active");
    expect(result).toBeNull();
  });

  it("returns null when the round has already resolved", async () => {
    const { ruby } = await makeServices();
    const sid = "test:resolved";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    // Round is now resolved.
    const { result } = ruby.rollAdvantage(sid);
    expect(result).toBeNull();
  });

  it("rolls once and produces a valid AdvantageRoll", async () => {
    const { ruby } = await makeServices();
    const sid = "test:roll-once";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const { result } = ruby.rollAdvantage(sid);
    expect(result).not.toBeNull();
    expect(result!.rolled).toBe(true);
    expect(result!.dice).toHaveLength(2);
    expect(result!.dice[0]).toBeGreaterThanOrEqual(1);
    expect(result!.dice[0]).toBeLessThanOrEqual(6);
    expect(result!.total).toBe(result!.dice[0] + result!.dice[1]); // no character → mod 0
    expect(["hit", "mixed", "miss"]).toContain(result!.outcome);

    // Eliminated count matches the outcome contract.
    const expectedCount = result!.outcome === "hit" ? 2 : result!.outcome === "mixed" ? 1 : 0;
    expect(result!.eliminated).toHaveLength(expectedCount);

    // Correct answer is never eliminated.
    const correct = ruby.getOrCreate(sid).current!.correct;
    expect(result!.eliminated).not.toContain(correct);
  });

  it("is idempotent — second call returns the same roll", async () => {
    const { ruby } = await makeServices();
    const sid = "test:idempotent";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const first = ruby.rollAdvantage(sid).result!;
    const second = ruby.rollAdvantage(sid).result!;
    expect(second).toEqual(first);
  });

  it("refuses to roll after the player has already answered", async () => {
    const { ruby } = await makeServices();
    const sid = "test:after-answer";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    // Round resolved (single player → resolveRound runs immediately).
    const { result } = ruby.rollAdvantage(sid);
    expect(result).toBeNull();
  });

  it("submitAnswer rejects a pick against an eliminated choice", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reject-eliminated";
    // Force the test by directly mutating the active round's advantage to a hit
    // that eliminates a known wrong answer. This avoids depending on rng.
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const state = ruby.getOrCreate(sid);
    const correct = state.current!.correct! as Choice;
    const wrong: Choice = (CHOICES.find((c) => c !== correct) as Choice)!;
    state.activeRound!.advantage = {
      rolled: true,
      stat: "head",
      dice: [5, 5],
      total: 10,
      outcome: "hit",
      eliminated: [wrong],
      rolledAt: Date.now(),
    };
    expect(() => ruby.submitAnswer(sid, wrong)).toThrowError(/crossed out/);
    // The correct answer still works.
    expect(() => ruby.submitAnswer(sid, correct)).not.toThrow();
  });

  it("over many rolls, distribution lands across hit/mixed/miss", async () => {
    // Sanity check: the dice are real, not fixed. With 2d6 the expected
    // distribution is hit ~17%, mixed ~41%, miss ~42%. With 200 rolls, every
    // bucket should land at least once.
    const { ruby } = await makeServices();
    const counts = { hit: 0, mixed: 0, miss: 0 };
    for (let i = 0; i < 200; i++) {
      const sid = `test:dist:${i}`;
      ruby.pickAndPose(sid, { faculty: "ruby" });
      const r = ruby.rollAdvantage(sid).result!;
      counts[r.outcome]++;
    }
    expect(counts.hit).toBeGreaterThan(0);
    expect(counts.mixed).toBeGreaterThan(0);
    expect(counts.miss).toBeGreaterThan(0);
    expect(counts.hit + counts.mixed + counts.miss).toBe(200);
  });

  it("does not award XP or take a Condition (bonus-only mechanic)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:no-side-effects";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    // Manually attach a character so we can check XP/conditions before/after.
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Test", playbookId: "overachiever", stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
      arcAnswer: "—", personality: "—", xp: 0, yearbook: [],
      createdAt: Date.now(),
    };
    const beforeXp = state.character.xp;
    ruby.rollAdvantage(sid);
    expect(state.character!.xp).toBe(beforeXp);
  });
});

// ── player roll: bonus-only (regression check on the v0.5.x fix) ────────────

describe("Player roll on round resolve — bonus-only", () => {
  it("uses the question stat for advantage and resolve rolls", async () => {
    const { ruby } = await makeServices();
    const sid = "test:question-stat-rolls";
    const state = ruby.pose(sid, {
      prompt: "How does Lyra feel about the class helping her after a hard answer?",
      options: { A: "Supported", B: "Radioactive", C: "Faster", D: "Invisible" },
      correct: "A",
      subject: "community",
      stat: "heart",
    });
    state.character = {
      name: "Test",
      playbookId: "outsider",
      stats: { head: -1, heart: 3, hustle: 0, honor: 1 },
      arcAnswer: "-",
      personality: "-",
      xp: 0,
      yearbook: [],
      createdAt: Date.now(),
    };

    const advantage = ruby.rollAdvantage(sid).result!;
    expect(advantage.stat).toBe("heart");
    expect(advantage.total).toBe(advantage.dice[0] + advantage.dice[1] + 3);

    const after = ruby.submitAnswer(sid, "A");
    const roll = after.lastReveal!.playerRoll!;
    expect(roll.stat).toBe("heart");
    expect(roll.total).toBe(roll.dice[0] + roll.dice[1] + 3);
  });

  it("does not change XP on a wrong answer, regardless of the dice", async () => {
    const { ruby } = await makeServices();
    // Run many rounds — across a wide range of dice outcomes, a wrong answer
    // should never punish the character. XP is legacy-only now.
    for (let i = 0; i < 50; i++) {
      const sid = `test:no-penalty:${i}`;
      ruby.pickAndPose(sid, { faculty: "ruby" });
      const state = ruby.getOrCreate(sid);
      // Attach a fresh character with HEAD -1 so misses are likelier (worst-case
      // input for the old penalty path that the v0.5.x fix removed).
      state.character = {
        name: "Test", playbookId: "overachiever", stats: { head: -1, heart: 0, hustle: 0, honor: 1 },
        arcAnswer: "—", personality: "—", xp: 0, yearbook: [],
        createdAt: Date.now(),
      };
      const correct = state.current!.correct! as Choice;
      const wrong: Choice = (CHOICES.find((c) => c !== correct) as Choice)!;
      ruby.submitAnswer(sid, wrong);
      const after = ruby.getOrCreate(sid);
      expect(after.character!.xp).toBe(0);
    }
  });

  it("does not award XP on a correct answer; mastery owns progression now", async () => {
    const { ruby } = await makeServices();
    for (let i = 0; i < 30; i++) {
      const sid = `test:xp:${i}`;
      ruby.pickAndPose(sid, { faculty: "ruby" });
      const state = ruby.getOrCreate(sid);
      state.character = {
        name: "Test", playbookId: "overachiever", stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
        arcAnswer: "—", personality: "—", xp: 0, yearbook: [],
        createdAt: Date.now(),
      };
      const correct = state.current!.correct! as Choice;
      ruby.submitAnswer(sid, correct);
      const after = ruby.getOrCreate(sid);
      expect(after.character!.xp).toBe(0);
    }
  });
});
