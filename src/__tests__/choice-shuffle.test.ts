import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack } from "../content/registry.js";

// Answer position must never be a learnable tell: every time a question is
// posed the A/B/C/D order is reshuffled, and grading (which reads
// state.current.correct) must stay consistent with that fresh order. The rest
// of the suite runs with RUBY_HIGH_SHUFFLE_CHOICES="0" for determinism; this
// file opts the behavior back on and verifies it.

const QUESTION = {
  prompt: "Which Greek letter is first?",
  options: { A: "alpha", B: "beta", C: "gamma", D: "delta" } as Record<"A" | "B" | "C" | "D", string>,
  correct: "A" as const,
  faculty: "ruby",
};
const CORRECT_TEXT = QUESTION.options[QUESTION.correct];
const ALL_TEXTS = ["alpha", "beta", "gamma", "delta"].sort();

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
    for (let i = 0; i < 60; i++) {
      const state = ruby.pose(`shuffle:${i}`, QUESTION);
      const current = state.current!;
      // The correct slot may move, but it always points at the original answer.
      expect(current.options![current.correct!]).toBe(CORRECT_TEXT);
      // No option is lost or duplicated by the shuffle.
      expect(Object.values(current.options!).sort()).toEqual(ALL_TEXTS);
      slots.add(current.correct!);
    }
    // Over 60 poses the correct answer must land in more than one position
    // (P(all identical) = 4 * (1/4)^60, i.e. effectively zero).
    expect(slots.size).toBeGreaterThan(1);
  });

  it("preserves stored order when shuffling is disabled", () => {
    process.env.RUBY_HIGH_SHUFFLE_CHOICES = "0";
    const state = ruby.pose("no-shuffle", QUESTION);
    const current = state.current!;
    expect(current.correct).toBe("A");
    expect(current.options).toEqual(QUESTION.options);
  });
});
