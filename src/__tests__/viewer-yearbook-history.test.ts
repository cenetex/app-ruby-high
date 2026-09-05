import { describe, expect, it } from "vitest";
import { formatClassScore, yearbookClassHistory } from "../viewer-parts/client-pure.js";

describe("saved yearbook class results", () => {
  it("orders completed results across teachers and keeps their original grades", () => {
    const records = {
      ruby: { status: "complete", facultyId: "ruby", grade: "9", date: "2026-09-01", completedAt: 10, scoreTotal: 240, scoreMax: 300, letterGrade: "B", result: { teacherObservation: "Saved feedback" } },
      science: { status: "complete", facultyId: "sally-science", grade: "10", date: "2026-09-02", completedAt: 20, scoreTotal: 90, scoreMax: 100 },
      active: { status: "active", facultyId: "roko", grade: "10", updatedAt: 30 },
    };
    const history = yearbookClassHistory(records);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.facultyId)).toEqual(["sally-science", "ruby"]);
    expect(history[1]).toMatchObject({ grade: "9", date: "2026-09-01", today: { score: 80, letterGrade: "B", result: { teacherObservation: "Saved feedback" } } });
    expect(records.ruby).not.toHaveProperty("score");
  });

  it("handles old or incomplete records and bounds saved scores", () => {
    expect(yearbookClassHistory(null)).toEqual([]);
    expect(yearbookClassHistory([])).toEqual([]);
    const history = yearbookClassHistory({
      old: { status: "complete", facultyId: "ruby", grade: 9, scoreMax: 0 },
      high: { status: "complete", facultyId: "roko", date: "2026-09-02", scoreMax: 100, scoreTotal: 150 },
      invalid: null,
      unnamed: { status: "complete" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].today.score).toBe(100);
    expect(formatClassScore(history[1].today.score)).toBe("—");
  });
});
