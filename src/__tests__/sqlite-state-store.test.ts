import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import type { QuizState } from "../types.js";
import type {
  AuthSessionRecord,
  AuthUserRecord,
  StoredContentPackRecord,
  StoredTeacherRecord,
  StoredDraftContentPackRecord,
  StoredMetricEventRecord,
  StoredPackInstallationRecord,
  StoredSchoolEventRecord,
  StoredServiceStateRecord,
} from "../services/state-store.js";

function store(ttlSeconds = 0): SqliteStateStore {
  return new SqliteStateStore({ path: ":memory:", ttlSeconds });
}

const session = (id: string, updatedAt = 1): QuizState =>
  ({ sessionId: id, updatedAt } as unknown as QuizState);

describe("SqliteStateStore", () => {
  it("creates database files with owner-only filesystem permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-sqlite-mode-"));
    const path = join(dir, "state.db");
    const s = new SqliteStateStore({ path, ttlSeconds: 0 });
    try {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      s.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips sessions", async () => {
    const s = store();
    await s.saveSession(session("rh:user:a", 10));
    await s.saveSession(session("rh:user:b", 20));
    const loaded = await s.load();
    expect([...loaded.keys()].sort()).toEqual(["rh:user:a", "rh:user:b"]);
    // INSERT OR REPLACE updates in place (no duplicate row).
    await s.saveSession(session("rh:user:a", 99));
    expect((await s.load()).size).toBe(2);
  });

  it("loads recent sessions by indexed updated time", async () => {
    const s = store();
    await s.saveSession(session("rh:user:old", 10));
    await s.saveSession(session("rh:user:middle-a", 20));
    await s.saveSession(session("rh:user:middle-b", 20));
    await s.saveSession(session("rh:user:new", 30));

    const loaded = await s.loadRecentSessions({ since: 20, limit: 2 });

    expect([...loaded.keys()]).toEqual(["rh:user:new", "rh:user:middle-b"]);
  });

  it("round-trips auth users and sessions", async () => {
    const s = store();
    const user: AuthUserRecord = {
      provider: "guest",
      providerUserHash: "hash1",
      userId: "u1",
    } as AuthUserRecord;
    const authSession: AuthSessionRecord = {
      token: "tok1",
      userId: "u1",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    } as AuthSessionRecord;
    await s.saveAuthUser(user);
    await s.saveAuthSession(authSession);
    const auth = await s.loadAuth();
    expect(auth.users).toHaveLength(1);
    expect(auth.sessions).toHaveLength(1);
    expect(auth.sessions[0]?.token).toBe("tok1");
    await s.deleteAuthSession("tok1");
    expect((await s.loadAuth()).sessions).toHaveLength(0);
  });

  it("deletes all rows owned by an account", async () => {
    const s = store();
    await s.saveSession(session("rh:user:delete", 10));
    await s.saveSession(session("rh:user:keep", 20));
    await s.saveAuthUser({
      provider: "guest",
      providerUserHash: "visitor-delete",
      visitorHash: "visitor-delete",
      userId: "u-delete",
      createdAt: 1,
      lastLoginAt: 1,
    } as AuthUserRecord);
    await s.saveAuthUser({
      provider: "guest",
      providerUserHash: "visitor-keep",
      visitorHash: "visitor-keep",
      userId: "u-keep",
      createdAt: 1,
      lastLoginAt: 1,
    } as AuthUserRecord);
    await s.saveAuthSession({ token: "tok-delete", userId: "u-delete", createdAt: 1, expiresAt: Date.now() + 60_000 });
    await s.saveAuthSession({ token: "tok-keep", userId: "u-keep", createdAt: 1, expiresAt: Date.now() + 60_000 });
    await s.savePack({ pack: { id: "pack-delete" }, ownerSessionId: "rh:user:delete", touchedAt: 5 } as unknown as StoredContentPackRecord);
    await s.savePack({ pack: { id: "pack-keep" }, ownerSessionId: "rh:user:keep", touchedAt: 5 } as unknown as StoredContentPackRecord);
    await s.saveDraftPack({
      id: "draft-delete",
      ownerUserId: "u-delete",
      ownerSessionId: "rh:user:delete",
      name: "Draft",
      visibility: "private",
      teachers: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as StoredDraftContentPackRecord);
    await s.savePackInstallation({
      userId: "u-delete",
      packId: "pack-delete",
      enabled: true,
      active: true,
      installedAt: 1,
      updatedAt: 1,
    } as unknown as StoredPackInstallationRecord);
    await s.saveMetricEvent({
      id: "metric-delete",
      name: "app_open",
      occurredAt: 9,
      day: "2026-05-31",
      sessionId: "rh:user:delete",
      userId: "u-delete",
      visitorHash: "visitor-delete",
    } as StoredMetricEventRecord);
    await s.saveMetricEvent({
      id: "metric-keep",
      name: "app_open",
      occurredAt: 10,
      day: "2026-05-31",
      sessionId: "rh:user:keep",
      userId: "u-keep",
      visitorHash: "visitor-keep",
    } as StoredMetricEventRecord);
    await s.saveSchoolEvent({
      id: "school:event:delete",
      sessionId: "rh:user:delete",
      occurredAt: 9,
      day: "2026-05-31",
      event: {
        id: "school:event:delete",
        kind: "comic.page-unlocked",
        at: 9,
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

    const result = await s.deleteAccountData({
      userId: "u-delete",
      sessionId: "rh:user:delete",
      authSessionTokens: ["tok-delete"],
      authUsers: [{
        provider: "guest",
        providerUserHash: "visitor-delete",
        visitorHash: "visitor-delete",
        userId: "u-delete",
        createdAt: 1,
        lastLoginAt: 1,
      }],
      visitorHashes: ["visitor-delete"],
    });

    expect(result).toMatchObject({
      sessions: 1,
      authUsers: 1,
      authSessions: 1,
      packs: 1,
      draftPacks: 1,
      packInstallations: 1,
      metricEvents: 1,
      schoolEvents: 1,
    });
    expect([...(await s.load()).keys()]).toEqual(["rh:user:keep"]);
    expect((await s.loadAuth()).users.map((user) => user.userId)).toEqual(["u-keep"]);
    expect((await s.loadAuth()).sessions.map((authSession) => authSession.token)).toEqual(["tok-keep"]);
    expect((await s.loadPacks()).map((record) => record.pack.id)).toEqual(["pack-keep"]);
    expect(await s.loadDraftPacks()).toHaveLength(0);
    expect(await s.loadPackInstallations()).toHaveLength(0);
    expect((await s.loadMetricEvents()).map((event) => event.id)).toEqual(["metric-keep"]);
    expect(await s.loadSchoolEvents()).toHaveLength(0);
  });

  it("round-trips packs, draft packs, installations, metric events, service state", async () => {
    const s = store();
    const pack: StoredContentPackRecord = {
      pack: { id: "p1" },
      ownerSessionId: "rh:user:a",
      touchedAt: 5,
    } as unknown as StoredContentPackRecord;
    const draft: StoredDraftContentPackRecord = {
      id: "d1",
      ownerUserId: "u1",
      ownerSessionId: "rh:user:a",
      name: "Draft",
      visibility: "private",
      teachers: [],
    } as unknown as StoredDraftContentPackRecord;
    const install: StoredPackInstallationRecord = {
      userId: "u1",
      packId: "p1",
      enabled: true,
      active: true,
      updatedAt: 7,
    } as unknown as StoredPackInstallationRecord;
    const metric: StoredMetricEventRecord = {
      id: "m1",
      name: "app_open",
      occurredAt: 9,
      day: "2026-05-31",
    } as StoredMetricEventRecord;
    const schoolEvent: StoredSchoolEventRecord = {
      id: "school:event:sqlite",
      sessionId: "rh:user:a",
      occurredAt: 9,
      day: "2026-05-31",
      event: {
        id: "school:event:sqlite",
        kind: "comic.page-unlocked",
        at: 9,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-02",
        pageNumber: 2,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "SQLite page",
      },
    };
    const serviceState: StoredServiceStateRecord = {
      id: "svc:test",
      updatedAt: 10,
      data: {
        version: 1,
        lastRunAt: 9,
      },
    };

    await s.savePack(pack);
    await s.saveDraftPack(draft);
    await s.savePackInstallation(install);
    await s.saveMetricEvent(metric);
    await s.saveSchoolEvent(schoolEvent);
    await s.saveServiceState(serviceState);

    expect(await s.loadPacks()).toHaveLength(1);
    expect(await s.loadDraftPacks()).toHaveLength(1);
    expect(await s.loadPackInstallations()).toHaveLength(1);
    expect(await s.loadMetricEvents()).toHaveLength(1);
    expect(await s.loadSchoolEvents()).toEqual([schoolEvent]);
    expect(await s.loadServiceState("svc:test")).toEqual(serviceState);
    expect(await s.loadServiceState("svc:missing")).toBeNull();

    await s.deletePack("rh:user:a", "p1");
    await s.deleteDraftPack("d1");
    await s.deletePackInstallation("u1", "p1");
    expect(await s.loadPacks()).toHaveLength(0);
    expect(await s.loadDraftPacks()).toHaveLength(0);
    expect(await s.loadPackInstallations()).toHaveLength(0);
  });

  it("queries school events newest-first with since and limit", async () => {
    const s = store();
    for (let i = 0; i < 5; i += 1) {
      await s.saveSchoolEvent({
        id: `school:event:sqlite:${i}`,
        sessionId: "rh:user:a",
        occurredAt: 100 + i,
        day: "2026-05-31",
        event: {
          id: `school:event:sqlite:${i}`,
          kind: "comic.page-unlocked",
          at: 100 + i,
          faculty: "ruby",
          grade: "10",
          issueId: "first-bell",
          pageId: `first-bell-sqlite-${i}`,
          pageNumber: i + 1,
          reason: "teacher-class-aced",
          sourceId: "teacher:ruby:grade:10",
          label: `SQLite page ${i}`,
        },
      });
    }

    const events = await s.loadSchoolEvents({ since: 102, limit: 2 });

    expect(events.map((event) => event.id)).toEqual([
      "school:event:sqlite:4",
      "school:event:sqlite:3",
    ]);
  });

  it("queries school events by durable occurredAt rather than row update time", async () => {
    const s = store();
    const db = (s as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
    const insert = db.prepare("INSERT INTO kv (pk, kind, data, updated_at, expires_at) VALUES (?, 'schoolEvent', ?, ?, NULL)");
    insert.run("school-event:old-row-new-event", JSON.stringify({
      id: "school:event:old-row-new-event",
      sessionId: "rh:user:a",
      occurredAt: 500,
      day: "2026-05-31",
      event: {
        id: "school:event:old-row-new-event",
        kind: "comic.page-unlocked",
        at: 500,
      },
    }), 100);
    insert.run("school-event:new-row-old-event", JSON.stringify({
      id: "school:event:new-row-old-event",
      sessionId: "rh:user:a",
      occurredAt: 100,
      day: "2026-05-31",
      event: {
        id: "school:event:new-row-old-event",
        kind: "comic.page-unlocked",
        at: 100,
      },
    }), 500);

    const events = await s.loadSchoolEvents({ since: 400, limit: 5 });

    expect(events.map((event) => event.id)).toEqual(["school:event:old-row-new-event"]);
  });

  it("ignores malformed stored school event rows", async () => {
    const s = store();
    const db = (s as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
    const insert = db.prepare("INSERT INTO kv (pk, kind, data, updated_at, expires_at) VALUES (?, 'schoolEvent', ?, ?, NULL)");
    insert.run("school-event:good", JSON.stringify({
      id: "school:event:good",
      sessionId: "rh:user:a",
      occurredAt: 100,
      day: "2026-05-31",
      event: {
        id: "school:event:good",
        kind: "comic.page-unlocked",
      },
    }), 100);
    insert.run("school-event:bad-time", JSON.stringify({
      id: "school:event:bad-time",
      sessionId: "rh:user:a",
      occurredAt: null,
      day: "2026-05-31",
      event: {
        id: "school:event:bad-time",
        kind: "comic.page-unlocked",
      },
    }), 101);
    insert.run("school-event:bad-day", JSON.stringify({
      id: "school:event:bad-day",
      sessionId: "rh:user:a",
      occurredAt: 102,
      day: "soon",
      event: {
        id: "school:event:bad-day",
        kind: "comic.page-unlocked",
      },
    }), 102);

    const events = await s.loadSchoolEvents({ since: 0, limit: 10 });

    expect(events.map((event) => event.id)).toEqual(["school:event:good"]);
  });

  it("excludes expired rows via TTL", async () => {
    const s = store(60); // 60s TTL on sessions
    await s.saveSession(session("rh:user:fresh"));
    // An auth session whose own expiry is in the past must not load.
    await s.saveAuthSession({
      token: "expired",
      userId: "u1",
      createdAt: 1,
      expiresAt: Date.now() - 10_000,
    } as AuthSessionRecord);
    expect((await s.load()).size).toBe(1);
    expect((await s.loadAuth()).sessions).toHaveLength(0);
  });

  
  it("round-trips teacher records", async () => {
    const s = store();
    const teacher: StoredTeacherRecord = {
      id: "t1",
      creatorUserId: "u1",
      creatorSessionId: "s1",
      displayName: "Prof. Test",
      description: "A test teacher",
      materials: "Some materials",
      subjects: ["math"],
      questionCount: 5,
      packId: "p1",
      visibility: "public",
      status: "published",
      createdAt: 1,
      updatedAt: 1,
      pack: { id: "p1", teachers: [] },
    } as unknown as StoredTeacherRecord;

    await s.saveTeacher(teacher);
    const teachers = await s.loadTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0]?.id).toBe("t1");
    expect(teachers[0]?.displayName).toBe("Prof. Test");

    await s.deleteTeacher("t1");
    expect(await s.loadTeachers()).toHaveLength(0);
  });

  it("bulk save() writes all sessions in one transaction", async () => {
    const s = store();
    await s.save([session("rh:user:x"), session("rh:user:y"), session("rh:user:z")]);
    expect((await s.load()).size).toBe(3);
  });

  it("describe() reports the sqlite path", () => {
    expect(store().describe()).toBe("sqlite://:memory:");
  });
});
