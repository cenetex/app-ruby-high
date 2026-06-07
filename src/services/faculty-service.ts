import { Service, type IAgentRuntime } from "../runtime.js";
import {
  type BankedQuestion,
  type Difficulty,
  type FacultyMember,
  type QuestionBank,
} from "../types.js";
import { getActivePack, getLoadedPack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

export interface PickFilter {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
  /** Hard level gate. Used for current-year-or-lower curriculum filtering. */
  allowedDifficulties?: Iterable<Difficulty>;
  exclude?: Iterable<string>;
}

export class FacultyService extends Service {
  static override readonly serviceType = "ruby-high-faculty";

  override readonly capabilityDescription =
    "Looks up faculty + question banks from the active content pack and picks questions by faculty, subject, and difficulty.";

  private loaded = false;

  static async start(runtime: IAgentRuntime): Promise<FacultyService> {
    const svc = new FacultyService(runtime);
    await svc.loadFromActivePack();
    return svc;
  }

  async stop(): Promise<void> {
    this.loaded = false;
  }

  /** Awaits the global active pack so callers know the registry is ready
   *  to read. No internal cache anymore — every method either takes a
   *  pack arg or reads getLoadedPack() at call time. The previous Map
   *  cache assumed one active pack process-wide; that assumption breaks
   *  the moment a future pack switch lands. */
  async loadFromActivePack(): Promise<void> {
    await getActivePack();
    this.loaded = true;
  }

  isReady(): boolean {
    return this.loaded;
  }

  /** Faculty roster of the given pack (or the global active pack if
   *  omitted). Always returns the legacy {available: true} adapter shape
   *  the rest of the codebase reads. */
  faculty(pack?: ContentPack): FacultyMember[] {
    return (pack ?? getLoadedPack()).faculty.map(toFacultyMember);
  }

  facultyById(id: string, pack?: ContentPack): FacultyMember | null {
    const p = pack ?? getLoadedPack();
    const f = p.faculty.find((x) => x.id === id);
    return f ? toFacultyMember(f) : null;
  }

  bank(facultyId: string, pack?: ContentPack): QuestionBank | null {
    const p = pack ?? getLoadedPack();
    const f = p.faculty.find((x) => x.id === facultyId);
    if (!f) return null;
    return {
      faculty: f.id,
      displayName: f.displayName,
      description: f.bio,
      questions: f.questions,
    };
  }

  subjects(facultyId: string, pack?: ContentPack): string[] {
    const bank = this.bank(facultyId, pack);
    if (!bank) return [];
    return Array.from(new Set(bank.questions.map((q) => q.subject))).sort();
  }

  /**
   * Picks a question matching the filter. Excludes any IDs in `exclude` so a
   * session never sees the same question twice. Falls back across the filter
   * (subject → difficulty → any) so the caller always gets *something* if the
   * faculty has any unasked question left.
   *
   * Pack-aware: pass the per-session pack so the player only ever sees
   * questions from the curriculum they're on.
   */
  pick(filter: PickFilter = {}, pack?: ContentPack): BankedQuestion | null {
    const p = pack ?? getLoadedPack();
    const exclude = new Set(filter.exclude ?? []);
    const facultyIds = filter.faculty ? [filter.faculty] : p.faculty.map((f) => f.id);
    const allowedDifficulties = filter.allowedDifficulties ? new Set(filter.allowedDifficulties) : null;

    const matchSubject = (q: BankedQuestion) => !filter.subject || q.subject === filter.subject;
    const matchDifficulty = (q: BankedQuestion) => !filter.difficulty || q.difficulty === filter.difficulty;
    const matchAllowedDifficulty = (q: BankedQuestion) => !allowedDifficulties || allowedDifficulties.has(q.difficulty);
    const notExcluded = (q: BankedQuestion) => !exclude.has(q.id);
    const base = (q: BankedQuestion) => notExcluded(q) && matchAllowedDifficulty(q);

    const tiers: Array<(q: BankedQuestion) => boolean> = [
      (q) => base(q) && matchSubject(q) && matchDifficulty(q),
      (q) => base(q) && matchSubject(q),
      (q) => base(q) && matchDifficulty(q),
      base,
    ];

    for (const tier of tiers) {
      const pool: BankedQuestion[] = [];
      for (const fid of facultyIds) {
        const f = p.faculty.find((x) => x.id === fid);
        if (!f) continue;
        for (const q of f.questions) {
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
   * Deterministic pick for today's forced-Legendary bonus — every player on
   * a given (date, faculty, pack) sees the same question. Uses dailyIndex(key)
   * modulo the bank size as the ratchet; difficulty filter optional.
   */
  pickDaily(
    opts: {
      facultyId: string;
      dailyIndex: number;
      difficulty?: Difficulty;
      exclude?: Iterable<string>;
    },
    pack?: ContentPack,
  ): BankedQuestion | null {
    const bank = this.bank(opts.facultyId, pack);
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

/** Adapt a PackFaculty (the inline shape inside a ContentPack) to the
 *  legacy FacultyMember shape the rest of the codebase reads. The only
 *  field that needs a default is `available` — pack faculty are always
 *  available. */
export function toFacultyMember(f: { id: string; displayName: string; shortName: string; subjects: string[]; bio: string; accent: string }): FacultyMember {
  return {
    id: f.id,
    displayName: f.displayName,
    shortName: f.shortName,
    subjects: f.subjects,
    bio: f.bio,
    available: true,
    accent: f.accent,
  };
}
