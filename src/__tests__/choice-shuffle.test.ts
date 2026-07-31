import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack } from "../content/registry.js";

// Answer position must never be a learnable tell: every time a question is
// posed the A/B/C/D order is rebuilt, and grading (which reads
// state.current.correctChoice) must stay consistent with that fresh order. The rest
// of the suite runs with RUBY_HIGH_SHUFFLE_CHOICES="0" for determinism; this
// file opts the behavior back on and verifies it.

const QUESTION = {
  prompt: "Which Greek letter is first?",
  correct: "alpha",
  decoys: ["beta", "gamma", "delta", "epsilon", "zeta"],
  faculty: "ruby",
};
const ALL_TEXTS = [QUESTION.correct, ...QUESTION.decoys];

describe("answer choice shuffling", () => {
  let dir: string;
  let ruby: RubyHighService;
  let prevFlag: string | undefined;

  beforeEach(async () => {
    prevFlag = process.env.RUBY_HIGH_SHUFFLE_CHOICES;
    await getActivePack();
    dir = await mkdtemp(join(tmpdir(), "rh-shuffle-"));
    ruby = new RubyHighService({} as never, new StateStore(join(dir, "state.json")));
  });

  afterEach(async () => {
    if (prevFlag === undefined) delete process.env.RUBY_HIGH_SHUFFLE_CHOICES;
    else process.env.RUBY_HIGH_SHUFFLE_CHOICES = prevFlag;
    await ruby.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  it("varies the correct slot across poses while preserving the correct answer's text", () => {
    process.env.RUBY_HIGH_SHUFFLE_CHOICES = "1";
    const slots = new Set<string>();
    const seenDecoys = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const state = ruby.pose(`shuffle:${i}`, QUESTION);
      const current = state.current!;
      // The correct slot may move, but it always points at the original answer.
      expect(current.options![current.correctChoice!]).toBe(QUESTION.correct);
      // Every board has four unique answers drawn from the authored pool.
      expect(new Set(Object.values(current.options!)).size).toBe(4);
      expect(Object.values(current.options!).every((answer) => ALL_TEXTS.includes(answer))).toBe(true);
      Object.values(current.options!)
        .filter((answer) => answer !== QUESTION.correct)
        .forEach((answer) => seenDecoys.add(answer));
      slots.add(current.correctChoice!);
      ruby.submitAnswer(`shuffle:${i}`, current.correctChoice!);
      expect(state.lastReveal?.wasCorrect).toBe(true);
    }
    // Over 60 poses the correct answer must land in more than one position
    // (P(all identical) = 4 * (1/4)^60, i.e. effectively zero).
    expect(slots.size).toBeGreaterThan(1);
    expect(seenDecoys.size).toBeGreaterThan(3);
  });

  it("preserves stored order when shuffling is disabled", () => {
    process.env.RUBY_HIGH_SHUFFLE_CHOICES = "0";
    const state = ruby.pose("no-shuffle", QUESTION);
    const current = state.current!;
    expect(current.correct).toBe("alpha");
    expect(current.correctChoice).toBe("A");
    expect(current.options).toEqual({
      A: "alpha",
      B: "beta",
      C: "gamma",
      D: "delta",
    });
  });
});
