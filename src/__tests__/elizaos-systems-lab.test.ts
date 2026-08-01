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
    for (const question of questions) {
      modules.set(question.subject, (modules.get(question.subject) ?? 0) + 1);
    }

    expect(pack.id).toBe(ELIZAOS_SYSTEMS_LAB_PACK_ID);
    expect(pack.version).toBe("1.1.0");
    expect(pack.curriculum?.reviewedAt).toBe("2026-07-25");
    expect(pack.curriculum?.sources).toEqual(
      expect.arrayContaining([
        "https://docs.elizaos.ai/agents/character-interface",
        "https://docs.elizaos.ai/runtime/events",
        "https://docs.elizaos.ai/runtime/models",
        "https://docs.elizaos.ai/plugins/development",
        "https://github.com/elizaOS/eliza",
      ]),
    );
    expect(questions).toHaveLength(96);
    expect(new Set(questions.map((question) => question.prompt)).size).toBe(96);
    expect(difficulty).toEqual({ easy: 30, medium: 42, hard: 24 });
    expect([...modules.values()]).toEqual(new Array(12).fill(8));
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
