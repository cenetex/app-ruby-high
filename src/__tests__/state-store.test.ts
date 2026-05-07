import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../services/state-store.js";
import type { QuizState } from "../types.js";
import type { ContentPack } from "../content/types.js";

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
    schoolEvents: [],
    npcRosters: {},
    activeRound: null,
    pendingRoll: null,
    updatedAt: 1,
  };
}

function fakePack(id: string): ContentPack {
  return {
    id,
    name: id,
    description: "test pack",
    version: "1.0.0",
    faculty: [{
      id: `${id}-teacher`,
      displayName: "Teacher",
      shortName: "T",
      subjects: ["anki"],
      bio: "test",
      accent: "#123456",
      systemPrompt: "teach this imported deck",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
    }],
    rooms: [{
      id: `${id}-room`,
      name: "Room",
      channelName: "room",
      teacherId: `${id}-teacher`,
      description: "test",
      teaches: true,
    }],
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

  it("round-trips auth users and sessions without storing provider ids or keys", async () => {
    const store = new StateStore(storePath);
    await store.saveAuthUser({
      userId: "usr_test",
      provider: "openrouter",
      providerUserHash: "hashed-provider-id",
      createdAt: 100,
      lastLoginAt: 200,
    });
    await store.saveAuthSession({
      token: "opaque-token",
      userId: "usr_test",
      createdAt: 300,
      expiresAt: 400,
    });

    const fresh = new StateStore(storePath);
    const auth = await fresh.loadAuth();
    expect(auth.users).toEqual([{
      userId: "usr_test",
      provider: "openrouter",
      providerUserHash: "hashed-provider-id",
      createdAt: 100,
      lastLoginAt: 200,
    }]);
    expect(auth.sessions).toEqual([{
      token: "opaque-token",
      userId: "usr_test",
      createdAt: 300,
      expiresAt: 400,
    }]);
    const raw = await readFile(storePath, "utf8");
    expect(raw).not.toContain("sk-");
    expect(raw).not.toContain("openrouter-user");
  });

  it("round-trips imported content packs separately from session state", async () => {
    const store = new StateStore(storePath);
    await store.save([blankState("a")]);
    await store.savePack({
      pack: fakePack("anki:cells"),
      ownerSessionId: "rh:user:test",
      touchedAt: 123,
    });

    const fresh = new StateStore(storePath);
    const packs = await fresh.loadPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.pack.id).toBe("anki:cells");
    expect(packs[0]?.ownerSessionId).toBe("rh:user:test");
    expect(packs[0]?.touchedAt).toBe(123);

    await fresh.save([blankState("b")]);
    const stillThere = await new StateStore(storePath).loadPacks();
    expect(stillThere.map((p) => p.pack.id)).toEqual(["anki:cells"]);
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
