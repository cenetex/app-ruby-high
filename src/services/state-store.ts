import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { QuizState } from "../types.js";

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
 */
export interface StateStoreLike {
  load(): Promise<Map<string, QuizState>>;
  saveSession(state: QuizState): Promise<void>;
  save(states: Iterable<QuizState>): Promise<void>;
  describe(): string;
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

  constructor(path?: string) {
    this.path =
      path ??
      process.env.RUBY_HIGH_STATE_PATH ??
      resolve(homedir(), ".ruby-high", "state.json");
  }

  async load(): Promise<Map<string, QuizState>> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as { sessions?: QuizState[] };
      const map = new Map<string, QuizState>();
      for (const s of parsed.sessions ?? []) {
        if (s && typeof s.sessionId === "string") map.set(s.sessionId, s);
      }
      this.snapshot = new Map(map);
      return map;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw err;
    }
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
    const next = this.writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify({ sessions: snapshot }, null, 2), "utf8");
      await rename(tmp, this.path);
    });
    // Log + swallow on the chain so a fire-and-forget caller can't silently
    // accumulate unhandled rejections; return a fresh handle to the same
    // work so explicit awaiters (tests, stop()) still see the failure.
    this.writeChain = next.catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[ruby-high] state-store save failed (${this.path}):`, err);
    });
    return next;
  }

  /** JSON-file mode: rewriting one session means rewriting the whole file
   *  (it's a single document). We use the in-memory snapshot updated by
   *  prior load()/save() calls, replace the one entry, and write the lot.
   *  For DynamoDB this same method writes only one item. */
  saveSession(state: QuizState): Promise<void> {
    this.snapshot.set(state.sessionId, state);
    return this.save(this.snapshot.values());
  }

  describe(): string {
    return this.path;
  }
}
