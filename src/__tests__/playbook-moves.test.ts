import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubyHighService } from "../services/ruby-high-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { StateStore } from "../services/state-store.js";
import { registerPack } from "../content/registry.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "playbook-moves-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import("node:fs/promises");
  await rm(testDir, { recursive: true, force: true });
});

async function makeServices() {
  const storePath = join(testDir, "state.json");
  const store = new StateStore(storePath);
  const ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
  const faculty = await FacultyService.start({} as never);
  ruby.setFacultyService(faculty);
  return { ruby };
}

function createCharacter(
  ruby: RubyHighService, sid: string, playbookId: string,
  stats?: Record<string, number>,
) {
  ruby.createCharacter(sid, {
    name: "Test", playbookId,
    stats: (stats ?? { head: 2, heart: 1, hustle: 0, honor: -1 }) as any,
    arcAnswer: "Test answer", personality: "Test personality",
  });
  ruby.selectGrade(sid, "9");
}

function useStatPack(ruby: RubyHighService, sid: string, packId: string, stat: string) {
  const pack = {
    id: packId, name: "Stat Test", description: "", version: "1.0.0",
    faculty: [{
      id: "stat-test-course", displayName: "Ruby", shortName: "Ruby",
      assetTeacherId: "ruby", subjects: ["test"], bio: "", accent: "#d22a2a",
      systemPrompt: "You are Ruby.", defaultModel: "google/gemini-3.5-flash",
      questions: [{
        id: packId + "-q1", prompt: "Test?", options: { A: "yes", B: "no", C: "maybe", D: "later" },
        correct: "A", subject: "test", difficulty: "easy", faculty: "stat-test-course", stat,
      }],
    }],
    rooms: [{ id: "homeroom-01", name: "Homeroom", teacherId: "stat-test-course", channelName: "#test", description: "", teaches: true }],
    seating: { "9": { "homeroom-01": ["ravi", "mika"] } },
    portraitImages: { students: {}, teachers: {} },
  } as any;
  registerPack(pack, sid);
  ruby.setActivePackForSession(sid, pack.id);
}

function pickAndAnswer(ruby: RubyHighService, sid: string, faculty: string, pickCorrect = true) {
  const posed = ruby.pickAndPose(sid, { faculty });
  if (!posed.current) throw new Error("No question posed");
  const correct = posed.current.correct!;
  const pick = pickCorrect ? correct : (correct === "A" ? "B" : "A");
  ruby.submitAnswer(sid, pick as any);
  return ruby.getOrCreate(sid).lastReveal;
}

describe("Overachiever", () => {
  it("auto-corrects one wrong answer per year", async () => {
    const { ruby } = await makeServices();
    const sid = "test:overachiever";
    createCharacter(ruby, sid, "overachiever");

    const reveal1 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(reveal1!.wasCorrect).toBe(true);
    expect(reveal1!.playbookMove).toBe("overachiever");

    const reveal2 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(reveal2!.wasCorrect).toBe(false);
    expect(reveal2!.playbookMove).toBeFalsy();
  });

  it("provides one retake per grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:overachiever-grades";
    createCharacter(ruby, sid, "overachiever");

    const r9 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(r9!.wasCorrect).toBe(true);
    expect(r9!.playbookMove).toBe("overachiever");

    ruby.selectGrade(sid, "10");
    const r10 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(r10!.wasCorrect).toBe(true);
    expect(r10!.playbookMove).toBe("overachiever");
  });
});

describe("Slacker", () => {
  it("swaps HEAD for HUSTLE on a miss roll", async () => {
    const { ruby } = await makeServices();
    const sid = "test:slacker";
    useStatPack(ruby, sid, "pack:slacker", "head");
    createCharacter(ruby, sid, "slacker", { head: -1, heart: 1, hustle: 3, honor: -1 });

    vi.spyOn(Math, "random").mockReturnValue(0.16);

    const reveal = pickAndAnswer(ruby, sid, "stat-test-course", true);
    expect(reveal!.wasCorrect).toBe(true);
    expect(reveal!.playbookMove).toBe("slacker");
    expect(reveal!.playerRoll?.stat).toBe("hustle");
  });
});

describe("Class Clown", () => {
  it("rolls HEART on miss and voids on 10+", async () => {
    const { ruby } = await makeServices();
    const sid = "test:class-clown";
    useStatPack(ruby, sid, "pack:class-clown", "head");
    createCharacter(ruby, sid, "class-clown", { head: -2, heart: 4, hustle: 0, honor: -1 });

    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const reveal = pickAndAnswer(ruby, sid, "stat-test-course", false);
    expect(reveal!.wasCorrect).toBe(true);
    expect(reveal!.playbookMove).toBe("class-clown");
    expect(reveal!.playerRoll?.stat).toBe("heart");
    expect(reveal!.encouragement).toContain("Crack the room");
  });
});

describe("Outsider", () => {
  it("auto-corrects one wrong answer per period", async () => {
    const { ruby } = await makeServices();
    const sid = "test:outsider";
    createCharacter(ruby, sid, "outsider", { head: 1, heart: 0, hustle: -1, honor: 2 });

    const reveal1 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(reveal1!.wasCorrect).toBe(true);
    expect(reveal1!.playbookMove).toBe("outsider");

    const reveal2 = pickAndAnswer(ruby, sid, "ruby", false);
    expect(reveal2!.wasCorrect).toBe(false);
    expect(reveal2!.playbookMove).toBeFalsy();
  });
});

describe("Heart", () => {
  it("NPCs get valid roll data when Heart playbook is active", async () => {
    const { ruby } = await makeServices();
    const sid = "test:heart";
    createCharacter(ruby, sid, "heart", { head: -1, heart: 2, hustle: 0, honor: 1 });

    const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
    const npcs = posed.activeRound!.npcs;

    expect(npcs.length).toBeGreaterThan(0);
    for (const npc of npcs) {
      expect(npc.rolledTotal).toBeGreaterThanOrEqual(2);
      expect(npc.plannedPick).toBeDefined();
    }
  });
});

describe("Lifer", () => {
  it("starts with bonus advantage rolls per grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:lifer";
    createCharacter(ruby, sid, "lifer");
    ruby.selectGrade(sid, "9");

    const state = ruby.getOrCreate(sid);
    const bonuses = state.character!.advantageRollBonuses;
    expect(bonuses).toBeDefined();
    expect(bonuses!["9"]).toBe(1);
    expect(bonuses!["10"]).toBe(1);
    expect(bonuses!["11"]).toBe(1);
    expect(bonuses!["12"]).toBe(1);
  });
});
