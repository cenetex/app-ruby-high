import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { QuizState } from "../types.js";
import type {
  AuthSessionRecord,
  AuthStoreSnapshot,
  AuthUserRecord,
  StateStoreLike,
  StoredContentPackRecord,
  StoredDraftContentPackRecord,
  StoredMetricEventRecord,
  StoredPackInstallationRecord,
  StoredSchoolEventQuery,
  StoredSchoolEventRecord,
  StoredSessionQuery,
  StoredServiceStateRecord,
  StoredTeacherRecord,
} from "./state-store.js";
import { isStoredMetricEventName, isStoredSchoolEventRecord, querySchoolEventRecords } from "./state-store.js";

/**
 * SQLite-backed state store. One row per record in a single `kv` table,
 * mirroring the single-table design of {@link DynamoStateStore} so a
 * Dynamo→SQLite migration maps key-for-key.
 *
 * Why SQLite on a Fly Volume over DynamoDB:
 *  - No AWS account. Storage lives on the same machine as the app (a mounted
 *    Fly Volume), so the whole stack is one platform — no cross-cloud admin.
 *  - Per-record writes with indexes. A player picking an answer rewrites one
 *    row, not the whole snapshot (the JSON store's weakness).
 *  - Zero native dependency. Uses Node's built-in `node:sqlite` (requires
 *    Node >= 22.5; the Docker base is node:24-slim where it is first-class).
 *  - Durable + backup-friendly. WAL mode + Litestream streaming to Tigris.
 *
 * IMPORTANT: a Fly machine's root filesystem is ephemeral — the DB path MUST
 * live on a mounted Volume (e.g. /data/ruby-high.db) or all state is lost on
 * every deploy. See docs/aws-exit-migration.md.
 *
 * Row schema:
 *   pk         TEXT PRIMARY KEY  — same logical key as the Dynamo `pk`
 *   kind       TEXT NOT NULL     — record discriminator (session, authUser, …)
 *   data       TEXT NOT NULL     — JSON-serialized record
 *   updated_at INTEGER NOT NULL  — ms epoch
 *   expires_at INTEGER           — seconds epoch; NULL = never. Filtered on read.
 */

type Kind =
  | "session"
  | "authUser"
  | "authSession"
  | "contentPack"
  | "teacherRecord"
  | "draftPack"
  | "packInstallation"
  | "metricEvent"
  | "schoolEvent"
  | "serviceState";

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days, matching DynamoStateStore

export interface SqliteStateStoreOptions {
  /** Filesystem path to the SQLite database. Use ":memory:" for tests. */
  path: string;
  /** TTL in seconds — rows expire this long after their last write. 0 disables. */
  ttlSeconds?: number;
}

export class SqliteStateStore implements StateStoreLike {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private readonly ttlSeconds: number;
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SqliteStateStoreOptions) {
    if (!opts.path) throw new Error("SqliteStateStore: path is required");
    this.path = opts.path;
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    if (this.path !== ":memory:") {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
      } catch {
        /* dir may already exist */
      }
    }
    this.db = new DatabaseSync(this.path);
    // WAL: concurrent readers don't block the writer, and it's what Litestream
    // streams. busy_timeout avoids spurious SQLITE_BUSY under brief contention.
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        pk         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS kv_kind ON kv(kind);");
    this.db.exec("CREATE INDEX IF NOT EXISTS kv_kind_updated_at ON kv(kind, updated_at DESC);");
    this.db.exec("CREATE INDEX IF NOT EXISTS kv_expires ON kv(expires_at);");
    this.purgeExpired();
    this.startPeriodicPurge();
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  private rowsOfKind(kind: Kind): unknown[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      "SELECT data FROM kv WHERE kind = ? AND (expires_at IS NULL OR expires_at > ?)",
    );
    const out: unknown[] = [];
    for (const row of stmt.all(kind, nowSec) as Array<{ data: string }>) {
      try {
        out.push(JSON.parse(row.data));
      } catch {
        /* skip malformed row */
      }
    }
    return out;
  }

  async load(): Promise<Map<string, QuizState>> {
    this.purgeExpired();
    const map = new Map<string, QuizState>();
    for (const value of this.rowsOfKind("session")) {
      const state = value as QuizState;
      if (state && typeof state.sessionId === "string") map.set(state.sessionId, state);
    }
    return map;
  }

  async loadRecentSessions(query: StoredSessionQuery = {}): Promise<Map<string, QuizState>> {
    this.purgeExpired();
    const since = Number.isFinite(query.since) ? Math.floor(Number(query.since)) : 0;
    const limit = Number.isFinite(query.limit) ? Math.max(0, Math.floor(Number(query.limit))) : 1000;
    const map = new Map<string, QuizState>();
    if (limit <= 0) return map;
    const nowSec = Math.floor(Date.now() / 1000);
    const rows = this.db.prepare(
      "SELECT data FROM kv WHERE kind = 'session' AND updated_at >= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY updated_at DESC, pk DESC LIMIT ?",
    ).all(since, nowSec, limit);
    for (const row of rows as Array<{ data: string }>) {
      try {
        const state = JSON.parse(row.data) as QuizState;
        if (state && typeof state.sessionId === "string") map.set(state.sessionId, state);
      } catch {
        /* skip malformed row */
      }
    }
    return map;
  }

  async loadAuth(): Promise<AuthStoreSnapshot> {
    const users: AuthUserRecord[] = [];
    for (const value of this.rowsOfKind("authUser")) {
      const u = value as AuthUserRecord;
      if (
        u &&
        (u.provider === "openrouter" || u.provider === "guest" || u.provider === "privy") &&
        typeof u.providerUserHash === "string" &&
        typeof u.userId === "string"
      ) {
        users.push(u);
      }
    }
    const sessions: AuthSessionRecord[] = [];
    for (const value of this.rowsOfKind("authSession")) {
      const s = value as AuthSessionRecord;
      if (
        s &&
        typeof s.token === "string" &&
        typeof s.userId === "string" &&
        typeof s.createdAt === "number" &&
        typeof s.expiresAt === "number"
      ) {
        sessions.push(s);
      }
    }
    return { users, sessions };
  }

  async loadPacks(): Promise<StoredContentPackRecord[]> {
    const records: StoredContentPackRecord[] = [];
    for (const value of this.rowsOfKind("contentPack")) {
      const r = value as StoredContentPackRecord;
      if (
        r &&
        r.pack &&
        typeof r.pack.id === "string" &&
        (typeof r.ownerSessionId === "string" || r.ownerSessionId === null) &&
        typeof r.touchedAt === "number"
      ) {
        records.push(r);
      }
    }
    return records;
  }

  async loadTeachers(): Promise<StoredTeacherRecord[]> {
    const records: StoredTeacherRecord[] = [];
    for (const value of this.rowsOfKind("teacherRecord")) {
      const r = value as StoredTeacherRecord;
      if (
        r &&
        typeof r.id === "string" &&
        typeof r.creatorUserId === "string" &&
        typeof r.creatorSessionId === "string" &&
        typeof r.displayName === "string" &&
        typeof r.packId === "string" &&
        r.pack &&
        r.pack.id === r.packId &&
        (r.status === "draft" || r.status === "published") &&
        (r.visibility === "private" || r.visibility === "unlisted" || r.visibility === "public")
      ) {
        records.push(r);
      }
    }
    return records;
  }

  async loadDraftPacks(): Promise<StoredDraftContentPackRecord[]> {
    const records: StoredDraftContentPackRecord[] = [];
    for (const value of this.rowsOfKind("draftPack")) {
      const r = value as StoredDraftContentPackRecord;
      if (
        r &&
        typeof r.id === "string" &&
        typeof r.ownerUserId === "string" &&
        typeof r.ownerSessionId === "string" &&
        typeof r.name === "string" &&
        (r.visibility === "private" || r.visibility === "unlisted" || r.visibility === "public") &&
        Array.isArray(r.teachers)
      ) {
        records.push(r);
      }
    }
    return records;
  }

  async loadPackInstallations(): Promise<StoredPackInstallationRecord[]> {
    const records: StoredPackInstallationRecord[] = [];
    for (const value of this.rowsOfKind("packInstallation")) {
      const r = value as StoredPackInstallationRecord;
      if (
        r &&
        typeof r.userId === "string" &&
        typeof r.packId === "string" &&
        typeof r.enabled === "boolean" &&
        typeof r.active === "boolean"
      ) {
        records.push(r);
      }
    }
    return records;
  }

  async loadMetricEvents(): Promise<StoredMetricEventRecord[]> {
    const records: StoredMetricEventRecord[] = [];
    for (const value of this.rowsOfKind("metricEvent")) {
      const r = value as StoredMetricEventRecord;
      if (
        r &&
        typeof r.id === "string" &&
        isStoredMetricEventName(r.name) &&
        typeof r.occurredAt === "number" &&
        typeof r.day === "string"
      ) {
        records.push(r);
      }
    }
    return records;
  }

  async loadSchoolEvents(query: StoredSchoolEventQuery = {}): Promise<StoredSchoolEventRecord[]> {
    const records: StoredSchoolEventRecord[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const rows = this.db.prepare(
      "SELECT data FROM kv WHERE kind = 'schoolEvent' AND (expires_at IS NULL OR expires_at > ?)",
    ).all(nowSec);
    for (const row of rows as Array<{ data: string }>) {
      let value: unknown;
      try {
        value = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (isStoredSchoolEventRecord(value)) {
        records.push(value);
      }
    }
    return querySchoolEventRecords(records, query);
  }

  async loadServiceState(id: string): Promise<StoredServiceStateRecord | null> {
    const pk = `service-state:${encodeURIComponent(id)}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const row = this.db
      .prepare("SELECT data FROM kv WHERE pk = ? AND kind = 'serviceState' AND (expires_at IS NULL OR expires_at > ?)")
      .get(pk, nowSec) as { data?: string } | undefined;
    if (!row?.data) return null;
    try {
      const record = JSON.parse(row.data) as StoredServiceStateRecord;
      if (
        record &&
        record.id === id &&
        typeof record.updatedAt === "number" &&
        record.data &&
        typeof record.data === "object" &&
        !Array.isArray(record.data)
      ) {
        return record;
      }
    } catch {
      /* skip malformed row */
    }
    return null;
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  private put(pk: string, kind: Kind, data: unknown, updatedAt: number | undefined, expiresAtSec: number | null): void {
    // node:sqlite rejects `undefined`/NaN binds. Records may omit their
    // timestamp (legacy/partial states), so coerce defensively.
    const ts = Number.isFinite(updatedAt) ? Math.floor(updatedAt as number) : Date.now();
    const exp = expiresAtSec != null && Number.isFinite(expiresAtSec) ? Math.floor(expiresAtSec) : null;
    this.db
      .prepare("INSERT OR REPLACE INTO kv (pk, kind, data, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(pk, kind, JSON.stringify(data), ts, exp);
  }

  /** Default TTL expiry (seconds epoch), or null when TTL is disabled. */
  private defaultExpiry(): number | null {
    return this.ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + this.ttlSeconds : null;
  }

  async saveSession(state: QuizState): Promise<void> {
    this.put(state.sessionId, "session", state, state.updatedAt ?? Date.now(), this.defaultExpiry());
  }

  async saveAuthUser(user: AuthUserRecord): Promise<void> {
    this.put(`auth:user:${user.provider}:${user.providerUserHash}`, "authUser", user, Date.now(), null);
  }

  async saveAuthSession(session: AuthSessionRecord): Promise<void> {
    this.put(`auth:session:${session.token}`, "authSession", session, Date.now(), Math.floor(session.expiresAt / 1000));
  }

  async savePack(record: StoredContentPackRecord): Promise<void> {
    this.put(this.packPk(record.ownerSessionId, record.pack.id), "contentPack", record, record.touchedAt, this.defaultExpiry());
  }

  async saveDraftPack(record: StoredDraftContentPackRecord): Promise<void> {
    this.put(`draft-pack:${encodeURIComponent(record.id)}`, "draftPack", record, record.updatedAt, this.defaultExpiry());
  }

  async savePackInstallation(record: StoredPackInstallationRecord): Promise<void> {
    this.put(this.packInstallationPk(record.userId, record.packId), "packInstallation", record, record.updatedAt, null);
  }
  async saveTeacher(record: StoredTeacherRecord): Promise<void> {
    this.put("teacher:" + encodeURIComponent(record.id), "teacherRecord", record, record.updatedAt, this.defaultExpiry());
  }

  async saveMetricEvent(record: StoredMetricEventRecord): Promise<void> {
    this.put(`metric-event:${record.day}:${encodeURIComponent(record.id)}`, "metricEvent", record, record.occurredAt, this.defaultExpiry());
  }

  async saveSchoolEvent(record: StoredSchoolEventRecord): Promise<void> {
    this.put(`school-event:${record.day}:${encodeURIComponent(record.id)}`, "schoolEvent", record, record.occurredAt, this.defaultExpiry());
  }

  async saveServiceState(record: StoredServiceStateRecord): Promise<void> {
    this.put(`service-state:${encodeURIComponent(record.id)}`, "serviceState", record, record.updatedAt, null);
  }

  /** Bulk write — used by tests / migrations. Wrapped in a single transaction. */
  async save(states: Iterable<QuizState>): Promise<void> {
    const list = Array.from(states);
    if (list.length === 0) return;
    const expiry = this.defaultExpiry();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO kv (pk, kind, data, updated_at, expires_at) VALUES (?, 'session', ?, ?, ?)",
    );
    this.db.exec("BEGIN");
    try {
      for (const state of list) {
        stmt.run(state.sessionId, JSON.stringify(state), state.updatedAt ?? Date.now(), expiry);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── deletes ────────────────────────────────────────────────────────────────

  private delete(pk: string): void {
    this.db.prepare("DELETE FROM kv WHERE pk = ?").run(pk);
  }

  async deletePack(ownerSessionId: string | null, packId: string): Promise<void> {
    this.delete(this.packPk(ownerSessionId, packId));
  }

  async deleteTeacher(teacherId: string): Promise<void> {
    this.delete(`teacher:${encodeURIComponent(teacherId)}`);
  }

  async deleteDraftPack(draftId: string): Promise<void> {
    this.delete(`draft-pack:${encodeURIComponent(draftId)}`);
  }

  async deletePackInstallation(userId: string, packId: string): Promise<void> {
    this.delete(this.packInstallationPk(userId, packId));
  }

  async deleteAuthSession(token: string): Promise<void> {
    this.delete(`auth:session:${token}`);
  }

  // ── housekeeping ─────────────────────────────────────────────────────────────

  /** node:sqlite writes are synchronous and durable on return, so there's
   *  nothing to drain — flush is a no-op kept for interface symmetry. */
  async flush(): Promise<void> {}

  /** Remove expired rows. Called on open; cheap given the kv_expires index. */
  private purgeExpired(): void {
    this.db
      .prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(Math.floor(Date.now() / 1000));
  }
  /** Run purgeExpired on a periodic interval so rows don't accumulate over
   *  long-lived process runs. Every 15 minutes is frequent enough to keep
   *  the table lean without material overhead (the kv_expires index makes
   *  the query cheap). Skipped for :memory: databases (tests). */
  private startPeriodicPurge(): void {
    if (this.path === ":memory:") return;
    const FIFTEEN_MINUTES = 15 * 60 * 1000;
    this.purgeInterval = setInterval(() => this.purgeExpired(), FIFTEEN_MINUTES);
    if (typeof this.purgeInterval.unref === "function") this.purgeInterval.unref();
  }

  close(): void {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }
    this.db.close();
  }

  describe(): string {
    return `sqlite://${this.path}`;
  }

  private packPk(ownerSessionId: string | null, packId: string): string {
    return `pack:${encodeURIComponent(ownerSessionId ?? "public")}:${encodeURIComponent(packId)}`;
  }

  private packInstallationPk(userId: string, packId: string): string {
    return `pack-installation:${encodeURIComponent(userId)}:${encodeURIComponent(packId)}`;
  }
}
