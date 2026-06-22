import { createHash, createHmac, randomUUID } from "node:crypto";
import { XSocialService, type XMilestoneContext } from "./x-social-service.js";
import {
  buildPublicWorldCohorts,
  buildPublicWorldRooms,
  publicSchoolWorldEvent,
  publicWorldNameReview,
  publicWorldRoomGoalEvents,
  publicWorldPortraitUrl,
  publicWorldRoomDisplayName,
  publicWorldRoomId,
  publicWorldSessionId,
  type PublicWorldEvent,
  type PublicWorldPresenceEntry,
  type PublicWorldRoom,
  type PublicWorldRoomGoalContribution,
  type PublicWorldStudent,
} from "./ruby-high/world-projection.js";
import {
  PHOTO_POST_SCHEDULER_STATE_ID,
  hydratePhotoPostSchedulerState,
  photoPostSchedulerSnapshot as buildPhotoPostSchedulerSnapshot,
  photoPostSchedulerStateRecord as buildPhotoPostSchedulerStateRecord,
  type DailyPhotoPostResult,
  type RubyHighPhotoPostSchedulerSnapshot,
} from "./ruby-high/photo-post-scheduler.js";
import {
  buildCurriculumCoverageSnapshot,
  generationDifficultyForCurriculumGrade,
  type MutableCurriculumCoverageRow,
  type RubyHighCurriculumCoverageRow,
  type RubyHighCurriculumCoverageSnapshot,
  type RubyHighCurriculumReplenishmentPlan,
} from "./ruby-high/curriculum-coverage.js";
import { builtInTeacherResearchCorpusForFaculty } from "./ruby-high/teacher-research-corpus.js";
import { teacherById } from "../characters/teachers.js";
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
  type AnswerStats,
  type BankedQuestion,
  type CardMemory,
  type CardReviewRating,
  type CharacterSlotEntitlements,
  type CharacterStats,
  type ClassPhotoArchive,
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
  type FirstBellReport,
  type Grade,
  type GradeDiplomaCollectible,
  type GraduationPhotoCollectible,
  type GraduationReward,
  type LastReveal,
  type MashAxis,
  type MashCard,
  type MashTickReason,
  type NpcRoundEntry,
  type NpcStudentState,
  type OpinionGrade,
  type Phase,
  type PendingPhotoReveal,
  type PlayerCharacter,
  type PublicWorldEventReport,
  type Question,
  type QuestionMediaAsset,
  type QuestionType,
  type QuizState,
  type RoomBoardSnapshot,
  type RoundOutcome,
  type SchoolEvent,
  type StudentPoolEntry,
  type TeachingRoomId,
  type RubyHighHallPassCard,
  type RubyHighHallPassCardRarity,
  type RubyHighHallPassCardRole,
  type RubyHighHallPassCardStatus,
  type RubyHighGeneratedNftProfileKind,
  type RubyHighHallPassPack,
  type RubyHighHallPassPackStatus,
  type RubyHighWalletTransaction,
  type RubyHighWalletTransactionKind,
} from "../types.js";
import { FacultyService, toFacultyMember } from "./faculty-service.js";
import {
  getDefaultStateStore,
  type StateStoreLike,
  type StoredAccountDeletionResult,
  type StoredAccountDeletionTarget,
  type StoredCourseSlotRecord,
  type StoredContentPackRecord,
  type StoredDraftContentPackRecord,
  type StoredMetricEventName,
  type StoredMetricEventRecord,
  type StoredPackInstallationRecord,
  type StoredPackReview,
  type StoredSchoolEventRecord,
  type StoredServiceStateRecord,
  type StoredTeacherRecord,
} from "./state-store.js";
import { log, setLogSink, type LogSinkRecord } from "./logger.js";
import { rewriteGeneratedPortraitS3Url } from "./generated-portrait-assets.js";
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
import { listStudents, studentById } from "../characters/students.js";
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
  getActivePack,
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
import type { ContentPack, PackFaculty, PackSourceCard } from "../content/types.js";
import { cardToMcQuestion, type DistractorOpts, type SourceCardInput } from "../content/source-distractors.js";
import {
  FIRST_BELL_SET_CODE,
  FIRST_BELL_SET_NAME,
  HALL_PASS_CARD_ITEM_LOCATIONS,
  HALL_PASS_CARD_SPECIALS,
  HALL_PASS_CARD_STUDENTS,
  HALL_PASS_CARD_SUPER_RARE_TEACHERS,
  HALL_PASS_CARD_TEACHERS,
  hallPassCardCatalogEntry,
  hallPassCardImagePath,
  hallPassCardName,
  hallPassCardProfileId,
  hallPassCardSetNumber,
  hallPassCardSubject,
  type HallPassCardCatalogEntry,
} from "./hall-pass-card-catalog.js";
import {
  HALL_PASS_PACK_REVEAL_ENTROPY_SOURCE,
  HALL_PASS_PACK_REVEAL_VERSION,
  hallPassCatalogHash,
  packRevealCommitment,
  packRevealSeed,
  packSlotRevealProof,
  sha256Hex,
} from "./hall-pass-reveal-provenance.js";

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
const SCHOOL_WORLD_RECENT_EVENT_LIMIT = 100;
const SCHOOL_WORLD_EVENT_CACHE_LIMIT = SCHOOL_WORLD_RECENT_EVENT_LIMIT * 4;
const SCHOOL_WORLD_SESSION_REFRESH_LIMIT = 5_000;
const SCHOOL_WORLD_STORE_REFRESH_MS = 2_000;
const ANSWER_HISTORY_LIMIT = 500;
const ESSAY_REPORT_LIMIT = 100;
const WALLET_TRANSACTION_LIMIT = 200;
const STUDENT_POOL_LIMIT = 50;
const HALL_PASS_REDEEMED_CARD_LIMIT = 160;
const DAILY_MEMORY_DETAIL_LIMIT = 25;
const CLASS_PHOTO_HISTORY_LIMIT = 25;
const SCHOOL_SNAPSHOT_PHOTO_POOL_LIMIT = 100;
const SCHOOL_SNAPSHOT_CLASS_PHOTO_HISTORY_LIMIT = 100;
const PHOTO_POST_RETRY_DELAY_MS = 15 * 60 * 1000;
const PHOTO_POST_SCHEDULER_INTERVAL_MS = 60 * 1000;
export const HALL_PASS_CARDS_PER_PACK = 5;
export const HALL_PASS_CARD_BURN_HALL_PASS_VALUE = 5;
const GENERATED_NFT_SET_NAME = "Ruby High Generated";
const GENERATED_NFT_SET_CODE = "GEN2";
const GENERATED_NFT_CARD_VERSION = "ruby-high-generated-nft-v2";
export const CHAT_MERIT_STAR_COST = 100;
export const DEFAULT_CHARACTER_SLOT_COUNT = 1;
export const CHARACTER_SLOT_HALL_PASS_COST = 1;
export const CHARACTER_SLOT_PHOTO_DAY_CREDITS = 1;
export const WELCOME_HALL_PASS_GRANT = 5;
export const WELCOME_HALL_PASS_GRANT_ID = "system:welcome-hall-passes:v1";
const FIRST_BELL_EASY_QUESTION_COUNT = 3;
const FIRST_BELL_DIFFICULTY_WEIGHTS: DifficultyWeights = { easy: 0.75, medium: 0.25, hard: 0 };
const RUBY_HIGH_ASSET_PREFIX = "/api/apps/ruby-high/assets";
const DIPLOMA_ASSET_VERSION = "ruby-high-grade-diplomas-v1";
const DIPLOMA_GRADE_LABELS: Record<Grade, string> = {
  "9": "9th Grade",
  "10": "10th Grade",
  "11": "11th Grade",
  "12": "12th Grade",
};
const DIPLOMA_IMAGE_URL_BY_GRADE: Record<Grade, string> = {
  "9": `${RUBY_HIGH_ASSET_PREFIX}/diplomas/ruby-high-9.png?v=${DIPLOMA_ASSET_VERSION}`,
  "10": `${RUBY_HIGH_ASSET_PREFIX}/diplomas/ruby-high-10.png?v=${DIPLOMA_ASSET_VERSION}`,
  "11": `${RUBY_HIGH_ASSET_PREFIX}/diplomas/ruby-high-11.png?v=${DIPLOMA_ASSET_VERSION}`,
  "12": `${RUBY_HIGH_ASSET_PREFIX}/diplomas/ruby-high-12.png?v=${DIPLOMA_ASSET_VERSION}`,
};

function gradeRank(grade: string): number {
  const idx = GRADES.indexOf(grade as Grade);
  return idx >= 0 ? idx : 0;
}

function characterAllowsSocialSharing(ch: PlayerCharacter): boolean {
  return ch.socialConsent !== false;
}

function characterHasPublicName(ch: PlayerCharacter): boolean {
  return publicWorldNameReview(ch.name).ok && !isSyntheticCharacterName(ch.name);
}

function characterAllowsPublicSharing(ch: PlayerCharacter): boolean {
  return characterAllowsSocialSharing(ch) && ch.publicWorldVisible !== false && characterHasPublicName(ch);
}

function characterDailyClassRecords(ch: PlayerCharacter): DailyClassRecord[] {
  const dailyClasses = ch.dailyClasses;
  if (!dailyClasses || typeof dailyClasses !== "object" || Array.isArray(dailyClasses)) return [];
  return Object.values(dailyClasses).filter(
    (record): record is DailyClassRecord => !!record && typeof record === "object",
  );
}

function characterArrayField<K extends "yearbook" | "levelUps" | "pendingPhotos" | "classPhotos">(
  ch: PlayerCharacter,
  key: K,
): NonNullable<PlayerCharacter[K]> {
  const value = ch[key];
  return (Array.isArray(value) ? value.filter((entry) => !!entry && typeof entry === "object") : []) as NonNullable<PlayerCharacter[K]>;
}

function characterYearbookEntries(owner: Pick<PlayerCharacter | StudentPoolEntry, "yearbook">): PlayerCharacter["yearbook"] {
  const yearbook = owner.yearbook;
  return (Array.isArray(yearbook) ? yearbook.filter((entry) => !!entry && typeof entry === "object") : []) as PlayerCharacter["yearbook"];
}

function graduationCollectibleId(
  kind: "diploma" | "photo",
  parts: { name: string; createdAt: number; grade: Grade; completedAt: number; extra?: string },
): string {
  const hash = createHash("sha256")
    .update(`${kind}:${parts.name}:${parts.createdAt}:${parts.grade}:${parts.completedAt}:${parts.extra ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `ruby-high-${kind}-${parts.grade}-${hash}`;
}

function gradeDiplomaCollectibleFor(parts: {
  characterName: string;
  characterCreatedAt: number;
  grade: Grade;
  completedAt: number;
  teacherResponseQuote?: string | null;
}): GradeDiplomaCollectible {
  const label = DIPLOMA_GRADE_LABELS[parts.grade] ?? `Grade ${parts.grade}`;
  const teacherResponseLine = parts.teacherResponseQuote
    ? `\n\n"${parts.teacherResponseQuote}"`
    : "";
  return {
    kind: "grade-diploma",
    id: graduationCollectibleId("diploma", {
      name: parts.characterName,
      createdAt: parts.characterCreatedAt,
      grade: parts.grade,
      completedAt: parts.completedAt,
      extra: parts.teacherResponseQuote ?? undefined,
    }),
    grade: parts.grade,
    title: `Ruby High ${label} Diploma`,
    description: `${parts.characterName} completed ${label} at Ruby High.${teacherResponseLine}`,
    imageUrl: DIPLOMA_IMAGE_URL_BY_GRADE[parts.grade],
    issuedAt: parts.completedAt,
    assetVersion: DIPLOMA_ASSET_VERSION,
  };
}

function teacherPortraitUrl(facultyId: string, assetTeacherId?: string, profileImageUrl?: string): string | undefined {
  if (profileImageUrl) return profileImageUrl;
  const assetId = assetTeacherId || facultyId;
  if (assetId === RUBY_FACULTY.id || assetId === "sally-science" || assetId === "professor-edward") {
    return `${RUBY_HIGH_ASSET_PREFIX}/teachers/${assetId}-face.png`;
  }
  return undefined;
}

function teacherFullPortraitUrl(facultyId: string, assetTeacherId?: string, profileImageUrl?: string): string | undefined {
  if (profileImageUrl) return profileImageUrl;
  const assetId = assetTeacherId || facultyId;
  if (assetId === RUBY_FACULTY.id || assetId === "sally-science" || assetId === "professor-edward") {
    return `${RUBY_HIGH_ASSET_PREFIX}/teachers/${assetId}-full.png`;
  }
  return undefined;
}

function studentPortraitUrl(studentId: string): string {
  return `${RUBY_HIGH_ASSET_PREFIX}/students/${studentId}-face.png`;
}

function studentFullPortraitUrl(studentId: string): string {
  return `${RUBY_HIGH_ASSET_PREFIX}/students/${studentId}-full.png`;
}

const PLAYBOOK_DEFAULT_PORTRAIT: Record<string, string> = {
  overachiever: "indra",
  slacker: "sami",
  heart: "mika",
  outsider: "noor",
  "class-clown": "ravi",
  lifer: "lyra",
};

function defaultPlayerPortraitUrl(playbookId: string | undefined): string {
  const studentId = PLAYBOOK_DEFAULT_PORTRAIT[playbookId || ""] || "indra";
  return studentFullPortraitUrl(studentId);
}

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

export interface GraduationGateProgress {
  grade: Grade | null;
  requiredDays: number;
  dailyClasses: number;
  requiredRooms: number;
  completedRooms: number;
  openElectiveSlots: number;
  requiredFacultyIds: string[];
  eligibleFacultyIds: string[];
  classGrades: Record<string, string>;
  ready: boolean;
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
  amountCents?: number;
}

export interface MeritStarMutationInput {
  amount: number;
  idempotencyKey: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface MeritStarMutationResult {
  state: QuizState;
  applied: boolean;
  transaction: RubyHighWalletTransaction;
}

export interface ChatMeritStarQuote {
  amount: number;
  baseAmount: number;
  questionId: string | null;
  chatCount: number;
}

export interface HallPassCardGrantInput {
  cardCount: number;
  idempotencyKey: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface HallPassPackOpenInput {
  packId: string;
  ownerWalletAddress?: string;
  idempotencyKey?: string;
  openSignature?: string;
  entropySource?: string;
  revealSeed?: string;
  revealSlot?: number;
  randomnessAccount?: string;
  revealTransaction?: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  deferPersist?: boolean;
  at?: number;
}

export interface HallPassMutationResult {
  state: QuizState;
  applied: boolean;
  transaction: RubyHighWalletTransaction;
  cards?: RubyHighHallPassCard[];
  pack?: RubyHighHallPassPack;
  packs?: RubyHighHallPassPack[];
}

export interface GeneratedNftCardInput {
  ownerWalletAddress?: string;
  requestId?: string;
  at?: number;
}

export interface GeneratedCastNftCardInput extends GeneratedNftCardInput {
  characterId: string;
}

export interface GeneratedYearbookNftCardInput extends GeneratedNftCardInput {
  grade: Grade;
}

export interface GeneratedNftCardResult extends HallPassMutationResult {
  card: RubyHighHallPassCard;
  cards: RubyHighHallPassCard[];
}

export interface HallPassCardBurnInput {
  cardId: string;
  ownerWalletAddress: string;
  mintAddress: string;
  burnSignature: string;
}

export interface BurnedHallPassCardSpendInput {
  burns: HallPassCardBurnInput[];
  idempotencyKey: string;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface HallPassCardMintInput {
  cardId: string;
  ownerWalletAddress: string;
  mintAddress: string;
  mintSignature: string;
  metadataUri: string;
  idempotencyKey?: string;
  at?: number;
}

export interface HallPassCardMintPreparationInput {
  cardId: string;
  ownerWalletAddress: string;
  mintAddress: string;
  metadataUri: string;
  transactionMessageHash?: string;
  at?: number;
}

export interface HallPassPackMintInput {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  assetAddress: string;
  mintSignature: string;
  metadataUri: string;
  idempotencyKey: string;
  serial?: number;
  source?: RubyHighWalletTransaction["source"];
  description?: string;
  metadata?: RubyHighWalletTransaction["metadata"];
  at?: number;
}

export interface HostedAiAccessActivationInput {
  hallPassCost: number;
  durationMs: number;
  now?: number;
  burns?: HallPassCardBurnInput[];
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
    characterD7: {
      eligibleSessions: number;
      returnedSessions: number;
      rate: number | null;
    };
    visitorD7: {
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
      firstBellReportAwarded: number;
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
  world: RubyHighWorldHealthSnapshot;
  photoPosts: RubyHighPhotoPostSchedulerSnapshot;
  curriculum: RubyHighCurriculumCoverageSnapshot;
  daily: RubyHighAnalyticsDay[];
}

export interface RubyHighWorldHealthSnapshot {
  lastRefreshAt: number | null;
  refreshAgeMs: number | null;
  refreshIntervalMs: number;
  activeStudents: number;
  activeRooms: number;
  recentEvents: number;
  newestEventAt: number | null;
  durableEventCacheSize: number;
  durableEventCacheLimit: number;
  publicEventLogSize: number;
  publicEventLogLimit: number;
  durableRoomRecords: number;
  durableRoomRecordLimit: number;
  durableRoomOutcomes: number;
  durableRoomOutcomeLimit: number;
  durableTermRecords: number;
  durableTermRecordLimit: number;
  durableTeacherAgendas: number;
  durableTeacherAgendaLimit: number;
  teacherAgendaExecution: {
    ready: number;
    queued: number;
    watching: number;
  };
  recentTeacherAgendas: PublicWorldTeacherAgendaRecord[];
  recentTerms: PublicWorldTermRecord[];
  durableCohortTerms: number;
  recentCohortTerms: PublicWorldCohortTermRecord[];
  liveRoomGoals: number;
  suppressedEvents: number;
  recentRoomOutcomes: PublicWorldRoomOutcomeRecord[];
  summary: PublicWorldSummarySnapshot;
}

export interface PublicWorldSummarySnapshot {
  generatedAt: number;
  schoolYear: string;
  eventCount: number;
  newestEventAt: number | null;
  byKind: Partial<Record<SchoolWorldEvent["kind"], number>>;
  byGrade: Partial<Record<Grade, number>>;
  roomGoalEvents: {
    total: number;
    complete: number;
  };
  studySparks: {
    total: number;
    byGrade: Partial<Record<Grade, number>>;
  };
  termProgress: {
    totalSparks: number;
    level: number;
    nextLevelAt: number;
    sparksToNextLevel: number;
    label: string;
  };
  termRules: {
    byGrade: Partial<Record<Grade, PublicWorldTermRoomRule>>;
  };
  curriculumLoops: PublicWorldCurriculumLoopSummary;
  curriculumLoopHistory: PublicWorldCurriculumLoopEvent[];
}

export interface PublicWorldCurriculumLoopSummary {
  inReview: number;
  promoted: number;
  byGrade: Partial<Record<Grade, {
    inReview: number;
    promoted: number;
  }>>;
}

export interface PublicWorldCurriculumLoopEvent {
  grade: Grade;
  facultyId: string;
  displayName: string;
  status: NonNullable<PublicWorldTeacherAgendaRecord["draftStatus"]>;
  questionCount: number;
  at: number;
}

export type { DailyPhotoPostResult, RubyHighPhotoPostSchedulerSnapshot };
export type {
  RubyHighCurriculumCoverageRow,
  RubyHighCurriculumCoverageSnapshot,
  RubyHighCurriculumReplenishmentPlan,
};

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
    firstBellReportAwarded: number;
    firstEssaySubmitted: number;
    firstDailyClassPassed: number;
    firstGradeCompleted: number;
  };
  first10m: {
    appOpenSessions: number;
    firstCharacterCreated: number;
    firstQuestionAnswered: number;
    firstBellReportAwarded: number;
    firstDailyClassPassed: number;
    firstGradeCompleted: number;
  };
  yearbook: {
    opens: number;
    copies: number;
    uniqueVisitors: number;
  };
  referral: {
    artifactsCreated: number;
    sharesInitiated: number;
    linkVisits: number;
    uniqueReferredVisitors: number;
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
    revenueBySource: Record<string, number>;
    payingSessions: number;
  };
  conversionFunnel: {
    totalVisitors: number;
    charactersCreated: number;
    payers: number;
    visitorToCharacterRate: number | null;
    characterToPayerRate: number | null;
    visitorToPayerRate: number | null;
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

export interface DailyMemoryEntry {
  studentName: string;
  facultyId?: string;
  letterGrade?: string;
  fromGrade?: string;
  toGrade?: string;
}

export interface SchoolSnapshotPhoto {
  studentName: string;
  kind: "portrait" | "diploma" | "graduation" | "class-photo";
  teacherFacultyId: string;
  earnedAt: number;
}

export interface SchoolSnapshotClassPhoto {
  studentName: string;
  teacherFacultyId: string;
  earnedAt: number;
  revealedAt: number;
  status: "posted" | "revealed";
  tweetId?: string;
  tweetedAt?: number;
}

export interface SchoolSnapshot {
  topByYear: Record<string, RecentlyActiveStudent[]>;
  photoPool: SchoolSnapshotPhoto[];
  classPhotoHistory: SchoolSnapshotClassPhoto[];
  dailyMemories: DailyMemories;
}

export interface GraduationPhotoScene {
  grade: Grade;
  characterName: string;
  characterImageUrl: string;
  teacher: {
    id: string;
    name: string;
    imageUrl: string;
  };
  student: {
    id: string;
    name: string;
    imageUrl: string;
  };
}

export type SchoolWorldStudent = PublicWorldStudent;
export type SchoolWorldRoom = PublicWorldRoom;
export type SchoolWorldEvent = PublicWorldEvent;

export interface SchoolWorldSnapshot {
  generatedAt: number;
  activeStudents: number;
  activeRooms: SchoolWorldRoom[];
  cohorts: Record<string, SchoolWorldStudent[]>;
  recentEvents: SchoolWorldEvent[];
  summary: Pick<PublicWorldSummarySnapshot, "schoolYear" | "roomGoalEvents" | "studySparks" | "termProgress" | "termRules" | "curriculumLoops" | "curriculumLoopHistory">;
  curriculum: {
    activeCharacterSessions: number;
    lowPools: RubyHighCurriculumCoverageRow[];
  };
}

export interface PublicWorldModerationReport {
  id: string;
  eventId: string;
  reason: string;
  createdAt: number;
  reporterId: string;
  reporterCharacterName: string | null;
  reportCountForEvent: number;
  moderatorNote: PublicWorldModeratorNote | null;
  event: Pick<SchoolWorldEvent, "id" | "kind" | "at" | "faculty" | "grade"> & { label: string | null } | null;
}

export interface PublicWorldSuppressedEvent {
  eventId: string;
  reason: string;
  suppressedAt: number;
}

export interface PublicWorldModeratorNote {
  eventId: string;
  note: string;
  updatedAt: number;
}

export interface PublicWorldModerationSnapshot {
  ok: true;
  generatedAt: number;
  reportCount: number;
  reports: PublicWorldModerationReport[];
  suppressedEvents: PublicWorldSuppressedEvent[];
  moderatorNotes: PublicWorldModeratorNote[];
}

export interface PublicWorldModerationDismissResult {
  ok: true;
  generatedAt: number;
  reportId: string;
  dismissed: boolean;
  dismissedCount: number;
}

export interface PublicWorldEventSuppressionResult {
  ok: true;
  generatedAt: number;
  eventId: string;
  reason: string;
  suppressed: boolean;
}

export interface PublicWorldModeratorNoteResult {
  ok: true;
  generatedAt: number;
  eventId: string;
  note: string;
  updated: boolean;
}

const PUBLIC_WORLD_EVENT_ID_RE = /^world:event:[a-f0-9]{16}$/i;
const PUBLIC_WORLD_REPORT_REASON_LIMIT = 240;
const PUBLIC_WORLD_MODERATOR_NOTE_LIMIT = 500;
const PUBLIC_WORLD_EVENTS_STATE_ID = "ruby-high:public-world-events:v1";
const PUBLIC_WORLD_ROOMS_STATE_ID = "ruby-high:public-world-rooms:v1";
const PUBLIC_WORLD_ROOM_OUTCOMES_STATE_ID = "ruby-high:public-world-room-outcomes:v1";
const PUBLIC_WORLD_TERMS_STATE_ID = "ruby-high:public-world-terms:v1";
const PUBLIC_WORLD_TEACHER_AGENDAS_STATE_ID = "ruby-high:public-world-teacher-agendas:v1";
const PUBLIC_WORLD_SUMMARY_STATE_ID = "ruby-high:public-world-summary:v1";
const PUBLIC_WORLD_MODERATION_STATE_ID = "ruby-high:public-world-moderation:v1";
const LIVE_ROOM_GOALS_STATE_ID = "ruby-high:live-room-goals:v1";
const PUBLIC_WORLD_ROOM_RECORD_LIMIT = 80;
const PUBLIC_WORLD_ROOM_OUTCOME_LIMIT = 120;
const PUBLIC_WORLD_TERM_RECORD_LIMIT = 12;
const PUBLIC_WORLD_TEACHER_AGENDA_LIMIT = 80;
const LIVE_ROOM_CLASS_CHAIN_WINDOW_MS = 10 * 60 * 1000;

export interface LiveRoomGoalContributionResult {
  grade: Grade;
  facultyId: string;
  displayName: string;
  progress: number;
  target: number;
  complete: boolean;
  updatedAt: number;
  duplicate: boolean;
  ruleLabel?: string;
  bonusLabel?: string;
}

interface LiveRoomGoalState {
  grade: Grade;
  facultyId: string;
  displayName: string;
  day: string;
  target: number;
  ruleLabel?: string;
  contributors: Set<string>;
  startedAt: number;
  updatedAt: number;
}

export interface PublicWorldRoomRecord {
  key: string;
  schoolYear: string;
  termId: string;
  grade: Grade;
  facultyId: string;
  displayName: string;
  activeStudents: number;
  goal: PublicWorldRoom["goal"];
  updatedAt: number;
}

export interface PublicWorldRoomOutcomeRecord {
  id: string;
  schoolYear: string;
  termId: string;
  day: string;
  grade: Grade;
  facultyId: string;
  displayName: string;
  goalKind: "live-class";
  roomTitle: string;
  summaryLabel: string;
  rewardKind: "study-spark";
  rewardLabel: string;
  ruleLabel?: string;
  bonusLabel?: string;
  progress: number;
  target: number;
  contributorCount: number;
  completedAt: number;
  createdAt: number;
}

export interface PublicWorldTermRecord {
  id: string;
  schoolYear: string;
  termId: string;
  totalSparks: number;
  level: number;
  nextLevelAt: number;
  sparksToNextLevel: number;
  label: string;
  activeRuleLabels: string[];
  curriculumLoops?: PublicWorldCurriculumLoopSummary;
  curriculumLoopHistory?: PublicWorldCurriculumLoopEvent[];
  cohortTerms?: PublicWorldCohortTermRecord[];
  gradeProgress: Partial<Record<Grade, PublicWorldTermGradeProgress>>;
  updatedAt: number;
}

export interface PublicWorldCohortTermRecord {
  id: string;
  schoolYear: string;
  termId: string;
  grade: Grade;
  totalSparks: number;
  level: number;
  label: string;
  activeRuleLabels: string[];
  curriculumLoops: {
    inReview: number;
    promoted: number;
  };
  curriculumLoopHistory: PublicWorldCurriculumLoopEvent[];
  roomRule?: PublicWorldTermRoomRule;
  updatedAt: number;
}

export interface PublicWorldTermGradeProgress {
  totalSparks: number;
  level: number;
  nextLevelAt: number;
  sparksToNextLevel: number;
  label: string;
  activeRuleLabels: string[];
  roomRule?: PublicWorldTermRoomRule;
}

export interface PublicWorldTermRoomRule {
  kind: "term-momentum" | "term-rally";
  label: string;
  target: number;
}

export interface PublicWorldTeacherAgendaRecord {
  id: string;
  schoolYear: string;
  termId: string;
  grade: Grade;
  facultyId: string;
  displayName: string;
  agendaKind: "curriculum-replenishment";
  mode: "manual-curation" | "generate";
  executionStatus: "ready" | "queued" | "watching";
  executionReason: "exhausted-pool" | "repetition-pressure" | "term-rule-pressure" | "low-pool";
  nextAction: "generate-draft" | "manual-curation" | "monitor-coverage";
  priorityScore: number;
  termRuleLabel?: string;
  termRuleTarget?: number;
  draftId?: string;
  draftStatus?: "review-draft-created" | "review-approved" | "questions-promoted";
  draftQuestionCount?: number;
  draftUpdatedAt?: number;
  draftApprovedAt?: number;
  draftPromotedAt?: number;
  promotedQuestionCount?: number;
  targetDifficulty: Difficulty;
  targetNewQuestions: number;
  lowPoolSessions: number;
  exhaustedSessions: number;
  repetitionPressure: number;
  focusSubjects: string[];
  weakSubjects: string[];
  recentConcepts: string[];
  sourcePacketIds: string[];
  corpusId: string | null;
  generatedAt: number;
  updatedAt: number;
}

export interface RecentlyActiveStudent {
  sessionId: string;
  name: string;
  playbookId: string;
  grade: string;
  stats: CharacterStats;
  classGrades: Record<string, string>;
  yearbookCount: number;
  lastActive: number;
  portraitUrl?: string;
}

export interface ClassPhotoCandidate {
  sessionId: string;
  name: string;
  imageUrl: string;
  grade: string;
}

export interface DailyMemories {
  date: string;
  charactersCreated: string[];
  classesPassed: DailyMemoryEntry[];
  gradesAdvanced: DailyMemoryEntry[];
  graduations: string[];
  totalStudents: number;
  totalQuestionsAnswered: number;
}

const SYNTHETIC_CHARACTER_NAME_RE = /\b(Smoke|Pacing)\s+m[a-z0-9]{6,}\b/i;

function isSyntheticCharacterName(name: string | null | undefined): boolean {
  return !!name && SYNTHETIC_CHARACTER_NAME_RE.test(name);
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
  diploma?: GradeDiplomaCollectible;
  photo?: GraduationPhotoCollectible;
  superlatives: string[];
  yearbookImageUrl?: string;
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
  amountCents?: number;
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
const GRADUATION_ROOM_TARGETS: Record<Grade, number> = { "9": 1, "10": 2, "11": 3, "12": 4 };
const CORE_GRADUATION_FACULTY_ORDER = [RUBY_FACULTY.id, "sally-science", "professor-edward"] as const;
const RUBY_HOMEROOM_PRACTICE_BEFORE_CLASS: readonly number[] = [0, 0, 0] as const;
const RUBY_HOMEROOM_SOCIAL_CARDS_PER_DAY = 0;
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

/** Generate the essay question for a grade. Each grade has one essay the
 *  student must complete before graduating. The prompt is deterministic
 *  per character (seeded by name + grade) so reloads preserve the question. */
function gradeEssayPrompt(grade: Grade, ch: { name: string; playbookId?: string }): string {
  const prompts: Record<Grade, string[]> = {
    "9": [
      "What does 'intelligence' mean to you — and is it something a machine could ever genuinely have, or only something it could fake well?",
      "Think of a rule you follow that nobody actually checks. Why do you still follow it?",
      "If you could redesign school from scratch, what would you keep and what would you burn?",
    ],
    "10": [
      "Describe a time you changed your mind about something important. What made the difference — a person, an experience, a fact you couldn't ignore?",
      "Is honesty always the best policy? Give a real example where you think it isn't.",
      "Someone says 'AI should never be allowed to make decisions that affect human lives.' Agree or disagree — and give me the strongest counterargument to your own position.",
    ],
    "11": [
      "Pick a belief you hold that most people you know disagree with. Defend it. Then tell me the best argument against it.",
      "What would it mean for a machine to 'understand' something, rather than just process it? Where's the line?",
      "Is there a difference between something being 'real' and something being 'meaningful'? Give me an example.",
    ],
    "12": [
      "You're about to leave Ruby High. What did you actually learn here that you couldn't have gotten from a textbook or a YouTube video?",
      "If annihilism is the belief that meaning is made, not found — what have you made? Be specific. No abstracts.",
    ],
  };
  const pool = prompts[grade] ?? prompts["9"]!;
  // Deterministic per character: same name + grade = same question
  let seed = 0;
  const key = `${ch.name}:${grade}`;
  for (let i = 0; i < key.length; i++) seed = ((seed << 5) - seed + key.charCodeAt(i)) | 0;
  return pool[Math.abs(seed) % pool.length]!;
}

export interface CosyWorldWalletCardExport {
  walletAddress: string;
  cardIds: string[];
  packs: Array<{
    id: string;
    serial: number;
    productId: string;
    packCount: number;
    cardCount: number;
    status: "unopened" | "opened" | "void";
    ownerWalletAddress: string;
    assetAddress: string;
    packAssetAddress: string;
    mintSignature: string;
    metadataUri: string;
    source: "ruby_high";
    transactionSource?: RubyHighWalletTransaction["source"];
  }>;
  hallPassCards: Array<Pick<
    RubyHighHallPassCard,
    | "id"
    | "serial"
    | "characterId"
    | "canonicalCharacterId"
    | "characterName"
    | "setName"
    | "setCode"
    | "setNumber"
    | "profileId"
    | "cardName"
    | "subject"
    | "role"
    | "rarity"
    | "status"
    | "ownerWalletAddress"
    | "mintAddress"
    | "metadataUri"
    | "artSheet"
    | "artPosition"
    | "imageUrl"
    | "sourceImageUrl"
    | "nftProfileKind"
    | "playbookId"
    | "grade"
  > & {
    source: "ruby_high";
    transactionSource?: RubyHighWalletTransaction["source"];
  }>;
}

export interface CosyWorldWalletCardsExport {
  generatedAt: string;
  wallets: CosyWorldWalletCardExport[];
}

export interface CosyWorldCardOwnership {
  mintAddress: string;
  ownerWalletAddress: string;
}

export interface CosyWorldPackOwnership {
  assetAddress: string;
  ownerWalletAddress: string;
  metadataUri?: string;
}

const COSYWORLD_OWNERSHIP_LOOKUP_CONCURRENCY = 8;

function cosyWorldCardIdsForCard(card: Pick<RubyHighHallPassCard, "characterId" | "canonicalCharacterId">): string[] {
  return [
    card.characterId,
    card.canonicalCharacterId,
  ]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value, index, values) => !!value && values.indexOf(value) === index);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      out[index] = await mapper(items[index]!, index);
    }
  }));
  return out;
}

export class RubyHighService extends Service {
  static override readonly serviceType = "ruby-high";

  override readonly capabilityDescription =
    "Ruby High classroom state: tracks the active question, the student's answer, wallet, and which faculty member is on the floor.";

  private readonly sessions = new Map<string, QuizState>();
  private readonly store: StateStoreLike;
  private readonly backgroundWrites = new Set<Promise<void>>();
  private readonly metricEvents = new Map<string, StoredMetricEventRecord>();
  private readonly schoolEventRecords = new Map<string, StoredSchoolEventRecord>();
  private readonly liveRoomGoalStates = new Map<string, LiveRoomGoalState>();
  private readonly publicWorldRoomRecords = new Map<string, PublicWorldRoomRecord>();
  private readonly publicWorldRoomOutcomeRecords = new Map<string, PublicWorldRoomOutcomeRecord>();
  private readonly publicWorldTermRecords = new Map<string, PublicWorldTermRecord>();
  private readonly publicWorldTeacherAgendaRecords = new Map<string, PublicWorldTeacherAgendaRecord>();
  private readonly publicWorldEventLog = new Map<string, SchoolWorldEvent>();
  private readonly publicWorldSuppressedEvents = new Map<string, PublicWorldSuppressedEvent>();
  private readonly publicWorldModeratorNotes = new Map<string, PublicWorldModeratorNote>();
  private readonly pendingPhotoPosts = new Set<string>();
  private readonly deferredPhotoPosts = new Map<string, number>();
  private photoPostSchedulerTimer: ReturnType<typeof setInterval> | null = null;
  private photoPostSchedulerIntervalMs: number | null = null;
  private photoPostSchedulerRunning = false;
  private lastPhotoPostAttemptAt: number | null = null;
  private lastPhotoPostResult: DailyPhotoPostResult | null = null;
  private readonly disposeLogSink: () => void;
  private persistedPackRecords: StoredContentPackRecord[] | null = null;
  private teacherRecords: StoredTeacherRecord[] | null = null;
  private draftPackRecords: StoredDraftContentPackRecord[] | null = null;
  private packInstallationRecords: StoredPackInstallationRecord[] | null = null;
  private faculty: FacultyService | null = null;
  private worldStoreRefreshedAt = 0;
  private worldStoreRefresh: Promise<void> | null = null;
  private loaded = false;

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? getDefaultStateStore();
    this.disposeLogSink = setLogSink((record) => this.recordLogSinkMetricEvent(record));
  }

  static async start(runtime: IAgentRuntime): Promise<RubyHighService> {
    const svc = new RubyHighService(runtime);
    await svc.hydrate();
    svc.startPhotoPostScheduler();
    return svc;
  }

  async stop(): Promise<void> {
    this.stopPhotoPostScheduler();
    await this.flush();
    this.disposeLogSink();
    this.sessions.clear();
    this.metricEvents.clear();
    this.schoolEventRecords.clear();
    this.liveRoomGoalStates.clear();
    this.publicWorldRoomRecords.clear();
    this.publicWorldRoomOutcomeRecords.clear();
    this.publicWorldTermRecords.clear();
    this.publicWorldTeacherAgendaRecords.clear();
    this.publicWorldEventLog.clear();
    this.publicWorldSuppressedEvents.clear();
    this.publicWorldModeratorNotes.clear();
    this.persistedPackRecords = null;
    this.teacherRecords = null;
    this.draftPackRecords = null;
    this.packInstallationRecords = null;
  }

  /** Wait for any in-flight persistence writes to flush. Useful in tests. */
  async flush(): Promise<void> {
    await Promise.all([
      this.persistAll(),
      this.persistPhotoPostSchedulerState({ surfaceErrors: true }),
      this.persistPublicWorldRoomState({ surfaceErrors: true }),
      this.persistPublicWorldRoomOutcomeState({ surfaceErrors: true }),
      this.persistPublicWorldTermState({ surfaceErrors: true }),
      this.persistPublicWorldTeacherAgendaState({ surfaceErrors: true }),
      this.persistPublicWorldEventLog({ surfaceErrors: true }),
      this.persistPublicWorldSummaryState({ surfaceErrors: true }),
      this.persistPublicWorldModerationState({ surfaceErrors: true }),
      this.persistLiveRoomGoalState({ surfaceErrors: true }),
    ]);
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

  async deleteAccountData(target: StoredAccountDeletionTarget): Promise<StoredAccountDeletionResult> {
    if (!this.store.deleteAccountData) {
      throw new Error("Account deletion is not supported by this state store.");
    }
    const publicSessionId = target.publicSessionId ?? publicWorldSessionId(target.sessionId);
    const deletionTarget: StoredAccountDeletionTarget = {
      ...target,
      ...(publicSessionId ? { publicSessionId } : {}),
    };
    if (typeof this.store.flush === "function") await this.store.flush();

    const publicEventIds = new Set<string>();
    const state = this.sessions.get(deletionTarget.sessionId);
    if (state && Array.isArray(state.schoolEvents)) {
      for (const event of state.schoolEvents) {
        publicEventIds.add(publicSchoolWorldEvent(event).id);
      }
    }
    for (const record of this.schoolEventRecords.values()) {
      if (record.sessionId === deletionTarget.sessionId) {
        publicEventIds.add(publicSchoolWorldEvent(record.event).id);
      }
    }

    const result = await this.store.deleteAccountData(deletionTarget);

    this.sessions.delete(deletionTarget.sessionId);
    if (this.persistedPackRecords) {
      this.persistedPackRecords = this.persistedPackRecords.filter((record) =>
        record.ownerSessionId !== deletionTarget.sessionId && record.creatorUserId !== deletionTarget.userId);
    }
    if (this.teacherRecords) {
      this.teacherRecords = this.teacherRecords.filter((record) =>
        record.creatorSessionId !== deletionTarget.sessionId && record.creatorUserId !== deletionTarget.userId);
    }
    if (this.draftPackRecords) {
      this.draftPackRecords = this.draftPackRecords.filter((record) =>
        record.ownerSessionId !== deletionTarget.sessionId && record.ownerUserId !== deletionTarget.userId);
    }
    if (this.packInstallationRecords) {
      this.packInstallationRecords = this.packInstallationRecords.filter((record) => record.userId !== deletionTarget.userId);
    }
    for (const [id, record] of Array.from(this.schoolEventRecords.entries())) {
      if (record.sessionId === deletionTarget.sessionId) this.schoolEventRecords.delete(id);
    }
    for (const id of publicEventIds) this.publicWorldEventLog.delete(id);
    let liveRoomGoalsChanged = false;
    if (publicSessionId) {
      for (const goal of this.liveRoomGoalStates.values()) {
        if (goal.contributors.delete(publicSessionId)) liveRoomGoalsChanged = true;
      }
    }

    await Promise.all([
      this.persistPublicWorldEventLog({ surfaceErrors: true }),
      liveRoomGoalsChanged ? this.persistLiveRoomGoalState({ surfaceErrors: true }) : Promise.resolve(),
      this.persistPublicWorldSummaryState({ surfaceErrors: true }),
    ]);
    return result;
  }

  recordAppOpen(
    sessionId: string,
    input: { source?: string; userAgent?: string; referrer?: string; path?: string; ref?: string; visitorHash?: string | null } = {},
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
        ...(input.ref ? { ref: clippedMetricValue(input.ref, 120) } : {}),
        ...(input.userAgent ? { userAgent: clippedMetricValue(input.userAgent, 180) } : {}),
      },
    });
  }

  async recordAppOpenDurably(
    sessionId: string,
    input: { source?: string; userAgent?: string; referrer?: string; path?: string; ref?: string; visitorHash?: string | null } = {},
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
        ...(input.ref ? { ref: clippedMetricValue(input.ref, 120) } : {}),
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

  recordShareArtifactCreated(sessionId: string, input: { shareId?: string; grade?: string; kind?: string } = {}): void {
    this.recordMetricEvent("share_artifact_created", {
      sessionId,
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
        ...(input.kind ? { kind: clippedMetricValue(input.kind, 40) } : {}),
      },
    });
  }

  async recordShareArtifactCreatedDurably(sessionId: string, input: { shareId?: string; grade?: string; kind?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("share_artifact_created", {
      sessionId,
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.grade ? { grade: clippedMetricValue(input.grade, 12) } : {}),
        ...(input.kind ? { kind: clippedMetricValue(input.kind, 40) } : {}),
      },
    });
  }

  recordShareInitiated(sessionId: string, input: { visitorHash?: string | null; shareId?: string; destination?: string; kind?: string } = {}): void {
    this.recordMetricEvent("share_initiated", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.destination ? { destination: clippedMetricValue(input.destination, 40) } : {}),
        ...(input.kind ? { kind: clippedMetricValue(input.kind, 40) } : {}),
      },
    });
  }

  async recordShareInitiatedDurably(sessionId: string, input: { visitorHash?: string | null; shareId?: string; destination?: string; kind?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("share_initiated", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.shareId ? { shareId: clippedMetricValue(input.shareId, 120) } : {}),
        ...(input.destination ? { destination: clippedMetricValue(input.destination, 40) } : {}),
        ...(input.kind ? { kind: clippedMetricValue(input.kind, 40) } : {}),
      },
    });
  }

  recordShareLinkVisited(sessionId: string, input: { visitorHash?: string | null; ref?: string; landing?: string } = {}): void {
    this.recordMetricEvent("share_link_visited", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.ref ? { ref: clippedMetricValue(input.ref, 120) } : {}),
        ...(input.landing ? { landing: clippedMetricValue(input.landing, 180) } : {}),
      },
    });
  }

  async recordShareLinkVisitedDurably(sessionId: string, input: { visitorHash?: string | null; ref?: string; landing?: string } = {}): Promise<void> {
    await this.recordMetricEventDurably("share_link_visited", {
      sessionId,
      ...(input.visitorHash ? { visitorHash: input.visitorHash } : {}),
      source: "viewer",
      feature: "referral",
      status: "success",
      metadata: {
        ...(input.ref ? { ref: clippedMetricValue(input.ref, 120) } : {}),
        ...(input.landing ? { landing: clippedMetricValue(input.landing, 180) } : {}),
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
        const yearbook = characterYearbookEntries(state.character);
        const yearbookCount = yearbook.length;
        completedGrades += yearbookCount;
        if (yearbookCount >= GRADES.length) graduatedCharacters += 1;
        incrementRubyHighDay(byDate, characterCreatedAt, "charactersCreated");
        for (const entry of yearbook) {
          incrementRubyHighDay(byDate, Number(entry.completedAt), "gradesCompleted");
        }
      }
      for (const pooled of state.studentPool ?? []) {
        incrementRubyHighDay(byDate, Number(pooled.createdAt), "charactersCreated");
        for (const entry of characterYearbookEntries(pooled)) {
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
      const stats = normalizeAnswerStats(state.answerStats ?? answerStatsFromHistory(state.history));
      answerEvents += stats.totalAnswers;
      repeatedAnswers += stats.repeatedAnswers;
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
        characterD7: eventRetention.characterD7,
        visitorD7: eventRetention.visitorD7,
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
      world: this.worldHealthSnapshot(now),
      photoPosts: this.photoPostSchedulerSnapshot(),
      curriculum: this.curriculumCoverageSnapshot(),
      daily: days,
    };
  }

  worldHealthSnapshot(now: number = Date.now()): RubyHighWorldHealthSnapshot {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const presence = this.publicSchoolWorldEntries(now, weekMs).map((entry) => this.publicWorldPresenceFromEntry(entry));
    const rooms = buildPublicWorldRooms(presence, 5, 24, this.liveRoomGoalContributionsForWorld(now));
    this.clampPublicWorldRoomGoalTimes(rooms.activeRooms, now);
    this.syncPublicWorldRoomRecords(rooms.activeRooms, now);
    const events = this.getSchoolWorldEvents(SCHOOL_WORLD_RECENT_EVENT_LIMIT, now, rooms.publicSessionIds);
    const teacherAgendaExecution = this.publicWorldTeacherAgendaExecutionSnapshot(now);
    const summary = this.publicWorldSummarySnapshot(now);
    this.syncPublicWorldTermRecord(summary, now);
    const recentTerms = this.publicWorldTermRecordList(now).slice(0, 5);
    const cohortTerms = this.publicWorldCohortTermRecordList(now);
    const recentCohortTerms = cohortTerms.slice(0, 8);
    return {
      lastRefreshAt: this.worldStoreRefreshedAt > 0 ? this.worldStoreRefreshedAt : null,
      refreshAgeMs: this.worldStoreRefreshedAt > 0 ? Math.max(0, now - this.worldStoreRefreshedAt) : null,
      refreshIntervalMs: SCHOOL_WORLD_STORE_REFRESH_MS,
      activeStudents: rooms.activeStudents,
      activeRooms: rooms.activeRooms.length,
      recentEvents: events.length,
      newestEventAt: events[0]?.at ?? null,
      durableEventCacheSize: this.schoolEventRecords.size,
      durableEventCacheLimit: SCHOOL_WORLD_EVENT_CACHE_LIMIT,
      publicEventLogSize: this.publicWorldEventLog.size,
      publicEventLogLimit: SCHOOL_WORLD_EVENT_CACHE_LIMIT,
      durableRoomRecords: this.publicWorldRoomRecords.size,
      durableRoomRecordLimit: PUBLIC_WORLD_ROOM_RECORD_LIMIT,
      durableRoomOutcomes: this.publicWorldRoomOutcomeRecords.size,
      durableRoomOutcomeLimit: PUBLIC_WORLD_ROOM_OUTCOME_LIMIT,
      durableTermRecords: this.publicWorldTermRecords.size,
      durableTermRecordLimit: PUBLIC_WORLD_TERM_RECORD_LIMIT,
      durableCohortTerms: cohortTerms.length,
      durableTeacherAgendas: this.publicWorldTeacherAgendaRecords.size,
      durableTeacherAgendaLimit: PUBLIC_WORLD_TEACHER_AGENDA_LIMIT,
      teacherAgendaExecution,
      recentTeacherAgendas: this.publicWorldTeacherAgendaRecordList(now).slice(0, 5),
      recentTerms,
      recentCohortTerms,
      liveRoomGoals: this.liveRoomGoalStates.size,
      suppressedEvents: this.publicWorldSuppressedEvents.size,
      recentRoomOutcomes: this.publicWorldRoomOutcomeRecordList(now).slice(0, 5),
      summary,
    };
  }

  publicWorldTeacherAgendas(now: number = Date.now()): PublicWorldTeacherAgendaRecord[] {
    return this.publicWorldTeacherAgendaRecordList(now);
  }

  recordPublicWorldTeacherAgendaDraftOutcome(args: {
    grade: Grade;
    facultyId: string;
    draftId: string;
    draftStatus: NonNullable<PublicWorldTeacherAgendaRecord["draftStatus"]>;
    draftQuestionCount: number;
    approvedAt?: number;
    promotedAt?: number;
    promotedQuestionCount?: number;
    now?: number;
  }): boolean {
    const now = publicWorldStoredInteger(args.now, Date.now()) || Date.now();
    const facultyId = publicWorldRoomId(args.facultyId);
    const draftId = publicWorldStoredText(args.draftId, 120);
    if (!facultyId || !draftId) return false;
    const schoolYear = schoolYearForTimestamp(now);
    const id = publicWorldTeacherAgendaId(schoolYear, args.grade, facultyId);
    const prior = this.publicWorldTeacherAgendaRecords.get(id);
    if (!prior) return false;
    const next: PublicWorldTeacherAgendaRecord = {
      ...prior,
      draftId,
      draftStatus: args.draftStatus,
      draftQuestionCount: Math.min(999, publicWorldStoredInteger(args.draftQuestionCount, 0)),
      draftUpdatedAt: now,
      updatedAt: now,
      ...(args.approvedAt ? { draftApprovedAt: publicWorldStoredInteger(args.approvedAt, now) } : {}),
      ...(args.promotedAt ? { draftPromotedAt: publicWorldStoredInteger(args.promotedAt, now) } : {}),
      ...(args.promotedQuestionCount !== undefined ? { promotedQuestionCount: Math.min(999, publicWorldStoredInteger(args.promotedQuestionCount, 0)) } : {}),
    };
    this.publicWorldTeacherAgendaRecords.set(id, next);
    void this.persistPublicWorldTeacherAgendaState({}, now);
    return true;
  }

  photoPostSchedulerSnapshot(): RubyHighPhotoPostSchedulerSnapshot {
    return buildPhotoPostSchedulerSnapshot({
      schedulerActive: this.photoPostSchedulerTimer !== null,
      schedulerRunning: this.photoPostSchedulerRunning,
      schedulerIntervalMs: this.photoPostSchedulerIntervalMs,
      pendingPhotos: this.pendingPhotoPoolSize(),
      inFlightPosts: this.pendingPhotoPosts.size,
      deferredPhotoPosts: this.deferredPhotoPosts,
      lastAttemptAt: this.lastPhotoPostAttemptAt,
      lastResult: this.lastPhotoPostResult,
    });
  }

  startPhotoPostScheduler(intervalMs: number = PHOTO_POST_SCHEDULER_INTERVAL_MS): void {
    const normalizedIntervalMs = Math.max(1_000, Math.floor(Number(intervalMs)));
    if (!Number.isFinite(normalizedIntervalMs) || this.photoPostSchedulerTimer) return;
    this.photoPostSchedulerIntervalMs = normalizedIntervalMs;
    this.photoPostSchedulerTimer = setInterval(() => {
      void this.runPhotoPostSchedulerTick();
    }, normalizedIntervalMs);
    this.photoPostSchedulerTimer.unref?.();
  }

  stopPhotoPostScheduler(): void {
    if (this.photoPostSchedulerTimer) clearInterval(this.photoPostSchedulerTimer);
    this.photoPostSchedulerTimer = null;
    this.photoPostSchedulerIntervalMs = null;
  }

  async runPhotoPostSchedulerTick(): Promise<DailyPhotoPostResult | null> {
    if (this.photoPostSchedulerRunning) return null;
    this.photoPostSchedulerRunning = true;
    try {
      return await this.maybePostDailyPhoto();
    } finally {
      this.photoPostSchedulerRunning = false;
    }
  }

  private hydratePhotoPostSchedulerState(record: StoredServiceStateRecord | null): void {
    const hydrated = hydratePhotoPostSchedulerState(record);
    this.deferredPhotoPosts.clear();
    for (const [photoId, retryAt] of hydrated.deferredPhotoPosts) this.deferredPhotoPosts.set(photoId, retryAt);
    this.lastPhotoPostAttemptAt = hydrated.lastAttemptAt;
    this.lastPhotoPostResult = hydrated.lastResult;
  }

  private photoPostSchedulerStateRecord(): StoredServiceStateRecord {
    return buildPhotoPostSchedulerStateRecord({
      deferredPhotoPosts: this.deferredPhotoPosts,
      lastAttemptAt: this.lastPhotoPostAttemptAt,
      lastResult: this.lastPhotoPostResult,
    });
  }

  private persistPhotoPostSchedulerState(options: { surfaceErrors?: boolean } = {}): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.photoPostSchedulerStateRecord();
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("photo-post-scheduler.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private hydratePublicWorldModerationState(record: StoredServiceStateRecord | null): void {
    this.publicWorldSuppressedEvents.clear();
    this.publicWorldModeratorNotes.clear();
    const data = record?.data;
    const entries = data && data.version === 1 && Array.isArray(data.suppressedEvents)
      ? data.suppressedEvents
      : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const source = entry as Record<string, unknown>;
      const eventId = normalizePublicWorldEventId(source.eventId);
      if (!eventId) continue;
      this.publicWorldSuppressedEvents.set(eventId, {
        eventId,
        reason: normalizePublicWorldReportReason(source.reason),
        suppressedAt: Math.max(0, Math.floor(Number(source.suppressedAt) || 0)),
      });
    }
    const notes = data && data.version === 1 && Array.isArray(data.moderatorNotes)
      ? data.moderatorNotes
      : [];
    for (const entry of notes) {
      if (!entry || typeof entry !== "object") continue;
      const source = entry as Record<string, unknown>;
      const eventId = normalizePublicWorldEventId(source.eventId);
      if (!eventId) continue;
      const note = normalizePublicWorldModeratorNote(source.note);
      if (!note) continue;
      this.publicWorldModeratorNotes.set(eventId, {
        eventId,
        note,
        updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0)),
      });
    }
  }

  private publicWorldModerationStateRecord(now = Date.now()): StoredServiceStateRecord {
    return {
      id: PUBLIC_WORLD_MODERATION_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        suppressedEvents: Array.from(this.publicWorldSuppressedEvents.values())
          .sort((a, b) => b.suppressedAt - a.suppressedAt || a.eventId.localeCompare(b.eventId)),
        moderatorNotes: this.publicWorldModeratorNoteList(),
      },
    };
  }

  private persistPublicWorldModerationState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldModerationStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-moderation.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private hydratePublicWorldRoomState(record: StoredServiceStateRecord | null): void {
    this.publicWorldRoomRecords.clear();
    const data = record?.data;
    const rooms = data && data.version === 1 && Array.isArray(data.rooms) ? data.rooms : [];
    for (const raw of rooms) {
      const room = normalizePublicWorldRoomRecord(raw);
      if (!room) continue;
      this.publicWorldRoomRecords.set(room.key, room);
    }
    this.prunePublicWorldRoomRecords(record?.updatedAt ?? Date.now());
  }

  private publicWorldRoomStateRecord(now = Date.now()): StoredServiceStateRecord {
    this.prunePublicWorldRoomRecords(now);
    return {
      id: PUBLIC_WORLD_ROOMS_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        rooms: this.publicWorldRoomRecordList(now),
      },
    };
  }

  private persistPublicWorldRoomState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldRoomStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-rooms.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private syncPublicWorldRoomRecords(rooms: readonly PublicWorldRoom[], now = Date.now()): void {
    let changed = this.prunePublicWorldRoomRecords(now);
    const schoolYear = schoolYearForTimestamp(now);
    const termId = schoolYear;
    for (const room of rooms) {
      const grade = ((GRADES as readonly string[]).includes(room.grade) ? room.grade : "9") as Grade;
      const facultyId = publicWorldRoomId(room.facultyId);
      if (!facultyId || room.activeStudents <= 0) continue;
      const newestStudentActiveAt = room.students.reduce((max, student) => Math.max(max, publicWorldStoredInteger(student.lastActive, 0)), 0);
      const updatedAt = Math.max(publicWorldStoredInteger(room.goal.updatedAt, 0), newestStudentActiveAt);
      if (updatedAt <= 0 || updatedAt > now) continue;
      const key = publicWorldRoomRecordKey(schoolYear, grade, facultyId);
      const record: PublicWorldRoomRecord = {
        key,
        schoolYear,
        termId,
        grade,
        facultyId,
        displayName: publicWorldRoomDisplayName(room.displayName, facultyId),
        activeStudents: publicWorldStoredInteger(room.activeStudents, 0),
        goal: {
          kind: "live-class",
          label: String(room.goal.label ?? "").slice(0, 120),
          progress: publicWorldStoredInteger(room.goal.progress, 0),
          target: Math.max(1, publicWorldStoredInteger(room.goal.target, 3)),
          complete: !!room.goal.complete,
          updatedAt: publicWorldStoredInteger(room.goal.updatedAt, 0),
          ...(room.goal.ruleLabel ? { ruleLabel: publicWorldStoredText(room.goal.ruleLabel, 80) } : {}),
        },
        updatedAt,
      };
      const prior = this.publicWorldRoomRecords.get(key);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(record)) {
        this.publicWorldRoomRecords.set(key, record);
        changed = true;
      }
    }
    if (this.prunePublicWorldRoomRecords(now)) changed = true;
    if (changed) void this.persistPublicWorldRoomState({}, now);
  }

  private prunePublicWorldRoomRecords(now = Date.now()): boolean {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const retained = this.publicWorldRoomRecordList(now)
      .filter((room) => room.updatedAt <= now && now - room.updatedAt <= weekMs)
      .slice(0, PUBLIC_WORLD_ROOM_RECORD_LIMIT);
    if (retained.length === this.publicWorldRoomRecords.size && retained.every((room) => this.publicWorldRoomRecords.get(room.key) === room)) {
      return false;
    }
    this.publicWorldRoomRecords.clear();
    for (const room of retained) this.publicWorldRoomRecords.set(room.key, room);
    return true;
  }

  private publicWorldRoomRecordList(now = Date.now()): PublicWorldRoomRecord[] {
    return Array.from(this.publicWorldRoomRecords.values())
      .filter((room) => Number.isFinite(room.updatedAt) && room.updatedAt >= 0 && room.updatedAt <= now)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  }

  private hydratePublicWorldRoomOutcomeState(record: StoredServiceStateRecord | null): void {
    this.publicWorldRoomOutcomeRecords.clear();
    const data = record?.data;
    const outcomes = data && data.version === 1 && Array.isArray(data.outcomes) ? data.outcomes : [];
    for (const raw of outcomes) {
      const outcome = normalizePublicWorldRoomOutcomeRecord(raw);
      if (!outcome) continue;
      this.publicWorldRoomOutcomeRecords.set(outcome.id, outcome);
    }
    this.prunePublicWorldRoomOutcomeRecords(record?.updatedAt ?? Date.now());
  }

  private publicWorldRoomOutcomeStateRecord(now = Date.now()): StoredServiceStateRecord {
    this.prunePublicWorldRoomOutcomeRecords(now);
    return {
      id: PUBLIC_WORLD_ROOM_OUTCOMES_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        outcomes: this.publicWorldRoomOutcomeRecordList(now),
      },
    };
  }

  private persistPublicWorldRoomOutcomeState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldRoomOutcomeStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-room-outcomes.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private recordPublicWorldRoomOutcome(goal: LiveRoomGoalState, progress: number, target: number, now = Date.now()): void {
    if (progress < target) return;
    const completedAt = publicWorldStoredInteger(goal.updatedAt, now);
    if (completedAt <= 0 || completedAt > now) return;
    const id = publicWorldRoomOutcomeId(goal.day, goal.grade, goal.facultyId);
    if (this.publicWorldRoomOutcomeRecords.has(id)) return;
    const schoolYear = schoolYearForTimestamp(completedAt);
    const displayName = publicWorldRoomDisplayName(goal.displayName, goal.facultyId);
    const bonusLabel = liveRoomGoalBonusLabel(goal, progress, target, completedAt);
    const outcome: PublicWorldRoomOutcomeRecord = {
      id,
      schoolYear,
      termId: schoolYear,
      day: goal.day,
      grade: goal.grade,
      facultyId: goal.facultyId,
      displayName,
      goalKind: "live-class",
      roomTitle: publicWorldRoomOutcomeRoomTitle(displayName),
      summaryLabel: publicWorldRoomOutcomeSummaryLabel(displayName, progress, target, goal.contributors.size),
      rewardKind: "study-spark",
      rewardLabel: publicWorldRoomOutcomeRewardLabel(displayName, goal.ruleLabel),
      ...(goal.ruleLabel ? { ruleLabel: goal.ruleLabel } : {}),
      ...(bonusLabel ? { bonusLabel } : {}),
      progress,
      target,
      contributorCount: goal.contributors.size,
      completedAt,
      createdAt: now,
    };
    this.publicWorldRoomOutcomeRecords.set(id, outcome);
    if (this.prunePublicWorldRoomOutcomeRecords(now)) {
      this.publicWorldRoomOutcomeRecords.set(id, outcome);
    }
    void this.persistPublicWorldRoomOutcomeState({}, now);
  }

  private prunePublicWorldRoomOutcomeRecords(now = Date.now()): boolean {
    const schoolYear = schoolYearForTimestamp(now);
    const retained = this.publicWorldRoomOutcomeRecordList(now)
      .filter((outcome) => outcome.schoolYear === schoolYear)
      .slice(0, PUBLIC_WORLD_ROOM_OUTCOME_LIMIT);
    if (retained.length === this.publicWorldRoomOutcomeRecords.size && retained.every((outcome) => this.publicWorldRoomOutcomeRecords.get(outcome.id) === outcome)) {
      return false;
    }
    this.publicWorldRoomOutcomeRecords.clear();
    for (const outcome of retained) this.publicWorldRoomOutcomeRecords.set(outcome.id, outcome);
    return true;
  }

  private publicWorldRoomOutcomeRecordList(now = Date.now()): PublicWorldRoomOutcomeRecord[] {
    return Array.from(this.publicWorldRoomOutcomeRecords.values())
      .filter((outcome) => Number.isFinite(outcome.completedAt) && outcome.completedAt >= 0 && outcome.completedAt <= now)
      .sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id));
  }

  private hydratePublicWorldTermState(record: StoredServiceStateRecord | null): void {
    this.publicWorldTermRecords.clear();
    const data = record?.data;
    const terms = data && data.version === 1 && Array.isArray(data.terms) ? data.terms : [];
    for (const raw of terms) {
      const term = normalizePublicWorldTermRecord(raw);
      if (!term) continue;
      this.publicWorldTermRecords.set(term.id, term);
    }
    this.prunePublicWorldTermRecords(record?.updatedAt ?? Date.now());
  }

  private publicWorldTermStateRecord(now = Date.now()): StoredServiceStateRecord {
    this.prunePublicWorldTermRecords(now);
    return {
      id: PUBLIC_WORLD_TERMS_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        terms: this.publicWorldTermRecordList(now),
      },
    };
  }

  private persistPublicWorldTermState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldTermStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-terms.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private syncPublicWorldTermRecord(summary: PublicWorldSummarySnapshot, now = Date.now()): PublicWorldTermRecord {
    const term = publicWorldTermRecordFromSummary(summary, now);
    const prior = this.publicWorldTermRecords.get(term.id);
    const changed = !prior || publicWorldTermRecordContentKey(prior) !== publicWorldTermRecordContentKey(term);
    if (changed) {
      this.publicWorldTermRecords.set(term.id, term);
      if (this.prunePublicWorldTermRecords(now)) this.publicWorldTermRecords.set(term.id, term);
      void this.persistPublicWorldTermState({}, now);
    }
    return term;
  }

  private currentPublicWorldTermRecord(now = Date.now()): PublicWorldTermRecord {
    const summary = this.publicWorldSummarySnapshot(now);
    return this.syncPublicWorldTermRecord(summary, now);
  }

  private prunePublicWorldTermRecords(now = Date.now()): boolean {
    const retained = this.publicWorldTermRecordList(now)
      .slice(0, PUBLIC_WORLD_TERM_RECORD_LIMIT);
    if (retained.length === this.publicWorldTermRecords.size && retained.every((term) => this.publicWorldTermRecords.get(term.id) === term)) {
      return false;
    }
    this.publicWorldTermRecords.clear();
    for (const term of retained) this.publicWorldTermRecords.set(term.id, term);
    return true;
  }

  private publicWorldTermRecordList(now = Date.now()): PublicWorldTermRecord[] {
    return Array.from(this.publicWorldTermRecords.values())
      .filter((term) => Number.isFinite(term.updatedAt) && term.updatedAt >= 0 && term.updatedAt <= now)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  private publicWorldCohortTermRecordList(now = Date.now()): PublicWorldCohortTermRecord[] {
    return this.publicWorldTermRecordList(now)
      .flatMap((term) => term.cohortTerms ?? [])
      .filter((cohort) => Number.isFinite(cohort.updatedAt) && cohort.updatedAt >= 0 && cohort.updatedAt <= now)
      .sort((a, b) => b.updatedAt - a.updatedAt || Number(a.grade) - Number(b.grade) || a.id.localeCompare(b.id));
  }

  private hydratePublicWorldTeacherAgendaState(record: StoredServiceStateRecord | null): void {
    this.publicWorldTeacherAgendaRecords.clear();
    const data = record?.data;
    const agendas = data && data.version === 1 && Array.isArray(data.agendas) ? data.agendas : [];
    for (const raw of agendas) {
      const agenda = normalizePublicWorldTeacherAgendaRecord(raw);
      if (!agenda) continue;
      this.publicWorldTeacherAgendaRecords.set(agenda.id, agenda);
    }
    this.prunePublicWorldTeacherAgendaRecords(record?.updatedAt ?? Date.now());
  }

  private publicWorldTeacherAgendaStateRecord(now = Date.now()): StoredServiceStateRecord {
    this.prunePublicWorldTeacherAgendaRecords(now);
    return {
      id: PUBLIC_WORLD_TEACHER_AGENDAS_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        agendas: this.publicWorldTeacherAgendaRecordList(now),
      },
    };
  }

  private persistPublicWorldTeacherAgendaState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldTeacherAgendaStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-teacher-agendas.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private syncPublicWorldTeacherAgendaRecords(rows: readonly RubyHighCurriculumCoverageRow[], now = Date.now()): void {
    let changed = this.prunePublicWorldTeacherAgendaRecords(now);
    const schoolYear = schoolYearForTimestamp(now);
    const term = this.currentPublicWorldTermRecord(now);
    const retainedIds = new Set<string>();
    for (const row of rows) {
      const plan = row.replenishment;
      if (!plan) continue;
      const facultyId = publicWorldRoomId(row.facultyId);
      if (!facultyId) continue;
      const id = publicWorldTeacherAgendaId(schoolYear, row.grade, facultyId);
      retainedIds.add(id);
      const prior = this.publicWorldTeacherAgendaRecords.get(id);
      const termRule = term.gradeProgress[row.grade]?.roomRule;
      const execution = publicWorldTeacherAgendaExecution(plan.mode, row.exhaustedSessions, row.lowPoolSessions, row.repetitionPressure, termRule);
      const candidate: PublicWorldTeacherAgendaRecord = {
        id,
        schoolYear,
        termId: schoolYear,
        grade: row.grade,
        facultyId,
        displayName: publicWorldRoomDisplayName(row.displayName, facultyId),
        agendaKind: "curriculum-replenishment",
        mode: plan.mode,
        executionStatus: execution.executionStatus,
        executionReason: execution.executionReason,
        nextAction: execution.nextAction,
        priorityScore: execution.priorityScore,
        ...(execution.termRuleLabel ? { termRuleLabel: execution.termRuleLabel } : {}),
        ...(execution.termRuleTarget ? { termRuleTarget: execution.termRuleTarget } : {}),
        ...publicWorldTeacherAgendaDraftFields(prior),
        targetDifficulty: plan.targetDifficulty,
        targetNewQuestions: publicWorldStoredInteger(plan.targetNewQuestions, 0),
        lowPoolSessions: publicWorldStoredInteger(row.lowPoolSessions, 0),
        exhaustedSessions: publicWorldStoredInteger(row.exhaustedSessions, 0),
        repetitionPressure: publicWorldStoredRatio(row.repetitionPressure),
        focusSubjects: publicWorldStoredTextList(plan.focusSubjects, 8, 80),
        weakSubjects: publicWorldStoredTextList(plan.weakSubjects, 8, 80),
        recentConcepts: publicWorldStoredTextList(plan.recentConcepts, 8, 120),
        sourcePacketIds: publicWorldStoredTextList(plan.sourcePackets.map((packet) => packet.id), 8, 80),
        corpusId: plan.corpusId ? publicWorldStoredText(plan.corpusId, 80) || null : null,
        generatedAt: prior?.generatedAt ?? now,
        updatedAt: now,
      };
      if (!prior || publicWorldTeacherAgendaContentKey(prior) !== publicWorldTeacherAgendaContentKey(candidate)) {
        this.publicWorldTeacherAgendaRecords.set(id, candidate);
        changed = true;
      }
    }
    for (const id of Array.from(this.publicWorldTeacherAgendaRecords.keys())) {
      if (!retainedIds.has(id)) {
        this.publicWorldTeacherAgendaRecords.delete(id);
        changed = true;
      }
    }
    if (this.prunePublicWorldTeacherAgendaRecords(now)) changed = true;
    if (changed) void this.persistPublicWorldTeacherAgendaState({}, now);
  }

  private prunePublicWorldTeacherAgendaRecords(now = Date.now()): boolean {
    const schoolYear = schoolYearForTimestamp(now);
    const retained = this.publicWorldTeacherAgendaRecordList(now)
      .filter((agenda) => agenda.schoolYear === schoolYear)
      .slice(0, PUBLIC_WORLD_TEACHER_AGENDA_LIMIT);
    if (retained.length === this.publicWorldTeacherAgendaRecords.size && retained.every((agenda) => this.publicWorldTeacherAgendaRecords.get(agenda.id) === agenda)) {
      return false;
    }
    this.publicWorldTeacherAgendaRecords.clear();
    for (const agenda of retained) this.publicWorldTeacherAgendaRecords.set(agenda.id, agenda);
    return true;
  }

  private publicWorldTeacherAgendaRecordList(now = Date.now()): PublicWorldTeacherAgendaRecord[] {
    return Array.from(this.publicWorldTeacherAgendaRecords.values())
      .filter((agenda) => Number.isFinite(agenda.updatedAt) && agenda.updatedAt >= 0 && agenda.updatedAt <= now)
      .sort((a, b) =>
        b.updatedAt - a.updatedAt ||
        Number(a.grade) - Number(b.grade) ||
        a.facultyId.localeCompare(b.facultyId)
      );
  }

  private publicWorldTeacherAgendaExecutionSnapshot(now = Date.now()): RubyHighWorldHealthSnapshot["teacherAgendaExecution"] {
    const out = { ready: 0, queued: 0, watching: 0 };
    for (const agenda of this.publicWorldTeacherAgendaRecordList(now)) {
      if (agenda.executionStatus === "ready") out.ready += 1;
      else if (agenda.executionStatus === "queued") out.queued += 1;
      else out.watching += 1;
    }
    return out;
  }

  private hydratePublicWorldEventLog(record: StoredServiceStateRecord | null): void {
    this.publicWorldEventLog.clear();
    const data = record?.data;
    const events = data && data.version === 1 && Array.isArray(data.events) ? data.events : [];
    for (const raw of events) {
      const event = normalizePublicWorldEventPayload(raw);
      if (!event) continue;
      this.publicWorldEventLog.set(event.id, event);
    }
    this.prunePublicWorldEventLog(record?.updatedAt ?? Date.now());
  }

  private publicWorldEventLogStateRecord(now = Date.now()): StoredServiceStateRecord {
    this.prunePublicWorldEventLog(now);
    return {
      id: PUBLIC_WORLD_EVENTS_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        events: this.publicWorldEventLogList(now),
      },
    };
  }

  private persistPublicWorldEventLog(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldEventLogStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-events.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  publicWorldSummarySnapshot(now = Date.now()): PublicWorldSummarySnapshot {
    const events = this.publicWorldEventLogList(now)
      .filter((event) => !this.publicWorldSuppressedEvents.has(event.id));
    const byKind: Partial<Record<SchoolWorldEvent["kind"], number>> = {};
    const byGrade: Partial<Record<Grade, number>> = {};
    const studySparksByGrade: Partial<Record<Grade, number>> = {};
    let roomGoalTotal = 0;
    let roomGoalComplete = 0;
    let studySparkTotal = 0;
    for (const event of events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      if (event.grade) byGrade[event.grade] = (byGrade[event.grade] ?? 0) + 1;
      if (event.kind === "room.goal-progress") {
        roomGoalTotal += 1;
        if (event.complete) {
          roomGoalComplete += 1;
          if (event.rewardLabel) {
            studySparkTotal += 1;
            if (event.grade) studySparksByGrade[event.grade] = (studySparksByGrade[event.grade] ?? 0) + 1;
          }
        }
      }
    }
    return {
      generatedAt: now,
      schoolYear: schoolYearForTimestamp(now),
      eventCount: events.length,
      newestEventAt: events[0]?.at ?? null,
      byKind,
      byGrade,
      roomGoalEvents: {
        total: roomGoalTotal,
        complete: roomGoalComplete,
      },
      studySparks: {
        total: studySparkTotal,
        byGrade: studySparksByGrade,
      },
      termProgress: publicWorldTermProgress(studySparkTotal),
      termRules: publicWorldTermRulesForGrades(studySparksByGrade),
      curriculumLoops: publicWorldCurriculumLoopSummary(this.publicWorldTeacherAgendaRecordList(now)),
      curriculumLoopHistory: publicWorldCurriculumLoopHistory(this.publicWorldTeacherAgendaRecordList(now)),
    };
  }

  private publicWorldSummaryStateRecord(now = Date.now()): StoredServiceStateRecord {
    const summary = this.publicWorldSummarySnapshot(now);
    this.syncPublicWorldTermRecord(summary, now);
    return {
      id: PUBLIC_WORLD_SUMMARY_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        summary,
      },
    };
  }

  private persistPublicWorldSummaryState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.publicWorldSummaryStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("public-world-summary.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    return save;
  }

  private syncPublicWorldEventLog(events: Iterable<SchoolWorldEvent>, now = Date.now()): void {
    let changed = this.prunePublicWorldEventLog(now);
    for (const rawEvent of events) {
      const event = normalizePublicWorldEventPayload(rawEvent);
      if (!event) continue;
      const prior = this.publicWorldEventLog.get(event.id);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(event)) {
        this.publicWorldEventLog.set(event.id, event);
        changed = true;
      }
    }
    if (this.prunePublicWorldEventLog(now)) changed = true;
    if (changed) {
      void this.persistPublicWorldEventLog({}, now);
      void this.persistPublicWorldSummaryState({}, now);
    }
  }

  private prunePublicWorldEventLog(now = Date.now()): boolean {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const retained = this.publicWorldEventLogList(now)
      .filter((event) => event.at <= now && now - event.at <= weekMs)
      .slice(0, SCHOOL_WORLD_EVENT_CACHE_LIMIT);
    if (retained.length === this.publicWorldEventLog.size && retained.every((event) => this.publicWorldEventLog.get(event.id) === event)) {
      return false;
    }
    this.publicWorldEventLog.clear();
    for (const event of retained) this.publicWorldEventLog.set(event.id, event);
    return true;
  }

  private publicWorldEventLogList(now = Date.now()): SchoolWorldEvent[] {
    return Array.from(this.publicWorldEventLog.values())
      .filter((event) => Number.isFinite(event.at) && event.at >= 0 && event.at <= now)
      .sort((a, b) => this.schoolWorldEventKindRank(a.kind) - this.schoolWorldEventKindRank(b.kind) || b.at - a.at || b.id.localeCompare(a.id));
  }

  private hydrateLiveRoomGoalState(record: StoredServiceStateRecord | null): void {
    this.liveRoomGoalStates.clear();
    const data = record?.data;
    const goals = data && data.version === 1 && Array.isArray(data.goals) ? data.goals : [];
    for (const raw of goals) {
      if (!raw || typeof raw !== "object") continue;
      const source = raw as Record<string, unknown>;
      const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
        ? source.grade as Grade
        : null;
      const facultyId = publicWorldRoomId(typeof source.facultyId === "string" ? source.facultyId : "");
      const day = typeof source.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.day) ? source.day : "";
      if (!grade || !facultyId || !day) continue;
      const contributors = new Set<string>();
      const rawContributors = Array.isArray(source.contributors) ? source.contributors : [];
      for (const contributor of rawContributors) {
        const publicSessionId = publicWorldSessionId(typeof contributor === "string" ? contributor : "");
        if (publicSessionId) contributors.add(publicSessionId);
      }
      const updatedAt = Math.max(0, Math.floor(Number(source.updatedAt) || 0));
      if (contributors.size === 0 || updatedAt <= 0) continue;
      const displayName = publicWorldRoomDisplayName(typeof source.displayName === "string" ? source.displayName : facultyId, facultyId);
      const target = Math.max(1, Math.min(99, publicWorldStoredInteger(source.target, 3)));
      const ruleLabel = publicWorldStoredText(source.ruleLabel, 80);
      const startedAt = publicWorldStoredInteger(source.startedAt, updatedAt);
      this.liveRoomGoalStates.set(this.liveRoomGoalStateKey(grade, facultyId, day), {
        grade,
        facultyId,
        displayName,
        day,
        target,
        ...(ruleLabel ? { ruleLabel } : {}),
        contributors,
        startedAt,
        updatedAt,
      });
    }
  }

  private liveRoomGoalStateRecord(now = Date.now()): StoredServiceStateRecord {
    return {
      id: LIVE_ROOM_GOALS_STATE_ID,
      updatedAt: now,
      data: {
        version: 1,
        goals: Array.from(this.liveRoomGoalStates.values())
          .filter((goal) => goal.contributors.size > 0 && goal.updatedAt > 0)
          .sort((a, b) => b.updatedAt - a.updatedAt || this.liveRoomGoalStateKey(a.grade, a.facultyId, a.day).localeCompare(this.liveRoomGoalStateKey(b.grade, b.facultyId, b.day)))
          .map((goal) => ({
            grade: goal.grade,
            facultyId: goal.facultyId,
            displayName: goal.displayName,
            day: goal.day,
            target: goal.target,
            ...(goal.ruleLabel ? { ruleLabel: goal.ruleLabel } : {}),
            contributors: Array.from(goal.contributors).sort(),
            startedAt: goal.startedAt,
            updatedAt: goal.updatedAt,
          })),
      },
    };
  }

  private persistLiveRoomGoalState(options: { surfaceErrors?: boolean } = {}, now = Date.now()): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = this.liveRoomGoalStateRecord(now);
    const save = this.store.saveServiceState(record).catch((err) => {
      log.error("live-room-goals.persist-failed", err);
      if (options.surfaceErrors) throw err;
    });
    if (!options.surfaceErrors) this.trackBackgroundWrite(save);
    if (!options.surfaceErrors) void this.persistPublicWorldSummaryState({}, now);
    return save;
  }

  private recordPhotoPostAttempt(): void {
    this.lastPhotoPostAttemptAt = Date.now();
    void this.persistPhotoPostSchedulerState();
  }

  private recordPhotoPostResult(result: DailyPhotoPostResult): DailyPhotoPostResult {
    this.lastPhotoPostResult = result;
    void this.persistPhotoPostSchedulerState();
    return result;
  }

  curriculumCoverageSnapshot(): RubyHighCurriculumCoverageSnapshot {
    const snapshot = this.curriculumCoverageSnapshotForStates(this.sessions.values());
    this.syncPublicWorldTeacherAgendaRecords(snapshot.lowPools);
    return snapshot;
  }

  private curriculumCoverageSnapshotForStates(states: Iterable<QuizState>): RubyHighCurriculumCoverageSnapshot {
    const rows = new Map<string, MutableCurriculumCoverageRow>();
    let activeCharacterSessions = 0;
    for (const state of states) {
      if (!state.character || !state.currentGrade) continue;
      activeCharacterSessions += 1;
      const grade = state.currentGrade;
      for (const faculty of facultyForSession(state)) {
        if (!faculty.questions?.length && !faculty.sourceCards?.length) continue;
        const status = this.questionBankStatusForState(state, faculty.id);
        const key = `${grade}:${status.facultyId}`;
        let row = rows.get(key);
        if (!row) {
          row = {
            grade,
            facultyId: status.facultyId,
            displayName: status.displayName,
            sessions: 0,
            totalEligibleMin: status.total,
            totalEligibleMax: status.total,
            seenSum: 0,
            remainingSum: 0,
            lowPoolSessions: 0,
            exhaustedSessions: 0,
            repeatedAnswers: 0,
            repeatedAnswerSessions: 0,
            sourceCardIds: new Set<string>(),
            sourceSubjects: new Map<string, number>(),
            weakSubjects: new Map<string, number>(),
            recentConcepts: new Map<string, number>(),
            researchCorpus: builtInTeacherResearchCorpusForFaculty(status.facultyId),
          };
          rows.set(key, row);
        }
        row.sessions += 1;
        row.totalEligibleMin = Math.min(row.totalEligibleMin, status.total);
        row.totalEligibleMax = Math.max(row.totalEligibleMax, status.total);
        row.seenSum += status.asked;
        row.remainingSum += status.remaining;
        const lowThreshold = Math.max(3, Math.ceil(status.total * 0.1));
        if (status.remaining <= 0) row.exhaustedSessions += 1;
        if (status.remaining <= lowThreshold) row.lowPoolSessions += 1;
        const eligibleQuestions = this.eligibleCourseQuestions(state, status.facultyId, {
          allowedDifficulties: state.currentGrade && !this.isImportedReviewCourse(state, status.facultyId)
            ? difficultiesForGrade(state.currentGrade)
            : undefined,
        });
        const analytics = this.curriculumCoverageAnalyticsForState(
          state,
          eligibleQuestions,
          status.remainingBySubject,
        );
        row.repeatedAnswers += analytics.repeatedAnswers;
        if (analytics.repeatedAnswers > 0) row.repeatedAnswerSessions += 1;
        for (const [subject, count] of analytics.weakSubjects) {
          row.weakSubjects.set(subject, (row.weakSubjects.get(subject) ?? 0) + count);
        }
        for (const [concept, count] of analytics.recentConcepts) {
          row.recentConcepts.set(concept, (row.recentConcepts.get(concept) ?? 0) + count);
        }
        for (const card of this.curriculumSourceCardsForPlan(faculty, grade)) {
          row.sourceCardIds.add(card.id);
          row.sourceSubjects.set(card.subject, (row.sourceSubjects.get(card.subject) ?? 0) + 1);
        }
      }
    }
    return buildCurriculumCoverageSnapshot(activeCharacterSessions, rows.values());
  }

  private curriculumCoverageAnalyticsForState(
    state: QuizState,
    eligibleQuestions: readonly BankedQuestion[],
    remainingBySubject: Record<string, number>,
  ): {
    repeatedAnswers: number;
    weakSubjects: Map<string, number>;
    recentConcepts: Map<string, number>;
  } {
    const byId = new Map(eligibleQuestions.map((question) => [question.id, question]));
    const subjectTotals = new Map<string, number>();
    for (const question of eligibleQuestions) {
      subjectTotals.set(question.subject, (subjectTotals.get(question.subject) ?? 0) + 1);
    }
    const weakSubjects = new Map<string, number>();
    for (const [subject, total] of subjectTotals) {
      const remaining = Math.max(0, Math.floor(Number(remainingBySubject[subject] ?? 0)));
      const threshold = Math.max(1, Math.ceil(total * 0.2));
      if (remaining <= threshold) {
        weakSubjects.set(subject, Math.max(1, total - remaining));
      }
    }

    const answeredCounts = new Map<string, number>();
    const matchingHistory = state.history.filter((record) => byId.has(record.questionId));
    for (const record of matchingHistory) {
      answeredCounts.set(record.questionId, (answeredCounts.get(record.questionId) ?? 0) + 1);
    }
    let repeatedAnswers = 0;
    for (const count of answeredCounts.values()) {
      if (count > 1) repeatedAnswers += count - 1;
    }

    const recentIds = matchingHistory.length
      ? matchingHistory.slice(-12).map((record) => record.questionId)
      : state.askedQuestionIds.filter((id) => byId.has(id)).slice(-12);
    const recentConcepts = new Map<string, number>();
    for (const id of recentIds) {
      const question = byId.get(id);
      if (!question) continue;
      const concept = curriculumQuestionConceptLabel(question);
      recentConcepts.set(concept, (recentConcepts.get(concept) ?? 0) + 1);
    }
    return { repeatedAnswers, weakSubjects, recentConcepts };
  }

  private curriculumSourceCardsForPlan(faculty: PackFaculty, grade: Grade): PackSourceCard[] {
    const targetDifficulty = generationDifficultyForCurriculumGrade(grade);
    const unlocked = this.availableSourceCardsForGrade(faculty.sourceCards ?? [], grade);
    const preferred = unlocked.filter((card) => card.difficulty === targetDifficulty);
    return preferred.length ? preferred : unlocked;
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

  graduationPhotoScene(sessionId: string, input?: { grade?: Grade }): GraduationPhotoScene {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    const pending = ch?.pendingGraduation;
    if (!ch) {
      throw new Error("No active student.");
    }
    if (pending && (!input?.grade || input.grade === pending.grade)) {
      if (!state.currentGrade || pending.grade !== state.currentGrade) {
        throw new Error("No graduation ceremony is ready.");
      }
      const status = this.gradeCompletionStatus(state);
      if (!status || !status.ready || status.grade !== pending.grade) {
        throw new Error("Graduation requirements are not complete.");
      }
      return this.graduationPhotoSceneFor(state, ch, pending.grade, {
        characterName: ch.name,
        characterImageUrl: ch.portraitDataUrl || defaultPlayerPortraitUrl(ch.playbookId),
      });
    }

    const yearbook = characterYearbookEntries(ch);
    const entry = input?.grade
      ? yearbook.find((card) => card.grade === input.grade)
      : yearbook.slice().reverse().find((card) => !card.photo?.imageUrl) ?? yearbook[yearbook.length - 1];
    if (!entry) {
      throw new Error(input?.grade ? "That year is not sealed in the yearbook." : "No yearbook photo is available.");
    }
    return this.graduationPhotoSceneFor(state, ch, entry.grade, {
      characterName: entry.name || ch.name,
      characterImageUrl: entry.portraitDataUrl
        || ch.portraitDataUrl
        || defaultPlayerPortraitUrl(entry.playbookId || ch.playbookId),
      photo: entry.photo,
    });
  }

  private graduationPhotoSceneFor(
    state: QuizState,
    ch: PlayerCharacter,
    grade: Grade,
    input: {
      characterName: string;
      characterImageUrl: string;
      photo?: GraduationPhotoCollectible;
    },
  ): GraduationPhotoScene {
    const teacher = input.photo?.teacher ?? this.topGraduationTeacherFor(state, grade);
    const faculty = facultyByIdForSession(state, teacher.id);
    const teacherImageUrl = teacherFullPortraitUrl(teacher.id, faculty?.assetTeacherId, faculty?.profileImageUrl)
      || teacher.imageUrl
      || teacherPortraitUrl(teacher.id, faculty?.assetTeacherId, faculty?.profileImageUrl)
      || teacherFullPortraitUrl(RUBY_FACULTY.id)
      || "";
    const student = input.photo?.student ?? this.topSocialStudentFor(ch);
    return {
      grade,
      characterName: input.characterName,
      characterImageUrl: input.characterImageUrl,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        imageUrl: teacherImageUrl,
      },
      student: {
        id: student.id,
        name: student.name,
        imageUrl: studentFullPortraitUrl(student.id) || student.imageUrl || studentPortraitUrl(student.id),
      },
    };
  }

  setGraduationPhotoImage(sessionId: string, input: { grade: Grade; imageUrl: string; generatedAt?: number }): QuizState {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) throw new Error("No active student.");
    const imageUrl = normalizeStoredImageRef(input.imageUrl, "graduationPhotoImageUrl");
    if (!imageUrl) throw new Error("graduationPhotoImageUrl is required.");
    const generatedAt = typeof input.generatedAt === "number" && Number.isFinite(input.generatedAt)
      ? Math.floor(input.generatedAt)
      : Date.now();
    const pending = ch.pendingGraduation;
    if (pending?.grade === input.grade) {
      pending.photoImageUrl = imageUrl;
      pending.photoImageGeneratedAt = generatedAt;
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
      return state;
    }

    const entry = characterYearbookEntries(ch).find((card) => card.grade === input.grade);
    if (!entry) {
      throw new Error("That year is not sealed in the yearbook.");
    }
    entry.photo = {
      ...(entry.photo ?? this.graduationPhotoCollectibleFor(state, ch, input.grade, Number(entry.completedAt) || generatedAt)),
      imageUrl,
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  setPendingGraduationPhotoImage(sessionId: string, input: { grade: Grade; imageUrl: string; generatedAt?: number }): QuizState {
    return this.setGraduationPhotoImage(sessionId, input);
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
      amountCents?: number;
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
      ...(typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
        ? { amountCents: Math.floor(input.amountCents) }
        : {}),
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
      amountCents: typeof transaction.amountCents === "number" && Number.isFinite(transaction.amountCents) ? Math.floor(transaction.amountCents) : undefined,
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
    const requiredBurnCards = hallPassCardsRequiredForCost(hallPassCost);
    if (input.burns && input.burns.length > 0 && input.burns.length !== requiredBurnCards) {
      throw new Error(`Server AI needs ${requiredBurnCards} burned Card${requiredBurnCards === 1 ? "" : "s"}.`);
    }
    const spendInput = {
      idempotencyKey: `hosted-ai:access:${sessionId}:${now}`,
      source: "hosted-ai" as const,
      description: "Server AI",
      at: now,
      metadata: {
        durationMs,
      },
    };
    if (input.burns && input.burns.length > 0) {
      this.convertBurnedHallPassCardsToHallPasses(sessionId, {
        burns: input.burns,
        idempotencyKey: `${spendInput.idempotencyKey}:card-credit`,
        source: spendInput.source,
        description: "Server AI card burn credit",
        at: spendInput.at,
        metadata: spendInput.metadata,
      });
    }
    const spend = this.applyHallPassTransaction(sessionId, "hall-pass-spend", {
      amount: hallPassCost,
      ...spendInput,
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

  grantHallPassCards(sessionId: string, input: HallPassCardGrantInput): HallPassMutationResult {
    const state = this.getOrCreate(sessionId);
    const cardCount = normalizePositiveInteger(input.cardCount, "Card count");
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Card transaction idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-grant",
      at: typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now(),
      hallPasses: 0,
      ...(input.source ? { source: input.source } : {}),
      ...(input.description ? { description: input.description } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        cardCount,
        cardGrant: true,
      },
    };
    const cards = issueHallPassCardsForTransaction(state, transaction, cardCount, this.sessions);
    attachHallPassCardMetadata(transaction, cards);
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "hall-pass-card",
      feature: "hall-pass-card-grant",
      status: "success",
      hallPassesDelta: 0,
      metadata: { transactionId: transaction.id, cardCount },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, cards };
  }

  createGeneratedCastNftCard(sessionId: string, input: GeneratedCastNftCardInput): GeneratedNftCardResult {
    const profile = hallPassCardCatalogEntry(input.characterId);
    if (!profile) throw new Error("Unknown Ruby High cast profile.");
    const setNumber = hallPassCardSetNumber(profile);
    const profileId = hallPassCardProfileId(profile);
    const imageUrl = hallPassCardImagePath(profile);
    return this.grantGeneratedNftCard(sessionId, {
      kind: "cast",
      stableKey: `cast:${profile.characterId}`,
      requestId: input.requestId,
      at: input.at,
      ownerWalletAddress: input.ownerWalletAddress,
      title: `${profile.characterName} Cast Edition`,
      characterId: generatedNftCharacterId("cast", `${profile.characterId}:${profileId}`),
      canonicalCharacterId: profile.characterId,
      characterName: profile.characterName,
      setNumber: `GEN-${setNumber}`,
      profileId: `${profileId}-cast-v2`.slice(0, 96),
      cardName: `${profile.characterName}: Cast Edition`,
      subject: hallPassCardSubject(profile),
      role: profile.role,
      rarity: profile.rarity,
      blurb: `${profile.characterName} joins the Ruby High generated profile series as official cast art.`,
      color: "#d22a2a",
      imageUrl,
      sourceImageUrl: imageUrl,
    });
  }

  createGeneratedPlayerNftCard(sessionId: string, input: GeneratedNftCardInput = {}): GeneratedNftCardResult {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) throw new Error("Create a player character before generating a player NFT.");
    const fallbackImage = defaultPlayerPortraitUrl(ch.playbookId);
    const imageUrl = nftSafeImageRef(ch.portraitDataUrl, fallbackImage);
    const createdAt = Number.isFinite(Number(ch.createdAt)) ? Math.floor(Number(ch.createdAt)) : state.updatedAt;
    const imageHash = shortHash(ch.portraitDataUrl || imageUrl);
    return this.grantGeneratedNftCard(sessionId, {
      kind: "player",
      stableKey: `player:${createdAt}:${ch.name}:${ch.playbookId}:${imageHash}`,
      requestId: input.requestId,
      at: input.at,
      ownerWalletAddress: input.ownerWalletAddress,
      title: `${ch.name} Student ID`,
      characterId: generatedNftCharacterId("player", `${createdAt}:${ch.name}:${ch.playbookId}`),
      characterName: ch.name,
      setNumber: `GEN-P-${imageHash.slice(0, 6).toUpperCase()}`,
      profileId: `player-${imageHash}`.slice(0, 96),
      cardName: `${ch.name}: Student ID`,
      subject: "Student Life",
      role: "student",
      rarity: "rare",
      blurb: `${ch.name}'s Ruby High student profile, generated from their current character image.`,
      color: "#2b6cb0",
      imageUrl,
      sourceImageUrl: imageUrl,
      playbookId: ch.playbookId,
    });
  }

  createGeneratedYearbookNftCard(sessionId: string, input: GeneratedYearbookNftCardInput): GeneratedNftCardResult {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) throw new Error("Create a player character before generating a yearbook NFT.");
    const grade = input.grade;
    const entry = characterYearbookEntries(ch).find((candidate) => candidate.grade === grade);
    if (!entry) throw new Error(`No sealed ${GRADE_LABELS[grade]} yearbook entry for this student.`);
    const characterName = entry.name || ch.name;
    const playbookId = entry.playbookId || ch.playbookId;
    const fallbackImage = defaultPlayerPortraitUrl(playbookId);
    const preferredImage = entry.yearbookImageUrl || entry.photo?.imageUrl || entry.portraitDataUrl || ch.portraitDataUrl;
    const imageUrl = nftSafeImageRef(preferredImage, fallbackImage);
    const completedAt = Number.isFinite(Number(entry.completedAt)) ? Math.floor(Number(entry.completedAt)) : Date.now();
    const imageHash = shortHash(`${preferredImage || imageUrl}:${completedAt}`);
    const label = GRADE_LABELS[grade] ?? `Grade ${grade}`;
    return this.grantGeneratedNftCard(sessionId, {
      kind: "yearbook",
      stableKey: `yearbook:${grade}:${completedAt}:${characterName}:${playbookId}:${imageHash}`,
      requestId: input.requestId,
      at: input.at,
      ownerWalletAddress: input.ownerWalletAddress,
      title: `${label} Yearbook Snapshot`,
      characterId: generatedNftCharacterId("yearbook", `${grade}:${completedAt}:${characterName}:${playbookId}`),
      characterName,
      setNumber: `GEN-Y-${grade}-${imageHash.slice(0, 6).toUpperCase()}`,
      profileId: `yearbook-${grade}-${imageHash}`.slice(0, 96),
      cardName: `${characterName}: ${label} Yearbook`,
      subject: `${label} Yearbook`,
      role: "student",
      rarity: "super-rare",
      blurb: `${characterName}'s ${label} Ruby High yearbook snapshot.`,
      color: "#6b46c1",
      imageUrl,
      sourceImageUrl: imageUrl,
      playbookId,
      grade,
    });
  }

  private grantGeneratedNftCard(sessionId: string, input: {
    kind: RubyHighGeneratedNftProfileKind;
    stableKey: string;
    requestId?: string;
    at?: number;
    ownerWalletAddress?: string;
    title: string;
    characterId: string;
    canonicalCharacterId?: string;
    characterName: string;
    setNumber: string;
    profileId: string;
    cardName: string;
    subject: string;
    role: RubyHighHallPassCardRole;
    rarity: RubyHighHallPassCardRarity;
    blurb: string;
    color: string;
    imageUrl: string;
    sourceImageUrl: string;
    playbookId?: string;
    grade?: Grade;
  }): GeneratedNftCardResult {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const requestId = normalizeIdempotencyPart(input.requestId) || shortHash(input.stableKey);
    const id = generatedNftTransactionId(sessionId, input.kind, input.stableKey, requestId);
    const cards = normalizeHallPassCards(state.wallet.hallPassCards);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    const existingCard = cards.find((card) => card.grantTransactionId === id);
    if (existing && existingCard) {
      return { state, applied: false, transaction: existing, card: existingCard, cards: [existingCard] };
    }
    if (existing && !existingCard) throw new Error("Generated NFT card record is incomplete.");

    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    const ownerWalletAddress = typeof input.ownerWalletAddress === "string"
      ? input.ownerWalletAddress.trim().slice(0, 96)
      : "";
    const imageUrl = nftSafeImageRef(input.imageUrl, input.sourceImageUrl);
    if (!imageUrl) throw new Error("Generated NFT image URL is required.");
    const serial = hashInteger(`${id}:${input.characterId}:${imageUrl}`) % 900000 + 100000;
    const card: RubyHighHallPassCard = {
      id: hallPassCardId(id, 0),
      serial,
      title: input.title.trim().slice(0, 80) || "Ruby High Generated NFT",
      characterId: input.characterId.trim().slice(0, 80),
      ...(input.canonicalCharacterId ? { canonicalCharacterId: input.canonicalCharacterId.trim().slice(0, 80) } : {}),
      characterName: input.characterName.trim().slice(0, 80) || "Ruby High",
      setName: GENERATED_NFT_SET_NAME,
      setCode: GENERATED_NFT_SET_CODE,
      setNumber: input.setNumber.trim().slice(0, 40),
      profileId: input.profileId.trim().slice(0, 96),
      cardName: input.cardName.trim().slice(0, 120),
      subject: input.subject.trim().slice(0, 80),
      role: input.role,
      rarity: input.rarity,
      blurb: input.blurb.trim().slice(0, 160),
      color: input.color,
      hallPasses: 1,
      imageUrl,
      sourceImageUrl: nftSafeImageRef(input.sourceImageUrl, imageUrl),
      nftProfileKind: input.kind,
      ...(input.playbookId ? { playbookId: input.playbookId.trim().slice(0, 64) } : {}),
      ...(input.grade ? { grade: input.grade } : {}),
      status: "active",
      issuedAt: at,
      updatedAt: at,
      source: "hall-pass-card",
      grantTransactionId: id,
      ...(ownerWalletAddress ? { ownerWalletAddress } : {}),
    };
    cards.push(card);
    state.wallet.hallPassCards = normalizeHallPassCards(cards);
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-grant",
      at,
      hallPasses: 0,
      source: "hall-pass-card",
      description: `${card.characterName} generated NFT card`,
      metadata: {
        cardCount: 1,
        cardGrant: true,
        generatedNftV2: true,
        generatedNftKind: input.kind,
        generatedNftVersion: GENERATED_NFT_CARD_VERSION,
        hallPassCardId: card.id,
        characterId: card.characterId,
        ...(card.canonicalCharacterId ? { canonicalCharacterId: card.canonicalCharacterId } : {}),
        imageUrl,
        ...(card.playbookId ? { playbookId: card.playbookId } : {}),
        ...(card.grade ? { grade: card.grade } : {}),
        ...(ownerWalletAddress ? { ownerWalletAddress } : {}),
      },
    };
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: "hall-pass-card",
      feature: "generated-nft-card-grant",
      status: "success",
      hallPassesDelta: 0,
      metadata: { transactionId: transaction.id, cardId: card.id, kind: input.kind },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, card, cards: [card] };
  }

  recordHallPassPackMint(sessionId: string, input: HallPassPackMintInput): HallPassMutationResult {
    const state = this.getOrCreate(sessionId);
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Pack mint idempotency key is required.");
    const ownerWalletAddress = input.ownerWalletAddress.trim();
    const assetAddress = input.assetAddress.trim();
    const mintSignature = input.mintSignature.trim();
    const metadataUri = input.metadataUri.trim();
    if (!ownerWalletAddress || !assetAddress || !mintSignature || !metadataUri) {
      throw new Error("Pack mint record is incomplete.");
    }
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    const packs = normalizeHallPassPacks(state.wallet.hallPassPacks);
    const existingPack = packs.find((pack) => pack.grantTransactionId === id || pack.assetAddress === assetAddress);
    if (existing) {
      return { state, applied: false, transaction: existing, ...(existingPack ? { pack: existingPack } : {}) };
    }
    if (existingPack) throw new Error("Solana pack is already recorded.");
    const packCount = normalizePositiveInteger(input.packCount, "Pack count");
    const cardCount = Math.max(
      normalizePositiveInteger(input.cardCount, "Card count"),
      packCount * HALL_PASS_CARDS_PER_PACK,
    );
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    const catalogHash = hallPassCatalogHash();
    const commitment = packRevealCommitment({
      catalogHash,
      assetAddress,
      mintSignature,
      ownerWalletAddress,
      productId: input.productId.trim().slice(0, 96) || `card-pack-${packCount}`,
      cardCount,
      nonce: packRevealNonce(id, assetAddress, mintSignature, ownerWalletAddress),
    });
    const pack: RubyHighHallPassPack = {
      id: hallPassPackId(id, assetAddress),
      serial: hallPassPackSerial(input.serial, metadataUri, id, assetAddress),
      productId: input.productId.trim().slice(0, 96) || `card-pack-${packCount}`,
      packCount,
      cardCount,
      status: "active",
      issuedAt: at,
      updatedAt: at,
      ...(input.source ? { source: input.source } : {}),
      ownerWalletAddress,
      assetAddress,
      mintSignature,
      metadataUri,
      packRevealVersion: HALL_PASS_PACK_REVEAL_VERSION,
      catalogHash,
      commitment,
      entropySource: HALL_PASS_PACK_REVEAL_ENTROPY_SOURCE,
      grantTransactionId: id,
    };
    packs.push(pack);
    state.wallet.hallPassPacks = normalizeHallPassPacks(packs);
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-pack-mint",
      at,
      hallPasses: 0,
      source: input.source ?? "hall-pass-pack",
      ...(input.description ? { description: input.description } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        packNft: true,
        productId: pack.productId,
        packCount,
        cardCount,
        packSerial: pack.serial,
        ownerWalletAddress,
        packAssetAddress: assetAddress,
        packMintSignature: mintSignature,
        packMetadataUri: metadataUri,
        packRevealVersion: HALL_PASS_PACK_REVEAL_VERSION,
        catalogHash,
        commitment,
        entropySource: HALL_PASS_PACK_REVEAL_ENTROPY_SOURCE,
      },
    };
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "hall-pass-pack",
      feature: "hall-pass-pack-mint",
      status: "success",
      hallPassesDelta: 0,
      metadata: { transactionId: transaction.id, packCount, cardCount },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, pack, packs: state.wallet.hallPassPacks };
  }

  openHallPassPack(sessionId: string, input: HallPassPackOpenInput): HallPassMutationResult {
    const state = this.getOrCreate(sessionId);
    const packId = typeof input.packId === "string" ? input.packId.trim() : "";
    if (!packId) throw new Error("Pack id is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const packs = normalizeHallPassPacks(state.wallet.hallPassPacks);
    const pack = packs.find((candidate) => candidate.id === packId || candidate.assetAddress === packId);
    if (!pack) throw new Error("Pack not found.");
    const ownerWalletAddress = typeof input.ownerWalletAddress === "string" ? input.ownerWalletAddress.trim() : "";
    if (ownerWalletAddress && pack.ownerWalletAddress && pack.ownerWalletAddress !== ownerWalletAddress) {
      throw new Error("Pack belongs to a different wallet.");
    }
    const id = (input.idempotencyKey || `hall-pass-pack-open:${pack.id}`).trim();
    if (!id) throw new Error("Pack open idempotency key is required.");
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) {
      const cards = normalizeHallPassCards(state.wallet.hallPassCards)
        .filter((card) => card.grantTransactionId === existing.id);
      return { state, applied: false, transaction: existing, pack, cards };
    }
    if (pack.status !== "active") throw new Error("Pack is already opened.");
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    const openSignature = typeof input.openSignature === "string" ? input.openSignature.trim() : "";
    const fallbackCommitment = packRevealCommitment({
      catalogHash: hallPassCatalogHash(),
      assetAddress: pack.assetAddress,
      mintSignature: pack.mintSignature,
      ownerWalletAddress: pack.ownerWalletAddress,
      productId: pack.productId,
      cardCount: pack.cardCount,
      nonce: packRevealNonce(pack.grantTransactionId ?? pack.id, pack.assetAddress, pack.mintSignature, pack.ownerWalletAddress),
    });
    const packRevealVersion = cleanRevealString(pack.packRevealVersion) || HALL_PASS_PACK_REVEAL_VERSION;
    const catalogHash = cleanRevealString(pack.catalogHash) || hallPassCatalogHash();
    const commitment = cleanRevealString(pack.commitment) || fallbackCommitment;
    const entropySource = cleanRevealString(input.entropySource) || cleanRevealString(pack.entropySource) || HALL_PASS_PACK_REVEAL_ENTROPY_SOURCE;
    const revealSeed = cleanRevealString(input.revealSeed, 256) || packRevealSeed({
      commitment,
      assetAddress: pack.assetAddress,
      transactionId: id,
      openSignature,
      nonce: packRevealNonce(id, pack.assetAddress, pack.mintSignature, pack.ownerWalletAddress),
    });
    const revealSlot = Math.floor(Number(input.revealSlot));
    const randomnessAccount = cleanRevealString(input.randomnessAccount);
    const revealTransaction = cleanRevealString(input.revealTransaction) || openSignature || id;
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-pack-open",
      at,
      hallPasses: 0,
      source: input.source ?? "hall-pass-pack",
      description: input.description ?? `Ruby High Pack #${String(pack.serial).padStart(6, "0")} opened`,
      metadata: {
        ...(input.metadata ?? {}),
        packOpened: true,
        packId: pack.id,
        productId: pack.productId,
        packCount: pack.packCount,
        cardCount: pack.cardCount,
        ownerWalletAddress: pack.ownerWalletAddress,
        packAssetAddress: pack.assetAddress,
        packMintSignature: pack.mintSignature,
        packMetadataUri: pack.metadataUri,
        packRevealVersion,
        catalogHash,
        commitment,
        entropySource,
        revealSeed,
        revealTransaction,
        ...(Number.isFinite(revealSlot) && revealSlot >= 0 ? { revealSlot } : {}),
        ...(randomnessAccount ? { randomnessAccount } : {}),
        ...(openSignature ? { openSignature } : {}),
      },
    };
    const cards = issueHallPassCardsForTransaction(state, transaction, pack.cardCount, this.sessions);
    attachHallPassCardMetadata(transaction, cards);
    pack.status = "opened";
    pack.openedAt = at;
    pack.updatedAt = at;
    pack.openTransactionId = id;
    pack.packRevealVersion = packRevealVersion;
    pack.catalogHash = catalogHash;
    pack.commitment = commitment;
    pack.entropySource = entropySource;
    pack.revealSeed = revealSeed;
    pack.revealTransaction = revealTransaction;
    if (Number.isFinite(revealSlot) && revealSlot >= 0) pack.revealSlot = revealSlot;
    if (randomnessAccount) pack.randomnessAccount = randomnessAccount;
    if (openSignature) pack.openSignature = openSignature;
    state.wallet.hallPassPacks = normalizeHallPassPacks(packs);
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "hall-pass-pack",
      feature: "hall-pass-pack-open",
      status: "success",
      hallPassesDelta: 0,
      metadata: { transactionId: transaction.id, packId: pack.id, cardCount: pack.cardCount },
    });
    state.updatedAt = Date.now();
    if (!input.deferPersist) void this.persistSession(sessionId);
    return { state, applied: true, transaction, pack, cards };
  }

  spendHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-spend", input);
  }

  spendBurnedHallPassCards(sessionId: string, input: BurnedHallPassCardSpendInput): HallPassMutationResult {
    const burns = normalizeHallPassBurnInputs(input.burns);
    if (burns.length <= 0) throw new Error("Burned Card payment is required.");
    const state = this.getOrCreate(sessionId);
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Card transaction idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };
    const cards = normalizeHallPassCards(state.wallet.hallPassCards);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const spentCards: RubyHighHallPassCard[] = [];
    for (const burn of burns) {
      const card = byId.get(burn.cardId);
      if (!card) throw new Error("Burned Card not found.");
      if (card.status !== "active") throw new Error(`${card.characterName} card is already burned.`);
      if (!card.mintAddress || card.mintAddress !== burn.mintAddress) throw new Error(`${card.characterName} card mint does not match.`);
      if (!card.ownerWalletAddress || card.ownerWalletAddress !== burn.ownerWalletAddress) {
        throw new Error(`${card.characterName} card belongs to a different wallet.`);
      }
      spentCards.push(card);
    }
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-spend",
      at,
      hallPasses: -burns.length,
      ...(input.source ? { source: input.source } : {}),
      ...(input.description ? { description: input.description } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        ...(burns.length === 1 ? { burnSignature: burns[0]!.burnSignature } : {}),
        burnSignatures: burns.map((burn) => burn.burnSignature).join(","),
        burnMintAddresses: burns.map((burn) => burn.mintAddress).join(","),
        ownerWalletAddress: burns[0]!.ownerWalletAddress,
      },
    };
    for (let i = 0; i < spentCards.length; i += 1) {
      const card = spentCards[i]!;
      const burn = burns[i]!;
      card.status = "redeemed";
      card.updatedAt = at;
      card.redeemTransactionId = transaction.id;
      card.burnedAt = at;
      card.burnSignature = burn.burnSignature;
    }
    state.wallet.hallPassCards = normalizeHallPassCards(cards);
    attachHallPassCardMetadata(transaction, spentCards);
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "hall-pass-card",
      feature: "hall-pass-card-burn",
      status: "success",
      hallPassesDelta: transaction.hallPasses ?? 0,
      amountCents: typeof transaction.amountCents === "number" && Number.isFinite(transaction.amountCents) ? Math.floor(transaction.amountCents) : undefined,
      metadata: { transactionId: transaction.id, cardCount: burns.length },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, cards: spentCards };
  }

  convertBurnedHallPassCardsToHallPasses(sessionId: string, input: BurnedHallPassCardSpendInput): HallPassMutationResult {
    const burns = normalizeHallPassBurnInputs(input.burns);
    if (burns.length <= 0) throw new Error("Burned Card conversion is required.");
    const state = this.getOrCreate(sessionId);
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Card burn conversion idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };
    const cards = normalizeHallPassCards(state.wallet.hallPassCards);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const seenCardIds = new Set<string>();
    const burnedCards: RubyHighHallPassCard[] = [];
    for (const burn of burns) {
      if (seenCardIds.has(burn.cardId)) throw new Error("Burned Card appears more than once.");
      seenCardIds.add(burn.cardId);
      const card = byId.get(burn.cardId);
      if (!card) throw new Error("Burned Card not found.");
      if (card.status !== "active") throw new Error(`${card.characterName} card is already burned.`);
      if (!card.mintAddress || card.mintAddress !== burn.mintAddress) throw new Error(`${card.characterName} card mint does not match.`);
      if (!card.ownerWalletAddress || card.ownerWalletAddress !== burn.ownerWalletAddress) {
        throw new Error(`${card.characterName} card belongs to a different wallet.`);
      }
      burnedCards.push(card);
    }
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    const hallPasses = burnedCards.length * HALL_PASS_CARD_BURN_HALL_PASS_VALUE;
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-card-burn",
      at,
      hallPasses,
      source: input.source ?? "hall-pass-card",
      description: input.description ?? `${burnedCards.length} Card${burnedCards.length === 1 ? "" : "s"} burned for ${hallPasses} Hall Pass${hallPasses === 1 ? "" : "es"}`,
      metadata: {
        ...(input.metadata ?? {}),
        cardBurnConversion: true,
        hallPassesPerCard: HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
        ...(burns.length === 1 ? { burnSignature: burns[0]!.burnSignature } : {}),
        burnSignatures: burns.map((burn) => burn.burnSignature).join(","),
        burnMintAddresses: burns.map((burn) => burn.mintAddress).join(","),
        ownerWalletAddress: burns[0]!.ownerWalletAddress,
      },
    };
    for (let i = 0; i < burnedCards.length; i += 1) {
      const card = burnedCards[i]!;
      const burn = burns[i]!;
      card.status = "redeemed";
      card.updatedAt = at;
      card.redeemTransactionId = transaction.id;
      card.burnedAt = at;
      card.burnSignature = burn.burnSignature;
    }
    state.wallet.hallPassCards = normalizeHallPassCards(cards);
    state.wallet.hallPasses = Math.max(0, Math.floor(Number(state.wallet.hallPasses ?? 0))) + hallPasses;
    attachHallPassCardMetadata(transaction, burnedCards);
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "hall-pass-card",
      feature: "hall-pass-card-burn",
      status: "success",
      hallPassesDelta: transaction.hallPasses ?? 0,
      amountCents: typeof transaction.amountCents === "number" && Number.isFinite(transaction.amountCents) ? Math.floor(transaction.amountCents) : undefined,
      metadata: { transactionId: transaction.id, cardCount: burns.length },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, cards: burnedCards };
  }

  refundHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-refund", input);
  }

  revokeHallPasses(sessionId: string, input: HallPassMutationInput): HallPassMutationResult {
    return this.applyHallPassTransaction(sessionId, "hall-pass-revoke", input);
  }

  mintableHallPassCards(sessionId: string): RubyHighHallPassCard[] {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    return normalizeHallPassCards(state.wallet.hallPassCards)
      .filter((card) => card.status === "active" && !card.mintAddress && !card.mintSignature);
  }

  burnableHallPassCards(sessionId: string, ownerWalletAddress?: string): RubyHighHallPassCard[] {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const owner = typeof ownerWalletAddress === "string" ? ownerWalletAddress.trim() : "";
    return normalizeHallPassCards(state.wallet.hallPassCards)
      .filter((card) => (
        card.status === "active" &&
        !!card.mintAddress &&
        !!card.mintSignature &&
        (!owner || card.ownerWalletAddress === owner)
      ));
  }

  async cosyWorldWalletCards(
    currentOwnershipForCard: (card: RubyHighHallPassCard) => Promise<CosyWorldCardOwnership | null>,
    currentOwnershipForPack?: (pack: RubyHighHallPassPack) => Promise<CosyWorldPackOwnership | null>,
  ): Promise<CosyWorldWalletCardsExport> {
    const byWallet = new Map<string, CosyWorldWalletCardExport>();
    const cards: RubyHighHallPassCard[] = [];
    const packs: RubyHighHallPassPack[] = [];
    for (const state of this.sessions.values()) {
      state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
      for (const card of normalizeHallPassCards(state.wallet.hallPassCards)) {
        if (
          card.status !== "active" ||
          !card.ownerWalletAddress ||
          !card.mintAddress ||
          !card.mintSignature ||
          !card.characterId
        ) {
          continue;
        }
        cards.push(card);
      }
      for (const pack of normalizeHallPassPacks(state.wallet.hallPassPacks)) {
        if (
          pack.status === "void" ||
          !pack.ownerWalletAddress ||
          !pack.assetAddress ||
          !pack.mintSignature ||
          !pack.metadataUri
        ) {
          continue;
        }
        packs.push(pack);
      }
    }
    const ownerships = await mapWithConcurrency(
      cards,
      COSYWORLD_OWNERSHIP_LOOKUP_CONCURRENCY,
      async (card) => ({ card, ownership: await currentOwnershipForCard(card) }),
    );
    for (const { card, ownership } of ownerships) {
      if (!ownership?.ownerWalletAddress) continue;
      const walletAddress = ownership.ownerWalletAddress.trim();
      const mintAddress = ownership.mintAddress.trim();
      const characterId = card.characterId.trim();
      if (!walletAddress || !mintAddress || !characterId) continue;
      const cardIds = cosyWorldCardIdsForCard(card);
      if (!cardIds.length) continue;
      const key = walletAddress;
      let entry = byWallet.get(key);
      if (!entry) {
        entry = { walletAddress, cardIds: [], packs: [], hallPassCards: [] };
        byWallet.set(key, entry);
      }
      for (const cardId of cardIds) {
        if (!entry.cardIds.includes(cardId)) entry.cardIds.push(cardId);
      }
      entry.hallPassCards.push({
        id: card.id,
        serial: card.serial,
        characterId: card.characterId,
        canonicalCharacterId: card.canonicalCharacterId,
        characterName: card.characterName,
        setName: card.setName,
        setCode: card.setCode,
        setNumber: card.setNumber,
        profileId: card.profileId,
        cardName: card.cardName,
        subject: card.subject,
        role: card.role,
        rarity: card.rarity,
        status: card.status,
        ownerWalletAddress: walletAddress,
        mintAddress,
        metadataUri: card.metadataUri,
        artSheet: card.artSheet,
        artPosition: card.artPosition,
        imageUrl: card.imageUrl,
        sourceImageUrl: card.sourceImageUrl,
        nftProfileKind: card.nftProfileKind,
        playbookId: card.playbookId,
        grade: card.grade,
        source: "ruby_high",
        transactionSource: card.source,
      });
    }
    if (currentOwnershipForPack) {
      const packOwnerships = await mapWithConcurrency(
        packs,
        COSYWORLD_OWNERSHIP_LOOKUP_CONCURRENCY,
        async (pack) => ({ pack, ownership: await currentOwnershipForPack(pack) }),
      );
      for (const { pack, ownership } of packOwnerships) {
        if (!ownership?.ownerWalletAddress) continue;
        const walletAddress = ownership.ownerWalletAddress.trim();
        const assetAddress = ownership.assetAddress.trim();
        if (!walletAddress || !assetAddress) continue;
        const key = walletAddress;
        let entry = byWallet.get(key);
        if (!entry) {
          entry = { walletAddress, cardIds: [], packs: [], hallPassCards: [] };
          byWallet.set(key, entry);
        }
        entry.packs.push({
          id: pack.id,
          serial: pack.serial,
          productId: pack.productId,
          packCount: pack.packCount,
          cardCount: pack.cardCount,
          status: pack.status === "active" ? "unopened" : pack.status,
          ownerWalletAddress: walletAddress,
          assetAddress,
          packAssetAddress: assetAddress,
          mintSignature: pack.mintSignature,
          metadataUri: ownership.metadataUri?.trim() || pack.metadataUri,
          source: "ruby_high",
          transactionSource: pack.source,
        });
      }
    }
    const wallets = [...byWallet.values()]
      .map((entry) => ({
        ...entry,
        cardIds: [...entry.cardIds].sort((a, b) => a.localeCompare(b)),
        packs: [...entry.packs].sort((a, b) => (
          a.assetAddress.localeCompare(b.assetAddress) || a.serial - b.serial || a.id.localeCompare(b.id)
        )),
        hallPassCards: [...entry.hallPassCards].sort((a, b) => (
          a.characterId.localeCompare(b.characterId) || a.serial - b.serial || a.id.localeCompare(b.id)
        )),
      }))
      .sort((a, b) => a.walletAddress.localeCompare(b.walletAddress));
    return { generatedAt: new Date().toISOString(), wallets };
  }

  hallPassPacks(sessionId: string): RubyHighHallPassPack[] {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    return normalizeHallPassPacks(state.wallet.hallPassPacks);
  }

  reconcileHallPassPacksForOwner(
    sessionId: string,
    ownerWalletAddress: string,
    ownedAssetAddresses: string[],
  ): { removed: RubyHighHallPassPack[]; restored: RubyHighHallPassPack[]; packs: RubyHighHallPassPack[] } {
    const owner = ownerWalletAddress.trim();
    if (!owner) return { removed: [], restored: [], packs: [] };
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const owned = new Set(ownedAssetAddresses.map((asset) => asset.trim()).filter(Boolean));
    const packs = normalizeHallPassPacks(state.wallet.hallPassPacks);
    const removed: RubyHighHallPassPack[] = [];
    const restored: RubyHighHallPassPack[] = [];
    const at = Date.now();
    for (const pack of packs) {
      if (pack.ownerWalletAddress !== owner || pack.status === "opened") continue;
      const isOwnedOnChain = owned.has(pack.assetAddress);
      if (isOwnedOnChain && pack.status === "void") {
        pack.status = "active";
        pack.updatedAt = at;
        restored.push(pack);
      } else if (!isOwnedOnChain && pack.status === "active") {
        pack.status = "void";
        pack.updatedAt = at;
        removed.push(pack);
      }
    }
    if (removed.length > 0 || restored.length > 0) {
      state.wallet.hallPassPacks = normalizeHallPassPacks(packs);
      state.updatedAt = at;
      void this.persistSession(sessionId);
    }
    return { removed, restored, packs: state.wallet.hallPassPacks ?? [] };
  }

  findHallPassCardById(cardId: string): RubyHighHallPassCard | null {
    const id = typeof cardId === "string" ? cardId.trim() : "";
    if (!id) return null;
    for (const state of this.sessions.values()) {
      state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
      const card = normalizeHallPassCards(state.wallet.hallPassCards)
        .find((candidate) => candidate.id === id);
      if (card) return card;
    }
    return null;
  }

  findHallPassCardByMetadata(characterId: string, serial: number): RubyHighHallPassCard | null {
    const wantedCharacter = typeof characterId === "string" ? characterId.trim() : "";
    const wantedSerial = Math.max(1, Math.floor(Number(serial || 0)));
    if (!wantedCharacter || !Number.isFinite(wantedSerial)) return null;
    let fallback: RubyHighHallPassCard | null = null;
    for (const state of this.sessions.values()) {
      state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
      const card = normalizeHallPassCards(state.wallet.hallPassCards)
        .find((candidate) => candidate.characterId === wantedCharacter && candidate.serial === wantedSerial);
      if (!card) continue;
      if (card.mintAddress && card.mintSignature) return card;
      fallback ??= card;
    }
    return fallback;
  }

  findHallPassPackByMetadata(productId: string, serial: number): RubyHighHallPassPack | null {
    const product = typeof productId === "string" ? productId.trim() : "";
    const wantedSerial = Math.max(1, Math.floor(Number(serial || 0)));
    if (!product || !Number.isFinite(wantedSerial)) return null;
    for (const state of this.sessions.values()) {
      state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
      const pack = normalizeHallPassPacks(state.wallet.hallPassPacks)
        .find((candidate) => candidate.productId === product && candidate.serial === wantedSerial);
      if (pack) return pack;
    }
    return null;
  }

  recordHallPassCardMintPreparation(sessionId: string, input: HallPassCardMintPreparationInput): RubyHighHallPassCard {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const cards = normalizeHallPassCards(state.wallet.hallPassCards);
    const card = cards.find((candidate) => candidate.id === input.cardId);
    if (!card) throw new Error("Card not found.");
    if (card.status !== "active") throw new Error("Only active cards can be prepared for minting.");
    if (card.mintAddress || card.mintSignature) throw new Error("Card is already minted.");
    const ownerWalletAddress = input.ownerWalletAddress.trim();
    const mintAddress = input.mintAddress.trim();
    const metadataUri = input.metadataUri.trim();
    if (!ownerWalletAddress || !mintAddress || !metadataUri) throw new Error("Card mint preparation is incomplete.");
    if (card.ownerWalletAddress && card.ownerWalletAddress !== ownerWalletAddress) {
      throw new Error("Card belongs to a different wallet.");
    }
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    card.pendingMintOwnerWalletAddress = ownerWalletAddress;
    card.pendingMintAddress = mintAddress;
    card.pendingMintMetadataUri = metadataUri;
    const transactionMessageHash = typeof input.transactionMessageHash === "string"
      ? input.transactionMessageHash.trim()
      : "";
    if (transactionMessageHash) card.pendingMintTransactionHash = transactionMessageHash;
    else delete card.pendingMintTransactionHash;
    card.pendingMintPreparedAt = at;
    card.updatedAt = at;
    state.wallet.hallPassCards = normalizeHallPassCards(cards);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return card;
  }

  recordHallPassCardMint(sessionId: string, input: HallPassCardMintInput): {
    state: QuizState;
    applied: boolean;
    transaction: RubyHighWalletTransaction;
    card: RubyHighHallPassCard;
  } {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const id = (input.idempotencyKey || `hall-pass-card-mint:${input.cardId}:${input.mintAddress}`).trim();
    if (!id) throw new Error("Card mint idempotency key is required.");
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    const cards = normalizeHallPassCards(state.wallet.hallPassCards);
    const card = cards.find((candidate) => candidate.id === input.cardId);
    if (!card) throw new Error("Card not found.");
    if (existing) {
      return { state, applied: false, transaction: existing, card };
    }
    if (card.status !== "active") throw new Error("Only active cards can be minted.");
    if (card.mintAddress || card.mintSignature) throw new Error("Card is already minted.");
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now();
    card.ownerWalletAddress = input.ownerWalletAddress.trim();
    card.mintAddress = input.mintAddress.trim();
    card.mintSignature = input.mintSignature.trim();
    card.metadataUri = input.metadataUri.trim();
    delete card.pendingMintOwnerWalletAddress;
    delete card.pendingMintAddress;
    delete card.pendingMintMetadataUri;
    delete card.pendingMintTransactionHash;
    delete card.pendingMintPreparedAt;
    card.revealedAt = at;
    card.updatedAt = at;
    state.wallet.hallPassCards = normalizeHallPassCards(cards);
    const transaction: RubyHighWalletTransaction = {
      id,
      kind: "hall-pass-card-mint",
      at,
      source: "hall-pass-card",
      description: `${card.characterName} card minted`,
      metadata: {
        hallPassCardId: card.id,
        ownerWalletAddress: card.ownerWalletAddress,
        mintAddress: card.mintAddress,
        mintSignature: card.mintSignature,
        metadataUri: card.metadataUri,
        ...(card.packRevealVersion ? { packRevealVersion: card.packRevealVersion } : {}),
        ...(card.catalogHash ? { catalogHash: card.catalogHash } : {}),
        ...(card.commitment ? { commitment: card.commitment } : {}),
        ...(card.entropySource ? { entropySource: card.entropySource } : {}),
        ...(card.revealSeed ? { revealSeed: card.revealSeed } : {}),
        ...(card.revealProof ? { revealProof: card.revealProof } : {}),
        ...(card.packAssetAddress ? { packAssetAddress: card.packAssetAddress } : {}),
        ...(typeof card.revealSlot === "number" ? { revealSlot: card.revealSlot } : {}),
        ...(card.randomnessAccount ? { randomnessAccount: card.randomnessAccount } : {}),
        ...(card.revealTransaction ? { revealTransaction: card.revealTransaction } : {}),
      },
    };
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: "hall-pass-card",
      feature: "hall-pass-card-mint",
      status: "success",
      hallPassesDelta: 0,
      metadata: { transactionId: transaction.id, cardId: card.id },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction, card };
  }

  grantMeritStars(sessionId: string, input: MeritStarMutationInput): MeritStarMutationResult {
    return this.applyMeritStarTransaction(sessionId, "merit-star-grant", input);
  }

  spendMeritStars(sessionId: string, input: MeritStarMutationInput): MeritStarMutationResult {
    return this.applyMeritStarTransaction(sessionId, "merit-star-spend", input);
  }

  chatMeritStarQuote(sessionId: string, facultyId?: string | null): ChatMeritStarQuote {
    const state = this.getOrCreate(sessionId);
    const faculty = facultyId || state.faculty;
    const questionId = state.current && state.activeRound && !state.activeRound.resolved && state.faculty === faculty
      ? state.current.id
      : null;
    const chatCount = questionId ? this.countChatSpendsForQuestion(state, faculty, questionId) : 0;
    return {
      amount: CHAT_MERIT_STAR_COST * (chatCount + 1),
      baseAmount: CHAT_MERIT_STAR_COST,
      questionId,
      chatCount,
    };
  }

  private countChatSpendsForQuestion(state: QuizState, faculty: string, questionId: string): number {
    const transactions = Object.values(state.wallet.operationLedger ?? {});
    const fallback = state.wallet.transactions ?? [];
    const seen = new Set<string>();
    let count = 0;
    for (const tx of transactions.length > 0 ? transactions : fallback) {
      if (seen.has(tx.id)) continue;
      seen.add(tx.id);
      if (
        tx.kind === "merit-star-spend" &&
        tx.source === "chat" &&
        tx.metadata?.status !== "failed" &&
        tx.metadata?.faculty === faculty &&
        tx.metadata?.questionId === questionId
      ) {
        count += 1;
      }
    }
    return count;
  }

  private applyMeritStarTransaction(
    sessionId: string,
    kind: Extract<RubyHighWalletTransactionKind, "merit-star-grant" | "merit-star-spend">,
    input: MeritStarMutationInput,
  ): MeritStarMutationResult {
    const state = this.getOrCreate(sessionId);
    const amount = normalizePositiveInteger(input.amount, "Merit Star amount");
    const id = input.idempotencyKey.trim();
    if (!id) throw new Error("Merit Star transaction idempotency key is required.");
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[id] ?? state.wallet.transactions?.find((tx) => tx.id === id);
    if (existing) return { state, applied: false, transaction: existing };

    const current = Math.max(0, Math.floor(Number(state.wallet.meritStars ?? state.score.points ?? 0)));
    if (kind === "merit-star-spend" && current < amount) {
      throw new Error(`Not enough Merit Stars. Need ${amount}, have ${current}.`);
    }
    const transaction: RubyHighWalletTransaction = {
      id,
      kind,
      at: typeof input.at === "number" && Number.isFinite(input.at) ? Math.floor(input.at) : Date.now(),
      meritStars: kind === "merit-star-spend" ? -amount : amount,
      source: input.source ?? "system",
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    state.wallet.meritStars = kind === "merit-star-spend" ? current - amount : current + amount;
    recordWalletTransaction(state, transaction);
    this.recordMetricEvent("commerce", {
      sessionId,
      source: transaction.source ?? "wallet",
      feature: transaction.kind,
      status: "success",
      meritStarsDelta: transaction.meritStars ?? 0,
      metadata: { transactionId: transaction.id },
    });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, applied: true, transaction };
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
      ...(typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
        ? { amountCents: Math.floor(input.amountCents) }
        : {}),
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
      amountCents: typeof transaction.amountCents === "number" && Number.isFinite(transaction.amountCents) ? Math.floor(transaction.amountCents) : undefined,
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
      ...(typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
        ? { amountCents: Math.floor(input.amountCents) }
        : {}),
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

  chatPersistenceStore(): StateStoreLike {
    return this.store;
  }

  hasFaculty(): boolean {
    return this.faculty !== null;
  }

  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    const [
      storedPacks,
      storedTeachers,
      storedDraftPacks,
      storedPackInstallations,
      loaded,
      storedMetricEvents,
      storedSchoolEvents,
      storedPhotoPostSchedulerState,
      storedPublicWorldRoomState,
      storedPublicWorldRoomOutcomeState,
      storedPublicWorldTermState,
      storedPublicWorldTeacherAgendaState,
      storedPublicWorldEventLogState,
      storedPublicWorldModerationState,
      storedLiveRoomGoalState,
    ] = await Promise.all([
      this.store.loadPacks(),
      this.store.loadTeachers(),
      this.store.loadDraftPacks(),
      this.store.loadPackInstallations(),
      this.store.load(),
      this.store.loadMetricEvents?.() ?? Promise.resolve([]),
      this.store.loadSchoolEvents?.({ limit: SCHOOL_WORLD_EVENT_CACHE_LIMIT }) ?? Promise.resolve([]),
      this.store.loadServiceState?.(PHOTO_POST_SCHEDULER_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_ROOMS_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_ROOM_OUTCOMES_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_TERMS_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_TEACHER_AGENDAS_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_EVENTS_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(PUBLIC_WORLD_MODERATION_STATE_ID) ?? Promise.resolve(null),
      this.store.loadServiceState?.(LIVE_ROOM_GOALS_STATE_ID) ?? Promise.resolve(null),
    ]);
    const staleBuiltInPackRecords = storedPacks.filter(isPersistedBuiltInPackOverride);
    this.persistedPackRecords = storedPacks.filter((record) => !isPersistedBuiltInPackOverride(record));
    this.teacherRecords = storedTeachers.slice();
    this.draftPackRecords = storedDraftPacks.slice();
    this.packInstallationRecords = storedPackInstallations.slice();
    this.persistedPackRecords
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
    if (staleBuiltInPackRecords.length > 0) {
      this.trackBackgroundWrite(Promise.all(
        staleBuiltInPackRecords.map((record) =>
          this.store.deletePack(record.ownerSessionId, record.pack.id)),
      ).then(() => undefined).catch((err) => {
        log.error("ruby-high.delete-stale-built-in-pack-override-failed", err, {
          count: staleBuiltInPackRecords.length,
        });
      }));
    }
    let repaired = false;
    for (const [k, v] of loaded) {
      const state = normalizeLoaded(v);
      repaired = repairGeneratedPortraitAssetRefs(state) || repaired;
      repaired = this.reconcileLoadedPackState(state) || repaired;
      this.sessions.set(k, state);
    }
    for (const event of storedMetricEvents) {
      this.metricEvents.set(event.id, event);
    }
    for (const event of storedSchoolEvents) {
      this.schoolEventRecords.set(event.id, event);
    }
    this.pruneSchoolEventRecords();
    this.hydratePhotoPostSchedulerState(storedPhotoPostSchedulerState);
    this.hydratePublicWorldRoomState(storedPublicWorldRoomState);
    this.hydratePublicWorldRoomOutcomeState(storedPublicWorldRoomOutcomeState);
    this.hydratePublicWorldTermState(storedPublicWorldTermState);
    this.hydratePublicWorldTeacherAgendaState(storedPublicWorldTeacherAgendaState);
    this.hydratePublicWorldEventLog(storedPublicWorldEventLogState);
    this.hydratePublicWorldModerationState(storedPublicWorldModerationState);
    this.hydrateLiveRoomGoalState(storedLiveRoomGoalState);
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
    const record: StoredContentPackRecord = {
      pack,
      ownerSessionId: sessionId,
      touchedAt: Date.now(),
    };
    try {
      await this.store.savePack(record);
      this.upsertPersistedPackRecord(record);
      await this.prunePersistedImportedPacks(sessionId);
    } catch (err) {
      log.error("ruby-high.persist-pack-failed", err, { sessionId, packId: pack.id });
      throw err;
    }
  }

  async promoteBuiltInCurriculumQuestions(
    facultyId: string,
    questions: readonly BankedQuestion[],
    now = Date.now(),
  ): Promise<{ packId: string; facultyId: string; inserted: number; skipped: number; totalQuestions: number }> {
    const pack = await getActivePack();
    if (pack.id !== ORIGINAL_PACK_ID) throw new Error("Built-in curriculum can only be promoted into Ruby High Original.");
    const faculty = pack.faculty.find((entry) => entry.id === facultyId);
    if (!faculty) throw new Error("Built-in teacher was not found.");
    let updatedPack: ContentPack | null = null;
    let inserted = 0;
    let skipped = 0;
    for (const question of questions) {
      if (faculty.questions.some((entry) => entry.id === question.id)) {
        skipped += 1;
        continue;
      }
      const next = appendQuestionToPackBank(pack.id, facultyId, question, now);
      if (!next) throw new Error("Could not promote reviewed curriculum question.");
      updatedPack = next;
      inserted += 1;
    }
    if (updatedPack) {
      const record: StoredContentPackRecord = {
        pack: updatedPack,
        ownerSessionId: GLOBAL_PACK_OWNER,
        touchedAt: now,
      };
      await this.store.savePack(record);
      this.upsertPersistedPackRecord(record);
    }
    const totalQuestions = updatedPack?.faculty.find((entry) => entry.id === facultyId)?.questions.length
      ?? faculty.questions.length;
    return {
      packId: pack.id,
      facultyId,
      inserted,
      skipped,
      totalQuestions,
    };
  }

  async listPersistedPackRecords(): Promise<StoredContentPackRecord[]> {
    if (!this.persistedPackRecords) this.persistedPackRecords = await this.store.loadPacks();
    return this.persistedPackRecords.slice();
  }

  async getPack(packId: string): Promise<StoredContentPackRecord | null> {
    const records = await this.listPersistedPackRecords();
    return records.find((r) => r.pack.id === packId) ?? null;
  }

  addPackReview(packId: string, input: { userId: string; rating: number; comment?: string }): StoredPackReview {
    if (!this.persistedPackRecords) throw new Error("Packs not loaded yet.");
    const record = this.persistedPackRecords.find((r) => r.pack.id === packId);
    if (!record) throw new Error("Pack not found.");
    if (input.rating < 1 || input.rating > 5) throw new Error("Rating must be 1-5.");
    const review: StoredPackReview = {
      id: `${packId}:${input.userId}:${Date.now().toString(36)}`,
      packId,
      userId: input.userId,
      rating: input.rating,
      ...(input.comment ? { comment: input.comment } : {}),
      createdAt: Date.now(),
    };
    // Replace existing review from same user, or append new one.
    record.reviews = record.reviews ?? [];
    const existing = record.reviews.findIndex((r) => r.userId === input.userId);
    if (existing >= 0) {
      record.reviews[existing] = review;
    } else {
      record.reviews.push(review);
    }
    record.touchedAt = Date.now();
    void this.store.savePack(record).catch((err) => {
      log.error("ruby-high.persist-pack-review-failed", err, { packId });
    });
    return review;
  }

  async listTeacherRecords(): Promise<StoredTeacherRecord[]> {
    if (!this.teacherRecords) this.teacherRecords = await this.store.loadTeachers();
    return this.teacherRecords.slice();
  }

  async listDraftPackRecords(): Promise<StoredDraftContentPackRecord[]> {
    if (!this.draftPackRecords) this.draftPackRecords = await this.store.loadDraftPacks();
    return this.draftPackRecords.slice();
  }

  async saveDraftPackRecord(record: StoredDraftContentPackRecord): Promise<void> {
    try {
      await this.store.saveDraftPack(record);
      this.upsertDraftPackRecord(record);
    } catch (err) {
      log.error("ruby-high.persist-draft-pack-failed", err, { draftId: record.id });
      throw err;
    }
  }

  async deleteDraftPackRecord(draftId: string): Promise<void> {
    try {
      await this.store.deleteDraftPack(draftId);
      this.removeDraftPackRecord(draftId);
    } catch (err) {
      log.error("ruby-high.delete-draft-pack-failed", err, { draftId });
      throw err;
    }
  }

  async deletePersistedPackRecord(ownerSessionId: string | null, packId: string): Promise<void> {
    try {
      unregisterPack(packId);
      await this.store.deletePack(ownerSessionId, packId);
      this.removePersistedPackRecord(ownerSessionId, packId);
    } catch (err) {
      log.error("ruby-high.delete-pack-failed", err, { ownerSessionId, packId });
      throw err;
    }
  }

  async deleteTeacherRecord(teacherId: string): Promise<void> {
    try {
      await this.store.deleteTeacher(teacherId);
      this.removeTeacherRecord(teacherId);
    } catch (err) {
      log.error("ruby-high.delete-teacher-failed", err, { teacherId });
      throw err;
    }
  }

  async deletePackInstallationRecord(userId: string, packId: string): Promise<void> {
    try {
      await this.store.deletePackInstallation(userId, packId);
      this.removePackInstallationRecord(userId, packId);
    } catch (err) {
      log.error("ruby-high.delete-pack-installation-failed", err, { userId, packId });
      throw err;
    }
  }

  async listPackInstallationRecords(): Promise<StoredPackInstallationRecord[]> {
    if (!this.packInstallationRecords) this.packInstallationRecords = await this.store.loadPackInstallations();
    return this.packInstallationRecords.slice();
  }

  async savePackInstallationRecord(record: StoredPackInstallationRecord): Promise<void> {
    try {
      await this.store.savePackInstallation(record);
      this.upsertPackInstallationRecord(record);
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
    const record: StoredContentPackRecord = {
      pack,
      ownerSessionId: null,
      ...(opts.creatorUserId ? { creatorUserId: opts.creatorUserId } : {}),
      ...(opts.courseSlot ? { courseSlot: opts.courseSlot } : {}),
      touchedAt,
    };
    try {
      registerPublicPack(pack, touchedAt, {
        ownerSessionId: opts.previousOwnerSessionId ?? null,
        allowGlobalOverwrite: opts.allowGlobalOverwrite,
      });
      await this.store.savePack(record);
      this.upsertPersistedPackRecord(record);
      if (opts.previousOwnerSessionId) {
        await this.store.deletePack(opts.previousOwnerSessionId, pack.id);
        this.removePersistedPackRecord(opts.previousOwnerSessionId, pack.id);
      }
    } catch (err) {
      log.error("ruby-high.persist-public-teacher-pack-failed", err, { packId: pack.id });
      throw err;
    }
  }

  private async prunePersistedImportedPacks(sessionId: string): Promise<void> {
    const owned = (await this.listPersistedPackRecords())
      .filter((record) => record.ownerSessionId === sessionId)
      .sort((a, b) => a.touchedAt - b.touchedAt || a.pack.id.localeCompare(b.pack.id));
    const excess = owned.length - MAX_PACKS_PER_OWNER;
    if (excess <= 0) return;
    await Promise.all(
      owned.slice(0, excess).map((record) => this.deletePersistedPackRecord(record.ownerSessionId, record.pack.id)),
    );
  }

  private trackBackgroundWrite(promise: Promise<void>): void {
    const tracked = promise.finally(() => {
      this.backgroundWrites.delete(tracked);
    });
    this.backgroundWrites.add(tracked);
  }

  private persistGlobalPack(pack: ContentPack): void {
    const record: StoredContentPackRecord = {
      pack,
      ownerSessionId: GLOBAL_PACK_OWNER,
      touchedAt: Date.now(),
    };
    this.upsertPersistedPackRecord(record);
    this.trackBackgroundWrite(this.store.savePack(record).catch((err) => {
      log.error("ruby-high.persist-global-pack-failed", err, { packId: pack.id });
    }));
  }

  private upsertPersistedPackRecord(record: StoredContentPackRecord): void {
    if (!this.persistedPackRecords) return;
    const key = persistedPackRecordKey(record.ownerSessionId, record.pack.id);
    const index = this.persistedPackRecords.findIndex((entry) =>
      persistedPackRecordKey(entry.ownerSessionId, entry.pack.id) === key);
    if (index >= 0) this.persistedPackRecords[index] = record;
    else this.persistedPackRecords.push(record);
  }

  private removePersistedPackRecord(ownerSessionId: string | null, packId: string): void {
    if (!this.persistedPackRecords) return;
    const key = persistedPackRecordKey(ownerSessionId, packId);
    this.persistedPackRecords = this.persistedPackRecords.filter((entry) =>
      persistedPackRecordKey(entry.ownerSessionId, entry.pack.id) !== key);
  }

  private removeTeacherRecord(teacherId: string): void {
    if (!this.teacherRecords) return;
    this.teacherRecords = this.teacherRecords.filter((entry) => entry.id !== teacherId);
  }

  private upsertDraftPackRecord(record: StoredDraftContentPackRecord): void {
    if (!this.draftPackRecords) return;
    const index = this.draftPackRecords.findIndex((entry) => entry.id === record.id);
    if (index >= 0) this.draftPackRecords[index] = record;
    else this.draftPackRecords.push(record);
  }

  private removeDraftPackRecord(draftId: string): void {
    if (!this.draftPackRecords) return;
    this.draftPackRecords = this.draftPackRecords.filter((entry) => entry.id !== draftId);
  }

  private upsertPackInstallationRecord(record: StoredPackInstallationRecord): void {
    if (!this.packInstallationRecords) return;
    const key = packInstallationRecordKey(record.userId, record.packId);
    const index = this.packInstallationRecords.findIndex((entry) =>
      packInstallationRecordKey(entry.userId, entry.packId) === key);
    if (index >= 0) this.packInstallationRecords[index] = record;
    else this.packInstallationRecords.push(record);
  }

  private removePackInstallationRecord(userId: string, packId: string): void {
    if (!this.packInstallationRecords) return;
    const key = packInstallationRecordKey(userId, packId);
    this.packInstallationRecords = this.packInstallationRecords.filter((entry) =>
      packInstallationRecordKey(entry.userId, entry.packId) !== key);
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
        answerStats: { totalAnswers: 0, repeatedAnswers: 0 },
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
        publicWorldHiddenEventIds: [],
        publicWorldEventReports: [],
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
    // Tick any in-flight round so callers always see fresh elapsed state.
    this.tickRound(state);
    const repairedMemory = this.backfillCardMemory(state);
    const repairedComicCollection = this.unlockStudentInsertPagesForCircledSocialCard(state);
    const repairedTeacherPages = this.unlockTeacherStoryPagesForAClasses(state);
    if (this.maybeMarkGradeReady(state) || repairedMemory || repairedComicCollection || repairedTeacherPages) {
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
    }
    return state;
  }

  claimWelcomeHallPasses(sessionId: string): HallPassMutationResult {
    const state = this.getOrCreate(sessionId);
    state.wallet = normalizeWallet(state.wallet, state.score.points ?? 0);
    const existing = state.wallet.operationLedger?.[WELCOME_HALL_PASS_GRANT_ID] ??
      state.wallet.transactions?.find((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID) ??
      null;
    if (existing) {
      if (!state.wallet.welcomeHallPassesGrantedAt) {
        state.wallet.welcomeHallPassesGrantedAt = existing.at;
        state.updatedAt = Date.now();
        void this.persistSession(sessionId);
      }
      return { state, applied: false, transaction: existing };
    }
    const at = Date.now();
    const result = this.applyHallPassTransaction(sessionId, "hall-pass-grant", {
      amount: WELCOME_HALL_PASS_GRANT,
      idempotencyKey: WELCOME_HALL_PASS_GRANT_ID,
      source: "system",
      description: "Welcome Hall Passes",
      metadata: { reason: "hall-pass-page-welcome" },
      at,
    });
    result.state.wallet.welcomeHallPassesGrantedAt = result.transaction.at;
    result.state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return result;
  }

  private appendSchoolEvent(state: QuizState, event: SchoolEvent): void {
    const events = Array.isArray(state.schoolEvents) ? state.schoolEvents : [];
    events.push(event);
    if (events.length > SCHOOL_EVENT_LIMIT) {
      events.splice(0, events.length - SCHOOL_EVENT_LIMIT);
    }
    state.schoolEvents = events;
    const occurredAt = schoolEventOccurredAt(event.at);
    const record: StoredSchoolEventRecord = {
      id: event.id,
      sessionId: state.sessionId,
      event,
      occurredAt,
      day: new Date(occurredAt).toISOString().slice(0, 10),
    };
    this.schoolEventRecords.set(record.id, record);
    this.pruneSchoolEventRecords();
    if (this.store.saveSchoolEvent) {
      const save = this.store.saveSchoolEvent(record).catch((err) => {
        log.error("ruby-high.school-event-persist-failed", err, { eventId: event.id, sessionId: state.sessionId });
      });
      this.trackBackgroundWrite(save);
    }
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
    if (!state.character) return false;
    const records = characterDailyClassRecords(state.character);
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

  private eligibleGraduationFacultyIds(state: QuizState, grade: Grade): string[] {
    const pack = packForSession(state);
    const available = coursesForPack(pack)
      .map((course) => course.facultyId)
      .filter((facultyId) => pack.faculty.some((f) =>
        f.id === facultyId && (f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
      ));
    const availableSet = new Set(available);
    const core = CORE_GRADUATION_FACULTY_ORDER.filter((facultyId) => availableSet.has(facultyId));
    const custom = available.filter((facultyId) =>
      !CORE_GRADUATION_FACULTY_ORDER.includes(facultyId as typeof CORE_GRADUATION_FACULTY_ORDER[number]) &&
      facultyId !== GUEST_COURSE_ID
    );
    const guest = grade === "12" && availableSet.has(GUEST_COURSE_ID) ? [GUEST_COURSE_ID] : [];
    return Array.from(new Set([...core, ...custom, ...guest]));
  }

  private graduationRoomTargetForState(state: QuizState, grade: Grade): number {
    return Math.min(GRADUATION_ROOM_TARGETS[grade], this.eligibleGraduationFacultyIds(state, grade).length);
  }

  private graduationClassSelectionForState(
    state: QuizState,
    opts: { includeFacultyId?: string; commit?: boolean } = {},
  ): {
    grade: Grade | null;
    requiredDays: number;
    requiredRooms: number;
    selected: string[];
    eligible: string[];
    openElectiveSlots: number;
  } {
    const ch = state.character;
    const grade = state.currentGrade;
    if (!ch || !grade) {
      return { grade: grade ?? null, requiredDays: 0, requiredRooms: 0, selected: [], eligible: [], openElectiveSlots: 0 };
    }
    const eligible = this.eligibleGraduationFacultyIds(state, grade);
    const requiredRooms = this.graduationRoomTargetForState(state, grade);
    const requiredDays = requiredClassCompletionsForGrade(grade);
    const primary = eligible.includes(RUBY_FACULTY.id) ? RUBY_FACULTY.id : eligible[0];
    const rawSelected = Array.isArray(ch.graduationClassrooms?.[grade]) ? ch.graduationClassrooms![grade]! : [];
    let selected = Array.from(new Set([
      ...(primary ? [primary] : []),
      ...rawSelected.filter((facultyId) => eligible.includes(facultyId)),
    ])).slice(0, requiredRooms);

    if (grade === "12") {
      selected = eligible.slice(0, requiredRooms);
    } else if (grade !== "9" && opts.includeFacultyId && eligible.includes(opts.includeFacultyId)) {
      const alreadySelected = selected.includes(opts.includeFacultyId);
      const isPrimary = opts.includeFacultyId === primary;
      const isGuest = opts.includeFacultyId === GUEST_COURSE_ID;
      if (!alreadySelected && !isPrimary && !isGuest && selected.length < requiredRooms) {
        selected = [...selected, opts.includeFacultyId];
      }
    }

    if (opts.commit && grade !== "9" && selected.length > 0) {
      ch.graduationClassrooms = ch.graduationClassrooms ?? {};
      const previous = ch.graduationClassrooms[grade] ?? [];
      if (previous.join("\0") !== selected.join("\0")) {
        ch.graduationClassrooms[grade] = selected;
      }
    }

    return {
      grade,
      requiredDays,
      requiredRooms,
      selected,
      eligible,
      openElectiveSlots: Math.max(0, requiredRooms - selected.length),
    };
  }

  private graduationClassPlanForState(
    state: QuizState,
    opts: { includeFacultyId?: string; commit?: boolean } = {},
  ): GraduationGateProgress {
    const selection = this.graduationClassSelectionForState(state, opts);
    if (!selection.grade) {
      return {
        grade: null,
        requiredDays: 0,
        dailyClasses: 0,
        requiredRooms: 0,
        completedRooms: 0,
        openElectiveSlots: 0,
        requiredFacultyIds: [],
        eligibleFacultyIds: [],
        classGrades: {},
        ready: false,
      };
    }

    let completedRooms = 0;
    const classGrades: Record<string, string> = {};
    for (const facultyId of selection.selected) {
      const course = this.courseStandingForState(state, facultyId);
      classGrades[facultyId] = course.letterGrade ?? "—";
      if (course.passed) completedRooms += 1;
    }
    const ch = state.character;
    const streakCount = ch?.streak && ch.streak.grade === selection.grade ? ch.streak.count : 0;
    const ready = selection.requiredRooms > 0 &&
      selection.selected.length >= selection.requiredRooms &&
      completedRooms >= selection.requiredRooms &&
      streakCount >= selection.requiredDays;
    return {
      grade: selection.grade,
      requiredDays: selection.requiredDays,
      dailyClasses: streakCount,
      requiredRooms: selection.requiredRooms,
      completedRooms,
      openElectiveSlots: selection.openElectiveSlots,
      requiredFacultyIds: selection.selected,
      eligibleFacultyIds: selection.eligible,
      classGrades,
      ready,
    };
  }

  private isGraduationFacultyForState(state: QuizState, facultyId: string, commit = false): boolean {
    return this.graduationClassSelectionForState(state, { includeFacultyId: facultyId, commit }).selected.includes(facultyId);
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
    if (!this.isGraduationFacultyForState(state, facultyId)) return "practice";
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
    const selection = this.graduationClassSelectionForState(state);
    const required = grade && selection.selected.includes(facultyId) ? selection.requiredDays : 0;
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

    const completed = characterDailyClassRecords(ch)
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
    if (
      requestedMode === "practice" ||
      !ch ||
      !grade ||
      facultyId === LOUNGE_FACULTY.id ||
      !this.isGraduationFacultyForState(state, facultyId, true)
    ) {
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
      this.maybePostXMilestone({
        kind: "class-passed",
        characterName: state.character?.name ?? "A student",
        grade: session.grade,
        teacherFacultyId: session.facultyId,
        teacherName: teacherById(session.facultyId)?.displayName,
        letterGrade: record.letterGrade,
      }, state);

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

  private firstBellQuestionBiasApplies(state: QuizState): boolean {
    return !!state.character && state.score.total < FIRST_BELL_EASY_QUESTION_COUNT;
  }

  private firstBellFacultyName(state: QuizState, facultyId: string): string {
    return teacherById(facultyId)?.displayName
      ?? facultyForSession(state).find((faculty) => faculty.id === facultyId)?.displayName
      ?? facultyId;
  }

  private maybeAwardFirstBellReport(
    state: QuizState,
    question: Question,
    reveal: LastReveal,
    now = Date.now(),
  ): FirstBellReport | null {
    const ch = state.character;
    if (!ch || ch.firstBellReport) return null;
    const facultyId = question.faculty ?? state.faculty;
    const pickedAnswer = reveal.answerText
      ?? (reveal.forfeit ? "No answer" : question.options?.[reveal.picked])
      ?? reveal.picked;
    const correctAnswer = reveal.expectedAnswer
      ?? question.expectedAnswer
      ?? question.options?.[reveal.correct]
      ?? reveal.correct;
    const report: FirstBellReport = {
      reportId: `first-bell:${createHash("sha256").update(`${state.sessionId}:${question.id}:${now}`).digest("hex").slice(0, 16)}`,
      awardedAt: now,
      grade: state.currentGrade ?? null,
      facultyId,
      facultyName: this.firstBellFacultyName(state, facultyId),
      questionId: question.id,
      prompt: question.prompt,
      answerText: pickedAnswer,
      correctAnswerText: correctAnswer,
      wasCorrect: reveal.wasCorrect,
      ...(reveal.encouragement ? { encouragement: reveal.encouragement } : {}),
      ...(reveal.scoreAward ? { score: reveal.scoreAward.points } : {}),
    };
    ch.firstBellReport = report;
    this.recordFunnelStep(state, "first_bell_report_awarded", {
      faculty: facultyId,
      grade: state.currentGrade ?? null,
      wasCorrect: reveal.wasCorrect,
    });
    log.event("first-bell.report-awarded", {
      sessionId: state.sessionId,
      faculty: facultyId,
      grade: state.currentGrade,
      wasCorrect: reveal.wasCorrect,
    });
    return report;
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
    const sourceCards = this.availableSourceCardsForGrade(faculty.sourceCards ?? [], state.currentGrade);
    const bankedQuestions = faculty.sourceCards?.length
      ? faculty.questions.filter((q) => !q.sourceCardId)
      : faculty.questions;
    return [
      ...sourceCards.map((card) => this.questionForSourceCard(card)),
      ...bankedQuestions.filter((q) => this.questionUnlockedForGrade(q, state.currentGrade)),
    ];
  }

  private availableSourceCardsForGrade(cards: PackSourceCard[], grade: Grade | null): PackSourceCard[] {
    return cards.filter((card) => this.sourceCardUnlockedForGrade(card, grade));
  }

  private sourceCardUnlockedForGrade(card: PackSourceCard, grade: Grade | null): boolean {
    if (!card.minGrade) return true;
    return gradeRank(grade ?? DEFAULT_GRADE) >= gradeRank(card.minGrade);
  }

  private questionUnlockedForGrade(question: BankedQuestion, grade: Grade | null): boolean {
    if (!question.minGrade) return true;
    return gradeRank(grade ?? DEFAULT_GRADE) >= gradeRank(question.minGrade);
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
    const withoutSourceCards = (pool: BankedQuestion[]): BankedQuestion[] =>
      pool.filter((q) => !q.sourceCardId);
    const preferBankedQuestions = (pool: BankedQuestion[]): BankedQuestion[] => {
      const banked = withoutSourceCards(pool);
      return banked.length > 0 ? banked : pool;
    };
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
      if (due.length > 0) return preferBankedQuestions(due)[0]!;
      if (fresh.length > 0) {
        const freshPool = preferBankedQuestions(fresh);
        return freshPool[Math.floor(Math.random() * freshPool.length)] ?? null;
      }
      if (legacyDue.length > 0) return preferBankedQuestions(legacyDue)[0]!;
      masteredDue.sort((a, b) => {
        const ma = memory[cardMemoryKey(facultyId, a.id)]!;
        const mb = memory[cardMemoryKey(facultyId, b.id)]!;
        return ma.dueAt - mb.dueAt;
      });
      if (masteredDue.length > 0) return preferBankedQuestions(masteredDue)[0]!;
      undue.sort((a, b) => {
        const ma = memory[cardMemoryKey(facultyId, a.id)]!;
        const mb = memory[cardMemoryKey(facultyId, b.id)]!;
        return (ma.lastReviewedAt ?? 0) - (mb.lastReviewedAt ?? 0)
          || ma.dueAt - mb.dueAt;
      });
      return preferBankedQuestions(undue)[0] ?? null;
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

  private appendAnswerHistory(state: QuizState, record: AnswerRecord): void {
    const stats = normalizeAnswerStats(state.answerStats ?? answerStatsFromHistory(state.history));
    const repeated = this.answerRecordIsRepeat(state, record);
    stats.totalAnswers += 1;
    if (repeated) stats.repeatedAnswers += 1;
    state.answerStats = stats;
    state.history.push(record);
    if (state.history.length > ANSWER_HISTORY_LIMIT) {
      state.history.splice(0, state.history.length - ANSWER_HISTORY_LIMIT);
    }
  }

  private answerRecordIsRepeat(state: QuizState, record: AnswerRecord): boolean {
    for (const memory of Object.values(state.cardMemory ?? {})) {
      if (memory.questionId === record.questionId && memory.lastReviewedAt != null) return true;
    }
    return state.history.some((entry) => entry.questionId === record.questionId);
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
    // ── Playbook moves: correctness overrides ───────────────────────────────
    let playbookMoveOverride: string | null = null;
    let classClownVoid = false;
    if (!rawCorrect && !forfeit && picked != null && state.character && state.currentGrade) {
      const ch = state.character;
      const grade = state.currentGrade;
      ch.playbookMoves ??= {};
      // Overachiever: retake one missed question per year.
      if (ch.playbookId === "overachiever") {
        ch.playbookMoves.overachieverRetakeUsed ??= {};
        if (!ch.playbookMoves.overachieverRetakeUsed[grade]) {
          ch.playbookMoves.overachieverRetakeUsed[grade] = true;
          playbookMoveOverride = "overachiever";
        }
      }
      // Outsider: once per period, see explanation and correct answer.
      if (!playbookMoveOverride && ch.playbookId === "outsider" && !ch.playbookMoves.outsiderPeriodUsed) {
        ch.playbookMoves.outsiderPeriodUsed = true;
        playbookMoveOverride = "outsider";
      }
    }
    const moveWasCorrect = !!playbookMoveOverride;
    let wasCorrect = rawCorrect || !!affinitySave || moveWasCorrect;
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
      this.appendAnswerHistory(state, record);
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
    // ── Playbook moves: dice re-rolls ────────────────────────────────────────
    if (playerRoll && playerRoll.outcome === "miss" && state.character && picked != null) {
      const ch = state.character;
      // Slacker: when you'd fail a HEAD roll, swap it for HUSTLE.
      if (ch.playbookId === "slacker" && playerRoll.stat === "head") {
        const r2 = roll2d6();
        const hustleTotal = r2.total + ch.stats.hustle;
        playerRoll = { stat: "hustle", dice: r2.dice, total: hustleTotal, outcome: classifyTotal(hustleTotal) };
        if (!playbookMoveOverride) playbookMoveOverride = "slacker";
      }
      // Class Clown: when you'd miss, roll HEART instead of HEAD.
      if (ch.playbookId === "class-clown" && !playbookMoveOverride) {
        const r2 = roll2d6();
        const heartTotal = r2.total + ch.stats.heart;
        const heartOutcome = classifyTotal(heartTotal);
        playerRoll = { stat: "heart", dice: r2.dice, total: heartTotal, outcome: heartOutcome };
        if (heartOutcome === "hit") {
          classClownVoid = true;
          playbookMoveOverride = "class-clown";
        } else {
          playbookMoveOverride = "class-clown";
        }
      }
    }
    // Class Clown void: retroactively fix NPCs, history, and score.
    if (classClownVoid) {
      for (const entry of round.npcs) {
        if (entry.plannedPick !== q.correct && entry.answeredAt != null) {
          entry.plannedPick = q.correct ?? "A";
          entry.outcome = "mixed";
          entry.rolledTotal = Math.max(0, entry.rolledTotal);
        }
      }
      if (picked != null && !wasCorrect) {
        const lastRecord = state.history[state.history.length - 1];
        if (lastRecord && lastRecord.questionId === q.id) {
          lastRecord.wasCorrect = true;
        }
        state.score.correct += 1;
      }
      wasCorrect = true;
    }
    const rawQuestionScore = picked == null || forfeit ? 0 : classQuestionScore(wasCorrect || classClownVoid, playerRoll);
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
      encouragement: playbookMoveOverride === "overachiever" ? "Margins are sacred — retake applied."
        : playbookMoveOverride === "slacker" ? "Wing it — swapped HUSTLE for HEAD."
        : playbookMoveOverride === "class-clown" ? "Crack the room — question voided for everyone!"
        : playbookMoveOverride === "outsider" ? "Outside eyes — saw what others missed."
        : affinitySave
        ? "Class affinity kicked in — second chance counted."
        : forfeit ? "Time\'s up. Take a breath." : pickEncouragement(wasCorrect || classClownVoid),
      scoreMultiplier,
      scoreAward,
      classProgress,
      playerRoll,
      affinitySave,
      ...(playbookMoveOverride ? { playbookMove: playbookMoveOverride } : {}),
      ...(isTypedQuestion ? {
        answerText,
        expectedAnswer: q.expectedAnswer ?? acceptedAnswers[0] ?? null,
        answerJudge: typedJudge
          ? { mode: typedJudge.mode, score: typedJudge.score }
          : { mode: "fuzzy" as const, score: 0 },
      } : {}),
    };
    this.maybeAwardFirstBellReport(state, q, state.lastReveal, reviewAt);
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
    // Reset Outsider period move when a new daily class starts.
    if (ch.playbookId === "outsider" && ch.playbookMoves) {
      ch.playbookMoves.outsiderPeriodUsed = false;
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

    const plan = this.graduationClassPlanForState(state);
    const requiredStreak = plan.requiredDays || requiredStreakForGrade(grade);
    const streakCount = plan.dailyClasses;
    const classesMet = plan.completedRooms;
    const classCount = plan.requiredRooms;
    const classGrades = plan.classGrades;
    const streakMet = streakCount >= requiredStreak;
    const classesMetAll = classCount > 0 && classesMet >= classCount && plan.openElectiveSlots === 0;
    return {
      grade,
      requiredStreak,
      streakCount,
      streakMet,
      classesMet,
      classCount,
      classesMetAll,
      classGrades,
      ready: streakMet && classesMetAll && (ch.essayCompleted !== false || !ch.essayPrompt),
    };
  }

  private maybeMarkGradeReady(state: QuizState): boolean {
    const status = this.gradeCompletionStatus(state);
    const ch = state.character;
    if (!status || !ch || !status.ready) return false;
    const grade = status.grade;
    if (characterYearbookEntries(ch).some((y) => y.grade === grade) || state.completedGrades.includes(grade)) return false;
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
    if (characterYearbookEntries(ch).some((y) => y.grade === grade) || state.completedGrades.includes(grade)) {
      ch.pendingGraduation = null;
      state.updatedAt = Date.now();
      void this.persistSession(sessionId);
      return state;
    }

    const advance = nextGradeAfter(grade);
    const targetGrade = advance ?? grade;
    const normalizedReward = this.normalizeGraduationReward(state, ch, reward);
    const completedAt = Date.now();

    // Resolve any MASH axis whose grade just completed (and the Senior
    // bonus axes at grade 12). The full superlative list snapshots onto
    // every yearbook entry from the moment any axis resolves — earlier
    // entries see fewer lines, the Senior entry sees all of them.
    const newResolutions = this.resolveMashAxesForGrade(ch, grade);
    const superlatives = this.buildMashSuperlativesFor(ch);
    // Find the player's best teacher response for this grade to quote on the diploma.
    const essayReports = Array.isArray(state.essayReports) ? state.essayReports : [];
    const playerReports = essayReports.filter((r) => r.grade === grade && r.passed && r.comment);
    const bestTeacherResponse = playerReports.length > 0
      ? playerReports.reduce((best, r) => (r.score ?? 0) > (best.score ?? 0) ? r : best).comment
      : null;

    const diploma = gradeDiplomaCollectibleFor({
      characterName: ch.name,
      characterCreatedAt: ch.createdAt,
      grade,
      completedAt,
      teacherResponseQuote: bestTeacherResponse,
    });
    const photo = this.graduationPhotoCollectibleFor(state, ch, grade, completedAt, pending.photoImageUrl);

    ch.yearbook = characterYearbookEntries(ch);
    ch.yearbook.push({
      grade,
      completedAt,
      summary: pending.summary,
      name: ch.name,
      playbookId: ch.playbookId,
      stats: { ...ch.stats },
      ...(ch.portraitDataUrl ? { portraitDataUrl: ch.portraitDataUrl } : {}),
      ...(ch.flavorQuote ? { flavorQuote: ch.flavorQuote } : {}),
      arcAnswer: ch.arcAnswer,
      ...(ch.subjectScores ? { subjectScores: { ...ch.subjectScores } } : {}),
      graduationReward: normalizedReward,
      diploma,
      photo,
      ...(superlatives.length > 0 ? { superlatives } : {}),
    });
    if (newResolutions.length > 0) {
      const schoolEventAt = completedAt;
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
    this.recordShareArtifactCreated(state.sessionId, {
      shareId: yearbookShareId({
        sessionId: state.sessionId,
        source: "current-character",
        name: ch.name,
        createdAt: ch.createdAt,
      }),
      grade,
      kind: "yearbook_card",
    });

    this.applyGraduationReward(ch, normalizedReward, targetGrade);
    ch.levelUps = ch.levelUps ?? [];
    ch.levelUps.push({
      completedGrade: grade,
      targetGrade: advance,
      reward: normalizedReward,
      awardedAt: completedAt,
    });
    ch.pendingGraduation = null;

    if (advance) {
      state.currentGrade = advance;
      this.ensureRoster(state, advance);
      ch.streak = { grade: advance, count: 0 };
      // Assign the essay question for the new grade. The teacher will
      // give it as an assignment and reference it during lessons.
      ch.essayPrompt = gradeEssayPrompt(advance, ch);
      ch.essayCompleted = false;
      log.event("player.grade-advanced", {
        sessionId: state.sessionId, character: ch.name, fromGrade: grade, toGrade: advance, reward: normalizedReward.kind,
      });
      this.maybePostXMilestone({
        kind: "grade-advanced",
        characterName: ch.name,
        fromGrade: grade,
        toGrade: advance,
      }, state);
    } else {
      this.archiveCompletedCharacter(state, ch);
      log.event("player.graduated", {
        sessionId: state.sessionId, character: ch.name, reward: normalizedReward.kind,
      });
      this.maybePostXMilestone({
        kind: "graduated",
        characterName: ch.name,
        grade,
        arcAnswer: ch.arcAnswer,
      }, state);
    }

    this.transition(state, { kind: "clear-board" });
    this.discardBoardForFaculty(state, state.faculty);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  private graduationPhotoCollectibleFor(
    state: QuizState,
    ch: PlayerCharacter,
    grade: Grade,
    completedAt: number,
    imageUrl?: string,
  ): GraduationPhotoCollectible {
    const teacher = this.topGraduationTeacherFor(state, grade);
    const student = this.topSocialStudentFor(ch);
    const label = DIPLOMA_GRADE_LABELS[grade] ?? `Grade ${grade}`;
    return {
      kind: "graduation-photo",
      id: graduationCollectibleId("photo", {
        name: ch.name,
        createdAt: ch.createdAt,
        grade,
        completedAt,
        extra: `${teacher.id}:${student.id}`,
      }),
      grade,
      title: `${label} Graduation Photo`,
      description: `${ch.name} with ${teacher.name} and ${student.name} at Ruby High.`,
      ...(imageUrl ? { imageUrl } : {}),
      issuedAt: completedAt,
      teacher,
      student,
    };
  }

  private topGraduationTeacherFor(
    state: QuizState,
    grade: Grade,
  ): GraduationPhotoCollectible["teacher"] {
    const records = (state.character ? characterDailyClassRecords(state.character) : [])
      .filter((record) => record.grade === grade && record.status === "complete");
    const byFaculty = new Map<string, {
      facultyId: string;
      scoreTotal: number;
      questionCount: number;
      correctCount: number;
      completedCount: number;
      latestCompletedAt: number;
    }>();
    for (const record of records) {
      const current = byFaculty.get(record.facultyId) ?? {
        facultyId: record.facultyId,
        scoreTotal: 0,
        questionCount: 0,
        correctCount: 0,
        completedCount: 0,
        latestCompletedAt: 0,
      };
      current.scoreTotal += record.scoreTotal;
      current.questionCount += record.questionCount;
      current.correctCount += record.correctCount;
      current.completedCount += 1;
      current.latestCompletedAt = Math.max(current.latestCompletedAt, Number(record.completedAt || record.updatedAt || 0));
      byFaculty.set(record.facultyId, current);
    }
    const selectedOrder = this.graduationClassSelectionForState(state).selected;
    const orderIndex = (facultyId: string): number => {
      const selected = selectedOrder.indexOf(facultyId);
      if (selected >= 0) return selected;
      const core = CORE_GRADUATION_FACULTY_ORDER.indexOf(facultyId as typeof CORE_GRADUATION_FACULTY_ORDER[number]);
      return core >= 0 ? 20 + core : 100;
    };
    const ranked = [...byFaculty.values()].sort((a, b) => {
      const aAverage = a.questionCount > 0 ? a.scoreTotal / a.questionCount : -1;
      const bAverage = b.questionCount > 0 ? b.scoreTotal / b.questionCount : -1;
      if (bAverage !== aAverage) return bAverage - aAverage;
      const aCorrect = a.questionCount > 0 ? a.correctCount / a.questionCount : -1;
      const bCorrect = b.questionCount > 0 ? b.correctCount / b.questionCount : -1;
      if (bCorrect !== aCorrect) return bCorrect - aCorrect;
      if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount;
      if (b.latestCompletedAt !== a.latestCompletedAt) return b.latestCompletedAt - a.latestCompletedAt;
      return orderIndex(a.facultyId) - orderIndex(b.facultyId);
    });
    const fallbackFacultyId = selectedOrder[0] ?? state.faculty ?? RUBY_FACULTY.id;
    const facultyId = ranked[0]?.facultyId ?? fallbackFacultyId;
    const faculty = facultyByIdForSession(state, facultyId);
    return {
      id: facultyId,
      name: faculty?.shortName || faculty?.displayName || facultyId,
      ...(teacherPortraitUrl(facultyId, faculty?.assetTeacherId, faculty?.profileImageUrl)
        ? { imageUrl: teacherPortraitUrl(facultyId, faculty?.assetTeacherId, faculty?.profileImageUrl) }
        : {}),
    };
  }

  private topSocialStudentFor(ch: PlayerCharacter): GraduationPhotoCollectible["student"] {
    const card = ensureMashCard(ch.mashCard);
    const students = listStudents();
    const ranked = students
      .map((student, index) => ({ student, index, cell: card.cells[student.id] }))
      .sort((a, b) => {
        const aCell = a.cell;
        const bCell = b.cell;
        const aUsable = aCell && !aCell.scratched ? 1 : 0;
        const bUsable = bCell && !bCell.scratched ? 1 : 0;
        if (bUsable !== aUsable) return bUsable - aUsable;
        const aCircled = aCell?.circled ? 1 : 0;
        const bCircled = bCell?.circled ? 1 : 0;
        if (bCircled !== aCircled) return bCircled - aCircled;
        const aAffinity = aCell?.affinity ?? 0;
        const bAffinity = bCell?.affinity ?? 0;
        if (bAffinity !== aAffinity) return bAffinity - aAffinity;
        const aTicks = aCell?.ticks ?? 0;
        const bTicks = bCell?.ticks ?? 0;
        if (bTicks !== aTicks) return bTicks - aTicks;
        const aTouched = aCell?.lastTouchedDate ?? "";
        const bTouched = bCell?.lastTouchedDate ?? "";
        if (bTouched !== aTouched) return bTouched.localeCompare(aTouched);
        return a.index - b.index;
      });
    const pick = ranked[0]?.student ?? students[0]!;
    return {
      id: pick.id,
      name: pick.shortName || pick.name,
      imageUrl: studentPortraitUrl(pick.id),
    };
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
    if (reward.kind === "photo") {
      return { kind: "photo" };
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
    if (reward.kind === "photo") return;
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
  /** Replace a graduated NPC with a random player-created character.
   *  The new student enters as a Freshman (grade 9) with stats derived
   *  from their playbook. Over time, the classroom fills with real players. */
  private replaceGraduatedNpc(state: QuizState, graduatedNpcId: string): void {
    if (!state.npcCohort) return;
    const existingIds = new Set(state.npcCohort.map((n) => n.id));
    const candidates: Array<{ name: string; playbookId: string; stats: CharacterStats; sessionId: string }> = [];
    for (const [, s] of this.sessions) {
      const ch = s.character;
      if (!ch?.portraitDataUrl) continue;
      if (existingIds.has(ch.name)) continue;
      if (isSyntheticCharacterName(ch.name)) continue;
      candidates.push({
        name: ch.name,
        playbookId: ch.playbookId,
        stats: { ...ch.stats },
        sessionId: s.sessionId,
      });
    }
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    const newId = `player:${pick.sessionId}`;
    // Add cohort arc entry.
    state.npcCohort.push({
      id: newId,
      grade: "9",
      streak: { grade: "9", count: 0 },
      completedGrades: [],
      graduated: false,
    });
    // Add roster entry for Freshman classrooms.
    let roster = state.npcRosters["9"];
    if (!roster) {
      roster = initialNpcRoster("9");
      state.npcRosters["9"] = roster;
    }
    roster.push({
      id: newId,
      name: pick.name,
      currentRoom: null,
      stats: pick.stats,
      grade: "9",
    });
    log.event("npc.replaced", {
      sessionId: state.sessionId,
      graduatedNpcId,
      newStudentId: newId,
      newStudentName: pick.name,
    });
  }

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
        // Replace graduated NPC with a random player character as a freshman.
        this.replaceGraduatedNpc(state, npc.id);
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

  /**
   * Randomize A/B/C/D order every time a question is posed, so the correct
   * slot is never a learnable tell. The stored bank order (and any author bias
   * toward "B", or the LLM's habit of writing the right answer first) becomes
   * irrelevant because the student sees a fresh permutation each view. Grading
   * reads state.current.correct, which we remap here, so the shuffle stays
   * self-consistent. The correct option is tracked by identity, not text, so it
   * survives even if two options share wording. A new options object is built
   * rather than mutating in place, so a question that still references the
   * shared in-memory bank object is never corrupted.
   *
   * Gated by RUBY_HIGH_SHUFFLE_CHOICES (default on; set to "0" under test for a
   * deterministic stored order — see vitest.config.ts and choice-shuffle.test.ts).
   */
  private shuffleQuestionChoices(question: Question): void {
    if (process.env.RUBY_HIGH_SHUFFLE_CHOICES === "0") return;
    if (question.type !== "multiple-choice" || !question.options || !question.correct) return;
    const items = CHOICES.map((slot) => ({
      text: question.options![slot] ?? "",
      isCorrect: slot === question.correct,
    }));
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    const options = {} as Record<Choice, string>;
    let correct: Choice = question.correct;
    items.forEach((item, index) => {
      const slot = CHOICES[index]!;
      options[slot] = item.text;
      if (item.isCorrect) correct = slot;
    });
    question.options = options;
    question.correct = correct;
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
    this.shuffleQuestionChoices(question);
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
    this.shuffleQuestionChoices(question);
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
      // Heart playbook: at most one NPC per round gets a pep-talk re-roll.
      let pepTalkUsed = false;
      const isHeart = state.character?.playbookId === "heart";
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
        const correctAnswer = question.correct ?? "A";
        const questionStat = statForQuestion(question);
        let r = rollNpcAnswer(npc.stats, correctAnswer, questionStat);
        // Heart: pep talk — give one classmate per round a re-roll on a miss.
        if (isHeart && !pepTalkUsed && (r.outcome === "miss" || r.pick !== correctAnswer)) {
          const r2 = rollNpcAnswer(npc.stats, correctAnswer, questionStat);
          // Take the better of the two rolls (prefer the one with the correct pick).
          if (r2.pick === correctAnswer && r.pick !== correctAnswer) {
            r = r2;
          } else if (r2.outcome !== "miss" && r.outcome === "miss") {
            r = r2;
          }
          pepTalkUsed = true;
        }
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
      this.appendAnswerHistory(state, record);
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
      state.character && (state.character.essayCompleted = true);
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
      prompt: "When a classmate gives an answer confidently, what is one sign you should trust it, and one sign you should check it?",
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
    const earlyQuestionBias = !filter.difficulty && !importedReviewCourse && this.firstBellQuestionBiasApplies(state);
    const difficultyWeights = !filter.difficulty && state.currentGrade && !importedReviewCourse
      ? earlyQuestionBias ? FIRST_BELL_DIFFICULTY_WEIGHTS : difficultyWeightsForGrade(state.currentGrade)
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

  graduationGate(sessionId: string): GraduationGateProgress {
    return this.graduationClassPlanForState(this.getOrCreate(sessionId));
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
    this.contributeLiveRoomGoal(sessionId);
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
    this.contributeLiveRoomGoal(sessionId);
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
        throw new Error("AI key required to generate multiple-choice distractors.");
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
    const firstCompletion = characterYearbookEntries(ch)[0]?.completedAt ?? Date.now();
    const seed = created > 0 ? created : firstCompletion;
    const name = ch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "student";
    const playbook = ch.playbookId.replace(/[^a-z0-9-]+/gi, "-").slice(0, 32) || "playbook";
    return `student_${seed}_${name}_${playbook}`;
  }

  private archiveCompletedCharacter(state: QuizState, ch: PlayerCharacter): StudentPoolEntry | null {
    const yearbook = characterYearbookEntries(ch);
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
      ...(characterArrayField(ch, "classPhotos").length ? { classPhotos: characterArrayField(ch, "classPhotos").map((p) => ({ ...p })) } : {}),
      yearbook: yearbook.map((y) => ({ ...y, stats: y.stats ? { ...y.stats } : undefined })),
      ...(characterArrayField(ch, "levelUps").length ? { levelUps: characterArrayField(ch, "levelUps").map((l) => ({ ...l, reward: { ...l.reward } })) } : {}),
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
      socialConsent: true,
      // Lifer: starts ahead with one bonus advantage roll per grade.
      ...(input.playbookId === "lifer" ? {
        advantageRollBonuses: { "9": 1, "10": 1, "11": 1, "12": 1 } as Partial<Record<Grade, number>>,
      } : {}),

      createdAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("character.created", {
      sessionId, characterName: name, playbookId: input.playbookId, mentorAccepted: !!inheritedFrom,
    });
    this.maybePostXMilestone({
      kind: "character-created",
      characterName: name,
      flavorQuote: flavorQuote ?? undefined,
    }, state);
    this.recordFunnelStep(state, "first_character_created", {
      characterName: name,
      playbookId: input.playbookId,
      mentorAccepted: !!inheritedFrom,
    });
    return state;
  }

  /** Update an autosaved character candidate while preserving live career
   *  progress. Used by the creation sheet after the first background create. */
  updateCharacter(
    sessionId: string,
    input: { name: string; playbookId: string; stats: CharacterStats; arcAnswer: string; flavorQuote?: string; personality: string; portraitDataUrl?: string },
  ): QuizState {
    const state = this.getOrCreate(sessionId);
    const existing = state.character;
    if (!existing) throw new Error("No character to update.");
    const name = input.name.trim();
    if (!name) throw new Error("Name is required.");
    const flavorQuote = input.flavorQuote?.trim();
    const next: PlayerCharacter = {
      ...existing,
      name,
      playbookId: input.playbookId,
      stats: { ...input.stats },
      arcAnswer: input.arcAnswer.trim(),
      personality: input.personality.trim(),
    };
    if (flavorQuote) next.flavorQuote = flavorQuote;
    else delete next.flavorQuote;
    if (input.portraitDataUrl != null) {
      const portraitDataUrl = normalizeStoredImageRef(input.portraitDataUrl, "portraitDataUrl");
      if (portraitDataUrl) next.portraitDataUrl = portraitDataUrl;
    }
    if (existing.playbookId !== input.playbookId) {
      if (existing.playbookId === "lifer") {
        const bonuses = { ...(next.advantageRollBonuses ?? {}) };
        for (const grade of GRADES) {
          const reduced = Math.max(0, Math.floor(Number(bonuses[grade] ?? 0)) - 1);
          if (reduced > 0) bonuses[grade] = reduced;
          else delete bonuses[grade];
        }
        if (Object.keys(bonuses).length > 0) next.advantageRollBonuses = bonuses;
        else delete next.advantageRollBonuses;
      }
      if (input.playbookId === "lifer") {
        const bonuses = { ...(next.advantageRollBonuses ?? {}) };
        for (const grade of GRADES) {
          bonuses[grade] = Math.max(0, Math.floor(Number(bonuses[grade] ?? 0))) + 1;
        }
        next.advantageRollBonuses = bonuses;
      }
    }
    state.character = next;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("character.updated", {
      sessionId,
      characterName: name,
      playbookId: input.playbookId,
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
    // Enqueue for daily photo reveal lottery (Ruby tweets it, then it appears).
    // The portrait is NOT visible in the yearbook until the photo is revealed.
    this.enqueuePhotoReveal(sessionId, "portrait", stored, "ruby");
    // Check if we should post a daily photo right now.
    queueMicrotask(() => this.maybePostDailyPhoto());
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  setDiplomaImage(sessionId: string, diplomaImageDataUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character to attach diploma to.");
    const stored = normalizeStoredImageRef(diplomaImageDataUrl, "diplomaImageDataUrl");
    if (!stored) throw new Error("diplomaImageDataUrl is required.");
    // Determine which teacher gets the diploma tweet: the one whose class
    // the student scored highest in, or Ruby as fallback.
    const topTeacher = this.topGraduationTeacherFor(state, state.currentGrade ?? "9");
    const teacherId = topTeacher?.id ?? "ruby";
    this.enqueuePhotoReveal(sessionId, "diploma", stored, teacherId);
    queueMicrotask(() => this.maybePostDailyPhoto());
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Store an AI-generated yearbook card image URL on a completed grade. */
  setYearbookImage(sessionId: string, grade: string, imageUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character on this session.");
    state.character.yearbook = characterYearbookEntries(state.character);
    const entry = state.character.yearbook.find((y) => y.grade === grade);
    if (!entry) throw new Error("No yearbook entry for grade " + grade + ".");
    entry.yearbookImageUrl = imageUrl;
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
    if (prev && characterYearbookEntries(prev).length >= 4) {
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

  // ── Photo reveal queue ────────────────────────────────────────────────

  /** Enqueue a photo for later reveal via teacher X post.
   *  The photo is already uploaded to S3; this just stages it for the
   *  daily photo lottery. Returns the photoId. */
  enqueuePhotoReveal(
    sessionId: string,
    kind: PendingPhotoReveal["kind"],
    imageUrl: string,
    teacherFacultyId: string,
  ): string {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) throw new Error("No character to enqueue photo for.");
    const photoId = `photo:${state.sessionId}:${kind}:${Date.now().toString(36)}`;
    const photo: PendingPhotoReveal = {
      photoId,
      kind,
      imageUrl,
      teacherFacultyId,
      earnedAt: Date.now(),
    };
    ch.pendingPhotos = ch.pendingPhotos ?? [];
    ch.pendingPhotos.push(photo);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return photoId;
  }

  enqueueClassPhotoReveal(
    teacherFacultyId: string,
    imageUrl: string,
    candidates: readonly ClassPhotoCandidate[],
  ): string | null {
    for (const candidate of candidates) {
      if (!this.isClassPhotoRevealTarget(candidate.sessionId)) continue;
      return this.enqueuePhotoReveal(candidate.sessionId, "class-photo", imageUrl, teacherFacultyId);
    }
    return null;
  }

  hasClassPhotoRevealTarget(candidates: readonly ClassPhotoCandidate[]): boolean {
    return candidates.some((candidate) => this.isClassPhotoRevealTarget(candidate.sessionId));
  }

  private isClassPhotoRevealTarget(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    const ch = state?.character;
    if (!ch) return false;
    if (!characterAllowsSocialSharing(ch)) return false;
    if (isSyntheticCharacterName(ch.name)) return false;
    return true;
  }

  /** Reveal a photo after the teacher tweeted it (or as an immediate
   *  fallback when no teacher is connected). Moves the image into the
   *  character's permanent fields and updates the yearbook. */
  revealPhoto(sessionId: string, photoId: string, tweetId?: string): void {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch?.pendingPhotos) return;
    const idx = ch.pendingPhotos.findIndex((p) => p.photoId === photoId);
    if (idx === -1) return;
    const photo = ch.pendingPhotos[idx]!;
    ch.pendingPhotos.splice(idx, 1);
    if (tweetId) {
      photo.tweetId = tweetId;
      photo.tweetedAt = Date.now();
    }
    // Write the image to the character's permanent fields.
    switch (photo.kind) {
      case "portrait":
        ch.portraitDataUrl = photo.imageUrl;
        break;
      case "diploma":
        ch.diplomaImageDataUrl = photo.imageUrl;
        break;
      case "graduation":
        ch.diplomaImageDataUrl = photo.imageUrl;
        break;
      case "class-photo":
        this.archiveClassPhoto(ch, photo);
        break;
    }
    this.archiveCompletedCharacter(state, ch);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    log.event("photo.revealed", {
      sessionId,
      character: ch.name,
      photoId,
      kind: photo.kind,
      ...(tweetId ? { tweetId } : { fallback: true }),
    });
  }

  private archiveClassPhoto(ch: PlayerCharacter, photo: PendingPhotoReveal): void {
    const entry: ClassPhotoArchive = {
      photoId: photo.photoId,
      imageUrl: photo.imageUrl,
      teacherFacultyId: photo.teacherFacultyId,
      earnedAt: photo.earnedAt,
      revealedAt: Date.now(),
      ...(photo.tweetId ? { tweetId: photo.tweetId } : {}),
      ...(photo.tweetedAt ? { tweetedAt: photo.tweetedAt } : {}),
    };
    const history = Array.isArray(ch.classPhotos) ? [...ch.classPhotos] : [];
    const existing = history.findIndex((item) => item.photoId === entry.photoId);
    if (existing >= 0) history[existing] = entry;
    else history.push(entry);
    history.sort((a, b) => a.revealedAt - b.revealedAt || a.photoId.localeCompare(b.photoId));
    ch.classPhotos = history.slice(-CLASS_PHOTO_HISTORY_LIMIT);
  }

  /** Called on viewer loads and milestone events. If the configured photo
   *  teacher hasn't posted a photo today and there are pending photos in
   *  the pool, picks one at random and posts it. Admin-triggered class photo
   *  posts can pass a photoId so the button posts the image it just made. */
  async maybePostDailyPhoto(opts: { photoId?: string } = {}): Promise<DailyPhotoPostResult | null> {
    if (!this.runtime || typeof (this.runtime as any).getService !== "function") return null;
    const xSocial = (this.runtime as any).getService(XSocialService.serviceType) as XSocialService | undefined;
    if (!xSocial) return null;
    // Gather pending photos that are allowed to leave the private session.
    const allPhotos: { sessionId: string; photo: PendingPhotoReveal }[] = [];
    for (const [sid, state] of this.sessions) {
      const ch = state.character;
      if (!ch) continue;
      for (const p of characterArrayField(ch, "pendingPhotos")) {
        if (!this.isPostablePendingPhoto(ch, p)) continue;
        allPhotos.push({ sessionId: sid, photo: p });
      }
    }
    if (allPhotos.length === 0) return null;
    const targetPhotoId = typeof opts.photoId === "string" && opts.photoId ? opts.photoId : null;

    // Fallback: if this photo's teacher is not connected to X, auto-reveal it
    // immediately so one connected teacher cannot block another class's yearbook.
    const fallbackPhotos = allPhotos.filter(({ photo }) =>
      !xSocial.getStatus(photo.teacherFacultyId).connected &&
      (!targetPhotoId || photo.photoId === targetPhotoId)
    );
    if (fallbackPhotos.length > 0) {
      for (const { sessionId: sid, photo: p } of fallbackPhotos) {
        this.revealPhoto(sid, p.photoId);
      }
      const revealed = fallbackPhotos[0] ?? null;
      if (!revealed) return null;
      this.recordPhotoPostAttempt();
      return this.recordPhotoPostResult({
        photoId: revealed.photo.photoId,
        sessionId: revealed.sessionId,
        kind: revealed.photo.kind,
        teacherFacultyId: revealed.photo.teacherFacultyId,
        posted: false,
        revealed: true,
        fallback: true,
      });
    }

    // One or more teachers are connected. Filter to photos whose teacher
    // is connected, then pick one at random.
    const eligible = allPhotos.filter((e) => xSocial.getStatus(e.photo.teacherFacultyId).connected);
    if (eligible.length === 0) return null;
    const now = Date.now();
    let clearedDeferredRetry = false;
    const ready = eligible.filter((e) => {
      if (this.pendingPhotoPosts.has(e.photo.photoId)) return false;
      const retryAt = this.deferredPhotoPosts.get(e.photo.photoId) ?? 0;
      if (retryAt > now) return false;
      if (retryAt > 0) {
        this.deferredPhotoPosts.delete(e.photo.photoId);
        clearedDeferredRetry = true;
      }
      return true;
    });
    if (clearedDeferredRetry) void this.persistPhotoPostSchedulerState();
    if (ready.length === 0) return null;
    const pick = targetPhotoId
      ? ready.find((e) => e.photo.photoId === targetPhotoId)
      : ready[Math.floor(Math.random() * ready.length)];
    if (!pick) return null;
    const teacher = teacherById(pick.photo.teacherFacultyId);
    if (!teacher) return null;
    this.pendingPhotoPosts.add(pick.photo.photoId);
    this.recordPhotoPostAttempt();
    const ctx: XMilestoneContext = {
      kind: pick.photo.kind === "portrait" ? "portrait-set"
          : pick.photo.kind === "diploma" ? "diploma-earned"
          : pick.photo.kind === "class-photo" ? "class-photo"
          : "graduated",
      characterName: this.sessions.get(pick.sessionId)?.character?.name ?? "A student",
      imageUrl: pick.photo.imageUrl,
      portraitUrl: pick.photo.kind === "portrait" ? pick.photo.imageUrl : undefined,
      diplomaUrl: pick.photo.kind === "diploma" ? pick.photo.imageUrl : undefined,
      reserveDailyPhotoSlot: true,
    };
    try {
      const tweetId = await xSocial.maybePostMilestone(teacher, ctx);
      if (tweetId) {
        this.deferredPhotoPosts.delete(pick.photo.photoId);
        this.revealPhoto(pick.sessionId, pick.photo.photoId, tweetId);
        return this.recordPhotoPostResult({
          photoId: pick.photo.photoId,
          sessionId: pick.sessionId,
          kind: pick.photo.kind,
          teacherFacultyId: pick.photo.teacherFacultyId,
          posted: true,
          revealed: true,
          tweetId,
        });
      } else {
        const deferredUntil = Date.now() + PHOTO_POST_RETRY_DELAY_MS;
        this.deferredPhotoPosts.set(pick.photo.photoId, deferredUntil);
        return this.recordPhotoPostResult({
          photoId: pick.photo.photoId,
          sessionId: pick.sessionId,
          kind: pick.photo.kind,
          teacherFacultyId: pick.photo.teacherFacultyId,
          posted: false,
          revealed: false,
          deferredUntil,
        });
      }
    } catch {
      const deferredUntil = Date.now() + PHOTO_POST_RETRY_DELAY_MS;
      this.deferredPhotoPosts.set(pick.photo.photoId, deferredUntil);
      return this.recordPhotoPostResult({
        photoId: pick.photo.photoId,
        sessionId: pick.sessionId,
        kind: pick.photo.kind,
        teacherFacultyId: pick.photo.teacherFacultyId,
        posted: false,
        revealed: false,
        deferredUntil,
      });
    } finally {
      this.pendingPhotoPosts.delete(pick.photo.photoId);
    }
  }

  /** Collect today's school memories across all sessions. Returns a
   *  summary suitable for a teacher to compose a reflective post from. */
  getDailyMemories(): DailyMemories {
    const today = new Date().toISOString().slice(0, 10);
    const memories: DailyMemories = {
      date: today,
      charactersCreated: [],
      classesPassed: [],
      gradesAdvanced: [],
      graduations: [],
      totalStudents: 0,
      totalQuestionsAnswered: 0,
    };
    for (const [, state] of this.sessions) {
      const ch = state.character;
      if (!ch) continue;

      // Skip private, blank-name, smoke-test, and auto-generated characters.
      if (!characterAllowsPublicSharing(ch)) continue;
      memories.totalStudents += 1;
      // Characters created today.
      if (ch.createdAt) {
        const createdDate = new Date(ch.createdAt).toISOString().slice(0, 10);
        if (createdDate === today && memories.charactersCreated.length < DAILY_MEMORY_DETAIL_LIMIT) {
          memories.charactersCreated.push(ch.name);
        }
      }
      // Daily classes passed today.
      for (const record of characterDailyClassRecords(ch)) {
        if (record.status === "complete" && record.completedAt) {
          const completedDate = new Date(record.completedAt).toISOString().slice(0, 10);
          if (
            completedDate === today &&
            letterGradePasses(record.letterGrade ?? "") &&
            memories.classesPassed.length < DAILY_MEMORY_DETAIL_LIMIT
          ) {
            memories.classesPassed.push({
              studentName: ch.name,
              facultyId: record.facultyId,
              letterGrade: record.letterGrade ?? "?",
            });
          }
        }
        memories.totalQuestionsAnswered += record.questionCount ?? 0;
      }
      // Grade advancements today (check levelUps).
      for (const lu of characterArrayField(ch, "levelUps")) {
        const awardedDate = new Date(lu.awardedAt).toISOString().slice(0, 10);
        if (awardedDate === today && memories.gradesAdvanced.length < DAILY_MEMORY_DETAIL_LIMIT) {
          memories.gradesAdvanced.push({
            studentName: ch.name,
            fromGrade: lu.completedGrade,
            toGrade: lu.targetGrade ?? "graduated",
          });
        }
      }
      // Graduations today (yearbook entries with today's date).
      for (const entry of characterArrayField(ch, "yearbook")) {
        const completedDate = new Date(entry.completedAt).toISOString().slice(0, 10);
        if (completedDate === today && entry.grade === "12" && memories.graduations.length < DAILY_MEMORY_DETAIL_LIMIT) {
          memories.graduations.push(ch.name);
        }
      }
    }
    return memories;
  }

  /** Total number of pending photos across all sessions. Used by the
   *  viewer to show queue depth without exposing individual photos. */
  pendingPhotoPoolSize(): number {
    let count = 0;
    for (const [, state] of this.sessions) {
      const ch = state.character;
      if (!ch) continue;
      const pendingPhotos = characterArrayField(ch, "pendingPhotos");
      if (!pendingPhotos.length) continue;
      for (const photo of pendingPhotos) {
        if (this.isPostablePendingPhoto(ch, photo)) count += 1;
      }
    }
    return count;
  }

  private isPostablePendingPhoto(ch: PlayerCharacter, photo: PendingPhotoReveal): boolean {
    if (!characterAllowsPublicSharing(ch)) return false;
    if (photo.kind === "class-photo") return true;
    return characterDailyClassRecords(ch).some((record) => record.status === "complete");
  }

  /** Recently active students, ranked by grade performance.
   *  Returns top 3 per year (Freshman/Sophomore/Junior/Senior). */
  getRecentlyActiveStudents(now = Date.now()): RecentlyActiveStudent[] {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const byGrade = new Map<string, RecentlyActiveStudent[]>();

    for (const { state, ch, lastActive } of this.publicSchoolWorldEntries(now, weekMs)) {
      const classGrades: Record<string, string> = {};
      for (const record of characterDailyClassRecords(ch)) {
        if (record.status === "complete" && record.letterGrade) {
          classGrades[record.facultyId] = record.letterGrade;
        }
      }
      const student: RecentlyActiveStudent = {
        sessionId: state.sessionId,
        name: ch.name,
        playbookId: ch.playbookId,
        grade: state.currentGrade ?? "9",
        stats: { ...ch.stats },
        classGrades,
        yearbookCount: characterArrayField(ch, "yearbook").length,
        lastActive,
        portraitUrl: ch.portraitDataUrl ?? undefined,
      };
      const g = student.grade;
      if (!byGrade.has(g)) byGrade.set(g, []);
      byGrade.get(g)!.push(student);
    }

    // Take top 3 per year, sorted: portraits first, then grade score.
    const results: RecentlyActiveStudent[] = [];
    for (const [grade, students] of byGrade) {
      students.sort((a, b) => {
        const aPortrait = a.portraitUrl ? 1 : 0;
        const bPortrait = b.portraitUrl ? 1 : 0;
        if (aPortrait !== bPortrait) return bPortrait - aPortrait;
        return this.gradeScore(b) - this.gradeScore(a);
      });
      results.push(...students.slice(0, 3));
    }
    // Sort results by grade, then by score within grade.
    results.sort((a, b) => {
      const gd = Number(a.grade) - Number(b.grade);
      if (gd !== 0) return gd;
      return this.gradeScore(b) - this.gradeScore(a);
    });
    return results;
  }

  getClassPhotoCandidates(limit = 8, now = Date.now()): ClassPhotoCandidate[] {
    return this.getRecentlyActiveStudents(now)
      .filter((student) => !!student.portraitUrl)
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((student) => ({
        sessionId: student.sessionId,
        name: student.name,
        imageUrl: student.portraitUrl!,
        grade: student.grade,
      }));
  }

  async getFreshRecentlyActiveStudents(now = Date.now()): Promise<RecentlyActiveStudent[]> {
    await this.refreshWorldSessionsFromStore(now);
    return this.getRecentlyActiveStudents(now);
  }

  async getFreshClassPhotoCandidates(limit = 8, now = Date.now()): Promise<ClassPhotoCandidate[]> {
    await this.refreshWorldSessionsFromStore(now);
    return this.getClassPhotoCandidates(limit, now);
  }

  /** Full school snapshot — the data feed for bots (X, Telegram, etc.).
   *  Returns top students per year, photo queue, student of the day, and
   *  daily memories in a single call. */
  getSchoolSnapshot(now = Date.now()): SchoolSnapshot {
    const top = this.getRecentlyActiveStudents(now);
    const byYear: Record<string, RecentlyActiveStudent[]> = {};
    for (const s of top) {
      if (!byYear[s.grade]) byYear[s.grade] = [];
      byYear[s.grade]!.push(s);
    }
    // Photo pool: pending photos eligible for teacher social posting.
    const photoPool: SchoolSnapshotPhoto[] = [];
    const classPhotoHistory: SchoolSnapshotClassPhoto[] = [];
    for (const [, state] of this.sessions) {
      const ch = state.character;
      if (!ch) continue;
      for (const p of characterArrayField(ch, "pendingPhotos")) {
        if (!this.isPostablePendingPhoto(ch, p)) continue;
        photoPool.push({
          studentName: ch.name,
          kind: p.kind,
          teacherFacultyId: p.teacherFacultyId,
          earnedAt: p.earnedAt,
        });
      }
      if (!characterAllowsPublicSharing(ch)) continue;
      for (const p of characterArrayField(ch, "classPhotos")) {
        classPhotoHistory.push({
          studentName: ch.name,
          teacherFacultyId: p.teacherFacultyId,
          earnedAt: p.earnedAt,
          revealedAt: p.revealedAt,
          status: p.tweetId ? "posted" : "revealed",
          ...(p.tweetId ? { tweetId: p.tweetId } : {}),
          ...(p.tweetedAt ? { tweetedAt: p.tweetedAt } : {}),
        });
      }
    }
    photoPool.sort((a, b) => a.earnedAt - b.earnedAt);
    if (photoPool.length > SCHOOL_SNAPSHOT_PHOTO_POOL_LIMIT) {
      photoPool.length = SCHOOL_SNAPSHOT_PHOTO_POOL_LIMIT;
    }
    classPhotoHistory.sort((a, b) => b.revealedAt - a.revealedAt || a.studentName.localeCompare(b.studentName));
    if (classPhotoHistory.length > SCHOOL_SNAPSHOT_CLASS_PHOTO_HISTORY_LIMIT) {
      classPhotoHistory.length = SCHOOL_SNAPSHOT_CLASS_PHOTO_HISTORY_LIMIT;
    }
    return {
      topByYear: byYear,
      photoPool,
      classPhotoHistory,
      dailyMemories: this.getDailyMemories(),
    };
  }

  async getFreshSchoolSnapshot(now = Date.now()): Promise<SchoolSnapshot> {
    await this.refreshWorldSessionsFromStore(now);
    return this.getSchoolSnapshot(now);
  }

  contributeLiveRoomGoal(sessionId: string, now = Date.now()): LiveRoomGoalContributionResult | null {
    const state = this.getOrCreate(sessionId);
    const ch = state.character;
    const grade = state.currentGrade;
    if (!ch || !grade || !characterAllowsPublicSharing(ch)) return null;
    const facultyId = state.faculty;
    const faculty = facultyForSession(state).find((item) => item.id === facultyId);
    const displayName = faculty?.displayName ?? facultyId;
    const publicSessionId = publicWorldSessionId(state.sessionId);
    if (!publicSessionId) return null;
    const day = new Date(now).toISOString().slice(0, 10);
    const key = this.liveRoomGoalStateKey(grade, facultyId, day);
    let goal = this.liveRoomGoalStates.get(key);
    if (!goal) {
      const rule = this.liveRoomGoalRule(grade, now);
      goal = {
        grade,
        facultyId,
        displayName,
        day,
        target: rule.target,
        ...(rule.ruleLabel ? { ruleLabel: rule.ruleLabel } : {}),
        contributors: new Set<string>(),
        startedAt: 0,
        updatedAt: 0,
      };
      this.liveRoomGoalStates.set(key, goal);
    }
    const duplicate = goal.contributors.has(publicSessionId);
    if (!duplicate) {
      goal.contributors.add(publicSessionId);
      if (goal.startedAt <= 0) goal.startedAt = now;
      goal.updatedAt = now;
      void this.persistLiveRoomGoalState({}, now);
    }
    const target = Math.max(1, Math.floor(Number(goal.target) || 3));
    const progress = Math.min(target, goal.contributors.size);
    if (!duplicate && progress >= target) {
      this.recordPublicWorldRoomOutcome(goal, progress, target, now);
    }
    const bonusLabel = liveRoomGoalBonusLabel(goal, progress, target, now);
    return {
      grade,
      facultyId,
      displayName,
      progress,
      target,
      complete: progress >= target,
      updatedAt: goal.updatedAt,
      duplicate,
      ...(goal.ruleLabel ? { ruleLabel: goal.ruleLabel } : {}),
      ...(bonusLabel ? { bonusLabel } : {}),
    };
  }

  getSchoolWorldSnapshot(limit = 30, now = Date.now()): SchoolWorldSnapshot {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const eventLimit = Number.isFinite(limit) ? Math.max(0, Math.min(SCHOOL_WORLD_RECENT_EVENT_LIMIT, Math.floor(limit))) : 30;
    const publicEntries = this.publicSchoolWorldEntries(now, weekMs);
    const presence = publicEntries.map((entry) => this.publicWorldPresenceFromEntry(entry));
    const rooms = buildPublicWorldRooms(presence, 5, 24, this.liveRoomGoalContributionsForWorld(now));
    this.clampPublicWorldRoomGoalTimes(rooms.activeRooms, now);
    this.syncPublicWorldRoomRecords(rooms.activeRooms, now);
    const cohorts = buildPublicWorldCohorts(this.getRecentlyActiveStudents(now).map((student) => this.publicWorldPresenceFromRecent(student)));
    const curriculum = this.curriculumCoverageSnapshotForStates(publicEntries.map((entry) => entry.state));
    const recentEvents = this.getSchoolWorldEvents(eventLimit, now, rooms.publicSessionIds, rooms.activeRooms);
    const summary = this.publicWorldSummarySnapshot(now);
    this.syncPublicWorldTermRecord(summary, now);
    return {
      generatedAt: now,
      activeStudents: rooms.activeStudents,
      activeRooms: rooms.activeRooms,
      cohorts,
      recentEvents,
      summary: {
        schoolYear: summary.schoolYear,
        roomGoalEvents: summary.roomGoalEvents,
        studySparks: summary.studySparks,
        termProgress: summary.termProgress,
        termRules: summary.termRules,
        curriculumLoops: summary.curriculumLoops,
        curriculumLoopHistory: summary.curriculumLoopHistory,
      },
      curriculum: {
        activeCharacterSessions: curriculum.activeCharacterSessions,
        lowPools: curriculum.lowPools,
      },
    };
  }

  async getFreshSchoolWorldSnapshot(limit = 30, now = Date.now()): Promise<SchoolWorldSnapshot> {
    await this.refreshWorldSessionsFromStore(now);
    return this.getSchoolWorldSnapshot(limit, now);
  }

  async getFreshSchoolWorldEvents(limit = 30, now = Date.now()): Promise<SchoolWorldEvent[]> {
    await this.refreshWorldSessionsFromStore(now, { eventLimit: limit });
    return this.getSchoolWorldEvents(limit, now);
  }

  async getPublicWorldModerationSnapshot(limit = 100, now = Date.now()): Promise<PublicWorldModerationSnapshot> {
    await this.refreshWorldSessionsFromStore(now);
    const eventLimit = Math.max(SCHOOL_WORLD_RECENT_EVENT_LIMIT, Math.min(200, Math.floor(Number(limit) || 100)));
    const eventsById = new Map(this.getSchoolWorldEvents(eventLimit, now).map((event) => [event.id, event]));
    const reports: PublicWorldModerationReport[] = [];
    const reportCountsByEventId = new Map<string, number>();
    for (const [sessionId, state] of this.sessions) {
      const stateReports = normalizePublicWorldEventReports(state.publicWorldEventReports);
      if (stateReports.length === 0) continue;
      const reporterId = publicWorldReporterId(sessionId);
      const reporterCharacterName = state.character?.name && typeof state.character.name === "string"
        ? state.character.name.trim().slice(0, 80) || null
        : null;
      for (const report of stateReports) {
        reportCountsByEventId.set(report.eventId, (reportCountsByEventId.get(report.eventId) ?? 0) + 1);
        const event = eventsById.get(report.eventId) ?? null;
        reports.push({
          id: report.id,
          eventId: report.eventId,
          reason: report.reason,
          createdAt: report.createdAt,
          reporterId,
          reporterCharacterName,
          reportCountForEvent: 0,
          moderatorNote: null,
          event: event ? publicWorldModerationEventContext(event) : null,
        });
      }
    }
    for (const report of reports) {
      report.reportCountForEvent = reportCountsByEventId.get(report.eventId) ?? 1;
      report.moderatorNote = this.publicWorldModeratorNotes.get(report.eventId) ?? null;
    }
    reports.sort((a, b) => b.createdAt - a.createdAt || a.eventId.localeCompare(b.eventId) || a.reporterId.localeCompare(b.reporterId));
    const boundedReports = reports.slice(0, Math.max(0, Math.min(200, Math.floor(Number(limit) || 100))));
    return {
      ok: true,
      generatedAt: now,
      reportCount: reports.length,
      reports: boundedReports,
      suppressedEvents: this.publicWorldSuppressedEventList(),
      moderatorNotes: this.publicWorldModeratorNoteList(),
    };
  }

  async dismissPublicWorldModerationReport(reportId: string, now = Date.now()): Promise<PublicWorldModerationDismissResult> {
    const id = normalizePublicWorldReportId(reportId);
    if (!id) throw new Error("reportId is required.");
    const changedSessionIds: string[] = [];
    let dismissedCount = 0;
    for (const [sessionId, state] of this.sessions) {
      const reports = normalizePublicWorldEventReports(state.publicWorldEventReports);
      if (reports.length === 0) continue;
      const retained = reports.filter((report) => report.id !== id);
      const removed = reports.length - retained.length;
      if (removed <= 0) continue;
      dismissedCount += removed;
      state.publicWorldEventReports = retained;
      state.updatedAt = now;
      changedSessionIds.push(sessionId);
    }
    for (const sessionId of changedSessionIds) {
      await this.flushSession(sessionId);
    }
    return {
      ok: true,
      generatedAt: now,
      reportId: id,
      dismissed: dismissedCount > 0,
      dismissedCount,
    };
  }

  async suppressPublicWorldEvent(eventId: string, reason: string | undefined, now = Date.now()): Promise<PublicWorldEventSuppressionResult> {
    const id = normalizePublicWorldEventId(eventId);
    if (!id) throw new Error("Public world event id is invalid.");
    const normalizedReason = normalizePublicWorldReportReason(reason);
    const existing = this.publicWorldSuppressedEvents.get(id);
    this.publicWorldSuppressedEvents.set(id, {
      eventId: id,
      reason: normalizedReason,
      suppressedAt: existing?.suppressedAt ?? now,
    });
    await this.persistPublicWorldModerationState({ surfaceErrors: true }, now);
    return {
      ok: true,
      generatedAt: now,
      eventId: id,
      reason: normalizedReason,
      suppressed: !existing,
    };
  }

  async notePublicWorldModerationEvent(eventId: string, note: string | undefined, now = Date.now()): Promise<PublicWorldModeratorNoteResult> {
    const id = normalizePublicWorldEventId(eventId);
    if (!id) throw new Error("Public world event id is invalid.");
    const normalizedNote = normalizePublicWorldModeratorNote(note);
    const existing = this.publicWorldModeratorNotes.get(id);
    const updated = existing?.note !== normalizedNote;
    if (normalizedNote) {
      this.publicWorldModeratorNotes.set(id, {
        eventId: id,
        note: normalizedNote,
        updatedAt: now,
      });
    } else {
      this.publicWorldModeratorNotes.delete(id);
    }
    await this.persistPublicWorldModerationState({ surfaceErrors: true }, now);
    return {
      ok: true,
      generatedAt: now,
      eventId: id,
      note: normalizedNote,
      updated,
    };
  }

  filterSchoolWorldSnapshotForSession(snapshot: SchoolWorldSnapshot, sessionId: string | null | undefined): SchoolWorldSnapshot {
    const hiddenIds = this.publicWorldHiddenEventIdsForSession(sessionId);
    if (hiddenIds.size === 0 && this.publicWorldSuppressedEvents.size === 0) return snapshot;
    return {
      ...snapshot,
      recentEvents: snapshot.recentEvents.filter((event) => !hiddenIds.has(event.id) && !this.publicWorldSuppressedEvents.has(event.id)),
    };
  }

  filterSchoolWorldEventsForSession(events: readonly SchoolWorldEvent[], sessionId: string | null | undefined): SchoolWorldEvent[] {
    const hiddenIds = this.publicWorldHiddenEventIdsForSession(sessionId);
    if (hiddenIds.size === 0 && this.publicWorldSuppressedEvents.size === 0) return events.slice();
    return events.filter((event) => !hiddenIds.has(event.id) && !this.publicWorldSuppressedEvents.has(event.id));
  }

  private publicWorldHiddenEventIdsForSession(sessionId: string | null | undefined): Set<string> {
    if (!sessionId) return new Set();
    const state = this.sessions.get(sessionId);
    if (!state) return new Set();
    return new Set(normalizePublicWorldHiddenEventIds(state.publicWorldHiddenEventIds));
  }

  hidePublicWorldEvent(sessionId: string, eventId: string, now = Date.now()): { state: QuizState; hidden: boolean } {
    const id = normalizePublicWorldEventId(eventId);
    if (!id) throw new Error("Public world event id is invalid.");
    const state = this.getOrCreate(sessionId);
    const ids = normalizePublicWorldHiddenEventIds(state.publicWorldHiddenEventIds);
    const hidden = !ids.includes(id);
    if (hidden) ids.push(id);
    state.publicWorldHiddenEventIds = ids.slice(-100);
    state.updatedAt = now;
    return { state, hidden };
  }

  reportPublicWorldEvent(sessionId: string, input: { eventId: string; reason?: string; now?: number }): { state: QuizState; report: PublicWorldEventReport; created: boolean } {
    const id = normalizePublicWorldEventId(input.eventId);
    if (!id) throw new Error("Public world event id is invalid.");
    const now = Number.isFinite(input.now) ? Math.max(0, Math.floor(Number(input.now))) : Date.now();
    const reason = normalizePublicWorldReportReason(input.reason);
    const state = this.getOrCreate(sessionId);
    const reports = normalizePublicWorldEventReports(state.publicWorldEventReports);
    const existing = reports.find((report) => report.eventId === id);
    const report = existing ?? {
      id: `public-world-report:${randomUUID()}`,
      eventId: id,
      reason,
      createdAt: now,
    };
    if (existing) {
      existing.reason = reason;
      existing.createdAt = now;
    } else {
      reports.push(report);
    }
    const hiddenIds = normalizePublicWorldHiddenEventIds(state.publicWorldHiddenEventIds);
    if (!hiddenIds.includes(id)) hiddenIds.push(id);
    state.publicWorldHiddenEventIds = hiddenIds.slice(-100);
    state.publicWorldEventReports = reports.slice(-50);
    state.updatedAt = now;
    return { state, report, created: !existing };
  }

  getSchoolWorldEvents(limit = 30, now = Date.now(), publicSessionIds?: ReadonlySet<string>, activeRooms?: readonly SchoolWorldRoom[]): SchoolWorldEvent[] {
    const eventLimit = Number.isFinite(limit) ? Math.max(0, Math.min(SCHOOL_WORLD_RECENT_EVENT_LIMIT, Math.floor(limit))) : 30;
    if (eventLimit <= 0) return [];
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const visibleSessionIds = publicSessionIds ?? this.publicSchoolWorldSessionIds(now, weekMs);
    const rooms = activeRooms ?? buildPublicWorldRooms(
      this.publicSchoolWorldEntries(now, weekMs).map((entry) => this.publicWorldPresenceFromEntry(entry)),
      5,
      24,
      this.liveRoomGoalContributionsForWorld(now),
    ).activeRooms;
    this.clampPublicWorldRoomGoalTimes(rooms, now);
    const rows = new Map<string, SchoolWorldEvent>();
    for (const event of this.publicWorldEventLogList(now)) {
      rows.set(event.id, event);
    }
    const addEvent = (event: SchoolEvent) => {
      const eventAt = Math.floor(Number(event.at ?? 0));
      if (!Number.isFinite(eventAt) || eventAt < 0 || eventAt > now || now - eventAt > weekMs) return;
      const publicEvent = publicSchoolWorldEvent(event);
      rows.set(publicEvent.id, publicEvent);
      if (rows.size <= SCHOOL_WORLD_RECENT_EVENT_LIMIT) return;
      const retained = Array.from(rows.values())
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
        .slice(0, SCHOOL_WORLD_RECENT_EVENT_LIMIT);
      rows.clear();
      for (const retainedEvent of retained) rows.set(retainedEvent.id, retainedEvent);
    };

    for (const record of this.schoolEventRecords.values()) {
      const publicSessionId = publicWorldSessionId(record.sessionId);
      if (!publicSessionId || !visibleSessionIds.has(publicSessionId)) continue;
      addEvent(record.event);
    }

    for (const [sessionId, state] of this.sessions) {
      const publicSessionId = publicWorldSessionId(sessionId);
      if (!publicSessionId || !visibleSessionIds.has(publicSessionId)) continue;
      for (const event of Array.isArray(state.schoolEvents) ? state.schoolEvents : []) addEvent(event);
    }

    for (const event of publicWorldRoomGoalEvents(rooms)) {
      if (event.at > now || now - event.at > weekMs) continue;
      rows.set(event.id, event);
    }

    this.syncPublicWorldEventLog(rows.values(), now);

    return Array.from(rows.values())
      .filter((event) => !this.publicWorldSuppressedEvents.has(event.id))
      .sort((a, b) => this.schoolWorldEventKindRank(a.kind) - this.schoolWorldEventKindRank(b.kind) || b.at - a.at || b.id.localeCompare(a.id))
      .slice(0, eventLimit);
  }

  private publicWorldSuppressedEventList(): PublicWorldSuppressedEvent[] {
    return Array.from(this.publicWorldSuppressedEvents.values())
      .sort((a, b) => b.suppressedAt - a.suppressedAt || a.eventId.localeCompare(b.eventId));
  }

  private publicWorldModeratorNoteList(): PublicWorldModeratorNote[] {
    return Array.from(this.publicWorldModeratorNotes.values())
      .sort((a, b) => b.updatedAt - a.updatedAt || a.eventId.localeCompare(b.eventId));
  }

  private clampPublicWorldRoomGoalTimes(rooms: readonly SchoolWorldRoom[], now: number): void {
    for (const room of rooms) {
      const updatedAt = Math.max(0, Math.floor(Number(room.goal.updatedAt) || 0));
      room.goal.updatedAt = updatedAt > now ? 0 : updatedAt;
    }
  }

  private liveRoomGoalContributionsForWorld(now = Date.now()): PublicWorldRoomGoalContribution[] {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const out: PublicWorldRoomGoalContribution[] = [];
    let pruned = false;
    for (const [key, goal] of this.liveRoomGoalStates) {
      if (!Number.isFinite(goal.updatedAt) || goal.updatedAt <= 0 || goal.updatedAt > now || now - goal.updatedAt > weekMs) {
        this.liveRoomGoalStates.delete(key);
        pruned = true;
        continue;
      }
      const bonusLabel = liveRoomGoalBonusLabel(goal, goal.contributors.size, goal.target, now);
      out.push({
        grade: goal.grade,
        facultyId: goal.facultyId,
        amount: goal.contributors.size,
        target: goal.target,
        updatedAt: goal.updatedAt,
        ...(goal.ruleLabel ? { ruleLabel: goal.ruleLabel } : {}),
        ...(bonusLabel ? { bonusLabel } : {}),
      });
    }
    if (pruned) void this.persistLiveRoomGoalState({}, now);
    return out;
  }

  private liveRoomGoalStateKey(grade: Grade, facultyId: string, day: string): string {
    return `${day}:${grade}:${facultyId}`;
  }

  private liveRoomGoalRule(grade: Grade, now = Date.now()): { target: number; ruleLabel?: string } {
    const term = this.currentPublicWorldTermRecord(now);
    const rule = term.gradeProgress[grade]?.roomRule;
    if (!rule) return { target: 3 };
    return { target: rule.target, ruleLabel: rule.label };
  }

  private schoolWorldEventKindRank(kind: SchoolWorldEvent["kind"]): number {
    return kind === "room.goal-progress" ? 1 : 0;
  }

  private pruneSchoolEventRecords(now = Date.now()): void {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const retained = Array.from(this.schoolEventRecords.values())
      .filter((record) => {
        const at = Math.floor(Number(record.occurredAt ?? record.event.at ?? 0));
        return Number.isFinite(at) && at >= 0 && at <= now && now - at <= weekMs;
      })
      .sort((a, b) => {
        const atDiff = Number(b.occurredAt ?? b.event.at ?? 0) - Number(a.occurredAt ?? a.event.at ?? 0);
        return atDiff || b.id.localeCompare(a.id);
      })
      .slice(0, SCHOOL_WORLD_EVENT_CACHE_LIMIT);
    if (retained.length === this.schoolEventRecords.size) return;
    this.schoolEventRecords.clear();
    for (const record of retained) this.schoolEventRecords.set(record.id, record);
  }

  private publicSchoolWorldSessionIds(now = Date.now(), weekMs = 7 * 24 * 60 * 60 * 1000): Set<string> {
    const sessionIds = new Set<string>();
    for (const { state } of this.publicSchoolWorldEntries(now, weekMs)) {
      const sessionId = publicWorldSessionId(state.sessionId);
      if (sessionId) sessionIds.add(sessionId);
    }
    return sessionIds;
  }

  private publicSchoolWorldEntries(now = Date.now(), weekMs = 7 * 24 * 60 * 60 * 1000): Array<{ state: QuizState; ch: PlayerCharacter; lastActive: number }> {
    const entries: Array<{ state: QuizState; ch: PlayerCharacter; lastActive: number }> = [];
    for (const [, state] of this.sessions) {
      const ch = state.character;
      if (!ch || !state.currentGrade) continue;
      if (!characterAllowsPublicSharing(ch)) continue;
      const lastActive = this.lastActivityFor(ch, state);
      if (now - lastActive > weekMs) continue;
      const hasGrades = characterDailyClassRecords(ch).some((record) => record.status === "complete");
      if (!hasGrades) continue;
      entries.push({ state, ch, lastActive });
    }
    return entries;
  }

  private publicWorldPresenceFromEntry(entry: { state: QuizState; ch: PlayerCharacter; lastActive: number }): PublicWorldPresenceEntry {
    const { state, ch, lastActive } = entry;
    const classGrades: Record<string, string> = {};
    for (const record of characterDailyClassRecords(ch)) {
      if (record.status === "complete" && record.letterGrade) {
        classGrades[record.facultyId] = record.letterGrade;
      }
    }
    const facultyId = state.faculty;
    const faculty = facultyForSession(state).find((item) => item.id === facultyId);
    return {
      sessionId: state.sessionId,
      grade: state.currentGrade ?? "9",
      facultyId,
      displayName: faculty?.displayName ?? facultyId,
      name: ch.name,
      playbookId: ch.playbookId,
      stats: { ...ch.stats },
      classGrades,
      yearbookCount: characterArrayField(ch, "yearbook").length,
      lastActive,
      ...(publicWorldPortraitUrl(ch.portraitDataUrl) ? { portraitUrl: publicWorldPortraitUrl(ch.portraitDataUrl) } : {}),
    };
  }

  private publicWorldPresenceFromRecent(student: RecentlyActiveStudent): PublicWorldPresenceEntry {
    return {
      sessionId: student.sessionId,
      grade: student.grade as Grade,
      facultyId: "",
      displayName: "",
      name: student.name,
      playbookId: student.playbookId,
      stats: { ...student.stats },
      classGrades: { ...student.classGrades },
      yearbookCount: student.yearbookCount,
      lastActive: student.lastActive,
      ...(publicWorldPortraitUrl(student.portraitUrl) ? { portraitUrl: publicWorldPortraitUrl(student.portraitUrl) } : {}),
    };
  }

  private async refreshWorldSessionsFromStore(now = Date.now(), opts: { eventLimit?: number } = {}): Promise<void> {
    if (now - this.worldStoreRefreshedAt < SCHOOL_WORLD_STORE_REFRESH_MS) return;
    if (this.worldStoreRefresh) {
      await this.worldStoreRefresh;
      return;
    }
    this.worldStoreRefresh = (async () => {
      try {
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const [loaded, schoolEvents] = await Promise.all([
          this.store.loadRecentSessions?.({
            since: weekAgo,
            limit: SCHOOL_WORLD_SESSION_REFRESH_LIMIT,
          }) ?? this.store.load(),
          this.store.loadSchoolEvents?.({
            since: weekAgo,
            limit: Math.max(SCHOOL_WORLD_RECENT_EVENT_LIMIT, Math.floor(Number(opts.eventLimit ?? 0) || 0)),
          }) ?? Promise.resolve([]),
        ]);
        for (const [sessionId, raw] of loaded) {
          const loadedState = normalizeLoaded(raw);
          this.reconcileLoadedPackState(loadedState);
          const current = this.sessions.get(sessionId);
          if (!current || Number(loadedState.updatedAt ?? 0) > Number(current.updatedAt ?? 0)) {
            this.sessions.set(sessionId, loadedState);
          }
        }
        for (const event of schoolEvents) {
          this.schoolEventRecords.set(event.id, event);
        }
        this.pruneSchoolEventRecords(now);
        this.worldStoreRefreshedAt = now;
      } catch (err) {
        log.error("ruby-high.world-refresh-failed", err);
      }
    })().finally(() => {
      this.worldStoreRefresh = null;
    });
    await this.worldStoreRefresh;
  }

  /** Composite score from class grades. Higher = better. No grades = 0. */
  private gradeScore(student: RecentlyActiveStudent): number {
    const grades = Object.values(student.classGrades);
    if (grades.length === 0) return 0;
    const letterMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
    let sum = 0;
    for (const g of grades) {
      const firstChar = g.charAt(0).toUpperCase();
      const letter = letterMap[firstChar];
      if (letter === undefined) continue;
      const mod = g.includes("+") ? 0.3 : g.includes("-") ? -0.3 : 0;
      sum += letter + mod;
    }
    return sum / grades.length;
  }

  private lastActivityFor(ch: PlayerCharacter, state: QuizState): number {
    let latest = Number(ch.createdAt ?? 0);
    if (!Number.isFinite(latest) || latest < 0) latest = 0;
    for (const record of characterDailyClassRecords(ch)) {
      const t = Number(record.updatedAt ?? record.completedAt ?? 0);
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    for (const lu of characterArrayField(ch, "levelUps")) {
      const t = Number(lu.awardedAt ?? 0);
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    for (const event of Array.isArray(state.schoolEvents) ? state.schoolEvents : []) {
      const t = Number(event.at ?? 0);
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    return latest;
  }

  /** Reassign pending photos from one teacher to another. Used when a
   *  non-Ruby teacher disconnects from X — their photos move to Ruby
   *  so nothing gets orphaned. Returns the count of reassigned photos. */
  reassignPendingPhotos(fromTeacherId: string, toTeacherId: string): number {
    let count = 0;
    for (const [, state] of this.sessions) {
      const photos = state.character?.pendingPhotos;
      if (!photos) continue;
      for (const p of photos) {
        if (p.teacherFacultyId === fromTeacherId) {
          p.teacherFacultyId = toTeacherId;
          count += 1;
        }
      }
      if (count > 0) {
        state.updatedAt = Date.now();
        void this.persistSession(state.sessionId);
      }
    }
    return count;
  }

  /** Fire an X (Twitter) milestone post from the relevant teacher's account.
   *  Enforces per-student daily text budget (one text post per student per day,
   *  except character-created and graduated which always post). */
  private maybePostXMilestone(ctx: XMilestoneContext, state: QuizState): void {
    if (!this.runtime || typeof (this.runtime as any).getService !== "function") return;
    const xSocial = (this.runtime as any).getService(XSocialService.serviceType) as XSocialService | undefined;
    if (!xSocial) return;

    // Skip smoke-test / auto-generated characters so their suffixed
    // names never reach an LLM prompt for social posting.
    if (isSyntheticCharacterName(ctx.characterName)) return;

    // Per-student daily text budget: skip if this student already had a text
    // post today. Character-created and graduated are one-time events — always post.
    const ch = state.character;
    if (ch && !characterAllowsSocialSharing(ch)) return;
    if (ch && ctx.kind !== "character-created" && ctx.kind !== "graduated") {
      const today = new Date().toISOString().slice(0, 10);
      ch.lastTextTweetDate = ch.lastTextTweetDate ?? "";
      if (ch.lastTextTweetDate === today) return;
    }

    // Teacher routing:
    // - class-passed: the faculty who taught the class (already in ctx.teacherFacultyId)
    // - grade-advanced / graduated: Ruby (homeroom teacher)
    // - character-created: Ruby
    // - Fallback to Ruby for anything else.
    let teacher = ctx.teacherFacultyId ? teacherById(ctx.teacherFacultyId) : null;
    if (!teacher) teacher = teacherById("ruby");
    if (!teacher) return;

    // Post the tweet. On success, record the date for the daily budget.
    const postCtx = this.xMilestoneContextWithImage(ctx, state);
    xSocial.maybePostMilestone(teacher, postCtx).then((tweetId) => {
      if (tweetId && ch && ctx.kind !== "character-created" && ctx.kind !== "graduated") {
        ch.lastTextTweetDate = new Date().toISOString().slice(0, 10);
        state.updatedAt = Date.now();
        void this.persistSession(state.sessionId);
      }
    }).catch(() => {});
  }

  private xMilestoneContextWithImage(ctx: XMilestoneContext, state: QuizState): XMilestoneContext {
    if (ctx.imageUrl || ctx.portraitUrl || ctx.diplomaUrl) return ctx;
    const ch = state.character;
    return {
      ...ctx,
      imageUrl: ch?.portraitDataUrl || defaultPlayerPortraitUrl(ch?.playbookId),
    };
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

function normalizeAnswerStats(stats: AnswerStats | null | undefined): AnswerStats {
  const src = stats && typeof stats === "object" ? stats : {};
  const totalAnswers = Math.max(0, Math.floor(Number((src as Partial<AnswerStats>).totalAnswers ?? 0)));
  return {
    totalAnswers,
    repeatedAnswers: Math.min(
      totalAnswers,
      Math.max(0, Math.floor(Number((src as Partial<AnswerStats>).repeatedAnswers ?? 0))),
    ),
  };
}

function answerStatsFromHistory(history: unknown): AnswerStats {
  const stats: AnswerStats = { totalAnswers: 0, repeatedAnswers: 0 };
  const seenQuestionIds = new Set<string>();
  if (!Array.isArray(history)) return stats;
  for (const answer of history) {
    const questionId = typeof answer?.questionId === "string" ? answer.questionId : "";
    if (!questionId) continue;
    stats.totalAnswers += 1;
    if (seenQuestionIds.has(questionId)) stats.repeatedAnswers += 1;
    else seenQuestionIds.add(questionId);
  }
  return stats;
}

function normalizePositiveInteger(value: number, label: string): number {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return amount;
}

function hallPassCardsRequiredForCost(hallPassCost: number): number {
  const cost = normalizePositiveInteger(hallPassCost, "Hall Pass cost");
  return Math.max(1, Math.ceil(cost / HALL_PASS_CARD_BURN_HALL_PASS_VALUE));
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
    for (const entry of characterYearbookEntries(owner)) {
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
        ...(entry.diploma ? { diploma: entry.diploma } : {}),
        ...(entry.photo ? { photo: entry.photo } : {}),
        superlatives: Array.isArray(entry.superlatives) ? [...entry.superlatives] : [],
        ...(entry.yearbookImageUrl ? { yearbookImageUrl: entry.yearbookImageUrl } : {}),
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

function shortHash(seed: unknown): string {
  return createHash("sha256").update(String(seed ?? "")).digest("hex").slice(0, 16);
}

function generatedNftCharacterId(kind: RubyHighGeneratedNftProfileKind, seed: string): string {
  return `${kind}:${shortHash(seed)}`;
}

function generatedNftTransactionId(
  sessionId: string,
  kind: RubyHighGeneratedNftProfileKind,
  stableKey: string,
  requestId: string,
): string {
  return `hall-pass-card:nft-v2:${kind}:${shortHash(`${sessionId}:${stableKey}:${requestId}`)}`;
}

function isNftSafeImageRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.startsWith("data:image/")) return false;
  if (text.startsWith("/api/apps/ruby-high/assets/")) return true;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function nftSafeImageRef(value: unknown, fallback: string): string {
  if (isNftSafeImageRef(value)) return value.trim().slice(0, 1200);
  return isNftSafeImageRef(fallback) ? fallback.trim().slice(0, 1200) : "";
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

function normalizedWalletSource(value: unknown): NonNullable<RubyHighWalletTransaction["source"]> | null {
  const sources: Array<NonNullable<RubyHighWalletTransaction["source"]>> = [
    "stripe",
    "solana",
    "iap",
    "revenuecat",
    "chat",
    "hosted-image",
    "hosted-ai",
    "question-generation",
    "character-slot",
    "course-slot",
    "photo-day",
    "hall-pass-pack",
    "hall-pass-card",
    "admin",
    "system",
  ];
  return typeof value === "string" && sources.includes(value as NonNullable<RubyHighWalletTransaction["source"]>)
    ? value as NonNullable<RubyHighWalletTransaction["source"]>
    : null;
}

function normalizedHallPassCardStatus(value: unknown): RubyHighHallPassCardStatus {
  return value === "redeemed" || value === "void" ? value : "active";
}

function normalizedHallPassCardRole(value: unknown): RubyHighHallPassCardRole {
  return value === "teacher" || value === "item" || value === "location" || value === "special" ? value : "student";
}

function normalizedHallPassCardRarity(value: unknown): RubyHighHallPassCardRarity {
  if (value === "ultra-rare") return "ultra-rare";
  if (value === "super-rare" || value === "legendary") return "super-rare";
  return value === "rare" ? "rare" : "common";
}

function normalizeHallPassCard(raw: unknown): RubyHighHallPassCard | null {
  if (!raw || typeof raw !== "object") return null;
  const card = raw as Record<string, unknown>;
  const id = typeof card.id === "string" ? card.id.trim().slice(0, 96) : "";
  if (!id) return null;
  const issuedAt = Math.max(0, Math.floor(Number(card.issuedAt ?? card.createdAt ?? 0)));
  const updatedAt = Math.max(issuedAt, Math.floor(Number(card.updatedAt ?? issuedAt)));
  const hallPasses = Math.max(1, Math.floor(Number(card.hallPasses ?? 1)));
  const entry: RubyHighHallPassCard = {
    id,
    serial: Math.max(1, Math.floor(Number(card.serial ?? 1))),
    title: typeof card.title === "string" && card.title.trim() ? card.title.trim().slice(0, 80) : "Ruby High Card",
    characterId: typeof card.characterId === "string" && card.characterId.trim() ? card.characterId.trim().slice(0, 80) : "ruby",
    characterName: typeof card.characterName === "string" && card.characterName.trim() ? card.characterName.trim().slice(0, 80) : "Ruby High",
    role: normalizedHallPassCardRole(card.role),
    rarity: normalizedHallPassCardRarity(card.rarity),
    blurb: typeof card.blurb === "string" && card.blurb.trim() ? card.blurb.trim().slice(0, 160) : "Good for one burn.",
    color: typeof card.color === "string" && card.color.trim() ? card.color.trim().slice(0, 32) : "#d22a2a",
    hallPasses,
    status: normalizedHallPassCardStatus(card.status),
    issuedAt: Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
  const source = normalizedWalletSource(card.source);
  if (source) entry.source = source;
  for (const field of [
    "setName",
    "setCode",
    "setNumber",
    "profileId",
    "cardName",
    "subject",
    "canonicalCharacterId",
    "grantTransactionId",
    "redeemTransactionId",
    "packId",
    "revealCommitment",
    "packRevealVersion",
    "catalogHash",
    "commitment",
    "entropySource",
    "revealSeed",
    "revealProof",
    "packAssetAddress",
    "randomnessAccount",
    "revealTransaction",
    "ownerWalletAddress",
    "pendingMintOwnerWalletAddress",
    "pendingMintAddress",
    "pendingMintMetadataUri",
    "pendingMintTransactionHash",
    "mintAddress",
    "mintSignature",
    "metadataUri",
    "burnSignature",
  ] as const) {
    const value = card[field];
    if (typeof value === "string" && value.trim()) entry[field] = value.trim().slice(0, 240);
  }
  for (const field of ["imageUrl", "sourceImageUrl"] as const) {
    const value = card[field];
    if (typeof value === "string" && value.trim()) entry[field] = value.trim().slice(0, 1200);
  }
  if (card.nftProfileKind === "cast" || card.nftProfileKind === "player" || card.nftProfileKind === "yearbook") {
    entry.nftProfileKind = card.nftProfileKind;
  }
  if (typeof card.playbookId === "string" && card.playbookId.trim()) {
    entry.playbookId = card.playbookId.trim().slice(0, 64);
  }
  if (typeof card.grade === "string" && (GRADES as readonly string[]).includes(card.grade)) {
    entry.grade = card.grade as Grade;
  }
  const slotIndex = Math.floor(Number(card.slotIndex));
  if (Number.isFinite(slotIndex) && slotIndex >= 0) entry.slotIndex = slotIndex;
  const revealSlot = Math.floor(Number(card.revealSlot));
  if (Number.isFinite(revealSlot) && revealSlot >= 0) entry.revealSlot = revealSlot;
  const revealedAt = Math.floor(Number(card.revealedAt ?? 0));
  if (Number.isFinite(revealedAt) && revealedAt > 0) entry.revealedAt = revealedAt;
  const pendingMintPreparedAt = Math.floor(Number(card.pendingMintPreparedAt ?? 0));
  if (Number.isFinite(pendingMintPreparedAt) && pendingMintPreparedAt > 0) entry.pendingMintPreparedAt = pendingMintPreparedAt;
  const burnedAt = Math.floor(Number(card.burnedAt ?? 0));
  if (Number.isFinite(burnedAt) && burnedAt > 0) entry.burnedAt = burnedAt;
  if (
    card.artSheet === "students" ||
    card.artSheet === "teachers" ||
    card.artSheet === "specials" ||
    card.artSheet === "items" ||
    card.artSheet === "locations"
  ) entry.artSheet = card.artSheet;
  if (typeof card.artPosition === "string" && card.artPosition.trim()) {
    entry.artPosition = card.artPosition.trim().slice(0, 32);
  }
  return entry;
}

function normalizeHallPassBurnInputs(value: HallPassCardBurnInput[] | undefined): HallPassCardBurnInput[] {
  if (!Array.isArray(value)) return [];
  const seenCards = new Set<string>();
  const out: HallPassCardBurnInput[] = [];
  for (const raw of value) {
    const cardId = typeof raw?.cardId === "string" ? raw.cardId.trim().slice(0, 96) : "";
    const ownerWalletAddress = typeof raw?.ownerWalletAddress === "string" ? raw.ownerWalletAddress.trim() : "";
    const mintAddress = typeof raw?.mintAddress === "string" ? raw.mintAddress.trim() : "";
    const burnSignature = typeof raw?.burnSignature === "string" ? raw.burnSignature.trim() : "";
    if (!cardId || !ownerWalletAddress || !mintAddress || !burnSignature) {
      throw new Error("Burned Card payment is incomplete.");
    }
    if (seenCards.has(cardId)) {
      throw new Error("Burned Card payment contains a duplicate card.");
    }
    seenCards.add(cardId);
    out.push({ cardId, ownerWalletAddress, mintAddress, burnSignature });
  }
  return out;
}

function normalizeHallPassCards(value: unknown): RubyHighHallPassCard[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, RubyHighHallPassCard>();
  for (const raw of value) {
    const entry = normalizeHallPassCard(raw);
    if (entry) byId.set(entry.id, entry);
  }
  const cards = [...byId.values()].sort((a, b) => a.issuedAt - b.issuedAt || a.serial - b.serial);
  const active = cards.filter((card) => card.status === "active");
  const inactive = cards
    .filter((card) => card.status !== "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, HALL_PASS_REDEEMED_CARD_LIMIT);
  return [...active, ...inactive].sort((a, b) => a.issuedAt - b.issuedAt || a.serial - b.serial);
}

function normalizedHallPassPackStatus(value: unknown): RubyHighHallPassPackStatus {
  return value === "opened" || value === "void" ? value : "active";
}

function hallPassPackSerialFromMetadataUri(metadataUri: string): number | null {
  let pathname = "";
  try {
    pathname = new URL(metadataUri).pathname;
  } catch (_err) {
    pathname = metadataUri;
  }
  const match = pathname.match(/\/metadata\/core\/pack\/[^/]+\/([^/]+)\.json$/);
  const serialSegment = safeDecodePathSegment(match?.[1] ?? "");
  const parsed = Math.floor(Number(serialSegment ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeDecodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hallPassPackSerial(inputSerial: unknown, metadataUri: string, id: string, assetAddress: string): number {
  const metadataSerial = hallPassPackSerialFromMetadataUri(metadataUri);
  if (metadataSerial) return metadataSerial;
  const explicit = Math.floor(Number(inputSerial));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return hashInteger(`${id}:${assetAddress}`) % 900000 + 100000;
}

function normalizeHallPassPack(raw: unknown): RubyHighHallPassPack | null {
  if (!raw || typeof raw !== "object") return null;
  const pack = raw as Record<string, unknown>;
  const id = typeof pack.id === "string" ? pack.id.trim().slice(0, 96) : "";
  if (!id) return null;
  const ownerWalletAddress = typeof pack.ownerWalletAddress === "string" ? pack.ownerWalletAddress.trim().slice(0, 96) : "";
  const assetAddress = typeof pack.assetAddress === "string" ? pack.assetAddress.trim().slice(0, 96) : "";
  const mintSignature = typeof pack.mintSignature === "string" ? pack.mintSignature.trim().slice(0, 140) : "";
  const metadataUri = typeof pack.metadataUri === "string" ? pack.metadataUri.trim().slice(0, 320) : "";
  if (!ownerWalletAddress || !assetAddress || !mintSignature || !metadataUri) return null;
  const issuedAt = Math.max(0, Math.floor(Number(pack.issuedAt ?? pack.createdAt ?? 0)));
  const updatedAt = Math.max(issuedAt, Math.floor(Number(pack.updatedAt ?? issuedAt)));
  const packCount = Math.max(1, Math.floor(Number(pack.packCount ?? 1)));
  const rawCardCount = Math.max(1, Math.floor(Number(pack.cardCount ?? packCount * HALL_PASS_CARDS_PER_PACK)));
  const cardCount = Math.max(rawCardCount, packCount * HALL_PASS_CARDS_PER_PACK);
  const entry: RubyHighHallPassPack = {
    id,
    serial: hallPassPackSerial(pack.serial, metadataUri, id, assetAddress),
    productId: typeof pack.productId === "string" && pack.productId.trim()
      ? pack.productId.trim().slice(0, 96)
      : "card-pack-1",
    packCount,
    cardCount,
    status: normalizedHallPassPackStatus(pack.status),
    issuedAt: Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    ownerWalletAddress,
    assetAddress,
    mintSignature,
    metadataUri,
  };
  const source = normalizedWalletSource(pack.source);
  if (source) entry.source = source;
  for (const field of [
    "packRevealVersion",
    "catalogHash",
    "commitment",
    "entropySource",
    "revealSeed",
    "randomnessAccount",
    "revealTransaction",
    "grantTransactionId",
    "openTransactionId",
    "openSignature",
  ] as const) {
    const value = pack[field];
    if (typeof value === "string" && value.trim()) entry[field] = value.trim().slice(0, 240);
  }
  const revealSlot = Math.floor(Number(pack.revealSlot));
  if (Number.isFinite(revealSlot) && revealSlot >= 0) entry.revealSlot = revealSlot;
  const openedAt = Math.floor(Number(pack.openedAt ?? 0));
  if (Number.isFinite(openedAt) && openedAt > 0) entry.openedAt = openedAt;
  return entry;
}

function normalizeHallPassPacks(value: unknown): RubyHighHallPassPack[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, RubyHighHallPassPack>();
  for (const raw of value) {
    const entry = normalizeHallPassPack(raw);
    if (!entry) continue;
    const key = entry.assetAddress || entry.id;
    const existing = byId.get(key);
    if (!existing || entry.updatedAt >= existing.updatedAt) byId.set(key, entry);
  }
  const packs = [...byId.values()].sort((a, b) => a.issuedAt - b.issuedAt || a.serial - b.serial);
  const active = packs.filter((pack) => pack.status === "active");
  const inactive = packs
    .filter((pack) => pack.status !== "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, HALL_PASS_REDEEMED_CARD_LIMIT);
  return [...active, ...inactive].sort((a, b) => a.issuedAt - b.issuedAt || a.serial - b.serial);
}

function hashInteger(seed: string): number {
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
}

function cleanRevealString(value: unknown, maxLength = 240): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : "";
}

function secretHash(seed: string): string {
  const explicit = typeof process.env.RUBY_HIGH_PACK_REVEAL_SECRET === "string"
    ? process.env.RUBY_HIGH_PACK_REVEAL_SECRET.trim()
    : "";
  const authoritySecret = typeof process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY === "string"
    ? process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY.trim()
    : "";
  const secret = explicit || authoritySecret || "ruby-high-dev-pack-reveal-secret";
  return createHmac("sha256", secret).update(seed).digest("hex");
}

function secretHashInteger(seed: string): number {
  return Number.parseInt(secretHash(seed).slice(0, 8), 16);
}

function packRevealNonce(...parts: string[]): string {
  return secretHash([HALL_PASS_PACK_REVEAL_VERSION, ...parts].join("|"));
}

function hallPassPackId(transactionId: string, assetAddress: string): string {
  return `hpp_${createHash("sha256").update(`${transactionId}:${assetAddress}`).digest("hex").slice(0, 18)}`;
}

function hallPassCardId(transactionId: string, index: number): string {
  return `hpc_${createHash("sha256").update(`${transactionId}:${index}`).digest("hex").slice(0, 18)}`;
}

type SeedIntegerFn = (seed: string) => number;

function pickCatalogEntry(
  entries: HallPassCardCatalogEntry[],
  seed: string,
  seedInteger: SeedIntegerFn = secretHashInteger,
): HallPassCardCatalogEntry {
  return entries[seedInteger(seed) % entries.length] ?? entries[0]!;
}

function pickPlayerStudentCard(
  seed: string,
  sessions: Map<string, QuizState>,
  seedInteger: SeedIntegerFn = secretHashInteger,
): HallPassCardCatalogEntry | null {
  // Collect all player characters with portraits.
  const candidates: Array<{ name: string; playbookId: string; portraitUrl?: string; sessionId: string }> = [];
  for (const [sid, state] of sessions) {
    const ch = state.character;
    if (!ch?.portraitDataUrl) continue;
    // Skip smoke test characters.
    if (isSyntheticCharacterName(ch.name)) continue;
    candidates.push({
      name: ch.name,
      playbookId: ch.playbookId,
      portraitUrl: ch.portraitDataUrl,
      sessionId: sid,
    });
  }
  if (candidates.length === 0) return null;
  const idx = Math.abs(seedInteger(`${seed}:player-student`)) % candidates.length;
  const pick = candidates[idx]!;
  return {
    characterId: `player:${pick.sessionId}`,
    characterName: pick.name,
    title: `${pick.name} · ${pick.playbookId}`,
    role: "student",
    rarity: "common",
    blurb: `A real student at Ruby High. ${pick.playbookId}.`,
    color: "#4a6fa5",
    artSheet: "students",
    artPosition: String(idx),
  };
}

function hallPassCardPackEntries(
  seed: string,
  options: { forceSpecialCard?: boolean; sessions?: Map<string, QuizState> } = {},
  seedInteger: SeedIntegerFn = secretHashInteger,
): HallPassCardCatalogEntry[] {
  const teacher = seedInteger(`${seed}:super-rare-teacher`) % 64 === 0 && HALL_PASS_CARD_SUPER_RARE_TEACHERS.length > 0
    ? pickCatalogEntry(HALL_PASS_CARD_SUPER_RARE_TEACHERS, `${seed}:super-teacher`, seedInteger)
    : pickCatalogEntry(HALL_PASS_CARD_TEACHERS, `${seed}:teacher`, seedInteger);
  const npcStudents = HALL_PASS_CARD_STUDENTS
    .slice()
    .sort((a, b) => seedInteger(`${seed}:student:${a.characterId}`) - seedInteger(`${seed}:student:${b.characterId}`))
    .slice(0, 2);
  const playerStudent = pickPlayerStudentCard(`${seed}:player-student`, options.sessions ?? new Map(), seedInteger);
  const students = playerStudent ? [...npcStudents, playerStudent] : [...npcStudents, ...HALL_PASS_CARD_STUDENTS.slice(2, 3)];
  const specialCard = (options.forceSpecialCard || seedInteger(`${seed}:special-card`) % 64 === 0) && HALL_PASS_CARD_SPECIALS.length > 0
    ? pickCatalogEntry(HALL_PASS_CARD_SPECIALS, `${seed}:special`, seedInteger)
    : null;
  const locationCard = pickCatalogEntry(HALL_PASS_CARD_ITEM_LOCATIONS, `${seed}:utility`, seedInteger);
  const finalSlot = specialCard ?? locationCard;
  return [teacher, ...students, finalSlot];
}

function transactionMetadataString(
  transaction: RubyHighWalletTransaction,
  field: string,
  maxLength = 240,
): string {
  return cleanRevealString(transaction.metadata?.[field], maxLength);
}

function issueHallPassCardsForTransaction(
  state: QuizState,
  transaction: RubyHighWalletTransaction,
  amount: number,
  sessions?: Map<string, QuizState>,
): RubyHighHallPassCard[] {
  const cards = normalizeHallPassCards(state.wallet.hallPassCards);
  const existingIds = new Set(cards.map((card) => card.id));
  const created: RubyHighHallPassCard[] = [];
  const cardCount = Math.max(0, Math.floor(Number(amount || 0)));
  const packCache = new Map<number, HallPassCardCatalogEntry[]>();
  const packCount = Math.ceil(cardCount / HALL_PASS_CARDS_PER_PACK);
  const guaranteedSpecialPackIndex = cardCount >= HALL_PASS_CARDS_PER_PACK * 5 ? packCount - 1 : -1;
  const packRevealVersion = transactionMetadataString(transaction, "packRevealVersion");
  const catalogHash = transactionMetadataString(transaction, "catalogHash");
  const commitment = transactionMetadataString(transaction, "commitment");
  const entropySource = transactionMetadataString(transaction, "entropySource");
  const revealSeed = transactionMetadataString(transaction, "revealSeed", 256);
  const packAssetAddress = transactionMetadataString(transaction, "packAssetAddress");
  const randomnessAccount = transactionMetadataString(transaction, "randomnessAccount");
  const revealTransaction = transactionMetadataString(transaction, "revealTransaction")
    || transactionMetadataString(transaction, "openSignature")
    || transaction.id;
  const revealSlot = Math.floor(Number(transaction.metadata?.revealSlot));
  const usesPackReveal = packRevealVersion === HALL_PASS_PACK_REVEAL_VERSION
    && !!catalogHash
    && !!commitment
    && !!revealSeed
    && !!packAssetAddress;
  const seedInteger = usesPackReveal ? hashInteger : secretHashInteger;
  for (let i = 0; i < cardCount; i += 1) {
    const id = hallPassCardId(transaction.id, i);
    if (existingIds.has(id)) continue;
    const packIndex = Math.floor(i / HALL_PASS_CARDS_PER_PACK);
    let packEntries = packCache.get(packIndex);
    if (!packEntries) {
      const packSeed = usesPackReveal
        ? packSlotRevealProof({
          commitment,
          revealSeed,
          assetAddress: packAssetAddress,
          slotIndex: packIndex * HALL_PASS_CARDS_PER_PACK,
        })
        : packIndex === 0 ? transaction.id : `${transaction.id}:pack:${packIndex}`;
      // Provably-fair packs must only use the static catalog — live
      // session state (player cards) would break verifiable commitment.
      packEntries = hallPassCardPackEntries(packSeed, {
        forceSpecialCard: packIndex === guaranteedSpecialPackIndex,
        sessions: usesPackReveal ? undefined : sessions,
      }, seedInteger);
      packCache.set(packIndex, packEntries);
    }
    const catalog = packEntries[i % packEntries.length]!;
    const issuedAt = transaction.at;
    const revealProof = usesPackReveal
      ? packSlotRevealProof({ commitment, revealSeed, assetAddress: packAssetAddress, slotIndex: i })
      : sha256Hex(secretHash(`${transaction.id}:${i}`));
    const card: RubyHighHallPassCard = {
      id,
      serial: hashInteger(id) % 900000 + 100000,
      title: catalog.title,
      characterId: catalog.characterId,
      characterName: catalog.characterName,
      setName: FIRST_BELL_SET_NAME,
      setCode: FIRST_BELL_SET_CODE,
      setNumber: hallPassCardSetNumber(catalog),
      profileId: hallPassCardProfileId(catalog),
      cardName: hallPassCardName(catalog),
      subject: hallPassCardSubject(catalog),
      role: catalog.role,
      rarity: catalog.rarity,
      blurb: catalog.blurb,
      color: catalog.color,
      hallPasses: 1,
      status: "active",
      issuedAt,
      updatedAt: issuedAt,
      ...(transaction.source ? { source: transaction.source } : {}),
      grantTransactionId: transaction.id,
      ...(catalog.artSheet ? { artSheet: catalog.artSheet } : {}),
      ...(catalog.artPosition ? { artPosition: catalog.artPosition } : {}),
      ...(typeof transaction.metadata?.ownerWalletAddress === "string" && transaction.metadata.ownerWalletAddress
        ? { ownerWalletAddress: transaction.metadata.ownerWalletAddress }
        : {}),
      ...(typeof transaction.metadata?.solanaPayer === "string" && transaction.metadata.solanaPayer
        ? { ownerWalletAddress: transaction.metadata.solanaPayer }
        : {}),
      ...(typeof transaction.metadata?.packId === "string" && transaction.metadata.packId
        ? { packId: transaction.metadata.packId }
        : {}),
      slotIndex: i,
      revealCommitment: revealProof.slice(0, 24),
      ...(usesPackReveal ? {
        packRevealVersion,
        catalogHash,
        commitment,
        entropySource,
        revealSeed,
        revealProof,
        packAssetAddress,
        revealTransaction,
        ...(Number.isFinite(revealSlot) && revealSlot >= 0 ? { revealSlot } : {}),
        ...(randomnessAccount ? { randomnessAccount } : {}),
      } : {}),
    };
    created.push(card);
    cards.push(card);
    existingIds.add(id);
  }
  state.wallet.hallPassCards = normalizeHallPassCards(cards);
  return created;
}

function attachHallPassCardMetadata(
  transaction: RubyHighWalletTransaction,
  cards: RubyHighHallPassCard[],
  missingCount = 0,
): void {
  if (cards.length <= 0 && missingCount <= 0) return;
  transaction.metadata = {
    ...(transaction.metadata ?? {}),
    ...(cards.length > 0 ? {
      hallPassCardCount: cards.length,
      hallPassCardIds: cards.map((card) => card.id).join(","),
    } : {}),
    ...(missingCount > 0 ? { legacyHallPassCount: missingCount } : {}),
  };
}

function normalizeWalletTransaction(raw: unknown): RubyHighWalletTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const kinds: RubyHighWalletTransactionKind[] = [
    "merit-star-grant",
    "merit-star-spend",
    "hall-pass-grant",
    "hall-pass-spend",
    "hall-pass-refund",
    "hall-pass-revoke",
    "hall-pass-pack-mint",
    "hall-pass-pack-open",
    "hall-pass-card-mint",
    "hall-pass-card-burn",
    "photo-day-spend",
    "photo-day-refund",
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
  const source = normalizedWalletSource(tx.source);
  if (source) {
    entry.source = source;
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
  const hallPasses = Math.max(0, Math.floor(Number(src.hallPasses ?? 0)));
  const hallPassCards = normalizeHallPassCards(src.hallPassCards)
    .filter((card) => card.grantTransactionId !== WELCOME_HALL_PASS_GRANT_ID || !!card.mintAddress || !!card.mintSignature);
  const hallPassPacks = normalizeHallPassPacks(src.hallPassPacks);
  const welcomeHallPassesGrantedAt = Math.floor(Number(src.welcomeHallPassesGrantedAt ?? 0));
  return {
    meritStars: Math.max(0, Math.floor(Number(src.meritStars ?? fallbackMeritStars))),
    hallPasses,
    ...(Number.isFinite(welcomeHallPassesGrantedAt) && welcomeHallPassesGrantedAt > 0
      ? { welcomeHallPassesGrantedAt }
      : {}),
    ...(Number.isFinite(Number(src.hostedAiAccessExpiresAt))
      ? { hostedAiAccessExpiresAt: Math.max(0, Math.floor(Number(src.hostedAiAccessExpiresAt))) }
      : {}),
    ...(hallPassCards.length > 0 ? { hallPassCards } : {}),
    ...(hallPassPacks.length > 0 ? { hallPassPacks } : {}),
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

function schoolEventOccurredAt(raw: unknown, fallback = Date.now()): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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
    const normalizedYearbook = yearbook.map((entry) => ({
      ...entry,
      diploma: entry.diploma ?? gradeDiplomaCollectibleFor({
        characterName: entry.name || name,
        characterCreatedAt: createdAt,
        grade: entry.grade,
        completedAt: Number(entry.completedAt) || completedAt,
      }),
    }));
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
      yearbook: normalizedYearbook,
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

function normalizePublicWorldEventId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return PUBLIC_WORLD_EVENT_ID_RE.test(id) ? id.toLowerCase() : null;
}

function normalizePublicWorldEventPayload(value: unknown): SchoolWorldEvent | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = normalizePublicWorldEventId(source.id);
  const at = Math.max(0, Math.floor(Number(source.at) || 0));
  const faculty = publicWorldStoredText(source.faculty, 80);
  const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
    ? source.grade as Grade
    : null;
  if (!id || at <= 0) return null;
  const base = {
    id,
    at,
    ...(faculty ? { faculty } : {}),
    grade,
  };
  if (source.kind === "room.goal-progress") {
    const progress = publicWorldStoredInteger(source.progress, 0);
    const target = Math.max(1, publicWorldStoredInteger(source.target, 1));
    const goalKind = source.goalKind === "live-class" ? source.goalKind : null;
    const roomTitle = publicWorldStoredText(source.roomTitle, 120);
    const label = publicWorldStoredText(source.label, 180);
    const ruleLabel = publicWorldStoredText(source.ruleLabel, 80);
    const rewardLabel = publicWorldStoredText(source.rewardLabel, 180);
    if (!goalKind || !roomTitle || !label) return null;
    return {
      ...base,
      kind: "room.goal-progress",
      roomTitle,
      goalKind,
      progress,
      target,
      complete: source.complete === true,
      label,
      ...(ruleLabel ? { ruleLabel } : {}),
      ...(rewardLabel && source.complete === true ? { rewardLabel } : {}),
    };
  }
  if (source.kind === "relationship.ticked") {
    const reason = source.reason;
    if (reason !== "best-responder" && reason !== "applauder" && reason !== "rub" && reason !== "pep-talk") return null;
    return {
      ...base,
      kind: "relationship.ticked",
      studentId: publicWorldStoredText(source.studentId, 120) || "student",
      delta: source.delta === 1 || source.delta === -1 ? source.delta : 0,
      reason,
      affinity: publicWorldStoredInteger(source.affinity, 0),
      circled: source.circled === true,
      scratched: source.scratched === true,
    };
  }
  if (source.kind === "mash.axis-resolved") {
    const axis = source.axis;
    if (axis !== "crush" && axis !== "job" && axis !== "lives" && axis !== "pet" && axis !== "money" && axis !== "lucky") return null;
    const valueText = publicWorldStoredText(source.value, 160);
    if (!valueText) return null;
    return {
      ...base,
      kind: "mash.axis-resolved",
      studentId: publicWorldStoredText(source.studentId, 120) || "student",
      axis,
      value: valueText,
    };
  }
  if (source.kind === "comic.page-unlocked") {
    const reason = source.reason;
    if (reason !== "teacher-class-aced" && reason !== "teacher-year-completed" && reason !== "student-befriended" && reason !== "legacy") return null;
    const issueId = publicWorldStoredText(source.issueId, 80);
    const pageId = publicWorldStoredText(source.pageId, 80);
    const label = publicWorldStoredText(source.label, 180);
    if (!issueId || !pageId || !label) return null;
    return {
      ...base,
      kind: "comic.page-unlocked",
      issueId,
      pageId,
      pageNumber: publicWorldStoredInteger(source.pageNumber, 0),
      reason,
      label,
    };
  }
  return null;
}

function publicWorldStoredText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function publicWorldStoredInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function publicWorldStoredRatio(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function publicWorldStoredTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const text = publicWorldStoredText(raw, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function publicWorldRoomRecordKey(schoolYear: string, grade: Grade, facultyId: string): string {
  return `${schoolYear}:${grade}:${facultyId}`;
}

function publicWorldRoomOutcomeId(day: string, grade: Grade, facultyId: string): string {
  const digest = createHash("sha256").update(`${day}:${grade}:${facultyId}`).digest("hex").slice(0, 16);
  return `room:outcome:${digest}`;
}

function publicWorldRoomOutcomeRoomTitle(displayName: string): string {
  return publicWorldStoredText(`${displayName} room`, 120) || "Class room";
}

function publicWorldRoomOutcomeRewardLabel(displayName: string, ruleLabel?: string): string {
  const rewardName = ruleLabel === "Term Rally" ? "Rally Spark" : "Study Spark";
  return publicWorldStoredText(`${displayName} earned a class-wide ${rewardName}`, 180) || `Class earned a ${rewardName}`;
}

function liveRoomGoalBonusLabel(goal: Pick<LiveRoomGoalState, "startedAt" | "updatedAt" | "displayName">, progress: number, target: number, now = Date.now()): string {
  if (progress < target) return "";
  const startedAt = publicWorldStoredInteger(goal.startedAt, 0);
  const completedAt = publicWorldStoredInteger(goal.updatedAt, now);
  if (startedAt <= 0 || completedAt <= 0 || completedAt < startedAt) return "";
  if (completedAt - startedAt > LIVE_ROOM_CLASS_CHAIN_WINDOW_MS) return "";
  const displayName = publicWorldRoomDisplayName(goal.displayName, "Class");
  return publicWorldStoredText(`${displayName} earned a Class Chain bonus`, 120) || "Class Chain bonus";
}

function publicWorldRoomOutcomeSummaryLabel(displayName: string, progress: number, target: number, contributorCount: number): string {
  const contributors = Math.max(0, Math.floor(Number(contributorCount) || 0));
  const contributorText = contributors === 1 ? "1 contributor" : `${contributors} contributors`;
  return publicWorldStoredText(`${displayName} live class completed ${progress}/${target} with ${contributorText}`, 180)
    || "Live class completed";
}

function publicWorldTermProgress(studySparkTotal: number): PublicWorldSummarySnapshot["termProgress"] {
  const totalSparks = Math.max(0, Math.floor(Number(studySparkTotal) || 0));
  const sparksPerLevel = 3;
  const level = Math.floor(totalSparks / sparksPerLevel);
  const currentStep = totalSparks % sparksPerLevel;
  const nextLevelAt = (level + 1) * sparksPerLevel;
  const sparksToNextLevel = nextLevelAt - totalSparks;
  const label = level > 0 && currentStep === 0
    ? `Term Level ${level}`
    : `Term Spark ${currentStep}/${sparksPerLevel}`;
  return {
    totalSparks,
    level,
    nextLevelAt,
    sparksToNextLevel,
    label,
  };
}

function publicWorldTermRecordId(schoolYear: string): string {
  const digest = createHash("sha256").update(`public-world-term:${schoolYear}`).digest("hex").slice(0, 16);
  return `term:${digest}`;
}

function publicWorldCohortTermRecordId(schoolYear: string, grade: Grade): string {
  const digest = createHash("sha256").update(`public-world-cohort-term:${schoolYear}:${grade}`).digest("hex").slice(0, 16);
  return `term:cohort:${digest}`;
}

function publicWorldTermRuleLabels(level: number): string[] {
  if (level >= 2) return ["Term Momentum", "Term Rally"];
  return level > 0 ? ["Term Momentum"] : [];
}

function publicWorldTermRoomRule(level: number): PublicWorldTermRoomRule | undefined {
  if (level >= 2) return { kind: "term-rally", label: "Term Rally", target: 4 };
  return level > 0 ? { kind: "term-momentum", label: "Term Momentum", target: 2 } : undefined;
}

function publicWorldTermRulesForGrades(studySparksByGrade: Partial<Record<Grade, number>>): PublicWorldSummarySnapshot["termRules"] {
  const byGrade: Partial<Record<Grade, PublicWorldTermRoomRule>> = {};
  for (const grade of GRADES) {
    const progress = publicWorldTermProgress(studySparksByGrade[grade] ?? 0);
    const rule = publicWorldTermRoomRule(progress.level);
    if (rule) byGrade[grade] = rule;
  }
  return { byGrade };
}

function publicWorldCurriculumLoopSummary(agendas: readonly PublicWorldTeacherAgendaRecord[]): PublicWorldCurriculumLoopSummary {
  const byGrade: PublicWorldCurriculumLoopSummary["byGrade"] = {};
  let inReview = 0;
  let promoted = 0;
  for (const agenda of agendas) {
    const draftStatus = agenda.draftStatus;
    if (draftStatus !== "review-draft-created" && draftStatus !== "review-approved" && draftStatus !== "questions-promoted") continue;
    const grade = agenda.grade;
    const row = byGrade[grade] ?? { inReview: 0, promoted: 0 };
    if (draftStatus === "questions-promoted") {
      promoted += 1;
      row.promoted += 1;
    } else {
      inReview += 1;
      row.inReview += 1;
    }
    byGrade[grade] = row;
  }
  return { inReview, promoted, byGrade };
}

function publicWorldCurriculumLoopHistory(agendas: readonly PublicWorldTeacherAgendaRecord[], limit = 12): PublicWorldCurriculumLoopEvent[] {
  return agendas
    .map((agenda): PublicWorldCurriculumLoopEvent | null => {
      const status = agenda.draftStatus;
      if (status !== "review-draft-created" && status !== "review-approved" && status !== "questions-promoted") return null;
      const at = status === "questions-promoted"
        ? agenda.draftPromotedAt ?? agenda.draftUpdatedAt ?? agenda.updatedAt
        : status === "review-approved"
          ? agenda.draftApprovedAt ?? agenda.draftUpdatedAt ?? agenda.updatedAt
          : agenda.draftUpdatedAt ?? agenda.updatedAt;
      return {
        grade: agenda.grade,
        facultyId: agenda.facultyId,
        displayName: agenda.displayName,
        status,
        questionCount: Math.max(0, Math.min(999, publicWorldStoredInteger(status === "questions-promoted" ? agenda.promotedQuestionCount ?? agenda.draftQuestionCount : agenda.draftQuestionCount, 0))),
        at: publicWorldStoredInteger(at, agenda.updatedAt),
      };
    })
    .filter((entry): entry is PublicWorldCurriculumLoopEvent => !!entry && entry.at > 0)
    .sort((a, b) =>
      b.at - a.at ||
      Number(a.grade) - Number(b.grade) ||
      a.facultyId.localeCompare(b.facultyId)
    )
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

function publicWorldTermGradeProgress(studySparkTotal: number): PublicWorldTermGradeProgress {
  const progress = publicWorldTermProgress(studySparkTotal);
  const roomRule = publicWorldTermRoomRule(progress.level);
  return {
    ...progress,
    activeRuleLabels: publicWorldTermRuleLabels(progress.level),
    ...(roomRule ? { roomRule } : {}),
  };
}

function publicWorldCohortTermRecordsFromSummary(
  schoolYear: string,
  gradeProgress: Partial<Record<Grade, PublicWorldTermGradeProgress>>,
  summary: Pick<PublicWorldSummarySnapshot, "curriculumLoops" | "curriculumLoopHistory">,
  now: number,
): PublicWorldCohortTermRecord[] {
  const loops = normalizePublicWorldCurriculumLoopSummary(summary.curriculumLoops);
  const history = normalizePublicWorldCurriculumLoopHistory(summary.curriculumLoopHistory);
  return GRADES.map((grade) => {
    const progress = gradeProgress[grade] ?? publicWorldTermGradeProgress(0);
    const loopRow = loops.byGrade[grade] ?? { inReview: 0, promoted: 0 };
    const loopHistory = history.filter((entry) => entry.grade === grade).slice(0, 6);
    return {
      id: publicWorldCohortTermRecordId(schoolYear, grade),
      schoolYear,
      termId: schoolYear,
      grade,
      totalSparks: publicWorldStoredInteger(progress.totalSparks, 0),
      level: publicWorldStoredInteger(progress.level, 0),
      label: publicWorldStoredText(progress.label, 80) || publicWorldTermProgress(progress.totalSparks).label,
      activeRuleLabels: publicWorldStoredTextList(progress.activeRuleLabels, 8, 80),
      curriculumLoops: {
        inReview: Math.min(999, publicWorldStoredInteger(loopRow.inReview, 0)),
        promoted: Math.min(999, publicWorldStoredInteger(loopRow.promoted, 0)),
      },
      curriculumLoopHistory: loopHistory,
      ...(progress.roomRule ? { roomRule: progress.roomRule } : {}),
      updatedAt: now,
    };
  });
}

function publicWorldTermRecordFromSummary(summary: PublicWorldSummarySnapshot, now: number): PublicWorldTermRecord {
  const schoolYear = /^\d{4}-\d{4}$/.test(summary.schoolYear) ? summary.schoolYear : schoolYearForTimestamp(now);
  const termProgress = summary.termProgress;
  const totalSparks = publicWorldStoredInteger(termProgress.totalSparks, 0);
  const level = publicWorldStoredInteger(termProgress.level, 0);
  const nextLevelAt = Math.max(1, publicWorldStoredInteger(termProgress.nextLevelAt, 3));
  const sparksToNextLevel = publicWorldStoredInteger(termProgress.sparksToNextLevel, nextLevelAt);
  const label = publicWorldStoredText(termProgress.label, 80) || publicWorldTermProgress(totalSparks).label;
  const gradeProgress: Partial<Record<Grade, PublicWorldTermGradeProgress>> = {};
  for (const grade of GRADES) {
    gradeProgress[grade] = publicWorldTermGradeProgress(summary.studySparks.byGrade[grade] ?? 0);
  }
  const cohortTerms = publicWorldCohortTermRecordsFromSummary(schoolYear, gradeProgress, summary, now);
  return {
    id: publicWorldTermRecordId(schoolYear),
    schoolYear,
    termId: schoolYear,
    totalSparks,
    level,
    nextLevelAt,
    sparksToNextLevel,
    label,
    activeRuleLabels: publicWorldTermRuleLabels(level),
    curriculumLoops: normalizePublicWorldCurriculumLoopSummary(summary.curriculumLoops),
    curriculumLoopHistory: normalizePublicWorldCurriculumLoopHistory(summary.curriculumLoopHistory),
    cohortTerms,
    gradeProgress,
    updatedAt: now,
  };
}

function publicWorldTermRecordContentKey(term: PublicWorldTermRecord): string {
  return JSON.stringify({
    schoolYear: term.schoolYear,
    termId: term.termId,
    totalSparks: term.totalSparks,
    level: term.level,
    nextLevelAt: term.nextLevelAt,
    sparksToNextLevel: term.sparksToNextLevel,
    label: term.label,
    activeRuleLabels: term.activeRuleLabels,
    curriculumLoops: normalizePublicWorldCurriculumLoopSummary(term.curriculumLoops),
    curriculumLoopHistory: normalizePublicWorldCurriculumLoopHistory(term.curriculumLoopHistory),
    cohortTerms: normalizePublicWorldCohortTermRecords(term.cohortTerms),
    gradeProgress: term.gradeProgress,
  });
}

function publicWorldTeacherAgendaId(schoolYear: string, grade: Grade, facultyId: string): string {
  const digest = createHash("sha256").update(`${schoolYear}:${grade}:${facultyId}`).digest("hex").slice(0, 16);
  return `teacher:agenda:${digest}`;
}

function publicWorldTeacherAgendaExecution(
  mode: "manual-curation" | "generate",
  exhaustedSessions: unknown,
  lowPoolSessions: unknown,
  repetitionPressure: unknown,
  termRule?: PublicWorldTermRoomRule,
): Pick<PublicWorldTeacherAgendaRecord, "executionStatus" | "executionReason" | "nextAction" | "priorityScore" | "termRuleLabel" | "termRuleTarget"> {
  const exhausted = publicWorldStoredInteger(exhaustedSessions, 0);
  const low = publicWorldStoredInteger(lowPoolSessions, 0);
  const pressure = publicWorldStoredRatio(repetitionPressure);
  const ruleLabel = publicWorldStoredText(termRule?.label, 80);
  const ruleTarget = termRule ? Math.max(1, Math.min(99, publicWorldStoredInteger(termRule.target, 0))) : 0;
  const hasRulePressure = !!ruleLabel && low > 0;
  const executionReason = exhausted > 0
    ? "exhausted-pool"
    : pressure >= 0.5
      ? "repetition-pressure"
      : hasRulePressure
        ? "term-rule-pressure"
      : "low-pool";
  const executionStatus = exhausted > 0 || pressure >= 0.5 || hasRulePressure
    ? "ready"
    : low > 0
      ? "queued"
      : "watching";
  const nextAction = executionStatus !== "ready"
    ? "monitor-coverage"
    : mode === "generate"
      ? "generate-draft"
      : "manual-curation";
  const priorityScore = Math.min(9999, exhausted * 100 + low * 25 + Math.round(pressure * 100) + (hasRulePressure ? ruleTarget * 50 : 0));
  return {
    executionStatus,
    executionReason,
    nextAction,
    priorityScore,
    ...(hasRulePressure ? { termRuleLabel: ruleLabel, termRuleTarget: ruleTarget } : {}),
  };
}

function publicWorldTeacherAgendaDraftFields(source: unknown): Partial<Pick<
  PublicWorldTeacherAgendaRecord,
  "draftId" | "draftStatus" | "draftQuestionCount" | "draftUpdatedAt" | "draftApprovedAt" | "draftPromotedAt" | "promotedQuestionCount"
>> {
  if (!source || typeof source !== "object") return {};
  const record = source as Partial<PublicWorldTeacherAgendaRecord> & Record<string, unknown>;
  const draftId = publicWorldStoredText(record.draftId, 120);
  const draftStatus = record.draftStatus === "review-draft-created" || record.draftStatus === "review-approved" || record.draftStatus === "questions-promoted"
    ? record.draftStatus
    : null;
  if (!draftId || !draftStatus) return {};
  const draftQuestionCount = Math.min(999, publicWorldStoredInteger(record.draftQuestionCount, 0));
  const draftUpdatedAt = publicWorldStoredInteger(record.draftUpdatedAt, 0);
  const draftApprovedAt = publicWorldStoredInteger(record.draftApprovedAt, 0);
  const draftPromotedAt = publicWorldStoredInteger(record.draftPromotedAt, 0);
  const promotedQuestionCount = Math.min(999, publicWorldStoredInteger(record.promotedQuestionCount, 0));
  return {
    draftId,
    draftStatus,
    draftQuestionCount,
    ...(draftUpdatedAt > 0 ? { draftUpdatedAt } : {}),
    ...(draftApprovedAt > 0 ? { draftApprovedAt } : {}),
    ...(draftPromotedAt > 0 ? { draftPromotedAt } : {}),
    ...(promotedQuestionCount > 0 ? { promotedQuestionCount } : {}),
  };
}

function normalizePublicWorldRoomRecord(raw: unknown): PublicWorldRoomRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const schoolYear = typeof source.schoolYear === "string" && /^\d{4}-\d{4}$/.test(source.schoolYear)
    ? source.schoolYear
    : "";
  const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
    ? source.grade as Grade
    : null;
  const facultyId = publicWorldRoomId(typeof source.facultyId === "string" ? source.facultyId : "");
  if (!schoolYear || !grade || !facultyId) return null;
  const key = publicWorldRoomRecordKey(schoolYear, grade, facultyId);
  if (typeof source.key === "string" && source.key !== key) return null;
  const rawGoal = source.goal && typeof source.goal === "object" ? source.goal as Record<string, unknown> : {};
  const target = Math.max(1, publicWorldStoredInteger(rawGoal.target, 3));
  const progress = Math.min(target, publicWorldStoredInteger(rawGoal.progress, 0));
  const updatedAt = publicWorldStoredInteger(source.updatedAt, 0);
  if (updatedAt <= 0) return null;
  const ruleLabel = publicWorldStoredText(rawGoal.ruleLabel, 80);
  return {
    key,
    schoolYear,
    termId: typeof source.termId === "string" && source.termId.trim() ? source.termId.trim().slice(0, 48) : schoolYear,
    grade,
    facultyId,
    displayName: publicWorldRoomDisplayName(typeof source.displayName === "string" ? source.displayName : facultyId, facultyId),
    activeStudents: publicWorldStoredInteger(source.activeStudents, 0),
    goal: {
      kind: "live-class",
      label: typeof rawGoal.label === "string" ? rawGoal.label.slice(0, 120) : `${facultyId} live class ${progress}/${target}`,
      progress,
      target,
      complete: !!rawGoal.complete || progress >= target,
      updatedAt: publicWorldStoredInteger(rawGoal.updatedAt, 0),
      ...(ruleLabel ? { ruleLabel } : {}),
    },
    updatedAt,
  };
}

function normalizePublicWorldRoomOutcomeRecord(raw: unknown): PublicWorldRoomOutcomeRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const day = typeof source.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.day) ? source.day : "";
  const schoolYear = typeof source.schoolYear === "string" && /^\d{4}-\d{4}$/.test(source.schoolYear)
    ? source.schoolYear
    : "";
  const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
    ? source.grade as Grade
    : null;
  const facultyId = publicWorldRoomId(typeof source.facultyId === "string" ? source.facultyId : "");
  if (!day || !schoolYear || !grade || !facultyId) return null;
  if (source.goalKind !== undefined && source.goalKind !== "live-class") return null;
  const id = publicWorldRoomOutcomeId(day, grade, facultyId);
  if (typeof source.id === "string" && source.id !== id) return null;
  const target = Math.max(1, Math.min(99, publicWorldStoredInteger(source.target, 3)));
  const progress = Math.min(target, publicWorldStoredInteger(source.progress, target));
  const contributorCount = Math.min(999, publicWorldStoredInteger(source.contributorCount, progress));
  const completedAt = publicWorldStoredInteger(source.completedAt, 0);
  const createdAt = publicWorldStoredInteger(source.createdAt, completedAt);
  if (completedAt <= 0 || createdAt <= 0) return null;
  const displayName = publicWorldRoomDisplayName(typeof source.displayName === "string" ? source.displayName : facultyId, facultyId);
  const roomTitle = publicWorldStoredText(source.roomTitle, 120) || publicWorldRoomOutcomeRoomTitle(displayName);
  const summaryLabel = publicWorldStoredText(source.summaryLabel, 180) || publicWorldRoomOutcomeSummaryLabel(displayName, progress, target, contributorCount);
  const rewardKind = source.rewardKind === "study-spark" ? source.rewardKind : "study-spark";
  const rewardLabel = publicWorldStoredText(source.rewardLabel, 180) || publicWorldRoomOutcomeRewardLabel(displayName);
  const ruleLabel = publicWorldStoredText(source.ruleLabel, 80);
  const bonusLabel = publicWorldStoredText(source.bonusLabel, 120);
  return {
    id,
    schoolYear,
    termId: typeof source.termId === "string" && source.termId.trim() ? source.termId.trim().slice(0, 48) : schoolYear,
    day,
    grade,
    facultyId,
    displayName,
    goalKind: "live-class",
    roomTitle,
    summaryLabel,
    rewardKind,
    rewardLabel,
    ...(ruleLabel ? { ruleLabel } : {}),
    ...(bonusLabel ? { bonusLabel } : {}),
    progress,
    target,
    contributorCount,
    completedAt,
    createdAt,
  };
}

function normalizePublicWorldTermRecord(raw: unknown): PublicWorldTermRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const schoolYear = typeof source.schoolYear === "string" && /^\d{4}-\d{4}$/.test(source.schoolYear)
    ? source.schoolYear
    : "";
  if (!schoolYear) return null;
  const id = publicWorldTermRecordId(schoolYear);
  if (typeof source.id === "string" && source.id !== id) return null;
  const termId = typeof source.termId === "string" && source.termId.trim() ? source.termId.trim().slice(0, 48) : schoolYear;
  const totalSparks = publicWorldStoredInteger(source.totalSparks, 0);
  const progress = publicWorldTermProgress(totalSparks);
  const level = publicWorldStoredInteger(source.level, progress.level);
  const nextLevelAt = Math.max(1, publicWorldStoredInteger(source.nextLevelAt, progress.nextLevelAt));
  const sparksToNextLevel = publicWorldStoredInteger(source.sparksToNextLevel, progress.sparksToNextLevel);
  const label = publicWorldStoredText(source.label, 80) || progress.label;
  const activeRuleLabels = publicWorldStoredTextList(source.activeRuleLabels, 8, 80);
  const curriculumLoops = normalizePublicWorldCurriculumLoopSummary(source.curriculumLoops);
  const curriculumLoopHistory = normalizePublicWorldCurriculumLoopHistory(source.curriculumLoopHistory);
  const gradeProgress = normalizePublicWorldTermGradeProgressMap(source.gradeProgress);
  const cohortTerms = normalizePublicWorldCohortTermRecords(source.cohortTerms);
  const updatedAt = publicWorldStoredInteger(source.updatedAt, 0);
  if (updatedAt <= 0) return null;
  return {
    id,
    schoolYear,
    termId,
    totalSparks,
    level,
    nextLevelAt,
    sparksToNextLevel,
    label,
    activeRuleLabels,
    curriculumLoops,
    curriculumLoopHistory,
    cohortTerms,
    gradeProgress,
    updatedAt,
  };
}

function normalizePublicWorldCohortTermRecords(raw: unknown): PublicWorldCohortTermRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): PublicWorldCohortTermRecord | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const schoolYear = typeof source.schoolYear === "string" && /^\d{4}-\d{4}$/.test(source.schoolYear)
        ? source.schoolYear
        : "";
      const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
        ? source.grade as Grade
        : null;
      if (!schoolYear || !grade) return null;
      const id = publicWorldCohortTermRecordId(schoolYear, grade);
      if (typeof source.id === "string" && source.id !== id) return null;
      const totalSparks = publicWorldStoredInteger(source.totalSparks, 0);
      const progress = publicWorldTermGradeProgress(totalSparks);
      const level = publicWorldStoredInteger(source.level, progress.level);
      const roomRule = normalizePublicWorldTermRoomRule(source.roomRule, level);
      const curriculumLoops = normalizePublicWorldCurriculumLoopSummary({
        inReview: publicWorldStoredInteger((source.curriculumLoops as { inReview?: unknown } | undefined)?.inReview, 0),
        promoted: publicWorldStoredInteger((source.curriculumLoops as { promoted?: unknown } | undefined)?.promoted, 0),
        byGrade: {},
      });
      const updatedAt = publicWorldStoredInteger(source.updatedAt, 0);
      if (updatedAt <= 0) return null;
      return {
        id,
        schoolYear,
        termId: typeof source.termId === "string" && source.termId.trim() ? source.termId.trim().slice(0, 48) : schoolYear,
        grade,
        totalSparks,
        level,
        label: publicWorldStoredText(source.label, 80) || progress.label,
        activeRuleLabels: publicWorldStoredTextList(source.activeRuleLabels, 8, 80),
        curriculumLoops: {
          inReview: curriculumLoops.inReview,
          promoted: curriculumLoops.promoted,
        },
        curriculumLoopHistory: normalizePublicWorldCurriculumLoopHistory(source.curriculumLoopHistory).filter((item) => item.grade === grade).slice(0, 6),
        ...(roomRule ? { roomRule } : {}),
        updatedAt,
      };
    })
    .filter((entry): entry is PublicWorldCohortTermRecord => !!entry)
    .sort((a, b) => Number(a.grade) - Number(b.grade));
}

function normalizePublicWorldTermGradeProgressMap(raw: unknown): Partial<Record<Grade, PublicWorldTermGradeProgress>> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Partial<Record<Grade, PublicWorldTermGradeProgress>> = {};
  for (const grade of GRADES) {
    const row = source[grade] && typeof source[grade] === "object" ? source[grade] as Record<string, unknown> : {};
    const totalSparks = publicWorldStoredInteger(row.totalSparks, 0);
    const fallback = publicWorldTermGradeProgress(totalSparks);
    const level = publicWorldStoredInteger(row.level, fallback.level);
    const nextLevelAt = Math.max(1, publicWorldStoredInteger(row.nextLevelAt, fallback.nextLevelAt));
    const sparksToNextLevel = publicWorldStoredInteger(row.sparksToNextLevel, fallback.sparksToNextLevel);
    const label = publicWorldStoredText(row.label, 80) || fallback.label;
    const activeRuleLabels = publicWorldStoredTextList(row.activeRuleLabels, 8, 80);
    const roomRule = normalizePublicWorldTermRoomRule(row.roomRule, level);
    out[grade] = {
      totalSparks,
      level,
      nextLevelAt,
      sparksToNextLevel,
      label,
      activeRuleLabels: activeRuleLabels.length > 0 ? activeRuleLabels : publicWorldTermRuleLabels(level),
      ...(roomRule ? { roomRule } : {}),
    };
  }
  return out;
}

function normalizePublicWorldCurriculumLoopSummary(raw: unknown): PublicWorldCurriculumLoopSummary {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const byGradeSource = source.byGrade && typeof source.byGrade === "object" && !Array.isArray(source.byGrade)
    ? source.byGrade as Record<string, unknown>
    : {};
  const byGrade: PublicWorldCurriculumLoopSummary["byGrade"] = {};
  let derivedInReview = 0;
  let derivedPromoted = 0;
  for (const grade of GRADES) {
    const rawGrade = byGradeSource[grade] && typeof byGradeSource[grade] === "object" ? byGradeSource[grade] as Record<string, unknown> : null;
    if (!rawGrade) continue;
    const inReview = Math.min(999, publicWorldStoredInteger(rawGrade.inReview, 0));
    const promoted = Math.min(999, publicWorldStoredInteger(rawGrade.promoted, 0));
    if (inReview <= 0 && promoted <= 0) continue;
    byGrade[grade] = { inReview, promoted };
    derivedInReview += inReview;
    derivedPromoted += promoted;
  }
  return {
    inReview: Math.min(9999, publicWorldStoredInteger(source.inReview, derivedInReview)),
    promoted: Math.min(9999, publicWorldStoredInteger(source.promoted, derivedPromoted)),
    byGrade,
  };
}

function normalizePublicWorldCurriculumLoopHistory(raw: unknown): PublicWorldCurriculumLoopEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): PublicWorldCurriculumLoopEvent | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
        ? source.grade as Grade
        : null;
      const facultyId = publicWorldRoomId(typeof source.facultyId === "string" ? source.facultyId : "");
      const status = source.status === "review-draft-created" || source.status === "review-approved" || source.status === "questions-promoted"
        ? source.status
        : null;
      const at = publicWorldStoredInteger(source.at, 0);
      if (!grade || !facultyId || !status || at <= 0) return null;
      return {
        grade,
        facultyId,
        displayName: publicWorldRoomDisplayName(typeof source.displayName === "string" ? source.displayName : facultyId, facultyId),
        status,
        questionCount: Math.min(999, publicWorldStoredInteger(source.questionCount, 0)),
        at,
      };
    })
    .filter((entry): entry is PublicWorldCurriculumLoopEvent => !!entry)
    .sort((a, b) =>
      b.at - a.at ||
      Number(a.grade) - Number(b.grade) ||
      a.facultyId.localeCompare(b.facultyId)
    )
    .slice(0, 12);
}

function normalizePublicWorldTermRoomRule(raw: unknown, level: number): PublicWorldTermRoomRule | undefined {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!source) return publicWorldTermRoomRule(level);
  const kind = source.kind === "term-momentum" || source.kind === "term-rally" ? source.kind : null;
  if (!kind) return publicWorldTermRoomRule(level);
  const fallback = publicWorldTermRoomRule(level);
  const fallbackLabel = fallback?.label || (kind === "term-rally" ? "Term Rally" : "Term Momentum");
  const fallbackTarget = fallback?.target || (kind === "term-rally" ? 4 : 2);
  const label = publicWorldStoredText(source.label, 80) || fallbackLabel;
  const target = Math.max(1, Math.min(99, publicWorldStoredInteger(source.target, fallbackTarget)));
  return { kind, label, target };
}

function normalizePublicWorldTeacherAgendaRecord(raw: unknown): PublicWorldTeacherAgendaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const schoolYear = typeof source.schoolYear === "string" && /^\d{4}-\d{4}$/.test(source.schoolYear)
    ? source.schoolYear
    : "";
  const grade = typeof source.grade === "string" && (GRADES as readonly string[]).includes(source.grade)
    ? source.grade as Grade
    : null;
  const facultyId = publicWorldRoomId(typeof source.facultyId === "string" ? source.facultyId : "");
  if (!schoolYear || !grade || !facultyId) return null;
  const id = publicWorldTeacherAgendaId(schoolYear, grade, facultyId);
  if (typeof source.id === "string" && source.id !== id) return null;
  if (source.agendaKind !== undefined && source.agendaKind !== "curriculum-replenishment") return null;
  const mode = source.mode === "manual-curation" || source.mode === "generate" ? source.mode : null;
  if (!mode) return null;
  const targetDifficulty = source.targetDifficulty === "easy" || source.targetDifficulty === "medium" || source.targetDifficulty === "hard"
    ? source.targetDifficulty
    : null;
  if (!targetDifficulty) return null;
  const generatedAt = publicWorldStoredInteger(source.generatedAt, 0);
  const updatedAt = publicWorldStoredInteger(source.updatedAt, generatedAt);
  if (generatedAt <= 0 || updatedAt <= 0) return null;
  const lowPoolSessions = Math.min(999, publicWorldStoredInteger(source.lowPoolSessions, 0));
  const exhaustedSessions = Math.min(999, publicWorldStoredInteger(source.exhaustedSessions, 0));
  const repetitionPressure = publicWorldStoredRatio(source.repetitionPressure);
  const rawTermRuleLabel = publicWorldStoredText(source.termRuleLabel, 80);
  const rawTermRuleTarget = rawTermRuleLabel ? Math.max(1, Math.min(99, publicWorldStoredInteger(source.termRuleTarget, 0))) : 0;
  const rawTermRuleKind: PublicWorldTermRoomRule["kind"] = rawTermRuleLabel === "Term Momentum" ? "term-momentum" : "term-rally";
  const execution = publicWorldTeacherAgendaExecution(mode, exhaustedSessions, lowPoolSessions, repetitionPressure, rawTermRuleLabel && rawTermRuleTarget
    ? { kind: rawTermRuleKind, label: rawTermRuleLabel, target: rawTermRuleTarget }
    : undefined);
  const executionStatus = source.executionStatus === "ready" || source.executionStatus === "queued" || source.executionStatus === "watching"
    ? source.executionStatus
    : execution.executionStatus;
  const executionReason = source.executionReason === "exhausted-pool" || source.executionReason === "repetition-pressure" || source.executionReason === "term-rule-pressure" || source.executionReason === "low-pool"
    ? source.executionReason
    : execution.executionReason;
  const nextAction = source.nextAction === "generate-draft" || source.nextAction === "manual-curation" || source.nextAction === "monitor-coverage"
    ? source.nextAction
    : execution.nextAction;
  return {
    id,
    schoolYear,
    termId: typeof source.termId === "string" && source.termId.trim() ? source.termId.trim().slice(0, 48) : schoolYear,
    grade,
    facultyId,
    displayName: publicWorldRoomDisplayName(typeof source.displayName === "string" ? source.displayName : facultyId, facultyId),
    agendaKind: "curriculum-replenishment",
    mode,
    executionStatus,
    executionReason,
    nextAction,
    priorityScore: Math.min(9999, publicWorldStoredInteger(source.priorityScore, execution.priorityScore)),
    ...(rawTermRuleLabel ? { termRuleLabel: rawTermRuleLabel } : execution.termRuleLabel ? { termRuleLabel: execution.termRuleLabel } : {}),
    ...(rawTermRuleTarget ? { termRuleTarget: rawTermRuleTarget } : execution.termRuleTarget ? { termRuleTarget: execution.termRuleTarget } : {}),
    ...publicWorldTeacherAgendaDraftFields(source),
    targetDifficulty,
    targetNewQuestions: Math.min(200, publicWorldStoredInteger(source.targetNewQuestions, 0)),
    lowPoolSessions,
    exhaustedSessions,
    repetitionPressure,
    focusSubjects: publicWorldStoredTextList(source.focusSubjects, 8, 80),
    weakSubjects: publicWorldStoredTextList(source.weakSubjects, 8, 80),
    recentConcepts: publicWorldStoredTextList(source.recentConcepts, 8, 120),
    sourcePacketIds: publicWorldStoredTextList(source.sourcePacketIds, 8, 80),
    corpusId: source.corpusId === null || source.corpusId === undefined ? null : publicWorldStoredText(source.corpusId, 80) || null,
    generatedAt,
    updatedAt,
  };
}

function publicWorldTeacherAgendaContentKey(agenda: PublicWorldTeacherAgendaRecord): string {
  return JSON.stringify({
    schoolYear: agenda.schoolYear,
    termId: agenda.termId,
    grade: agenda.grade,
    facultyId: agenda.facultyId,
    displayName: agenda.displayName,
    agendaKind: agenda.agendaKind,
    mode: agenda.mode,
    executionStatus: agenda.executionStatus,
    executionReason: agenda.executionReason,
    nextAction: agenda.nextAction,
    priorityScore: agenda.priorityScore,
    termRuleLabel: agenda.termRuleLabel ?? null,
    termRuleTarget: agenda.termRuleTarget ?? null,
    draftId: agenda.draftId ?? null,
    draftStatus: agenda.draftStatus ?? null,
    draftQuestionCount: agenda.draftQuestionCount ?? null,
    draftUpdatedAt: agenda.draftUpdatedAt ?? null,
    draftApprovedAt: agenda.draftApprovedAt ?? null,
    draftPromotedAt: agenda.draftPromotedAt ?? null,
    promotedQuestionCount: agenda.promotedQuestionCount ?? null,
    targetDifficulty: agenda.targetDifficulty,
    targetNewQuestions: agenda.targetNewQuestions,
    lowPoolSessions: agenda.lowPoolSessions,
    exhaustedSessions: agenda.exhaustedSessions,
    repetitionPressure: agenda.repetitionPressure,
    focusSubjects: agenda.focusSubjects,
    weakSubjects: agenda.weakSubjects,
    recentConcepts: agenda.recentConcepts,
    sourcePacketIds: agenda.sourcePacketIds,
    corpusId: agenda.corpusId,
  });
}

function schoolYearForTimestamp(value: number): string {
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = month >= 7 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function normalizePublicWorldReportId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  if (!id.startsWith("public-world-report:")) return null;
  if (/[\u0000-\u001f\u007f]/.test(id)) return null;
  return id.slice(0, 160);
}

function normalizePublicWorldHiddenEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const id = normalizePublicWorldEventId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-100);
}

function normalizePublicWorldReportReason(value: unknown): string {
  const reason = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PUBLIC_WORLD_REPORT_REASON_LIMIT);
  return reason || "reported";
}

function normalizePublicWorldModeratorNote(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PUBLIC_WORLD_MODERATOR_NOTE_LIMIT);
}

function normalizePublicWorldEventReports(value: unknown): PublicWorldEventReport[] {
  if (!Array.isArray(value)) return [];
  const out: PublicWorldEventReport[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const source = raw as Record<string, unknown>;
    const eventId = normalizePublicWorldEventId(source.eventId);
    if (!eventId || seen.has(eventId)) continue;
    const createdAt = Math.max(0, Math.floor(Number(source.createdAt) || 0));
    const rawId = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "";
    out.push({
      id: rawId.startsWith("public-world-report:") ? rawId.slice(0, 120) : `public-world-report:${eventId}:${createdAt}`,
      eventId,
      reason: normalizePublicWorldReportReason(source.reason),
      createdAt,
    });
    seen.add(eventId);
  }
  return out.slice(-50);
}

function publicWorldReporterId(sessionId: string): string {
  const hash = createHash("sha256")
    .update(`public-world-reporter:${sessionId}`)
    .digest("hex")
    .slice(0, 16);
  return `world:reporter:${hash}`;
}

function publicWorldModerationEventContext(event: SchoolWorldEvent): PublicWorldModerationReport["event"] {
  const label = "label" in event && typeof event.label === "string"
    ? event.label
    : "roomTitle" in event && typeof event.roomTitle === "string"
      ? event.roomTitle
      : null;
  return {
    id: event.id,
    kind: event.kind,
    at: event.at,
    ...(event.faculty ? { faculty: event.faculty } : {}),
    grade: event.grade,
    label,
  };
}

function persistedPackRecordKey(ownerSessionId: string | null, packId: string): string {
  return `${ownerSessionId ?? "public"}:${packId}`;
}

function isPersistedBuiltInPackOverride(record: StoredContentPackRecord): boolean {
  return record.ownerSessionId === GLOBAL_PACK_OWNER && record.pack?.id === ORIGINAL_PACK_ID;
}

function packInstallationRecordKey(userId: string, packId: string): string {
  return `${userId}:${packId}`;
}

function repairGeneratedPortraitAssetRefs(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  let repaired = false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const current = value[i];
      if (typeof current === "string") {
        const rewritten = rewriteGeneratedPortraitS3Url(current);
        if (rewritten) {
          value[i] = rewritten;
          repaired = true;
        }
      } else if (repairGeneratedPortraitAssetRefs(current, seen)) {
        repaired = true;
      }
    }
    return repaired;
  }
  const record = value as Record<string, unknown>;
  for (const [key, current] of Object.entries(record)) {
    if (typeof current === "string") {
      const rewritten = rewriteGeneratedPortraitS3Url(current);
      if (rewritten) {
        record[key] = rewritten;
        repaired = true;
      }
    } else if (repairGeneratedPortraitAssetRefs(current, seen)) {
      repaired = true;
    }
  }
  return repaired;
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
  const answerStats = normalizeAnswerStats((s as { answerStats?: AnswerStats }).answerStats ?? answerStatsFromHistory(s.history));
  return {
    ...s,
    askedQuestionIds: Array.isArray(s.askedQuestionIds) ? s.askedQuestionIds : [],
    cardMemory: s.cardMemory && typeof s.cardMemory === "object" ? s.cardMemory : {},
    roomBoards: s.roomBoards && typeof s.roomBoards === "object" ? s.roomBoards : {},
    history: Array.isArray(s.history) ? s.history.slice(-ANSWER_HISTORY_LIMIT) : [],
    answerStats,
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
    publicWorldHiddenEventIds: normalizePublicWorldHiddenEventIds((s as { publicWorldHiddenEventIds?: unknown }).publicWorldHiddenEventIds),
    publicWorldEventReports: normalizePublicWorldEventReports((s as { publicWorldEventReports?: unknown }).publicWorldEventReports),
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
    share_artifact_created: 0,
    share_initiated: 0,
    share_link_visited: 0,
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
    firstBellReportAwarded: 0,
    firstDailyClassPassed: 0,
    firstGradeCompleted: 0,
  };
  const funnel = {
    firstCharacterCreated: 0,
    firstQuestionAnswered: 0,
    firstBellReportAwarded: 0,
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
  const referredVisitors = new Set<string>();
  const referral = {
    artifactsCreated: 0,
    sharesInitiated: 0,
    linkVisits: 0,
    uniqueReferredVisitors: 0,
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
  const payingSessions = new Set<string>();
  const revenueBySource: Record<string, number> = {};
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
      else if (event.step === "first_bell_report_awarded") funnel.firstBellReportAwarded += 1;
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
          else if (event.step === "first_bell_report_awarded") first10m.firstBellReportAwarded += 1;
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
    } else if (event.name === "share_artifact_created") {
      referral.artifactsCreated += 1;
    } else if (event.name === "share_initiated") {
      referral.sharesInitiated += 1;
    } else if (event.name === "share_link_visited") {
      referral.linkVisits += 1;
      if (event.visitorHash) referredVisitors.add(event.visitorHash);
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
      const hpDelta = metricIntegerOrZero(event.hallPassesDelta);
      commerce.hallPassesDelta += hpDelta;
      commerce.meritStarsDelta += metricIntegerOrZero(event.meritStarsDelta);
      commerce.photoDayCreditsDelta += metricIntegerOrZero(event.photoDayCreditsDelta);
      commerce.amountCents += metricIntegerOrZero(event.amountCents);
      if (hpDelta > 0 && event.sessionId) payingSessions.add(event.sessionId);
      const src = event.source || "unknown";
      revenueBySource[src] = (revenueBySource[src] ?? 0) + metricIntegerOrZero(event.amountCents);
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
  referral.uniqueReferredVisitors = referredVisitors.size;
  const conversionFunnel = {
    totalVisitors: visitorHashes.size,
    charactersCreated: funnel.firstCharacterCreated,
    payers: payingSessions.size,
    visitorToCharacterRate: visitorHashes.size > 0 ? funnel.firstCharacterCreated / visitorHashes.size : null,
    characterToPayerRate: funnel.firstCharacterCreated > 0 ? payingSessions.size / funnel.firstCharacterCreated : null,
    visitorToPayerRate: visitorHashes.size > 0 ? payingSessions.size / visitorHashes.size : null,
  };
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
    referral,
    guestSpotlight,
    balance,
    commerce: {
      events: commerce.events,
      hallPassesDelta: commerce.hallPassesDelta,
      meritStarsDelta: commerce.meritStarsDelta,
      photoDayCreditsDelta: commerce.photoDayCreditsDelta,
      amountCents: commerce.amountCents,
      revenueBySource,
      payingSessions: payingSessions.size,
    },
    conversionFunnel,
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
  characterD7: {
    eligibleSessions: number;
    returnedSessions: number;
    rate: number | null;
  };
  visitorD7: {
    eligibleVisitors: number;
    returnedVisitors: number;
    rate: number | null;
  };
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const orderedEvents = Array.from(events).sort((a, b) => a.occurredAt - b.occurredAt);
  const characterCreatedBySession = new Map<string, number>();
  const returnedCharacterSessions = new Set<string>();
  const visitorFirstSeen = new Map<string, number>();
  const returnedVisitors = new Set<string>();
  const latestReturnBySession = new Map<string, number>();
  const latestReturnByVisitor = new Map<string, number>();

  for (const event of orderedEvents) {
    if (event.name === "funnel_step" && event.step === "first_character_created" && event.sessionId) {
      if (!characterCreatedBySession.has(event.sessionId)) characterCreatedBySession.set(event.sessionId, event.occurredAt);
      continue;
    }
    if ((event.name === "app_open" || event.name === "session_resume") && event.sessionId) {
      const createdAt = characterCreatedBySession.get(event.sessionId);
      if (createdAt != null && event.occurredAt - createdAt >= dayMs) returnedCharacterSessions.add(event.sessionId);
      const prevReturn = latestReturnBySession.get(event.sessionId);
      if (prevReturn == null || event.occurredAt > prevReturn) latestReturnBySession.set(event.sessionId, event.occurredAt);
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
      const prevReturn = latestReturnByVisitor.get(event.visitorHash);
      if (prevReturn == null || event.occurredAt > prevReturn) latestReturnByVisitor.set(event.visitorHash, event.occurredAt);
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

  // D7: characters created >= 7 days ago who returned >= 7 days after creation
  let eligibleSessionsD7 = 0;
  let returnedEligibleSessionsD7 = 0;
  for (const [sessionId, createdAt] of characterCreatedBySession) {
    if (now - createdAt >= weekMs) {
      eligibleSessionsD7 += 1;
      if (returnedCharacterSessions.has(sessionId)) {
        const latestReturn = latestReturnBySession.get(sessionId);
        if (latestReturn != null && latestReturn - createdAt >= weekMs) returnedEligibleSessionsD7 += 1;
      }
    }
  }
  // D7: visitors first seen >= 7 days ago who returned >= 7 days after first seen
  let eligibleVisitorsD7 = 0;
  let returnedEligibleVisitorsD7 = 0;
  for (const [visitorHash, firstSeenAt] of visitorFirstSeen) {
    if (now - firstSeenAt >= weekMs) {
      eligibleVisitorsD7 += 1;
      if (returnedVisitors.has(visitorHash)) {
        const latestReturn = latestReturnByVisitor.get(visitorHash);
        if (latestReturn != null && latestReturn - firstSeenAt >= weekMs) returnedEligibleVisitorsD7 += 1;
      }
    }
  }
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
    characterD7: {
      eligibleSessions: eligibleSessionsD7,
      returnedSessions: returnedEligibleSessionsD7,
      rate: eligibleSessionsD7 > 0 ? returnedEligibleSessionsD7 / eligibleSessionsD7 : null,
    },
    visitorD7: {
      eligibleVisitors: eligibleVisitorsD7,
      returnedVisitors: returnedEligibleVisitorsD7,
      rate: eligibleVisitorsD7 > 0 ? returnedEligibleVisitorsD7 / eligibleVisitorsD7 : null,
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

function curriculumQuestionConceptLabel(question: BankedQuestion): string {
  const subject = question.subject || "general";
  if (question.sourceCardId) return `${subject} via ${question.sourceCardId}`;
  return subject;
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
  const yearbook = c.yearbook.map((entry) => {
    const name = entry.name ?? c.name;
    const completedAt = Number(entry.completedAt) || Date.now();
    return {
      ...entry,
      name,
      playbookId: entry.playbookId ?? c.playbookId,
      stats: entry.stats ?? c.stats,
      ...(entry.portraitDataUrl ?? c.portraitDataUrl
        ? { portraitDataUrl: entry.portraitDataUrl ?? c.portraitDataUrl }
        : {}),
      ...(entry.flavorQuote ?? c.flavorQuote
        ? { flavorQuote: entry.flavorQuote ?? c.flavorQuote }
        : {}),
      arcAnswer: entry.arcAnswer ?? c.arcAnswer,
      diploma: entry.diploma ?? gradeDiplomaCollectibleFor({
        characterName: name,
        characterCreatedAt: c.createdAt,
        grade: entry.grade,
        completedAt,
      }),
    };
  });
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
