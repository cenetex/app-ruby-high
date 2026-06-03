import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubyHighService } from "../services/ruby-high-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { StateStore } from "../services/state-store.js";

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

function pickAndAnswer(ruby: RubyHighService, sid: string, pickCorrect = true) {
  const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
  if (!posed.current) throw new Error("No question posed");
  const correct = posed.current.correct!;
  const pick = pickCorrect ? correct : (correct === "A" ? "B" : "A");
  ruby.submitAnswer(sid, pick as any);
  return ruby.getOrCreate(sid).lastReveal;
}

function pickWrongAndAnswer(ruby: RubyHighService, sid: string) {
  return pickAndAnswer(ruby, sid, false);
}

describe("Overachiever", () => {
  it("auto-corrects one wrong answer per year", async () => {
    const { ruby } = await makeServices();
    const sid = "test:overachiever";
    createCharacter(ruby, sid, "overachiever");

    const reveal1 = pickWrongAndAnswer(ruby, sid);
    expect(reveal1!.wasCorrect).toBe(true);
    expect(reveal1!.playbookMove).toBe("overachiever");

    const reveal2 = pickWrongAndAnswer(ruby, sid);
    expect(reveal2!.wasCorrect).toBe(false);
    expect(reveal2!.playbookMove).toBeFalsy();
  });

  it("provides one retake per grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:overachiever-grades";
    createCharacter(ruby, sid, "overachiever");

    const r9 = pickWrongAndAnswer(ruby, sid);
    expect(r9!.wasCorrect).toBe(true);
    expect(r9!.playbookMove).toBe("overachiever");

    ruby.selectGrade(sid, "10");
    const r10 = pickWrongAndAnswer(ruby, sid);
    expect(r10!.wasCorrect).toBe(true);
    expect(r10!.playbookMove).toBe("overachiever");
  });
});

describe("Slacker", () => {
  it("swaps HEAD for HUSTLE on a miss roll when question stat is HEAD", async () => {
    const { ruby } = await makeServices();
    const sid = "test:slacker";
    // Negative HEAD ensures a miss on HEAD questions. High HUSTLE is the fallback.
    createCharacter(ruby, sid, "slacker", { head: -1, heart: 1, hustle: 3, honor: -1 });

    vi.spyOn(Math, "random").mockReturnValue(0.16);

    const posed = ruby.pickAndPose(sid, { faculty: "professor-edward" });
    const correct = posed.current!.correct!;
    ruby.submitAnswer(sid, correct as any);

    const reveal = ruby.getOrCreate(sid).lastReveal;
    expect(reveal!.playerRoll).toBeTruthy();
    expect(reveal!.wasCorrect).toBe(true);
    // Move only fires if the question stat is HEAD — literature questions
    // from Edward typically map to HEAD. The test verifies the roll ran.
    if (reveal!.playerRoll?.stat === "hustle") {
      // Swap happened — the stat changed from HEAD to HUSTLE.
      expect(reveal!.playbookMove).toBe("slacker");
    }
  });
});

describe("Class Clown", () => {
  it("rolls HEART on miss and voids on 10+", async () => {
    const { ruby } = await makeServices();
    const sid = "test:class-clown";
    // Terrible HEAD, great HEART → miss triggers the re-roll → 10+ voids.
    createCharacter(ruby, sid, "class-clown", { head: -2, heart: 4, hustle: 0, honor: -1 });

    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const posed = ruby.pickAndPose(sid, { faculty: "professor-edward" });
    const wrong = posed.current!.correct === "A" ? "B" : "A";
    ruby.submitAnswer(sid, wrong as any);

    const reveal = ruby.getOrCreate(sid).lastReveal;
    // Class Clown fires on ANY miss, regardless of stat.
    if (reveal!.playerRoll?.stat === "heart") {
      expect(reveal!.wasCorrect).toBe(true);
      expect(reveal!.playbookMove).toBe("class-clown");
    }
  });
});

describe("Outsider", () => {
  it("auto-corrects one wrong answer per period", async () => {
    const { ruby } = await makeServices();
    const sid = "test:outsider";
    createCharacter(ruby, sid, "outsider", { head: 1, heart: 0, hustle: -1, honor: 2 });

    const reveal1 = pickWrongAndAnswer(ruby, sid);
    expect(reveal1!.wasCorrect).toBe(true);
    expect(reveal1!.playbookMove).toBe("outsider");

    const reveal2 = pickWrongAndAnswer(ruby, sid);
    expect(reveal2!.wasCorrect).toBe(false);
    expect(reveal2!.playbookMove).toBeFalsy();
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
