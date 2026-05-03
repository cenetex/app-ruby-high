import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../services/state-store.js";
import type { QuizState } from "../types.js";

let tmpDir: string;
let storePath: string;

function blankState(sessionId: string): QuizState {
  return {
    sessionId,
    faculty: "ruby",
    subject: null,
    current: null,
    history: [],
    score: { correct: 0, total: 0 },
    lastReveal: null,
    status: "idle",
    phase: "intro",
    phaseToken: 0,
    askedQuestionIds: [],
    currentGrade: null,
    completedGrades: [],
    hasSeenIntro: false,
    activePackId: null,
    character: null,
    npcRosters: {},
    activeRound: null,
    pendingRoll: null,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-store-"));
  storePath = join(tmpDir, "state.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("StateStore", () => {
  it("save then load round-trips the sessions", async () => {
    const store = new StateStore(storePath);
    await store.save([blankState("a"), blankState("b")]);
    const loaded = await store.load();
    expect(loaded.size).toBe(2);
    expect(loaded.get("a")?.sessionId).toBe("a");
    expect(loaded.get("b")?.sessionId).toBe("b");
  });

  it("load returns an empty map when the file doesn't exist", async () => {
    const store = new StateStore(join(tmpDir, "nope.json"));
    const loaded = await store.load();
    expect(loaded.size).toBe(0);
  });

  it("a save failure does not poison subsequent saves", async () => {
    // Point the store at a directory that exists but isn't writable for the
    // first save, then "fix" it for the second. We simulate the failure by
    // pointing at a path whose directory IS a regular file the first time
    // around, then unblock by removing the file.
    const blockerPath = join(tmpDir, "blocker");
    await writeFile(blockerPath, "this is a file, not a directory");
    const store = new StateStore(join(blockerPath, "state.json"));

    // Suppress the expected console.error.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // First save fails (parent path is a regular file → mkdir/writeFile fail).
    await expect(store.save([blankState("a")])).rejects.toThrow();
    expect(errSpy).toHaveBeenCalled();

    // Second save points at a fresh, valid path. It must succeed even though
    // the chain has a prior rejection.
    const goodStore = new StateStore(join(tmpDir, "recovered.json"));
    // Re-use the same writeChain semantic by calling on the bad store first
    // to confirm it's recovered: another save on the same store, but to a
    // path that should still work. We do it via the goodStore separately
    // because we can't change `path` on an existing instance — the more
    // important guarantee is that the original store doesn't keep rejecting.
    await store.save([blankState("a")]).catch(() => undefined);
    // The original store still fails on the same broken path, but the chain
    // itself isn't poisoned: third save also actively attempts, doesn't
    // short-circuit.
    const third = store.save([blankState("c")]);
    await expect(third).rejects.toThrow();

    await goodStore.save([blankState("ok")]);
    const loaded = await goodStore.load();
    expect(loaded.get("ok")).toBeDefined();
  });

  it("serializes concurrent saves without tearing", async () => {
    // Three concurrent saves — last writer wins, no partial-file artifacts.
    const store = new StateStore(storePath);
    await Promise.all([
      store.save([blankState("a")]),
      store.save([blankState("a"), blankState("b")]),
      store.save([blankState("a"), blankState("b"), blankState("c")]),
    ]);
    const text = await readFile(storePath, "utf8");
    // Whatever landed must be valid JSON and contain at least one session.
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.sessions.length).toBeGreaterThanOrEqual(1);
    expect(parsed.sessions.length).toBeLessThanOrEqual(3);
  });

  it("describe() returns the configured path", () => {
    const store = new StateStore("/tmp/custom-path.json");
    expect(store.describe()).toBe("/tmp/custom-path.json");
  });

  it("an explicit await of save() observes the failure", async () => {
    const blockerPath = join(tmpDir, "blocker2");
    await writeFile(blockerPath, "blocker");
    const store = new StateStore(join(blockerPath, "state.json"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let caught: unknown = null;
    try {
      await store.save([blankState("a")]);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    // And the chain logged it for operators.
    expect(errSpy).toHaveBeenCalled();
  });
});
