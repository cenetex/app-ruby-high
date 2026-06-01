import { describe, it, expect } from "vitest";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import type { QuizState } from "../types.js";
import type {
  AuthSessionRecord,
  AuthUserRecord,
  StoredContentPackRecord,
  StoredDraftContentPackRecord,
  StoredMetricEventRecord,
  StoredPackInstallationRecord,
} from "../services/state-store.js";

function store(ttlSeconds = 0): SqliteStateStore {
  return new SqliteStateStore({ path: ":memory:", ttlSeconds });
}

const session = (id: string, updatedAt = 1): QuizState =>
  ({ sessionId: id, updatedAt } as unknown as QuizState);

describe("SqliteStateStore", () => {
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

  it("round-trips packs, draft packs, installations, metric events", async () => {
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

    await s.savePack(pack);
    await s.saveDraftPack(draft);
    await s.savePackInstallation(install);
    await s.saveMetricEvent(metric);

    expect(await s.loadPacks()).toHaveLength(1);
    expect(await s.loadDraftPacks()).toHaveLength(1);
    expect(await s.loadPackInstallations()).toHaveLength(1);
    expect(await s.loadMetricEvents()).toHaveLength(1);

    await s.deletePack("rh:user:a", "p1");
    await s.deleteDraftPack("d1");
    await s.deletePackInstallation("u1", "p1");
    expect(await s.loadPacks()).toHaveLength(0);
    expect(await s.loadDraftPacks()).toHaveLength(0);
    expect(await s.loadPackInstallations()).toHaveLength(0);
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

  it("bulk save() writes all sessions in one transaction", async () => {
    const s = store();
    await s.save([session("rh:user:x"), session("rh:user:y"), session("rh:user:z")]);
    expect((await s.load()).size).toBe(3);
  });

  it("describe() reports the sqlite path", () => {
    expect(store().describe()).toBe("sqlite://:memory:");
  });
});
