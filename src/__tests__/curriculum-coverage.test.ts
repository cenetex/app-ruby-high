import { describe, expect, it } from "vitest";
import {
  buildCurriculumCoverageSnapshot,
  buildCurriculumReplenishmentPlan,
  generationDifficultyForCurriculumGrade,
  type MutableCurriculumCoverageRow,
} from "../services/ruby-high/curriculum-coverage.js";

function row(input: Partial<MutableCurriculumCoverageRow> & {
  grade: MutableCurriculumCoverageRow["grade"];
  facultyId: string;
}): MutableCurriculumCoverageRow {
  return {
    displayName: input.facultyId,
    sessions: 1,
    totalEligibleMin: 10,
    totalEligibleMax: 10,
    seenSum: 0,
    remainingSum: 10,
    lowPoolSessions: 0,
    exhaustedSessions: 0,
    sourceCardIds: new Set(),
    sourceSubjects: new Map(),
    ...input,
  };
}

describe("curriculum coverage planning", () => {
  it("keeps grade difficulty policy explicit", () => {
    expect(generationDifficultyForCurriculumGrade("9")).toBe("easy");
    expect(generationDifficultyForCurriculumGrade("10")).toBe("easy");
    expect(generationDifficultyForCurriculumGrade("11")).toBe("medium");
    expect(generationDifficultyForCurriculumGrade("12")).toBe("hard");
  });

  it("uses manual curation for freshman pools and generation for later grades", () => {
    expect(buildCurriculumReplenishmentPlan({
      grade: "9",
      facultyId: "ruby",
      displayName: "Ruby",
      lowPoolSessions: 2,
      exhaustedSessions: 0,
      sourceCardCount: 0,
      focusSubjects: [],
      sourceCardIds: [],
    })).toMatchObject({
      mode: "manual-curation",
      targetMinGrade: "9",
      targetDifficulty: "easy",
      targetNewQuestions: 8,
      promptSeed: expect.stringContaining("Freshman starter questions"),
    });

    expect(buildCurriculumReplenishmentPlan({
      grade: "12",
      facultyId: "professor-edward",
      displayName: "Professor Edward",
      lowPoolSessions: 1,
      exhaustedSessions: 2,
      sourceCardCount: 2,
      focusSubjects: ["postwar literature", "AI criticism"],
      sourceCardIds: ["edward-card-1", "edward-card-2"],
    })).toMatchObject({
      mode: "generate",
      targetMinGrade: "12",
      targetDifficulty: "hard",
      targetNewQuestions: 24,
      sourceCardCount: 2,
      focusSubjects: ["postwar literature", "AI criticism"],
      sourceCardIds: ["edward-card-1", "edward-card-2"],
      promptSeed: expect.stringContaining("actively researching"),
    });
  });

  it("normalizes rows, ranks low pools by urgency, and caps review queue size", () => {
    const rows: MutableCurriculumCoverageRow[] = [
      row({
        grade: "12",
        facultyId: "edward",
        displayName: "Edward",
        sessions: 2,
        totalEligibleMin: 10,
        totalEligibleMax: 10,
        seenSum: 10,
        remainingSum: 10,
        lowPoolSessions: 1,
        sourceCardIds: new Set(["ed-2", "ed-1"]),
        sourceSubjects: new Map([
          ["literature", 1],
          ["rhetoric", 3],
          ["AI criticism", 3],
        ]),
      }),
      row({
        grade: "9",
        facultyId: "ruby",
        displayName: "Ruby",
        sessions: 2,
        totalEligibleMax: 20,
        seenSum: 36,
        remainingSum: 0,
        lowPoolSessions: 2,
        exhaustedSessions: 2,
      }),
      row({
        grade: "10",
        facultyId: "sally",
        displayName: "Sally",
        sessions: 1,
        totalEligibleMax: 5,
        remainingSum: 5,
      }),
      ...Array.from({ length: 9 }, (_, i) => row({
        grade: "11" as const,
        facultyId: `extra-${i}`,
        displayName: `Extra ${i}`,
        sessions: 1,
        totalEligibleMax: 10,
        remainingSum: 2 + i,
        lowPoolSessions: 1,
      })),
    ];

    const snapshot = buildCurriculumCoverageSnapshot(3, rows);

    expect(snapshot.activeCharacterSessions).toBe(3);
    expect(snapshot.rows.map((entry) => `${entry.grade}:${entry.displayName}`)).toEqual([
      "9:Ruby",
      "10:Sally",
      "11:Extra 0",
      "11:Extra 1",
      "11:Extra 2",
      "11:Extra 3",
      "11:Extra 4",
      "11:Extra 5",
      "11:Extra 6",
      "11:Extra 7",
      "11:Extra 8",
      "12:Edward",
    ]);
    expect(snapshot.rows.find((entry) => entry.facultyId === "ruby")).toMatchObject({
      averageSeen: 18,
      averageRemaining: 0,
      remainingShare: 0,
      replenishment: {
        mode: "manual-curation",
        targetNewQuestions: 16,
      },
    });
    expect(snapshot.rows.find((entry) => entry.facultyId === "edward")?.replenishment).toMatchObject({
      mode: "generate",
      focusSubjects: ["AI criticism", "rhetoric", "literature"],
      sourceCardIds: ["ed-2", "ed-1"],
    });
    expect(snapshot.lowPools).toHaveLength(8);
    expect(snapshot.lowPools[0]?.facultyId).toBe("ruby");
    expect(snapshot.lowPools.map((entry) => entry.facultyId)).not.toContain("sally");
  });
});
