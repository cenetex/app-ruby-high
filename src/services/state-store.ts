import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { QuizState } from "../types.js";
import type { ContentPack } from "../content/types.js";

export interface AuthUserRecord {
  userId: string;
  provider: "openrouter" | "guest";
  providerUserHash: string;
  createdAt: number;
  lastLoginAt: number;
  label?: string;
}

export interface AuthSessionRecord {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthStoreSnapshot {
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
}

export interface StoredContentPackRecord {
  pack: ContentPack;
  ownerSessionId: string;
  touchedAt: number;
}

/**
 * Common shape every state-store backend implements. RubyHighService talks
 * to this abstraction; the JSON-file backend (this file) and the DynamoDB
 * backend (dynamo-state-store.ts) both fit the same surface, so the rest
 * of the app doesn't care which is mounted.
 *
 * Two save paths:
 *   - saveSession(state)   — persist one session. Preferred — DynamoDB only
 *                             writes one item, JSON file rewrites the full
 *                             snapshot (it has no other choice).
 *   - save(states)         — persist all sessions at once. Used for full
 *                             snapshots and tests; the DynamoDB backend
 *                             chunks via BatchWrite.
 *
 * Backends MAY debounce per-mutation writes (the JSON backend does, since
 * one round can fire multiple `void saveSession()` calls in quick succession
 * and they all rewrite the same file). `flush()` drains any pending writes
 * synchronously — call it from awaited HTTP paths so the response doesn't
 * wait for the debounce window.
 */
export interface StateStoreLike {
  load(): Promise<Map<string, QuizState>>;
  loadAuth(): Promise<AuthStoreSnapshot>;
  loadPacks(): Promise<StoredContentPackRecord[]>;
  saveSession(state: QuizState): Promise<void>;
  saveAuthUser(user: AuthUserRecord): Promise<void>;
  saveAuthSession(session: AuthSessionRecord): Promise<void>;
  savePack(record: StoredContentPackRecord): Promise<void>;
  deleteAuthSession(token: string): Promise<void>;
  save(states: Iterable<QuizState>): Promise<void>;
  describe(): string;
  /** Optional: drain any debounced writes immediately. No-op for backends
   *  that don't debounce. Returning the writeChain lets callers `await` it
   *  to know all in-flight writes have landed. */
  flush?(): Promise<void>;
}

/**
 * JSON-file persistence: a single ~/.ruby-high/state.json snapshot, written
 * atomically via tmp-file + rename. Default backend for local dev. Behind
 * the same StateStoreLike interface as DynamoStateStore so RubyHighService
 * doesn't need to know which it's talking to.
 *
 * Limitations:
 *  - Single-process. Concurrent processes would race on the file.
 *  - Single-machine. The container's filesystem is the storage.
 *  - saveSession() rewrites the whole file — fine for small session counts,
 *    but DynamoStateStore is the right choice once state matters across
 *    deploys or instances.
 */
export class StateStore implements StateStoreLike {
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();
  /** Newest snapshot we know about, kept in memory so saveSession() can
   *  rewrite the full file without forcing the caller to pass everything.
   *  Updated on load() and on every save()/saveSession(). */
  private snapshot = new Map<string, QuizState>();
  private authUsers = new Map<string, AuthUserRecord>();
  private authSessions = new Map<string, AuthSessionRecord>();
  private importedPacks = new Map<string, StoredContentPackRecord>();

  // Debounced-write batching. Per-mutation calls (saveSession, saveAuthUser,
  // savePack, deleteAuthSession) all rewrite the same file, so we coalesce
  // them: the first call schedules a timer, subsequent calls within the
  // window join the same pending promise, and the timer flushes one write.
  // `save()` and `flush()` short-circuit the timer to issue the write now.
  private readonly debounceMs: number;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPromise: Promise<void> | null = null;
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;

  constructor(path?: string, opts?: { debounceMs?: number }) {
    this.path =
      path ??
      process.env.RUBY_HIGH_STATE_PATH ??
      resolve(homedir(), ".ruby-high", "state.json");
    this.debounceMs = opts?.debounceMs ?? readDebounceMsFromEnv();
  }

  async load(): Promise<Map<string, QuizState>> {
    const parsed = await this.readFileSnapshot();
    if (!parsed) return new Map();
    this.applyParsedSnapshot(parsed);
    return new Map(this.snapshot);
  }

  async loadAuth(): Promise<AuthStoreSnapshot> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return {
      users: Array.from(this.authUsers.values()),
      sessions: Array.from(this.authSessions.values()),
    };
  }

  async loadPacks(): Promise<StoredContentPackRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.importedPacks.values());
  }

  private async readFileSnapshot(): Promise<{
    sessions?: QuizState[];
    authUsers?: AuthUserRecord[];
    authSessions?: AuthSessionRecord[];
    packs?: StoredContentPackRecord[];
  } | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as {
          sessions?: QuizState[];
          authUsers?: AuthUserRecord[];
          authSessions?: AuthSessionRecord[];
          packs?: StoredContentPackRecord[];
        };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.snapshot = new Map();
        this.authUsers = new Map();
        this.authSessions = new Map();
        this.importedPacks = new Map();
        return null;
      }
      throw err;
    }
  }

  private applyParsedSnapshot(parsed: {
    sessions?: QuizState[];
    authUsers?: AuthUserRecord[];
    authSessions?: AuthSessionRecord[];
    packs?: StoredContentPackRecord[];
  }): void {
    const sessions = new Map<string, QuizState>();
    for (const s of parsed.sessions ?? []) {
      if (s && typeof s.sessionId === "string") sessions.set(s.sessionId, s);
    }
    const authUsers = new Map<string, AuthUserRecord>();
    for (const u of parsed.authUsers ?? []) {
      if (
        u &&
        (u.provider === "openrouter" || u.provider === "guest") &&
        typeof u.providerUserHash === "string" &&
        typeof u.userId === "string"
      ) {
        authUsers.set(authUserKey(u.provider, u.providerUserHash), u);
      }
    }
    const authSessions = new Map<string, AuthSessionRecord>();
    for (const s of parsed.authSessions ?? []) {
      if (
        s &&
        typeof s.token === "string" &&
        typeof s.userId === "string" &&
        typeof s.createdAt === "number" &&
        typeof s.expiresAt === "number"
      ) {
        authSessions.set(s.token, s);
      }
    }
    const importedPacks = new Map<string, StoredContentPackRecord>();
    for (const r of parsed.packs ?? []) {
      if (
        r &&
        r.pack &&
        typeof r.pack.id === "string" &&
        typeof r.ownerSessionId === "string" &&
        typeof r.touchedAt === "number"
      ) {
        importedPacks.set(packRecordKey(r.ownerSessionId, r.pack.id), r);
      }
    }
    this.snapshot = sessions;
    this.authUsers = authUsers;
    this.authSessions = authSessions;
    this.importedPacks = importedPacks;
  }

  /**
   * Serializes writes through a single promise chain so concurrent saves
   * don't tear the file. Each save replaces the file atomically.
   *
   * The `.catch` before `.then` is load-bearing: without it, a single failed
   * write would poison `writeChain` forever (every subsequent `.then(...)`
   * inherits the rejection), and since callers `void` the returned promise
   * the failure becomes an unhandled rejection rather than a logged error.
   * The catch lets the chain recover so the next save tries again, and we
   * surface the error to stderr so operators have something to find.
   */
  save(states: Iterable<QuizState>): Promise<void> {
    const snapshot = Array.from(states);
    // Update our in-memory snapshot before scheduling the write so
    // saveSession() that lands later sees the right baseline.
    this.snapshot = new Map(snapshot.map((s) => [s.sessionId, s]));
    // save() is the explicit "write everything now" path — supersede any
    // pending debounced write and resolve its waiters from this same write.
    return this.writeNow();
  }

  /** JSON-file mode: rewriting one session means rewriting the whole file
   *  (it's a single document). We use the in-memory snapshot updated by
   *  prior load()/save() calls, replace the one entry, and write the lot.
   *  For DynamoDB this same method writes only one item.
   *
   *  Calls within the debounce window coalesce into one file write — every
   *  caller gets a promise that resolves when that write completes. */
  saveSession(state: QuizState): Promise<void> {
    this.snapshot.set(state.sessionId, state);
    return this.scheduleWrite();
  }

  saveAuthUser(user: AuthUserRecord): Promise<void> {
    this.authUsers.set(authUserKey(user.provider, user.providerUserHash), user);
    return this.scheduleWrite();
  }

  saveAuthSession(session: AuthSessionRecord): Promise<void> {
    this.authSessions.set(session.token, session);
    return this.scheduleWrite();
  }

  savePack(record: StoredContentPackRecord): Promise<void> {
    this.importedPacks.set(packRecordKey(record.ownerSessionId, record.pack.id), record);
    return this.scheduleWrite();
  }

  deleteAuthSession(token: string): Promise<void> {
    if (!this.authSessions.has(token)) return Promise.resolve();
    this.authSessions.delete(token);
    return this.scheduleWrite();
  }

  describe(): string {
    return this.path;
  }

  /** Drain any pending debounced write right now and wait for everything
   *  on the writeChain to land. Awaited HTTP paths (flushSession) call this
   *  so the response doesn't wait for the debounce window. */
  flush(): Promise<void> {
    if (this.pendingTimer || this.pendingPromise) {
      return this.writeNow();
    }
    return this.writeChain;
  }

  /** Schedule a debounced write. Multiple callers within the window share
   *  one promise + one file write. */
  private scheduleWrite(): Promise<void> {
    if (!this.pendingPromise) {
      this.pendingPromise = new Promise<void>((resolve, reject) => {
        this.pendingResolve = resolve;
        this.pendingReject = reject;
      });
    }
    if (this.debounceMs <= 0) {
      // Effectively immediate but still coalesces synchronous bursts:
      // queueMicrotask drains the current sync stack first, so multiple
      // void saveSession() in the same tick fold into one write.
      if (!this.pendingTimer) {
        this.pendingTimer = setTimeout(() => this.writeNow(), 0);
        if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
      }
    } else if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => this.writeNow(), this.debounceMs);
      if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
    }
    return this.pendingPromise;
  }

  /** Force the pending (or no) debounced write through writeChain now and
   *  return a promise that observes its outcome. Adopts any pending resolvers
   *  so debounce-batched callers see this write's success/failure. */
  private writeNow(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const resolve = this.pendingResolve;
    const reject = this.pendingReject;
    this.pendingPromise = null;
    this.pendingResolve = null;
    this.pendingReject = null;

    const next = this.writeChain.catch(() => {}).then(async () => {
      await this.writeCurrentSnapshot();
    });
    // Log + swallow on the chain so a fire-and-forget caller can't silently
    // accumulate unhandled rejections; return a fresh handle to the same
    // work so explicit awaiters (tests, stop()) still see the failure.
    this.writeChain = next.catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[ruby-high] state-store save failed (${this.path}):`, err);
    });
    if (resolve && reject) next.then(resolve, reject);
    return next;
  }

  private async writeCurrentSnapshot(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({
      sessions: Array.from(this.snapshot.values()),
      authUsers: Array.from(this.authUsers.values()),
      authSessions: Array.from(this.authSessions.values()),
      packs: Array.from(this.importedPacks.values()),
    }, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}

function readDebounceMsFromEnv(): number {
  const raw = process.env.RUBY_HIGH_STATE_DEBOUNCE_MS;
  if (raw == null || raw === "") return DEFAULT_DEBOUNCE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DEBOUNCE_MS;
  return Math.floor(n);
}

const DEFAULT_DEBOUNCE_MS = 25;

export function authUserKey(provider: AuthUserRecord["provider"], providerUserHash: string): string {
  return `${provider}:${providerUserHash}`;
}

export function packRecordKey(ownerSessionId: string, packId: string): string {
  return `${ownerSessionId}:${packId}`;
}

let defaultStateStore: StateStore | null = null;
export function getDefaultStateStore(): StateStore {
  if (!defaultStateStore) defaultStateStore = new StateStore();
  return defaultStateStore;
}
