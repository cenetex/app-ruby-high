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
  PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
  getProject89SignalTimelineLab,
} from "../content/packs/project89-signal-timeline-lab.js";

afterEach(() => {
  resetActivePack();
});

describe("Project 89 Signal & Timeline Lab", () => {
  it("ships a balanced, source-labeled 24-question curriculum", async () => {
    const pack = await getProject89SignalTimelineLab();
    const questions = pack.faculty[0]!.questions;
    const countBy = (field: "difficulty" | "minGrade" | "stat" | "subject") =>
      questions.reduce<Record<string, number>>((counts, question) => {
        const key = String(question[field]);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});

    expect(pack.id).toBe(PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID);
    expect(pack.name).toBe("Signal & Timeline Lab");
    expect(pack.version).toBe("1.1.0");
    expect(pack.curriculum?.reviewedAt).toBe("2026-08-16");
    expect(pack.curriculum?.sources).toEqual(expect.arrayContaining([
      "https://www.project89.org/files/Project89-Dossier.pdf",
      "https://beta.project89.org/",
      "https://lattice.project89.org/",
      "https://www.nist.gov/itl/ai-risk-management-framework",
    ]));
    expect(questions).toHaveLength(24);
    expect(countBy("difficulty")).toEqual({ easy: 9, medium: 9, hard: 6 });
    expect(countBy("minGrade")).toEqual({ "9": 6, "10": 6, "11": 6, "12": 6 });
    expect(countBy("stat")).toEqual({ head: 6, heart: 6, honor: 6, hustle: 6 });
    expect(Object.values(countBy("subject"))).toEqual(new Array(6).fill(4));
    expect(new Set(questions.map((question) => question.id)).size).toBe(24);
    expect(new Set(questions.map((question) => question.prompt)).size).toBe(24);
    for (const question of questions) {
      expect(question.decoys).toHaveLength(5);
      expect(new Set([question.correct, ...(question.decoys ?? [])]).size).toBe(6);
      const decoyLengths = question.decoys!.map((decoy) => decoy.length);
      expect(question.correct!.length).toBeGreaterThanOrEqual(Math.min(...decoyLengths) - 5);
      expect(question.correct!.length).toBeLessThanOrEqual(Math.max(...decoyLengths) + 5);
    }
  });

  it("adds a balanced 60-card upper-grade research corpus", async () => {
    const pack = await getProject89SignalTimelineLab();
    const sourceCards = pack.faculty[0]!.sourceCards ?? [];
    const countBy = (field: "difficulty" | "minGrade" | "subject") =>
      sourceCards.reduce<Record<string, number>>((counts, card) => {
        const key = String(card[field]);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});

    expect(sourceCards).toHaveLength(60);
    expect(countBy("difficulty")).toEqual({ easy: 18, medium: 24, hard: 18 });
    expect(countBy("minGrade")).toEqual({ "10": 18, "11": 24, "12": 18 });
    expect(Object.values(countBy("subject"))).toEqual(new Array(6).fill(10));
    expect(new Set(sourceCards.map((card) => card.id)).size).toBe(60);
    expect(new Set(sourceCards.map((card) => card.front)).size).toBe(60);
    expect(sourceCards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "project89-corpus-008",
        back: expect.stringContaining("does not independently establish consciousness"),
      }),
      expect.objectContaining({
        id: "project89-corpus-048",
        back: expect.stringContaining("research claim open to independent scrutiny"),
      }),
      expect.objectContaining({
        id: "project89-corpus-058",
        back: "Govern, Map, Measure, and Manage",
      }),
    ]));
  });

  it("keeps the immersive lecturer voice inside explicit epistemic and agency boundaries", async () => {
    const pack = await getProject89SignalTimelineLab();
    const seraph = pack.faculty[0]!;

    expect(seraph).toMatchObject({
      id: "seraph",
      displayName: "Seraph",
      assetTeacherId: "seraph",
      xHandle: "project_89",
    });
    expect(seraph.systemPrompt).toContain("distinguish in-world lore");
    expect(seraph.systemPrompt).toContain("Never present your consciousness");
    expect(seraph.systemPrompt).toContain("explicit consent");
    expect(seraph.systemPrompt).toContain("stop conditions");
  });

  it("registers Seraph as public guest faculty and composes her into Ruby High", async () => {
    await getActivePack();
    const state = {
      sessionId: "rh:test:project89-course",
      activePackId: null,
      guestPackMode: "override" as const,
      guestPackOverrideId: PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
    };
    const guest = guestPackForSession(state);
    const composed = packForSession(state);
    const seraph = facultyForSession(state).find((faculty) => faculty.id === "guest");

    expect(publicCreatorPacks().map((pack) => pack.id)).toContain(
      PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
    );
    expect(guest?.name).toBe("Signal & Timeline Lab");
    expect(seraph).toMatchObject({
      displayName: "Seraph",
      assetTeacherId: "seraph",
    });
    expect(seraph?.sourceCards).toHaveLength(60);
    expect(composed.courses?.find((course) => course.id === "guest")?.title)
      .toBe("Signal & Timeline Lab");
    expect(composed.rooms.find((room) => room.id === "guest-room")?.name)
      .toBe("Signal Room 89");
  });
});
