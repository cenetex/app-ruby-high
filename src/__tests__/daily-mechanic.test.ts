import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { handleAppRoutes } from "../routes.js";
import {
  dailyKey,
  dailyIndex,
  facultyForDay,
  type Choice,
  type Grade,
} from "../types.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

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

function attachCharacter(ruby: RubyHighService, sid: string, grade: Grade = "9", xp = 999) {
  ruby.selectGrade(sid, grade);
  const state = ruby.getOrCreate(sid);
  // Pre-populate XP + per-class XP high enough to clear advancement gates
  // at any year (Senior per-class minimum is 16). Tests that want to
  // exercise the per-class gate explicitly should clear subjectXp + set
  // a lower xp via the third arg.
  state.character = {
    name: "Pip", playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—", personality: "—", xp,
    yearbook: [], createdAt: Date.now(),
    subjectXp: { ruby: 999, "sally-science": 999, "professor-edward": 999 },
  };
  return state;
}

// ── pure helpers ────────────────────────────────────────────────────────────

describe("dailyKey", () => {
  it("returns the same key for two moments inside the same school day", () => {
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
    expect(after.score).toEqual({ correct: 0, total: 0 });
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
    for (const d of days) {
      ruby.playDaily(sid, new Date(`${d}T18:00:00Z`));
      const c = ruby.getOrCreate(sid).current!.correct! as Choice;
      ruby.submitAnswer(sid, c);
      if (ruby.getOrCreate(sid).character?.pendingGraduation) {
        ruby.completeGraduation(sid, { kind: "advantage" });
      }
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

  it("clearCharacter on a non-graduated character does NOT set a mentor offer", async () => {
    const { ruby } = await makeServices();
    const sid = "test:mentor-skip";
    attachCharacter(ruby, sid);
    ruby.clearCharacter(sid);
    expect(ruby.getOrCreate(sid).mentorOffer ?? null).toBeNull();
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

describe("Per-class XP gate — streak alone is not enough", () => {
  it("Freshman: a single correct answer in one room hits the streak but not the per-class gate; per-class credits must reach 2 in every room before advancement triggers", async () => {
    const { ruby } = await makeServices();
    const sid = "test:per-class-gate";
    attachCharacter(ruby, sid, "9", 0);
    const ch0 = ruby.getOrCreate(sid).character!;
    ch0.subjectXp = {};
    ch0.stats = { head: 99, heart: 99, hustle: 99, honor: 99 };

    // Mock Date.now so the streak-tick math (which reads `new Date()`
    // internally for the daily-key) sees the test's time-travel.
    const realNow = Date.now;
    try {
      const stepThroughDay = (iso: string) => {
        const t = new Date(iso).getTime();
        Date.now = () => t;
        ruby.playBonus(sid, new Date(iso));
        const cur = ruby.getOrCreate(sid).current!;
        ruby.submitAnswer(sid, cur.correct as Choice);
      };
      stepThroughDay("2026-05-04T18:00:00Z"); // Mon, sally → +2 sally only
      expect(ruby.getOrCreate(sid).currentGrade).toBe("9");
      stepThroughDay("2026-05-05T18:00:00Z"); // Tue, edward → +2 edward
      expect(ruby.getOrCreate(sid).currentGrade).toBe("9");
      // Day 3: Ruby bonus. Now every teaching room is at 2, streak is at 3
      // (≥ FR's required 1) → the ceremony becomes available.
      const t3 = new Date("2026-05-06T18:00:00Z").getTime();
      Date.now = () => t3;
      ruby.playBonus(sid, new Date("2026-05-06T18:00:00Z"));
      ruby.submitAnswer(sid, ruby.getOrCreate(sid).current!.correct as Choice);
    } finally {
      Date.now = realNow;
    }
    const final = ruby.getOrCreate(sid);
    expect(final.character!.subjectXp?.["sally-science"] ?? 0).toBeGreaterThanOrEqual(2);
    expect(final.character!.subjectXp?.["professor-edward"] ?? 0).toBeGreaterThanOrEqual(2);
    expect(final.character!.subjectXp?.["ruby"] ?? 0).toBeGreaterThanOrEqual(2);
    expect(final.currentGrade).toBe("9");
    expect(final.character!.pendingGraduation?.grade).toBe("9");
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
  });

  it("marks the ceremony ready as soon as the final class gate lands after the streak is already met", async () => {
    const { ruby } = await makeServices();
    const sid = "test:advance-when-class-gate-lands";
    attachCharacter(ruby, sid, "9", 0);
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ch.legendariesToday = { date: "2026-05-04", count: 4 };
    ch.subjectXp = { ruby: 2, "sally-science": 2, "professor-edward": 1 };

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-04T20:00:00Z").getTime();
      ruby.pose(sid, {
        prompt: "Final class credit",
        options: { A: "a", B: "b", C: "c", D: "d" },
        correct: "A",
        faculty: "professor-edward",
        rarity: "rare",
        questionId: "q_class_gate_lands",
      });
      ruby.submitAnswer(sid, "A");
    } finally {
      Date.now = realNow;
    }

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
        const t = new Date(iso).getTime();
        Date.now = () => t;
        ruby.playBonus(sid, new Date(iso));
        const cur = ruby.getOrCreate(sid).current!;
        ruby.submitAnswer(sid, cur.correct as Choice);
      };
      // Day 1: Freshman target = 1 / day, streak required = 1 → one
      // bonus pass opens the ceremony; the ceremony advances to Sophomore.
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
    // ready to start Senior streak. attachCharacter pre-loads subjectXp
    // high enough to clear all per-class gates so this test exercises
    // only the streak arithmetic (per-class gate is covered separately).
    attachCharacter(ruby, sid, "12");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "12", count: 0 };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];

    // Senior streak required is 4 school days. One correct answer per
    // school day ticks the streak.
    const days = [
      "2026-05-04T18:00:00Z", // Mon
      "2026-05-05T18:00:00Z", // Tue
      "2026-05-06T18:00:00Z", // Wed
      "2026-05-07T18:00:00Z", // Thu
    ];
    let qIdx = 0;
    const realNow = Date.now;
    try {
      for (const iso of days) {
        Date.now = () => new Date(iso).getTime();
        ruby.pose(sid, {
          prompt: "Test " + (qIdx++),
          options: { A: "a", B: "b", C: "c", D: "d" },
          correct: "A",
          faculty: "ruby",
          questionId: "qtest_" + qIdx,
        });
        ruby.submitAnswer(sid, "A");
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
  });

  it("reconciles already-cleared Freshman gates into ceremony-ready state on session read", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reconcile-cleared-freshman";
    attachCharacter(ruby, sid, "9", 0);
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ch.legendariesToday = { date: "2026-05-04", count: 4 };
    ch.subjectXp = { ruby: 2, "sally-science": 2, "professor-edward": 2 };

    const after = ruby.getOrCreate(sid);
    expect(after.currentGrade).toBe("9");
    expect(after.character!.pendingGraduation?.grade).toBe("9");
    expect(after.character!.yearbook.some((y) => y.grade === "9")).toBe(false);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
  });

  it("opens Senior graduation as soon as the final class gate lands after the streak is already met", async () => {
    const { ruby } = await makeServices();
    const sid = "test:graduate-when-senior-class-gate-lands";
    attachCharacter(ruby, sid, "12", 0);
    const state = ruby.getOrCreate(sid);
    state.completedGrades = ["9", "10", "11"];
    const ch = state.character!;
    ch.streak = { grade: "12", count: 4, lastDate: "2026-05-07" };
    ch.legendariesToday = { date: "2026-05-07", count: 8 };
    ch.subjectXp = { ruby: 16, "sally-science": 16, "professor-edward": 15 };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-07T20:00:00Z").getTime();
      ruby.pose(sid, {
        prompt: "Final senior class credit",
        options: { A: "a", B: "b", C: "c", D: "d" },
        correct: "A",
        faculty: "professor-edward",
        rarity: "rare",
        questionId: "q_senior_class_gate_lands",
      });
      ruby.submitAnswer(sid, "A");
    } finally {
      Date.now = realNow;
    }

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
    attachCharacter(ruby, sid, "9", 0);
    const ch = ruby.getOrCreate(sid).character!;
    ch.stats.head = 2;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ch.subjectXp = { ruby: 2, "sally-science": 2, "professor-edward": 2 };

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
    attachCharacter(ruby, sid, "9", 0);
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ch.subjectXp = { ruby: 2, "sally-science": 2, "professor-edward": 2 };

    ruby.getOrCreate(sid);
    ruby.completeGraduation(sid, { kind: "advantage" });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
    expect(ruby.advantageRollsRemaining(sid)).toEqual({ used: 0, cap: 4, remaining: 4 });
  });

  it("graduation class affinity converts the first miss in that class, once", async () => {
    const { ruby } = await makeServices();
    const sid = "test:graduation-affinity-reward";
    attachCharacter(ruby, sid, "9", 0);
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    ch.subjectXp = { ruby: 2, "sally-science": 2, "professor-edward": 2 };

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

    // Force a single Freshman day-complete so the ceremony becomes available,
    // then complete it to write the yearbook entry.
    const realNow = Date.now;
    Date.now = () => new Date("2026-05-04T18:00:00Z").getTime();
    try {
      ruby.pose(sid, {
        prompt: "Q",
        options: { A: "a", B: "b", C: "c", D: "d" },
        correct: "A",
        faculty: "ruby",
        rarity: "legendary",
        questionId: "qsnap_ruby",
      });
      ruby.submitAnswer(sid, "A");
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
