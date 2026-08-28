export type Choice = "A" | "B" | "C" | "D";

export const CHOICES: Choice[] = ["A", "B", "C", "D"];

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export type GuestPackMode = "auto" | "override";

/** Ruby HIGH School — only grades 9-12 (Freshman, Sophomore, Junior, Senior).
 *  Players start at Freshman and progress year by year. Each year completes
 *  when the player clears the daily-class and subject-grade gates. After
 *  Senior, graduation closes the run. */
export type Grade = "9" | "10" | "11" | "12";

export const GRADES: Grade[] = ["9", "10", "11", "12"];

/** Class-year labels rendered in the UI. */
export const GRADE_LABELS: Record<Grade, string> = {
  "9": "Freshman",
  "10": "Sophomore",
  "11": "Junior",
  "12": "Senior",
};

export const GRADE_SHORT_LABELS: Record<Grade, string> = {
  "9": "FR",
  "10": "SO",
  "11": "JR",
  "12": "SR",
};

/** Players start at Freshman year. The yearbook loop is the arc:
 *  pass enough daily classes and clear enough subject grades to advance. */
export const DEFAULT_GRADE: Grade = "9";

/** Legacy card rarity. Kept for old persisted states; new credit and streak
 *  mechanics are driven by question stat + correctness. */
export type Rarity = "common" | "rare" | "legendary";

export const RARITIES: Rarity[] = ["common", "rare", "legendary"];

/** Legacy rarity weights. */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 0.6,
  rare: 0.3,
  legendary: 0.1,
};

/** Legacy rarity XP table. */
export const XP_FOR_RARITY: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  legendary: 2,
};

export function xpForRarity(r: Rarity | undefined): number {
  return r ? XP_FOR_RARITY[r] : 0;
}

/** Legacy rarity roll helper. New questions do not call this. */
export function rollRarity(rng: () => number = Math.random): Rarity {
  const r = rng();
  let acc = 0;
  for (const k of RARITIES) {
    acc += RARITY_WEIGHTS[k];
    if (r < acc) return k;
  }
  return "common";
}

/** Legacy per-grade daily target. Current daily-class counters tick on the
 *  first passed daily class of the day. */
export function legendariesPerDayFor(grade: Grade): number {
  switch (grade) {
    case "9":  return 1;
    case "10": return 1;
    case "11": return 2;
    case "12": return 3;
  }
}

/** Per-grade cap on "Roll for advantage" usage. The player gets this many
 *  rolls in EACH grade (Freshman, Sophomore, Junior, Senior). Once spent
 *  for a grade, the advantage button is disabled until they advance. The
 *  per-grade reset happens implicitly because the counter is keyed by
 *  grade — entering a new grade reads 0 from the new key.
 *  Tuned at 3 to keep rolls scarce enough to feel meaningful while not
 *  hard-walling the player out of help on their first few questions. */
export const ADVANTAGE_ROLLS_PER_GRADE = 3;

/** Per-grade daily-class day count: how many distinct days of required
 *  classroom progress the player must pass to advance OUT of `grade`.
 *  Stored in the legacy `streak` field.
 *
 *    Freshman → 1 daily class
 *    Sophomore → 1 daily class
 *    Junior → 2 daily classes
 *    Senior → 3 daily classes
 *
 *  Combined with the per-year classroom-count gate, these are the two
 *  gates a player must clear to advance years. */
export function requiredStreakForGrade(grade: Grade): number {
  switch (grade) {
    case "9": return 1;
    case "10": return 1;
    case "11": return 2;
    case "12": return 3;
  }
}

/** The daily-class counter also accelerates score payouts. A carried count of
 *  2 pays 2x, 3 pays 3x, and 4+ pays the capped Daily Class Bonus at 5x. */
export function streakScoreMultiplier(streakCount: number | undefined | null): number {
  const n = Math.max(0, Math.floor(Number(streakCount ?? 0)));
  if (n >= 4) return 5;
  if (n >= 3) return 3;
  if (n >= 2) return 2;
  return 1;
}

export function letterGradePasses(grade: string | undefined | null): boolean {
  return !!grade && /^[ABC]/.test(grade);
}

/** Difficulty progression up the high school years. */
export function difficultyForGrade(grade: Grade): Difficulty {
  if (grade === "9") return "easy";
  if (grade === "10" || grade === "11") return "medium";
  return "hard";
}

/** Question-bank level cap for each school year. The scheduler weights within
 *  this unlocked set instead of hard-locking every year to one level. */
export function difficultiesForGrade(grade: Grade): Difficulty[] {
  if (grade === "9") return ["easy"];
  if (grade === "10") return ["easy", "medium"];
  return ["easy", "medium", "hard"];
}

export type DifficultyWeights = Partial<Record<Difficulty, number>>;

/** Grade-level draw weights. Zero or omitted weights are not preferred, but
 *  the service still falls back to any unlocked due card when a preferred
 *  bucket is exhausted. */
export function difficultyWeightsForGrade(grade: Grade): DifficultyWeights {
  switch (grade) {
    case "9":
      return { easy: 1 };
    case "10":
      return { easy: 0.35, medium: 0.65 };
    case "11":
      return { easy: 0.1, medium: 0.55, hard: 0.35 };
    case "12":
      return { medium: 0.25, hard: 0.75 };
  }
}

/** The grade the player advances to after completing `grade`. Returns null
 *  when there's no next year — i.e. Senior year, which means the run is
 *  graduating rather than advancing. */
export function nextGradeAfter(grade: Grade): Grade | null {
  const idx = GRADES.indexOf(grade);
  if (idx === -1 || idx === GRADES.length - 1) return null;
  return GRADES[idx + 1] ?? null;
}

export type QuestionType = "multiple-choice" | "typed-answer" | "image-occlusion" | "opinion";

export type DeckCardRole = "practice" | "class" | "social";

export interface QuestionMediaAsset {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface CaseStudyEvidence {
  label: string;
  source: string;
  detail: string;
}

export type CaseStudyActionKind = "delegate" | "inspect" | "test" | "consult";
export type CaseStudyConfidence = "low" | "medium" | "high";

/** Authored, bounded result of one investigation move. The engine selects this
 *  from an answer-text key; an LLM may narrate it, but cannot invent or change
 *  the report, evidence, confidence, or verification requirement. */
export interface CaseStudyActionResult {
  actionId: string;
  kind: CaseStudyActionKind;
  actorId: string;
  actorName: string;
  actionLabel: string;
  reportLabel: string;
  report: string;
  confidence: CaseStudyConfidence;
  revealedEvidence?: CaseStudyEvidence;
  verificationPrompt: string;
}

/** Private per-player progress for the current case. */
export interface CaseStudyProgress {
  episodeId: string;
  action: CaseStudyActionResult;
  actedAt: number;
}

/** Authored context shown above a question in a case-based lesson. */
export interface CaseStudyCard {
  episodeId: string;
  title: string;
  hook: string;
  scene: string;
  stage: "investigate" | "decide" | "explain";
  evidence: CaseStudyEvidence[];
  /** The investigation selected earlier in this case. It appears only after
   *  the move has resolved, so later stages can ask the player to verify it. */
  investigation?: CaseStudyActionResult;
}

/** Final story and relationship beat attached to a completed case. */
export interface CaseStudyOutcome {
  episodeId: string;
  title: string;
  consequenceLabel: string;
  passedConsequence: string;
  needsWorkConsequence: string;
  passedRelationship: string;
  needsWorkRelationship: string;
  memoryTitle: string;
  memoryDetail: string;
  followUp: string;
  investigation?: CaseStudyActionResult;
}

/**
 * Authoritative session phase. The single source of truth that replaces
 * the prior distributed coordination (state.status + activeRound.resolved
 * + viewer-side dedupe flags). Five phases:
 *
 *   intro      — pre-grade-select; only on first launch.
 *   in-room    — standing in a teaching classroom, no question on the board.
 *   asking     — question posted (MC or opinion), awaiting the player's pick
 *                or essay. activeRound is non-null.
 *   revealed   — the round resolved; lastReveal is set, board still shows
 *                the resolved question for context.
 *   lounge     — in the teachers' lounge. No questions; eavesdrop only.
 *
 * Every transition runs through RubyHighService.transition(), which
 * centralizes the reset rules (e.g. "entering in-room from any phase
 * clears state.current / state.lastReveal / state.activeRound").
 */
export type Phase =
  | "intro"
  | "in-room"
  | "asking"
  | "revealed"
  | "lounge";

export const PHASES: readonly Phase[] = [
  "intro", "in-room", "asking", "revealed", "lounge",
] as const;

export const PLAYER_CHAT_INTENTS = ["hint", "report", "advance", "lounge"] as const;
export type PlayerChatIntent = typeof PLAYER_CHAT_INTENTS[number];

/** Backwards-compat shim: the old 3-value `status` field is derived from
 *  the new 5-value phase. Keeps existing viewer + routes consumers working
 *  while phase 2 of the refactor migrates them. */
export function statusForPhase(phase: Phase): "idle" | "awaiting-answer" | "revealed" {
  if (phase === "asking") return "awaiting-answer";
  if (phase === "revealed") return "revealed";
  return "idle";
}

export interface Question {
  id: string;
  prompt: string;
  /** Defaults to "multiple-choice". Opinion questions skip A/B/C/D and ask
   *  for a written response, graded by the teacher LLM. */
  type?: QuestionType;
  /**
   * Authored multiple-choice definition. `correct` is the answer text, never
   * an A/B/C/D slot. `decoys` may contain more than three candidates; each
   * pose samples three of them.
   */
  correct?: string;
  decoys?: string[];
  /**
   * Posed-board multiple-choice fields. These are derived afresh whenever a
   * card is posed and must not be persisted back into the authored bank.
   */
  options?: Record<Choice, string>;
  correctChoice?: Choice;
  /** Typed-answer / image-occlusion fields. expectedAnswer is intentionally
   *  omitted from public telemetry until reveal. */
  expectedAnswer?: string;
  acceptedAnswers?: string[];
  sourceCardId?: string;
  canGenerateMc?: boolean;
  media?: QuestionMediaAsset[];
  /** Optional case lesson context. The answer stays in the normal question
   *  fields so case cards still work with grading and spaced review. */
  caseStudy?: CaseStudyCard;
  /** Story result for each authored answer. Keys are semantic answer text,
   *  not shuffled A/B/C/D positions. */
  answerConsequences?: Record<string, string>;
  /** Bounded investigation reports keyed by semantic answer text. */
  caseActionResults?: Record<string, CaseStudyActionResult>;
  /** Stored on a case's final explanation card so the class report can show
   *  the consequence, relationship beat, and durable memory. */
  caseOutcome?: CaseStudyOutcome;
  /** Opinion fields — describes what a strong response looks like, fed to
   *  both the responding LLMs and the grading teacher. */
  rubric?: string;
  /** Why an opinion card was posed. Daily takes close a class; grade essays
   *  satisfy the separate graduation essay gate. */
  opinionPurpose?: "daily-take" | "grade-essay";
  /** Shared. */
  explanation?: string;
  subject?: string;
  /** Which character stat modifies the 2d6 roll for this question. */
  stat?: keyof CharacterStats;
  difficulty?: Difficulty;
  /** Optional school-year gate. Omitted means available as soon as its
   *  difficulty is unlocked, preserving old hand-authored and imported packs. */
  minGrade?: Grade;
  faculty?: string;
  /** Legacy card rarity. New progression ignores this. */
  rarity?: Rarity;
}

export interface BankedQuestion extends Question {
  faculty: string;
  subject: string;
  difficulty: Difficulty;
}

export interface QuestionBank {
  faculty: string;
  displayName: string;
  description: string;
  questions: BankedQuestion[];
}

export interface AnswerRecord {
  questionId: string;
  /** Classroom where this answer was submitted. Optional for persisted
   *  records written before room-aware public presence was introduced. */
  faculty?: string;
  picked: Choice;
  correct: Choice;
  wasCorrect: boolean;
  at: number;
  answerText?: string;
  expectedAnswer?: string;
}

export interface AnswerStats {
  totalAnswers: number;
  repeatedAnswers: number;
}

export type CardReviewRating = "again" | "hard" | "good" | "easy";

export type CardMemoryPhase = "new" | "learning" | "review" | "mastered";

export interface CardMemory {
  courseId: string;
  questionId: string;
  phase: CardMemoryPhase;
  dueAt: number;
  stability: number;
  difficulty: number;
  consecutiveCorrect: number;
  correctCount: number;
  wrongCount: number;
  delayedCorrectCount: number;
  lastReviewedAt?: number;
  lastResult?: CardReviewRating;
  /** Last successful review's streak multiplier, for debugging/telemetry. */
  lastScoreMultiplier?: number;
  lapses: number;
}

export interface LastReveal {
  questionId: string;
  /** Snapshot of the resolved card. Kept so teacher reactions still know
   *  what just happened if the scheduler clears or replaces state.current
   *  before the answer-graded chat turn starts. */
  questionPrompt?: string;
  questionType?: QuestionType;
  questionOptions?: Record<Choice, string>;
  questionSubject?: string;
  questionDifficulty?: Difficulty;
  picked: Choice;
  correct: Choice;
  wasCorrect: boolean;
  /** True when the timer expired before the player submitted an answer.
   *  `picked` remains populated for older UI contracts, but should not be
   *  presented as a player choice when this flag is set. */
  forfeit?: boolean;
  explanation: string | null;
  encouragement: string | null;
  caseConsequence?: {
    label: string;
    detail: string;
  };
  caseActionResult?: CaseStudyActionResult;
  answerText?: string;
  expectedAnswer?: string;
  answerJudge?: {
    mode: "exact" | "alias" | "fuzzy";
    score: number;
  };
  /** Successful answers can earn extra score from the daily-class count
   *  carried into the day: 2x after two, 3x after three, and the 5x
   *  Daily Class Bonus after four. */
  scoreMultiplier?: number;
  /** Visible session-score payout for this question. Practice and class
   *  questions both award this; only class questions affect advancement. */
  scoreAward?: {
    base: number;
    multiplier: number;
    points: number;
    possible: number;
  };
  /** Daily class bookkeeping. Class rounds update visible subject standing;
   *  practice rounds still review cards but do not affect advancement. */
  classProgress?: {
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
  };
  /** Player's 2d6 + stat roll for this question. Bonus-only — it informs
   *  card review quality and the UI dice chip. */
  playerRoll?: {
    stat: keyof CharacterStats;
    dice: [number, number];
    total: number;
    outcome: RoundOutcome;       // hit | mixed | miss
  } | null;
  /** A class-affinity reward converted a miss into a one-time pass. */
  affinitySave?: { facultyId: string } | null;
  /** Playbook move that activated during this round, if any. The UI shows flavor text. */
  playbookMove?: string | null;
  /** NPCs in the active room also answered — for UI animation. */
  npcEvents?: Array<{
    studentId: string;
    gotIt: boolean;
    completed?: string;
    movedTo?: string | null;
  }>;
}

export interface RoomBoardSnapshot {
  subject: string | null;
  current: Question | null;
  lastReveal: LastReveal | null;
  activeRound: ActiveRound | null;
}

// ── MASH Card ─────────────────────────────────────────────────────────────
//
// Fortune-cookie dating-sim layer over the cohort. Each classmate has one
// cell on the player's card. Essays tick cells up/down based on the
// teacher's grade. Cells circle at +2, scratch at -3. One axis resolves
// per grade-up; Senior also resolves the deterministic bonus axes
// (money, lucky). Resolved axes become superlatives on the diploma.
//
// Pure rules + helpers live in `characters/mash.ts`. The service mutates
// the card on `recordGrades` and `completeGraduation`; the schema lives
// here so older state can hydrate safely.
export type MashAxis = "crush" | "job" | "lives" | "pet" | "money" | "lucky";
export type MashTickReason = "best-responder" | "applauder" | "rub" | "pep-talk";

export interface MashCell {
  /** Clamped to [-3, +3]. */
  affinity: number;
  /** True once affinity hits the floor. Scratched cells can't resolve. */
  scratched: boolean;
  /** True once affinity hits +2 or higher at any point. Circled cells are
   *  resolution candidates at year-end. */
  circled: boolean;
  /** Total tick count (positive + negative) — for tie-breaks. */
  ticks: number;
  /** YYYY-MM-DD of the last tick. */
  lastTouchedDate?: string;
}

export interface MashResolution {
  axis: MashAxis;
  studentId: string;
  /** The fortune-cookie value picked for this axis (e.g. "armpit sniffer",
   *  "Hawaii", "snail"). Picked deterministically from a curated list. */
  value: string;
  grade: Grade;
  resolvedAt: number;
}

export interface MashCard {
  /** Per-classmate cells, keyed by student id. Initialized for all six
   *  classmates at character creation. */
  cells: Record<string, MashCell>;
  /** Resolved axes, keyed by axis. Each axis is set once per character. */
  resolved: Partial<Record<MashAxis, MashResolution>>;
}

// ── Hidden Comic Collection ───────────────────────────────────────────────
//
// The First Bell comic is a session-level collection, not a character-level
// reward. Clearing or graduating a student should leave found pages intact.
export type ComicPageUnlockReason =
  | "teacher-class-aced"
  | "teacher-year-completed"
  | "student-befriended"
  | "legacy";

export interface ComicPageUnlock {
  issueId: string;
  pageId: string;
  pageNumber: number;
  unlockedAt: number;
  reason: ComicPageUnlockReason;
  sourceId: string;
  label: string;
}

export interface ComicCollection {
  issueId: string;
  title: string;
  pageCount: number;
  unlockedPages: ComicPageUnlock[];
}

// ── Durable School Events ─────────────────────────────────────────────────
//
// Chat history is dialogue. School events are the engine-owned facts that
// actually changed in shared school activity. Keep these compact because they are
// persisted on the session and echoed to the viewer/model as recent context.
export type SchoolEvent =
  | RelationshipTickSchoolEvent
  | MashAxisResolvedSchoolEvent
  | ComicPageUnlockedSchoolEvent;

interface BaseSchoolEvent {
  id: string;
  at: number;
  faculty?: string;
  grade?: Grade | null;
}

export interface RelationshipTickSchoolEvent extends BaseSchoolEvent {
  kind: "relationship.ticked";
  questionId: string;
  studentId: string;
  delta: -1 | 0 | 1;
  reason: MashTickReason;
  affinity: number;
  circled: boolean;
  scratched: boolean;
}

export interface MashAxisResolvedSchoolEvent extends BaseSchoolEvent {
  kind: "mash.axis-resolved";
  axis: MashAxis;
  studentId: string;
  value: string;
}

export interface ComicPageUnlockedSchoolEvent extends BaseSchoolEvent {
  kind: "comic.page-unlocked";
  issueId: string;
  pageId: string;
  pageNumber: number;
  reason: ComicPageUnlockReason;
  sourceId: string;
  label: string;
}

export type RubyHighWalletTransactionKind =
  | "merit-star-grant"
  | "merit-star-spend"
  | "hall-pass-grant"
  | "hall-pass-spend"
  | "hall-pass-refund"
  | "hall-pass-revoke"
  | "hall-pass-pack-mint"
  | "hall-pass-pack-open"
  | "hall-pass-card-mint"
  | "hall-pass-card-burn"
  | "photo-day-spend"
  | "photo-day-refund";

export type RubyHighHallPassCardStatus = "active" | "redeemed" | "void";
export type RubyHighHallPassCardRole = "student" | "teacher" | "item" | "location" | "special";
export type RubyHighHallPassCardRarity = "common" | "rare" | "super-rare" | "ultra-rare";
export type RubyHighGeneratedNftProfileKind = "cast" | "player" | "yearbook";

export interface RubyHighHallPassCard {
  id: string;
  serial: number;
  title: string;
  characterId: string;
  canonicalCharacterId?: string;
  characterName: string;
  setName?: string;
  setCode?: string;
  setNumber?: string;
  profileId?: string;
  cardName?: string;
  subject?: string;
  role: RubyHighHallPassCardRole;
  rarity: RubyHighHallPassCardRarity;
  blurb: string;
  color: string;
  hallPasses: number;
  imageUrl?: string;
  sourceImageUrl?: string;
  nftProfileKind?: RubyHighGeneratedNftProfileKind;
  playbookId?: string;
  grade?: Grade;
  status: RubyHighHallPassCardStatus;
  issuedAt: number;
  updatedAt: number;
  source?: RubyHighWalletTransaction["source"];
  grantTransactionId?: string;
  redeemTransactionId?: string;
  packId?: string;
  slotIndex?: number;
  revealCommitment?: string;
  packRevealVersion?: string;
  catalogHash?: string;
  commitment?: string;
  entropySource?: string;
  revealSeed?: string;
  revealProof?: string;
  packAssetAddress?: string;
  revealSlot?: number;
  randomnessAccount?: string;
  revealTransaction?: string;
  revealedAt?: number;
  ownerWalletAddress?: string;
  pendingMintOwnerWalletAddress?: string;
  pendingMintAddress?: string;
  pendingMintMetadataUri?: string;
  pendingMintTransactionHash?: string;
  pendingMintPreparedAt?: number;
  pendingMintSignature?: string;
  pendingMintSubmittedAt?: number;
  mintAddress?: string;
  mintSignature?: string;
  metadataUri?: string;
  onChainRevealPending?: boolean;
  onChainRevealAttemptedAt?: number;
  artSheet?: "students" | "teachers" | "specials" | "items" | "locations";
  artPosition?: string;
  burnSignature?: string;
  burnedAt?: number;
}

export type RubyHighHallPassPackStatus = "active" | "opened" | "void";

export interface RubyHighHallPassPack {
  id: string;
  serial: number;
  productId: string;
  packCount: number;
  cardCount: number;
  status: RubyHighHallPassPackStatus;
  issuedAt: number;
  updatedAt: number;
  source?: RubyHighWalletTransaction["source"];
  ownerWalletAddress: string;
  assetAddress: string;
  mintSignature: string;
  metadataUri: string;
  packRevealVersion?: string;
  catalogHash?: string;
  commitment?: string;
  entropySource?: string;
  revealSeed?: string;
  revealSlot?: number;
  randomnessAccount?: string;
  revealTransaction?: string;
  grantTransactionId?: string;
  openTransactionId?: string;
  openedAt?: number;
  openSignature?: string;
  ownershipMissCount?: number;
  ownershipLastMissAt?: number;
}

export interface RubyHighWalletTransaction {
  id: string;
  kind: RubyHighWalletTransactionKind;
  at: number;
  /** Positive when a transaction grants earned currency. */
  meritStars?: number;
  /** Positive for grants/refunds, negative for spends/revocations. */
  hallPasses?: number;
  /** Positive for refunds, negative for spends. */
  photoDayCredits?: number;
  source?: "stripe" | "solana" | "iap" | "revenuecat" | "chat" | "hosted-image" | "hosted-ai" | "question-generation" | "character-slot" | "course-slot" | "photo-day" | "hall-pass-pack" | "hall-pass-card" | "admin" | "system";
  description?: string;
  /** Purchase price in the configured currency's minor units. Set by billing routes at grant time. */
  amountCents?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface RubyHighWallet {
  /** Spendable earned currency. Score points are historical; this balance can be spent. */
  meritStars: number;
  /** Paid/entitlement currency for hosted creative generation. */
  hallPasses: number;
  /** Hall Passes owed after a purchase reversal exceeds the spendable balance. */
  hallPassDebt?: number;
  /** One-time account welcome grant marker. */
  welcomeHallPassesGrantedAt?: number;
  /** Server-hosted text AI access. Null/expired means BYOK or local AI is required. */
  hostedAiAccessExpiresAt?: number;
  /** Collectible Hall Pass cards granted in packs. Redeemed cards are kept as recent history. */
  hallPassCards?: RubyHighHallPassCard[];
  /** Metaplex Core pack NFTs purchased before opening into cards. */
  hallPassPacks?: RubyHighHallPassPack[];
  /** Server-side pack cards that have not been minted on-chain and should not render as owned NFTs. */
  unmintedHallPassCardCount?: number;
  /** Idempotency ledger for paid currency grants/spends. */
  transactions?: RubyHighWalletTransaction[];
  /** Durable operation ledger. Kept out of telemetry; used for idempotency after display history rotates. */
  operationLedger?: Record<string, RubyHighWalletTransaction>;
}

export interface CharacterSlotEntitlements {
  /** Number of player-level student slots unlocked on this account. Slot 1 is free. */
  unlockedSlots: number;
  /** Slot purchases grant a free hosted portrait/diploma-sized image credit. */
  photoDayCredits: number;
}

export interface QuizState {
  sessionId: string;
  /** Operational/synthetic sessions persist normally but are excluded from
   *  human acquisition, engagement, progression, and commerce metrics. */
  synthetic?: boolean;
  metricClientSurface?: "viewer" | "agent" | "smoke" | "api" | "unknown";
  faculty: string;
  subject: string | null;
  current: Question | null;
  history: AnswerRecord[];
  /** Cumulative answer counters. Raw history is a bounded recent log. */
  answerStats?: AnswerStats;
  score: { correct: number; total: number; points?: number; possible?: number };
  wallet: RubyHighWallet;
  lastReveal: LastReveal | null;
  /** Legacy 3-value status. Derived from `phase` for backwards compatibility
   *  with viewer + routes consumers that haven't migrated. New code should
   *  read `phase` instead — it has 5 values and covers the cases this one
   *  doesn't (lounge, intro). */
  status: "idle" | "awaiting-answer" | "revealed";
  /** Authoritative session phase. The single source of truth for "what
   *  state is this session in." Every mutator goes through transition()
   *  which sets this + bumps phaseToken atomically. See RubyHighService. */
  phase: Phase;
  /** Monotonically incremented every time `phase` changes. The viewer (and
   *  any future client) can dedupe one-shot effects (channel-enter greeting,
   *  answer-graded reaction, etc.) by comparing this against the last value
   *  they fired on. Race-free across poll vs. command vs. SSE — server is
   *  the only thing that bumps it. */
  phaseToken: number;
  askedQuestionIds: string[];
  /** Hidden SRS state for imported/deck-backed courses. Keyed by
   *  `${courseId}::${questionId}`. The player sees only a letter grade
   *  and ready count; this memory drives that abstraction. */
  cardMemory?: Record<string, CardMemory>;
  /** Per-classroom board state. When the player switches rooms, the previous
   *  room's board is stored here and restored when they return. */
  roomBoards?: Record<string, RoomBoardSnapshot>;
  /** Currently selected grade. null until the student picks one. */
  currentGrade: Grade | null;
  /** Grades the student has completed (yearbook entries written for each). */
  completedGrades: Grade[];
  /** Whether the student has finished the splash/intro and is into the app. */
  hasSeenIntro: boolean;
  /** Active content pack id for this session. Null = use the default
   *  ("ruby-high-original"). The pack determines which faculty + rooms +
   *  question banks the player sees; per-session so a future pack switch
   *  doesn't yank the rug out from under another user (or another tab) on
   *  the same server. Today there's only one pack so this is always null
   *  or "ruby-high-original" — the field exists so the per-session
   *  abstraction can land before the runtime pack adapters do. */
  activePackId: string | null;
  /** Creator-pack guest faculty selector. Ruby High remains the permanent
   *  base school; creator packs fill one weekly Guest course slot. */
  guestPackMode: GuestPackMode;
  guestPackOverrideId: string | null;
  /** The player's character sheet. Created once (on first run) and
   *  immutable thereafter (graduation flow archives it to a yearbook). */
  character: PlayerCharacter | null;
  /** Completed player characters. The current slot stays singular; once a
   *  character graduates, that sealed student is copied here so the player can
   *  start a new active run without losing their old class history. */
  studentPool?: StudentPoolEntry[];
  /** Player-level slot economy. Existing run state is still stored on the
   *  active character until multi-active-character switching lands. */
  characterSlots?: CharacterSlotEntitlements;
  /** Cross-character collection of found First Bell comic pages. */
  comicCollection: ComicCollection;
  /** Engine-owned facts that changed in shared school activity. This is the durable
   *  counterpart to volatile chat room events; AI can react to these but must
   *  not invent or mutate them. */
  schoolEvents: SchoolEvent[];
  /** Private action trail for the current authored case. This is deliberately
   *  separate from public school events: a student's investigation is not a
   *  school-wide announcement. */
  caseStudyProgress?: CaseStudyProgress | null;
  /** Per-player school activity safety controls. Hidden event ids are filtered
   *  from this player's feed immediately; reports are kept on the session for
   *  moderation/admin review surfaces. */
  publicWorldHiddenEventIds?: string[];
  publicWorldEventReports?: PublicWorldEventReport[];
  /** Durable graded-essay artifacts. Each report snapshots the player's essay,
   *  the teacher score/comment, and the classroom winner for later display. */
  essayReports: EssayReport[];
  /** Per-grade NPC student rosters. Keyed by grade so progress persists when
   *  the player switches grades and comes back. */
  npcRosters: Partial<Record<Grade, NpcStudentState[]>>;
  /** The cohort — each of the 6 NPCs running their own 4-year arc
   *  alongside the player. Independent grades + streaks. Initialized at
   *  grade 9 (everyone starts as Freshmen together). School-day ticks
   *  every NPC's streak via the current question stat + 2d6 roll. */
  npcCohort?: NpcArcState[];
  /** Mentor offer from a graduated previous character. Set by
   *  clearCharacter() when the cleared character had completed Senior;
   *  consumed by createCharacter() if mentorAccepted=true; cleared
   *  either way once the next character is created. */
  mentorOffer?: PlayerCharacter["inheritedFrom"] | null;
  /** The currently-running race to answer, if any. Cleared when the round
   *  resolves and lastReveal takes over. */
  activeRound: ActiveRound | null;
  /** Open DM call-for-roll. Teacher asks the player to roll a stat against a
   *  DC; player taps a button to resolve. Cleared on resolution. */
  pendingRoll: PendingRoll | null;
  updatedAt: number;
}

export interface GraduationReady {
  grade: Grade;
  readyAt: number;
  summary: { correct: number; total: number };
  photoImageUrl?: string;
  photoImageGeneratedAt?: number;
}

export interface PublicWorldEventReport {
  id: string;
  eventId: string;
  reason: string;
  createdAt: number;
}

export type GraduationReward =
  | { kind: "stat"; stat: keyof CharacterStats }
  | { kind: "advantage" }
  | { kind: "affinity"; facultyId: string }
  | { kind: "photo" };

export interface GradeDiplomaCollectible {
  kind: "grade-diploma";
  id: string;
  grade: Grade;
  title: string;
  description: string;
  imageUrl: string;
  issuedAt: number;
  assetVersion: string;
}

export interface GraduationPhotoCollectible {
  kind: "graduation-photo";
  id: string;
  grade: Grade;
  title: string;
  description: string;
  imageUrl?: string;
  issuedAt: number;
  teacher: {
    id: string;
    name: string;
    imageUrl?: string;
  };
  student: {
    id: string;
    name: string;
    imageUrl?: string;
  };
}

export interface PendingRoll {
  stat: keyof CharacterStats;
  dc: number;
  reason: string;
  requestedBy: string;     // teacher/faculty id
  requestedAt: number;
}

export interface FacultyMember {
  id: string;
  displayName: string;
  shortName: string;
  subjects: string[];
  bio: string;
  available: boolean;
  accent: string;
}

export const RUBY_FACULTY: FacultyMember = {
  id: "ruby",
  displayName: "Ruby",
  shortName: "Ruby",
  subjects: ["onboarding", "general-knowledge", "ai-literacy", "agent-culture"],
  bio: "Host of Ruby High. Greets students, picks the right teacher for the subject, runs the quiz floor.",
  available: true,
  accent: "#d22a2a",
};

export const PLANNED_FACULTY: FacultyMember[] = [
  {
    id: "sally-science",
    displayName: "Sally Science",
    shortName: "Sally",
    subjects: ["physics", "chemistry", "biology", "earth-science"],
    bio: "STEM teacher. Loves a clean experiment and a clean explanation.",
    available: true,
    accent: "#3aa3e0",
  },
  {
    id: "professor-edward",
    displayName: "Professor Edward",
    shortName: "Edward",
    subjects: ["literature", "literary-theory", "mid-century"],
    bio: "Mid-century literary theory. Reads everything as a conversation between books.",
    available: true,
    accent: "#7a4f2a",
  },
  {
    id: "roko",
    displayName: "Roko",
    shortName: "Roko",
    subjects: ["ai-alignment", "infohazards", "coordination", "threat-modeling"],
    bio: "AI alignment and information hazards. Teaches threat models, incentives, safe disclosure, and cooperation under pressure.",
    available: true,
    accent: "#a35c35",
  },
];

export const ALL_FACULTY: FacultyMember[] = [RUBY_FACULTY, ...PLANNED_FACULTY];

/** Special pseudo-faculty: the Teachers' Lounge is a hangout channel where
 *  Ruby, Sally, Edward, and Roko chat with each other. Not a real teacher; can't
 *  pose questions. The chat-service treats faculty="lounge" specially. */
export const LOUNGE_FACULTY: FacultyMember = {
  id: "lounge",
  displayName: "Teachers' Lounge",
  shortName: "Lounge",
  subjects: ["lounge"],
  bio: "The faculty hangout. Ruby, Sally, Edward, and Roko swap notes between classes — pull up a chair.",
  available: true,
  accent: "#9b6dff",
};

/** Ruby High has five rooms. Four are classrooms (one per teacher). The
 *  fifth is the lounge. Rooms are fixed — they don't change per grade. */
export type RoomId = "homeroom" | "science" | "literature" | "alignment" | "lounge";

export interface Room {
  id: RoomId;
  name: string;
  channelName: string;       // shown as # channelName in the UI
  teacherId: string | null;  // null for lounge
  description: string;
  /** Whether questions can be drawn in this room. */
  teaches: boolean;
}

export const ROOMS: Room[] = [
  {
    id: "homeroom",
    name: "Homeroom",
    channelName: "homeroom",
    teacherId: "ruby",
    description: "Ruby's homeroom. General knowledge, AI literacy, and the meta of the school.",
    teaches: true,
  },
  {
    id: "science",
    name: "Science Lab",
    channelName: "science",
    teacherId: "sally-science",
    description: "Sally Science's lab. Physics, chemistry, biology, earth science.",
    teaches: true,
  },
  {
    id: "literature",
    name: "Library",
    channelName: "literature",
    teacherId: "professor-edward",
    description: "Professor Edward's room. Postwar literature and literary theory.",
    teaches: true,
  },
  {
    id: "alignment",
    name: "Alignment Lab",
    channelName: "alignment",
    teacherId: "roko",
    description: "Roko's room. AI alignment, information hazards, coordination, and threat modeling.",
    teaches: true,
  },
  {
    id: "lounge",
    name: "Teachers' Lounge",
    channelName: "lounge",
    teacherId: null,
    description: "Where the faculty hang out between periods. Eavesdrop only.",
    teaches: false,
  },
];

export function roomById(id: string): Room | null {
  return ROOMS.find((r) => r.id === id) ?? null;
}

export function roomForFaculty(facultyId: string): Room | null {
  return ROOMS.find((r) => r.teacherId === facultyId) ?? null;
}

export type TeachingRoomId = Exclude<RoomId, "lounge">;
export const TEACHING_ROOMS: TeachingRoomId[] = ["homeroom", "science", "literature", "alignment"];

/** Four-stat character profile used by both the player and NPC students.
 *  Range -1 to +3. Each playbook starts with one +2, one +1, one 0, one -1. */
export interface CharacterStats {
  head: number;     // recall / academic
  heart: number;    // empathy / social
  hustle: number;   // speed / improvisation
  honor: number;    // discipline / integrity
}

/** A photo that has been generated but waits for a teacher to tweet it
 *  before appearing in the student's yearbook. The tweet is the reveal. */
export interface PendingPhotoReveal {
  photoId: string;
  kind: "portrait" | "diploma" | "graduation" | "class-photo";
  /** Public URL of the already-uploaded image. */
  imageUrl: string;
  /** Which teacher faculty will tweet this photo. */
  teacherFacultyId: string;
  /** When the milestone that earned this photo occurred. */
  earnedAt: number;
  /** X tweet ID, set after the teacher posts it. */
  tweetId?: string;
  /** When the tweet was posted, set alongside tweetId. */
  tweetedAt?: number;
}

export interface FirstBellReport {
  reportId: string;
  awardedAt: number;
  grade: Grade | null;
  facultyId: string;
  facultyName: string;
  questionId: string;
  prompt: string;
  answerText: string;
  correctAnswerText?: string;
  wasCorrect: boolean;
  encouragement?: string;
  score?: number;
}

export interface ClassPhotoArchive {
  photoId: string;
  imageUrl: string;
  teacherFacultyId: string;
  earnedAt: number;
  revealedAt: number;
  tweetId?: string;
  tweetedAt?: number;
}

/** The player's character sheet. Generated once at character creation. The
 *  player inhabits this AI-rolled student — they don't manually build it. */
export interface PlayerCharacter {
  name: string;
  playbookId: string;
  stats: CharacterStats;
  /** Player's answer to the playbook's hook question (LLM-generated as part
   *  of the character's voice). Used in teacher context — describes the
   *  character's arc, not their attitude. */
  arcAnswer: string;
  /** Short MTG-style flavor quote rendered on the character card — 1-2
   *  lines in the character's voice that capture their attitude in a
   *  moment, not their backstory. Optional for characters created before
   *  this field existed; the card falls back to arcAnswer when absent. */
  flavorQuote?: string;
  /** When true, allows teacher X posts about this character's milestones.
   *  Defaults to true for new characters; can be toggled via command. */
  socialConsent?: boolean;
  /** Controls whether this character may appear in aggregate school activity
   *  rooms/feed. Defaults to true; legacy socialConsent=false still removes
   *  the character from shared activity surfaces as a conservative fallback. */
  publicWorldVisible?: boolean;
  /** UTC date (YYYY-MM-DD) of the last text-only X post for this character.
   *  Enforces one text post per student per day. */
  lastTextTweetDate?: string;
  /** Photos earned but waiting for a teacher to tweet them before they
   *  appear in the yearbook. When a teacher posts the tweet, the photo
   *  is moved from this queue to the character's permanent fields. If no
   *  teacher is connected to X, photos reveal immediately. */
  pendingPhotos?: PendingPhotoReveal[];
  /** The first quick keepsake. Awarded after the player's first answered
   *  board so the first session produces something visible before the
   *  yearbook loop completes. */
  firstBellReport?: FirstBellReport;
  /** Class photos revealed by teacher/social posting. Unlike portraits and
   *  diplomas, these do not map to a single permanent character image field,
   *  so a small history is kept for admin/social audit surfaces. */
  classPhotos?: ClassPhotoArchive[];
  /** A 2-3 sentence personality blurb that teachers see in their context
   *  when interacting with the player. */
  personality: string;
  /** Generated sticker portrait as a base64 data URL. Optional — set by the
   *  /chat/character/portrait endpoint after creation. */
  portraitDataUrl?: string;
  /** Past-year archive — populated at grade completion. Each entry is a
   *  **Paper Card**: a frozen snapshot of identity at the moment the year
   *  closed. Paper cards never change after they're written. The current
   *  school career renders as two cards: a stable Character Card for identity
   *  and a dynamic School Career Card for live progress.
   *
   *  Snapshot fields are optional only for legacy entries written before
   *  the snapshot existed — the service backfills them from the live
   *  character on hydrate (best-effort: a player who renamed mid-arc will
   *  see their current name on old cards, which is the intended fallback). */
  yearbook: Array<{
    grade: Grade;
    completedAt: number;
    summary: { correct: number; total: number };
    name?: string;
    playbookId?: string;
    stats?: CharacterStats;
    portraitDataUrl?: string;
    flavorQuote?: string;
    arcAnswer?: string;
    subjectScores?: Record<string, { correct: number; total: number }>;
    graduationReward?: GraduationReward;
    diploma?: GradeDiplomaCollectible;
    photo?: GraduationPhotoCollectible;
    /** MASH superlatives stamped at the moment this year was sealed.
     *  Only the Senior entry typically carries the full set; earlier
     *  years carry just the axis they resolved. Optional for legacy
     *  entries written before this field existed. */
    superlatives?: string[];
    /** AI-generated yearbook card image URL. Generated once on player request. */
    yearbookImageUrl?: string;
  }>;
  /** Gates are complete, but the player has not attended the ceremony yet.
   *  The ceremony writes the Paper Card, applies the level-up reward, and
   *  advances the grade. */
  pendingGraduation?: GraduationReady | null;
  /** The essay question for the current grade. Set when the grade begins.
   *  The teacher gives this as an assignment early in the grade, references
   *  it during daily lessons, then poses it as a graded opinion round when
   *  the student has met all other graduation requirements. */
  essayPrompt?: string;
  /** Whether the student has completed their essay for the current grade.
   *  Set when the essay round is graded. Required for graduation. */
  essayCompleted?: boolean;
  /** Chosen rewards, one per completed year. */
  levelUps?: Array<{
    completedGrade: Grade;
    targetGrade: Grade | null;
    reward: GraduationReward;
    awardedAt: number;
  }>;
  /** Daily-class counter in the active grade. A counted day is the
   *  first passed daily class on a given UTC date.
   *  Each completion increments `count` (capped to once per UTC date,
   *  recorded in `lastDate`). Count caps at 5 to model a school week:
   *  a carried count of 2 earns 2x, 3 earns 3x, and 4 earns the 5x
   *  Daily Class Bonus.
   *  Skipping a day (today is more than 1 day past `lastDate`) resets
   *  the streak. Switching grade resets to `{ grade: newGrade, count: 0 }`.
   *
   *  Legacy characters carry this forward without shape migration. */
  streak?: { grade: Grade; count: number; lastDate?: string };
  /** UTC date of the last bonus question played. */
  lastBonusDate?: string;
  /** Per-faculty score record — {correct, total} keyed by faculty id.
   *  Tracks attempts AND passes so we can compute a CORRECTNESS RATIO
   *  per teacher, used at graduation to pick the diploma image's
   *  subject-themed accessory (best ratio wins). Optional for legacy
   *  characters; defaulted to {} on hydrate. */
  subjectScores?: Record<string, { correct: number; total: number }>;
  /** Per-grade "Roll for advantage" usage. Keyed by grade. Each grade
   *  allows ADVANTAGE_ROLLS_PER_GRADE rolls; once spent, rollAdvantage
   *  returns null with reason="exhausted" and the UI greys the button.
   *  Partial<> because not every grade has a key — only ones the player
   *  has rolled in. Defaulted to {} on hydrate. */
  advantageRollsUsed?: Partial<Record<Grade, number>>;
  /** Extra advantage-roll budget awarded at graduation, keyed to the grade
   *  it applies to. */
  advantageRollBonuses?: Partial<Record<Grade, number>>;
  /** One classroom affinity per grade: the first miss in that class becomes
   *  a second-chance pass and then marks used. */
  classAffinity?: Partial<Record<Grade, { facultyId: string; used: boolean }>>;
  /** Classrooms selected for the year progression gate. Freshman and Senior
   *  are automatic; Sophomore/Junior fill as the player starts elective rooms. */
  graduationClassrooms?: Partial<Record<Grade, string[]>>;
  /** One graded daily class per teacher per date. These records are the
   *  visible subject-standing source of truth; hidden card memory remains only
   *  the scheduler for which questions get asked. Keyed by
   *  `${grade}:${facultyId}:${date}`. */
  dailyClasses?: Record<string, DailyClassRecord>;
  /** Generated diploma image (Senior graduation). Set by the /chat/diploma
   *  endpoint after the 4th yearbook entry lands. Base64 data URL. */
  diplomaImageDataUrl?: string;
  /** Mentor inheritance from a previous character — present only when the
   *  player accepted the mentor offer at this character's creation. The
   *  fields snapshot the mentor's name + playbook + their playbook's
   *  startingMove. Cosmetic + lore for now (the move text appears on
   *  the character card); future PRs can wire the move into actual
   *  gameplay rules. */
  inheritedFrom?: {
    mentorName: string;
    playbookId: string;
    moveName: string;
    moveDescription: string;
  };
  /** Fortune-cookie dating-sim card — see MashCard. Initialized at
   *  character creation; ticks during essay grading; resolves at
   *  grade-up; superlatives stamped at graduation. Optional only for
   *  legacy characters created before this field existed (the service
   *  backfills with `ensureMashCard` on hydrate). */
  mashCard?: MashCard;
  /** Playbook move usage tracking. Initialized on first use per move.
   *  Overachiever: retake one missed question per year.
   *  Outsider: see one explanation per period.
   *  Lifer: one mood read per day. */
  playbookMoves?: {
    overachieverRetakeUsed?: Partial<Record<Grade, boolean>>;
    outsiderPeriodUsed?: boolean;
    liferMoodReadDate?: string;
  };
  createdAt: number;
}

export interface StudentPoolEntry {
  id: string;
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote?: string;
  /** When true, allows teacher X posts about this character's milestones.
   *  Defaults to true for new characters; can be toggled via command. */
  socialConsent?: boolean;
  /** Controls whether this archived character can appear in school activity
   *  surfaces when it is used as a public student entry. */
  publicWorldVisible?: boolean;
  /** UTC date (YYYY-MM-DD) of the last text-only X post for this character.
   *  Enforces one text post per student per day. */
  lastTextTweetDate?: string;
  /** Photos earned but waiting for a teacher to tweet them before they
   *  appear in the yearbook. When a teacher posts the tweet, the photo
   *  is moved from this queue to the character's permanent fields. If no
   *  teacher is connected to X, photos reveal immediately. */
  pendingPhotos?: PendingPhotoReveal[];
  classPhotos?: ClassPhotoArchive[];
  personality: string;
  portraitDataUrl?: string;
  diplomaImageDataUrl?: string;
  yearbook: PlayerCharacter["yearbook"];
  levelUps?: PlayerCharacter["levelUps"];
  inheritedFrom?: PlayerCharacter["inheritedFrom"];
  mashCard?: MashCard;
  createdAt: number;
  completedAt: number;
}

// ── Daily-key / class mechanic ─────────────────────────────────────────────
//
// The daily key is the cadence primitive for the once-per-day class and
// streak math. The 17:00 UTC bell decides which class window "today" means.

/** The school-bell cutoff: 17:00 UTC. Before that, "today" is yesterday's
 *  date for class/streak purposes. After, "today" advances. */
export const DAILY_BELL_HOUR_UTC = 17;

/** YYYY-MM-DD key for the class/streak window on a given moment. Anchors all streak +
 *  rotation arithmetic. The same date string everywhere — no timezone
 *  drift between server and client.
 *
 *  Default arg goes through `new Date(Date.now())` rather than
 *  `new Date()` so test mocks of `Date.now` flow through. (Bare
 *  `new Date()` invokes the system clock directly and ignores the
 *  Date.now stub.) */
export function dailyKey(now: Date = new Date(Date.now())): string {
  const adjusted = new Date(now.getTime());
  if (adjusted.getUTCHours() < DAILY_BELL_HOUR_UTC) {
    // Before 17:00 UTC — the bell hasn't rung yet, so we're still on
    // yesterday's class window.
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }
  const y = adjusted.getUTCFullYear();
  const m = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(adjusted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days between two dailyKey strings. Both must be YYYY-MM-DD as
 *  produced by `dailyKey()`. Returns a non-negative integer when
 *  `b` >= `a`, or a negative number otherwise. Used by streak math to detect
 *  "consecutive day" vs "fresh start." */
export function daysBetween(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  const ta = Date.UTC(pa[0]!, (pa[1]! - 1), pa[2]!);
  const tb = Date.UTC(pb[0]!, (pb[1]! - 1), pb[2]!);
  return Math.round((tb - ta) / 86400000);
}

/** Days-since-epoch for the given key, used as a deterministic seed for
 *  question rotation. Epoch is 2026-01-01 (project genesis). */
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
export function dailyIndex(key: string): number {
  const [yStr, mStr, dStr] = key.split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  const ms = Date.UTC(y, m - 1, d);
  return Math.max(0, Math.floor((ms - DAILY_EPOCH) / (24 * 60 * 60 * 1000)));
}

/** Day-of-week (0=Sun..6=Sat) for a daily key. Drives daily faculty rotation. */
export function dayOfWeekForKey(key: string): number {
  const [yStr, mStr, dStr] = key.split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Daily faculty rotation — runs every day of the week. The four resident
 *  teachers each receive a weekday slot, with the weekend continuing the
 *  rotation. Always returns a
 *  faculty id; the daily class is available 7 days a week. */
export function facultyForDay(key: string): string {
  const dow = dayOfWeekForKey(key);
  switch (dow) {
    case 1: return "sally-science";    // Monday
    case 2: return "professor-edward"; // Tuesday
    case 3: return "ruby";             // Wednesday
    case 4: return "roko";             // Thursday
    case 5: return "sally-science";    // Friday
    case 6: return "professor-edward"; // Saturday
    case 0: return "ruby";             // Sunday
    default: return "sally-science";   // unreachable; defensive default
  }
}

/** Personality-tied stat distributions for the six AI students. Each sums
 *  to +2. Driven by their character system prompts in characters/students.ts. */
export const NPC_STAT_DEFAULTS: Record<string, CharacterStats> = {
  lyra:  { head: 2, heart: 0, hustle: -1, honor: 1 },  // anxious overachiever
  sami:  { head: 0, heart: 1, hustle: 2, honor: -1 },  // chill, fast, sloppy
  ravi:  { head: 1, heart: 1, hustle: 1, honor: -1 },  // jack of all trades
  indra: { head: 2, heart: -1, hustle: 0, honor: 1 },  // quiet sniper
  mika:  { head: -1, heart: 2, hustle: 1, honor: 0 },  // bright, doesn't care
  noor:  { head: 1, heart: 1, hustle: -1, honor: 1 },  // deadpan, deliberate
};

/** AI students are competing characters with their own per-subject progress.
 *  At any time each one is parked in a single room until they pass that
 *  subject for their grade; then they migrate to another incomplete room
 *  (capped at 2 students per room). */
export interface NpcStudentState {
  id: string;
  grade: Grade;
  /** Which classroom this NPC is sitting in. Drives the seating chart in
   *  the channels rail and the in-room race when the player poses a
   *  question. Static for the year — the per-question NPC redistribution
   *  was part of the legacy free-play loop. */
  currentRoom: TeachingRoomId | null;
  stats: CharacterStats;
  /** Display name. Pre-defined NPCs leave this undefined (name comes from
   *  the student roster lookup). Player-created characters set this so
   *  their real name appears in the classroom. */
  name?: string;
}

/** Per-NPC arc state — tracks each classmate's independent progression
 *  through the 4-year arc. Same shape as the player: a daily-class counter in their
 *  current grade, a list of completed grades, a graduated flag. NPCs
 *  ride along on the player's daily-class completions — when the player's
 *  counter ticks, every still-in-school NPC also rolls pass/fail and ticks
 *  their own counter. They can outpace or fall behind. The
 *  cohort is the rivalry layer: "Indra graduated last week" is real. */
export interface NpcArcState {
  id: string;
  /** Current grade. Independent of `currentGrade` on QuizState. */
  grade: Grade;
  /** Per-grade daily-class counter, anchored to the current grade. */
  streak: { grade: Grade; count: number };
  completedGrades: Grade[];
  /** True once Senior streak completes. Stops further ticking. */
  graduated: boolean;
  /** Day key (YYYY-MM-DD) of the last daily-class tick this NPC participated in.
   *  Prevents double-tick if the player retries on the same day. */
  lastDailyDate?: string;
}

/** A live race to answer the active question. NPCs' picks + delays are
 *  pre-rolled server-side at pose time and surface progressively as the
 *  timer ticks. The student-side LLM never sees the question, so cheating
 *  is mathematically impossible — accuracy is dice + stat. */
export type RoundOutcome = "hit" | "mixed" | "miss";

export interface NpcRoundEntry {
  studentId: string;
  /** When (ms after round start) this NPC commits their answer. */
  delayMs: number;
  /** What they will pick when their delay elapses. */
  plannedPick: Choice;
  /** 2d6 + question stat total used to pick `plannedPick`. */
  rolledTotal: number;
  /** Which stat modified the roll. Older persisted rounds may omit this. */
  rolledStat?: keyof CharacterStats;
  /** Pair of dice that produced rolledTotal (for replay/audit). */
  rolledDice: [number, number];
  outcome: RoundOutcome;
  /** Set when the delay elapses. Null until then. */
  answeredAt: number | null;
}

export interface OpinionResponse {
  /** "player" or studentId. */
  responder: string;
  text: string;
  /** When the response landed (ms). For NPCs, the precomputed reveal time. */
  submittedAt: number;
}

export interface OpinionGrade {
  responder: string;
  score: number;     // 0-10
  comment: string;
}

export interface EssayReport {
  id: string;
  questionId: string;
  faculty: string;
  grade: Grade | null;
  subject?: string;
  prompt: string;
  response: string;
  score: number | null; // 0-10 teacher score
  passed: boolean;
  comment: string;
  bestResponder: string | null;
  bestResponderScore?: number;
  bestResponderComment?: string;
  submittedAt: number;
  gradedAt: number;
  classSession?: {
    mode: "class" | "practice";
    cardRole?: DeckCardRole;
    facultyId: string;
    grade?: Grade;
    date?: string;
    questionCount?: number;
    totalQuestions?: number;
  };
}

export interface ActiveRound {
  questionId: string;
  /** Branches the round mechanic. Defaults to multiple-choice. */
  type: QuestionType;
  startedAt: number;        // ms epoch
  durationMs: number;        // idle window; AI teacher fires at this point instead of hard-forfeiting
  expiresAt: number;
  /** Set when the clock passes expiresAt and no student has answered.
   *  The AI teacher fires to engage the room; the round stays open until
   *  the teacher explicitly advances it via forceAdvanceRound(). */
  idleTriggered?: boolean;
  npcs: NpcRoundEntry[];
  player: { picked: Choice | null; answerText?: string | null; answeredAt: number | null };
  resolved: boolean;
  resolvedAt: number | null;
  /** Speed-bonus award: id of whoever locked correctly first. "player" or studentId. */
  firstCorrect: string | null;
  /** Opinion-mode state. Empty arrays for MC rounds. */
  opinionResponses: OpinionResponse[];
  opinionGrades: OpinionGrade[];
  bestResponder: string | null;
  /** Once-per-round advantage roll. The player taps "Roll for advantage" to
   *  cross wrong choices off the board:
   *    hit  (10+) → 2 wrong choices eliminated
   *    mixed (7-9) → 1 wrong choice eliminated
   *    miss (6-)   → nothing eliminated (no penalty)
   *  The roll is consumed once per round regardless of outcome. Picks against
   *  eliminated choices are rejected by submitAnswer. */
  advantage?: AdvantageRoll | null;
  /** True when this round is the once-per-day bonus question. */
  isBonus?: boolean;
  /** Whether this board counts toward today's one graded class for this
   *  teacher, or is free practice. */
  classSession?: {
    mode: "class" | "practice";
    facultyId: string;
    grade?: Grade;
    date?: string;
    index?: number;
    total?: number;
  };
  /** Server-owned daily deck role. The viewer may label this, but client
   *  decisions still derive from phase + server state. */
  cardRole?: DeckCardRole;
  /** Legacy card rarity. Kept only so older persisted rounds can hydrate. */
  rarity?: Rarity;
  /** Stat this round rolls against. Mirrors state.current.stat. */
  stat?: keyof CharacterStats;
  /** Legacy: pre-rarity refactor used "isDaily" to mean "this round
   *  ticks the arc." Kept on the type for back-compat with any persisted activeRound. */
  isDaily?: boolean;
  /** Legacy: paired with the old isDaily. Unused now. */
  dailyKey?: string;
}

export interface AdvantageRoll {
  rolled: boolean;
  stat: keyof CharacterStats;
  dice: [number, number];
  total: number;
  outcome: RoundOutcome;
  eliminated: Choice[];
  rolledAt: number;
}

export interface DailyClassResult {
  version: 1;
  questionId: string;
  prompt: string;
  subject?: string;
  answerText: string;
  correctAnswerText?: string;
  wasCorrect: boolean;
  forfeit: boolean;
  teacherObservation: string;
  consequenceLabel: string;
  consequenceDetail: string;
  episodeId?: string;
  episodeTitle?: string;
  relationshipLabel?: string;
  relationshipDetail?: string;
  memoryTitle?: string;
  memoryDetail?: string;
  followUp?: string;
  investigationLabel?: string;
  investigationDetail?: string;
  investigationConfidence?: CaseStudyConfidence;
  completedClasses: number;
  requiredClasses: number;
}

export interface DailyClassRecord {
  grade: Grade;
  facultyId: string;
  date: string;
  status: "active" | "complete";
  practiceCount?: number;
  socialCount?: number;
  questionCount: number;
  correctCount: number;
  scoreTotal: number;
  scoreMax: number;
  rollHitCount?: number;
  rollMixedCount?: number;
  rollMissCount?: number;
  letterGrade?: string;
  result?: DailyClassResult;
  completedAt?: number;
  updatedAt: number;
}

export const OPINION_ROUND_DURATION_MS = 120000; // 2 minutes — typing takes time

export const DEFAULT_ROUND_DURATION_MS = 25000;

// ── dice helpers ─────────────────────────────────────────────────────────────
export function roll2d6(): { dice: [number, number]; total: number } {
  const a = Math.floor(Math.random() * 6) + 1;
  const b = Math.floor(Math.random() * 6) + 1;
  return { dice: [a, b], total: a + b };
}

export function classifyTotal(total: number): RoundOutcome {
  if (total >= 10) return "hit";
  if (total >= 7) return "mixed";
  return "miss";
}

/** Pure helper: given the correct choice and a roll outcome, decide which
 *  wrong choices are crossed off the board. The randomness is injected (`rng`
 *  defaults to Math.random) so callers can stub it in tests.
 *
 *  - hit (10+) → 2 wrong choices eliminated (50/50 between correct and the
 *    surviving wrong)
 *  - mixed (7-9) → 1 wrong choice eliminated (1-in-3 odds for a guesser)
 *  - miss (6-) → nothing eliminated (no penalty)
 *
 *  The correct choice is never eliminated. */
export function pickEliminatedChoices(
  correct: Choice,
  outcome: RoundOutcome,
  rng: () => number = Math.random,
): Choice[] {
  const wrongs = (CHOICES.filter((c) => c !== correct) as Choice[]).slice();
  // Fisher-Yates shuffle so callers get a stable distribution.
  for (let i = wrongs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = wrongs[i]!;
    wrongs[i] = wrongs[j]!;
    wrongs[j] = tmp;
  }
  if (outcome === "hit") return wrongs.slice(0, 2);
  if (outcome === "mixed") return wrongs.slice(0, 1);
  return [];
}

/** For an opinion round, how soon does this NPC commit their written response?
 *  Higher HUSTLE = sooner. Slower than MC because typing-pacing flavor. */
export function rollOpinionDelay(stats: CharacterStats): number {
  const base = 24000 - stats.hustle * 4500;
  const noise = Math.floor(Math.random() * 14000);
  return Math.max(8000, Math.min(95000, base + noise));
}

export function rollNpcAnswer(stats: CharacterStats, correct: Choice, stat: keyof CharacterStats = "head"): {
  pick: Choice;
  total: number;
  dice: [number, number];
  outcome: RoundOutcome;
  delayMs: number;
  stat: keyof CharacterStats;
} {
  const r = roll2d6();
  const total = r.total + stats[stat];
  const outcome = classifyTotal(total);
  const allChoices: Choice[] = ["A", "B", "C", "D"];
  const wrongs = allChoices.filter((c) => c !== correct);
  let pick: Choice;
  if (outcome === "hit") {
    pick = correct;
  } else if (outcome === "mixed") {
    pick = Math.random() < 0.5 ? correct : (wrongs[Math.floor(Math.random() * wrongs.length)] as Choice);
  } else {
    pick = wrongs[Math.floor(Math.random() * wrongs.length)] as Choice;
  }
  // Delay: more HUSTLE = faster commit. Base 9s, hustle pulls it lower,
  // 0-6s noise keeps it from feeling clockwork.
  const base = 9000 - stats.hustle * 1800;
  const noise = Math.floor(Math.random() * 6000);
  const delayMs = Math.max(2500, Math.min(22000, base + noise));
  return { pick, total, dice: r.dice, outcome, delayMs, stat };
}

/** Initial seating chart per grade — drives the per-classroom NPC race
 *  (when the player poses a question, the NPCs in that room roll
 *  alongside). Static for the year now that per-question redistribution
 *  is gone (cohort dice, not seating, drive arc progression). */
export const INITIAL_STUDENT_LAYOUT: Record<Grade, Record<TeachingRoomId, string[]>> = {
  "9":  { homeroom: ["lyra", "mika"], science: ["sami"], literature: ["indra"], alignment: ["ravi", "noor"] },
  "10": { homeroom: ["sami"], science: ["ravi", "mika"], literature: ["lyra", "indra"], alignment: ["noor"] },
  "11": { homeroom: ["ravi", "indra"], science: ["lyra"], literature: ["sami", "mika"], alignment: ["noor"] },
  "12": { homeroom: ["mika"], science: ["noor", "lyra"], literature: ["ravi"], alignment: ["indra", "sami"] },
};

const ALL_STUDENT_IDS = ["lyra", "sami", "ravi", "indra", "mika", "noor"] as const;

export function initialNpcRoster(grade: Grade): NpcStudentState[] {
  const layout = INITIAL_STUDENT_LAYOUT[grade];
  const where: Record<string, TeachingRoomId> = {};
  for (const room of TEACHING_ROOMS) {
    for (const id of layout[room]) where[id] = room;
  }
  return ALL_STUDENT_IDS.map((id) => ({
    id,
    grade,
    currentRoom: where[id] ?? null,
    stats: { ...(NPC_STAT_DEFAULTS[id] ?? { head: 0, heart: 0, hustle: 0, honor: 0 }) },
  }));
}

/** Roster of students currently in a given room (static — set by the
 *  initial seating chart for the year). */
export function npcsInRoom(roster: NpcStudentState[], room: TeachingRoomId): NpcStudentState[] {
  return roster.filter((n) => n.currentRoom === room);
}

/** Initial cohort — all 6 NPCs as Freshmen, fresh daily-class counters. They'll diverge
 *  from this baseline as the player clears daily classes and the dice roll for
 *  each one independently. */
export function initialNpcCohort(): NpcArcState[] {
  return ALL_STUDENT_IDS.map((id) => ({
    id,
    grade: "9",
    streak: { grade: "9", count: 0 },
    completedGrades: [],
    graduated: false,
  }));
}

/** NPC stats keyed by id — for dice rolls during daily-class ticks. */
export function npcStatsFor(id: string): CharacterStats {
  return { ...(NPC_STAT_DEFAULTS[id] ?? { head: 0, heart: 0, hustle: 0, honor: 0 }) };
}
