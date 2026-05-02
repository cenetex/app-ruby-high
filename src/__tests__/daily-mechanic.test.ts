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

function attachCharacter(ruby: RubyHighService, sid: string, grade: Grade = "9") {
  ruby.selectGrade(sid, grade);
  const state = ruby.getOrCreate(sid);
  state.character = {
    name: "Pip", playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—", personality: "—", xp: 0, strings: {},
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

  it("facultyForDay rotates Mon-Fri × Sally/Edward/Ruby; weekends null", () => {
    // 2026-05-04 = Monday → sally
    expect(facultyForDay("2026-05-04")).toBe("sally-science");
    expect(facultyForDay("2026-05-05")).toBe("professor-edward"); // Tue
    expect(facultyForDay("2026-05-06")).toBe("ruby");             // Wed
    expect(facultyForDay("2026-05-07")).toBe("sally-science");    // Thu
    expect(facultyForDay("2026-05-08")).toBe("professor-edward"); // Fri
    expect(facultyForDay("2026-05-09")).toBeNull();               // Sat
    expect(facultyForDay("2026-05-10")).toBeNull();               // Sun
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

  it("dailyStatus reports weekend on Saturday/Sunday even with character", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weekend";
    attachCharacter(ruby, sid);
    const sat = new Date("2026-05-09T18:00:00Z"); // Saturday after bell
    const status = ruby.dailyStatus(sid, sat);
    expect(status.available).toBe(false);
    expect(status.reason).toBe("weekend");
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

  it("playDaily refuses on a weekend", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weekend-refuse";
    attachCharacter(ruby, sid);
    expect(() => ruby.playDaily(sid, new Date("2026-05-09T18:00:00Z"))).toThrow(/weekend/);
  });
});

// ── streak mechanic ────────────────────────────────────────────────────────

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
