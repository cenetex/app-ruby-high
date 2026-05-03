import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-test-"));
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

describe("RubyHighService Phase 1", () => {
  it("pickAndPose draws from the current faculty's bank", async () => {
    const { ruby } = await makeServices();
    const sid = "test:1";
    const state = ruby.pickAndPose(sid, { faculty: "sally-science", subject: "physics" });
    expect(state.current).not.toBeNull();
    expect(state.current?.faculty).toBe("sally-science");
    expect(state.current?.subject).toBe("physics");
    expect(state.askedQuestionIds).toHaveLength(1);
  });

  it("never poses the same question twice in a session", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:2";
    const total = faculty.bank("ruby")!.questions.length;
    const seen = new Set<string>();
    for (let i = 0; i < total; i++) {
      const s = ruby.pickAndPose(sid, { faculty: "ruby" });
      const id = s.current!.id;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    // After the bank is exhausted, the next pick should throw.
    expect(() => ruby.pickAndPose(sid, { faculty: "ruby" })).toThrow();
  });

  it("scores correct vs incorrect picks", async () => {
    const { ruby } = await makeServices();
    const sid = "test:3";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    let s = ruby.getOrCreate(sid);
    const correct = s.current!.correct!;
    s = ruby.submitAnswer(sid, correct);
    expect(s.score).toEqual({ correct: 1, total: 1 });
    expect(s.lastReveal?.wasCorrect).toBe(true);

    ruby.pickAndPose(sid, { faculty: "ruby" });
    s = ruby.getOrCreate(sid);
    const wrong = s.current!.correct! === "A" ? "B" : "A";
    s = ruby.submitAnswer(sid, wrong);
    expect(s.score).toEqual({ correct: 1, total: 2 });
    expect(s.lastReveal?.wasCorrect).toBe(false);
  });

  it("setFaculty accepts active faculty and rejects unknown ids", async () => {
    const { ruby } = await makeServices();
    const sid = "test:4";
    expect(ruby.setFaculty(sid, "sally-science").faculty).toBe("sally-science");
    expect(ruby.setFaculty(sid, "professor-edward").faculty).toBe("professor-edward");
    expect(() => ruby.setFaculty(sid, "no-such-teacher")).toThrow(/Unknown faculty/);
  });

  it("persists session state across a 'restart'", async () => {
    const { ruby } = await makeServices();
    const sid = "test:5";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const correct = ruby.getOrCreate(sid).current!.correct!;
    ruby.submitAnswer(sid, correct);
    // wait for write chain to flush
    await new Promise((r) => setTimeout(r, 50));

    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);

    const restored = rubyB.getOrCreate(sid);
    expect(restored.score.correct).toBe(1);
    expect(restored.score.total).toBe(1);
    expect(restored.askedQuestionIds.length).toBe(1);
    expect(restored.faculty).toBe("sally-science");
  });

  it("resetSession wipes everything for that sessionId", async () => {
    const { ruby } = await makeServices();
    const sid = "test:6";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.submitAnswer(sid, ruby.getOrCreate(sid).current!.correct!);
    expect(ruby.getOrCreate(sid).score.correct).toBe(1);

    ruby.resetSession(sid);
    const fresh = ruby.getOrCreate(sid);
    expect(fresh.score).toEqual({ correct: 0, total: 0 });
    expect(fresh.askedQuestionIds).toEqual([]);
    expect(fresh.history).toEqual([]);
  });

  it("setFaculty clears the board when switching to a different teaching room", async () => {
    const { ruby } = await makeServices();
    const sid = "test:swap-room";
    // Start in Sally's room, draw a question.
    ruby.setFaculty(sid, "sally-science");
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    let state = ruby.getOrCreate(sid);
    expect(state.current).not.toBeNull();
    expect(state.activeRound).not.toBeNull();
    // Walk into Edward's room — Sally's question must not follow.
    state = ruby.setFaculty(sid, "professor-edward");
    expect(state.faculty).toBe("professor-edward");
    expect(state.current).toBeNull();
    expect(state.lastReveal).toBeNull();
    expect(state.activeRound).toBeNull();
    expect(state.status).toBe("idle");
  });

  it("setFaculty preserves the board when re-selecting the same faculty (no-op)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reselect";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const before = ruby.getOrCreate(sid).current?.id;
    expect(before).toBeDefined();
    const state = ruby.setFaculty(sid, "ruby");
    expect(state.current?.id).toBe(before);
    expect(state.activeRound).not.toBeNull();
  });

  it("setFaculty also clears the board when entering the lounge", async () => {
    // Pre-existing behavior; locked in as a regression check now that the
    // wipe path is shared with the cross-classroom case.
    const { ruby } = await makeServices();
    const sid = "test:to-lounge";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    expect(ruby.getOrCreate(sid).current).not.toBeNull();
    const state = ruby.setFaculty(sid, "lounge");
    expect(state.faculty).toBe("lounge");
    expect(state.current).toBeNull();
    expect(state.activeRound).toBeNull();
  });

  it("normalizes legacy state files: missing pendingRoll loads as null, not undefined", async () => {
    // Hand-write a state.json the way pre-v0.5.1 saves looked: no
    // pendingRoll field at all. The migration in normalizeLoaded must coerce
    // it to null so downstream `if (!state.pendingRoll)` checks behave
    // consistently and the type contract holds.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:1",
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
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        // pendingRoll intentionally omitted — this is the bug we fixed.
        updatedAt: Date.now(),
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const loaded = ruby.getOrCreate("legacy:1");
    expect(loaded.pendingRoll).toBeNull();
    expect(loaded.pendingRoll).not.toBeUndefined();
    activeRuby = ruby; // ensure flush in afterEach
  });
});
