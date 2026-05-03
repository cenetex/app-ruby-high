import { Service, type IAgentRuntime } from "@elizaos/core";
import {
  type BankedQuestion,
  type Difficulty,
  type FacultyMember,
  type QuestionBank,
} from "../types.js";
import { getActivePack } from "../content/registry.js";

export interface PickFilter {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
  exclude?: Iterable<string>;
}

export class FacultyService extends Service {
  static override readonly serviceType = "ruby-high-faculty";

  override readonly capabilityDescription =
    "Loads faculty question packs from disk and picks questions by faculty, subject, and difficulty.";

  private readonly banks = new Map<string, QuestionBank>();
  private facultyList: FacultyMember[] = [];
  private loaded = false;

  static async start(runtime: IAgentRuntime): Promise<FacultyService> {
    const svc = new FacultyService(runtime);
    await svc.loadFromActivePack();
    return svc;
  }

  async stop(): Promise<void> {
    this.banks.clear();
    this.facultyList = [];
    this.loaded = false;
  }

  /** Load faculty + question banks from the active content pack. Replaces
   *  the previous fs-based pack-file loader; the active pack is now the
   *  single source of truth (see src/content/registry.ts). Tests/future
   *  pack-switching logic call setActivePack() then re-call this. */
  async loadFromActivePack(): Promise<void> {
    const pack = await getActivePack();
    this.banks.clear();
    this.facultyList = pack.faculty.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      subjects: f.subjects,
      bio: f.bio,
      available: true,
      accent: f.accent,
    }));
    for (const f of pack.faculty) {
      this.banks.set(f.id, {
        faculty: f.id,
        displayName: f.displayName,
        description: f.bio,
        questions: f.questions,
      });
    }
    this.loaded = true;
  }

  isReady(): boolean {
    return this.loaded;
  }

  faculty(): FacultyMember[] {
    return this.facultyList;
  }

  facultyById(id: string): FacultyMember | null {
    return this.facultyList.find((f) => f.id === id) ?? null;
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
