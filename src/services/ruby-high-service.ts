import { Service, type IAgentRuntime } from "@elizaos/core";
import {
  ADVANTAGE_ROLLS_PER_GRADE,
  CHOICES,
  DEFAULT_GRADE,
  daysBetween,
  type Rarity,
  DEFAULT_ROUND_DURATION_MS,
  GRADES,
  LOUNGE_FACULTY,
  OPINION_ROUND_DURATION_MS,
  RUBY_FACULTY,
  ROOMS,
  TEACHING_ROOMS,
  difficultiesForGrade,
  difficultyForGrade,
  initialNpcRoster,
  npcsInRoom,
  classifyTotal,
  dailyKey,
  facultyForDay,
  initialNpcCohort,
  letterGradePasses,
  nextGradeAfter,
  npcStatsFor,
  pickEliminatedChoices,
  requiredStreakForGrade,
  requiredSubjectXpForGrade,
  roll2d6,
  rollNpcAnswer,
  rollOpinionDelay,
  statusForPhase,
  streakScoreMultiplier,
  type ActiveRound,
  type AdvantageRoll,
  type AnswerRecord,
  type BankedQuestion,
  type CardMemory,
  type CardReviewRating,
  type CharacterStats,
  type Choice,
  type Difficulty,
  type FacultyMember,
  type Grade,
  type GraduationReward,
  type NpcRoundEntry,
  type NpcArcState,
  type NpcStudentState,
  type OpinionGrade,
  type OpinionResponse,
  type Phase,
  type PlayerCharacter,
  type Question,
  type QuestionType,
  type QuizState,
  type RoomBoardSnapshot,
  type RoundOutcome,
  type TeachingRoomId,
} from "../types.js";
import { FacultyService, toFacultyMember } from "./faculty-service.js";
import { getDefaultStateStore, type StateStoreLike } from "./state-store.js";
import { log } from "./logger.js";
import { PLAYBOOKS } from "../characters/playbooks.js";
import { statForQuestion, normalizeQuestionStat } from "../question-stats.js";
import {
  activeFaculty,
  appendQuestionToPackBank,
  coursesForPack,
  facultyByIdForSession,
  facultyForSession,
  isPackLoaded,
  ORIGINAL_PACK_ID,
  packForSession,
  registerPack,
  resolveFacultyIdForSession,
  roomForFacultyForSession,
  setActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

export interface PoseInput {
  prompt: string;
  options: Record<Choice, string>;
  correct: Choice;
  explanation?: string;
  subject?: string;
  stat?: keyof CharacterStats;
  difficulty?: Difficulty;
  faculty?: string;
  questionId?: string;
  /** Legacy: accepted for older callers/tests, but rarity no longer drives
   *  credit or grade advancement. */
  rarity?: Rarity;
  /** Teacher-authored custom question should be promoted into the reusable
   *  Ruby High bank. Banked picks pass questionId and leave this false. */
  persistToBank?: boolean;
}

export interface PoseOpinionInput {
  prompt: string;
  rubric?: string;
  subject?: string;
  faculty?: string;
  questionId?: string;
  rarity?: Rarity;
}

export interface PickAndPoseInput {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
}

export interface QuestionBankStatus {
  mode: "bank" | "srs";
  facultyId: string;
  displayName: string;
  total: number;
  asked: number;
  remaining: number;
  grade?: string;
  readyCount?: number;
  masteredCount?: number;
  learningCount?: number;
  shakyCount?: number;
  newCount?: number;
  defaultDifficulty?: Difficulty;
  remainingByDifficulty: Partial<Record<Difficulty, number>>;
  remainingBySubject: Record<string, number>;
}

export interface CourseProgress {
  mode: "bank" | "srs";
  facultyId: string;
  displayName: string;
  total: number;
  ready: number;
  grade?: string;
  mastered: number;
  learning: number;
  shaky: number;
  new: number;
}

const SRS_AGAIN_MS = 5 * 60 * 1000;
const SRS_HARD_MS = 30 * 60 * 1000;
const SRS_ONE_DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_PACK_OWNER = "__ruby_high_global__";
const SRS_GOOD_INTERVALS_MS = [
  10 * 60 * 1000,
  SRS_ONE_DAY_MS,
  3 * SRS_ONE_DAY_MS,
  7 * SRS_ONE_DAY_MS,
];
const SRS_EASY_INTERVALS_MS = [
  30 * 60 * 1000,
  2 * SRS_ONE_DAY_MS,
  7 * SRS_ONE_DAY_MS,
  14 * SRS_ONE_DAY_MS,
];

function cardMemoryKey(courseId: string, questionId: string): string {
  return `${courseId}::${questionId}`;
}

function defaultCardMemory(courseId: string, questionId: string): CardMemory {
  return {
    courseId,
    questionId,
    phase: "new",
    dueAt: 0,
    stability: 0,
    difficulty: 0.5,
    consecutiveCorrect: 0,
    correctCount: 0,
    wrongCount: 0,
    delayedCorrectCount: 0,
    lapses: 0,
  };
}

function projectedStreakCountForPass(state: QuizState, now: number): number {
  const ch = state.character;
  const grade = state.currentGrade;
  if (!ch || !grade) return 0;
  const today = dailyKey(new Date(now));
  const current = ch.streak && ch.streak.grade === grade ? ch.streak : null;
  if (current?.lastDate === today) return current.count;
  if (current?.lastDate && daysBetween(current.lastDate, today) === 1) return current.count + 1;
  return 1;
}

function scoreMultiplierForPass(state: QuizState, passed: boolean, now: number): number {
  if (!passed) return 1;
  return streakScoreMultiplier(projectedStreakCountForPass(state, now));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function intervalForCorrect(rating: CardReviewRating, consecutiveCorrect: number): number {
  if (rating === "hard") return SRS_HARD_MS;
  const table = rating === "easy" ? SRS_EASY_INTERVALS_MS : SRS_GOOD_INTERVALS_MS;
  return table[Math.min(consecutiveCorrect - 1, table.length - 1)] ?? SRS_GOOD_INTERVALS_MS[0]!;
}

function dueKnownCard(memory: CardMemory, now: number): boolean {
  return memory.dueAt <= now;
}

function letterGradeForMastery(total: number, mastered: number, shaky: number, learning: number): string {
  if (total <= 0) return "F";
  const pct = mastered / total;
  let letter = "F";
  if (pct >= 0.9) letter = "A";
  else if (pct >= 0.75) letter = "B";
  else if (pct >= 0.55) letter = "C";
  else if (pct >= 0.3) letter = "D";
  const unresolvedPressure = (shaky + learning * 0.5) / total;
  if (letter === "A") return unresolvedPressure > 0.12 ? "A-" : "A";
  if (letter === "F") return pct >= 0.2 && unresolvedPressure < 0.4 ? "F+" : "F";
  const bandProgress =
    letter === "B" ? (pct - 0.75) / 0.15 :
    letter === "C" ? (pct - 0.55) / 0.2 :
    (pct - 0.3) / 0.25;
  if (unresolvedPressure > 0.25) return `${letter}-`;
  if (bandProgress >= 0.72) return `${letter}+`;
  return letter;
}

export class RubyHighService extends Service {
  static override readonly serviceType = "ruby-high";

  override readonly capabilityDescription =
    "Ruby High classroom state: tracks the active question, the student's answer, score, and which faculty member is on the floor.";

  private readonly sessions = new Map<string, QuizState>();
  private readonly store: StateStoreLike;
  private readonly backgroundWrites = new Set<Promise<void>>();
  private faculty: FacultyService | null = null;
  private loaded = false;

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? getDefaultStateStore();
  }

  static async start(runtime: IAgentRuntime): Promise<RubyHighService> {
    const svc = new RubyHighService(runtime);
    await svc.hydrate();
    return svc;
  }

  async stop(): Promise<void> {
    await this.persistAll();
    this.sessions.clear();
  }

  /** Wait for any in-flight persistence writes to flush. Useful in tests. */
  async flush(): Promise<void> {
    await this.persistAll();
    await Promise.allSettled(Array.from(this.backgroundWrites));
  }

  /** Persist one session before returning an HTTP mutation response. */
  flushSession(sessionId: string): Promise<void> {
    return this.persistSession(sessionId);
  }

  /** Player taps "Roll for advantage" once per round. The roll is consumed
   *  whether it lands hit / mixed / miss. Eliminated choices are recorded on
   *  the active round so the UI can cross them out and submitAnswer can
   *  reject picks against them.
   *
   *  Returns the updated state and the roll result. If the player already
   *  rolled this round, the existing roll is returned unchanged (idempotent).
   *  If there's no active MC round, returns a null result. */
  rollAdvantage(sessionId: string): { state: QuizState; result: AdvantageRoll | null; reason?: "no-round" | "already-rolled" | "answered" | "exhausted" } {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.resolved || round.type !== "multiple-choice") {
      return { state, result: null, reason: "no-round" };
    }
    if (round.advantage?.rolled) {
      return { state, result: round.advantage, reason: "already-rolled" };
    }
    if (round.player.answeredAt != null) {
      // Already locked in their answer — too late to roll for advantage.
      return { state, result: null, reason: "answered" };
    }
    // Per-grade cap. Counter is incremented BELOW only on a successful
    // roll, so a "no-round" / "answered" gate above doesn't burn a roll
    // accidentally. The counter is per-grade, so advancing implicitly
    // refills the pool.
    const grade = state.currentGrade;
    if (state.character && grade) {
      const used = state.character.advantageRollsUsed?.[grade] ?? 0;
      if (used >= this.advantageRollCapFor(state.character, grade)) {
        return { state, result: null, reason: "exhausted" };
      }
    }
    const stat: keyof CharacterStats = state.current ? statForQuestion(state.current) : "head";
    const r = roll2d6();
    const mod = state.character?.stats[stat] ?? 0;
    const total = r.total + mod;
    const outcome = classifyTotal(total);
    const correct = (state.current?.correct ?? "A") as Choice;
    const eliminated = pickEliminatedChoices(correct, outcome);
    const advantage: AdvantageRoll = {
      rolled: true,
      stat,
      dice: r.dice,
      total,
      outcome,
      eliminated,
      rolledAt: Date.now(),
    };
    round.advantage = advantage;
    if (state.character && grade) {
      const map = state.character.advantageRollsUsed ?? {};
      map[grade] = (map[grade] ?? 0) + 1;
      state.character.advantageRollsUsed = map;
    }
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, result: advantage };
  }

  /** Snapshot of advantage-roll usage for the current grade. Used by the
   *  session-state payload so the viewer can render "2/3 left" and disable
   *  the button when the pool is empty. */
  advantageRollsRemaining(sessionId: string): { used: number; cap: number; remaining: number } {
    const state = this.getOrCreate(sessionId);
    const grade = state.currentGrade;
    const used = (grade && state.character?.advantageRollsUsed?.[grade]) ?? 0;
    const cap = grade && state.character ? this.advantageRollCapFor(state.character, grade) : ADVANTAGE_ROLLS_PER_GRADE;
    return { used, cap, remaining: Math.max(0, cap - used) };
  }

  private advantageRollCapFor(ch: PlayerCharacter, grade: Grade): number {
    return ADVANTAGE_ROLLS_PER_GRADE + Math.max(0, ch.advantageRollBonuses?.[grade] ?? 0);
  }

  /** DM tool — teacher asks the player to roll a stat against a DC. Stored
   *  on state until the player resolves it via /command resolve-roll. */
  requestRoll(sessionId: string, input: { stat: keyof CharacterStats; dc?: number; reason?: string; faculty?: string }): QuizState {
    const state = this.getOrCreate(sessionId);
    state.pendingRoll = {
      stat: input.stat,
      dc: typeof input.dc === "number" ? input.dc : 7,
      reason: (input.reason ?? "").trim(),
      requestedBy: input.faculty ?? state.faculty,
      requestedAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Resolve the player's pending DM-roll. Bonus-only: it produces a roll
   *  result for narration but no longer awards XP. */
  resolvePendingRoll(sessionId: string): { state: QuizState; result: { stat: keyof CharacterStats; dice: [number, number]; total: number; outcome: RoundOutcome; xpAwarded: number; reason: string } | null } {
    const state = this.getOrCreate(sessionId);
    const pr = state.pendingRoll;
    if (!pr || !state.character) return { state, result: null };
    const r = roll2d6();
    const total = r.total + state.character.stats[pr.stat];
    const outcome: RoundOutcome = total >= pr.dc + 3 ? "hit" : total >= pr.dc ? "mixed" : "miss";
    const xpAwarded = 0;
    state.pendingRoll = null;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return {
      state,
      result: { stat: pr.stat, dice: r.dice, total, outcome, xpAwarded, reason: pr.reason },
    };
  }

  /** Legacy DM XP hook. Current progression is class mastery, so this is a
   *  no-op kept for older callers. */
  awardXp(sessionId: string, _amount: number, _reason: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) return state;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /**
   * Bind the FacultyService once both services are registered. Called by the
   * plugin index after both `Service.start()` calls return. Lets RubyHighService
   * delegate question-bank picks without a circular dependency at construction.
   */
  setFacultyService(faculty: FacultyService): void {
    this.faculty = faculty;
  }

  hasFaculty(): boolean {
    return this.faculty !== null;
  }

  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    const storedPacks = await this.store.loadPacks();
    storedPacks
      .slice()
      .sort((a, b) => a.touchedAt - b.touchedAt)
      .forEach((record) => {
        try {
          if (record.ownerSessionId === GLOBAL_PACK_OWNER) {
            setActivePack(record.pack);
          } else {
            registerPack(record.pack, record.ownerSessionId, record.touchedAt);
          }
        } catch (err) {
          log.error("ruby-high.restore-pack-failed", err, {
            ownerSessionId: record.ownerSessionId,
            packId: record.pack?.id,
          });
        }
    });
    const loaded = await this.store.load();
    let repaired = false;
    for (const [k, v] of loaded) {
      const state = normalizeLoaded(v);
      repaired = this.reconcileLoadedPackState(state) || repaired;
      this.sessions.set(k, state);
    }
    this.loaded = true;
    if (repaired) await this.persistAll();
  }

  private reconcileLoadedPackState(state: QuizState): boolean {
    const resolvedPack = packForSession(state);
    let repaired = false;
    if (state.activePackId && resolvedPack.id !== state.activePackId) {
      state.activePackId = null;
      state.current = null;
      state.activeRound = null;
      state.lastReveal = null;
      state.roomBoards = {};
      repaired = true;
    }
    if (state.faculty !== LOUNGE_FACULTY.id) {
      const resolvedFaculty = resolveFacultyIdForSession(state, state.faculty);
      if (resolvedFaculty && resolvedFaculty !== state.faculty) {
        state.faculty = resolvedFaculty;
        state.current = null;
        state.activeRound = null;
        state.lastReveal = null;
        state.roomBoards = {};
        repaired = true;
      }
    }
    if (
      state.faculty !== LOUNGE_FACULTY.id &&
      !resolvedPack.faculty.some((f) => f.id === state.faculty)
    ) {
      state.faculty = resolvedPack.faculty[0]?.id ?? RUBY_FACULTY.id;
      state.current = null;
      state.activeRound = null;
      state.lastReveal = null;
      state.roomBoards = {};
      repaired = true;
    }
    if (repaired) state.updatedAt = Date.now();
    return repaired;
  }

  /** Persist exactly one session — the preferred mutation path. With the
   *  DynamoDB backend this is a single PutItem; with the JSON-file backend
   *  it falls back to rewriting the full snapshot (the file has no other
   *  representation). Either way, only one session's worth of work is in
   *  the caller's mental model. */
  private persistSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return Promise.resolve();
    // Swallow + log persistence errors. Callers fire-and-forget with
    // `void this.persistSession(id)` so any throw becomes an unhandled
    // promise rejection — which Node 22 treats as fatal and crashes the
    // server. The classic offender is DynamoDB's 400KB per-item cap,
    // which a single AI-generated portrait dataURL can blow on its own.
    // The state is still good in memory; the next mutation will retry.
    return this.store.saveSession(state).catch((err) => {
      log.error("ruby-high.persist-failed", err, { sessionId });
    });
  }

  /** Persist all sessions at once. Used by stop() and flush() for safety;
   *  individual mutations should use persistSession(). */
  private persistAll(): Promise<void> {
    return this.store.save(this.sessions.values());
  }

  persistImportedPack(sessionId: string, pack: ContentPack): Promise<void> {
    return this.store.savePack({
      pack,
      ownerSessionId: sessionId,
      touchedAt: Date.now(),
    }).catch((err) => {
      log.error("ruby-high.persist-pack-failed", err, { sessionId, packId: pack.id });
    });
  }

  private trackBackgroundWrite(promise: Promise<void>): void {
    const tracked = promise.finally(() => {
      this.backgroundWrites.delete(tracked);
    });
    this.backgroundWrites.add(tracked);
  }

  private persistGlobalPack(pack: ContentPack): void {
    this.trackBackgroundWrite(this.store.savePack({
      pack,
      ownerSessionId: GLOBAL_PACK_OWNER,
      touchedAt: Date.now(),
    }).catch((err) => {
      log.error("ruby-high.persist-global-pack-failed", err, { packId: pack.id });
    }));
  }

  listFaculty(): FacultyMember[] {
    return [...activeFaculty().map(toFacultyMember), LOUNGE_FACULTY];
  }

  getOrCreate(sessionId: string): QuizState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      // New sessions are born already enrolled at Freshman year. The "intro"
      // phase + null grade combo is kept around only for derivePhaseForLegacy
      // (loading older state files); fresh sessions skip straight to in-room
      // so there's no grade-bootstrap round-trip and no stranded UI after
      // reset.
      // Default the new session to the first teaching faculty in the active
      // pack — used to be the static RUBY_FACULTY.id. Falls back to "ruby"
      // only during boot before the pack has loaded.
      const bootFaculty = isPackLoaded() ? (activeFaculty()[0]?.id ?? RUBY_FACULTY.id) : RUBY_FACULTY.id;
      state = {
        sessionId,
        faculty: bootFaculty,
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: statusForPhase("in-room"),
        askedQuestionIds: [],
        cardMemory: {},
        roomBoards: {},
        currentGrade: DEFAULT_GRADE,
        completedGrades: [],
        hasSeenIntro: true,
        activePackId: null,
        character: null,
        npcRosters: {},
        npcCohort: initialNpcCohort(),
        activeRound: null,
        pendingRoll: null,
        phase: "in-room",
        phaseToken: 0,
        updatedAt: Date.now(),
      };
      this.ensureRoster(state, DEFAULT_GRADE);
      this.sessions.set(sessionId, state);
    }
    // Tick any in-flight round so callers always see fresh elapsed state.
    this.tickRound(state);
    const repairedMemory = this.backfillCardMemory(state);
    if (this.maybeMarkGradeReady(state) || repairedMemory) {
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
    }
    return state;
  }

  // ── phase transitions ────────────────────────────────────────────────────
  //
  // The state machine. Every mutator calls transition() at the end of its
  // work — no mutator sets state.phase or state.status directly. This is
  // the single home for:
  //   1. Phase preconditions (who can move where)
  //   2. Reset rules (which fields the destination phase requires nulled)
  //   3. The phaseToken bump (the dedupe primitive for downstream consumers)
  //
  // `state.status` is kept in sync as a derived field — exists only for
  // back-compat with consumers that haven't migrated to `phase` yet
  // (viewer + telemetry shape). Internal code reads phase, not status.
  private transition(state: QuizState, action: TransitionAction): void {
    const next: Phase = nextPhaseFor(action);
    // Reset rules. The "destination phase requires these fields to look
    // a certain way." Mutators may have already pre-populated; this just
    // enforces invariants regardless.
    if (next === "in-room" || next === "lounge") {
      // Walking into a room (or the lounge) wipes any previous question.
      // The board is the room's, not yours.
      state.current = null;
      state.lastReveal = null;
      state.activeRound = null;
    } else if (next === "asking") {
      // A new question replaces any prior reveal. The caller is expected
      // to have set state.current + state.activeRound already.
      state.lastReveal = null;
    }
    // "revealed" leaves all fields as the resolveRound caller arranged them.
    // "intro" is only entered fresh in getOrCreate; resetSession handles full wipe.
    state.phase = next;
    state.status = statusForPhase(next);
    // Bump on every call. Two transitions to the same phase are still two
    // distinct moments in the session timeline (e.g. Sally → Edward → Sally
    // is three transitions, three tokens, three "channel-enter" events the
    // viewer should fire on).
    state.phaseToken = (state.phaseToken ?? 0) + 1;
  }

  private shouldStoreBoardForFaculty(facultyId: string | null | undefined): facultyId is string {
    return !!facultyId && facultyId !== LOUNGE_FACULTY.id;
  }

  private boardPhase(board: RoomBoardSnapshot): Phase {
    if (board.activeRound && !board.activeRound.resolved) return "asking";
    if (board.lastReveal && board.current) return "revealed";
    return "in-room";
  }

  private saveActiveBoardForFaculty(state: QuizState, facultyId: string): void {
    if (!this.shouldStoreBoardForFaculty(facultyId)) return;
    state.roomBoards = state.roomBoards ?? {};
    if (!state.current && !state.lastReveal && !state.activeRound) {
      delete state.roomBoards[facultyId];
      return;
    }
    state.roomBoards[facultyId] = {
      subject: state.subject,
      current: state.current,
      lastReveal: state.lastReveal,
      activeRound: state.activeRound,
    };
  }

  private restoreBoardForFaculty(state: QuizState, facultyId: string): boolean {
    if (!this.shouldStoreBoardForFaculty(facultyId)) return false;
    const board = state.roomBoards?.[facultyId];
    if (!board) return false;
    state.subject = board.subject;
    state.current = board.current;
    state.lastReveal = board.lastReveal;
    state.activeRound = board.activeRound;
    delete state.roomBoards![facultyId];
    const phase = this.boardPhase(board);
    state.phase = phase;
    state.status = statusForPhase(phase);
    this.tickRound(state);
    return true;
  }

  private discardBoardForFaculty(state: QuizState, facultyId: string): void {
    if (!this.shouldStoreBoardForFaculty(facultyId)) return;
    if (state.roomBoards) delete state.roomBoards[facultyId];
  }

  private resolveQuestionFaculty(state: QuizState, requested?: string): string {
    const raw = requested?.trim() || state.faculty;
    if (raw === LOUNGE_FACULTY.id) return raw;
    return resolveFacultyIdForSession(state, raw) ?? raw;
  }

  private subjectsForFaculty(state: QuizState, facultyId: string): string[] {
    const pack = packForSession(state);
    const faculty = pack.faculty.find((f) => f.id === facultyId);
    if (!faculty) return [];
    const bankSubjects = Array.from(new Set(
      faculty.questions
        .map((q) => q.subject)
        .filter((subject): subject is string => typeof subject === "string" && subject.trim().length > 0),
    ));
    return bankSubjects.length > 0 ? bankSubjects : faculty.subjects;
  }

  private normalizeQuestionSubject(state: QuizState, facultyId: string, requested?: string): string | undefined {
    const subjects = this.subjectsForFaculty(state, facultyId);
    const explicit = requested?.trim();
    if (explicit && (subjects.length === 0 || subjects.includes(explicit))) return explicit;
    if (state.subject && subjects.includes(state.subject)) return state.subject;
    return subjects[0] ?? (explicit || undefined);
  }

  private ensureCardMemory(state: QuizState): Record<string, CardMemory> {
    if (!state.cardMemory || typeof state.cardMemory !== "object") {
      state.cardMemory = {};
    }
    return state.cardMemory;
  }

  private isImportedReviewCourse(state: QuizState, facultyId: string): boolean {
    const pack = packForSession(state);
    return pack.id.startsWith("anki:") && pack.faculty.some((f) => f.id === facultyId && f.questions.length > 0);
  }

  private cardMemoryFor(state: QuizState, courseId: string, questionId: string): CardMemory | null {
    return this.ensureCardMemory(state)[cardMemoryKey(courseId, questionId)] ?? null;
  }

  private courseQuestionsFor(state: QuizState, facultyId: string): BankedQuestion[] {
    return packForSession(state).faculty.find((f) => f.id === facultyId)?.questions ?? [];
  }

  private eligibleCourseQuestions(
    state: QuizState,
    facultyId: string,
    filter: { subject?: string; difficulty?: Difficulty; allowedDifficulties?: Iterable<Difficulty> } = {},
  ): BankedQuestion[] {
    const allowed = filter.allowedDifficulties ? new Set(filter.allowedDifficulties) : null;
    return this.courseQuestionsFor(state, facultyId).filter((q) =>
      (!filter.subject || q.subject === filter.subject) &&
      (!filter.difficulty || q.difficulty === filter.difficulty) &&
      (!allowed || allowed.has(q.difficulty))
    );
  }

  private backfillCardMemory(state: QuizState): boolean {
    const pack = packForSession(state);
    const memory = this.ensureCardMemory(state);
    const historyByQuestion = new Map<string, AnswerRecord[]>();
    for (const record of state.history) {
      let list = historyByQuestion.get(record.questionId);
      if (!list) {
        list = [];
        historyByQuestion.set(record.questionId, list);
      }
      list.push(record);
    }

    let mutated = false;
    const asked = new Set(state.askedQuestionIds);
    for (const faculty of pack.faculty) {
      for (const q of faculty.questions) {
        const key = cardMemoryKey(faculty.id, q.id);
        if (memory[key]) continue;
        const records = (historyByQuestion.get(q.id) ?? []).sort((a, b) => a.at - b.at);
        const currentUnresolved =
          state.current?.id === q.id &&
          state.activeRound?.questionId === q.id &&
          !state.activeRound.resolved;
        if (currentUnresolved) continue;
        if (records.length === 0 && !asked.has(q.id)) continue;
        const m = defaultCardMemory(faculty.id, q.id);
        if (records.length > 0) {
          let trailing = 0;
          for (let i = records.length - 1; i >= 0; i--) {
            if (!records[i]!.wasCorrect) break;
            trailing += 1;
          }
          m.correctCount = records.filter((r) => r.wasCorrect).length;
          m.wrongCount = records.length - m.correctCount;
          m.consecutiveCorrect = trailing;
          m.phase = trailing >= 2 ? "review" : "learning";
          m.lastReviewedAt = records[records.length - 1]!.at;
          m.lastResult = records[records.length - 1]!.wasCorrect ? "good" : "again";
        } else {
          m.phase = "learning";
        }
        // Legacy one-use-bank state has already shown the card. Mark it due
        // now so imports recover into the review queue instead of staying dry.
        m.dueAt = Date.now();
        memory[key] = m;
        mutated = true;
      }
    }
    return mutated;
  }

  private pickReviewQuestion(
    state: QuizState,
    facultyId: string,
    filter: { subject?: string; difficulty?: Difficulty; allowedDifficulties?: Iterable<Difficulty> } = {},
    now = Date.now(),
  ): BankedQuestion | null {
    const all = this.eligibleCourseQuestions(state, facultyId, {
      allowedDifficulties: filter.allowedDifficulties,
    });
    if (all.length === 0) return null;
    const preferred = all.filter((q) =>
      (!filter.subject || q.subject === filter.subject) &&
      (!filter.difficulty || q.difficulty === filter.difficulty)
    );
    const memory = this.ensureCardMemory(state);
    const choose = (pool: BankedQuestion[]): BankedQuestion | null => {
      const due: BankedQuestion[] = [];
      const legacyDue: BankedQuestion[] = [];
      const fresh: BankedQuestion[] = [];
      const masteredDue: BankedQuestion[] = [];
      for (const q of pool) {
        const currentUnresolved =
          state.current?.id === q.id &&
          state.activeRound?.questionId === q.id &&
          !state.activeRound.resolved;
        if (currentUnresolved) continue;
        const m = memory[cardMemoryKey(facultyId, q.id)];
        if (!m) {
          fresh.push(q);
        } else if (dueKnownCard(m, now)) {
          if (m.phase === "mastered") masteredDue.push(q);
          else if (m.lastReviewedAt == null) legacyDue.push(q);
          else due.push(q);
        }
      }
      due.sort((a, b) => {
        const ma = memory[cardMemoryKey(facultyId, a.id)]!;
        const mb = memory[cardMemoryKey(facultyId, b.id)]!;
        const phaseRank = (m: CardMemory) => m.phase === "learning" ? 0 : m.phase === "review" ? 1 : 2;
        return phaseRank(ma) - phaseRank(mb)
          || mb.wrongCount - ma.wrongCount
          || ma.consecutiveCorrect - mb.consecutiveCorrect
          || ma.dueAt - mb.dueAt;
      });
      if (due.length > 0) return due[0]!;
      if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)] ?? null;
      if (legacyDue.length > 0) return legacyDue[0]!;
      masteredDue.sort((a, b) => {
        const ma = memory[cardMemoryKey(facultyId, a.id)]!;
        const mb = memory[cardMemoryKey(facultyId, b.id)]!;
        return ma.dueAt - mb.dueAt;
      });
      return masteredDue[0] ?? null;
    };
    return choose(preferred.length > 0 ? preferred : all) ?? (preferred.length > 0 ? choose(all) : null);
  }

  private questionBelongsToReviewCourse(state: QuizState, q: Question): BankedQuestion | null {
    const facultyId = this.resolveQuestionFaculty(state, q.faculty);
    return this.courseQuestionsFor(state, facultyId).find((candidate) => candidate.id === q.id) ?? null;
  }

  private reviewRatingForRound(
    wasCorrect: boolean,
    forfeit: boolean,
    playerRoll: NonNullable<NonNullable<QuizState["lastReveal"]>["playerRoll"]> | null,
  ): CardReviewRating {
    if (!wasCorrect || forfeit) return "again";
    if (playerRoll?.outcome === "hit") return "easy";
    if (playerRoll?.outcome === "mixed") return "good";
    return "hard";
  }

  private recordCardReview(
    state: QuizState,
    q: Question,
    rating: CardReviewRating,
    now = Date.now(),
    scoreMultiplier = 1,
  ): void {
    const banked = this.questionBelongsToReviewCourse(state, q);
    if (!banked) return;
    const memory = this.ensureCardMemory(state);
    const key = cardMemoryKey(banked.faculty, banked.id);
    const previous = memory[key] ?? defaultCardMemory(banked.faculty, banked.id);
    const delayed = previous.lastReviewedAt != null && now >= previous.dueAt;
    const next: CardMemory = { ...previous, lastReviewedAt: now, lastResult: rating };

    if (rating === "again") {
      next.phase = "learning";
      next.dueAt = now + SRS_AGAIN_MS;
      next.consecutiveCorrect = 0;
      next.lastScoreMultiplier = 1;
      next.wrongCount += 1;
      next.lapses += 1;
      next.difficulty = clamp(next.difficulty + 0.15, 0, 1);
      next.stability = SRS_AGAIN_MS / SRS_ONE_DAY_MS;
      memory[key] = next;
      return;
    }

    const scoreCredit = clamp(Math.floor(scoreMultiplier), 1, 3);
    next.lastScoreMultiplier = scoreCredit;
    next.correctCount += scoreCredit;
    next.consecutiveCorrect += scoreCredit;
    if (delayed) next.delayedCorrectCount += 1;
    next.difficulty = clamp(
      next.difficulty + (rating === "hard" ? 0.05 : rating === "good" ? -0.05 : -0.1),
      0,
      1,
    );
    const interval = intervalForCorrect(rating, next.consecutiveCorrect);
    const accuracy = next.correctCount / Math.max(1, next.correctCount + next.wrongCount);
    const mastered = next.consecutiveCorrect >= 3 && next.delayedCorrectCount >= 1 && accuracy >= 0.75;
    next.phase = mastered ? "mastered" : next.consecutiveCorrect >= 2 ? "review" : "learning";
    next.dueAt = now + (mastered ? Math.max(interval, 14 * SRS_ONE_DAY_MS) : interval);
    next.stability = interval / SRS_ONE_DAY_MS;
    memory[key] = next;
  }

  private cardCounts(state: QuizState, facultyId: string, questions: BankedQuestion[], now = Date.now()): {
    asked: number;
    ready: number;
    mastered: number;
    learning: number;
    shaky: number;
    fresh: number;
    remainingByDifficulty: Partial<Record<Difficulty, number>>;
    remainingBySubject: Record<string, number>;
  } {
    const memory = this.ensureCardMemory(state);
    let asked = 0;
    let ready = 0;
    let mastered = 0;
    let learning = 0;
    let shaky = 0;
    let fresh = 0;
    const remainingByDifficulty: Partial<Record<Difficulty, number>> = {};
    const remainingBySubject: Record<string, number> = {};
    for (const q of questions) {
      const m = memory[cardMemoryKey(facultyId, q.id)];
      const isFresh = !m;
      if (m?.lastReviewedAt != null) asked += 1;
      if (isFresh) fresh += 1;
      else if (m.phase === "mastered") mastered += 1;
      else if (m.phase === "learning") learning += 1;
      else if (m.phase === "review") learning += 1;
      if (m && m.wrongCount > 0 && m.consecutiveCorrect === 0) shaky += 1;
      const isReady = isFresh || (m ? dueKnownCard(m, now) : false);
      if (isReady) {
        ready += 1;
        remainingByDifficulty[q.difficulty] = (remainingByDifficulty[q.difficulty] ?? 0) + 1;
        remainingBySubject[q.subject] = (remainingBySubject[q.subject] ?? 0) + 1;
      }
    }
    return { asked, ready, mastered, learning, shaky, fresh, remainingByDifficulty, remainingBySubject };
  }

  /** Advance the active round based on wall-clock time:
   *  - Mark NPC entries whose delay has elapsed as "answered" (timestamp).
   *  - If all NPCs + the player have locked, resolve.
   *  - If the round timer expires, force-resolve (player forfeits if
   *    they didn't pick). */
  private tickRound(state: QuizState): void {
    const round = state.activeRound;
    if (!round || round.resolved) return;
    // Opinion rounds resolve only when the chat layer calls recordGrades
    // (after generating + grading written responses). The MC dice timing
    // doesn't apply.
    if (round.type === "opinion") return;
    const now = Date.now();
    let mutated = false;
    for (const entry of round.npcs) {
      if (entry.answeredAt == null && now - round.startedAt >= entry.delayMs) {
        entry.answeredAt = round.startedAt + entry.delayMs;
        mutated = true;
      }
    }
    const allNpcsLocked = round.npcs.every((n) => n.answeredAt != null);
    const playerLocked = round.player.answeredAt != null;
    const expired = now >= round.expiresAt;
    if ((allNpcsLocked && playerLocked) || expired) {
      this.resolveRound(state, expired && !playerLocked);
      mutated = true;
    }
    if (mutated) state.updatedAt = now;
  }

  /** Finalize the round: compute correctness, determine first-correct,
   *  award NPC subject progress (deterministic — no extra coin flip), set
   *  state.lastReveal, write subject completion + redistribution events. */
  private resolveRound(state: QuizState, forfeit: boolean): void {
    const round = state.activeRound;
    if (!round || round.resolved) return;
    const q = state.current;
    if (!q) {
      round.resolved = true;
      round.resolvedAt = Date.now();
      return;
    }
    // Force-pin any unanswered NPCs to their planned commit time. This keeps
    // the race honest when the player commits early — an NPC whose delay
    // would have fired at T=7s is recorded as T=7s, not at the timer expiry.
    for (const entry of round.npcs) {
      if (entry.answeredAt == null) {
        entry.answeredAt = Math.min(round.startedAt + entry.delayMs, round.expiresAt);
      }
    }

    // Determine first-correct across the whole field.
    const corrects: Array<{ id: string; at: number }> = [];
    if (round.player.answeredAt != null && round.player.picked === q.correct) {
      corrects.push({ id: "player", at: round.player.answeredAt });
    }
    for (const entry of round.npcs) {
      if (entry.plannedPick === q.correct && entry.answeredAt != null) {
        corrects.push({ id: entry.studentId, at: entry.answeredAt });
      }
    }
    corrects.sort((a, b) => a.at - b.at);
    round.firstCorrect = corrects[0]?.id ?? null;

    // Player scoring. Forfeits (timer expired with no pick) count toward
    // total but don't fake a letter — history records null picked.
    const picked = round.player.picked ?? null;
    const rawCorrect = !forfeit && picked != null && picked === q.correct;
    let affinitySave: { facultyId: string } | null = null;
    if (!rawCorrect && !forfeit && picked != null && state.character && state.currentGrade) {
      const affinity = state.character.classAffinity?.[state.currentGrade];
      const facultyId = q.faculty ?? state.faculty;
      if (affinity && !affinity.used && affinity.facultyId === facultyId) {
        affinity.used = true;
        affinitySave = { facultyId };
      }
    }
    const wasCorrect = rawCorrect || !!affinitySave;
    const reviewAt = round.player.answeredAt ?? Date.now();
    const scoreMultiplier = scoreMultiplierForPass(state, wasCorrect, reviewAt);
    if (picked != null) {
      const record: AnswerRecord = {
        questionId: q.id,
        picked,
        correct: (q.correct ?? "A") as Choice,
        wasCorrect,
        at: round.player.answeredAt ?? round.expiresAt,
      };
      state.history.push(record);
    }
    state.score.total += 1;
    if (wasCorrect) state.score.correct += 1;

    // 2d6 + question stat roll for the player — bonus layer on top of their
    // literal pick. The roll feeds review quality; it no longer awards XP.
    // NPC rolls (in activeRound.npcs) carry the actual race stakes.
    let playerRoll: NonNullable<NonNullable<QuizState["lastReveal"]>["playerRoll"]> | null = null;
    if (state.character && picked != null) {
      const stat: keyof CharacterStats = statForQuestion(q);
      const r = roll2d6();
      const total = r.total + state.character.stats[stat];
      const outcome = classifyTotal(total);
      const xpAwarded = 0;
      playerRoll = { stat, dice: r.dice, total, outcome, xpAwarded };
    }
    this.recordCardReview(
      state,
      q,
      this.reviewRatingForRound(wasCorrect, forfeit, playerRoll),
      reviewAt,
      scoreMultiplier,
    );

    // Player progression. Card mastery updates above; class grades are derived
    // from that memory. The first passed question per school day ticks the
    // streak and cohort.
    const progress = this.applyPlayerProgress(state, wasCorrect, state.faculty, playerRoll?.xpAwarded ?? 0);
    if (progress.dailyTicked) {
      const correctAns = (q.correct ?? "A") as Choice;
      this.applyCohortDaily(state, correctAns, dailyKey());
    }

    state.lastReveal = {
      questionId: q.id,
      picked: (picked ?? "A") as Choice, // UI-only; audit lives in history
      correct: (q.correct ?? "A") as Choice,
      wasCorrect,
      explanation: q.explanation ?? null,
      encouragement: affinitySave
        ? "Class affinity kicked in — second chance counted."
        : forfeit ? "Time's up. Take a breath." : pickEncouragement(wasCorrect),
      scoreMultiplier,
      playerRoll,
      affinitySave,
    };
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    // resolveRound is a private helper that operates on `state` directly;
    // there's no sessionId param, so pull it off the state.
    void this.persistSession(state.sessionId);
  }

  /** Apply grade progression after a question resolves.
   *  Steps:
   *
   *    1. subjectScores tick (independent of pass) — drives
   *       the diploma's subject-themed accessory at graduation.
   *    2. Card memory already updated before this call; class standing is
   *       derived from mastery, not XP.
   *    3. The first passed question on a UTC date is a "school day complete":
   *       tick the streak, with date-gap reset.
   *    4. Re-check grade completion after every progress mutation. Streak
   *       and class credit can land in either order; once both gates are met,
   *       the year completes immediately.
   */
  private applyPlayerProgress(state: QuizState, passed: boolean, faculty: string, awardedCredits: number): { dailyTicked: boolean } {
    const ch = state.character;
    if (!ch || !state.currentGrade) return { dailyTicked: false };
    const grade = state.currentGrade;
    const today = dailyKey();

    // 1. Subject-score tracking.
    ch.subjectScores = ch.subjectScores ?? {};
    const subj = ch.subjectScores[faculty] ?? { correct: 0, total: 0 };
    subj.total += 1;
    if (passed) subj.correct += 1;
    ch.subjectScores[faculty] = subj;

    void awardedCredits;

    // 3. Streak tracking. Only the first passed question per school day moves it.
    let dailyTicked = false;
    if (!passed) {
      this.maybeMarkGradeReady(state);
      return { dailyTicked };
    }

    const prevLastDate = ch.streak && ch.streak.grade === grade ? ch.streak.lastDate : undefined;
    if (prevLastDate !== today) {
      const nextCount = prevLastDate && daysBetween(prevLastDate, today) === 1
        ? (ch.streak?.grade === grade ? ch.streak.count : 0) + 1
        : 1; // fresh streak — first day, gap > 1, or new grade
      ch.streak = { grade, count: nextCount, lastDate: today };
      dailyTicked = true;
    }

    this.maybeMarkGradeReady(state);
    return { dailyTicked };
  }

  private gradeCompletionStatus(state: QuizState): {
    grade: Grade;
    requiredStreak: number;
    streakCount: number;
    streakMet: boolean;
    classesMet: number;
    classCount: number;
    classesMetAll: boolean;
    classGrades: Record<string, string>;
    ready: boolean;
  } | null {
    const ch = state.character;
    const grade = state.currentGrade;
    if (!ch || !grade) return null;

    const requiredStreak = requiredStreakForGrade(grade);
    const streakCount = ch.streak && ch.streak.grade === grade ? ch.streak.count : 0;
    let classesMet = 0;
    let classCount = 0;
    const classGrades: Record<string, string> = {};
    for (const room of TEACHING_ROOMS) {
      const teacherId = ROOMS.find((r) => r.id === room)?.teacherId;
      if (!teacherId) continue;
      classCount++;
      const course = this.questionBankStatusForState(state, teacherId);
      const legacyPass = (ch.subjectXp?.[teacherId] ?? 0) >= requiredSubjectXpForGrade(grade);
      const gradeLabel = letterGradePasses(course.grade) ? course.grade! : (legacyPass ? "C" : (course.grade ?? "F"));
      classGrades[teacherId] = gradeLabel;
      if (letterGradePasses(gradeLabel)) classesMet++;
    }
    const streakMet = streakCount >= requiredStreak;
    const classesMetAll = classCount > 0 && classesMet >= classCount;
    return {
      grade,
      requiredStreak,
      streakCount,
      streakMet,
      classesMet,
      classCount,
      classesMetAll,
      classGrades,
      ready: streakMet && classesMetAll,
    };
  }

  private maybeMarkGradeReady(state: QuizState): boolean {
    const status = this.gradeCompletionStatus(state);
    const ch = state.character;
    if (!status || !ch || !status.ready) return false;
    const grade = status.grade;
    if (ch.yearbook?.some((y) => y.grade === grade) || state.completedGrades.includes(grade)) return false;
    if (ch.pendingGraduation?.grade === grade) return false;
    ch.pendingGraduation = {
      grade,
      readyAt: Date.now(),
      summary: { correct: status.streakCount, total: status.requiredStreak },
    };
    log.event("player.graduation-ready", {
      sessionId: state.sessionId, character: ch.name, grade, legacyXp: ch.xp,
    });
    return true;
  }

  completeGraduation(sessionId: string, reward: GraduationReward): QuizState {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    const pending = ch?.pendingGraduation;
    if (!ch || !pending || !state.currentGrade || pending.grade !== state.currentGrade) {
      throw new Error("No graduation ceremony is ready.");
    }
    const status = this.gradeCompletionStatus(state);
    if (!status || !status.ready || status.grade !== pending.grade) {
      ch.pendingGraduation = null;
      throw new Error("Graduation requirements are not complete.");
    }
    const grade = pending.grade;
    if (ch.yearbook?.some((y) => y.grade === grade) || state.completedGrades.includes(grade)) {
      ch.pendingGraduation = null;
      return state;
    }

    const advance = nextGradeAfter(grade);
    const targetGrade = advance ?? grade;
    const normalizedReward = this.normalizeGraduationReward(ch, reward, targetGrade);

    ch.yearbook = ch.yearbook ?? [];
    ch.yearbook.push({
      grade,
      completedAt: Date.now(),
      summary: pending.summary,
      name: ch.name,
      playbookId: ch.playbookId,
      stats: { ...ch.stats },
      ...(ch.portraitDataUrl ? { portraitDataUrl: ch.portraitDataUrl } : {}),
      ...(ch.flavorQuote ? { flavorQuote: ch.flavorQuote } : {}),
      arcAnswer: ch.arcAnswer,
      ...(ch.subjectScores ? { subjectScores: { ...ch.subjectScores } } : {}),
      graduationReward: normalizedReward,
    });
    if (!state.completedGrades.includes(grade)) state.completedGrades.push(grade);

    this.applyGraduationReward(ch, normalizedReward, targetGrade);
    ch.levelUps = ch.levelUps ?? [];
    ch.levelUps.push({
      completedGrade: grade,
      targetGrade: advance,
      reward: normalizedReward,
      awardedAt: Date.now(),
    });
    ch.pendingGraduation = null;

    if (advance) {
      state.currentGrade = advance;
      this.ensureRoster(state, advance);
      ch.streak = { grade: advance, count: 0 };
      log.event("player.grade-advanced", {
        sessionId: state.sessionId, character: ch.name, fromGrade: grade, toGrade: advance, legacyXp: ch.xp, reward: normalizedReward.kind,
      });
    } else {
      log.event("player.graduated", {
        sessionId: state.sessionId, character: ch.name, legacyXp: ch.xp, reward: normalizedReward.kind,
      });
    }

    this.transition(state, { kind: "clear-board" });
    this.discardBoardForFaculty(state, state.faculty);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  private normalizeGraduationReward(ch: PlayerCharacter, reward: GraduationReward, targetGrade: Grade): GraduationReward {
    if (reward.kind === "stat") {
      if (!["head", "heart", "hustle", "honor"].includes(reward.stat)) {
        throw new Error("Pick a valid stat.");
      }
      if ((ch.stats[reward.stat] ?? 0) >= 3) {
        throw new Error(`${reward.stat.toUpperCase()} is already capped at +3.`);
      }
      return reward;
    }
    if (reward.kind === "advantage") return reward;
    if (reward.kind === "affinity") {
      const facultyIds = new Set(TEACHING_ROOMS
        .map((room) => ROOMS.find((r) => r.id === room)?.teacherId)
        .filter((id): id is string => typeof id === "string"));
      if (!facultyIds.has(reward.facultyId)) throw new Error("Pick a valid class affinity.");
      return { kind: "affinity", facultyId: reward.facultyId };
    }
    throw new Error(`Unknown graduation reward: ${(reward as { kind?: string }).kind ?? "?"}`);
  }

  private applyGraduationReward(ch: PlayerCharacter, reward: GraduationReward, targetGrade: Grade): void {
    if (reward.kind === "stat") {
      ch.stats[reward.stat] = Math.min(3, (ch.stats[reward.stat] ?? 0) + 1);
      return;
    }
    if (reward.kind === "advantage") {
      const map = ch.advantageRollBonuses ?? {};
      map[targetGrade] = (map[targetGrade] ?? 0) + 1;
      ch.advantageRollBonuses = map;
      return;
    }
    const affinity = ch.classAffinity ?? {};
    affinity[targetGrade] = { facultyId: reward.facultyId, used: false };
    ch.classAffinity = affinity;
  }

  /** Cohort tick — every NPC who's still in school rolls against today's
   *  school-day progress check and ticks their own streak. Independent of the player's pass:
   *  Indra might pass while you miss, or vice versa. Streak resets on
   *  miss; advances on threshold; graduates after Senior streak.
   *
   *  NPCs gate on streak alone — no XP gate. They feel hungrier than the
   *  player, which makes the rivalry tense ("Indra graduated last week").
   *
   *  The day-key dedupe prevents double-tick if the player passes multiple
   *  questions on the same day after the streak has already ticked. */
  private applyCohortDaily(state: QuizState, correctAnswer: Choice, key: string): void {
    if (!state.npcCohort) state.npcCohort = initialNpcCohort();
    const cohort = state.npcCohort;
    if (!state.current) return;
    for (const npc of cohort) {
      if (npc.graduated) continue;
      if (npc.lastDailyDate === key) continue; // already ticked today
      const stats = npcStatsFor(npc.id);
      const r = rollNpcAnswer(stats, correctAnswer, statForQuestion(state.current));
      const passed = r.pick === correctAnswer;
      npc.lastDailyDate = key;
      if (!passed) {
        npc.streak = { grade: npc.grade, count: 0 };
        continue;
      }
      const prev = npc.streak.grade === npc.grade ? npc.streak.count : 0;
      const next = prev + 1;
      npc.streak = { grade: npc.grade, count: next };
      const required = requiredStreakForGrade(npc.grade);
      if (next < required) continue;
      if (!npc.completedGrades.includes(npc.grade)) {
        npc.completedGrades.push(npc.grade);
      }
      const advance = nextGradeAfter(npc.grade);
      if (advance) {
        npc.grade = advance;
        npc.streak = { grade: advance, count: 0 };
      } else {
        npc.graduated = true;
      }
    }
  }

  /** Ensure an NPC roster exists for the given grade. The seating chart
   *  is static for the year (the per-question redistribution that used to
   *  drive student migration was part of the legacy free-play loop). */
  private ensureRoster(state: QuizState, grade: Grade): NpcStudentState[] {
    let roster = state.npcRosters[grade];
    if (!roster) {
      roster = initialNpcRoster(grade);
      state.npcRosters[grade] = roster;
    }
    return roster;
  }

  pose(sessionId: string, input: PoseInput): QuizState {
    const state = this.getOrCreate(sessionId);
    if (state.character?.pendingGraduation) {
      throw new Error("Graduation ceremony is ready — choose a level-up reward before starting another question.");
    }
    if (!CHOICES.includes(input.correct)) {
      throw new Error(`'correct' must be one of ${CHOICES.join(", ")}`);
    }
    for (const c of CHOICES) {
      const v = input.options[c];
      if (typeof v !== "string" || v.trim().length === 0) {
        throw new Error(`Option ${c} is missing or empty`);
      }
    }
    const id = input.questionId ?? `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const facultyId = this.resolveQuestionFaculty(state, input.faculty);
    const subject = this.normalizeQuestionSubject(state, facultyId, input.subject);
    const difficulty = input.difficulty ?? (state.currentGrade ? difficultyForGrade(state.currentGrade) : "medium");
    const question: Question = {
      id,
      prompt: input.prompt.trim(),
      type: "multiple-choice",
      options: { ...input.options },
      correct: input.correct,
      explanation: input.explanation?.trim() || undefined,
      subject,
      stat: normalizeQuestionStat(input.stat) ?? undefined,
      difficulty,
      faculty: facultyId,
      rarity: input.rarity,
    };
    question.stat = statForQuestion(question);
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    if (!state.askedQuestionIds.includes(id)) state.askedQuestionIds.push(id);
    this.maybePromoteAuthoredQuestion(state, question, !!input.persistToBank && !input.questionId);

    // Open a new round and pre-roll the NPCs in the active classroom. The
    // student-side LLM never touches the question — picks come from dice +
    // the question stat, and HUSTLE only controls timing.
    state.activeRound = this.openRound(state, question);
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  private maybePromoteAuthoredQuestion(state: QuizState, question: Question, shouldPersist: boolean): void {
    if (!shouldPersist) return;
    const pack = packForSession(state);
    // Imported decks are private study material; custom "challenge" boards
    // should not silently rewrite a user's imported source deck. The original
    // Ruby High curriculum is the shared server-side bank we grow over time.
    if (pack.id !== ORIGINAL_PACK_ID) return;
    if (!question.options || !question.correct || !question.subject || !question.difficulty || !question.faculty) return;
    const banked: BankedQuestion = {
      id: question.id,
      prompt: question.prompt,
      type: "multiple-choice",
      options: question.options as Record<Choice, string>,
      correct: question.correct,
      explanation: question.explanation,
      subject: question.subject,
      stat: question.stat,
      difficulty: question.difficulty,
      faculty: question.faculty,
    };
    const updated = appendQuestionToPackBank(pack.id, question.faculty, banked);
    if (updated) {
      this.persistGlobalPack(updated);
      log.event("question.promoted-to-bank", {
        sessionId: state.sessionId,
        packId: pack.id,
        faculty: question.faculty,
        questionId: question.id,
      });
    }
  }

  private openRound(state: QuizState, question: Question): ActiveRound {
    const startedAt = Date.now();
    const isOpinion = question.type === "opinion";
    const durationMs = isOpinion ? OPINION_ROUND_DURATION_MS : DEFAULT_ROUND_DURATION_MS;
    const room = roomForFacultyForSession(state, state.faculty);
    let entries: NpcRoundEntry[] = [];
    if (room && room.teaches && state.currentGrade) {
      const teachingRoom = room.id as TeachingRoomId;
      const roster = this.ensureRoster(state, state.currentGrade);
      const inRoom = npcsInRoom(roster, teachingRoom);
      entries = inRoom.map((npc) => {
        if (isOpinion) {
          // Opinion round — accuracy doesn't apply, only commit timing matters.
          // The actual response text is generated externally and stored via
          // recordOpinion(); the dice fields are placeholders.
          return {
            studentId: npc.id,
            delayMs: rollOpinionDelay(npc.stats),
            plannedPick: "A" as Choice,
            rolledTotal: 0,
            rolledDice: [0, 0] as [number, number],
            outcome: "hit" as const,
            answeredAt: null,
          };
        }
        const r = rollNpcAnswer(npc.stats, question.correct ?? "A", statForQuestion(question));
        return {
          studentId: npc.id,
          delayMs: r.delayMs,
          plannedPick: r.pick,
          rolledTotal: r.total,
          rolledStat: r.stat,
          rolledDice: r.dice,
          outcome: r.outcome,
          answeredAt: null,
        };
      });
    }
    return {
      questionId: question.id,
      type: question.type ?? "multiple-choice",
      startedAt,
      durationMs,
      expiresAt: startedAt + durationMs,
      npcs: entries,
      player: { picked: null, answeredAt: null },
      resolved: false,
      resolvedAt: null,
      firstCorrect: null,
      opinionResponses: [],
      opinionGrades: [],
      bestResponder: null,
      stat: statForQuestion(question),
      rarity: question.rarity,
    };
  }

  /** Pose an opinion question. Same shape as pose() but skips A/B/C/D — the
   *  caller is responsible for actually generating + recording opinion
   *  responses and grading via the chat layer. */
  poseOpinion(sessionId: string, input: PoseOpinionInput): QuizState {
    const state = this.getOrCreate(sessionId);
    const id = input.questionId ?? `qo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const facultyId = this.resolveQuestionFaculty(state, input.faculty);
    const subject = this.normalizeQuestionSubject(state, facultyId, input.subject);
    const question: Question = {
      id,
      prompt: input.prompt.trim(),
      type: "opinion",
      rubric: input.rubric?.trim() || undefined,
      subject,
      faculty: facultyId,
      rarity: input.rarity,
    };
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    if (!state.askedQuestionIds.includes(id)) state.askedQuestionIds.push(id);
    state.activeRound = this.openRound(state, question);
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Append an opinion response to the active round (player or NPC). Marks
   *  the responder as locked (for NPCs, sets answeredAt). */
  recordOpinion(sessionId: string, responder: string, text: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return state;
    if (round.opinionResponses.find((r) => r.responder === responder)) return state;
    const now = Date.now();
    // Defensive cap: an opinion response is meant to be 2-3 sentences. The
    // HTTP layer caps the body at 1 MB, but we trim further here so the
    // grading prompt and the persisted state don't bloat. 4 KB ≈ 750 words
    // — far more than any legitimate response.
    const RESPONSE_MAX = 4096;
    const trimmed = text.trim();
    const bounded = trimmed.length > RESPONSE_MAX
      ? trimmed.slice(0, RESPONSE_MAX) + "…"
      : trimmed;
    round.opinionResponses.push({ responder, text: bounded, submittedAt: now });
    if (responder === "player") {
      round.player.answeredAt = now;
    } else {
      const npc = round.npcs.find((n) => n.studentId === responder);
      if (npc) npc.answeredAt = now;
    }
    state.updatedAt = now;
    void this.persistSession(sessionId);
    return state;
  }

  /** Has every required responder submitted an opinion? */
  isOpinionRoundReadyToGrade(sessionId: string): boolean {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return false;
    const requiredIds = ["player", ...round.npcs.map((n) => n.studentId)];
    return requiredIds.every((id) => round.opinionResponses.some((r) => r.responder === id));
  }

  /** Apply the teacher's grading to the round and finalize it. Awards the
   *  player score based on their grade (≥7 = "correct", which advances grade
   *  progress). */
  recordGrades(sessionId: string, grades: OpinionGrade[], bestResponder: string | null): QuizState {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return state;
    round.opinionGrades = grades;
    round.bestResponder = bestResponder;
    const playerGrade = grades.find((g) => g.responder === "player");
    let passed = !!playerGrade && playerGrade.score >= 7;
    let affinitySave: { facultyId: string } | null = null;
    if (!passed && playerGrade && state.character && state.currentGrade) {
      const affinity = state.character.classAffinity?.[state.currentGrade];
      if (affinity && !affinity.used && affinity.facultyId === state.faculty) {
        affinity.used = true;
        affinitySave = { facultyId: state.faculty };
        passed = true;
      }
    }
    const q = state.current;
    if (q) {
      const reviewAt = Date.now();
      const scoreMultiplier = scoreMultiplierForPass(state, passed, reviewAt);
      const record: AnswerRecord = {
        questionId: q.id,
        picked: "A" as Choice, // sentinel — opinion answers don't have a letter
        correct: "A" as Choice,
        wasCorrect: passed,
        at: reviewAt,
      };
      state.history.push(record);
      state.score.total += 1;
      if (passed) state.score.correct += 1;
      this.recordCardReview(state, q, passed ? "good" : "again", record.at, scoreMultiplier);
      // Same progression as MC rounds. Opinion rounds update card mastery
      // through the review rating above; no XP is awarded.
      const progress = this.applyPlayerProgress(state, passed, state.faculty, passed ? 1 : 0);
      if (progress.dailyTicked) {
        // NPCs roll a coin-flip-ish dice; "A" is a neutral sentinel
        // since opinion mode has no correct letter to leak.
        this.applyCohortDaily(state, "A", dailyKey());
      }
      state.lastReveal = {
        questionId: q.id,
        picked: "A" as Choice,
        correct: "A" as Choice,
        wasCorrect: passed,
        explanation: q.rubric ?? null,
        encouragement: affinitySave ? "Class affinity kicked in — second chance counted." : passed ? "Nice essay." : "Take another swing at it tomorrow.",
        scoreMultiplier,
        affinitySave,
      };
    }
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    state.updatedAt = round.resolvedAt;
    void this.persistSession(sessionId);
    return state;
  }

  pickAndPose(sessionId: string, filter: PickAndPoseInput = {}): QuizState {
    if (!this.faculty) {
      throw new Error("FacultyService is not bound. Call setFacultyService() first.");
    }
    const state = this.getOrCreate(sessionId);
    const facultyId = this.resolveQuestionFaculty(state, filter.faculty);
    const importedReviewCourse = this.isImportedReviewCourse(state, facultyId);
    let difficulty = filter.difficulty;
    const allowedDifficulties = !filter.difficulty && state.currentGrade && !importedReviewCourse
      ? difficultiesForGrade(state.currentGrade)
      : undefined;
    if (!difficulty && state.currentGrade && !importedReviewCourse) {
      // Until the bank grows explicit grade tags, difficulty is the year-level
      // proxy: prefer this year's level but allow prior-year material.
      difficulty = difficultyForGrade(state.currentGrade);
    }
    const q = this.pickReviewQuestion(state, facultyId, {
      subject: filter.subject,
      difficulty,
      allowedDifficulties,
    });
    if (!q) {
      throw new Error(
        importedReviewCourse
          ? `No deck cards are ready for ${facultyId} right now.`
          : `No questions ready for {faculty=${facultyId}, subject=${filter.subject ?? "any"}, difficulty=${difficulty ?? "any"}}.`,
      );
    }
    return this.pose(sessionId, {
      prompt: q.prompt,
      options: q.options as Record<Choice, string>,
      correct: q.correct as Choice,
      explanation: q.explanation,
      subject: q.subject,
      stat: q.stat,
      difficulty: q.difficulty,
      faculty: q.faculty,
      questionId: q.id,
    });
  }

  questionBankStatus(sessionId: string, facultyId?: string): QuestionBankStatus {
    const state = this.getOrCreate(sessionId);
    const fid = this.resolveQuestionFaculty(state, facultyId);
    return this.questionBankStatusForState(state, fid);
  }

  private questionBankStatusForState(state: QuizState, fid: string): QuestionBankStatus {
    const pack = packForSession(state);
    const faculty = pack.faculty.find((f) => f.id === fid);
    const imported = this.isImportedReviewCourse(state, fid);
    const allowedDifficulties = state.currentGrade && !imported ? difficultiesForGrade(state.currentGrade) : undefined;
    const questions = this.eligibleCourseQuestions(state, fid, { allowedDifficulties });
    const counts = this.cardCounts(state, fid, questions);
    return {
      mode: imported ? "srs" : "bank",
      facultyId: fid,
      displayName: faculty?.displayName ?? fid,
      total: questions.length,
      asked: counts.asked,
      remaining: counts.ready,
      grade: letterGradeForMastery(questions.length, counts.mastered, counts.shaky, counts.learning),
      readyCount: counts.ready,
      masteredCount: counts.mastered,
      learningCount: counts.learning,
      shakyCount: counts.shaky,
      newCount: counts.fresh,
      defaultDifficulty: state.currentGrade && !imported ? difficultyForGrade(state.currentGrade) : undefined,
      remainingByDifficulty: counts.remainingByDifficulty,
      remainingBySubject: counts.remainingBySubject,
    };
  }

  courseProgress(sessionId: string, facultyId?: string): CourseProgress {
    const status = this.questionBankStatus(sessionId, facultyId);
    return {
      mode: status.mode,
      facultyId: status.facultyId,
      displayName: status.displayName,
      total: status.total,
      ready: status.readyCount ?? status.remaining,
      grade: status.grade,
      mastered: status.masteredCount ?? status.asked,
      learning: status.learningCount ?? 0,
      shaky: status.shakyCount ?? 0,
      new: status.newCount ?? Math.max(0, status.remaining),
    };
  }

  /** Daily-bonus status. This is a once-per-day warm-up question. The
   *  faculty-of-the-day rotation still works the same way (deterministic by
   *  date), so the bonus nudges the player toward different rooms over the week. */
  dailyStatus(sessionId: string, now: Date = new Date()): {
    available: boolean;
    reason?: "completed" | "no-grade" | "no-character";
    facultyId: string;
    dailyKey: string;
  } {
    const state = this.getOrCreate(sessionId);
    const key = dailyKey(now);
    const fac = facultyForDay(key);
    if (!state.character) return { available: false, reason: "no-character", facultyId: fac, dailyKey: key };
    if (!state.currentGrade) return { available: false, reason: "no-grade", facultyId: fac, dailyKey: key };
    if (state.character.lastBonusDate === key) {
      return { available: false, reason: "completed", facultyId: fac, dailyKey: key };
    }
    return { available: true, facultyId: fac, dailyKey: key };
  }

  /** Pose today's daily bonus. Throws if the bonus has already been used today. */
  playBonus(sessionId: string, now: Date = new Date()): QuizState {
    if (!this.faculty) {
      throw new Error("FacultyService is not bound. Call setFacultyService() first.");
    }
    const state = this.getOrCreate(sessionId);
    const status = this.dailyStatus(sessionId, now);
    if (!status.available) {
      throw new Error(`Daily bonus not available: ${status.reason ?? "unknown"}`);
    }
    const facultyId = status.facultyId;
    if (state.faculty !== facultyId) {
      this.setFaculty(sessionId, facultyId);
    }
    const importedReviewCourse = this.isImportedReviewCourse(state, facultyId);
    const q = this.pickReviewQuestion(state, facultyId, {
      allowedDifficulties: state.currentGrade && !importedReviewCourse
        ? difficultiesForGrade(state.currentGrade)
        : undefined,
    });
    if (!q) {
      throw new Error(`No ready review card for ${facultyId}; cannot pose today's bonus.`);
    }
    // Daily bonus guarantees a school-day question; class grades come from
    // the same card mastery path as regular room questions.
    const next = this.pose(sessionId, {
      prompt: q.prompt,
      options: q.options as Record<Choice, string>,
      correct: q.correct as Choice,
      explanation: q.explanation,
      subject: q.subject,
      stat: q.stat,
      difficulty: q.difficulty,
      faculty: q.faculty,
      questionId: q.id,
    });
    if (next.activeRound) {
      next.activeRound.isBonus = true;
    }
    if (state.character) {
      state.character.lastBonusDate = status.dailyKey;
    }
    log.event("bonus.posed", {
      sessionId, faculty: facultyId, dailyKey: status.dailyKey, questionId: q.id,
    });
    return next;
  }

  /** Back-compat alias. Older route handlers and tests call playDaily.
   *  Internally identical to playBonus now. */
  playDaily(sessionId: string, now: Date = new Date()): QuizState {
    return this.playBonus(sessionId, now);
  }

  submitAnswer(sessionId: string, picked: Choice): QuizState {
    const state = this.getOrCreate(sessionId);
    const q = state.current;
    if (!q) throw new Error("No question is currently on the board.");
    if (!CHOICES.includes(picked)) throw new Error(`Pick must be one of ${CHOICES.join(", ")}`);

    // If we don't have an active round (e.g. legacy state, or a manually
    // posed question), open one on the fly so the rest of the pipeline works.
    if (!state.activeRound || state.activeRound.questionId !== q.id) {
      state.activeRound = this.openRound(state, q);
    }
    const round = state.activeRound;
    if (round.resolved) return state;
    if (round.player.answeredAt != null) {
      // Already locked in. Tick + return.
      this.tickRound(state);
      return state;
    }
    if (round.advantage?.eliminated.includes(picked)) {
      throw new Error(`${picked} was crossed out by your advantage roll — pick a different choice.`);
    }
    round.player.picked = picked;
    round.player.answeredAt = Date.now();
    // Tick first so any NPCs whose delay HAS already elapsed lock in honestly.
    this.tickRound(state);
    // Once the player has committed, the race is decided — any NPC still
    // pending committed AFTER the player by definition. Resolve immediately
    // so the teacher reacts in real time instead of stalling for up to 22s
    // waiting on slow NPC delays. resolveRound pins unanswered NPCs to their
    // planned commit time (startedAt + delayMs), preserving the honest race.
    if (!round.resolved) this.resolveRound(state, false);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Force the current round to resolve right now (e.g. user taps a "skip
   *  the wait" button). NPCs whose delay hasn't elapsed get pinned to now. */
  forceResolveRound(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (state.activeRound && !state.activeRound.resolved) {
      this.resolveRound(state, state.activeRound.player.answeredAt == null);
      void this.persistSession(sessionId);
    }
    return state;
  }

  /** Create the player's character sheet. Throws if one already exists. */
  createCharacter(
    sessionId: string,
    input: { name: string; playbookId: string; stats: CharacterStats; arcAnswer: string; flavorQuote?: string; personality: string; portraitDataUrl?: string; mentorAccepted?: boolean },
  ): QuizState {
    const state = this.getOrCreate(sessionId);
    if (state.character) throw new Error("Character already exists for this session.");
    const name = input.name.trim();
    if (!name) throw new Error("Name is required.");
    // Portrait size guard. DynamoDB items are capped at 400KB and the
    // character record carries a chunk of other state — keep the
    // portrait alone under ~280KB so the rest of the record always
    // fits. The client downscales AI portraits before sending; this
    // is the server-side safety net for callers that don't.
    if (input.portraitDataUrl && input.portraitDataUrl.length > 280_000) {
      throw new Error(`portraitDataUrl too large (${input.portraitDataUrl.length} bytes; cap is 280000). Downscale before submitting.`);
    }
    const flavorQuote = input.flavorQuote?.trim();
    // If the player accepted the mentor offer from a graduated previous
    // character, snapshot the mentor info onto the new character. Either
    // way, clear the offer — it's a one-time consume.
    const inheritedFrom = (input.mentorAccepted && state.mentorOffer) ? { ...state.mentorOffer } : undefined;
    state.mentorOffer = null;
    state.character = {
      name,
      playbookId: input.playbookId,
      stats: { ...input.stats },
      arcAnswer: input.arcAnswer.trim(),
      ...(flavorQuote ? { flavorQuote } : {}),
      personality: input.personality.trim(),
      portraitDataUrl: input.portraitDataUrl,
      xp: 0,
      yearbook: [],
      ...(inheritedFrom ? { inheritedFrom } : {}),
      createdAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("character.created", {
      sessionId, characterName: name, playbookId: input.playbookId, mentorAccepted: !!inheritedFrom,
    });
    return state;
  }

  /** Update only the portrait on the existing character. Used when portrait
   *  generation completes after createCharacter (which is fire-and-go). */
  setPortrait(sessionId: string, portraitDataUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character to attach portrait to.");
    state.character.portraitDataUrl = portraitDataUrl;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Reset only the character, keeping grade/score state. Used when the
   *  player rerolls after creation. (Allowed during alpha — graduation
   *  flow will lock this later.) */
  clearCharacter(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    // If the previous character graduated (yearbook full at 4), stash a
    // mentor offer so the next character can optionally inherit their
    // playbook's startingMove. Cleared by createCharacter regardless of
    // whether the offer was accepted.
    const prev = state.character;
    if (prev && (prev.yearbook ?? []).length >= 4) {
      const playbook = PLAYBOOKS.find((p) => p.id === prev.playbookId);
      if (playbook) {
        state.mentorOffer = {
          mentorName: prev.name,
          playbookId: prev.playbookId,
          moveName: playbook.startingMove.name,
          moveDescription: playbook.startingMove.description,
        };
      }
    }
    state.character = null;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  selectGrade(sessionId: string, grade: Grade): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!GRADES.includes(grade)) throw new Error(`Unknown grade: ${grade}`);
    state.currentGrade = grade;
    state.hasSeenIntro = true;
    state.roomBoards = {};
    // Seed the NPC roster for this grade if it doesn't exist yet.
    this.ensureRoster(state, grade);
    // Selecting a grade for the first time leaves the player in their
    // teaching room (whatever faculty was last set, defaulting to Ruby).
    // Subsequent re-selections of the same grade are still transitions —
    // any active question on the board belongs to the previous grade and
    // gets cleared.
    this.transition(state, { kind: "select-grade" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  markIntroSeen(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    state.hasSeenIntro = true;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  clearBoard(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    this.transition(state, { kind: "clear-board" });
    this.discardBoardForFaculty(state, state.faculty);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  resetSession(sessionId: string): QuizState {
    this.sessions.delete(sessionId);
    const state = this.getOrCreate(sessionId);
    void this.persistSession(sessionId);
    return state;
  }

  /** Switch the active content pack for THIS session. Per-session so a
   *  future runtime pack switch (Anki / paid packs) flips only the
   *  relevant session's view; other sessions on the same server stay on
   *  whatever they were on. Caller is expected to have already
   *  registered the pack in the global registry; this method just
   *  records the id + resets transient state that the previous pack's
   *  faculty/rooms pinned. Today only the original pack is registered,
   *  so the meaningful effect is the reset rather than the swap.
   *
   *  Wipes:
   *   - state.faculty (set to the new pack's first teaching faculty —
   *     the previous id may not exist in the new pack)
   *   - state.current / activeRound / lastReveal (question ids are
   *     bank-scoped; previous-pack questions don't exist in the new one)
   *   - state.npcRosters (currentRoom values reference the previous
   *     pack's room layout) — re-seeded for the current grade */
  setActivePackForSession(sessionId: string, packId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    state.activePackId = packId;
    const newPack = packForSession(state);
    const firstFaculty = coursesForPack(newPack)[0]?.facultyId ?? newPack.faculty[0]?.id ?? RUBY_FACULTY.id;
    if (state.faculty !== firstFaculty) {
      state.faculty = firstFaculty;
    }
    state.subject = null;
    state.current = null;
    state.activeRound = null;
    state.lastReveal = null;
    state.roomBoards = {};
    state.npcRosters = {};
    if (state.currentGrade) this.ensureRoster(state, state.currentGrade);
    this.transition(state, { kind: "clear-board" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("pack.session-switched", { sessionId, packId, faculty: state.faculty });
    return state;
  }

  setFaculty(sessionId: string, facultyId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const requestedFacultyId = facultyId;
    const resolvedFacultyId =
      facultyId === LOUNGE_FACULTY.id
        ? facultyId
        : resolveFacultyIdForSession(state, facultyId) ?? facultyId;
    let faculty: FacultyMember | null = null;
    if (resolvedFacultyId === LOUNGE_FACULTY.id) {
      faculty = LOUNGE_FACULTY;
    } else {
      const f = facultyByIdForSession(state, resolvedFacultyId);
      if (f) faculty = toFacultyMember(f);
    }
    if (!faculty) {
      const available = [...facultyForSession(state).map((f) => f.id), LOUNGE_FACULTY.id].join(", ");
      throw new Error(`Unknown faculty: ${requestedFacultyId}. Faculty in your active pack: ${available}.`);
    }
    const previousFacultyId = state.faculty;
    // Walking into a different classroom saves the previous room's chalkboard
    // and restores the destination room's chalkboard, if it has one.
    if (previousFacultyId !== faculty.id) {
      this.saveActiveBoardForFaculty(state, previousFacultyId);
      state.faculty = faculty.id;
      this.transition(state, {
        kind: faculty.id === LOUNGE_FACULTY.id ? "enter-lounge" : "enter-room",
      });
      if (faculty.id !== LOUNGE_FACULTY.id) {
        if (!this.restoreBoardForFaculty(state, faculty.id)) {
          state.subject = null;
        }
      }
    } else {
      state.faculty = faculty.id;
    }
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }
}

// ── transition action space ─────────────────────────────────────────────────
// The state machine is action-driven, not phase-driven. Mutators name what
// the player just did ("clear the board", "pose a question") rather than
// which phase to land in — the phase mapping is internal. Adding new
// product features (bonus flow, Yearbook) means adding actions here, not
// fiddling with module flags scattered across viewer + server.
type TransitionAction =
  | { kind: "select-grade" }
  | { kind: "enter-room" }
  | { kind: "enter-lounge" }
  | { kind: "pose-question" }
  | { kind: "resolve-round" }
  | { kind: "clear-board" }
  | { kind: "reset" };

function nextPhaseFor(action: TransitionAction): Phase {
  switch (action.kind) {
    case "select-grade": return "in-room";
    case "enter-room":   return "in-room";
    case "enter-lounge": return "lounge";
    case "pose-question": return "asking";
    case "resolve-round": return "revealed";
    case "clear-board":  return "in-room";
    case "reset":        return "intro";
  }
}

/** Derive a phase for legacy state files that predate the field. The
 *  mapping mirrors what each scenario would have transitioned to today.
 *  Conservative — when in doubt, lands on "intro" so getOrCreate's first
 *  read can transition forward correctly. */
function derivePhaseForLegacy(s: QuizState): Phase {
  if (s.faculty === LOUNGE_FACULTY.id) return "lounge";
  if (s.activeRound && !s.activeRound.resolved) return "asking";
  if (s.lastReveal) return "revealed";
  if (s.currentGrade) return "in-room";
  return "intro";
}

function normalizeLoaded(s: QuizState): QuizState {
  // Migrate stale K-8 grades from previous schema versions to a high-school
  // grade so the player isn't stranded on a grade that no longer exists.
  const validGrade = (g: unknown): Grade | null =>
    typeof g === "string" && (GRADES as string[]).includes(g) ? (g as Grade) : null;
  const migratedGrade = validGrade(s.currentGrade) ?? (s.currentGrade ? DEFAULT_GRADE : null);
  const migratedCompleted = Array.isArray(s.completedGrades)
    ? (s.completedGrades.map(validGrade).filter((g): g is Grade => !!g))
    : [];
  const phase: Phase = (s.phase as Phase | undefined) ?? derivePhaseForLegacy(s);
  return {
    ...s,
    askedQuestionIds: Array.isArray(s.askedQuestionIds) ? s.askedQuestionIds : [],
    cardMemory: s.cardMemory && typeof s.cardMemory === "object" ? s.cardMemory : {},
    roomBoards: s.roomBoards && typeof s.roomBoards === "object" ? s.roomBoards : {},
    history: Array.isArray(s.history) ? s.history : [],
    score: s.score ?? { correct: 0, total: 0 },
    status: statusForPhase(phase),
    phase,
    phaseToken: typeof s.phaseToken === "number" && s.phaseToken >= 0 ? s.phaseToken : 0,
    lastReveal: s.lastReveal ?? null,
    currentGrade: migratedGrade,
    completedGrades: migratedCompleted,
    hasSeenIntro: !!s.hasSeenIntro,
    activePackId: typeof s.activePackId === "string" ? s.activePackId : null,
    npcRosters: s.npcRosters && typeof s.npcRosters === "object" ? s.npcRosters : {},
    npcCohort: Array.isArray(s.npcCohort) ? s.npcCohort : initialNpcCohort(),
    activeRound: s.activeRound && typeof s.activeRound === "object" ? s.activeRound : null,
    // pendingRoll was added in v0.5.1; older state files don't have it, and
    // the spread above leaves it `undefined` (type says `null`). Coerce so
    // downstream `if (!state.pendingRoll)` checks behave consistently.
    pendingRoll: s.pendingRoll ?? null,
    character: backfillCharacter(s.character ?? null),
  };
}

/** Backfill Paper Card snapshot on legacy yearbook entries written before
 *  the snapshot fields existed. Best-effort: if a player renamed mid-arc,
 *  old cards adopt the current name — that's the intended fallback, not
 *  a migration. New entries always carry their own snapshot. */
function backfillCharacter(c: PlayerCharacter | null): PlayerCharacter | null {
  if (!c) return null;
  if (!Array.isArray(c.yearbook) || c.yearbook.length === 0) return c;
  const yearbook = c.yearbook.map((entry) => ({
    ...entry,
    name: entry.name ?? c.name,
    playbookId: entry.playbookId ?? c.playbookId,
    stats: entry.stats ?? c.stats,
    ...(entry.portraitDataUrl ?? c.portraitDataUrl
      ? { portraitDataUrl: entry.portraitDataUrl ?? c.portraitDataUrl }
      : {}),
    ...(entry.flavorQuote ?? c.flavorQuote
      ? { flavorQuote: entry.flavorQuote ?? c.flavorQuote }
      : {}),
    arcAnswer: entry.arcAnswer ?? c.arcAnswer,
  }));
  return { ...c, yearbook };
}

const ENCOURAGEMENTS_RIGHT = [
  "Great job!",
  "Nice work!",
  "Atta kid.",
  "Smart cookie.",
  "Boom — got it.",
  "Are you cheating?",
  "Hmm. Sure you're not cheating?",
  "Yeah, that's the one.",
  "I knew you could.",
  "OK, star student.",
  "Easy.",
  "Knocked it out of the park.",
  "Sharp.",
  "That tracks.",
  "You're cooking.",
];

const ENCOURAGEMENTS_WRONG = [
  "Close, but no.",
  "Not quite.",
  "Common trap — easy to fall into.",
  "We'll come back to that one.",
  "Don't sweat it.",
  "Trickier than it looks.",
  "Take a breath, try the next one.",
];

function pickEncouragement(wasCorrect: boolean): string {
  const pool = wasCorrect ? ENCOURAGEMENTS_RIGHT : ENCOURAGEMENTS_WRONG;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}
