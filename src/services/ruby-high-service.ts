import { createHash, randomUUID } from "node:crypto";
import { Service, type IAgentRuntime } from "../runtime.js";
import {
  ADVANTAGE_ROLLS_PER_GRADE,
  CHOICES,
  DEFAULT_GRADE,
  daysBetween,
  type Rarity,
  DEFAULT_ROUND_DURATION_MS,
  GRADE_LABELS,
  GRADES,
  LOUNGE_FACULTY,
  OPINION_ROUND_DURATION_MS,
  RUBY_FACULTY,
  difficultiesForGrade,
  difficultyForGrade,
  difficultyWeightsForGrade,
  initialNpcRoster,
  npcsInRoom,
  classifyTotal,
  dailyKey,
  initialNpcCohort,
  letterGradePasses,
  nextGradeAfter,
  npcStatsFor,
  pickEliminatedChoices,
  requiredStreakForGrade,
  roll2d6,
  rollNpcAnswer,
  rollOpinionDelay,
  statusForPhase,
  type ActiveRound,
  type AdvantageRoll,
  type AnswerRecord,
  type BankedQuestion,
  type CardMemory,
  type CardReviewRating,
  type CharacterSlotEntitlements,
  type CharacterStats,
  type Choice,
  type ComicCollection,
  type ComicPageUnlock,
  type ComicPageUnlockReason,
  type DailyClassRecord,
  type DeckCardRole,
  type Difficulty,
  type DifficultyWeights,
  type EssayReport,
  type FacultyMember,
  type Grade,
  type GraduationReward,
  type MashAxis,
  type MashCard,
  type MashTickReason,
  type NpcRoundEntry,
  type NpcStudentState,
  type OpinionGrade,
  type Phase,
  type PlayerCharacter,
  type Question,
  type QuestionMediaAsset,
  type QuestionType,
  type QuizState,
  type RoomBoardSnapshot,
  type RoundOutcome,
  type SchoolEvent,
  type StudentPoolEntry,
  type TeachingRoomId,
  type RubyHighWalletTransaction,
  type RubyHighWalletTransactionKind,
} from "../types.js";
import { FacultyService, toFacultyMember } from "./faculty-service.js";
import {
  getDefaultStateStore,
  type StateStoreLike,
  type StoredCourseSlotRecord,
  type StoredContentPackRecord,
  type StoredDraftContentPackRecord,
  type StoredMetricEventName,
  type StoredMetricEventRecord,
  type StoredPackInstallationRecord,
  type StoredTeacherRecord,
} from "./state-store.js";
import { log, setLogSink, type LogSinkRecord } from "./logger.js";
import { PLAYBOOKS } from "../characters/playbooks.js";
import {
  applyTick as applyMashTick,
  buildSuperlatives as buildMashSuperlatives,
  computeAffinityTicks as computeMashTicks,
  emptyMashCard,
  ensureMashCard,
  resolveAxisForGrade as resolveMashAxisForGrade,
  resolveSeniorBonusAxes as resolveMashSeniorBonusAxes,
} from "../characters/mash.js";
import { studentById } from "../characters/students.js";
import { statForQuestion, normalizeQuestionStat } from "../question-stats.js";
import {
  SRS_AGAIN_MS,
  SRS_ONE_DAY_MS,
  awardSessionScore,
  applyClassRollGradeModifier,
  cardMemoryKey,
  classAverage,
  classGradeQuestionScore,
  classQuestionScore,
  classRollGradeModifier,
  classRecordKey,
  clamp,
  dailyFacultyForQuizState,
  defaultCardMemory,
  dueKnownCard,
  intervalForCorrect,
  judgeTypedAnswer,
  letterGradeForClassRecord,
  letterGradeForClassScore,
  normalizeStoredImageRef,
  requiredClassCompletionsForGrade,
  scoreMultiplierForPass,
} from "./ruby-high/helpers.js";
import {
  activeFaculty,
  appendQuestionToPackBank,
  coursesForPack,
  facultyByIdForSession,
  facultyForSession,
  GUEST_COURSE_ID,
  guestPackForSession,
  isPackLoaded,
  MAX_PACKS_PER_OWNER,
  ORIGINAL_PACK_ID,
  packForSession,
  registerPublicPack,
  registerPack,
  resolveFacultyIdForSession,
  roomForFacultyForSession,
  setActivePack,
  unregisterPack,
} from "../content/registry.js";
import type { ContentPack, PackSourceCard } from "../content/types.js";
import { cardToMcQuestion, type DistractorOpts, type SourceCardInput } from "../content/source-distractors.js";

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
  mode?: "class" | "practice";
}

export interface PoseOpinionInput {
  prompt: string;
  rubric?: string;
  subject?: string;
  faculty?: string;
  questionId?: string;
  rarity?: Rarity;
  mode?: "class" | "practice";
}

export interface PickAndPoseInput {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
  mode?: "class" | "practice";
}

export interface QuestionBankStatus {
  mode: "bank" | "srs";
  facultyId: string;
  displayName: string;
  total: number;
  asked: number;
  remaining: number;
  canPick: boolean;
  nextCardRole?: DeckCardRole;
  grade?: string;
  readyCount?: number;
  masteredCount?: number;
  learningCount?: number;
  shakyCount?: number;
  newCount?: number;
  courseGrade?: string;
  completedClasses?: number;
  requiredClasses?: number;
  averageScore?: number;
  todayClass?: {
    mode: "class" | "practice";
    status: "available" | "active" | "complete";
    date?: string;
    questionCount: number;
    correctCount: number;
    totalQuestions: number;
    practiceCount?: number;
    socialCount?: number;
    letterGrade?: string;
    score?: number;
  };
  defaultDifficulty?: Difficulty;
  difficultyWeights?: DifficultyWeights;
  remainingByDifficulty: Partial<Record<Difficulty, number>>;
  remainingBySubject: Record<string, number>;
}

const SCHOOL_EVENT_LIMIT = 80;
const ESSAY_REPORT_LIMIT = 100;
const WALLET_TRANSACTION_LIMIT = 200;
const STUDENT_POOL_LIMIT = 50;
export const DEFAULT_CHARACTER_SLOT_COUNT = 1;
export const CHARACTER_SLOT_HALL_PASS_COST = 1;
export const CHARACTER_SLOT_PHOTO_DAY_CREDITS = 1;
export const WELCOME_HALL_PASS_GRANT = 5;
export const WELCOME_HALL_PASS_GRANT_ID = "system:welcome-hall-passes:v1";

export interface CourseProgress {
  mode: "bank" | "srs";
  facultyId: string;
  displayName: string;
  total: number;
  ready: number;
  canPick: boolean;
  nextCardRole?: DeckCardRole;
  grade?: string;
  completedClasses: number;
  requiredClasses: number;
  averageScore?: number;
  today: {
    mode: "class" | "practice";
    status: "available" | "active" | "complete";
    date?: string;
    questionCount: number;
    correctCount: number;
    totalQuestions: number;
    practiceCount?: number;
    socialCount?: number;
    letterGrade?: string;
    score?: number;
  };
  mastered: number;
  learning: number;
  shaky: number;
  new: number;
}

interface CourseStanding {
  facultyId: string;
  grade: Grade | null;
  completed: number;
  required: number;
  averageScore?: number;
  letterGrade?: string;
  passed: boolean;
  today: CourseProgress["today"];
}

interface ScheduledPickPlan {
  facultyId: string;
  cardRole: DeckCardRole;
  importedReviewCourse: boolean;
  difficulty?: Difficulty;
  question?: BankedQuestion;
}

export interface DailyStatus {
  available: boolean;
  reason?: "completed" | "no-grade" | "no-character";
  facultyId: string;
  dailyKey: string;
}

export interface HallPassMutationInput {
  amount: number;
  idempotencyKey: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface HallPassMutationResult {
  state: QuizState;
  applied: boolean;
  transaction: RubyHighWalletTransaction;
}

export interface HostedAiAccessActivationInput {
  hallPassCost: number;
  durationMs: number;
  now?: number;
}

export interface HostedAiAccessActivationResult {
  state: QuizState;
  applied: boolean;
  hallPassCost: number;
  expiresAt: number;
  transaction: RubyHighWalletTransaction | null;
}

export interface RubyHighAnalyticsSnapshot {
  store: string;
  loaded: boolean;
  sessions: number;
  updatedLast24h: number;
  characterSessionsUpdatedLast24h: number;
  characterD1Retention: {
    eligibleSessions: number;
    returnedSessions: number;
    rate: number | null;
  };
  retention: {
    characterD1: {
      eligibleSessions: number;
      returnedSessions: number;
      rate: number | null;
    };
    visitorD1: {
      eligibleVisitors: number;
      returnedVisitors: number;
      rate: number | null;
    };
  };
  characters: number;
  graduatedCharacters: number;
  activeRounds: number;
  completedGrades: number;
  essayReports: number;
  questions: {
    correct: number;
    total: number;
    accuracy: number | null;
  };
  wallet: {
    meritStars: number;
    hallPasses: number;
  };
  events: RubyHighMetricEventsSnapshot;
  funnel: {
    first10m: {
      appOpenSessions: number;
      firstCharacterCreated: number;
      firstQuestionAnswered: number;
      firstDailyClassPassed: number;
      firstGradeCompleted: number;
    };
  };
  guestSpotlight: {
    seen: number;
    started: number;
    overrideSet: number;
    startRate: number | null;
  };
  balance: {
    repeatRate: {
      repeatedAnswers: number;
      totalAnswers: number;
      rate: number | null;
    };
    samples: number;
    latestSample?: Record<string, string | number | boolean | null>;
  };
  daily: RubyHighAnalyticsDay[];
}

export interface RubyHighAnalyticsDay {
  date: string;
  updatedSessions: number;
  charactersCreated: number;
  gradesCompleted: number;
  essaysGraded: number;
  appOpens: number;
  sessionResumes: number;
  funnelSteps: number;
  visitorSeen: number;
  yearbookOpens: number;
  yearbookCopies: number;
  guestSpotlightSeen: number;
  guestSpotlightStarted: number;
  commerceEvents: number;
  llmCalls: number;
  llmErrors: number;
  durableErrors: number;
  balanceSamples: number;
}

export interface RubyHighMetricEventsSnapshot {
  total: number;
  byName: Record<StoredMetricEventName, number>;
  appOpen: {
    total: number;
    uniqueSessions: number;
    uniqueVisitors: number;
  };
  sessionResume: {
    total: number;
    uniqueSessions: number;
    uniqueVisitors: number;
  };
  visitorSeen: {
    total: number;
    uniqueVisitors: number;
  };
  funnel: {
    firstCharacterCreated: number;
    firstQuestionAnswered: number;
    firstEssaySubmitted: number;
    firstDailyClassPassed: number;
    firstGradeCompleted: number;
  };
  first10m: {
    appOpenSessions: number;
    firstCharacterCreated: number;
    firstQuestionAnswered: number;
    firstDailyClassPassed: number;
    firstGradeCompleted: number;
  };
  yearbook: {
    opens: number;
    copies: number;
    uniqueVisitors: number;
  };
  guestSpotlight: {
    seen: number;
    started: number;
    overrideSet: number;
  };
  balance: {
    samples: number;
    latestRepeatRate: number | null;
  };
  commerce: {
    events: number;
    hallPassesDelta: number;
    meritStarsDelta: number;
    photoDayCreditsDelta: number;
    amountCents: number;
  };
  llm: {
    calls: number;
    successes: number;
    errors: number;
    byProvider: Record<string, number>;
  };
  errors: {
    total: number;
    byFeature: Record<string, number>;
  };
}

export interface YearbookShareCard {
  shareId: string;
  grade: Grade;
  completedAt: number;
  characterName: string;
  playbookId: string | null;
  summary: { correct: number; total: number };
  stats?: CharacterStats;
  portraitDataUrl?: string;
  flavorQuote?: string;
  arcAnswer?: string;
  subjectScores?: Record<string, { correct: number; total: number }>;
  graduationReward?: GraduationReward;
  superlatives: string[];
  source: "current-character" | "student-pool";
}

export interface CharacterSlotUnlockInput {
  requestId?: string;
  now?: number;
}

export interface CharacterSlotUnlockResult {
  state: QuizState;
  applied: boolean;
  hallPassCost: number;
  slots: CharacterSlotEntitlements;
  transaction: RubyHighWalletTransaction;
}

export interface PhotoDayCreditMutationInput {
  amount?: number;
  idempotencyKey: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface PhotoDayCreditMutationResult {
  state: QuizState;
  applied: boolean;
  transaction: RubyHighWalletTransaction;
  slots: CharacterSlotEntitlements;
}

interface DailyClassUpdate {
  mode: "class" | "practice";
  cardRole?: DeckCardRole;
  facultyId: string;
  grade?: Grade;
  date?: string;
  questionCount?: number;
  totalQuestions?: number;
  completed?: boolean;
  letterGrade?: string;
  score?: number;
  passedClass?: boolean;
}

type MetricEventInput = Omit<StoredMetricEventRecord, "id" | "name" | "occurredAt" | "day" | "metadata"> & {
  occurredAt?: number;
  metadata?: Record<string, unknown>;
};

const GLOBAL_PACK_OWNER = "__ruby_high_global__";
const CLASS_QUESTIONS_PER_DAY = 3;
const RUBY_HOMEROOM_PRACTICE_BEFORE_CLASS: readonly number[] = [2, 4, 6] as const;
const RUBY_HOMEROOM_SOCIAL_CARDS_PER_DAY = 1;
const FIRST_BELL_COMIC_ISSUE_ID = "first-bell";
const FIRST_BELL_COMIC_TITLE = "Ruby High: Book One - First Bell";
const FIRST_BELL_COMIC_PAGE_COUNT = 12;
const COMIC_CLASS_LABELS: Record<string, string> = {
  ruby: "Homeroom",
  "sally-science": "Science",
  "professor-edward": "Literature",
};
const TEACHER_STORY_COMIC_PAGES: Record<string, Partial<Record<Grade, number>>> = {
  ruby: { "9": 1, "11": 4 },
  "sally-science": { "9": 2, "11": 5 },
  "professor-edward": { "9": 3, "11": 6 },
};
const STUDENT_INSERT_COMIC_PAGES: Record<string, number> = {
  lyra: 7,
  sami: 8,
  ravi: 9,
  indra: 10,
  mika: 11,
  noor: 12,
};

export function advantageRollsForState(state: QuizState): { used: number; cap: number; remaining: number } {
  const grade = state.currentGrade;
  const used = (grade && state.character?.advantageRollsUsed?.[grade]) ?? 0;
  const bonus = (grade && state.character?.advantageRollBonuses?.[grade]) ?? 0;
  const cap = ADVANTAGE_ROLLS_PER_GRADE + Math.max(0, bonus);
  return { used, cap, remaining: Math.max(0, cap - used) };
}

export function dailyStatusForState(state: QuizState, now: Date = new Date()): DailyStatus {
  const key = dailyKey(now);
  const fac = dailyFacultyForQuizState(state, key);
  if (!state.character) return { available: false, reason: "no-character", facultyId: fac, dailyKey: key };
  if (!state.currentGrade) return { available: false, reason: "no-grade", facultyId: fac, dailyKey: key };
  if (state.character.lastBonusDate === key) {
    return { available: false, reason: "completed", facultyId: fac, dailyKey: key };
  }
  return { available: true, facultyId: fac, dailyKey: key };
}

export class RubyHighService extends Service {
  static override readonly serviceType = "ruby-high";

  override readonly capabilityDescription =
    "Ruby High classroom state: tracks the active question, the student's answer, wallet, and which faculty member is on the floor.";

  private readonly sessions = new Map<string, QuizState>();
  private readonly store: StateStoreLike;
  private readonly backgroundWrites = new Set<Promise<void>>();
  private readonly metricEvents = new Map<string, StoredMetricEventRecord>();
  private readonly disposeLogSink: () => void;
  private faculty: FacultyService | null = null;
  private loaded = false;

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? getDefaultStateStore();
    this.disposeLogSink = setLogSink((record) => this.recordLogSinkMetricEvent(record));
  }

  static async start(runtime: IAgentRuntime): Promise<RubyHighService> {
    const svc = new RubyHighService(runtime);
    await svc.hydrate();
    return svc;
  }

  async stop(): Promise<void> {
    await this.persistAll();
    this.disposeLogSink();
    this.sessions.clear();
    this.metricEvents.clear();
  }

  /** Wait for any in-flight persistence writes to flush. Useful in tests. */
  async flush(): Promise<void> {
    await this.persistAll();
    if (typeof this.store.flush === "function") await this.store.flush();
    await Promise.allSettled(Array.from(this.backgroundWrites));
  }

  /** Persist one session before returning an HTTP mutation response. The
   *  store debounces saveSession; we drain it here so the awaited promise
   *  doesn't wait the full debounce window for a fire-and-forget caller. */
  async flushSession(sessionId: string): Promise<void> {
    const promise = this.persistSession(sessionId, { surfaceErrors: true });
    if (typeof this.store.flush === "function") await this.store.flush();
    await promise;
  }

  recordAppOpen(
    sessionId: string,
    input: { source?: string; userAgent?: string; referrer?: string; path?: string; visitorHash?: string | null } = {},
  ): void {
    if (input.visitorHash) {
      this.recordMetricEvent("visitor_seen", {
        sessionId,
        visitorHash: input.visitorHash,
        source: input.source ?? "viewer",
        feature: "viewer",
      });
    }
    this.recordMetricEvent("app_open", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: input.source ?? "viewer",
      feature: "viewer",
      metadata: {
        ...(input.path ? { path: clippedMetricValue(input.path, 180) } : {}),
        ...(input.referrer ? { referrer: clippedMetricValue(input.referrer, 180) } : {}),
        ...(input.userAgent ? { userAgent: clippedMetricValue(input.userAgent, 180) } : {}),
      },
    });
  }

  async recordAppOpenDurably(
    sessionId: string,
    input: { source?: string; userAgent?: string; referrer?: string; path?: string; visitorHash?: string | null } = {},
  ): Promise<void> {
    if (input.visitorHash) {
      await this.recordMetricEventDurably("visitor_seen", {
        sessionId,
        visitorHash: input.visitorHash,
        source: input.source ?? "viewer",
        feature: "viewer",
      });
    }
    await this.recordMetricEventDurably("app_open", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: input.source ?? "viewer",
      feature: "viewer",
      metadata: {
        ...(input.path ? { path: clippedMetricValue(input.path, 180) } : {}),
        ...(input.referrer ? { referrer: clippedMetricValue(input.referrer, 180) } : {}),
        ...(input.userAgent ? { userAgent: clippedMetricValue(input.userAgent, 180) } : {}),
      },
    });
  }

  recordSessionResume(
    sessionId: string,
    input: { source?: string; inactiveMs?: number; reason?: string; visitorHash?: string | null } = {},
  ): void {
    if (input.visitorHash) {
      this.recordMetricEvent("visitor_seen", {
        sessionId,
        visitorHash: input.visitorHash,
        source: input.source ?? "viewer",
        feature: "viewer",
      });
    }
    this.recordMetricEvent("session_resume", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: input.source ?? "viewer",
      feature: "viewer",
      metadata: {
        ...(typeof input.inactiveMs === "number" && Number.isFinite(input.inactiveMs)
          ? { inactiveMs: Math.max(0, Math.floor(input.inactiveMs)) }
          : {}),
        ...(input.reason ? { reason: clippedMetricValue(input.reason, 80) } : {}),
      },
    });
  }

  async recordSessionResumeDurably(
    sessionId: string,
    input: { source?: string; inactiveMs?: number; reason?: string; visitorHash?: string | null } = {},
  ): Promise<void> {
    if (input.visitorHash) {
      await this.recordMetricEventDurably("visitor_seen", {
        sessionId,
        visitorHash: input.visitorHash,
        source: input.source ?? "viewer",
        feature: "viewer",
      });
    }
    await this.recordMetricEventDurably("session_resume", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: input.source ?? "viewer",
      feature: "viewer",
      metadata: {
        ...(typeof input.inactiveMs === "number" && Number.isFinite(input.inactiveMs)
          ? { inactiveMs: Math.max(0, Math.floor(input.inactiveMs)) }
          : {}),
        ...(input.reason ? { reason: clippedMetricValue(input.reason, 80) } : {}),
      },
    });
  }

  recordYearbookOpen(sessionId: string, input: { visitorHash?: string | null; shareId?: string; grade?: string } = {}): void {
    this.recordMetricEvent("yearbook_open", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "yearbook",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
      },
    });
  }

  async recordYearbookOpenDurably(sessionId: string, input: { visitorHash?: string | null; shareId?: string; grade?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("yearbook_open", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "yearbook",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
      },
    });
  }

  recordYearbookCopy(sessionId: string, input: { visitorHash?: string | null; shareId?: string; grade?: string } = {}): void {
    this.recordMetricEvent("yearbook_copy", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "yearbook",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
      },
    });
  }

  async recordYearbookCopyDurably(sessionId: string, input: { visitorHash?: string | null; shareId?: string; grade?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("yearbook_copy", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "yearbook",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
      },
    });
  }

  recordGuestSpotlightSeen(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): void {
    this.recordMetricEvent("guest_spotlight_seen", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  async recordGuestSpotlightSeenDurably(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("guest_spotlight_seen", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  recordGuestSpotlightStarted(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): void {
    this.recordMetricEvent("guest_spotlight_started", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  async recordGuestSpotlightStartedDurably(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("guest_spotlight_started", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  recordGuestPackOverrideSet(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): void {
    this.recordMetricEvent("guest_pack_override_set", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  async recordGuestPackOverrideSetDurably(sessionId: string, input: { visitorHash?: string | null; packId?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("guest_pack_override_set", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "guest_faculty",
      status: "success",
      metadata: input.packId ? { packId: clippedMetricValue(input.packId, 120) } : {},
    });
  }

  recordBalanceSample(input: { source?: string; metadata?: Record<string, unknown> } = {}): void {
    this.recordMetricEvent("balance_sample", {
      source: input.source ?? "script",
      feature: "balance",
      status: "success",
      metadata: input.metadata ?? {},
    });
  }

  async recordBalanceSampleDurably(input: { source?: string; metadata?: Record<string, unknown> } = {}): Promise<void> {
    await this.recordMetricEventDurably("balance_sample", {
      source: input.source ?? "script",
      feature: "balance",
      status: "success",
      metadata: input.metadata ?? {},
    });
  }

  recordMetricEvent(
    name: StoredMetricEventName,
    input: MetricEventInput = {},
  ): StoredMetricEventRecord | null {
    const event = this.buildMetricEvent(name, input);
    if (!event) return null;
    void this.persistMetricEvent(event, { surfaceErrors: false });
    return event;
  }

  async recordMetricEventDurably(
    name: StoredMetricEventName,
    input: MetricEventInput = {},
  ): Promise<StoredMetricEventRecord | null> {
    const event = this.buildMetricEvent(name, input);
    if (!event) return null;
    try {
      await this.persistMetricEvent(event, { surfaceErrors: true });
    } catch (err) {
      this.metricEvents.delete(event.id);
      throw err;
    }
    return event;
  }

  private buildMetricEvent(name: StoredMetricEventName, input: MetricEventInput): StoredMetricEventRecord | null {
    if (!this.store.saveMetricEvent) return null;
    const occurredAt = normalizeMetricTimestamp(input.occurredAt);
    const event: StoredMetricEventRecord = {
      id: metricEventId(name, occurredAt),
      name,
      occurredAt,
      day: isoDate(occurredAt),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.feature ? { feature: input.feature } : {}),
      ...(input.step ? { step: input.step } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? { durationMs: Math.max(0, Math.floor(input.durationMs)) } : {}),
      ...(typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus) ? { httpStatus: Math.floor(input.httpStatus) } : {}),
      ...(typeof input.hallPassesDelta === "number" && Number.isFinite(input.hallPassesDelta) ? { hallPassesDelta: Math.floor(input.hallPassesDelta) } : {}),
      ...(typeof input.meritStarsDelta === "number" && Number.isFinite(input.meritStarsDelta) ? { meritStarsDelta: Math.floor(input.meritStarsDelta) } : {}),
      ...(typeof input.photoDayCreditsDelta === "number" && Number.isFinite(input.photoDayCreditsDelta) ? { photoDayCreditsDelta: Math.floor(input.photoDayCreditsDelta) } : {}),
      ...(typeof input.amountCents === "number" && Number.isFinite(input.amountCents) ? { amountCents: Math.floor(input.amountCents) } : {}),
      ...(input.metadata ? { metadata: normalizeMetricMetadata(input.metadata) } : {}),
    };
    this.metricEvents.set(event.id, event);
    return event;
  }

  private persistMetricEvent(event: StoredMetricEventRecord, options: { surfaceErrors: boolean }): Promise<void> {
    const save = this.store.saveMetricEvent!(event).catch((err) => {
      log.error("metrics.persist-failed", err, { eventName: event.name });
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    if (options.surfaceErrors && typeof this.store.flush === "function") {
      return Promise.all([save, this.store.flush()]).then(() => undefined);
    }
    return save;
  }

  private recordLogSinkMetricEvent(record: LogSinkRecord): void {
    if (record.level === "error") {
      if (record.name === "metrics.persist-failed" || record.name === "logger.sink-failed") return;
      this.recordMetricEvent("error", {
        occurredAt: Date.parse(record.ts),
        source: "logger",
        feature: record.name,
        status: "error",
        metadata: {
          logName: clippedMetricValue(record.name, 120),
          message: clippedMetricValue(String(record.data.message ?? ""), 240),
        },
      });
      return;
    }
    if (record.name !== "llm.usage") return;
    this.recordMetricEvent("llm_usage", {
      occurredAt: Date.parse(record.ts),
      source: "logger",
      feature: metricString(record.data.feature) ?? metricString(record.data.label) ?? "llm",
      provider: metricString(record.data.provider),
      model: metricString(record.data.model),
      status: record.data.status === "error" ? "error" : "success",
      durationMs: metricNumber(record.data.durationMs),
      httpStatus: metricNumber(record.data.httpStatus),
      metadata: {
        label: metricString(record.data.label),
        mode: metricString(record.data.mode),
      },
    });
  }

  private recordFunnelStep(state: QuizState, step: string, metadata: Record<string, unknown> = {}): void {
    if (this.hasMetricEventForSession(state.sessionId, "funnel_step", step)) return;
    this.recordMetricEvent("funnel_step", {
      sessionId: state.sessionId,
      feature: "activation",
      step,
      status: "success",
      metadata,
    });
  }

  private hasMetricEventForSession(sessionId: string, name: StoredMetricEventName, step?: string): boolean {
    for (const event of this.metricEvents.values()) {
      if (event.sessionId !== sessionId || event.name !== name) continue;
      if (step && event.step !== step) continue;
      return true;
    }
    return false;
  }

  analyticsSnapshot(now: number = Date.now()): RubyHighAnalyticsSnapshot {
    const dayMs = 24 * 60 * 60 * 1000;
    const { days, byDate } = buildRubyHighDailyBuckets(now, 14);
    let updatedLast24h = 0;
    let characterSessionsUpdatedLast24h = 0;
    let eligibleCharacterSessions = 0;
    let returnedCharacterSessions = 0;
    let characters = 0;
    let graduatedCharacters = 0;
    let activeRounds = 0;
    let completedGrades = 0;
    let essayReports = 0;
    let correct = 0;
    let total = 0;
    let answerEvents = 0;
    let repeatedAnswers = 0;
    let meritStars = 0;
    let hallPasses = 0;
    for (const state of this.sessions.values()) {
      const updatedAt = Number(state.updatedAt ?? 0);
      if (now - updatedAt <= dayMs) updatedLast24h += 1;
      incrementRubyHighDay(byDate, updatedAt, "updatedSessions");
      if (state.character) {
        characters += 1;
        const characterCreatedAt = Number(state.character.createdAt ?? 0);
        if (now - updatedAt <= dayMs) characterSessionsUpdatedLast24h += 1;
        if (Number.isFinite(characterCreatedAt) && characterCreatedAt > 0 && now - characterCreatedAt >= dayMs) {
          eligibleCharacterSessions += 1;
          if (updatedAt - characterCreatedAt >= dayMs) returnedCharacterSessions += 1;
        }
        const yearbookCount = Array.isArray(state.character.yearbook) ? state.character.yearbook.length : 0;
        completedGrades += yearbookCount;
        if (yearbookCount >= GRADES.length) graduatedCharacters += 1;
        incrementRubyHighDay(byDate, characterCreatedAt, "charactersCreated");
        for (const entry of state.character.yearbook ?? []) {
          incrementRubyHighDay(byDate, Number(entry.completedAt), "gradesCompleted");
        }
      }
      for (const pooled of state.studentPool ?? []) {
        incrementRubyHighDay(byDate, Number(pooled.createdAt), "charactersCreated");
        for (const entry of pooled.yearbook ?? []) {
          incrementRubyHighDay(byDate, Number(entry.completedAt), "gradesCompleted");
        }
      }
      if (state.activeRound && !state.activeRound.resolved) activeRounds += 1;
      const reports = Array.isArray(state.essayReports) ? state.essayReports : [];
      essayReports += reports.length;
      for (const report of reports) {
        incrementRubyHighDay(byDate, Number(report.gradedAt ?? report.submittedAt), "essaysGraded");
      }
      correct += Math.max(0, Math.floor(Number(state.score?.correct ?? 0)));
      total += Math.max(0, Math.floor(Number(state.score?.total ?? 0)));
      const seenQuestionIds = new Set<string>();
      for (const answer of Array.isArray(state.history) ? state.history : []) {
        if (!answer?.questionId) continue;
        answerEvents += 1;
        if (seenQuestionIds.has(answer.questionId)) repeatedAnswers += 1;
        else seenQuestionIds.add(answer.questionId);
      }
      const wallet = normalizeWallet(state.wallet, state.score?.points ?? 0);
      meritStars += wallet.meritStars;
      hallPasses += wallet.hallPasses;
    }
    const events = buildMetricEventsSnapshot(this.metricEvents.values(), byDate);
    const eventRetention = buildEventRetentionSnapshot(this.metricEvents.values(), now);
    return {
      store: this.store.describe(),
      loaded: this.loaded,
      sessions: this.sessions.size,
      updatedLast24h,
      characterSessionsUpdatedLast24h,
      characterD1Retention: {
        eligibleSessions: eligibleCharacterSessions,
        returnedSessions: returnedCharacterSessions,
        rate: eligibleCharacterSessions > 0 ? returnedCharacterSessions / eligibleCharacterSessions : null,
      },
      retention: {
        characterD1: eventRetention.characterD1.eligibleSessions > 0
          ? eventRetention.characterD1
          : {
              eligibleSessions: eligibleCharacterSessions,
              returnedSessions: returnedCharacterSessions,
              rate: eligibleCharacterSessions > 0 ? returnedCharacterSessions / eligibleCharacterSessions : null,
            },
        visitorD1: eventRetention.visitorD1,
      },
      characters,
      graduatedCharacters,
      activeRounds,
      completedGrades,
      essayReports,
      questions: {
        correct,
        total,
        accuracy: total > 0 ? correct / total : null,
      },
      wallet: {
        meritStars,
        hallPasses,
      },
      events,
      funnel: {
        first10m: events.first10m,
      },
      guestSpotlight: {
        seen: events.guestSpotlight.seen,
        started: events.guestSpotlight.started,
        overrideSet: events.guestSpotlight.overrideSet,
        startRate: events.guestSpotlight.seen > 0 ? events.guestSpotlight.started / events.guestSpotlight.seen : null,
      },
      balance: {
        repeatRate: {
          repeatedAnswers,
          totalAnswers: answerEvents,
          rate: answerEvents > 0 ? repeatedAnswers / answerEvents : null,
        },
        samples: events.balance.samples,
        ...(events.balance.latestRepeatRate != null ? { latestSample: { repeatRate: events.balance.latestRepeatRate } } : {}),
      },
      daily: days,
    };
  }

  yearbookSharesForSession(sessionId: string): YearbookShareCard[] {
    const state = this.getOrCreate(sessionId);
    return yearbookShareCardsForState(state);
  }

  findYearbookShare(shareId: string, grade: Grade): YearbookShareCard | null {
    const clean = shareId.trim();
    if (!clean) return null;
    for (const state of this.sessions.values()) {
      const hit = yearbookShareCardsForState(state).find((card) =>
        card.shareId === clean && card.grade === grade
      );
      if (hit) return hit;
    }
    return null;
  }

  hallPassBalance(sessionId: string): number {
    return Math.max(0, Math.floor(Number(this.getOrCreate(sessionId).wallet?.hallPasses ?? 0)));
  }

  characterSlotEntitlements(sessionId: string): CharacterSlotEntitlements {
    const state = this.getOrCreate(sessionId);
    state.characterSlots = normalizeCharacterSlots(state.characterSlots);
    return { ...state.characterSlots };
  }

  photoDayCreditBalance(sessionId: string): number {
    return this.characterSlotEntitlements(sessionId).photoDayCredits;
  }

  walletTransaction(sessionId: string, idempotencyKey: string): RubyHighWalletTransaction | null {
    const id = idempotencyKey.trim();
    if (!id) return null;
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    return state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id) ?? null;
  }

  walletTransactionOwner(idempotencyKey: string): { sessionId: string; transaction: RubyHighWalletTransaction } | null {
    const id = idempotencyKey.trim();
    if (!id) return null;
    for (const [sessionId, state] of this.sessions.entries()) {
      state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
      const transaction = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id) ?? null;
      if (transaction) return { sessionId, transaction };
    }
    return null;
  }

  recordWalletMarker(
    sessionId: string,
    input: {
      idempotencyKey: string;
      kind: RubyHighWalletTransactionKind;
      meritStars?: number;
      hallPasses?: number;
      photoDayCredits?: number;
      source?: RubyHighWalletTransaction["source"];
      description?: string;
      metadata?: RubyHighWalletTransaction["metadata"];
      at?: number;
      display?: boolean;
    },
  ): { state: QuizState; applied: boolean; transaction: RubyHighWalletTransaction } {
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Wallet marker idempotency key is required.");
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };

    const transaction: RubyHighWalletTransaction = {
      id,
      kind: input.kind,
      at: typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now(),
      ...(typeof input.meritStars === "number" && Number.isFinite(input.meritStars)
        ? { meritStars: Math.floor(input.meritStars) }
        : {}),
      ...(typeof input.hallPasses === "number" && Number.isFinite(input.hallPasses)
        ? { hallPasses: Math.floor(input.hallPasses) }
        : {}),
      ...(typeof input.photoDayCredits === "number" && Number.isFinite(input.photoDayCredits)
        ? { photoDayCredits: Math.floor(input.photoDayCredits) }
        : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    if (input.display === false) {
      const ledger = state.wallet.operationLedger ?? {};
      ledger[transaction.id] = { ...transaction, ...(transaction.metadata ? { metadata: { ...transaction.metadata } } : {}) };
      state.wallet.operationLedger = ledger;
    } else {
      recordWalletTransaction(state, transaction);
    }
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "wallet",
      feature: transaction.kind,
      status: "success",
      hallPassesDelta: Math.floor(Number(transaction.hallPasses ?? 0)),
      meritStarsDelta: Math.floor(Number(transaction.meritStars ?? 0)),
      photoDayCreditsDelta: Math.floor(Number(transaction.photoDayCredits ?? 0)),
      metadata: { transactionId: transaction.id },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction };
  }

  annotateWalletTransaction(
    sessionId: string,
    idempotencyKey: string,
    metadata: RubyHighWalletTransaction["metadata"],
  ): RubyHighWalletTransaction | null {
    const id = idempotencyKey.trim();
    if (!id) return null;
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const tx = state.wallet.transactions?.find((entry) => entry.id === id) ?? null;
    const ledgerTx = state.wallet.operationLedger?.[id] ?? null;
    if (!tx && !ledgerTx) return null;
    const normalized = normalizeWalletMetadata(metadata);
    const nextMetadata = {
      ...((tx ?? ledgerTx)?.metadata ?? {}),
      ...(normalized ?? {}),
    };
    if (tx) tx.metadata = nextMetadata;
    if (ledgerTx) ledgerTx.metadata = nextMetadata;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return ledgerTx ?? tx;
  }

  hostedAiAccessExpiresAt(sessionId: string, now = Date.now()): number | null {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const expiresAt = Math.floor(Number(state.wallet.hostedAiAccessExpiresAt ?? 0));
    return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : null;
  }

  unlockCharacterSlot(sessionId: string, input: CharacterSlotUnlockInput = {}): CharacterSlotUnlockResult {
    const now = typeof input.now === "number" && Number.isFinite(input.now) ? Math.floor(input.now) : Date.now();
    const state = this.getOrCreate(sessionId);
    state.characterSlots = normalizeCharacterSlots(state.characterSlots);
    const nextSlot = state.characterSlots.unlockedSlots + 1;
    const requestId = normalizeIdempotencyPart(input.requestId) || String(now);
    const spend = this.applyHallPassTransaction(sessionId, "hall-pass-spend", {
      amount: CHARACTER_SLOT_HALL_PASS_COST,
      idempotencyKey: `character-slot:${sessionId}:${requestId}`,
      source: "character-slot",
      description: `Character slot ${nextSlot}`,
      at: now,
      metadata: {
        slotNumber: nextSlot,
        photoDayCredits: CHARACTER_SLOT_PHOTO_DAY_CREDITS,
      },
    });
    if (spend.applied) {
      spend.state.characterSlots = normalizeCharacterSlots(spend.state.characterSlots);
      spend.state.characterSlots.unlockedSlots += 1;
      spend.state.characterSlots.photoDayCredits += CHARACTER_SLOT_PHOTO_DAY_CREDITS;
      spend.state.updatedAt = Date.now();
      void this.persistSession(sessionId);
    }
    return {
      state: spend.state,
      applied: spend.applied,
      hallPassCost: CHARACTER_SLOT_HALL_PASS_COST,
      slots: normalizeCharacterSlots(spend.state.characterSlots),
      transaction: spend.transaction,
    };
  }

  consumePhotoDayCredit(sessionId: string, input: PhotoDayCreditMutationInput): PhotoDayCreditMutationResult {
    return this.applyPhotoDayCreditTransaction(sessionId, "photo-day-spend", input);
  }

  refundPhotoDayCredit(sessionId: string, input: PhotoDayCreditMutationInput): PhotoDayCreditMutationResult {
    return this.applyPhotoDayCreditTransaction(sessionId, "photo-day-refund", input);
  }

  activateHostedAiAccess(sessionId: string, input: HostedAiAccessActivationInput): HostedAiAccessActivationResult {
    const now = typeof input.now === "number" && Number.isFinite(input.now) ? Math.floor(input.now) : Date.now();
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = this.hostedAiAccessExpiresAt(sessionId, now);
    const hallPassCost = normalizePositiveInteger(input.hallPassCost, "Hosted AI Hall Pass cost");
    if (existing) {
      return {
        state,
        applied: false,
        hallPassCost,
        expiresAt: existing,
        transaction: null,
      };
    }
    const durationMs = normalizePositiveInteger(input.durationMs, "Hosted AI duration");
    const spend = this.applyHallPassTransaction(sessionId, "hall-pass-spend", {
      amount: hallPassCost,
      idempotencyKey: `hosted-ai:access:${sessionId}:${now}`,
      source: "hosted-ai",
      description: "AI Access",
      at: now,
      metadata: {
        durationMs,
      },
    });
    const expiresAt = now + durationMs;
    spend.state.wallet.hostedAiAccessExpiresAt = expiresAt;
    spend.state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return {
      state: spend.state,
      applied: spend.applied,
      hallPassCost,
      expiresAt,
      transaction: spend.transaction,
    };
  }

  grantHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-grant", input);
  }

  spendHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-spend", input);
  }

  refundHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-refund", input);
  }

  revokeHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-revoke", input);
  }

  private applyHallPassTransaction(
    sessionId: string,
    kind: RubyHighWalletTransactionKind,
    input: HallPassMutationInput,
  ): HallPassMutationResult {
    const state = this.getOrCreate(sessionId);
    const amount = normalizePositiveInteger(input.amount, "Hall Pass amount");
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Hall Pass transaction idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };

    const current = Math.max(0, Math.floor(Number(state.wallet.hallPasses ?? 0)));
    if (kind === "hall-pass-spend" && current < amount) {
      throw new Error(`Not enough Hall Passes. Need ${amount}, have ${current}.`);
    }
    const appliedAmount = kind === "hall-pass-revoke" ? Math.min(current, amount) : amount;
    const transaction: RubyHighWalletTransaction = {
      id,
      kind,
      at: typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now(),
      hallPasses: kind === "hall-pass-spend" || kind === "hall-pass-revoke" ? -appliedAmount : appliedAmount,
      ...(input.source ? { source: input.source } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    state.wallet.hallPasses = kind === "hall-pass-spend" || kind === "hall-pass-revoke"
      ? current - appliedAmount
      : current + appliedAmount;
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "wallet",
      feature: transaction.kind,
      status: "success",
      hallPassesDelta: transaction.hallPasses ?? 0,
      metadata: { transactionId: transaction.id },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction };
  }

  private applyPhotoDayCreditTransaction(
    sessionId: string,
    kind: Extract<RubyHighWalletTransactionKind, "photo-day-spend" | "photo-day-refund">,
    input: PhotoDayCreditMutationInput,
  ): PhotoDayCreditMutationResult {
    const state = this.getOrCreate(sessionId);
    const amount = normalizePositiveInteger(input.amount ?? 1, "Photo Day credit amount");
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Photo Day credit transaction idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    state.characterSlots = normalizeCharacterSlots(state.characterSlots);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) {
      return {
        state,
        applied: false,
        transaction: existing,
        slots: normalizeCharacterSlots(state.characterSlots),
      };
    }

    const current = Math.max(0, Math.floor(Number(state.characterSlots.photoDayCredits ?? 0)));
    if (kind === "photo-day-spend" && current < amount) {
      throw new Error(`Not enough Photo Day credits. Need ${amount}, have ${current}.`);
    }
    const transaction: RubyHighWalletTransaction = {
      id,
      kind,
      at: typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now(),
      photoDayCredits: kind === "photo-day-spend" ? -amount : amount,
      source: input.source ?? "photo-day",
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    state.characterSlots.photoDayCredits = kind === "photo-day-spend"
      ? current - amount
      : current + amount;
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "photo-day",
      feature: transaction.kind,
      status: "success",
      photoDayCreditsDelta: transaction.photoDayCredits ?? 0,
      metadata: { transactionId: transaction.id },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return {
      state,
      applied: true,
      transaction,
      slots: normalizeCharacterSlots(state.characterSlots),
    };
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
    return advantageRollsForState(this.getOrCreate(sessionId));
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

  /** Resolve the player's pending DM-roll. Produces a roll result for
   *  narration only — progression is gated on letter-grade mastery. */
  resolvePendingRoll(sessionId: string): { state: QuizState; result: { stat: keyof CharacterStats; dice: [number, number]; total: number; outcome: RoundOutcome; reason: string } | null } {
    const state = this.getOrCreate(sessionId);
    const pr = state.pendingRoll;
    if (!pr || !state.character) return { state, result: null };
    const r = roll2d6();
    const total = r.total + state.character.stats[pr.stat];
    const outcome: RoundOutcome = total >= pr.dc + 3 ? "hit" : total >= pr.dc ? "mixed" : "miss";
    state.pendingRoll = null;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return {
      state,
      result: { stat: pr.stat, dice: r.dice, total, outcome, reason: pr.reason },
    };
  }

  /**
   * Bind the FacultyService once both services are registered. Called by the
   * app bootstrap after both `Service.start()` calls return. Lets RubyHighService
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
          } else if (record.ownerSessionId === null) {
            registerPublicPack(record.pack, record.touchedAt);
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
    const storedMetricEvents = await this.store.loadMetricEvents?.();
    for (const event of storedMetricEvents ?? []) {
      this.metricEvents.set(event.id, event);
    }
    this.loaded = true;
    if (repaired) await this.persistAll();
  }

  private reconcileLoadedPackState(state: QuizState): boolean {
    const resolvedPack = packForSession(state);
    let repaired = false;
    if (state.activePackId && state.activePackId !== ORIGINAL_PACK_ID && resolvedPack.id !== state.activePackId) {
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
  private persistSession(sessionId: string, opts?: { surfaceErrors?: boolean }): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return Promise.resolve();
    const save = this.store.saveSession(state);
    // Background callers fire-and-forget with `void this.persistSession(id)`;
    // keep those paths non-fatal. Awaited HTTP paths pass surfaceErrors so
    // the route can return a storage failure instead of pretending the
    // mutation durably landed.
    if (opts?.surfaceErrors) {
      return save.catch((err) => {
        log.error("ruby-high.persist-failed", err, { sessionId });
        throw err;
      });
    }
    const handled = save.catch((err) => {
      log.error("ruby-high.persist-failed", err, { sessionId });
    });
    this.trackBackgroundWrite(handled);
    return handled;
  }

  /** Persist all sessions at once. Used by stop() and flush() for safety;
   *  individual mutations should use persistSession(). */
  private persistAll(): Promise<void> {
    return this.store.save(this.sessions.values());
  }

  async persistImportedPack(sessionId: string, pack: ContentPack): Promise<void> {
    try {
      await this.store.savePack({
        pack,
        ownerSessionId: sessionId,
        touchedAt: Date.now(),
      });
      await this.prunePersistedImportedPacks(sessionId);
    } catch (err) {
      log.error("ruby-high.persist-pack-failed", err, { sessionId, packId: pack.id });
      throw err;
    }
  }

  async listPersistedPackRecords(): Promise<StoredContentPackRecord[]> {
    return this.store.loadPacks();
  }

  async listTeacherRecords(): Promise<StoredTeacherRecord[]> {
    return this.store.loadTeachers();
  }

  async listDraftPackRecords(): Promise<StoredDraftContentPackRecord[]> {
    return this.store.loadDraftPacks();
  }

  async saveDraftPackRecord(record: StoredDraftContentPackRecord): Promise<void> {
    try {
      await this.store.saveDraftPack(record);
    } catch (err) {
      log.error("ruby-high.persist-draft-pack-failed", err, { draftId: record.id });
      throw err;
    }
  }

  async deleteDraftPackRecord(draftId: string): Promise<void> {
    try {
      await this.store.deleteDraftPack(draftId);
    } catch (err) {
      log.error("ruby-high.delete-draft-pack-failed", err, { draftId });
      throw err;
    }
  }

  async deletePersistedPackRecord(ownerSessionId: string | null, packId: string): Promise<void> {
    try {
      unregisterPack(packId);
      await this.store.deletePack(ownerSessionId, packId);
    } catch (err) {
      log.error("ruby-high.delete-pack-failed", err, { ownerSessionId, packId });
      throw err;
    }
  }

  async deleteTeacherRecord(teacherId: string): Promise<void> {
    try {
      await this.store.deleteTeacher(teacherId);
    } catch (err) {
      log.error("ruby-high.delete-teacher-failed", err, { teacherId });
      throw err;
    }
  }

  async deletePackInstallationRecord(userId: string, packId: string): Promise<void> {
    try {
      await this.store.deletePackInstallation(userId, packId);
    } catch (err) {
      log.error("ruby-high.delete-pack-installation-failed", err, { userId, packId });
      throw err;
    }
  }

  async listPackInstallationRecords(): Promise<StoredPackInstallationRecord[]> {
    return this.store.loadPackInstallations();
  }

  async savePackInstallationRecord(record: StoredPackInstallationRecord): Promise<void> {
    try {
      await this.store.savePackInstallation(record);
    } catch (err) {
      log.error("ruby-high.persist-pack-installation-failed", err, { userId: record.userId, packId: record.packId });
      throw err;
    }
  }

  async persistPublicTeacherPack(
    pack: ContentPack,
    opts: { previousOwnerSessionId?: string | null; creatorUserId?: string; courseSlot?: StoredCourseSlotRecord; allowGlobalOverwrite?: boolean } = {},
  ): Promise<void> {
    const touchedAt = Date.now();
    try {
      registerPublicPack(pack, touchedAt, {
        ownerSessionId: opts.previousOwnerSessionId ?? null,
        allowGlobalOverwrite: opts.allowGlobalOverwrite,
      });
      await this.store.savePack({
        pack,
        ownerSessionId: null,
        ...(opts.creatorUserId ? { creatorUserId: opts.creatorUserId } : {}),
        ...(opts.courseSlot ? { courseSlot: opts.courseSlot } : {}),
        touchedAt,
      });
      if (opts.previousOwnerSessionId) {
        await this.store.deletePack(opts.previousOwnerSessionId, pack.id);
      }
    } catch (err) {
      log.error("ruby-high.persist-public-teacher-pack-failed", err, { packId: pack.id });
      throw err;
    }
  }

  private async prunePersistedImportedPacks(sessionId: string): Promise<void> {
    const owned = (await this.store.loadPacks())
      .filter((record) => record.ownerSessionId === sessionId)
      .sort((a, b) => a.touchedAt - b.touchedAt || a.pack.id.localeCompare(b.pack.id));
    const excess = owned.length - MAX_PACKS_PER_OWNER;
    if (excess <= 0) return;
    await Promise.all(
      owned.slice(0, excess).map((record) => this.store.deletePack(record.ownerSessionId, record.pack.id)),
    );
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
        score: { correct: 0, total: 0, points: 0, possible: 0 },
        wallet: { meritStars: 0, hallPasses: 0 },
        lastReveal: null,
        status: statusForPhase("in-room"),
        askedQuestionIds: [],
        cardMemory: {},
        roomBoards: {},
        currentGrade: DEFAULT_GRADE,
        completedGrades: [],
        hasSeenIntro: true,
        activePackId: null,
        guestPackMode: "auto",
        guestPackOverrideId: null,
        character: null,
        studentPool: [],
        characterSlots: {
          unlockedSlots: DEFAULT_CHARACTER_SLOT_COUNT,
          photoDayCredits: 0,
        },
        comicCollection: normalizeComicCollection(null),
        schoolEvents: [],
        essayReports: [],
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
    const repairedWelcomeGrant = this.ensureWelcomeHallPasses(state);
    // Tick any in-flight round so callers always see fresh elapsed state.
    this.tickRound(state);
    const repairedMemory = this.backfillCardMemory(state);
    const repairedComicCollection = this.unlockStudentInsertPagesForCircledSocialCard(state);
    const repairedTeacherPages = this.unlockTeacherStoryPagesForAClasses(state);
    if (this.maybeMarkGradeReady(state) || repairedWelcomeGrant || repairedMemory || repairedComicCollection || repairedTeacherPages) {
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
    }
    return state;
  }

  private ensureWelcomeHallPasses(state: QuizState): boolean {
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    if (state.wallet.welcomeHallPassesGrantedAt) return false;
    const existing = state.wallet.operationLedger?.[WELCOME_HALL_PASS_GRANT_ID] ??
      state.wallet.transactions?.find((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID) ??
      null;
    if (existing) {
      state.wallet.welcomeHallPassesGrantedAt = existing.at;
      return true;
    }
    const at = Date.now();
    const transaction: RubyHighWalletTransaction = {
      id: WELCOME_HALL_PASS_GRANT_ID,
      kind: "hall-pass-grant",
      at,
      hallPasses: WELCOME_HALL_PASS_GRANT,
      source: "system",
      description: "Welcome Hall Passes",
      metadata: { reason: "account-welcome" },
    };
    state.wallet.hallPasses = Math.max(0, Math.floor(Number(state.wallet.hallPasses ?? 0))) + WELCOME_HALL_PASS_GRANT;
    state.wallet.welcomeHallPassesGrantedAt = at;
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId: state.sessionId,
      source: "system",
      feature: "hall-pass-grant",
      status: "success",
      hallPassesDelta: WELCOME_HALL_PASS_GRANT,
      metadata: { transactionId: transaction.id, reason: "account-welcome" },
    });
    state.updatedAt = at;
    return true;
  }

  private appendSchoolEvent(state: QuizState, event: SchoolEvent): void {
    const events = Array.isArray(state.schoolEvents) ? state.schoolEvents : [];
    events.push(event);
    if (events.length > SCHOOL_EVENT_LIMIT) {
      events.splice(0, events.length - SCHOOL_EVENT_LIMIT);
    }
    state.schoolEvents = events;
  }

  private appendEssayReport(state: QuizState, report: EssayReport): void {
    const reports = Array.isArray(state.essayReports) ? state.essayReports : [];
    reports.push(report);
    if (reports.length > ESSAY_REPORT_LIMIT) {
      reports.splice(0, reports.length - ESSAY_REPORT_LIMIT);
    }
    state.essayReports = reports;
  }

  private schoolEventId(kind: SchoolEvent["kind"]): string {
    return `school_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private unlockComicPage(
    state: QuizState,
    pageNumber: number,
    reason: ComicPageUnlockReason,
    sourceId: string,
    label: string,
    now = Date.now(),
    context: { faculty?: string; grade?: Grade | null } = {},
  ): ComicPageUnlock | null {
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > FIRST_BELL_COMIC_PAGE_COUNT) return null;
    const collection = (state.comicCollection = normalizeComicCollection(state.comicCollection));
    if (collection.unlockedPages.some((page) => page.pageNumber === pageNumber)) return null;
    const pageId = firstBellComicPageId(pageNumber);
    const unlock: ComicPageUnlock = {
      issueId: FIRST_BELL_COMIC_ISSUE_ID,
      pageId,
      pageNumber,
      unlockedAt: now,
      reason,
      sourceId,
      label,
    };
    collection.unlockedPages.push(unlock);
    collection.unlockedPages.sort((a, b) => a.pageNumber - b.pageNumber);
    this.appendSchoolEvent(state, {
      id: this.schoolEventId("comic.page-unlocked"),
      kind: "comic.page-unlocked",
      at: now,
      faculty: context.faculty ?? state.faculty,
      grade: context.grade ?? state.currentGrade,
      issueId: unlock.issueId,
      pageId,
      pageNumber,
      reason,
      sourceId,
      label,
    });
    log.event("comic.page-unlocked", {
      sessionId: state.sessionId,
      character: state.character?.name ?? null,
      issueId: unlock.issueId,
      pageNumber,
      reason,
      sourceId,
    });
    return unlock;
  }

  private unlockTeacherStoryPageForAClass(state: QuizState, record: DailyClassRecord, now = Date.now()): ComicPageUnlock | null {
    if (record.status !== "complete" || !/^A/.test(record.letterGrade ?? "")) return null;
    const pageNumber = TEACHER_STORY_COMIC_PAGES[record.facultyId]?.[record.grade];
    if (!pageNumber) return null;
    const room = COMIC_CLASS_LABELS[record.facultyId] ?? record.facultyId;
    return this.unlockComicPage(
      state,
      pageNumber,
      "teacher-class-aced",
      `teacher:${record.facultyId}:grade:${record.grade}`,
      `${GRADE_LABELS[record.grade]} ${room} A`,
      now,
      { faculty: record.facultyId, grade: record.grade },
    );
  }

  private unlockTeacherStoryPagesForAClasses(state: QuizState, now = Date.now()): boolean {
    const records = Object.values(state.character?.dailyClasses ?? {});
    let changed = false;
    for (const record of records) {
      if (this.unlockTeacherStoryPageForAClass(state, record, now)) changed = true;
    }
    return changed;
  }

  private unlockStudentInsertPagesForCircledSocialCard(state: QuizState, now = Date.now()): boolean {
    const ch = state.character;
    if (!ch) return false;
    const card = (ch.mashCard = ensureMashCard(ch.mashCard));
    let changed = false;
    for (const [studentId, pageNumber] of Object.entries(STUDENT_INSERT_COMIC_PAGES)) {
      const cell = card.cells[studentId];
      if (!cell?.circled) continue;
      const studentName = studentById(studentId)?.shortName ?? studentId;
      const unlock = this.unlockComicPage(
        state,
        pageNumber,
        "student-befriended",
        `student:${studentId}`,
        `${studentName} insert`,
        now,
      );
      if (unlock) changed = true;
    }
    return changed;
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

  private assertBoardMutationAllowed(state: QuizState, action: "post" | "clear"): void {
    // getOrCreate() ticks expired rounds before mutators run. If this is still
    // unresolved, the board is live and the scheduler/AI must wait for the
    // player answer or timer resolution before replacing it.
    if (state.activeRound && !state.activeRound.resolved) {
      const remaining = Math.max(0, state.activeRound.expiresAt - Date.now());
      const verb = action === "clear" ? "clear the board" : "post another question";
      throw new Error(`Cannot ${verb} while a question is live. Wait for the answer or timeout (${Math.ceil(remaining / 1000)}s left).`);
    }
  }

  private subjectsForFaculty(state: QuizState, facultyId: string): string[] {
    const pack = packForSession(state);
    const faculty = pack.faculty.find((f) => f.id === facultyId);
    if (!faculty) return [];
    const bankSubjects = Array.from(new Set(
      [
        ...faculty.questions,
        ...(faculty.sourceCards ?? []),
      ]
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
    return pack.id.startsWith("anki:") && pack.faculty.some((f) =>
      f.id === facultyId && (f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
    );
  }

  private dailyClassRecord(state: QuizState, facultyId: string, date = dailyKey()): DailyClassRecord | null {
    const ch = state.character;
    const grade = state.currentGrade;
    if (!ch || !grade) return null;
    return ch.dailyClasses?.[classRecordKey(grade, facultyId, date)] ?? null;
  }

  private ensureDailyClassRecord(
    state: QuizState,
    facultyId: string,
    date = dailyKey(),
    now = Date.now(),
  ): DailyClassRecord | null {
    const ch = state.character;
    const grade = state.currentGrade;
    if (!ch || !grade) return null;
    ch.dailyClasses = ch.dailyClasses ?? {};
    const key = classRecordKey(grade, facultyId, date);
    const record = ch.dailyClasses[key] ?? {
      grade,
      facultyId,
      date,
      status: "active" as const,
      questionCount: 0,
      correctCount: 0,
      scoreTotal: 0,
      scoreMax: 0,
      updatedAt: now,
    };
    ch.dailyClasses[key] = record;
    return record;
  }

  private rubyHomeroomDeckApplies(
    state: QuizState,
    facultyId: string,
    requestedMode?: "class" | "practice",
  ): boolean {
    return facultyId === RUBY_FACULTY.id
      && !requestedMode
      && !!state.character
      && !!state.currentGrade
      && facultyId !== LOUNGE_FACULTY.id;
  }

  private rubyHomeroomDeckRole(record: DailyClassRecord | null): DeckCardRole {
    if (record?.status === "complete" || (record?.questionCount ?? 0) >= CLASS_QUESTIONS_PER_DAY) {
      return "practice";
    }
    const classCount = record?.questionCount ?? 0;
    const practiceCount = record?.practiceCount ?? 0;
    const socialCount = record?.socialCount ?? 0;
    if (classCount >= 1 && socialCount < RUBY_HOMEROOM_SOCIAL_CARDS_PER_DAY) {
      return "social";
    }
    const requiredPractice = RUBY_HOMEROOM_PRACTICE_BEFORE_CLASS[classCount] ?? Number.POSITIVE_INFINITY;
    if (practiceCount < requiredPractice) return "practice";
    return "class";
  }

  private peekCardRoleForPose(
    state: QuizState,
    facultyId: string,
    requestedMode?: "class" | "practice",
    questionType: QuestionType = "multiple-choice",
  ): DeckCardRole {
    if (requestedMode === "practice") return questionType === "opinion" ? "social" : "practice";
    if (questionType === "opinion") return "social";
    if (!state.character || !state.currentGrade || facultyId === LOUNGE_FACULTY.id) return "practice";
    const record = this.dailyClassRecord(state, facultyId);
    if (record?.status === "complete") return "practice";
    if (this.rubyHomeroomDeckApplies(state, facultyId, requestedMode)) {
      return this.rubyHomeroomDeckRole(record);
    }
    return "class";
  }

  private reserveCardRoleForPose(
    state: QuizState,
    facultyId: string,
    requestedMode?: "class" | "practice",
    questionType: QuestionType = "multiple-choice",
  ): DeckCardRole {
    const cardRole = this.peekCardRoleForPose(state, facultyId, requestedMode, questionType);
    if (!this.rubyHomeroomDeckApplies(state, facultyId, requestedMode)) return cardRole;
    if (cardRole !== "practice" && cardRole !== "social") return cardRole;
    const now = Date.now();
    const record = this.ensureDailyClassRecord(state, facultyId, dailyKey(), now);
    if (record && record.status !== "complete") {
      if (cardRole === "social") record.socialCount = (record.socialCount ?? 0) + 1;
      else record.practiceCount = (record.practiceCount ?? 0) + 1;
      record.updatedAt = now;
    }
    return cardRole;
  }

  private courseStandingForState(state: QuizState, facultyId: string): CourseStanding {
    const ch = state.character;
    const grade = state.currentGrade;
    const required = grade ? requiredClassCompletionsForGrade(grade) : 0;
    const todayKey = dailyKey();
    const todayRecord = grade ? this.dailyClassRecord(state, facultyId, todayKey) : null;
    const today: CourseProgress["today"] = todayRecord?.status === "complete"
      ? {
          mode: "practice",
          status: "complete",
          date: todayKey,
          questionCount: todayRecord.questionCount,
          correctCount: todayRecord.correctCount,
          totalQuestions: CLASS_QUESTIONS_PER_DAY,
          practiceCount: todayRecord.practiceCount ?? 0,
          socialCount: todayRecord.socialCount ?? 0,
          letterGrade: todayRecord.letterGrade,
          score: classAverage(todayRecord),
        }
      : todayRecord
        ? {
            mode: "class",
            status: "active",
            date: todayKey,
            questionCount: todayRecord.questionCount,
            correctCount: todayRecord.correctCount,
            totalQuestions: CLASS_QUESTIONS_PER_DAY,
            practiceCount: todayRecord.practiceCount ?? 0,
            socialCount: todayRecord.socialCount ?? 0,
          }
        : {
            mode: "class",
            status: "available",
            date: todayKey,
            questionCount: 0,
            correctCount: 0,
            totalQuestions: CLASS_QUESTIONS_PER_DAY,
          };

    if (!ch || !grade) {
      return { facultyId, grade: null, completed: 0, required, passed: false, today };
    }

    const completed = Object.values(ch.dailyClasses ?? {})
      .filter((r) => r.grade === grade && r.facultyId === facultyId && r.status === "complete")
      .sort((a, b) => a.date.localeCompare(b.date));
    let currentPassCount = 0;
    let currentPassScores: number[] = [];
    let currentPassRecords: DailyClassRecord[] = [];
    let clearedPassScores: number[] | null = null;
    let clearedPassRecords: DailyClassRecord[] | null = null;
    let clearedPassCount = 0;
    for (const record of completed) {
      const score = classAverage(record);
      const recordLetter = record.letterGrade ?? letterGradeForClassRecord(record);
      if (letterGradePasses(recordLetter)) {
        currentPassCount += 1;
        currentPassRecords.push(record);
        if (typeof score === "number") currentPassScores.push(score);
        if (currentPassCount >= required) {
          clearedPassCount = currentPassCount;
          clearedPassScores = currentPassScores.slice();
          clearedPassRecords = currentPassRecords.slice();
        }
      } else {
        currentPassCount = 0;
        currentPassScores = [];
        currentPassRecords = [];
      }
    }
    const scoreSet = clearedPassScores && clearedPassScores.length > 0 ? clearedPassScores : null;
    const averageScore = scoreSet
      ? Math.round(scoreSet.reduce((sum, n) => sum + n, 0) / scoreSet.length)
      : undefined;
    const rollModifier = clearedPassRecords
      ? classRollGradeModifier(
          clearedPassRecords.reduce((sum, record) => sum + Math.max(0, Math.floor(Number(record.rollHitCount ?? 0))), 0),
          clearedPassRecords.reduce((sum, record) => sum + Math.max(0, Math.floor(Number(record.rollMissCount ?? 0))), 0),
        )
      : "";
    const letterGrade = clearedPassCount >= required
      ? applyClassRollGradeModifier(letterGradeForClassScore(averageScore), rollModifier)
      : undefined;
    return {
      facultyId,
      grade,
      completed: Math.min(clearedPassCount >= required ? clearedPassCount : currentPassCount, required),
      required,
      averageScore,
      letterGrade,
      passed: clearedPassCount >= required && letterGradePasses(letterGrade),
      today,
    };
  }

  private classSessionForPose(
    state: QuizState,
    facultyId: string,
    requestedMode?: "class" | "practice",
    cardRole?: DeckCardRole,
  ): NonNullable<ActiveRound["classSession"]> {
    const ch = state.character;
    const grade = state.currentGrade;
    const date = dailyKey();
    if (cardRole && cardRole !== "class") {
      return { mode: "practice", facultyId, grade: grade ?? undefined, date };
    }
    if (requestedMode === "practice" || !ch || !grade || facultyId === LOUNGE_FACULTY.id) {
      return { mode: "practice", facultyId, grade: grade ?? undefined, date };
    }
    const record = this.dailyClassRecord(state, facultyId, date);
    if (record?.status === "complete") {
      return { mode: "practice", facultyId, grade, date };
    }
    return {
      mode: "class",
      facultyId,
      grade,
      date,
      index: (record?.questionCount ?? 0) + 1,
      total: CLASS_QUESTIONS_PER_DAY,
    };
  }

  private recordDailyClassQuestion(
    state: QuizState,
    wasCorrect: boolean,
    score: number,
    now = Date.now(),
    rollOutcome?: "hit" | "mixed" | "miss" | null,
  ): DailyClassUpdate {
    const round = state.activeRound;
    const session = round?.classSession;
    if (!session || session.mode !== "class" || !session.grade || !session.date || !state.character) {
      return {
        mode: "practice",
        cardRole: round?.cardRole ?? (round?.type === "opinion" ? "social" : "practice"),
        facultyId: state.faculty,
        grade: state.currentGrade ?? undefined,
      };
    }
    const record = this.ensureDailyClassRecord(state, session.facultyId, session.date, now)!;
    if (record.status === "complete") {
      return {
        mode: "practice",
        cardRole: round?.cardRole ?? "practice",
        facultyId: session.facultyId,
        grade: session.grade,
        date: session.date,
        questionCount: record.questionCount,
        totalQuestions: CLASS_QUESTIONS_PER_DAY,
        completed: true,
        letterGrade: record.letterGrade,
        score: classAverage(record),
      };
    }

    record.questionCount += 1;
    if (wasCorrect) record.correctCount += 1;
    record.scoreTotal += score;
    record.scoreMax += 100;
    if (rollOutcome === "hit") record.rollHitCount = (record.rollHitCount ?? 0) + 1;
    else if (rollOutcome === "mixed") record.rollMixedCount = (record.rollMixedCount ?? 0) + 1;
    else if (rollOutcome === "miss") record.rollMissCount = (record.rollMissCount ?? 0) + 1;
    record.updatedAt = now;
    if (record.questionCount >= CLASS_QUESTIONS_PER_DAY) {
      record.status = "complete";
      record.completedAt = now;
      const avg = classAverage(record);
      record.letterGrade = letterGradeForClassRecord(record);
      log.event("class.completed", {
        sessionId: state.sessionId,
        faculty: session.facultyId,
        grade: session.grade,
        date: session.date,
        letterGrade: record.letterGrade,
        score: avg,
        correct: record.correctCount,
        total: record.questionCount,
      });
      if (letterGradePasses(record.letterGrade)) {
        this.recordFunnelStep(state, "first_daily_class_passed", {
          faculty: session.facultyId,
          grade: session.grade,
          letterGrade: record.letterGrade,
        });
      }
      this.unlockTeacherStoryPageForAClass(state, record, now);
    }
    return {
      mode: "class",
      cardRole: "class",
      facultyId: session.facultyId,
      grade: session.grade,
      date: session.date,
      questionCount: record.questionCount,
      totalQuestions: CLASS_QUESTIONS_PER_DAY,
      completed: record.status === "complete",
      letterGrade: record.letterGrade,
      score: classAverage(record),
      passedClass: record.status === "complete" && letterGradePasses(record.letterGrade),
    };
  }

  private mediaForQuestion(card: PackSourceCard): QuestionMediaAsset[] | undefined {
    const media = (card.media ?? [])
      .filter((asset) =>
        typeof asset.name === "string" &&
        typeof asset.mimeType === "string" &&
        asset.mimeType.startsWith("image/") &&
        typeof asset.dataUrl === "string" &&
        asset.dataUrl.startsWith("data:image/"),
      )
      .map((asset) => ({ name: asset.name, mimeType: asset.mimeType, dataUrl: asset.dataUrl }));
    return media.length > 0 ? media : undefined;
  }

  private questionForSourceCard(card: PackSourceCard): BankedQuestion {
    const expectedAnswer = card.back.trim();
    const acceptedAnswers = card.acceptedAnswers.length > 0 ? card.acceptedAnswers : [expectedAnswer];
    const question: BankedQuestion = {
      id: card.id,
      prompt: card.front.trim() || "What is hidden on this card?",
      type: card.kind === "image-occlusion" ? "image-occlusion" : "typed-answer",
      expectedAnswer,
      acceptedAnswers,
      sourceCardId: card.id,
      canGenerateMc: true,
      media: this.mediaForQuestion(card),
      subject: card.subject,
      difficulty: card.difficulty,
      faculty: card.faculty,
      correct: "A",
    };
    question.stat = statForQuestion(question);
    return question;
  }

  private sourceCardsForFaculty(state: QuizState, facultyId: string): PackSourceCard[] {
    return packForSession(state).faculty.find((f) => f.id === facultyId)?.sourceCards ?? [];
  }

  private sourceCardForQuestion(state: QuizState, q: Question): PackSourceCard | null {
    const facultyId = this.resolveQuestionFaculty(state, q.faculty);
    const sourceId = q.sourceCardId ?? q.id;
    return this.sourceCardsForFaculty(state, facultyId).find((card) => card.id === sourceId) ?? null;
  }

  private cachedMcQuestionForSource(state: QuizState, source: PackSourceCard): BankedQuestion | null {
    const faculty = packForSession(state).faculty.find((f) => f.id === source.faculty);
    return faculty?.questions.find((q) =>
      (q.sourceCardId === source.id || q.id === source.id) &&
      (q.type ?? "multiple-choice") === "multiple-choice" &&
      !!q.options &&
      !!q.correct
    ) ?? null;
  }

  private sourceCardToInput(card: PackSourceCard): SourceCardInput {
    return {
      noteId: card.id.startsWith("anki-") ? card.id.slice("anki-".length) : card.id,
      front: card.front,
      back: card.back,
      deckName: card.deckName,
      tags: card.tags,
      frontHtml: card.frontHtml,
      backHtml: card.backHtml,
      media: card.media,
    };
  }

  private normalizeGeneratedMcQuestion(source: PackSourceCard, q: BankedQuestion): BankedQuestion {
    if (!q.options || !q.correct) {
      throw new Error("Distractor generation did not return a playable multiple-choice question.");
    }
    return {
      ...q,
      id: source.id,
      type: "multiple-choice",
      sourceCardId: source.id,
      canGenerateMc: false,
      subject: source.subject,
      difficulty: source.difficulty,
      faculty: source.faculty,
    };
  }

  private courseQuestionsFor(state: QuizState, facultyId: string): BankedQuestion[] {
    const faculty = packForSession(state).faculty.find((f) => f.id === facultyId);
    if (!faculty) return [];
    const bankedQuestions = faculty.sourceCards?.length
      ? faculty.questions.filter((q) => !q.sourceCardId)
      : faculty.questions;
    return [
      ...(faculty.sourceCards ?? []).map((card) => this.questionForSourceCard(card)),
      ...bankedQuestions,
    ];
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
      for (const q of this.courseQuestionsFor(state, faculty.id)) {
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
        // now so source-card packs recover into the review queue instead
        // of staying dry.
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
    filter: {
      subject?: string;
      difficulty?: Difficulty;
      allowedDifficulties?: Iterable<Difficulty>;
      difficultyWeights?: DifficultyWeights;
      allowUndue?: boolean;
    } = {},
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
      const undue: BankedQuestion[] = [];
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
        } else if (filter.allowUndue && m) {
          undue.push(q);
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
      if (masteredDue.length > 0) return masteredDue[0]!;
      undue.sort((a, b) => {
        const ma = memory[cardMemoryKey(facultyId, a.id)]!;
        const mb = memory[cardMemoryKey(facultyId, b.id)]!;
        return (ma.lastReviewedAt ?? 0) - (mb.lastReviewedAt ?? 0)
          || ma.dueAt - mb.dueAt;
      });
      return undue[0] ?? null;
    };

    const chooseWithWeights = (pool: BankedQuestion[]): BankedQuestion | null => {
      const weights = filter.difficultyWeights;
      if (!weights || filter.difficulty) return choose(pool);
      const weighted = (["easy", "medium", "hard"] as const)
        .map((difficulty) => ({
          difficulty,
          weight: Math.max(0, Number(weights[difficulty] ?? 0)),
        }))
        .filter(({ difficulty, weight }) =>
          weight > 0 && pool.some((q) => q.difficulty === difficulty)
        );
      const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      if (total <= 0) return choose(pool);

      let cursor = Math.random() * total;
      for (const entry of weighted) {
        cursor -= entry.weight;
        if (cursor <= 0) {
          const picked = choose(pool.filter((q) => q.difficulty === entry.difficulty));
          if (picked) return picked;
          break;
        }
      }
      return choose(pool);
    };

    const subjectAndDifficultyPool = preferred.length > 0 ? preferred : all;
    const weighted = chooseWithWeights(subjectAndDifficultyPool);
    if (weighted) return weighted;
    if (preferred.length > 0) {
      return chooseWithWeights(all);
    }
    return null;
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

    const scoreCredit = clamp(Math.floor(scoreMultiplier), 1, 5);
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
    if (allNpcsLocked && playerLocked) {
      this.resolveRound(state, false);
      mutated = true;
    } else if (!playerLocked && now >= round.expiresAt && !round.idleTriggered) {
      // Nobody answered within the idle window. Flag the round so the AI
      // teacher fires to engage the room; the round itself stays open until
      // the teacher calls forceAdvanceRound().
      round.idleTriggered = true;
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
    const isTypedQuestion = q.type === "typed-answer" || q.type === "image-occlusion";
    const answerText = round.player.answerText?.trim() ?? "";
    const acceptedAnswers = q.acceptedAnswers ?? (q.expectedAnswer ? [q.expectedAnswer] : []);
    const typedJudge = isTypedQuestion && round.player.answeredAt != null
      ? judgeTypedAnswer(answerText, acceptedAnswers)
      : null;
    if (typedJudge) {
      round.player.picked = typedJudge.correct ? "A" : "B";
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
    // total but don't fake a picked letter in answer history.
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
        ...(isTypedQuestion ? { answerText, expectedAnswer: q.expectedAnswer ?? acceptedAnswers[0] } : {}),
      };
      state.history.push(record);
    }
    state.score.total += 1;
    if (wasCorrect) state.score.correct += 1;

    // 2d6 + question stat roll for the player — bonus layer on top of their
    // literal pick. The roll feeds review quality and the UI dice chip.
    // NPC rolls (in activeRound.npcs) carry the actual race stakes.
    let playerRoll: NonNullable<NonNullable<QuizState["lastReveal"]>["playerRoll"]> | null = null;
    if (state.character && picked != null) {
      const stat: keyof CharacterStats = statForQuestion(q);
      const r = roll2d6();
      const total = r.total + state.character.stats[stat];
      const outcome = classifyTotal(total);
      playerRoll = { stat, dice: r.dice, total, outcome };
    }
    const rawQuestionScore = picked == null || forfeit ? 0 : classQuestionScore(wasCorrect, playerRoll);
    const scoreAward = awardSessionScore(state, rawQuestionScore, scoreMultiplier);
    this.recordCardReview(
      state,
      q,
      this.reviewRatingForRound(wasCorrect, forfeit, playerRoll),
      reviewAt,
      scoreMultiplier,
    );
    const classProgress = this.recordDailyClassQuestion(
      state,
      wasCorrect,
      classGradeQuestionScore(wasCorrect),
      reviewAt,
      picked == null || forfeit ? null : playerRoll?.outcome ?? null,
    );

    // Player progression. Card mastery updates above; class grades are derived
    // from completed daily classes. Practice updates card memory but does not
    // tick the daily-class counter or the graduation gate.
    const progress = this.applyPlayerProgress(state, wasCorrect, state.faculty, classProgress);
    if (progress.dailyTicked) {
      const correctAns = (q.correct ?? "A") as Choice;
      this.applyCohortDaily(state, correctAns, dailyKey());
    }

    const questionSnapshot = {
      questionPrompt: q.prompt,
      questionType: q.type ?? "multiple-choice" as QuestionType,
      ...(q.options ? { questionOptions: q.options } : {}),
      ...(q.subject ? { questionSubject: q.subject } : {}),
      ...(q.difficulty ? { questionDifficulty: q.difficulty } : {}),
    };
    state.lastReveal = {
      questionId: q.id,
      ...questionSnapshot,
      picked: (picked ?? "A") as Choice, // UI-only; audit lives in history
      correct: (q.correct ?? "A") as Choice,
      wasCorrect,
      forfeit,
      explanation: q.explanation ?? null,
      encouragement: affinitySave
        ? "Class affinity kicked in — second chance counted."
        : forfeit ? "Time's up. Take a breath." : pickEncouragement(wasCorrect),
      scoreMultiplier,
      scoreAward,
      classProgress,
      playerRoll,
      affinitySave,
      ...(isTypedQuestion ? {
        answerText,
        expectedAnswer: q.expectedAnswer ?? acceptedAnswers[0] ?? null,
        answerJudge: typedJudge
          ? { mode: typedJudge.mode, score: typedJudge.score }
          : { mode: "fuzzy" as const, score: 0 },
      } : {}),
    };
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    // resolveRound is a private helper that operates on `state` directly;
    // there's no sessionId param, so pull it off the state.
    void this.persistSession(state.sessionId);
  }

  /** Called by the room-idle chat route after the AI teacher has engaged
   *  the room. Resolves the open round as a forfeit (no student answered)
   *  so the teacher can then post the next question. Safe to call on an
   *  already-resolved round. */
  forceAdvanceRound(sessionId: string): void {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.resolved) return;
    this.resolveRound(state, round.player.answeredAt == null);
  }

  /** Apply grade progression after a question resolves.
   *  Steps:
   *
   *    1. subjectScores tick (independent of pass) — drives
   *       the diploma's subject-themed accessory at graduation.
   *    2. Card memory already updated before this call; it only drives
   *       scheduling/practice.
   *    3. The first passed daily class on a UTC date counts for the year:
   *       tick the legacy streak field, with date-gap reset.
   *    4. Re-check grade completion after every progress mutation. Daily
   *       classes and subject grades can land in either order; once both gates are met,
   *       the year completes immediately.
   */
  private applyPlayerProgress(
    state: QuizState,
    passed: boolean,
    faculty: string,
    classProgress?: DailyClassUpdate,
  ): { dailyTicked: boolean } {
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

    // 2. Streak tracking. Only a passing daily class completion moves it.
    let dailyTicked = false;
    if (!classProgress?.completed || !classProgress.passedClass) {
      this.maybeMarkGradeReady(state);
      return { dailyTicked };
    }

    const prevLastDate = ch.streak && ch.streak.grade === grade ? ch.streak.lastDate : undefined;
    if (prevLastDate !== today) {
      const nextCount = prevLastDate && daysBetween(prevLastDate, today) === 1
        ? Math.min(5, (ch.streak?.grade === grade ? ch.streak.count : 0) + 1)
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
    const pack = packForSession(state);
    const teacherIds = Array.from(new Set(
      coursesForPack(pack)
        .map((course) => course.facultyId)
        .filter((facultyId) => pack.faculty.some((f) =>
          f.id === facultyId && (f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
        )),
    ));
    for (const teacherId of teacherIds) {
      classCount++;
      const course = this.courseStandingForState(state, teacherId);
      classGrades[teacherId] = course.letterGrade ?? "—";
      if (course.passed) classesMet++;
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
      sessionId: state.sessionId, character: ch.name, grade,
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
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
      throw new Error("Graduation requirements are not complete.");
    }
    const grade = pending.grade;
    if (ch.yearbook?.some((y) => y.grade === grade) || state.completedGrades.includes(grade)) {
      ch.pendingGraduation = null;
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
      return state;
    }

    const advance = nextGradeAfter(grade);
    const targetGrade = advance ?? grade;
    const normalizedReward = this.normalizeGraduationReward(state, ch, reward);

    // Resolve any MASH axis whose grade just completed (and the Senior
    // bonus axes at grade 12). The full superlative list snapshots onto
    // every yearbook entry from the moment any axis resolves — earlier
    // entries see fewer lines, the Senior entry sees all of them.
    const newResolutions = this.resolveMashAxesForGrade(ch, grade);
    const superlatives = this.buildMashSuperlativesFor(ch);

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
      ...(superlatives.length > 0 ? { superlatives } : {}),
    });
    if (newResolutions.length > 0) {
      const schoolEventAt = Date.now();
      for (const r of newResolutions) {
        this.appendSchoolEvent(state, {
          id: this.schoolEventId("mash.axis-resolved"),
          kind: "mash.axis-resolved",
          at: schoolEventAt,
          faculty: state.faculty,
          grade,
          axis: r.axis,
          studentId: r.studentId,
          value: r.value,
        });
      }
      log.event("mash.axes-resolved", {
        sessionId: state.sessionId,
        character: ch.name,
        grade,
        resolutions: newResolutions.map((r) => ({
          axis: r.axis, studentId: r.studentId, value: r.value,
        })),
      });
    }
    if (!state.completedGrades.includes(grade)) state.completedGrades.push(grade);
    this.recordFunnelStep(state, "first_grade_completed", {
      character: ch.name,
      grade,
      reward: normalizedReward.kind,
    });

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
        sessionId: state.sessionId, character: ch.name, fromGrade: grade, toGrade: advance, reward: normalizedReward.kind,
      });
    } else {
      this.archiveCompletedCharacter(state, ch);
      log.event("player.graduated", {
        sessionId: state.sessionId, character: ch.name, reward: normalizedReward.kind,
      });
    }

    this.transition(state, { kind: "clear-board" });
    this.discardBoardForFaculty(state, state.faculty);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  private normalizeGraduationReward(state: QuizState, ch: PlayerCharacter, reward: GraduationReward): GraduationReward {
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
      const pack = packForSession(state);
      const facultyIds = new Set(
        coursesForPack(pack)
          .map((course) => course.facultyId)
          .filter((facultyId) => pack.faculty.some((f) =>
            f.id === facultyId && (f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
          )),
      );
      if (!facultyIds.has(reward.facultyId)) throw new Error("Pick a valid class affinity.");
      return { kind: "affinity", facultyId: reward.facultyId };
    }
    throw new Error(`Unknown graduation reward: ${(reward as { kind?: string }).kind ?? "?"}`);
  }

  /** Apply MASH affinity ticks for one just-graded essay. Pure compute,
   *  then mutates the player's card. Returns the array of ticks applied
   *  for the event log. Cap is two non-zero ticks per essay; this function
   *  is the only thing that ever ticks the card during normal play. */
  private applyMashTicksForEssay(
    state: QuizState,
    inputs: { questionId: string; bestResponder: string | null; playerScore: number; playerPassed: boolean },
  ): Array<{ studentId: string; delta: -1 | 0 | 1; reason: MashTickReason; affinity: number; circled: boolean; scratched: boolean; befriended: boolean }> {
    const ch = state.character;
    if (!ch) return [];
    const card = (ch.mashCard = ensureMashCard(ch.mashCard));
    const ticks = computeMashTicks({
      playerScore: inputs.playerScore,
      playerPassed: inputs.playerPassed,
      bestResponder: inputs.bestResponder,
      questionId: inputs.questionId,
      date: dailyKey(),
      isHeart: ch.playbookId === "heart",
    });
    const applied: Array<{ studentId: string; delta: -1 | 0 | 1; reason: MashTickReason; affinity: number; circled: boolean; scratched: boolean; befriended: boolean }> = [];
    for (const t of ticks) {
      const cell = card.cells[t.studentId];
      if (!cell) continue;
      // Don't keep ticking a scratched cell — once the relationship is
      // gone, it stays gone for this character's career.
      if (cell.scratched && t.delta !== 0) continue;
      const wasCircled = cell.circled;
      applyMashTick(cell, t.delta, dailyKey());
      applied.push({
        studentId: t.studentId,
        delta: t.delta,
        reason: t.reason,
        affinity: cell.affinity,
        circled: cell.circled,
        scratched: cell.scratched,
        befriended: !wasCircled && cell.circled,
      });
    }
    return applied;
  }

  /** Resolve any axis whose grade just completed, plus the Senior bonus
   *  axes if `grade === 12`. Mutates the card. Returns the resolutions
   *  applied so the caller can stash them on the yearbook entry. */
  private resolveMashAxesForGrade(
    ch: PlayerCharacter,
    grade: Grade,
  ): import("../types.js").MashResolution[] {
    const card = (ch.mashCard = ensureMashCard(ch.mashCard));
    const out: import("../types.js").MashResolution[] = [];
    const primary = resolveMashAxisForGrade(card, grade, ch.name);
    if (primary) {
      card.resolved[primary.axis] = primary;
      out.push(primary);
    }
    if (grade === "12") {
      for (const r of resolveMashSeniorBonusAxes(card, ch.name)) {
        if (!card.resolved[r.axis]) {
          card.resolved[r.axis] = r;
          out.push(r);
        }
      }
    }
    return out;
  }

  /** Build the superlative lines for a yearbook entry, resolving classmate
   *  short names through the student registry. */
  private buildMashSuperlativesFor(ch: PlayerCharacter): string[] {
    const card = ensureMashCard(ch.mashCard);
    return buildMashSuperlatives(card, (id) => studentById(id)?.shortName ?? id);
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
   *  daily-class progress check and ticks their own counter. Independent of the player's pass:
   *  Indra might pass while you miss, or vice versa. Streak resets on
   *  miss; advances on threshold; graduates after the Senior counter.
   *
   *  NPCs gate on the daily-class counter alone — no XP gate. They feel hungrier than the
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
      const next = Math.min(5, prev + 1);
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

  private npcIsSeatedWithPlayer(state: QuizState, studentId: string): boolean {
    const grade = state.currentGrade;
    if (!grade) return true;
    const arc = state.npcCohort?.find((n) => n.id === studentId);
    if (!arc) return true;
    return !arc.graduated && arc.grade === grade;
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
    this.assertBoardMutationAllowed(state, "post");
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
    state.activeRound.classSession = this.classSessionForPose(state, facultyId, input.mode);
    state.activeRound.cardRole = state.activeRound.classSession.mode === "class" ? "class" : "practice";
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    log.event("question.posed", {
      sessionId, faculty: question.faculty, questionId: question.id,
      type: "multiple-choice", rarity: question.rarity, subject: question.subject,
    });
    void this.persistSession(sessionId);
    return state;
  }

  private poseBankedQuestion(
    sessionId: string,
    state: QuizState,
    q: BankedQuestion,
    mode?: "class" | "practice",
  ): QuizState {
    this.assertBoardMutationAllowed(state, "post");
    if (state.character?.pendingGraduation) {
      throw new Error("Graduation ceremony is ready — choose a level-up reward before starting another question.");
    }
    const type: QuestionType = q.type ?? "multiple-choice";
    const question: Question = { ...q, type };
    if (type === "multiple-choice") {
      if (!question.options || !question.correct) {
        throw new Error(`Question ${q.id} is missing multiple-choice options.`);
      }
      for (const c of CHOICES) {
        const v = question.options[c];
        if (typeof v !== "string" || v.trim().length === 0) {
          throw new Error(`Question ${q.id} option ${c} is missing or empty.`);
        }
      }
    } else if (type === "typed-answer" || type === "image-occlusion") {
      const answers = question.acceptedAnswers?.filter((answer) => answer.trim().length > 0) ?? [];
      if (!question.expectedAnswer && answers.length === 0) {
        throw new Error(`Question ${q.id} is missing its expected answer.`);
      }
      question.acceptedAnswers = answers.length > 0 ? answers : [question.expectedAnswer ?? ""];
      question.expectedAnswer = question.expectedAnswer ?? question.acceptedAnswers[0]!;
      question.correct = "A";
      question.canGenerateMc = q.canGenerateMc !== false;
    }
    question.stat = statForQuestion(question);
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    if (!state.askedQuestionIds.includes(question.id)) state.askedQuestionIds.push(question.id);
    const cardRole = this.reserveCardRoleForPose(state, question.faculty ?? state.faculty, mode, type);
    state.activeRound = this.openRound(state, question);
    state.activeRound.classSession = this.classSessionForPose(state, question.faculty ?? state.faculty, mode, cardRole);
    state.activeRound.cardRole = state.activeRound.classSession.mode === "class" ? "class" : cardRole;
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    log.event("question.posed", {
      sessionId,
      faculty: question.faculty,
      questionId: question.id,
      type,
      rarity: question.rarity,
      subject: question.subject,
      sourceCardId: question.sourceCardId,
    });
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
    const isTypedAnswer = question.type === "typed-answer" || question.type === "image-occlusion";
    const durationMs = isOpinion ? OPINION_ROUND_DURATION_MS : DEFAULT_ROUND_DURATION_MS;
    const room = roomForFacultyForSession(state, state.faculty);
    let entries: NpcRoundEntry[] = [];
    if (room && room.teaches && state.currentGrade && !isTypedAnswer) {
      const teachingRoom = room.id as TeachingRoomId;
      const roster = this.ensureRoster(state, state.currentGrade);
      const inRoom = npcsInRoom(roster, teachingRoom)
        .filter((npc) => this.npcIsSeatedWithPlayer(state, npc.id));
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
    this.assertBoardMutationAllowed(state, "post");
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
    const cardRole = this.reserveCardRoleForPose(state, facultyId, input.mode, "opinion");
    state.activeRound = this.openRound(state, question);
    state.activeRound.classSession = this.classSessionForPose(state, facultyId, input.mode, cardRole);
    state.activeRound.cardRole = state.activeRound.classSession.mode === "class" ? "class" : cardRole;
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    log.event("question.posed", {
      sessionId, faculty: question.faculty, questionId: question.id,
      type: "opinion", rarity: question.rarity, subject: question.subject,
    });
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
    log.event("essay.submitted", {
      sessionId, faculty: state.faculty, questionId: round.questionId,
      responder, length: bounded.length,
    });
    if (responder === "player") {
      this.recordFunnelStep(state, "first_essay_submitted", {
        faculty: state.faculty,
        questionId: round.questionId,
      });
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
    const playerResponse = round.opinionResponses.find((r) => r.responder === "player");
    const bestGrade = bestResponder ? grades.find((g) => g.responder === bestResponder) : undefined;
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
      const rawQuestionScore = playerGrade ? Math.round(clamp(playerGrade.score, 0, 10) * 10) : 0;
      const scoreAward = awardSessionScore(state, rawQuestionScore, scoreMultiplier);
      this.recordCardReview(state, q, passed ? "good" : "again", record.at, scoreMultiplier);
      const classProgress = this.recordDailyClassQuestion(
        state,
        passed,
        classGradeQuestionScore(passed),
        record.at,
      );
      const reportFaculty = q.faculty ?? round.classSession?.facultyId ?? state.faculty;
      const reportClassSession: EssayReport["classSession"] | undefined = round.classSession
        ? {
            mode: round.classSession.mode,
            facultyId: round.classSession.facultyId,
            ...(round.cardRole ? { cardRole: round.cardRole } : {}),
            ...(round.classSession.grade ? { grade: round.classSession.grade } : {}),
            ...(round.classSession.date ? { date: round.classSession.date } : {}),
            ...(typeof round.classSession.index === "number" ? { questionCount: round.classSession.index } : {}),
            ...(typeof round.classSession.total === "number" ? { totalQuestions: round.classSession.total } : {}),
          }
        : undefined;
      this.appendEssayReport(state, {
        id: `essay_${q.id}_${reviewAt.toString(36)}`,
        questionId: q.id,
        faculty: reportFaculty,
        grade: state.currentGrade,
        ...(q.subject ? { subject: q.subject } : {}),
        prompt: q.prompt,
        response: playerResponse?.text ?? "",
        score: playerGrade ? clamp(playerGrade.score, 0, 10) : null,
        passed,
        comment: playerGrade?.comment ?? "",
        bestResponder,
        ...(bestGrade ? { bestResponderScore: clamp(bestGrade.score, 0, 10) } : {}),
        ...(bestGrade?.comment ? { bestResponderComment: bestGrade.comment } : {}),
        submittedAt: playerResponse?.submittedAt ?? reviewAt,
        gradedAt: reviewAt,
        ...(reportClassSession ? { classSession: reportClassSession } : {}),
      });
      // Same progression as MC rounds. Opinion rounds update card mastery
      // through the review rating above; no XP is awarded.
      const progress = this.applyPlayerProgress(state, passed, state.faculty, classProgress);
      if (progress.dailyTicked) {
        // NPCs roll a coin-flip-ish dice; "A" is a neutral sentinel
        // since opinion mode has no correct letter to leak.
        this.applyCohortDaily(state, "A", dailyKey());
      }
      const questionSnapshot = {
        questionPrompt: q.prompt,
        questionType: q.type ?? "opinion" as QuestionType,
        ...(q.subject ? { questionSubject: q.subject } : {}),
        ...(q.difficulty ? { questionDifficulty: q.difficulty } : {}),
      };
      state.lastReveal = {
        questionId: q.id,
        ...questionSnapshot,
        picked: "A" as Choice,
        correct: "A" as Choice,
        wasCorrect: passed,
        explanation: q.rubric ?? null,
        encouragement: affinitySave ? "Class affinity kicked in — second chance counted." : passed ? "Nice essay." : "Take another swing at it tomorrow.",
        scoreMultiplier,
        scoreAward,
        classProgress,
        affinitySave,
      };
    }
    // MASH affinity ticks. After every essay, up to two classmates react.
    // The teacher-named bestResponder gets +1, and a deterministic
    // applauder/rubber gets +1 or -1 depending on whether the player
    // passed. Heart playbook converts the rub into a no-op (Pep Talk
    // passive). Pure compute → mutate the card → log.
    const mashTicksApplied = this.applyMashTicksForEssay(state, {
      questionId: round.questionId,
      bestResponder,
      playerScore: playerGrade?.score ?? 0,
      playerPassed: passed,
    });
    const schoolEventAt = Date.now();
    for (const tick of mashTicksApplied) {
      this.appendSchoolEvent(state, {
        id: this.schoolEventId("relationship.ticked"),
        kind: "relationship.ticked",
        at: schoolEventAt,
        faculty: state.faculty,
        grade: state.currentGrade,
        questionId: round.questionId,
        studentId: tick.studentId,
        delta: tick.delta,
        reason: tick.reason,
        affinity: tick.affinity,
        circled: tick.circled,
        scratched: tick.scratched,
      });
    }
    this.unlockStudentInsertPagesForCircledSocialCard(state, schoolEventAt);
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    state.updatedAt = round.resolvedAt;
    log.event("essay.graded", {
      sessionId, faculty: state.faculty, questionId: round.questionId,
      playerScore: playerGrade?.score ?? null, playerPassed: passed,
      bestResponder, affinitySaved: !!affinitySave, gradeCount: grades.length,
      mashTicks: mashTicksApplied,
    });
    void this.persistSession(sessionId);
    return state;
  }

  private poseRubyHomeroomSocialCard(sessionId: string, state: QuizState, facultyId: string): QuizState {
    const date = dailyKey();
    const grade = state.currentGrade ?? DEFAULT_GRADE;
    const record = this.dailyClassRecord(state, facultyId, date);
    const socialIndex = (record?.socialCount ?? 0) + 1;
    return this.poseOpinion(sessionId, {
      faculty: facultyId,
      subject: "social",
      questionId: `social_${facultyId}_${grade}_${date}_${socialIndex}`,
      prompt: "Social card: When a classmate gives an answer confidently, what is one sign you should trust it, and one sign you should check it?",
      rubric: "A strong response names one concrete trust signal and one concrete reason to verify, then explains the difference in the player's own words.",
    });
  }

  private scheduledPickPlanForState(state: QuizState, filter: PickAndPoseInput = {}): ScheduledPickPlan {
    const facultyId = this.resolveQuestionFaculty(state, filter.faculty);
    const cardRole = this.peekCardRoleForPose(state, facultyId, filter.mode);
    const importedReviewCourse = this.isImportedReviewCourse(state, facultyId);
    const explicitDifficulty = filter.difficulty;
    const allowedDifficulties = !filter.difficulty && state.currentGrade && !importedReviewCourse
      ? difficultiesForGrade(state.currentGrade)
      : undefined;
    const difficultyWeights = !filter.difficulty && state.currentGrade && !importedReviewCourse
      ? difficultyWeightsForGrade(state.currentGrade)
      : undefined;
    const displayDifficulty = explicitDifficulty
      ?? (state.currentGrade && !importedReviewCourse ? difficultyForGrade(state.currentGrade) : undefined);
    const question = cardRole === "social"
      ? undefined
      : this.pickReviewQuestion(state, facultyId, {
          subject: filter.subject,
          difficulty: explicitDifficulty,
          allowedDifficulties,
          difficultyWeights,
          allowUndue: filter.mode === "practice",
        }) ?? undefined;
    return { facultyId, cardRole, importedReviewCourse, difficulty: displayDifficulty, question };
  }

  pickAndPose(sessionId: string, filter: PickAndPoseInput = {}): QuizState {
    if (!this.faculty) {
      throw new Error("FacultyService is not bound. Call setFacultyService() first.");
    }
    const state = this.getOrCreate(sessionId);
    this.assertBoardMutationAllowed(state, "post");
    const plan = this.scheduledPickPlanForState(state, filter);
    if (plan.cardRole === "social") {
      return this.poseRubyHomeroomSocialCard(sessionId, state, plan.facultyId);
    }
    if (!plan.question) {
      throw new Error(
        plan.importedReviewCourse
          ? `No scheduled deck card is due for ${plan.facultyId} right now.`
          : `No scheduled question is due for {faculty=${plan.facultyId}, subject=${filter.subject ?? "any"}, difficulty=${plan.difficulty ?? "any"}}.`,
      );
    }
    return this.poseBankedQuestion(sessionId, state, plan.question, filter.mode);
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
    const standing = this.courseStandingForState(state, fid);
    const pickPlan = this.scheduledPickPlanForState(state, { faculty: fid });
    const canPick = pickPlan.cardRole === "social" || !!pickPlan.question;
    return {
      mode: imported ? "srs" : "bank",
      facultyId: fid,
      displayName: faculty?.displayName ?? fid,
      total: questions.length,
      asked: counts.asked,
      remaining: counts.ready,
      canPick,
      nextCardRole: pickPlan.cardRole,
      grade: standing.letterGrade,
      courseGrade: standing.letterGrade,
      completedClasses: standing.completed,
      requiredClasses: standing.required,
      averageScore: standing.averageScore,
      todayClass: standing.today,
      readyCount: counts.ready,
      masteredCount: counts.mastered,
      learningCount: counts.learning,
      shakyCount: counts.shaky,
      newCount: counts.fresh,
      defaultDifficulty: state.currentGrade && !imported ? difficultyForGrade(state.currentGrade) : undefined,
      difficultyWeights: state.currentGrade && !imported ? difficultyWeightsForGrade(state.currentGrade) : undefined,
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
      canPick: status.canPick,
      nextCardRole: status.nextCardRole,
      grade: status.grade,
      completedClasses: status.completedClasses ?? 0,
      requiredClasses: status.requiredClasses ?? 0,
      averageScore: status.averageScore,
      today: status.todayClass ?? {
        mode: "class",
        status: "available",
        date: dailyKey(),
        questionCount: 0,
        correctCount: 0,
        totalQuestions: CLASS_QUESTIONS_PER_DAY,
      },
      mastered: status.masteredCount ?? status.asked,
      learning: status.learningCount ?? 0,
      shaky: status.shakyCount ?? 0,
      new: status.newCount ?? Math.max(0, status.remaining),
    };
  }

  /** Daily-class status. This is the once-per-day graded class entry point. The
   *  faculty-of-the-day rotation still works the same way (deterministic by
   *  date), so the class flow nudges the player toward different rooms over the week. */
  dailyStatus(sessionId: string, now: Date = new Date()): DailyStatus {
    return dailyStatusForState(this.getOrCreate(sessionId), now);
  }

  /** Pose today's daily class question. Throws if today's class entry has already been used. */
  playBonus(sessionId: string, now: Date = new Date()): QuizState {
    if (!this.faculty) {
      throw new Error("FacultyService is not bound. Call setFacultyService() first.");
    }
    const state = this.getOrCreate(sessionId);
    const status = this.dailyStatus(sessionId, now);
    if (!status.available) {
      throw new Error(`Daily class not available: ${status.reason ?? "unknown"}`);
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
      throw new Error(`No scheduled review card is due for ${facultyId}; cannot pose today's class question.`);
    }
    // Daily class guarantees a graded question; subject grades come from
    // the same card mastery path as regular room questions.
    const next = this.poseBankedQuestion(sessionId, state, q);
    if (next.activeRound) {
      next.activeRound.isBonus = true;
    }
    if (state.character) {
      state.character.lastBonusDate = status.dailyKey;
    }
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
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
    if ((q.type ?? "multiple-choice") !== "multiple-choice") {
      throw new Error("This question needs a typed answer.");
    }
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
    log.event("answer.picked", {
      sessionId, faculty: state.faculty, questionId: q.id,
      picked, correct: q.correct, wasCorrect: picked === q.correct,
      rarity: q.rarity,
    });
    this.recordFunnelStep(state, "first_question_answered", {
      faculty: state.faculty,
      questionId: q.id,
      type: "multiple-choice",
    });
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

  submitTextAnswer(sessionId: string, answerText: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const q = state.current;
    if (!q) throw new Error("No question is currently on the board.");
    if (q.type !== "typed-answer" && q.type !== "image-occlusion") {
      throw new Error("This question needs a multiple-choice pick.");
    }
    const trimmed = answerText.trim();
    if (!trimmed) throw new Error("Type an answer before submitting.");
    const bounded = trimmed.length > 4096 ? `${trimmed.slice(0, 4096)}...` : trimmed;

    if (!state.activeRound || state.activeRound.questionId !== q.id) {
      state.activeRound = this.openRound(state, q);
    }
    const round = state.activeRound;
    if (round.resolved) return state;
    if (round.player.answeredAt != null) {
      this.tickRound(state);
      return state;
    }
    const judge = judgeTypedAnswer(bounded, q.acceptedAnswers ?? (q.expectedAnswer ? [q.expectedAnswer] : []));
    round.player.answerText = bounded;
    round.player.picked = judge.correct ? "A" : "B";
    round.player.answeredAt = Date.now();
    log.event("answer.typed", {
      sessionId,
      faculty: state.faculty,
      questionId: q.id,
      wasCorrect: judge.correct,
      judgeMode: judge.mode,
      judgeScore: judge.score,
    });
    this.recordFunnelStep(state, "first_question_answered", {
      faculty: state.faculty,
      questionId: q.id,
      type: q.type,
    });
    this.tickRound(state);
    if (!round.resolved) this.resolveRound(state, false);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  async generateCurrentMcQuestion(sessionId: string, apiKey?: string | null): Promise<QuizState> {
    const state = this.getOrCreate(sessionId);
    const current = state.current;
    if (!current) throw new Error("No question is currently on the board.");
    if (current.type !== "typed-answer" && current.type !== "image-occlusion") {
      throw new Error("The current question is already multiple choice.");
    }
    const round = state.activeRound;
    if (round?.resolved) throw new Error("This round is already resolved.");
    if (round?.player.answeredAt != null) {
      throw new Error("You already submitted an answer for this card.");
    }
    const source = this.sourceCardForQuestion(state, current);
    if (!source) throw new Error("Could not find the source card for this question.");
    const expected = {
      questionId: current.id,
      questionType: current.type,
      faculty: state.faculty,
      activePackId: state.activePackId,
      guestPackMode: state.guestPackMode,
      guestPackOverrideId: state.guestPackOverrideId,
      phaseToken: state.phaseToken,
      roundStartedAt: round?.startedAt ?? null,
    };
    const sourcePackId = packForSession(state).id;

    let mc = this.cachedMcQuestionForSource(state, source);
    const wasCached = !!mc;
    if (!mc) {
      const key = apiKey?.trim();
      if (!key) {
        throw new Error("OpenRouter API key required to generate multiple-choice distractors.");
      }
      const opts: DistractorOpts = {
        apiKey: key,
        facultyId: source.faculty,
        subject: source.subject,
        difficulty: source.difficulty,
        maxRetriesPerCard: 1,
      };
      const generated = await cardToMcQuestion(this.sourceCardToInput(source), opts);
      if (!generated) throw new Error("Could not generate multiple-choice distractors for this card.");
      mc = this.normalizeGeneratedMcQuestion(source, generated);
      const updated = appendQuestionToPackBank(sourcePackId, source.faculty, mc);
      if (updated) await this.persistImportedPack(sessionId, updated);
    }

    const latest = this.getOrCreate(sessionId);
    const latestRound = latest.activeRound;
    const sourceCardStillActive =
      latest.current?.id === expected.questionId &&
      latest.current?.type === expected.questionType &&
      latest.faculty === expected.faculty &&
      latest.activePackId === expected.activePackId &&
      latest.guestPackMode === expected.guestPackMode &&
      latest.guestPackOverrideId === expected.guestPackOverrideId &&
      latest.phaseToken === expected.phaseToken &&
      latestRound?.questionId === expected.questionId &&
      !latestRound.resolved &&
      !latestRound.idleTriggered &&
      latestRound.player.answeredAt == null &&
      (latestRound.startedAt ?? null) === expected.roundStartedAt;
    if (!sourceCardStillActive) {
      throw new Error("The source card changed while multiple choice was generating. Try again on the current card.");
    }

    const classSession = round?.classSession;
    const cardRole = round?.cardRole;
    const question: Question = { ...mc, type: "multiple-choice", canGenerateMc: false };
    question.stat = statForQuestion(question);
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    state.activeRound = this.openRound(state, question);
    state.activeRound.classSession = classSession ?? this.classSessionForPose(state, question.faculty ?? state.faculty, "practice");
    state.activeRound.cardRole = cardRole ?? (state.activeRound.classSession.mode === "class" ? "class" : "practice");
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    log.event("question.mc-generated", {
      sessionId,
      faculty: question.faculty,
      questionId: question.id,
      sourceCardId: source.id,
      cached: wasCached,
    });
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

  private studentPoolIdFor(ch: PlayerCharacter): string {
    const created = Number.isFinite(Number(ch.createdAt)) ? Math.floor(Number(ch.createdAt)) : 0;
    const firstCompletion = ch.yearbook?.[0]?.completedAt ?? Date.now();
    const seed = created > 0 ? created : firstCompletion;
    const name = ch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "student";
    const playbook = ch.playbookId.replace(/[^a-z0-9-]+/gi, "-").slice(0, 32) || "playbook";
    return `student_${seed}_${name}_${playbook}`;
  }

  private archiveCompletedCharacter(state: QuizState, ch: PlayerCharacter): StudentPoolEntry | null {
    const yearbook = Array.isArray(ch.yearbook) ? ch.yearbook : [];
    if (yearbook.length < GRADES.length) return null;
    const completedTimes = yearbook.map((y) => Number(y.completedAt) || 0);
    const completedAt = Math.max(...completedTimes) || Date.now();
    const entry: StudentPoolEntry = {
      id: this.studentPoolIdFor(ch),
      name: ch.name,
      playbookId: ch.playbookId,
      stats: { ...ch.stats },
      arcAnswer: ch.arcAnswer,
      ...(ch.flavorQuote ? { flavorQuote: ch.flavorQuote } : {}),
      personality: ch.personality,
      ...(ch.portraitDataUrl ? { portraitDataUrl: ch.portraitDataUrl } : {}),
      ...(ch.diplomaImageDataUrl ? { diplomaImageDataUrl: ch.diplomaImageDataUrl } : {}),
      yearbook: yearbook.map((y) => ({ ...y, stats: y.stats ? { ...y.stats } : undefined })),
      ...(ch.levelUps ? { levelUps: ch.levelUps.map((l) => ({ ...l, reward: { ...l.reward } })) } : {}),
      ...(ch.inheritedFrom ? { inheritedFrom: { ...ch.inheritedFrom } } : {}),
      ...(ch.mashCard ? { mashCard: ensureMashCard(ch.mashCard) } : {}),
      createdAt: Number.isFinite(Number(ch.createdAt)) ? Math.floor(Number(ch.createdAt)) : completedAt,
      completedAt,
    };

    const pool = Array.isArray(state.studentPool) ? [...state.studentPool] : [];
    const existing = pool.findIndex((student) => student.id === entry.id);
    if (existing >= 0) pool[existing] = entry;
    else pool.push(entry);
    pool.sort((a, b) => a.completedAt - b.completedAt || a.name.localeCompare(b.name));
    state.studentPool = pool.slice(-STUDENT_POOL_LIMIT);
    return entry;
  }

  private resetActiveCharacterProgress(state: QuizState): void {
    state.current = null;
    state.lastReveal = null;
    state.activeRound = null;
    state.pendingRoll = null;
    state.askedQuestionIds = [];
    state.cardMemory = {};
    state.roomBoards = {};
    state.currentGrade = DEFAULT_GRADE;
    state.completedGrades = [];
    state.hasSeenIntro = true;
    state.schoolEvents = [];
    state.essayReports = [];
    state.npcRosters = {};
    state.npcCohort = initialNpcCohort();
    this.ensureRoster(state, DEFAULT_GRADE);
    this.transition(state, { kind: "clear-board" });
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
    const flavorQuote = input.flavorQuote?.trim();
    const portraitDataUrl = normalizeStoredImageRef(input.portraitDataUrl, "portraitDataUrl");
    // If the player accepted the mentor offer from a graduated previous
    // character, snapshot the mentor info onto the new character. Either
    // way, clear the offer — it's a one-time consume.
    const inheritedFrom = (input.mentorAccepted && state.mentorOffer) ? { ...state.mentorOffer } : undefined;
    state.mentorOffer = null;
    // Seed the MASH card. If a mentor was inherited, give a +1 head-start
    // to one classmate keyed off the mentor's name (deterministic, so a
    // re-roll lands on the same student). The mentor's relationship
    // carries forward.
    const mashCard: MashCard = emptyMashCard();
    if (inheritedFrom) {
      const ids = Object.keys(mashCard.cells);
      let h = 0;
      for (const c of inheritedFrom.mentorName) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const seed = ids[h % ids.length];
      const cell = seed ? mashCard.cells[seed] : undefined;
      if (cell) applyMashTick(cell, 1);
    }
    this.resetActiveCharacterProgress(state);
    state.character = {
      name,
      playbookId: input.playbookId,
      stats: { ...input.stats },
      arcAnswer: input.arcAnswer.trim(),
      ...(flavorQuote ? { flavorQuote } : {}),
      personality: input.personality.trim(),
      ...(portraitDataUrl ? { portraitDataUrl } : {}),
      yearbook: [],
      ...(inheritedFrom ? { inheritedFrom } : {}),
      mashCard,
      createdAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("character.created", {
      sessionId, characterName: name, playbookId: input.playbookId, mentorAccepted: !!inheritedFrom,
    });
    this.recordFunnelStep(state, "first_character_created", {
      characterName: name,
      playbookId: input.playbookId,
      mentorAccepted: !!inheritedFrom,
    });
    return state;
  }

  /** Update only the portrait on the existing character. Used when portrait
   *  generation completes after createCharacter (which is fire-and-go). */
  setPortrait(sessionId: string, portraitDataUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character to attach portrait to.");
    const stored = normalizeStoredImageRef(portraitDataUrl, "portraitDataUrl");
    if (!stored) throw new Error("portraitDataUrl is required.");
    state.character.portraitDataUrl = stored;
    this.archiveCompletedCharacter(state, state.character);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  setDiplomaImage(sessionId: string, diplomaImageDataUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character to attach diploma to.");
    const stored = normalizeStoredImageRef(diplomaImageDataUrl, "diplomaImageDataUrl");
    if (!stored) throw new Error("diplomaImageDataUrl is required.");
    state.character.diplomaImageDataUrl = stored;
    this.archiveCompletedCharacter(state, state.character);
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
      this.archiveCompletedCharacter(state, prev);
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
    this.resetActiveCharacterProgress(state);
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
    this.assertBoardMutationAllowed(state, "clear");
    this.transition(state, { kind: "clear-board" });
    this.discardBoardForFaculty(state, state.faculty);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  resetSession(sessionId: string): QuizState {
    const current = this.sessions.get(sessionId) ?? null;
    const wallet = current ? normalizeWallet(current.wallet, current.score.points ?? 0) : null;
    const characterSlots = current ? normalizeCharacterSlots(current.characterSlots) : null;
    this.sessions.delete(sessionId);
    const state = this.getOrCreate(sessionId);
    if (wallet) state.wallet = { ...wallet, meritStars: Math.max(0, Math.floor(Number(state.score.points ?? 0))) };
    if (characterSlots) state.characterSlots = characterSlots;
    if (wallet && this.ensureWelcomeHallPasses(state)) state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Legacy full-pack switch for imported/runtime packs. Normal creator-pack
   *  gameplay now uses setGuestPackAutoForSession/setGuestPackOverrideForSession
   *  so Ruby High Original stays mounted and a creator pack fills only the
   *  Guest Faculty slot.
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

  setGuestPackAutoForSession(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const previousGuestId = guestPackForSession(state)?.id ?? null;
    state.activePackId = null;
    state.guestPackMode = "auto";
    state.guestPackOverrideId = null;
    this.resetGuestCourseAfterChange(state, previousGuestId);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("pack.guest-auto-enabled", {
      sessionId,
      guestPackId: guestPackForSession(state)?.id ?? null,
    });
    return state;
  }

  setGuestPackOverrideForSession(sessionId: string, packId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const previousGuestId = guestPackForSession(state)?.id ?? null;
    state.activePackId = null;
    state.guestPackMode = "override";
    state.guestPackOverrideId = packId;
    this.resetGuestCourseAfterChange(state, previousGuestId);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    this.recordGuestPackOverrideSet(sessionId, { packId });
    log.event("pack.guest-override-set", { sessionId, packId });
    return state;
  }

  private resetGuestCourseAfterChange(state: QuizState, previousGuestId: string | null): void {
    const nextGuestId = guestPackForSession(state)?.id ?? null;
    if (previousGuestId === nextGuestId) return;
    if (state.roomBoards) delete state.roomBoards[GUEST_COURSE_ID];
    if (state.faculty === GUEST_COURSE_ID) {
      state.current = null;
      state.activeRound = null;
      state.lastReveal = null;
      this.transition(state, { kind: "clear-board" });
    }
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

function normalizeScore(score: QuizState["score"] | null | undefined): QuizState["score"] {
  const src = score && typeof score === "object" ? score : { correct: 0, total: 0 };
  return {
    correct: Math.max(0, Math.floor(Number(src.correct ?? 0))),
    total: Math.max(0, Math.floor(Number(src.total ?? 0))),
    points: Math.max(0, Math.floor(Number(src.points ?? 0))),
    possible: Math.max(0, Math.floor(Number(src.possible ?? 0))),
  };
}

function normalizePositiveInteger(value: number, label: string): number {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return amount;
}

function yearbookShareId(parts: {
  sessionId: string;
  source: "current-character" | "student-pool";
  name: string;
  createdAt: number;
}): string {
  return createHash("sha256")
    .update(`${parts.sessionId}:${parts.source}:${parts.name}:${parts.createdAt}`)
    .digest("hex")
    .slice(0, 20);
}

function yearbookShareCardsForState(state: QuizState): YearbookShareCard[] {
  const cards: YearbookShareCard[] = [];
  const addCards = (
    source: "current-character" | "student-pool",
    owner: Pick<PlayerCharacter, "name" | "playbookId" | "createdAt" | "yearbook">,
  ) => {
    const shareId = yearbookShareId({
      sessionId: state.sessionId,
      source,
      name: owner.name,
      createdAt: owner.createdAt,
    });
    for (const entry of owner.yearbook ?? []) {
      cards.push({
        shareId,
        grade: entry.grade,
        completedAt: entry.completedAt,
        characterName: entry.name || owner.name,
        playbookId: entry.playbookId ?? owner.playbookId ?? null,
        summary: entry.summary,
        ...(entry.stats ? { stats: { ...entry.stats } } : {}),
        ...(entry.portraitDataUrl ? { portraitDataUrl: entry.portraitDataUrl } : {}),
        ...(entry.flavorQuote ? { flavorQuote: entry.flavorQuote } : {}),
        ...(entry.arcAnswer ? { arcAnswer: entry.arcAnswer } : {}),
        ...(entry.subjectScores ? { subjectScores: { ...entry.subjectScores } } : {}),
        ...(entry.graduationReward ? { graduationReward: entry.graduationReward } : {}),
        superlatives: Array.isArray(entry.superlatives) ? [...entry.superlatives] : [],
        source,
      });
    }
  };
  if (state.character) addCards("current-character", state.character);
  for (const entry of state.studentPool ?? []) addCards("student-pool", entry);
  return cards.sort((a, b) => a.completedAt - b.completedAt);
}

function normalizeIdempotencyPart(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 80);
}

function normalizeCharacterSlots(value: unknown): CharacterSlotEntitlements {
  const src = value && typeof value === "object" ? value as Partial<CharacterSlotEntitlements> : {};
  const unlockedSlots = Math.max(DEFAULT_CHARACTER_SLOT_COUNT, Math.floor(Number(src.unlockedSlots ?? DEFAULT_CHARACTER_SLOT_COUNT)));
  const photoDayCredits = Math.max(0, Math.floor(Number(src.photoDayCredits ?? 0)));
  return { unlockedSlots, photoDayCredits };
}

function normalizeWalletMetadata(value: unknown): RubyHighWalletTransaction["metadata"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: NonNullable<RubyHighWalletTransaction["metadata"]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null) {
      out[key] = null;
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeWalletTransaction(raw: unknown): RubyHighWalletTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const kinds: RubyHighWalletTransactionKind[] = [
    "hall-pass-grant",
    "hall-pass-spend",
    "hall-pass-refund",
    "hall-pass-revoke",
    "photo-day-spend",
    "photo-day-refund",
  ];
  const sources: Array<NonNullable<RubyHighWalletTransaction["source"]>> = [
    "stripe",
    "solana",
    "iap",
    "revenuecat",
    "hosted-image",
    "hosted-ai",
    "question-generation",
    "character-slot",
    "course-slot",
    "photo-day",
    "admin",
    "system",
  ];
  const tx = raw as Record<string, unknown>;
  if (typeof tx.id !== "string" || !tx.id) return null;
  if (typeof tx.kind !== "string" || !kinds.includes(tx.kind as RubyHighWalletTransactionKind)) return null;
  const at = typeof tx.at === "number" && Number.isFinite(tx.at) ? Math.floor(tx.at) : Date.now();
  const entry: RubyHighWalletTransaction = {
    id: tx.id,
    kind: tx.kind as RubyHighWalletTransactionKind,
    at,
  };
  if (typeof tx.meritStars === "number" && Number.isFinite(tx.meritStars)) {
    entry.meritStars = Math.floor(tx.meritStars);
  }
  if (typeof tx.hallPasses === "number" && Number.isFinite(tx.hallPasses)) {
    entry.hallPasses = Math.floor(tx.hallPasses);
  }
  if (typeof tx.photoDayCredits === "number" && Number.isFinite(tx.photoDayCredits)) {
    entry.photoDayCredits = Math.floor(tx.photoDayCredits);
  }
  if (typeof tx.source === "string" && sources.includes(tx.source as NonNullable<RubyHighWalletTransaction["source"]>)) {
    entry.source = tx.source as NonNullable<RubyHighWalletTransaction["source"]>;
  }
  if (typeof tx.description === "string" && tx.description.trim()) {
    entry.description = tx.description.trim().slice(0, 240);
  }
  const metadata = normalizeWalletMetadata(tx.metadata);
  if (metadata) entry.metadata = metadata;
  return entry;
}

function normalizeWalletTransactions(value: unknown): RubyHighWalletTransaction[] {
  if (!Array.isArray(value)) return [];
  const out: RubyHighWalletTransaction[] = [];
  for (const raw of value) {
    const entry = normalizeWalletTransaction(raw);
    if (entry) out.push(entry);
  }
  return out.slice(-WALLET_TRANSACTION_LIMIT);
}

function normalizeWalletOperationLedger(value: unknown, transactions: RubyHighWalletTransaction[]): Record<string, RubyHighWalletTransaction> | undefined {
  const out: Record<string, RubyHighWalletTransaction> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const raw of Object.values(value as Record<string, unknown>)) {
      const entry = normalizeWalletTransaction(raw);
      if (entry) out[entry.id] = entry;
    }
  }
  for (const tx of transactions) {
    if (!out[tx.id]) out[tx.id] = { ...tx, ...(tx.metadata ? { metadata: { ...tx.metadata } } : {}) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function recordWalletTransaction(state: QuizState, transaction: RubyHighWalletTransaction): void {
  const ledger = state.wallet.operationLedger ?? {};
  ledger[transaction.id] = { ...transaction, ...(transaction.metadata ? { metadata: { ...transaction.metadata } } : {}) };
  state.wallet.operationLedger = ledger;
  state.wallet.transactions = [...(state.wallet.transactions ?? []), transaction].slice(-WALLET_TRANSACTION_LIMIT);
}

function normalizeWallet(wallet: unknown, fallbackMeritStars: number): QuizState["wallet"] {
  const src = wallet && typeof wallet === "object" ? wallet as Partial<QuizState["wallet"]> : {};
  const transactions = normalizeWalletTransactions(src.transactions);
  const operationLedger = normalizeWalletOperationLedger(src.operationLedger, transactions);
  const welcomeHallPassesGrantedAt = Math.floor(Number(src.welcomeHallPassesGrantedAt ?? 0));
  return {
    meritStars: Math.max(0, Math.floor(Number(src.meritStars ?? fallbackMeritStars))),
    hallPasses: Math.max(0, Math.floor(Number(src.hallPasses ?? 0))),
    ...(Number.isFinite(welcomeHallPassesGrantedAt) && welcomeHallPassesGrantedAt > 0
      ? { welcomeHallPassesGrantedAt }
      : {}),
    ...(Number.isFinite(Number(src.hostedAiAccessExpiresAt))
      ? { hostedAiAccessExpiresAt: Math.max(0, Math.floor(Number(src.hostedAiAccessExpiresAt))) }
      : {}),
    ...(transactions.length > 0 ? { transactions } : {}),
    ...(operationLedger ? { operationLedger } : {}),
  };
}

function firstBellComicPageId(pageNumber: number): string {
  return `first-bell-page-${String(pageNumber).padStart(2, "0")}`;
}

function normalizeComicUnlockReason(value: unknown): ComicPageUnlockReason {
  if (
    value === "teacher-class-aced" ||
    value === "teacher-year-completed" ||
    value === "student-befriended" ||
    value === "legacy"
  ) {
    return value;
  }
  return "legacy";
}

function normalizeComicCollection(value: unknown): ComicCollection {
  const src = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seen = new Set<number>();
  const unlockedPages: ComicPageUnlock[] = [];
  const rawPages = Array.isArray(src.unlockedPages) ? src.unlockedPages : [];
  for (const rawPage of rawPages) {
    if (!rawPage || typeof rawPage !== "object") continue;
    const page = rawPage as Record<string, unknown>;
    const pageNumber = Math.floor(Number(page.pageNumber));
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > FIRST_BELL_COMIC_PAGE_COUNT) continue;
    if (seen.has(pageNumber)) continue;
    seen.add(pageNumber);
    unlockedPages.push({
      issueId: FIRST_BELL_COMIC_ISSUE_ID,
      pageId: typeof page.pageId === "string" && page.pageId ? page.pageId : firstBellComicPageId(pageNumber),
      pageNumber,
      unlockedAt: typeof page.unlockedAt === "number" && Number.isFinite(page.unlockedAt) ? page.unlockedAt : Date.now(),
      reason: normalizeComicUnlockReason(page.reason),
      sourceId: typeof page.sourceId === "string" ? page.sourceId : "",
      label: typeof page.label === "string" ? page.label : "",
    });
  }
  unlockedPages.sort((a, b) => a.pageNumber - b.pageNumber);
  return {
    issueId: FIRST_BELL_COMIC_ISSUE_ID,
    title: FIRST_BELL_COMIC_TITLE,
    pageCount: FIRST_BELL_COMIC_PAGE_COUNT,
    unlockedPages,
  };
}

function normalizeSchoolEvents(value: unknown): SchoolEvent[] {
  if (!Array.isArray(value)) return [];
  const out: SchoolEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const kind = e.kind;
    const at = typeof e.at === "number" && Number.isFinite(e.at) ? e.at : Date.now();
    const id = typeof e.id === "string" && e.id ? e.id : `school_${String(kind)}_${at}`;
    const faculty = typeof e.faculty === "string" ? e.faculty : undefined;
    const grade = typeof e.grade === "string" && (GRADES as string[]).includes(e.grade) ? (e.grade as Grade) : null;
    if (kind === "relationship.ticked") {
      const delta = e.delta === -1 || e.delta === 0 || e.delta === 1 ? e.delta : 0;
      const reason = typeof e.reason === "string" && ["best-responder", "applauder", "rub", "pep-talk"].includes(e.reason)
        ? e.reason as MashTickReason
        : "applauder";
      if (typeof e.questionId !== "string" || typeof e.studentId !== "string") continue;
      out.push({
        id,
        kind,
        at,
        ...(faculty ? { faculty } : {}),
        grade,
        questionId: e.questionId,
        studentId: e.studentId,
        delta,
        reason,
        affinity: typeof e.affinity === "number" ? e.affinity : 0,
        circled: !!e.circled,
        scratched: !!e.scratched,
      });
    } else if (kind === "mash.axis-resolved") {
      if (
        typeof e.axis !== "string" ||
        !["crush", "job", "lives", "pet", "money", "lucky"].includes(e.axis) ||
        typeof e.studentId !== "string" ||
        typeof e.value !== "string"
      ) {
        continue;
      }
      out.push({
        id,
        kind,
        at,
        ...(faculty ? { faculty } : {}),
        grade,
        axis: e.axis as MashAxis,
        studentId: e.studentId,
        value: e.value,
      });
    } else if (kind === "comic.page-unlocked") {
      const pageNumber = Math.floor(Number(e.pageNumber));
      if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > FIRST_BELL_COMIC_PAGE_COUNT) continue;
      out.push({
        id,
        kind,
        at,
        ...(faculty ? { faculty } : {}),
        grade,
        issueId: FIRST_BELL_COMIC_ISSUE_ID,
        pageId: typeof e.pageId === "string" && e.pageId ? e.pageId : firstBellComicPageId(pageNumber),
        pageNumber,
        reason: normalizeComicUnlockReason(e.reason),
        sourceId: typeof e.sourceId === "string" ? e.sourceId : "",
        label: typeof e.label === "string" ? e.label : "",
      });
    }
  }
  return out.slice(-SCHOOL_EVENT_LIMIT);
}

function normalizeEssayReports(value: unknown): EssayReport[] {
  if (!Array.isArray(value)) return [];
  const out: EssayReport[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.questionId !== "string" || !e.questionId) continue;
    if (typeof e.prompt !== "string") continue;
    const gradedAt = typeof e.gradedAt === "number" && Number.isFinite(e.gradedAt) ? e.gradedAt : Date.now();
    const score = typeof e.score === "number" && Number.isFinite(e.score) ? clamp(e.score, 0, 10) : null;
    const grade = typeof e.grade === "string" && (GRADES as string[]).includes(e.grade) ? (e.grade as Grade) : null;
    const report: EssayReport = {
      id: typeof e.id === "string" && e.id ? e.id : `essay_${e.questionId}_${gradedAt.toString(36)}`,
      questionId: e.questionId,
      faculty: typeof e.faculty === "string" && e.faculty ? e.faculty : RUBY_FACULTY.id,
      grade,
      ...(typeof e.subject === "string" && e.subject ? { subject: e.subject } : {}),
      prompt: e.prompt,
      response: typeof e.response === "string" ? e.response : "",
      score,
      passed: typeof e.passed === "boolean" ? e.passed : !!(score !== null && score >= 7),
      comment: typeof e.comment === "string" ? e.comment : "",
      bestResponder: typeof e.bestResponder === "string" ? e.bestResponder : null,
      ...(typeof e.bestResponderScore === "number" && Number.isFinite(e.bestResponderScore)
        ? { bestResponderScore: clamp(e.bestResponderScore, 0, 10) }
        : {}),
      ...(typeof e.bestResponderComment === "string" && e.bestResponderComment
        ? { bestResponderComment: e.bestResponderComment }
        : {}),
      submittedAt: typeof e.submittedAt === "number" && Number.isFinite(e.submittedAt) ? e.submittedAt : gradedAt,
      gradedAt,
    };
    const rawClass = e.classSession;
    if (rawClass && typeof rawClass === "object") {
      const c = rawClass as Record<string, unknown>;
      if (c.mode === "class" || c.mode === "practice") {
        report.classSession = {
          mode: c.mode,
          facultyId: typeof c.facultyId === "string" && c.facultyId ? c.facultyId : report.faculty,
          ...(c.cardRole === "practice" || c.cardRole === "class" || c.cardRole === "social" ? { cardRole: c.cardRole } : {}),
          ...(typeof c.grade === "string" && (GRADES as string[]).includes(c.grade) ? { grade: c.grade as Grade } : {}),
          ...(typeof c.date === "string" && c.date ? { date: c.date } : {}),
          ...(typeof c.questionCount === "number" && Number.isFinite(c.questionCount) ? { questionCount: c.questionCount } : {}),
          ...(typeof c.totalQuestions === "number" && Number.isFinite(c.totalQuestions) ? { totalQuestions: c.totalQuestions } : {}),
        };
      }
    }
    out.push(report);
  }
  return out.slice(-ESSAY_REPORT_LIMIT);
}

function normalizeStudentPool(value: unknown): StudentPoolEntry[] {
  if (!Array.isArray(value)) return [];
  const out: StudentPoolEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const name = typeof e.name === "string" && e.name.trim() ? e.name.trim() : "";
    const playbookId = typeof e.playbookId === "string" && e.playbookId.trim() ? e.playbookId.trim() : "";
    const id = typeof e.id === "string" && e.id.trim() ? e.id.trim() : "";
    if (!id || !name || !playbookId) continue;
    const statsRaw = e.stats && typeof e.stats === "object" ? e.stats as Partial<CharacterStats> : {};
    const stats: CharacterStats = {
      head: Math.floor(Number(statsRaw.head ?? 0)),
      heart: Math.floor(Number(statsRaw.heart ?? 0)),
      hustle: Math.floor(Number(statsRaw.hustle ?? 0)),
      honor: Math.floor(Number(statsRaw.honor ?? 0)),
    };
    const yearbook = Array.isArray(e.yearbook)
      ? e.yearbook
        .filter((entry): entry is PlayerCharacter["yearbook"][number] =>
          !!entry
          && typeof entry === "object"
          && typeof (entry as { grade?: unknown }).grade === "string"
          && (GRADES as string[]).includes((entry as { grade: string }).grade)
          && typeof (entry as { completedAt?: unknown }).completedAt === "number",
        )
        .map((entry) => ({ ...entry, stats: entry.stats ? { ...entry.stats } : undefined }))
      : [];
    if (yearbook.length < GRADES.length) continue;
    const completedAt = typeof e.completedAt === "number" && Number.isFinite(e.completedAt)
      ? Math.floor(e.completedAt)
      : Math.max(...yearbook.map((entry) => Number(entry.completedAt) || 0), Date.now());
    const createdAt = typeof e.createdAt === "number" && Number.isFinite(e.createdAt)
      ? Math.floor(e.createdAt)
      : completedAt;
    const entry: StudentPoolEntry = {
      id,
      name,
      playbookId,
      stats,
      arcAnswer: typeof e.arcAnswer === "string" ? e.arcAnswer : "",
      ...(typeof e.flavorQuote === "string" && e.flavorQuote ? { flavorQuote: e.flavorQuote } : {}),
      personality: typeof e.personality === "string" ? e.personality : "",
      ...(typeof e.portraitDataUrl === "string" && e.portraitDataUrl ? { portraitDataUrl: e.portraitDataUrl } : {}),
      ...(typeof e.diplomaImageDataUrl === "string" && e.diplomaImageDataUrl ? { diplomaImageDataUrl: e.diplomaImageDataUrl } : {}),
      yearbook,
      ...(Array.isArray(e.levelUps) ? { levelUps: e.levelUps as StudentPoolEntry["levelUps"] } : {}),
      ...(e.inheritedFrom && typeof e.inheritedFrom === "object"
        ? { inheritedFrom: e.inheritedFrom as StudentPoolEntry["inheritedFrom"] }
        : {}),
      ...(e.mashCard && typeof e.mashCard === "object" ? { mashCard: ensureMashCard(e.mashCard as MashCard) } : {}),
      createdAt,
      completedAt,
    };
    out.push(entry);
  }
  out.sort((a, b) => a.completedAt - b.completedAt || a.name.localeCompare(b.name));
  return out.slice(-STUDENT_POOL_LIMIT);
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
  const score = normalizeScore(s.score);
  return {
    ...s,
    askedQuestionIds: Array.isArray(s.askedQuestionIds) ? s.askedQuestionIds : [],
    cardMemory: s.cardMemory && typeof s.cardMemory === "object" ? s.cardMemory : {},
    roomBoards: s.roomBoards && typeof s.roomBoards === "object" ? s.roomBoards : {},
    history: Array.isArray(s.history) ? s.history : [],
    score,
    wallet: normalizeWallet((s as { wallet?: unknown }).wallet, score.points ?? 0),
    status: statusForPhase(phase),
    phase,
    phaseToken: typeof s.phaseToken === "number" && s.phaseToken >= 0 ? s.phaseToken : 0,
    lastReveal: s.lastReveal ?? null,
    currentGrade: migratedGrade,
    completedGrades: migratedCompleted,
    hasSeenIntro: !!s.hasSeenIntro,
    activePackId: typeof s.activePackId === "string" ? s.activePackId : null,
    guestPackMode: (s as { guestPackMode?: unknown }).guestPackMode === "override" ? "override" : "auto",
    guestPackOverrideId: typeof (s as { guestPackOverrideId?: unknown }).guestPackOverrideId === "string"
      ? (s as { guestPackOverrideId: string }).guestPackOverrideId
      : null,
    studentPool: normalizeStudentPool((s as { studentPool?: unknown }).studentPool),
    characterSlots: normalizeCharacterSlots((s as { characterSlots?: unknown }).characterSlots),
    comicCollection: normalizeComicCollection((s as { comicCollection?: unknown }).comicCollection),
    schoolEvents: normalizeSchoolEvents((s as { schoolEvents?: unknown }).schoolEvents),
    essayReports: normalizeEssayReports((s as { essayReports?: unknown }).essayReports),
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

function buildRubyHighDailyBuckets(now: number, count: number): {
  days: RubyHighAnalyticsDay[];
  byDate: Map<string, RubyHighAnalyticsDay>;
} {
  const start = startOfUtcDay(now) - (count - 1) * 24 * 60 * 60 * 1000;
  const days: RubyHighAnalyticsDay[] = [];
  const byDate = new Map<string, RubyHighAnalyticsDay>();
  for (let i = 0; i < count; i++) {
    const date = isoDate(start + i * 24 * 60 * 60 * 1000);
    const day: RubyHighAnalyticsDay = {
      date,
      updatedSessions: 0,
      charactersCreated: 0,
      gradesCompleted: 0,
      essaysGraded: 0,
      appOpens: 0,
      sessionResumes: 0,
      funnelSteps: 0,
      visitorSeen: 0,
      yearbookOpens: 0,
      yearbookCopies: 0,
      guestSpotlightSeen: 0,
      guestSpotlightStarted: 0,
      commerceEvents: 0,
      llmCalls: 0,
      llmErrors: 0,
      durableErrors: 0,
      balanceSamples: 0,
    };
    days.push(day);
    byDate.set(date, day);
  }
  return { days, byDate };
}

function buildMetricEventsSnapshot(
  events: Iterable<StoredMetricEventRecord>,
  byDate: Map<string, RubyHighAnalyticsDay>,
): RubyHighMetricEventsSnapshot {
  const orderedEvents = Array.from(events).sort((a, b) => a.occurredAt - b.occurredAt);
  const byName: Record<StoredMetricEventName, number> = {
    visitor_seen: 0,
    app_open: 0,
    session_resume: 0,
    funnel_step: 0,
    yearbook_open: 0,
    yearbook_copy: 0,
    guest_spotlight_seen: 0,
    guest_spotlight_started: 0,
    guest_pack_override_set: 0,
    commerce: 0,
    llm_usage: 0,
    error: 0,
    balance_sample: 0,
  };
  const appOpenSessions = new Set<string>();
  const appOpenVisitors = new Set<string>();
  const resumeSessions = new Set<string>();
  const resumeVisitors = new Set<string>();
  const visitorHashes = new Set<string>();
  const yearbookVisitors = new Set<string>();
  const firstAppOpenBySession = new Map<string, number>();
  const first10m = {
    appOpenSessions: 0,
    firstCharacterCreated: 0,
    firstQuestionAnswered: 0,
    firstDailyClassPassed: 0,
    firstGradeCompleted: 0,
  };
  const funnel = {
    firstCharacterCreated: 0,
    firstQuestionAnswered: 0,
    firstEssaySubmitted: 0,
    firstDailyClassPassed: 0,
    firstGradeCompleted: 0,
  };
  const seenFirst10mSteps = new Set<string>();
  const yearbook = {
    opens: 0,
    copies: 0,
    uniqueVisitors: 0,
  };
  const guestSpotlight = {
    seen: 0,
    started: 0,
    overrideSet: 0,
  };
  const balance = {
    samples: 0,
    latestRepeatRate: null as number | null,
  };
  const commerce = {
    events: 0,
    hallPassesDelta: 0,
    meritStarsDelta: 0,
    photoDayCreditsDelta: 0,
    amountCents: 0,
  };
  const llm = {
    calls: 0,
    successes: 0,
    errors: 0,
    byProvider: {} as Record<string, number>,
  };
  const errors = {
    total: 0,
    byFeature: {} as Record<string, number>,
  };
  let total = 0;
  for (const event of orderedEvents) {
    total += 1;
    byName[event.name] += 1;
    const day = byDate.get(event.day);
    if (event.name === "visitor_seen") {
      if (event.visitorHash) visitorHashes.add(event.visitorHash);
      if (day) day.visitorSeen += 1;
    } else if (event.name === "app_open") {
      if (event.sessionId) appOpenSessions.add(event.sessionId);
      if (event.visitorHash) appOpenVisitors.add(event.visitorHash);
      if (event.sessionId) {
        const prev = firstAppOpenBySession.get(event.sessionId);
        if (prev == null || event.occurredAt < prev) firstAppOpenBySession.set(event.sessionId, event.occurredAt);
      }
      if (day) day.appOpens += 1;
    } else if (event.name === "session_resume") {
      if (event.sessionId) resumeSessions.add(event.sessionId);
      if (event.visitorHash) resumeVisitors.add(event.visitorHash);
      if (day) day.sessionResumes += 1;
    } else if (event.name === "funnel_step") {
      if (day) day.funnelSteps += 1;
      if (event.step === "first_character_created") funnel.firstCharacterCreated += 1;
      else if (event.step === "first_question_answered") funnel.firstQuestionAnswered += 1;
      else if (event.step === "first_essay_submitted") funnel.firstEssaySubmitted += 1;
      else if (event.step === "first_daily_class_passed") funnel.firstDailyClassPassed += 1;
      else if (event.step === "first_grade_completed") funnel.firstGradeCompleted += 1;
      const firstOpen = event.sessionId ? firstAppOpenBySession.get(event.sessionId) : undefined;
      if (event.sessionId && firstOpen != null && event.occurredAt - firstOpen >= 0 && event.occurredAt - firstOpen <= 10 * 60 * 1000) {
        const key = `${event.sessionId}:${event.step ?? ""}`;
        if (!seenFirst10mSteps.has(key)) {
          seenFirst10mSteps.add(key);
          if (event.step === "first_character_created") first10m.firstCharacterCreated += 1;
          else if (event.step === "first_question_answered") first10m.firstQuestionAnswered += 1;
          else if (event.step === "first_daily_class_passed") first10m.firstDailyClassPassed += 1;
          else if (event.step === "first_grade_completed") first10m.firstGradeCompleted += 1;
        }
      }
    } else if (event.name === "yearbook_open") {
      yearbook.opens += 1;
      if (event.visitorHash) yearbookVisitors.add(event.visitorHash);
      if (day) day.yearbookOpens += 1;
    } else if (event.name === "yearbook_copy") {
      yearbook.copies += 1;
      if (event.visitorHash) yearbookVisitors.add(event.visitorHash);
      if (day) day.yearbookCopies += 1;
    } else if (event.name === "guest_spotlight_seen") {
      guestSpotlight.seen += 1;
      if (day) day.guestSpotlightSeen += 1;
    } else if (event.name === "guest_spotlight_started") {
      guestSpotlight.started += 1;
      if (day) day.guestSpotlightStarted += 1;
    } else if (event.name === "guest_pack_override_set") {
      guestSpotlight.overrideSet += 1;
    } else if (event.name === "balance_sample") {
      balance.samples += 1;
      const repeatRate = metricNumber(event.metadata?.repeatRate);
      if (repeatRate != null) balance.latestRepeatRate = repeatRate;
      if (day) day.balanceSamples += 1;
    } else if (event.name === "commerce") {
      commerce.events += 1;
      commerce.hallPassesDelta += metricIntegerOrZero(event.hallPassesDelta);
      commerce.meritStarsDelta += metricIntegerOrZero(event.meritStarsDelta);
      commerce.photoDayCreditsDelta += metricIntegerOrZero(event.photoDayCreditsDelta);
      commerce.amountCents += metricIntegerOrZero(event.amountCents);
      if (day) day.commerceEvents += 1;
    } else if (event.name === "llm_usage") {
      llm.calls += 1;
      if (event.status === "error") llm.errors += 1;
      else if (event.status === "success") llm.successes += 1;
      const provider = event.provider || "unknown";
      llm.byProvider[provider] = (llm.byProvider[provider] ?? 0) + 1;
      if (day) {
        day.llmCalls += 1;
        if (event.status === "error") day.llmErrors += 1;
      }
    } else if (event.name === "error") {
      errors.total += 1;
      const feature = event.feature || "unknown";
      errors.byFeature[feature] = (errors.byFeature[feature] ?? 0) + 1;
      if (day) day.durableErrors += 1;
    }
  }
  first10m.appOpenSessions = firstAppOpenBySession.size;
  yearbook.uniqueVisitors = yearbookVisitors.size;
  return {
    total,
    byName,
    appOpen: {
      total: byName.app_open,
      uniqueSessions: appOpenSessions.size,
      uniqueVisitors: appOpenVisitors.size,
    },
    sessionResume: {
      total: byName.session_resume,
      uniqueSessions: resumeSessions.size,
      uniqueVisitors: resumeVisitors.size,
    },
    visitorSeen: {
      total: byName.visitor_seen,
      uniqueVisitors: visitorHashes.size,
    },
    funnel,
    first10m,
    yearbook,
    guestSpotlight,
    balance,
    commerce,
    llm,
    errors,
  };
}

function buildEventRetentionSnapshot(events: Iterable<StoredMetricEventRecord>, now: number): {
  characterD1: {
    eligibleSessions: number;
    returnedSessions: number;
    rate: number | null;
  };
  visitorD1: {
    eligibleVisitors: number;
    returnedVisitors: number;
    rate: number | null;
  };
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const orderedEvents = Array.from(events).sort((a, b) => a.occurredAt - b.occurredAt);
  const characterCreatedBySession = new Map<string, number>();
  const returnedCharacterSessions = new Set<string>();
  const visitorFirstSeen = new Map<string, number>();
  const returnedVisitors = new Set<string>();

  for (const event of orderedEvents) {
    if (event.name === "funnel_step" && event.step === "first_character_created" && event.sessionId) {
      if (!characterCreatedBySession.has(event.sessionId)) characterCreatedBySession.set(event.sessionId, event.occurredAt);
      continue;
    }
    if ((event.name === "app_open" || event.name === "session_resume") && event.sessionId) {
      const createdAt = characterCreatedBySession.get(event.sessionId);
      if (createdAt != null && event.occurredAt - createdAt >= dayMs) returnedCharacterSessions.add(event.sessionId);
    }
    if (
      event.visitorHash &&
      (event.name === "visitor_seen" || event.name === "app_open" || event.name === "session_resume")
    ) {
      const firstSeenAt = visitorFirstSeen.get(event.visitorHash);
      if (firstSeenAt == null) {
        visitorFirstSeen.set(event.visitorHash, event.occurredAt);
      } else if (event.occurredAt - firstSeenAt >= dayMs) {
        returnedVisitors.add(event.visitorHash);
      }
    }
  }

  let eligibleSessions = 0;
  for (const createdAt of characterCreatedBySession.values()) {
    if (now - createdAt >= dayMs) eligibleSessions += 1;
  }
  let eligibleVisitors = 0;
  for (const firstSeenAt of visitorFirstSeen.values()) {
    if (now - firstSeenAt >= dayMs) eligibleVisitors += 1;
  }
  const returnedEligibleSessions = Array.from(returnedCharacterSessions).filter((sessionId) => {
    const createdAt = characterCreatedBySession.get(sessionId);
    return createdAt != null && now - createdAt >= dayMs;
  }).length;
  const returnedEligibleVisitors = Array.from(returnedVisitors).filter((visitorHash) => {
    const firstSeenAt = visitorFirstSeen.get(visitorHash);
    return firstSeenAt != null && now - firstSeenAt >= dayMs;
  }).length;

  return {
    characterD1: {
      eligibleSessions,
      returnedSessions: returnedEligibleSessions,
      rate: eligibleSessions > 0 ? returnedEligibleSessions / eligibleSessions : null,
    },
    visitorD1: {
      eligibleVisitors,
      returnedVisitors: returnedEligibleVisitors,
      rate: eligibleVisitors > 0 ? returnedEligibleVisitors / eligibleVisitors : null,
    },
  };
}

function metricIntegerOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function incrementRubyHighDay(
  byDate: Map<string, RubyHighAnalyticsDay>,
  timestamp: number,
  key: Exclude<keyof RubyHighAnalyticsDay, "date">,
): void {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const day = byDate.get(isoDate(timestamp));
  if (day) day[key] += 1;
}

function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeMetricTimestamp(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Date.now();
}

function metricEventId(name: StoredMetricEventName, occurredAt: number): string {
  return `${name}_${occurredAt.toString(36)}_${randomUUID()}`;
}

function metricString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? clippedMetricValue(trimmed, 160) : undefined;
}

function metricNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clippedMetricValue(value: string, max: number): string {
  return value.length > max ? value.slice(0, Math.max(0, max - 1)) + "…" : value;
}

function normalizeMetricMetadata(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(key)) continue;
    if (raw == null) {
      out[key] = null;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === "string") {
      out[key] = clippedMetricValue(raw, 240);
    }
  }
  return out;
}

/** Backfill Paper Card snapshot on legacy yearbook entries written before
 *  the snapshot fields existed. Best-effort: if a player renamed mid-arc,
 *  old cards adopt the current name — that's the intended fallback, not
 *  a migration. New entries always carry their own snapshot. */
function backfillCharacter(c: PlayerCharacter | null): PlayerCharacter | null {
  if (!c) return null;
  // Always normalize the MASH card — legacy characters get an empty one,
  // partial cards get filled in.
  const mashCard = ensureMashCard(c.mashCard);
  if (!Array.isArray(c.yearbook) || c.yearbook.length === 0) {
    return { ...c, mashCard };
  }
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
  return { ...c, yearbook, mashCard };
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
