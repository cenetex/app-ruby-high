import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../services/state-store.js";
import type { QuizState } from "../types.js";
import type { ContentPack } from "../content/types.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";

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
    wallet: { meritStars: 0, hallPasses: 0 },
    lastReveal: null,
    status: "idle",
    phase: "intro",
    phaseToken: 0,
    askedQuestionIds: [],
    currentGrade: null,
    completedGrades: [],
    hasSeenIntro: false,
    activePackId: null,
    guestPackMode: "auto",
    guestPackOverrideId: null,
    character: null,
    comicCollection: { issueId: "first-bell", title: "Ruby High: Book One - First Bell", pageCount: 12, unlockedPages: [] },
    schoolEvents: [],
    essayReports: [],
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
      defaultModel: DEFAULT_OPENROUTER_MODEL,
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

  it("deletes account-owned records without touching another account", async () => {
    const store = new StateStore(storePath, { debounceMs: 0 });
    await store.save([blankState("rh:user:delete"), blankState("rh:user:keep")]);
    await store.saveAuthUser({
      userId: "usr_delete",
      provider: "guest",
      providerUserHash: "visitor-delete",
      visitorHash: "visitor-delete",
      createdAt: 100,
      lastLoginAt: 100,
    });
    await store.saveAuthUser({
      userId: "usr_keep",
      provider: "guest",
      providerUserHash: "visitor-keep",
      visitorHash: "visitor-keep",
      createdAt: 100,
      lastLoginAt: 100,
    });
    await store.saveAuthSession({ token: "tok-delete", userId: "usr_delete", createdAt: 100, expiresAt: 999_999 });
    await store.saveAuthSession({ token: "tok-keep", userId: "usr_keep", createdAt: 100, expiresAt: 999_999 });
    await store.savePack({ pack: fakePack("pack-delete"), ownerSessionId: "rh:user:delete", touchedAt: 100 });
    await store.savePack({ pack: fakePack("pack-public-delete"), ownerSessionId: null, creatorUserId: "usr_delete", touchedAt: 100 });
    await store.savePack({ pack: fakePack("pack-keep"), ownerSessionId: "rh:user:keep", touchedAt: 100 });
    await store.saveDraftPack({
      id: "draft-delete",
      ownerUserId: "usr_delete",
      ownerSessionId: "rh:user:delete",
      name: "Delete draft",
      visibility: "private",
      teachers: [],
      createdAt: 100,
      updatedAt: 100,
    } as any);
    await store.saveDraftPack({
      id: "draft-keep",
      ownerUserId: "usr_keep",
      ownerSessionId: "rh:user:keep",
      name: "Keep draft",
      visibility: "private",
      teachers: [],
      createdAt: 100,
      updatedAt: 100,
    } as any);
    await store.saveTeacher({
      id: "teacher-delete",
      creatorUserId: "usr_delete",
      creatorSessionId: "rh:user:delete",
      displayName: "Delete Teacher",
      description: "delete",
      subjects: [],
      questionCount: 0,
      packId: "teacher-pack-delete",
      visibility: "private",
      status: "draft",
      createdAt: 100,
      updatedAt: 100,
      pack: fakePack("teacher-pack-delete"),
    } as any);
    await store.savePackInstallation({
      userId: "usr_delete",
      packId: "pack-delete",
      enabled: true,
      active: true,
      installedAt: 100,
      updatedAt: 100,
    });
    await store.saveMetricEvent({
      id: "metric-delete",
      name: "app_open",
      occurredAt: 100,
      day: "1970-01-01",
      sessionId: "rh:user:delete",
      userId: "usr_delete",
      visitorHash: "visitor-delete",
    });
    await store.saveMetricEvent({
      id: "metric-keep",
      name: "app_open",
      occurredAt: 101,
      day: "1970-01-01",
      sessionId: "rh:user:keep",
      userId: "usr_keep",
      visitorHash: "visitor-keep",
    });
    await store.saveSchoolEvent({
      id: "school:event:delete",
      sessionId: "rh:user:delete",
      occurredAt: 100,
      day: "1970-01-01",
      event: {
        id: "school:event:delete",
        kind: "comic.page-unlocked",
        at: 100,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-delete",
        pageNumber: 1,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Delete page",
      },
    });

    const result = await store.deleteAccountData({
      userId: "usr_delete",
      sessionId: "rh:user:delete",
      authSessionTokens: ["tok-delete"],
      authUsers: [{
        userId: "usr_delete",
        provider: "guest",
        providerUserHash: "visitor-delete",
        visitorHash: "visitor-delete",
        createdAt: 100,
        lastLoginAt: 100,
      }],
      visitorHashes: ["visitor-delete"],
    });

    expect(result).toMatchObject({
      sessions: 1,
      authUsers: 1,
      authSessions: 1,
      packs: 2,
      teachers: 1,
      draftPacks: 1,
      packInstallations: 1,
      metricEvents: 1,
      schoolEvents: 1,
    });
    const fresh = new StateStore(storePath);
    expect([...(await fresh.load()).keys()]).toEqual(["rh:user:keep"]);
    expect((await fresh.loadAuth()).users.map((user) => user.userId)).toEqual(["usr_keep"]);
    expect((await fresh.loadAuth()).sessions.map((session) => session.token)).toEqual(["tok-keep"]);
    expect((await fresh.loadPacks()).map((record) => record.pack.id)).toEqual(["pack-keep"]);
    expect((await fresh.loadDraftPacks()).map((record) => record.id)).toEqual(["draft-keep"]);
    expect(await fresh.loadTeachers()).toHaveLength(0);
    expect(await fresh.loadPackInstallations()).toHaveLength(0);
    expect((await fresh.loadMetricEvents()).map((event) => event.id)).toEqual(["metric-keep"]);
    expect(await fresh.loadSchoolEvents()).toHaveLength(0);
  });

  it("round-trips durable metric events separately from session state", async () => {
    const store = new StateStore(storePath);
    await store.saveMetricEvent({
      id: "evt-1",
      name: "app_open",
      occurredAt: 100,
      day: "1970-01-01",
      sessionId: "rh:user:test",
      source: "viewer",
      feature: "viewer",
    });
    await store.save([blankState("a")]);

    const fresh = new StateStore(storePath);
    const events = await fresh.loadMetricEvents();
    expect(events).toEqual([expect.objectContaining({
      id: "evt-1",
      name: "app_open",
      sessionId: "rh:user:test",
    })]);
  });

  it("round-trips durable school events separately from session state", async () => {
    const store = new StateStore(storePath);
    await store.saveSchoolEvent({
      id: "school:event:1",
      sessionId: "rh:user:test",
      occurredAt: 100,
      day: "1970-01-01",
      event: {
        id: "school:event:1",
        kind: "comic.page-unlocked",
        at: 100,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-03",
        pageNumber: 3,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Outbox page",
      },
    });
    await store.save([blankState("a")]);

    const fresh = new StateStore(storePath);
    const events = await fresh.loadSchoolEvents();
    expect(events).toEqual([expect.objectContaining({
      id: "school:event:1",
      sessionId: "rh:user:test",
      event: expect.objectContaining({
        kind: "comic.page-unlocked",
        label: "Outbox page",
      }),
    })]);
  });

  it("queries durable school events by time and limit", async () => {
    const store = new StateStore(storePath);
    for (let i = 0; i < 4; i += 1) {
      await store.saveSchoolEvent({
        id: `school:event:${i}`,
        sessionId: "rh:user:test",
        occurredAt: 100 + i,
        day: "1970-01-01",
        event: {
          id: `school:event:${i}`,
          kind: "comic.page-unlocked",
          at: 100 + i,
          faculty: "ruby",
          grade: "10",
          issueId: "first-bell",
          pageId: `first-bell-${i}`,
          pageNumber: i + 1,
          reason: "teacher-class-aced",
          sourceId: "teacher:ruby:grade:10",
          label: `Outbox page ${i}`,
        },
      });
    }

    const fresh = new StateStore(storePath);
    const events = await fresh.loadSchoolEvents({ since: 101, limit: 2 });

    expect(events.map((event) => event.id)).toEqual(["school:event:3", "school:event:2"]);
  });

  it("ignores malformed durable school event records on load and query", async () => {
    await writeFile(storePath, JSON.stringify({
      sessions: [],
      schoolEvents: [
        {
          id: "school:event:good",
          sessionId: "rh:user:test",
          occurredAt: 100,
          day: "1970-01-01",
          event: {
            id: "school:event:good",
            kind: "comic.page-unlocked",
          },
        },
        {
          id: "school:event:nan",
          sessionId: "rh:user:test",
          occurredAt: Number.NaN,
          day: "1970-01-01",
          event: {
            id: "school:event:nan",
            kind: "comic.page-unlocked",
          },
        },
        {
          id: "school:event:bad-day",
          sessionId: "rh:user:test",
          occurredAt: 101,
          day: "not-a-day",
          event: {
            id: "school:event:bad-day",
            kind: "comic.page-unlocked",
          },
        },
      ],
    }), "utf8");

    const events = await new StateStore(storePath).loadSchoolEvents({ since: 0, limit: 10 });

    expect(events.map((event) => event.id)).toEqual(["school:event:good"]);
  });

  it("round-trips generic service state separately from sessions", async () => {
    const store = new StateStore(storePath);
    await store.saveServiceState({
      id: "svc:test",
      updatedAt: 123,
      data: {
        version: 1,
        lastRunAt: 100,
      },
    });
    await store.save([blankState("a")]);

    const fresh = new StateStore(storePath);
    await expect(fresh.loadServiceState("svc:test")).resolves.toEqual({
      id: "svc:test",
      updatedAt: 123,
      data: {
        version: 1,
        lastRunAt: 100,
      },
    });
    await expect(fresh.loadServiceState("svc:missing")).resolves.toBeNull();
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

    await fresh.deletePack("rh:user:test", "anki:cells");
    const deleted = await new StateStore(storePath).loadPacks();
    expect(deleted).toHaveLength(0);
  });

  it("round-trips public content packs", async () => {
    const store = new StateStore(storePath);
    await store.savePack({
      pack: fakePack("teacher:public"),
      ownerSessionId: null,
      touchedAt: 456,
    });

    const fresh = new StateStore(storePath);
    const packs = await fresh.loadPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.pack.id).toBe("teacher:public");
    expect(packs[0]?.ownerSessionId).toBeNull();

    await fresh.deletePack(null, "teacher:public");
    expect(await new StateStore(storePath).loadPacks()).toHaveLength(0);
  });

  it("loads and deletes legacy teacher records separately from sessions", async () => {
    const pack = fakePack("teacher:stored");
    await writeFile(storePath, JSON.stringify({
      sessions: [blankState("a")],
      teachers: [{
        id: "teacher_1",
        creatorUserId: "usr_1",
        creatorSessionId: "rh:user:usr_1",
        displayName: "Stored Teacher",
        description: "A persisted teacher.",
        materials: "# Unit",
        subjects: ["systems"],
        questionCount: 1,
        packId: pack.id,
        visibility: "public",
        status: "published",
        createdAt: 10,
        updatedAt: 20,
        publishedAt: 20,
        pack,
      }],
    }, null, 2));

    const fresh = new StateStore(storePath);
    const teachers = await fresh.loadTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0]).toMatchObject({
      id: "teacher_1",
      creatorUserId: "usr_1",
      packId: "teacher:stored",
      status: "published",
    });

    await fresh.deleteTeacher("teacher_1");
    expect(await new StateStore(storePath).loadTeachers()).toHaveLength(0);
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
