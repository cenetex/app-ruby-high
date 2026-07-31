import { afterEach, describe, expect, it } from "vitest";
import {
  facultyForSession,
  getActivePack,
  guestPackForSession,
  packForSession,
  publicCreatorPacks,
  resetActivePack,
} from "../content/registry.js";
import {
  ELIZAOS_SYSTEMS_LAB_PACK_ID,
  getElizaOsSystemsLab,
} from "../content/packs/elizaos-systems-lab.js";

afterEach(() => {
  resetActivePack();
});

describe("ElizaOS Systems Lab", () => {
  it("ships a hand-curated 96-question, twelve-module value-based bank", async () => {
    const pack = await getElizaOsSystemsLab();
    const questions = pack.faculty[0]!.questions;
    const difficulty = questions.reduce(
      (counts, question) => {
        counts[question.difficulty] += 1;
        return counts;
      },
      { easy: 0, medium: 0, hard: 0 },
    );
    const modules = new Map<string, number>();
    const grades = new Map<string, number>();
    const stats = new Map<string, number>();
    const moduleGrades = new Map<string, Map<string, number>>();
    for (const question of questions) {
      modules.set(question.subject, (modules.get(question.subject) ?? 0) + 1);
      grades.set(question.minGrade!, (grades.get(question.minGrade!) ?? 0) + 1);
      stats.set(question.stat!, (stats.get(question.stat!) ?? 0) + 1);
      const subjectGrades = moduleGrades.get(question.subject) ?? new Map<string, number>();
      subjectGrades.set(question.minGrade!, (subjectGrades.get(question.minGrade!) ?? 0) + 1);
      moduleGrades.set(question.subject, subjectGrades);
    }

    expect(pack.id).toBe(ELIZAOS_SYSTEMS_LAB_PACK_ID);
    expect(pack.version).toBe("1.2.0");
    expect(pack.curriculum?.reviewedAt).toBe("2026-07-31");
    expect(pack.curriculum?.sources).toEqual(
      expect.arrayContaining([
        "https://docs.elizaos.ai/agents/character-interface",
        "https://docs.elizaos.ai/plugins/reference",
        "https://docs.elizaos.ai/runtime/events",
        "https://docs.elizaos.ai/runtime/models",
        "https://docs.elizaos.ai/plugins/development",
        "https://github.com/elizaOS/eliza",
      ]),
    );
    expect(questions).toHaveLength(96);
    expect(new Set(questions.map((question) => question.prompt)).size).toBe(96);
    expect(difficulty).toEqual({ easy: 30, medium: 42, hard: 24 });
    expect(Object.fromEntries(grades)).toEqual({ "9": 24, "10": 24, "11": 24, "12": 24 });
    expect(Object.fromEntries(stats)).toEqual({ head: 24, hustle: 24, honor: 24, heart: 24 });
    expect([...modules.values()]).toEqual(new Array(12).fill(8));
    for (const subjectGrades of moduleGrades.values()) {
      expect(Object.fromEntries(subjectGrades)).toEqual({ "9": 2, "10": 2, "11": 2, "12": 2 });
    }
    expect([...modules.keys()]).toEqual(
      expect.arrayContaining([
        "characters-identity",
        "events-evaluators",
        "model-routing",
        "plugin-development",
      ]),
    );

    const unrelatedProducts =
      /\b(?:ruby high|rubyhigh|moltbook|project ?89|solana|ethereum|discord|telegram|twitter|openai|anthropic)\b/i;
    for (const question of questions) {
      expect(question.decoys, `${question.id} should have a reusable distractor pool`).toHaveLength(5);
      expect(
        new Set([question.correct, ...(question.decoys ?? [])]).size,
        `${question.id} answers must be distinct`,
      ).toBe(6);
      const comparableDecoys = (question.decoys ?? []).filter((decoy) => {
        const shorter = Math.min(decoy.length, question.correct!.length);
        const longer = Math.max(decoy.length, question.correct!.length);
        return shorter / longer >= 0.7;
      });
      expect(
        comparableDecoys.length,
        `${question.id} should have similarly sized plausible answers`,
      ).toBeGreaterThanOrEqual(2);
      const decoyLengths = question.decoys!.map((decoy) => decoy.length);
      expect(question.correct!.length).toBeGreaterThanOrEqual(Math.min(...decoyLengths) - 5);
      expect(question.correct!.length).toBeLessThanOrEqual(Math.max(...decoyLengths) + 5);
      if (question.minGrade === "9") expect(question.difficulty).toBe("easy");
      if (question.minGrade === "10") expect(question.difficulty).not.toBe("hard");
      if (question.minGrade === "11") expect(question.difficulty).toBe("medium");
      if (question.minGrade === "12") expect(question.difficulty).toBe("hard");
      expect(question.prompt, `${question.id} must name ElizaOS or agents`).toMatch(
        /\b(?:elizaos|agents?)\b/i,
      );
      expect(
        [
          question.prompt,
          question.correct,
          ...(question.decoys ?? []),
          question.explanation,
        ].join(" "),
        `${question.id} must not drift into another product`,
      ).not.toMatch(unrelatedProducts);
    }

    const byId = new Map(questions.map((question) => [question.id, question]));
    expect(byId.get("elizaos-003")?.explanation).not.toContain("views");
    expect(byId.get("elizaos-021")?.prompt).not.toContain("AbortSignal");
    expect(byId.get("elizaos-077")?.prompt).toContain("Service");
    expect(byId.get("elizaos-082")?.correct).toBe("ModelType.TEXT_EMBEDDING");
    expect(byId.get("elizaos-089")?.correct).toBe("Run elizaos create my-plugin --type plugin");
  });

  it("registers Eliza as a public guest teacher with classroom art", async () => {
    await getActivePack();
    const state = {
      sessionId: "rh:test:eliza-course",
      activePackId: null,
      guestPackMode: "override" as const,
      guestPackOverrideId: ELIZAOS_SYSTEMS_LAB_PACK_ID,
    };
    const guest = guestPackForSession(state);
    const composed = packForSession(state);
    const eliza = facultyForSession(state).find((faculty) => faculty.id === "guest");

    expect(publicCreatorPacks().map((pack) => pack.id)).toContain(
      ELIZAOS_SYSTEMS_LAB_PACK_ID,
    );
    expect(guest?.name).toBe("ElizaOS Systems Lab");
    expect(eliza).toMatchObject({
      displayName: "Eliza",
      assetTeacherId: "eliza",
    });
    expect(composed.courses?.find((course) => course.id === "guest")?.title).toBe(
      "ElizaOS Systems Lab",
    );
  });
});
