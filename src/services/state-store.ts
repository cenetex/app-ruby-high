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
   */
  save(states: Iterable<QuizState>): Promise<void> {
    const snapshot = Array.from(states);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify({ sessions: snapshot }, null, 2), "utf8");
      await rename(tmp, this.path);
    });
    return this.writeChain;
  }

  describe(): string {
    return this.path;
  }
}
