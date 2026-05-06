import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../services/auth-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import type { Choice, Grade } from "../types.js";

// Canonical telemetry events the retention dashboard depends on. The
// product cannot be tuned without measurement; these names are the
// load-bearing contract between the server and any downstream sink.
//
// If a name in here changes, every consumer query has to change with it.
// The point of this test is to make a quiet rename impossible.

type CapturedEvent = { name: string; [k: string]: unknown };

const captured: CapturedEvent[] = [];
let restoreStdout: (() => void) | null = null;

function startCapture(): void {
  const original = process.stdout.write.bind(process.stdout);
  // Vitest's process.stdout.write has overloaded signatures; we only
  // care about the (chunk, ...) form that the logger uses.
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    for (const line of s.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const obj = JSON.parse(line) as CapturedEvent;
        if (obj && typeof obj.name === "string") captured.push(obj);
      } catch {
        // Not a structured log line — ignore.
      }
    }
    return original(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  restoreStdout = () => {
    process.stdout.write = original;
  };
}

function emittedNames(): string[] {
  return captured.map((e) => e.name);
}

beforeEach(() => {
  captured.length = 0;
  startCapture();
});

afterEach(() => {
  if (restoreStdout) restoreStdout();
  restoreStdout = null;
  vi.restoreAllMocks();
});

describe("Canonical event log emissions", () => {
  it("auth.signed-in fires on successful PKCE exchange, with isReturning flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-events-auth-"));
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-user-1" }), { status: 200 });
      });

      const auth = await AuthService.start({} as never, new StateStore(join(dir, "state.json")));
      try {
        const first = auth.startPkce("http://localhost/callback");
        await auth.completePkce(first.state, "code-1");
        const second = auth.startPkce("http://localhost/callback");
        await auth.completePkce(second.state, "code-2");
      } finally {
        await auth.stop();
      }

      const signIns = captured.filter((e) => e.name === "auth.signed-in");
      expect(signIns).toHaveLength(2);
      expect(signIns[0]!.isReturning).toBe(false);
      expect(signIns[1]!.isReturning).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session.ended fires when a session ages past its TTL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-events-gc-"));
    try {
      const auth = await AuthService.start({} as never, new StateStore(join(dir, "state.json")));
      try {
        const TTL = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        auth.injectSessionForTest("expired", { userId: "u-1", createdAt: now - TTL - 1000, expiresAt: now - 1000 });
        auth.gcSessions(now);
      } finally {
        await auth.stop();
      }

      const ends = captured.filter((e) => e.name === "session.ended");
      expect(ends).toHaveLength(1);
      expect(ends[0]!.userId).toBe("u-1");
      expect(ends[0]!.reason).toBe("ttl-expired");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("question.posed, answer.picked fire across one multiple-choice round", async () => {
    const { ruby } = await makeServices();
    const sid = "test:events-mc";
    attachCharacter(ruby, sid);
    ruby.pose(sid, {
      prompt: "2 + 2 = ?",
      options: { A: "3", B: "4", C: "5", D: "6" },
      correct: "B",
      faculty: "ruby",
    });
    ruby.submitAnswer(sid, "B" as Choice);

    const names = emittedNames();
    expect(names).toContain("question.posed");
    expect(names).toContain("answer.picked");

    const posed = captured.find((e) => e.name === "question.posed")!;
    expect(posed.type).toBe("multiple-choice");
    expect(posed.faculty).toBe("ruby");

    const picked = captured.find((e) => e.name === "answer.picked")!;
    expect(picked.picked).toBe("B");
    expect(picked.correct).toBe("B");
    expect(picked.wasCorrect).toBe(true);
  });

  it("essay.submitted, essay.graded fire across one opinion round", async () => {
    const { ruby } = await makeServices();
    const sid = "test:events-opinion";
    attachCharacter(ruby, sid);
    ruby.poseOpinion(sid, {
      prompt: "Discuss the postwar novel.",
      faculty: "professor-edward",
    });
    ruby.recordOpinion(sid, "player", "A short, earnest take on the postwar novel.");
    ruby.recordGrades(
      sid,
      [{ responder: "player", score: 8, comment: "good" }],
      "player",
    );

    const names = emittedNames();
    expect(names).toContain("question.posed");
    expect(names).toContain("essay.submitted");
    expect(names).toContain("essay.graded");

    const submitted = captured.find((e) => e.name === "essay.submitted")!;
    expect(submitted.responder).toBe("player");
    expect(typeof submitted.length).toBe("number");

    const graded = captured.find((e) => e.name === "essay.graded")!;
    expect(graded.playerScore).toBe(8);
    expect(graded.playerPassed).toBe(true);
    expect(graded.bestResponder).toBe("player");
  });
});

// Minimal local helpers so this test stays self-contained — a registry-loaded
// FacultyService + RubyHighService is enough surface to exercise pose / answer
// / opinion paths without dragging in cohort-roster fixtures.

async function makeServices() {
  const dir = await mkdtemp(join(tmpdir(), "ruby-high-events-"));
  const store = new StateStore(join(dir, "state.json"));
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  return { ruby, faculty, dir, store };
}

function attachCharacter(ruby: RubyHighService, sid: string, grade: Grade = "9") {
  ruby.selectGrade(sid, grade);
  const state = ruby.getOrCreate(sid);
  state.character = {
    name: "Pip",
    playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—",
    personality: "—",
    yearbook: [],
    createdAt: Date.now(),
  } as never;
  return state;
}
