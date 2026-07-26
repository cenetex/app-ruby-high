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
  it("ships a hand-curated 64-question, eight-module bank with the planned mix", async () => {
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
    expect(pack.curriculum?.reviewedAt).toBe("2026-07-25");
    expect(pack.curriculum?.sources).toEqual(
      expect.arrayContaining([
        "https://docs.elizaos.ai/",
        "https://github.com/elizaOS/eliza",
      ]),
    );
    expect(questions).toHaveLength(64);
    expect(difficulty).toEqual({ easy: 20, medium: 28, hard: 16 });
    expect([...modules.values()]).toEqual(new Array(8).fill(8));

    const unrelatedProducts =
      /\b(?:ruby high|rubyhigh|moltbook|project ?89|solana|ethereum|discord|telegram|twitter|openai|anthropic)\b/i;
    for (const question of questions) {
      expect(question.prompt, `${question.id} must name ElizaOS or agents`).toMatch(
        /\b(?:elizaos|agents?)\b/i,
      );
      expect(
        [
          question.prompt,
          ...Object.values(question.options ?? {}),
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
