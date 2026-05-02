import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { QuizState } from "../types.js";

/**
 * Phase-1 persistence: a single JSON file under ~/.ruby-high/state.json.
 * Atomic-ish writes via tmp-file + rename. This is intentionally tiny —
 * Phase 3+ tournaments will move to @elizaos/plugin-sql for multi-process
 * concurrency and richer queries.
 */
export class StateStore {
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();

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

  describe(): string {
    return this.path;
  }
}
