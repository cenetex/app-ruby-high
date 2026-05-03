import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
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
  // Pre-populate XP high enough to clear the XP gate at any year (Senior
  // threshold is 50). Tests that want to exercise the XP gate explicitly
  // should set a lower value via the third arg.
  state.character = {
    name: "Pip", playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—", personality: "—", xp, strings: {},
    conditions: [], yearbook: [], createdAt: Date.now(),
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

  it("dailyStatus reports completed once the player has played today", async () => {
    const { ruby } = await makeServices();
    const sid = "test:completed";
    const state = attachCharacter(ruby, sid);
    state.character!.lastDailyDate = "2026-05-04";
    const monday = new Date("2026-05-04T18:00:00Z");
    const status = ruby.dailyStatus(sid, monday);
    expect(status.available).toBe(false);
    expect(status.reason).toBe("completed");
  });

  it("playDaily poses the deterministic daily question, marks the round as Daily", async () => {
    const { ruby } = await makeServices();
    const sid = "test:play";
    attachCharacter(ruby, sid);
    const after = ruby.playDaily(sid, new Date("2026-05-04T18:00:00Z"));
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.isDaily).toBe(true);
    expect(after.activeRound?.dailyKey).toBe("2026-05-04");
    expect(after.faculty).toBe("sally-science"); // Mon → sally
  });

  it("playDaily runs on a Saturday (no weekend gating)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weekend-allowed";
    attachCharacter(ruby, sid);
    const after = ruby.playDaily(sid, new Date("2026-05-09T18:00:00Z"));
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.isDaily).toBe(true);
    expect(after.faculty).toBe("ruby"); // Sat → Ruby in the rotation
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

describe("XP gate — streak alone is not enough", () => {
  it("Freshman streak hit but XP < threshold → does NOT advance; advances when XP catches up", async () => {
    const { ruby } = await makeServices();
    const sid = "test:xp-gate";
    // Start with 0 XP. Freshman threshold is 1 streak + 5 XP.
    attachCharacter(ruby, sid, "9", 0);
    let now = new Date("2026-05-04T18:00:00Z");
    ruby.playDaily(sid, now);
    let correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    let s = ruby.getOrCreate(sid);
    // Streak is 1 (gate met), but XP is only 1-2 from the player roll
    // (well under 5). So we should still be in Freshman.
    expect(s.character!.streak?.count).toBeGreaterThanOrEqual(1);
    expect(s.currentGrade).toBe("9");
    expect(s.character!.xp).toBeLessThan(5);

    // Bank XP up over the threshold without missing — keep playing dailies.
    // The streak grows past the required 1; each correct answer adds 1-2 XP.
    let day = 5;
    while (s.character!.xp < 5) {
      now = new Date(`2026-05-${String(day).padStart(2, "0")}T18:00:00Z`);
      try {
        ruby.playDaily(sid, now);
      } catch {
        day++; continue;
      }
      correct = ruby.getOrCreate(sid).current!.correct! as Choice;
      ruby.submitAnswer(sid, correct);
      s = ruby.getOrCreate(sid);
      day++;
      if (day > 20) break; // bail-out
    }
    // Once XP cleared the gate (streak was already past 1), advancement
    // should have triggered on the latest pass.
    expect(s.character!.xp).toBeGreaterThanOrEqual(5);
    expect(s.currentGrade).toBe("10");
  });
});

describe("Daily-pass streak + grade advancement", () => {
  it("Daily pass ticks the streak; miss resets to 0", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-tick";
    attachCharacter(ruby, sid, "9");
    // Day 1: pass.
    let now = new Date("2026-05-04T18:00:00Z");
    ruby.playDaily(sid, now);
    let correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    let ch = ruby.getOrCreate(sid).character!;
    // Freshman threshold is 1 — that single pass advanced us to grade 10.
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");
    expect(ch.streak).toEqual({ grade: "10", count: 0 });
    expect(ch.yearbook).toHaveLength(1);
    expect(ch.yearbook[0]?.grade).toBe("9");

    // Now in Sophomore (needs streak of 2). Day 2 pass.
    now = new Date("2026-05-05T18:00:00Z");
    ruby.playDaily(sid, now);
    correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct);
    ch = ruby.getOrCreate(sid).character!;
    expect(ch.streak).toEqual({ grade: "10", count: 1 });
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10");

    // Day 3: miss the question.
    now = new Date("2026-05-06T18:00:00Z");
    ruby.playDaily(sid, now);
    const correctAns = ruby.getOrCreate(sid).current!.correct! as Choice;
    const wrongAns: Choice = (correctAns === "A" ? "B" : "A");
    ruby.submitAnswer(sid, wrongAns);
    ch = ruby.getOrCreate(sid).character!;
    expect(ch.streak).toEqual({ grade: "10", count: 0 }); // streak reset
    expect(ruby.getOrCreate(sid).currentGrade).toBe("10"); // still Sophomore
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
    // ready to start Senior streak. This skips the Freshman/Soph/Junior
    // walkthrough since the per-grade-streak logic is the same.
    attachCharacter(ruby, sid, "12");
    const ch = ruby.getOrCreate(sid).character!;
    ch.streak = { grade: "12", count: 0 };
    ch.yearbook = [
      { grade: "9",  completedAt: 1, summary: { correct: 1, total: 1 } },
      { grade: "10", completedAt: 2, summary: { correct: 2, total: 2 } },
      { grade: "11", completedAt: 3, summary: { correct: 3, total: 3 } },
    ];

    // Walk 4 daily passes Mon-Thu (no weekend break needed for 4).
    const days = [
      "2026-05-04T18:00:00Z", // Mon
      "2026-05-05T18:00:00Z", // Tue
      "2026-05-06T18:00:00Z", // Wed
      "2026-05-07T18:00:00Z", // Thu
    ];
    for (const iso of days) {
      ruby.playDaily(sid, new Date(iso));
      const c = ruby.getOrCreate(sid).current!.correct! as Choice;
      ruby.submitAnswer(sid, c);
    }
    const finalCh = ruby.getOrCreate(sid).character!;
    expect(finalCh.yearbook).toHaveLength(4);
    expect(finalCh.yearbook[3]?.grade).toBe("12");
    expect(ruby.getOrCreate(sid).currentGrade).toBe("12"); // doesn't advance past Senior
    expect(ruby.getOrCreate(sid).completedGrades).toContain("12");
  });
});
