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
    repeatedAnswers: 0,
    repeatedAnswerSessions: 0,
    sourceCardIds: new Set(),
    sourceSubjects: new Map(),
    weakSubjects: new Map(),
    recentConcepts: new Map(),
    researchCorpus: null,
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
      weakSubjects: ["agent reliability"],
      recentConcepts: ["AI application design", "networked systems"],
      repetitionPressure: 0.5,
      sourceCardIds: [],
      researchCorpus: {
        id: "ruby-research-corpus",
        facultyId: "ruby",
        title: "Ruby Research Corpus",
        corpusPath: "assets/corpora/ruby.md",
        researchInterests: ["AI application design", "agent reliability"],
        lanes: ["Freshman bridge questions: practical AI/web vocabulary, but asked through small classroom scenarios."],
        readingList: ["Agent operations notes: least privilege and idempotency."],
        canonicalMisconceptions: ["Chat history is the same thing as durable memory."],
        sourcePackets: [{
          id: "ruby-source-agent-ops",
          title: "Agent operations notes",
          anchor: "least privilege and idempotency",
          summary: "Agent operations need bounded side effects and durable review evidence.",
          grades: ["9", "10"],
          subjects: ["agent reliability"],
          questionSeeds: ["Ask why idempotency matters before retrying a side effect."],
        }],
        gradeBriefs: {
          "9": "Keep Ruby's freshman set concrete.",
          "10": "Move sophomores into operations.",
          "11": "Ask juniors to reason architecturally.",
          "12": "Make senior questions adversarial and ethical.",
        },
      },
    })).toMatchObject({
      mode: "manual-curation",
      targetMinGrade: "9",
      targetDifficulty: "easy",
      targetNewQuestions: 8,
      corpusTitle: "Ruby Research Corpus",
      researchInterests: ["AI application design", "agent reliability"],
      readingList: ["Agent operations notes: least privilege and idempotency."],
      canonicalMisconceptions: ["Chat history is the same thing as durable memory."],
      sourcePackets: [expect.objectContaining({
        id: "ruby-source-agent-ops",
        title: "Agent operations notes",
      })],
      gradeBrief: "Keep Ruby's freshman set concrete.",
      researchDirective: expect.stringContaining("Keep grade 9 tight"),
      weakSubjects: ["agent reliability"],
      recentConcepts: ["AI application design", "networked systems"],
      repetitionPressure: 0.5,
      promptSeed: expect.stringContaining("Do not repeat recent concepts: AI application design, networked systems."),
    });

    expect(buildCurriculumReplenishmentPlan({
      grade: "12",
      facultyId: "professor-edward",
      displayName: "Professor Edward",
      lowPoolSessions: 1,
      exhaustedSessions: 2,
      sourceCardCount: 2,
      focusSubjects: ["postwar literature", "AI criticism"],
      weakSubjects: [],
      recentConcepts: [],
      sourceCardIds: ["edward-card-1", "edward-card-2"],
    })).toMatchObject({
      mode: "generate",
      targetMinGrade: "12",
      targetDifficulty: "hard",
      targetNewQuestions: 24,
      sourceCardCount: 2,
      focusSubjects: ["postwar literature", "AI criticism"],
      sourceCardIds: ["edward-card-1", "edward-card-2"],
      corpusId: null,
      researchDirective: expect.stringContaining("source cards as a temporary corpus"),
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
        repeatedAnswers: 2,
        repeatedAnswerSessions: 1,
        sourceCardIds: new Set(["ed-2", "ed-1"]),
        researchCorpus: {
          id: "edward-research-corpus",
          facultyId: "edward",
          title: "Edward Research Corpus",
          corpusPath: "assets/corpora/edward.md",
          researchInterests: ["close reading", "rhetoric"],
          lanes: ["Close-reading questions: narrator versus author, point of view, imagery, irony, setting, and textual evidence."],
          readingList: ["Close-reading notebook: narrator/author distinctions."],
          canonicalMisconceptions: ["Theme is a one-word label instead of an argument."],
          sourcePackets: [{
            id: "edward-source-theory-method",
            title: "Theory-method notebook",
            anchor: "archive and close-reading method",
            summary: "Theory becomes useful when it is a method for asking better questions.",
            grades: ["12"],
            subjects: ["rhetoric", "close reading"],
            questionSeeds: ["Ask how archive theory changes the evidence a reader trusts."],
          }],
          gradeBriefs: {
            "9": "Keep Edward's freshman set recognizable.",
            "10": "Ask sophomores to apply terms.",
            "11": "Make junior questions methodological.",
            "12": "Use senior questions for history and argument.",
          },
        },
        sourceSubjects: new Map([
          ["literature", 1],
          ["rhetoric", 3],
          ["AI criticism", 3],
        ]),
        weakSubjects: new Map([
          ["rhetoric", 2],
          ["literature", 3],
        ]),
        recentConcepts: new Map([
          ["rhetoric", 2],
          ["close reading", 1],
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
      weakSubjects: ["literature", "rhetoric"],
      recentConcepts: ["rhetoric", "close reading"],
      repetitionPressure: 0.5,
      sourceCardIds: ["ed-2", "ed-1"],
      corpusTitle: "Edward Research Corpus",
      researchLanes: [
        "Close-reading questions: narrator versus author, point of view, imagery, irony, setting, and textual evidence.",
      ],
      readingList: ["Close-reading notebook: narrator/author distinctions."],
      canonicalMisconceptions: ["Theme is a one-word label instead of an argument."],
      sourcePackets: [expect.objectContaining({
        id: "edward-source-theory-method",
      })],
      gradeBrief: "Use senior questions for history and argument.",
    });
    expect(snapshot.lowPools).toHaveLength(8);
    expect(snapshot.lowPools[0]?.facultyId).toBe("ruby");
    expect(snapshot.lowPools.map((entry) => entry.facultyId)).not.toContain("sally");
  });
});
