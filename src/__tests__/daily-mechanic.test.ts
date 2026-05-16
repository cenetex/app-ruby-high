import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { handleAppRoutes } from "../routes.js";
import { applyTick, emptyMashCard } from "../characters/mash.js";
import {
  dailyKey,
  dailyIndex,
  facultyForDay,
  type Choice,
  type DailyClassRecord,
  type Grade,
} from "../types.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

const TEACHING_FACULTY_IDS = ["ruby", "sally-science", "professor-edward"] as const;
const REQUIRED_CLASSES_BY_GRADE: Record<Grade, number> = { "9": 1, "10": 2, "11": 3, "12": 4 };

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-daily-"));
  storePath = join(tmpDir, "state.json");
  activeRuby = null;
});

afterEach(async () => {
  if (activeRuby) await activeRuby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  activeRuby = ruby;
  return { ruby, faculty };
}

function attachCharacter(ruby: RubyHighService, sid: string, grade: Grade = "9", preFillClasses = true) {
  ruby.selectGrade(sid, grade);
  const state = ruby.getOrCreate(sid);
  // Pre-populate completed daily classes so advancement gates are met from
  // the start. Tests that want to exercise the per-class gate explicitly
  // can pass preFillClasses=false.
  state.character = {
    name: "Pip", playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—", personality: "—",
    yearbook: [], createdAt: Date.now(),
    dailyClasses: preFillClasses ? completedClassesForGrade(grade) : undefined,
  };
  return state;
}

function markFacultyMastered(ruby: RubyHighService, faculty: FacultyService, sid: string, facultyId: string) {
  void faculty;
  const state = ruby.getOrCreate(sid);
  const ch = state.character;
  const grade = state.currentGrade;
  if (!ch || !grade) throw new Error("No active character grade");
  ch.dailyClasses = ch.dailyClasses ?? {};
  Object.assign(ch.dailyClasses, completedClassesForGrade(grade, [facultyId]));
}

function completedClassesForGrade(
  grade: Grade,
  facultyIds: readonly string[] = TEACHING_FACULTY_IDS,
): Record<string, DailyClassRecord> {
  const records: Record<string, DailyClassRecord> = {};
  const required = REQUIRED_CLASSES_BY_GRADE[grade];
  for (const facultyId of facultyIds) {
    for (let i = 0; i < required; i++) {
      const date = `2000-01-0${i + 1}`;
      records[`${grade}:${facultyId}:${date}`] = {
        grade,
        facultyId,
        date,
        status: "complete",
        questionCount: 3,
        correctCount: 3,
        scoreTotal: 270,
        scoreMax: 300,
        letterGrade: "A",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }
  return records;
}

function completeClassOnDate(
  ruby: RubyHighService,
  sid: string,
  facultyId: string,
  iso: string,
  picked: Choice = "A",
) {
  const day = dailyKey(new Date(iso));
  Date.now = () => new Date(iso).getTime();
  for (let i = 0; i < 3; i++) {
    ruby.pose(sid, {
      prompt: `Class question ${facultyId} ${day} ${i + 1}`,
      options: { A: "a", B: "b", C: "c", D: "d" },
      correct: "A",
      faculty: facultyId,
      stat: "head",
      questionId: `qclass_${facultyId}_${day}_${i + 1}`,
    });
    ruby.submitAnswer(sid, picked);
  }
}

// ── pure helpers ────────────────────────────────────────────────────────────

describe("dailyKey", () => {
  it("returns the same key for two moments inside the same daily-class date", () => {
    // 17:00 UTC = bell. 18:00 UTC same calendar day still = today.
    const k1 = dailyKey(new Date("2026-05-04T18:00:00Z"));
    const k2 = dailyKey(new Date("2026-05-04T23:30:00Z"));
    expect(k1).toBe("2026-05-04");
    expect(k2).toBe("2026-05-04");
  });

  it("treats pre-17:00-UTC as the previous calendar day", () => {
    // 09:00 UTC on May 5 is BEFORE the 17:00 bell, so the active Daily
    // is still May 4's. After 17:00 UTC on May 5, it flips to May 5.
    const before = dailyKey(new Date("2026-05-05T09:00:00Z"));
    const after = dailyKey(new Date("2026-05-05T17:30:00Z"));
    expect(before).toBe("2026-05-04");
    expect(after).toBe("2026-05-05");
  });

  it("rolls back across month/year boundaries", () => {
    const earlyJan = dailyKey(new Date("2026-01-01T05:00:00Z"));
    expect(earlyJan).toBe("2025-12-31");
  });
});

describe("dailyIndex + facultyForDay", () => {
  it("dailyIndex monotonic across 7 consecutive days", () => {
    const days = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"];
    const indices = days.map(dailyIndex);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1]! + 1);
    }
  });

  it("facultyForDay rotates the 5-teacher cycle across all 7 days", () => {
    // 2026-05-04 = Monday → sally
    expect(facultyForDay("2026-05-04")).toBe("sally-science");
    expect(facultyForDay("2026-05-05")).toBe("professor-edward"); // Tue
    expect(facultyForDay("2026-05-06")).toBe("ruby");             // Wed
    expect(facultyForDay("2026-05-07")).toBe("sally-science");    // Thu
    expect(facultyForDay("2026-05-08")).toBe("professor-edward"); // Fri
    expect(facultyForDay("2026-05-09")).toBe("ruby");             // Sat
    expect(facultyForDay("2026-05-10")).toBe("sally-science");    // Sun
  });
});

// ── playDaily flow ──────────────────────────────────────────────────────────

describe("RubyHighService.dailyStatus + playDaily", () => {
  it("dailyStatus reports no-character before the player has rolled one", async () => {
    const { ruby } = await makeServices();
    const status = ruby.dailyStatus("test:no-char");
    expect(status.available).toBe(false);
    expect(status.reason).toBe("no-character");
  });

  it("dailyStatus is available on Saturday too (Daily runs every day)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weekend";
    attachCharacter(ruby, sid);
    const sat = new Date("2026-05-09T18:00:00Z"); // Saturday after bell
    const status = ruby.dailyStatus(sid, sat);
    expect(status.available).toBe(true);
    expect(status.facultyId).toBe("ruby"); // Sat → Ruby in the rotation
  });

  it("dailyStatus reports available on a weekday with no prior completion", async () => {
    const { ruby } = await makeServices();
    const sid = "test:available";
    attachCharacter(ruby, sid);
    const monday = new Date("2026-05-04T18:00:00Z");
    const status = ruby.dailyStatus(sid, monday);
    expect(status.available).toBe(true);
    expect(status.facultyId).toBe("sally-science");
    expect(status.dailyKey).toBe("2026-05-04");
  });

  it("dailyStatus reports completed once the bonus has been used today", async () => {
    const { ruby } = await makeServices();
    const sid = "test:completed";
    const state = attachCharacter(ruby, sid);
    state.character!.lastBonusDate = "2026-05-04";
    const monday = new Date("2026-05-04T18:00:00Z");
    const status = ruby.dailyStatus(sid, monday);
    expect(status.available).toBe(false);
    expect(status.reason).toBe("completed");
  });

  it("session telemetry also hides today's bonus once used", async () => {
    const { ruby, faculty } = await makeServices();
    const stateKey = "rh:anonymous";
    const state = attachCharacter(ruby, stateKey);
    const today = dailyKey();
    state.character!.lastBonusDate = today;
    const runtime = {
      agentId: "test-agent",
      character: { name: "Ruby" },
      getService: (type: string) => {
        if (type === RubyHighService.serviceType) return ruby;
        if (type === FacultyService.serviceType) return faculty;
        return null;
      },
    };
    let response: any = null;
    const handled = await handleAppRoutes({
      method: "GET",
      pathname: "/api/apps/ruby-high/session/test",
      runtime,
      res: {},
      error: (_res, message, status = 500) => {
        response = { status, error: message };
      },
      json: (_res, data, status = 200) => {
        response = { status, data };
      },
      readJsonBody: async () => ({}),
    });
    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.data.telemetry.daily).toEqual({
      available: false,
      reason: "completed",
      facultyId: facultyForDay(today),
      dailyKey: today,
    });
  });

  it("playBonus poses a daily warm-up draw, marks the round as bonus", async () => {
    const { ruby } = await makeServices();
    const sid = "test:play";
    attachCharacter(ruby, sid);
    const after = ruby.playBonus(sid, new Date("2026-05-04T18:00:00Z"));
    expect(after.current).not.toBeNull();
    expect(["head", "heart", "hustle", "honor"]).toContain(after.current?.stat);
    expect(after.activeRound?.isBonus).toBe(true);
    expect(after.activeRound?.stat).toBe(after.current?.stat);
    expect(after.faculty).toBe("sally-science"); // Mon → sally
  });

  it("playBonus runs on a Saturday (no weekend gating)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weekend-allowed";
    attachCharacter(ruby, sid);
    const after = ruby.playBonus(sid, new Date("2026-05-09T18:00:00Z"));
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.isBonus).toBe(true);
    expect(after.activeRound?.stat).toBe(after.current?.stat);
    expect(after.faculty).toBe("ruby"); // Sat → Ruby in the rotation
  });
});

describe("RubyHighService.resetSession persistence", () => {
  it("persists the fresh reset state so a new process does not hydrate the old character", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reset-persist";
    attachCharacter(ruby, sid);
    await ruby.flush();
    ruby.resetSession(sid);
    await ruby.flush();

    const fresh = new RubyHighService({} as never, new StateStore(storePath));
    await fresh["hydrate"]();
    const after = fresh.getOrCreate(sid);
    expect(after.character).toBeNull();
    expect(after.score).toMatchObject({ correct: 0, total: 0, points: 0, possible: 0 });
    expect(after.history).toEqual([]);
  });
});

// ── streak mechanic ────────────────────────────────────────────────────────

describe("NPC cohort — runs in parallel with the player", () => {
  it("first Daily seeds the cohort with 6 NPCs at the bottom of the arc", async () => {
    const { ruby } = await makeServices();
    const sid = "test:cohort-init";
    attachCharacter(ruby, sid);
    ruby.playDaily(sid, new Date("2026-05-04T18:00:00Z"));
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    const cohort = ruby.getOrCreate(sid).npcCohort;
    expect(cohort).toBeDefined();
    expect(cohort).toHaveLength(6);
    for (const npc of cohort!) {
      // requiredStreakForGrade("9") = 1, so a Freshman-NPC who happens to
      // hit the dice on day 1 can already be a Sophomore. Seeded at "9";
      // tick may have promoted some to "10". No further than that.
      expect(["9", "10"]).toContain(npc.grade);
      expect(["lyra", "sami", "ravi", "indra", "mika", "noor"]).toContain(npc.id);
    }
  });

  it("each NPC ticks independently — streaks diverge across the cohort", async () => {
    const { ruby } = await makeServices();
    const sid = "test:cohort-diverge";
    attachCharacter(ruby, sid);
    // Run a handful of Dailies. With NPC stats spread across HEAD -1..+2,
    // their streaks WILL diverge — some will graduate Freshman in 1 try,
    // some will reset multiple times.
    const days = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"];
    const realNow = Date.now;
    try {
      for (const d of days) {
        const iso = `${d}T18:00:00Z`;
        completeClassOnDate(ruby, sid, facultyForDay(dailyKey(new Date(iso))), iso);
        if (ruby.getOrCreate(sid).character?.pendingGraduation) {
          ruby.completeGraduation(sid, { kind: "advantage" });
        }
      }
    } finally {
      Date.now = realNow;
    }
    const cohort = ruby.getOrCreate(sid).npcCohort!;
    // After 5 Dailies, the cohort has diverged — some are still in 9, some
    // have advanced to 10 or beyond. Just sanity-check the shape is valid;
    // exact composition depends on dice.
    for (const npc of cohort) {
      expect(npc.streak.grade).toBe(npc.grade);
      expect(npc.streak.count).toBeGreaterThanOrEqual(0);
      expect(["9", "10", "11", "12"]).toContain(npc.grade);
    }
    // At least ONE NPC should have advanced past Freshman after 5 dailies
    // (P(any of 6 advance) is overwhelmingly high).
    const someoneMoved = cohort.some((n) => n.grade !== "9" || n.completedGrades.length > 0);
    expect(someoneMoved).toBe(true);
  });

  it("graduated NPCs stop ticking on subsequent Dailies", async () => {
    const { ruby } = await makeServices();
    const sid = "test:cohort-grad";
    attachCharacter(ruby, sid);
    // Inject a graduated NPC into the cohort directly.
    const state = ruby.getOrCreate(sid);
    state.npcCohort = [{
      id: "indra", grade: "12",
      streak: { grade: "12", count: 4 },
      completedGrades: ["9", "10", "11", "12"],
      graduated: true,
    }];
    ruby.playDaily(sid, new Date("2026-05-04T18:00:00Z"));
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    const after = ruby.getOrCreate(sid).npcCohort!.find((n) => n.id === "indra")!;
    // Graduated state preserved — no streak mutation.
    expect(after.graduated).toBe(true);
    expect(after.completedGrades).toEqual(["9", "10", "11", "12"]);
    expect(after.lastDailyDate).toBeUndefined(); // not stamped because graduated
  });
});

describe("Mentor mode — graduated character offers their playbook move", () => {
  it("clearCharacter on a graduated character stashes a mentor offer", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mentor-stash";
    attachCharacter(ruby, sid, "12");
    const ch = ruby.getOrCreate(sid).character!;
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
      { grade: "12", completedAt: 4, summary: { correct: 4, total: 4 } },
    ];
    ch.playbookId = "lifer"; // pick a playbook with a known move
    ruby.clearCharacter(sid);
    const offer = ruby.getOrCreate(sid).mentorOffer;
    expect(offer).toBeTruthy();
    expect(offer!.mentorName).toBe("Pip");
    expect(offer!.playbookId).toBe("lifer");
    expect(offer!.moveName).toBe("Old gossip");
  });

  it("clearCharacter archives a completed active student without duplicating the pool", async () => {
    const { ruby } = await makeServices();
    const sid = "test:student-pool-archive";
    attachCharacter(ruby, sid, "12");
    const ch = ruby.getOrCreate(sid).character!;
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
      { grade: "12", completedAt: 4, summary: { correct: 4, total: 4 } },
    ];

    ruby.clearCharacter(sid);
    let after = ruby.getOrCreate(sid);
    expect(after.character).toBeNull();
    expect(after.currentGrade).toBe("9");
    expect(after.completedGrades).toEqual([]);
    expect(after.studentPool).toHaveLength(1);
    expect(after.studentPool![0]).toMatchObject({
      name: "Pip",
      playbookId: "overachiever",
      completedAt: 4,
    });

    ruby.clearCharacter(sid);
    after = ruby.getOrCreate(sid);
    expect(after.studentPool).toHaveLength(1);
  });

  it("clearCharacter on a non-graduated character does NOT set a mentor offer", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mentor-skip";
    attachCharacter(ruby, sid);
    ruby.clearCharacter(sid);
    expect(ruby.getOrCreate(sid).mentorOffer ?? null).toBeNull();
    expect(ruby.getOrCreate(sid).studentPool ?? []).toEqual([]);
  });

  it("createCharacter with mentorAccepted=true stamps inheritedFrom + clears the offer", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mentor-accept";
    // Manually set a mentor offer on the state.
    ruby.selectGrade(sid, "9");
    const state = ruby.getOrCreate(sid);
    state.mentorOffer = {
      mentorName: "Old Pip",
      playbookId: "overachiever",
      moveName: "Margins are sacred",
      moveDescription: "Once per year, retake one missed question.",
    };
    ruby.createCharacter(sid, {
      name: "New Kid", playbookId: "slacker",
      stats: { head: 0, heart: 1, hustle: 2, honor: -1 },
      arcAnswer: "—", personality: "—",
      mentorAccepted: true,
    });
    const after = ruby.getOrCreate(sid);
    expect(after.character!.inheritedFrom).toEqual({
      mentorName: "Old Pip", playbookId: "overachiever",
      moveName: "Margins are sacred",
      moveDescription: "Once per year, retake one missed question.",
    });
    expect(after.mentorOffer).toBeNull();
  });

  it("createCharacter with mentorAccepted=false does not stamp; offer cleared either way", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mentor-decline";
    ruby.selectGrade(sid, "9");
    const state = ruby.getOrCreate(sid);
    state.mentorOffer = {
      mentorName: "Old Pip", playbookId: "overachiever",
      moveName: "Margins are sacred", moveDescription: "—",
    };
    ruby.createCharacter(sid, {
      name: "Fresh", playbookId: "slacker",
      stats: { head: 0, heart: 1, hustle: 2, honor: -1 },
      arcAnswer: "—", personality: "—",
      // mentorAccepted not set → defaults to false
    });
    const after = ruby.getOrCreate(sid);
    expect(after.character!.inheritedFrom).toBeUndefined();
    expect(after.mentorOffer).toBeNull(); // cleared either way
  });
});

describe("Per-class letter-grade gate — streak alone is not enough", () => {
  it("Freshman: a passing class ticks the streak, but all classes must reach C before advancement triggers", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:per-class-gate";
    attachCharacter(ruby, sid, "9", false);
    const ch0 = ruby.getOrCreate(sid).character!;
    ch0.stats = { head: 99, heart: 99, hustle: 99, honor: 99 };

    // Mock Date.now so the streak-tick math (which reads `new Date()`
    // internally for the daily-key) sees the test's time-travel.
    const realNow = Date.now;
    try {
      completeClassOnDate(ruby, sid, "sally-science", "2026-05-04T18:00:00Z");
      expect(ruby.getOrCreate(sid).currentGrade).toBe("9");
    } finally {
      Date.now = realNow;
    }
    const final = ruby.getOrCreate(sid);
    expect(final.currentGrade).toBe("9");
    expect(final.character!.streak).toEqual({ grade: "9", count: 1, lastDate: "2026-05-04" });
    expect(final.character!.pendingGraduation?.grade).toBeUndefined();

    markFacultyMastered(ruby, faculty, sid, "ruby");
    markFacultyMastered(ruby, faculty, sid, "professor-edward");
    expect(ruby.getOrCreate(sid).character!.pendingGraduation?.grade).toBe("9");
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
  });

  it("marks the ceremony ready as soon as the final class reaches C after the streak is already met", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:advance-when-class-gate-lands";
    attachCharacter(ruby, sid, "9", false);
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    markFacultyMastered(ruby, faculty, sid, "ruby");
    markFacultyMastered(ruby, faculty, sid, "sally-science");
    expect(ruby.getOrCreate(sid).character!.pendingGraduation?.grade).toBeUndefined();
    markFacultyMastered(ruby, faculty, sid, "professor-edward");

    const after = ruby.getOrCreate(sid);
    expect(after.currentGrade).toBe("9");
    expect(after.character!.pendingGraduation?.grade).toBe("9");
    expect(after.character!.yearbook.some((y) => y.grade === "9")).toBe(false);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
  });
});

describe("Streak + grade advancement", () => {
  it("Legendary correctness on a fresh day ticks the streak; skipping a day resets it", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-tick";
    attachCharacter(ruby, sid, "9");
    const realNow = Date.now;
    try {
      const advance = (iso: string) => {
        completeClassOnDate(ruby, sid, "ruby", iso);
      };
      // Day 1: Freshman streak required = 1. One completed passing class
      // opens the ceremony because attachCharacter pre-clears class gates.
      advance("2026-05-04T18:00:00Z");
      let ch = ruby.getOrCreate(sid).character!;
      expect(ruby.getOrCreate(sid).currentGrade).toBe("9");
      expect(ch.pendingGraduation?.grade).toBe("9");
      ruby.completeGraduation(sid, { kind: "advantage" });
      ch = ruby.getOrCreate(sid).character!;
      expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
      expect(ch.streak).toEqual({ grade: "10", count: 0 });
      expect(ch.yearbook).toHaveLength(1);
      expect(ch.yearbook[0]?.grade).toBe("9");

      // Day 2 (Sophomore): streak ticks to 1.
      advance("2026-05-05T18:00:00Z");
      ch = ruby.getOrCreate(sid).character!;
      expect(ch.streak?.grade).toBe("10");
      expect(ch.streak?.count).toBe(1);

      // Skip May 6. Day 4: streak should reset to 1 (gap > 1 day).
      advance("2026-05-07T18:00:00Z");
      ch = ruby.getOrCreate(sid).character!;
      expect(ch.streak?.count).toBe(1);
    } finally {
      Date.now = realNow;
    }
  });

  it("subjectScores tracks per-faculty correctness across the run", async () => {
    const { ruby } = await makeServices();
    const sid = "test:subjects";
    attachCharacter(ruby, sid, "9");
    // Day 1 = sally
    ruby.playDaily(sid, new Date("2026-05-04T18:00:00Z"));
    const c1 = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, c1);
    const ch = ruby.getOrCreate(sid).character!;
    expect(ch.subjectScores).toBeDefined();
    expect(ch.subjectScores!["sally-science"]).toEqual({ correct: 1, total: 1 });
  });

  it("graduates after Senior streak (4 in a row) — yearbook has 4 entries, grade stays 12", async () => {
    const { ruby } = await makeServices();
    const sid = "test:grad";
    // Inject a state already at Senior with prior 3 grades completed and
    // ready to start Senior streak. attachCharacter pre-fills dailyClasses
    // for this grade so all per-class gates are met up front; the test
    // exercises only the streak arithmetic.
    attachCharacter(ruby, sid, "12");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "12", count: 0 };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];

    // Senior's daily-class counter requires 4 dates. One passed daily class
    // per date ticks the legacy streak field.
    const days = [
      "2026-05-04T18:00:00Z", // Mon
      "2026-05-05T18:00:00Z", // Tue
      "2026-05-06T18:00:00Z", // Wed
      "2026-05-07T18:00:00Z", // Thu
    ];
    const realNow = Date.now;
    try {
      for (const iso of days) {
        completeClassOnDate(ruby, sid, "ruby", iso);
      }
    } finally {
      Date.now = realNow;
    }
    let finalCh = ruby.getOrCreate(sid).character!;
    expect(finalCh.pendingGraduation?.grade).toBe("12");
    ruby.completeGraduation(sid, { kind: "advantage" });
    finalCh = ruby.getOrCreate(sid).character!;
    expect(finalCh.yearbook).toHaveLength(4);
    expect(finalCh.yearbook[3]?.grade).toBe("12");
    expect(ruby.getOrCreate(sid).currentGrade).toBe("12"); // doesn't advance past Senior
    expect(ruby.getOrCreate(sid).completedGrades).toContain("12");
    expect(ruby.getOrCreate(sid).studentPool?.[0]).toMatchObject({
      name: "Pip",
      playbookId: "overachiever",
    });
  });

  it("refreshes the archived completed student when a diploma image lands later", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:student-pool-diploma-refresh";
    attachCharacter(ruby, sid, "12", false);
    const state = ruby.getOrCreate(sid);
    state.completedGrades = ["9", "10", "11"];
    const ch = state.character!;
    ch.streak = { grade: "12", count: 4, lastDate: "2026-05-07" };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];
    markFacultyMastered(ruby, faculty, sid, "ruby");
    markFacultyMastered(ruby, faculty, sid, "sally-science");
    markFacultyMastered(ruby, faculty, sid, "professor-edward");

    ruby.getOrCreate(sid);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).studentPool?.[0]?.diplomaImageDataUrl).toBeUndefined();

    ruby.setDiplomaImage(sid, "https://cdn.example.test/diploma.png");
    expect(ruby.getOrCreate(sid).studentPool?.[0]?.diplomaImageDataUrl)
      .toBe("https://cdn.example.test/diploma.png");
  });

  it("reconciles already-cleared Freshman gates into ceremony-ready state on session read", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reconcile-cleared-freshman";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };

    const after = ruby.getOrCreate(sid);
    expect(after.currentGrade).toBe("9");
    expect(after.character!.pendingGraduation?.grade).toBe("9");
    expect(after.character!.yearbook.some((y) => y.grade === "9")).toBe(false);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
  });

  it("persists clearing a stale ceremony when requirements are no longer met", async () => {
    const { ruby } = await makeServices();
    const sid = "test:stale-graduation-requirements-persist";
    const state = attachCharacter(ruby, sid, "9", false);
    state.character!.pendingGraduation = {
      grade: "9",
      readyAt: Date.now(),
      summary: { correct: 1, total: 1 },
    };
    await ruby.flush();

    expect(() => ruby.completeGraduation(sid, { kind: "advantage" })).toThrow(/requirements are not complete/i);
    await ruby.flush();

    const fresh = new RubyHighService({} as never, new StateStore(storePath));
    await fresh["hydrate"]();
    fresh.setFacultyService(await FacultyService.start({} as never));
    activeRuby = fresh;
    expect(fresh.getOrCreate(sid).character!.pendingGraduation).toBeNull();
  });

  it("persists clearing a duplicate ceremony for an already-completed grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:duplicate-graduation-clear-persist";
    const state = attachCharacter(ruby, sid, "9");
    state.character!.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    state.character!.pendingGraduation = {
      grade: "9",
      readyAt: Date.now(),
      summary: { correct: 1, total: 1 },
    };
    state.completedGrades = ["9"];
    await ruby.flush();

    const after = ruby.completeGraduation(sid, { kind: "advantage" });
    expect(after.character!.pendingGraduation).toBeNull();
    await ruby.flush();

    const fresh = new RubyHighService({} as never, new StateStore(storePath));
    await fresh["hydrate"]();
    fresh.setFacultyService(await FacultyService.start({} as never));
    activeRuby = fresh;
    expect(fresh.getOrCreate(sid).character!.pendingGraduation).toBeNull();
  });

  it("records durable MASH axis resolution events at graduation", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mash-axis-school-event";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    const card = emptyMashCard();
    applyTick(card.cells.sami!, 1);
    applyTick(card.cells.sami!, 1);
    ch.mashCard = card;

    ruby.getOrCreate(sid);
    const after = ruby.completeGraduation(sid, { kind: "advantage" });
    const event = after.schoolEvents.find((e) => e.kind === "mash.axis-resolved");
    expect(event).toMatchObject({
      kind: "mash.axis-resolved",
      grade: "9",
      axis: "crush",
      studentId: "sami",
    });
  });

  it("unlocks teacher story pages only at Freshman and Junior year-end", async () => {
    const { ruby } = await makeServices();

    const freshmanSid = "test:first-bell-freshman-pages";
    attachCharacter(ruby, freshmanSid, "9");
    ruby.getOrCreate(freshmanSid).character!.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ruby.getOrCreate(freshmanSid);
    const freshman = ruby.completeGraduation(freshmanSid, { kind: "advantage" });
    expect(freshman.comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

    const sophomoreSid = "test:first-bell-sophomore-no-pages";
    attachCharacter(ruby, sophomoreSid, "10");
    ruby.getOrCreate(sophomoreSid).character!.streak = { grade: "10", count: 2, lastDate: "2026-05-05" };
    ruby.getOrCreate(sophomoreSid);
    const sophomore = ruby.completeGraduation(sophomoreSid, { kind: "advantage" });
    expect(sophomore.comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([]);

    const juniorSid = "test:first-bell-junior-pages";
    attachCharacter(ruby, juniorSid, "11");
    ruby.getOrCreate(juniorSid).character!.streak = { grade: "11", count: 3, lastDate: "2026-05-06" };
    ruby.getOrCreate(juniorSid);
    const junior = ruby.completeGraduation(juniorSid, { kind: "advantage" });
    expect(junior.comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([4, 5, 6]);
  });

  it("unlocks a fixed student insert page on first friendship and keeps it across characters", async () => {
    const { ruby } = await makeServices();
    const sid = "test:first-bell-student-insert";
    attachCharacter(ruby, sid, "9", false);
    const ch = ruby.getOrCreate(sid).character!;
    const card = emptyMashCard();
    applyTick(card.cells.lyra!, 1);
    ch.mashCard = card;

    ruby.poseOpinion(sid, {
      faculty: "ruby",
      subject: "social",
      questionId: "opinion_friend_lyra",
      prompt: "What makes a classmate trustworthy?",
      rubric: "Names one concrete trust signal and one concrete reason to verify.",
    });
    ruby.recordOpinion(sid, "player", "A clear source and a reason to check it.");
    const after = ruby.recordGrades(sid, [
      { responder: "player", score: 8, comment: "Good." },
      { responder: "lyra", score: 9, comment: "Best answer." },
    ], "lyra");

    expect(after.comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([7]);
    expect(after.schoolEvents.some((e) =>
      e.kind === "comic.page-unlocked" &&
      e.pageNumber === 7 &&
      e.reason === "student-befriended" &&
      e.sourceId === "student:lyra"
    )).toBe(true);

    ruby.clearCharacter(sid);
    expect(ruby.getOrCreate(sid).character).toBeNull();
    expect(ruby.getOrCreate(sid).comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([7]);
    ruby.createCharacter(sid, {
      name: "Pip Two",
      playbookId: "overachiever",
      stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
      arcAnswer: "New arc.",
      personality: "Curious.",
    });
    expect(ruby.getOrCreate(sid).comicCollection.unlockedPages.map((p) => p.pageNumber)).toEqual([7]);
  });

  it("opens Senior graduation as soon as the final class reaches C after the streak is already met", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:graduate-when-senior-class-gate-lands";
    attachCharacter(ruby, sid, "12", false);
    const state = ruby.getOrCreate(sid);
    state.completedGrades = ["9", "10", "11"];
    const ch = state.character!;
    ch.streak = { grade: "12", count: 4, lastDate: "2026-05-07" };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];

    markFacultyMastered(ruby, faculty, sid, "ruby");
    markFacultyMastered(ruby, faculty, sid, "sally-science");
    expect(ruby.getOrCreate(sid).character!.pendingGraduation?.grade).toBeUndefined();
    markFacultyMastered(ruby, faculty, sid, "professor-edward");

    const after = ruby.getOrCreate(sid);
    expect(after.currentGrade).toBe("12");
    expect(after.character!.pendingGraduation?.grade).toBe("12");
    expect(after.character!.yearbook).toHaveLength(3);
    ruby.completeGraduation(sid, { kind: "advantage" });
    const graduated = ruby.getOrCreate(sid);
    expect(graduated.currentGrade).toBe("12");
    expect(graduated.completedGrades).toContain("12");
    expect(graduated.character!.yearbook).toHaveLength(4);
    expect(graduated.character!.yearbook[3]?.grade).toBe("12");
  });

  it("graduation stat reward applies +1 with a +3 cap", async () => {
    const { ruby } = await makeServices();
    const sid = "test:graduation-stat-reward";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.stats.head = 2;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };

    expect(ruby.getOrCreate(sid).character!.pendingGraduation?.grade).toBe("9");
    ruby.completeGraduation(sid, { kind: "stat", stat: "head" });
    const after = ruby.getOrCreate(sid);
    expect(after.currentGrade).toBe("10");
    expect(after.character!.stats.head).toBe(3);
    expect(after.character!.yearbook[0]?.graduationReward).toEqual({ kind: "stat", stat: "head" });
    expect(() => ruby.completeGraduation(sid, { kind: "stat", stat: "head" })).toThrow(/No graduation ceremony/);
  });

  it("graduation advantage reward adds one roll to the next grade cap", async () => {
    const { ruby } = await makeServices();
    const sid = "test:graduation-advantage-reward";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };

    ruby.getOrCreate(sid);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
    expect(ruby.advantageRollsRemaining(sid)).toEqual({ used: 0, cap: 4, remaining: 4 });
  });

  it("graduation class affinity converts the first miss in that class, once", async () => {
    const { ruby } = await makeServices();
    const sid = "test:graduation-affinity-reward";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };

    ruby.getOrCreate(sid);
    ruby.completeGraduation(sid, { kind: "affinity", facultyId: "ruby" });
    ruby.pose(sid, {
      prompt: "Affinity save",
      options: { A: "a", B: "b", C: "c", D: "d" },
      correct: "A",
      faculty: "ruby",
      rarity: "rare",
      questionId: "q_affinity_save",
    });
    ruby.submitAnswer(sid, "B");
    let after = ruby.getOrCreate(sid);
    expect(after.lastReveal?.wasCorrect).toBe(true);
    expect(after.lastReveal?.affinitySave).toEqual({ facultyId: "ruby" });
    expect(after.character!.classAffinity?.["10"]?.used).toBe(true);

    ruby.pose(sid, {
      prompt: "Affinity spent",
      options: { A: "a", B: "b", C: "c", D: "d" },
      correct: "A",
      faculty: "ruby",
      rarity: "rare",
      questionId: "q_affinity_spent",
    });
    ruby.submitAnswer(sid, "B");
    after = ruby.getOrCreate(sid);
    expect(after.lastReveal?.wasCorrect).toBe(false);
    expect(after.lastReveal?.affinitySave ?? null).toBeNull();
  });

  it("Paper Card: yearbook entry written at advancement freezes identity (later edits to live character don't bleed back)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:paper-card-snapshot";
    attachCharacter(ruby, sid, "9");
    const ch = ruby.getOrCreate(sid).character!;
    ch.name = "Pip-at-Freshman";
    ch.flavorQuote = "honestly the syllabus is bullying me";
    ch.stats = { head: 2, heart: 0, hustle: -1, honor: 1 };

    // Force a single Freshman class-complete so the ceremony becomes available,
    // then complete it to write the yearbook entry.
    const realNow = Date.now;
    try {
      completeClassOnDate(ruby, sid, "ruby", "2026-05-04T18:00:00Z");
      ruby.completeGraduation(sid, { kind: "advantage" });
    } finally {
      Date.now = realNow;
    }

    const written = ruby.getOrCreate(sid).character!.yearbook[0]!;
    expect(written.grade).toBe("9");
    expect(written.name).toBe("Pip-at-Freshman");
    expect(written.flavorQuote).toBe("honestly the syllabus is bullying me");
    expect(written.stats).toEqual({ head: 2, heart: 0, hustle: -1, honor: 1 });

    // Now mutate the live character. The Paper Card must not move.
    const live = ruby.getOrCreate(sid).character!;
    live.name = "Pip-at-Sophomore";
    live.flavorQuote = "actually i love it now";
    live.stats = { head: 0, heart: 2, hustle: 1, honor: -1 };

    const stillFrozen = ruby.getOrCreate(sid).character!.yearbook[0]!;
    expect(stillFrozen.name).toBe("Pip-at-Freshman");
    expect(stillFrozen.flavorQuote).toBe("honestly the syllabus is bullying me");
    expect(stillFrozen.stats).toEqual({ head: 2, heart: 0, hustle: -1, honor: 1 });
  });
});
