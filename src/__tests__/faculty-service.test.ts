import { describe, expect, it } from "vitest";
import { FacultyService } from "../services/faculty-service.js";

describe("FacultyService", () => {
  it("loads all three packs at start()", async () => {
    const svc = await FacultyService.start({} as never);
    expect(svc.isReady()).toBe(true);
    expect(svc.bank("ruby")?.questions.length).toBeGreaterThanOrEqual(200);
    expect(svc.bank("sally-science")?.questions.length).toBeGreaterThanOrEqual(200);
    expect(svc.bank("professor-edward")?.questions.length).toBeGreaterThanOrEqual(200);
  });

  it("pick(faculty) returns only that faculty's questions", async () => {
    const svc = await FacultyService.start({} as never);
    for (let i = 0; i < 20; i++) {
      const q = svc.pick({ faculty: "sally-science" });
      expect(q?.faculty).toBe("sally-science");
    }
  });

  it("pick(subject) returns only that subject when stock allows", async () => {
    const svc = await FacultyService.start({} as never);
    const physics = svc.pick({ faculty: "sally-science", subject: "physics" });
    expect(physics?.subject).toBe("physics");
  });

  it("pick(difficulty) returns only that difficulty when stock allows", async () => {
    const svc = await FacultyService.start({} as never);
    const easy = svc.pick({ faculty: "ruby", difficulty: "easy" });
    expect(easy?.difficulty).toBe("easy");
    const hard = svc.pick({ faculty: "ruby", difficulty: "hard" });
    expect(hard?.difficulty).toBe("hard");
  });

  it("pick(exclude) never re-serves a question already in the exclude set", async () => {
    const svc = await FacultyService.start({} as never);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const q = svc.pick({ faculty: "ruby", exclude: seen });
      if (!q) break;
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(15);
  });

  it("falls back across filters when the strictest tier is empty", async () => {
    const svc = await FacultyService.start({} as never);
    // No 'physics' questions in Ruby's bank — should fall back to subject-less pick.
    const q = svc.pick({ faculty: "ruby", subject: "physics" });
    expect(q?.faculty).toBe("ruby");
  });

  it("returns null when nothing matches and exclude covers the world", async () => {
    const svc = await FacultyService.start({} as never);
    const allRubyIds = new Set(svc.bank("ruby")!.questions.map((q) => q.id));
    expect(svc.pick({ faculty: "ruby", exclude: allRubyIds })).toBeNull();
  });
});
