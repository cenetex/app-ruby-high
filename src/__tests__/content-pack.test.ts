import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FacultyService } from "../services/faculty-service.js";
import { getActivePack, resetActivePack, setActivePack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

// The pack abstraction's contract: swapping the active pack swaps the
// faculty list, the question banks, and the room layout — the rest of
// the system reads from the pack instead of hardcoded constants. These
// tests are the harness future packs (Anki imports, paid SAT pack,
// LLM-generated packs) plug into.

afterEach(() => {
  resetActivePack();
});

describe("ContentPack registry", () => {
  it("defaults to Ruby High Original — three faculty + matching rooms", async () => {
    const pack = await getActivePack();
    expect(pack.id).toBe("ruby-high-original");
    expect(pack.faculty.map((f) => f.id).sort()).toEqual(
      ["professor-edward", "ruby", "sally-science"],
    );
    // Each teaching faculty has a corresponding room.
    for (const f of pack.faculty) {
      const room = pack.rooms.find((r) => r.teacherId === f.id);
      expect(room, `room missing for faculty ${f.id}`).toBeTruthy();
      expect(room?.teaches).toBe(true);
    }
  });

  it("each faculty in the original pack has a non-empty question bank", async () => {
    const pack = await getActivePack();
    for (const f of pack.faculty) {
      expect(f.questions.length, `faculty ${f.id} has no questions`).toBeGreaterThan(0);
      // Every question carries the canonical fields the rest of the system relies on.
      for (const q of f.questions) {
        expect(q.id).toBeTruthy();
        expect(q.prompt).toBeTruthy();
        expect(["A", "B", "C", "D"]).toContain(q.correct);
        expect(q.options.A).toBeTruthy();
        expect(q.options.B).toBeTruthy();
        expect(q.options.C).toBeTruthy();
        expect(q.options.D).toBeTruthy();
      }
    }
  });
});

describe("FacultyService — pack-driven", () => {
  it("loads faculty + banks from the active pack", async () => {
    const svc = await FacultyService.start({} as never);
    expect(svc.isReady()).toBe(true);
    const ids = svc.faculty().map((f) => f.id);
    expect(ids).toContain("ruby");
    expect(ids).toContain("sally-science");
    expect(ids).toContain("professor-edward");
    expect(svc.bank("ruby")?.questions.length).toBeGreaterThan(0);
  });

  it("reloads from a swapped pack — proves the abstraction is real", async () => {
    const fakePack: ContentPack = {
      id: "test:fake",
      name: "Fake Pack",
      description: "A minimal pack for the swap test.",
      version: "0.0.1",
      faculty: [
        {
          id: "fake-teacher",
          displayName: "Fake Teacher",
          shortName: "Fake",
          subjects: ["fake-subject"],
          bio: "A fake teacher.",
          accent: "#000000",
          systemPrompt: "You are a fake teacher.",
          defaultModel: "anthropic/claude-haiku-4.5",
          questions: [
            {
              id: "fake-1",
              prompt: "What is 2+2?",
              options: { A: "3", B: "4", C: "5", D: "6" },
              correct: "B",
              explanation: "Two plus two is four.",
              subject: "fake-subject",
              difficulty: "easy",
              faculty: "fake-teacher",
            },
          ],
        },
      ],
      rooms: [
        {
          id: "fake-room",
          name: "Fake Room",
          channelName: "fake",
          teacherId: "fake-teacher",
          description: "A fake room.",
          teaches: true,
        },
      ],
    };
    setActivePack(fakePack);
    const svc = await FacultyService.start({} as never);
    expect(svc.faculty().map((f) => f.id)).toEqual(["fake-teacher"]);
    expect(svc.bank("fake-teacher")?.questions.length).toBe(1);
    expect(svc.bank("ruby")).toBeNull();
    const picked = svc.pick({ faculty: "fake-teacher" });
    expect(picked?.id).toBe("fake-1");
  });
});
