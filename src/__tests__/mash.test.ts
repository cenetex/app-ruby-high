import { describe, expect, it } from "vitest";
import {
  AFFINITY_CEIL,
  AFFINITY_CIRCLE,
  AFFINITY_FLOOR,
  AXIS_BY_GRADE,
  MASH_AXES,
  MASH_STUDENT_IDS,
  applyTick,
  buildSuperlatives,
  computeAffinityTicks,
  emptyMashCard,
  ensureMashCard,
  pickAxisValue,
  resolveAxisForGrade,
  resolveSeniorBonusAxes,
} from "../characters/mash.js";

describe("emptyMashCard", () => {
  it("seeds one cell per classmate, all zeroed", () => {
    const card = emptyMashCard();
    expect(Object.keys(card.cells)).toEqual([...MASH_STUDENT_IDS]);
    for (const id of MASH_STUDENT_IDS) {
      const c = card.cells[id]!;
      expect(c.affinity).toBe(0);
      expect(c.scratched).toBe(false);
      expect(c.circled).toBe(false);
      expect(c.ticks).toBe(0);
    }
    expect(card.resolved).toEqual({});
  });
});

describe("ensureMashCard", () => {
  it("backfills a missing card from undefined", () => {
    const card = ensureMashCard(undefined);
    expect(Object.keys(card.cells)).toEqual([...MASH_STUDENT_IDS]);
  });
  it("recomputes scratched/circled flags from raw affinity", () => {
    const card = ensureMashCard({
      cells: { lyra: { affinity: -3, scratched: false, circled: false, ticks: 5 } },
      resolved: {},
    });
    expect(card.cells.lyra!.scratched).toBe(true);
  });
  it("keeps a valid classmate focus and drops a scratched one", () => {
    const focused = ensureMashCard({
      cells: { lyra: { affinity: 1, scratched: false, circled: false, ticks: 1 } },
      focusStudentId: "lyra",
      resolved: {},
    });
    expect(focused.focusStudentId).toBe("lyra");

    focused.cells.lyra!.affinity = -3;
    focused.cells.lyra!.scratched = true;
    expect(ensureMashCard(focused).focusStudentId).toBeUndefined();
  });
});

describe("applyTick", () => {
  it("clamps to [floor, ceil]", () => {
    const cell = { affinity: 0, scratched: false, circled: false, ticks: 0 };
    for (let i = 0; i < 10; i++) applyTick(cell, 1);
    expect(cell.affinity).toBe(AFFINITY_CEIL);
    expect(cell.circled).toBe(true);
    for (let i = 0; i < 20; i++) applyTick(cell, -1);
    expect(cell.affinity).toBe(AFFINITY_FLOOR);
    expect(cell.scratched).toBe(true);
  });
  it("circles at +2 and stays circled even if it dips later", () => {
    const cell = { affinity: 0, scratched: false, circled: false, ticks: 0 };
    applyTick(cell, 1); applyTick(cell, 1);
    expect(cell.circled).toBe(true);
    expect(cell.affinity).toBe(AFFINITY_CIRCLE);
    applyTick(cell, -1);
    expect(cell.circled).toBe(true);
    expect(cell.affinity).toBe(1);
  });
});

describe("computeAffinityTicks", () => {
  const base = { date: "2026-05-01", questionId: "q-1" };

  it("on pass without bestResponder: one applauder gets +1", () => {
    const ticks = computeAffinityTicks({
      ...base, playerScore: 8, playerPassed: true, bestResponder: null, isHeart: false,
    });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.delta).toBe(1);
    expect(ticks[0]!.reason).toBe("applauder");
    expect(MASH_STUDENT_IDS).toContain(ticks[0]!.studentId);
  });

  it("on miss without Heart: one rubber gets -1", () => {
    const ticks = computeAffinityTicks({
      ...base, playerScore: 4, playerPassed: false, bestResponder: null, isHeart: false,
    });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.delta).toBe(-1);
    expect(ticks[0]!.reason).toBe("rub");
  });

  it("Heart playbook converts the rub into a 0-delta pep-talk", () => {
    const ticks = computeAffinityTicks({
      ...base, playerScore: 4, playerPassed: false, bestResponder: null, isHeart: true,
    });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.delta).toBe(0);
    expect(ticks[0]!.reason).toBe("pep-talk");
  });

  it("bestResponder NPC is the only classmate tick", () => {
    const ticks = computeAffinityTicks({
      ...base, playerScore: 9, playerPassed: true, bestResponder: "indra", isHeart: false,
    });
    expect(ticks).toEqual([{ studentId: "indra", delta: 1, reason: "best-responder" }]);
  });

  it("ignores bestResponder='player' (player isn't a classmate)", () => {
    const ticks = computeAffinityTicks({
      ...base, playerScore: 8, playerPassed: true, bestResponder: "player", isHeart: false,
    });
    expect(ticks.some((t) => t.reason === "best-responder")).toBe(false);
    expect(ticks).toHaveLength(1);
  });

  it("is deterministic for the same questionId", () => {
    const a = computeAffinityTicks({ ...base, playerScore: 8, playerPassed: true, bestResponder: null, isHeart: false });
    const b = computeAffinityTicks({ ...base, playerScore: 8, playerPassed: true, bestResponder: null, isHeart: false });
    expect(a.map((t) => t.studentId)).toEqual(b.map((t) => t.studentId));
  });

  it("uses the player-selected focus before automatic reactions", () => {
    const pass = computeAffinityTicks({
      ...base,
      playerScore: 9,
      playerPassed: true,
      bestResponder: "indra",
      isHeart: false,
      focusStudentId: "mika",
    });
    expect(pass).toEqual([{ studentId: "mika", delta: 1, reason: "social-focus" }]);

    const miss = computeAffinityTicks({
      ...base,
      playerScore: 3,
      playerPassed: false,
      bestResponder: null,
      isHeart: false,
      focusStudentId: "mika",
    });
    expect(miss).toEqual([{ studentId: "mika", delta: -1, reason: "social-focus" }]);
  });
});

describe("resolveAxisForGrade", () => {
  it("returns null when no cell is circled", () => {
    const card = emptyMashCard();
    expect(resolveAxisForGrade(card, "9", "Pip")).toBeNull();
  });

  it("picks the highest-affinity circled, unscratched, unused cell", () => {
    const card = emptyMashCard();
    applyTick(card.cells.lyra!, 1); applyTick(card.cells.lyra!, 1);  // circled
    applyTick(card.cells.mika!, 1); applyTick(card.cells.mika!, 1); applyTick(card.cells.mika!, 1); // higher
    applyTick(card.cells.indra!, -1); applyTick(card.cells.indra!, -1); applyTick(card.cells.indra!, -1); // scratched
    const r = resolveAxisForGrade(card, "9", "Pip");
    expect(r?.studentId).toBe("mika");
    expect(r?.axis).toBe("crush");
    expect(MASH_AXES).toContain(r!.axis);
  });

  it("won't reuse a classmate already bound to another axis", () => {
    const card = emptyMashCard();
    applyTick(card.cells.sami!, 1); applyTick(card.cells.sami!, 1);
    applyTick(card.cells.lyra!, 1); applyTick(card.cells.lyra!, 1);
    // Pre-resolve crush to Sami; resolving job (grade 10) must skip Sami.
    card.resolved.crush = { axis: "crush", studentId: "sami", value: "x", grade: "9", resolvedAt: 0 };
    const r = resolveAxisForGrade(card, "10", "Pip");
    expect(r?.studentId).toBe("lyra");
    expect(r?.axis).toBe("job");
  });
});

describe("resolveSeniorBonusAxes", () => {
  it("always returns money + lucky resolutions at Senior", () => {
    const card = emptyMashCard();
    // Even with no circled cells, the bonus axes use deterministic
    // value lists and pick from any non-scratched classmate.
    const out = resolveSeniorBonusAxes(card, "Pip");
    const axes = out.map((r) => r.axis);
    expect(axes).toContain("money");
    expect(axes).toContain("lucky");
    expect(out.every((r) => r.grade === "12")).toBe(true);
  });

  it("doesn't reuse a classmate already bound elsewhere", () => {
    const card = emptyMashCard();
    card.resolved.crush = { axis: "crush", studentId: "lyra", value: "x", grade: "9", resolvedAt: 0 };
    card.resolved.job = { axis: "job", studentId: "sami", value: "x", grade: "10", resolvedAt: 0 };
    const out = resolveSeniorBonusAxes(card, "Pip");
    const usedIds = new Set([...out.map((r) => r.studentId), "lyra", "sami"]);
    // Each resolved axis must pick a unique classmate when one is available.
    expect(usedIds.size).toBe(2 + out.length);
  });
});

describe("pickAxisValue", () => {
  it("is deterministic for the same seed", () => {
    expect(pickAxisValue("job", "Pip:sami:job")).toBe(pickAxisValue("job", "Pip:sami:job"));
  });
  it("varies across seeds", () => {
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => pickAxisValue("job", s));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});

describe("buildSuperlatives", () => {
  it("emits one line per resolved axis in canonical order", () => {
    const card = emptyMashCard();
    card.resolved.crush = { axis: "crush", studentId: "mika", value: "has a crush on you", grade: "9", resolvedAt: 0 };
    card.resolved.job = { axis: "job", studentId: "sami", value: "armpit sniffer", grade: "10", resolvedAt: 0 };
    const lines = buildSuperlatives(card, (id) => id.toUpperCase());
    expect(lines).toEqual([
      "Crush — MIKA has a crush on you",
      "Most Likely To Be A Armpit Sniffer, According To SAMI",
    ]);
  });

  it("returns nothing for an empty card", () => {
    expect(buildSuperlatives(emptyMashCard(), (id) => id)).toEqual([]);
  });
});

describe("AXIS_BY_GRADE", () => {
  it("maps every grade to one axis", () => {
    for (const g of ["9", "10", "11", "12"] as const) {
      expect(MASH_AXES).toContain(AXIS_BY_GRADE[g]);
    }
  });
});
