import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Service, type IAgentRuntime } from "@elizaos/core";
import {
  ALL_FACULTY,
  CHOICES,
  DIFFICULTIES,
  type BankedQuestion,
  type Difficulty,
  type FacultyMember,
  type QuestionBank,
} from "../types.js";

export interface PickFilter {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
  exclude?: Iterable<string>;
}

const PACK_FILES: Record<string, string> = {
  ruby: "ruby.json",
  "sally-science": "sally-science.json",
  "professor-edward": "professor-edward.json",
};

export class FacultyService extends Service {
  static override readonly serviceType = "ruby-high-faculty";

  override readonly capabilityDescription =
    "Loads faculty question packs from disk and picks questions by faculty, subject, and difficulty.";

  private readonly banks = new Map<string, QuestionBank>();
  private loaded = false;

  static async start(runtime: IAgentRuntime): Promise<FacultyService> {
    const svc = new FacultyService(runtime);
    await svc.loadBanks();
    return svc;
  }

  async stop(): Promise<void> {
    this.banks.clear();
    this.loaded = false;
  }

  private async loadBanks(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, "..", "..", "assets", "questions"),
      resolve(here, "..", "assets", "questions"),
      resolve(here, "assets", "questions"),
    ];

    for (const [facultyId, fileName] of Object.entries(PACK_FILES)) {
      let bank: QuestionBank | null = null;
      for (const dir of candidates) {
        try {
          const raw = await readFile(resolve(dir, fileName), "utf8");
          bank = validateBank(JSON.parse(raw));
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw new Error(
            `Failed to load question pack '${fileName}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (!bank) {
        throw new Error(`Question pack not found: ${fileName} (looked in ${candidates.join(", ")})`);
      }
      if (bank.faculty !== facultyId) {
        throw new Error(`Question pack ${fileName} declares faculty='${bank.faculty}', expected '${facultyId}'`);
      }
      this.banks.set(bank.faculty, bank);
    }
    this.loaded = true;
  }

  isReady(): boolean {
    return this.loaded;
  }

  faculty(): FacultyMember[] {
    return ALL_FACULTY;
  }

  facultyById(id: string): FacultyMember | null {
    return ALL_FACULTY.find((f) => f.id === id) ?? null;
  }

  bank(facultyId: string): QuestionBank | null {
    return this.banks.get(facultyId) ?? null;
  }

  subjects(facultyId: string): string[] {
    const bank = this.banks.get(facultyId);
    if (!bank) return [];
    return Array.from(new Set(bank.questions.map((q) => q.subject))).sort();
  }

  /**
   * Picks a question matching the filter. Excludes any IDs in `exclude` so a
   * session never sees the same question twice. Falls back across the filter
   * (subject → difficulty → any) so the caller always gets *something* if the
   * faculty has any unasked question left.
   */
  pick(filter: PickFilter = {}): BankedQuestion | null {
    const exclude = new Set(filter.exclude ?? []);
    const facultyIds = filter.faculty ? [filter.faculty] : [...this.banks.keys()];

    const matchSubject = (q: BankedQuestion) => !filter.subject || q.subject === filter.subject;
    const matchDifficulty = (q: BankedQuestion) => !filter.difficulty || q.difficulty === filter.difficulty;
    const notExcluded = (q: BankedQuestion) => !exclude.has(q.id);

    const tiers: Array<(q: BankedQuestion) => boolean> = [
      (q) => notExcluded(q) && matchSubject(q) && matchDifficulty(q),
      (q) => notExcluded(q) && matchSubject(q),
      (q) => notExcluded(q) && matchDifficulty(q),
      notExcluded,
    ];

    for (const tier of tiers) {
      const pool: BankedQuestion[] = [];
      for (const fid of facultyIds) {
        const bank = this.banks.get(fid);
        if (!bank) continue;
        for (const q of bank.questions) {
          if (tier(q)) pool.push(q);
        }
      }
      if (pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)] ?? null;
      }
    }
    return null;
  }

  /**
   * Deterministic pick for "today's Daily" — every player on a given (date,
   * faculty) sees the same question. Uses dailyIndex(key) modulo the bank
   * size as the ratchet; difficulty filter optional. The exclude set
   * skips questions the player has already seen this run, falling back
   * to "any unanswered" if the modulo'd slot is taken.
   *
   * Returns null only when the entire faculty bank has been exhausted —
   * effectively impossible at the current bank sizes (15 each, 20-pass
   * Senior streak max).
   */
  pickDaily(opts: {
    facultyId: string;
    dailyIndex: number;
    difficulty?: Difficulty;
    exclude?: Iterable<string>;
  }): BankedQuestion | null {
    const bank = this.banks.get(opts.facultyId);
    if (!bank || bank.questions.length === 0) return null;
    const exclude = new Set(opts.exclude ?? []);

    // Deterministic candidate order: rotate the bank by dailyIndex so day N
    // starts at slot N, day N+1 at slot N+1, etc. Layer the difficulty
    // filter on first; fall back to any-difficulty if the slot is taken.
    const rotated: BankedQuestion[] = [];
    const len = bank.questions.length;
    for (let i = 0; i < len; i++) {
      const q = bank.questions[(opts.dailyIndex + i) % len];
      if (q) rotated.push(q);
    }

    const matchDifficulty = (q: BankedQuestion) =>
      !opts.difficulty || q.difficulty === opts.difficulty;
    const notExcluded = (q: BankedQuestion) => !exclude.has(q.id);

    // Two-tier fallback. Difficulty preferred; any-difficulty acceptable.
    for (const passDifficulty of [true, false]) {
      for (const q of rotated) {
        if (!notExcluded(q)) continue;
        if (passDifficulty && !matchDifficulty(q)) continue;
        return q;
      }
    }
    return null;
  }
}

function validateBank(value: unknown): QuestionBank {
  if (!value || typeof value !== "object") throw new Error("Bank must be an object");
  const v = value as Record<string, unknown>;
  if (typeof v.faculty !== "string") throw new Error("Bank.faculty missing");
  if (typeof v.displayName !== "string") throw new Error("Bank.displayName missing");
  if (typeof v.description !== "string") throw new Error("Bank.description missing");
  if (!Array.isArray(v.questions)) throw new Error("Bank.questions must be an array");

  const questions: BankedQuestion[] = v.questions.map((q, i) => {
    if (!q || typeof q !== "object") throw new Error(`questions[${i}] not an object`);
    const r = q as Record<string, unknown>;
    if (typeof r.id !== "string") throw new Error(`questions[${i}].id missing`);
    if (typeof r.prompt !== "string") throw new Error(`questions[${i}].prompt missing`);
    const correct = r.correct as string;
    if (!CHOICES.includes(correct as never)) {
      throw new Error(`questions[${i}].correct must be A/B/C/D`);
    }
    const opts = r.options as Record<string, unknown> | undefined;
    if (!opts) throw new Error(`questions[${i}].options missing`);
    for (const c of CHOICES) {
      if (typeof opts[c] !== "string" || (opts[c] as string).trim().length === 0) {
        throw new Error(`questions[${i}].options.${c} missing or empty`);
      }
    }
    if (typeof r.subject !== "string") throw new Error(`questions[${i}].subject missing`);
    const difficulty = r.difficulty as string;
    if (!DIFFICULTIES.includes(difficulty as never)) {
      throw new Error(`questions[${i}].difficulty must be easy/medium/hard`);
    }
    return {
      id: r.id,
      prompt: r.prompt,
      options: { A: opts.A as string, B: opts.B as string, C: opts.C as string, D: opts.D as string },
      correct: correct as BankedQuestion["correct"],
      explanation: typeof r.explanation === "string" ? r.explanation : undefined,
      subject: r.subject,
      difficulty: difficulty as Difficulty,
      faculty: v.faculty as string,
    };
  });

  return {
    faculty: v.faculty,
    displayName: v.displayName,
    description: v.description,
    questions,
  };
}
