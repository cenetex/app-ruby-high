import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import type { Choice } from "../types.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-phase-"));
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

/**
 * The session phase machine — every transition exercised end-to-end through
 * the public mutator surface. These tests are the contract for the
 * state-machine refactor: any future change to the phase semantics has to
 * keep these green or own the update deliberately.
 *
 * Invariant the suite enforces: every successful transition() bumps
 * phaseToken by exactly 1. No silent re-renders, no double bumps.
 */
describe("RubyHighService phase machine", () => {
  it("fresh session starts at phase=intro, phaseToken=0", async () => {
    const { ruby } = await makeServices();
    const state = ruby.getOrCreate("test:fresh");
    expect(state.phase).toBe("intro");
    expect(state.phaseToken).toBe(0);
    expect(state.status).toBe("idle");
  });

  it("selectGrade transitions intro → in-room and bumps the token", async () => {
    const { ruby } = await makeServices();
    const sid = "test:select-grade";
    const before = ruby.getOrCreate(sid);
    expect(before.phaseToken).toBe(0);
    const after = ruby.selectGrade(sid, "11");
    expect(after.phase).toBe("in-room");
    expect(after.phaseToken).toBe(1);
    expect(after.status).toBe("idle");
    expect(after.currentGrade).toBe("11");
  });

  it("pickAndPose transitions in-room → asking; question + activeRound populated", async () => {
    const { ruby } = await makeServices();
    const sid = "test:asking";
    ruby.selectGrade(sid, "11"); // → in-room (token 1)
    const after = ruby.pickAndPose(sid, { faculty: "ruby" }); // → asking (token 2)
    expect(after.phase).toBe("asking");
    expect(after.phaseToken).toBe(2);
    expect(after.status).toBe("awaiting-answer");
    expect(after.current).not.toBeNull();
    expect(after.activeRound).not.toBeNull();
    expect(after.lastReveal).toBeNull(); // reset rule for asking
  });

  it("submitAnswer transitions asking → revealed (single-player immediate resolve)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:revealed";
    ruby.selectGrade(sid, "11"); // → in-room (1)
    ruby.pickAndPose(sid, { faculty: "ruby" }); // → asking (2)
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    const after = ruby.submitAnswer(sid, correct); // → revealed (3)
    expect(after.phase).toBe("revealed");
    expect(after.phaseToken).toBe(3);
    expect(after.status).toBe("revealed");
    expect(after.lastReveal).not.toBeNull();
  });

  it("clearBoard transitions revealed → in-room and wipes board state", async () => {
    const { ruby } = await makeServices();
    const sid = "test:clear";
    ruby.selectGrade(sid, "11"); // 1
    ruby.pickAndPose(sid, { faculty: "ruby" }); // 2
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    ruby.submitAnswer(sid, correct); // 3 → revealed
    const after = ruby.clearBoard(sid); // 4 → in-room
    expect(after.phase).toBe("in-room");
    expect(after.phaseToken).toBe(4);
    expect(after.current).toBeNull();
    expect(after.lastReveal).toBeNull();
    expect(after.activeRound).toBeNull();
  });

  it("setFaculty to a different teacher transitions to in-room and resets the board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:swap";
    ruby.selectGrade(sid, "11"); // 1
    ruby.pickAndPose(sid, { faculty: "sally-science" }); // 2 → asking
    const after = ruby.setFaculty(sid, "professor-edward"); // 3 → in-room
    expect(after.phase).toBe("in-room");
    expect(after.phaseToken).toBe(3);
    expect(after.faculty).toBe("professor-edward");
    expect(after.current).toBeNull();
    expect(after.activeRound).toBeNull();
  });

  it("setFaculty to the SAME teacher is a no-op and does NOT bump the token", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reselect";
    ruby.selectGrade(sid, "11"); // 1
    ruby.pickAndPose(sid, { faculty: "ruby" }); // 2
    const before = ruby.getOrCreate(sid).phaseToken;
    const after = ruby.setFaculty(sid, "ruby");
    expect(after.phaseToken).toBe(before); // still 2
    expect(after.current).not.toBeNull(); // question preserved
  });

  it("setFaculty to lounge transitions to lounge and clears the board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:lounge";
    ruby.selectGrade(sid, "11");
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const after = ruby.setFaculty(sid, "lounge");
    expect(after.phase).toBe("lounge");
    expect(after.faculty).toBe("lounge");
    expect(after.current).toBeNull();
    expect(after.activeRound).toBeNull();
  });

  it("revisit cycle: Sally → Edward → Sally bumps the token three times", async () => {
    const { ruby } = await makeServices();
    const sid = "test:revisit";
    ruby.selectGrade(sid, "11"); // 1
    ruby.setFaculty(sid, "sally-science"); // 2
    ruby.setFaculty(sid, "professor-edward"); // 3
    const after = ruby.setFaculty(sid, "sally-science"); // 4
    expect(after.phaseToken).toBe(4);
    expect(after.faculty).toBe("sally-science");
    // The "third visit didn't fire greeting" client bug came from the viewer's
    // dedupe key matching the first visit's. With phaseToken bumping every
    // transition, the viewer can dedupe purely on the token.
  });

  it("phaseToken is monotonic across a full session", async () => {
    const { ruby } = await makeServices();
    const sid = "test:monotonic";
    const tokens: number[] = [];
    tokens.push(ruby.getOrCreate(sid).phaseToken); // 0
    tokens.push(ruby.selectGrade(sid, "11").phaseToken); // 1
    tokens.push(ruby.pickAndPose(sid, { faculty: "ruby" }).phaseToken); // 2
    const correct = ruby.getOrCreate(sid).current!.correct! as Choice;
    tokens.push(ruby.submitAnswer(sid, correct).phaseToken); // 3
    tokens.push(ruby.clearBoard(sid).phaseToken); // 4
    tokens.push(ruby.setFaculty(sid, "sally-science").phaseToken); // 5
    tokens.push(ruby.pickAndPose(sid, { faculty: "sally-science" }).phaseToken); // 6
    expect(tokens).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("legacy state files (no phase/phaseToken) load with derived defaults", async () => {
    const { writeFile } = await import("node:fs/promises");
    // A pre-state-machine save with a question on the board: derived phase
    // should land at "asking" (round active, not resolved). Timer is set
    // far in the future so getOrCreate's tickRound() doesn't auto-resolve
    // it on read.
    const now = Date.now();
    const farFuture = now + 60 * 60 * 1000;
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:asking",
        faculty: "ruby",
        subject: "general-knowledge",
        current: { id: "q1", prompt: "?", type: "multiple-choice",
                   options: { A: "a", B: "b", C: "c", D: "d" }, correct: "A" },
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "awaiting-answer",
        askedQuestionIds: ["q1"],
        currentGrade: "11",
        completedGrades: [],
        gradeProgress: { "11": 0 },
        hasSeenIntro: true,
        character: null,
        npcRosters: {},
        activeRound: { questionId: "q1", type: "multiple-choice", startedAt: now, durationMs: 60 * 60 * 1000, expiresAt: farFuture, npcs: [], player: { picked: null, answeredAt: null }, resolved: false, resolvedAt: null, firstCorrect: null, opinionResponses: [], opinionGrades: [], bestResponder: null },
        updatedAt: 1,
        // phase + phaseToken intentionally absent
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const loaded = ruby.getOrCreate("legacy:asking");
    expect(loaded.phase).toBe("asking");
    expect(loaded.phaseToken).toBe(0); // absent → defaults to 0; will bump on next transition
    expect(loaded.status).toBe("awaiting-answer");
    activeRuby = ruby;
  });

  it("derives phase=in-room for legacy state with a grade but no active round", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:idle",
        faculty: "ruby",
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: "11",
        completedGrades: [],
        gradeProgress: {},
        hasSeenIntro: true,
        character: null,
        npcRosters: {},
        activeRound: null,
        updatedAt: 1,
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    expect(ruby.getOrCreate("legacy:idle").phase).toBe("in-room");
    activeRuby = ruby;
  });

  it("derives phase=intro for legacy state with no grade selected", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:fresh",
        faculty: "ruby",
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: null,
        completedGrades: [],
        gradeProgress: {},
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        updatedAt: 1,
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    expect(ruby.getOrCreate("legacy:fresh").phase).toBe("intro");
    activeRuby = ruby;
  });
});
