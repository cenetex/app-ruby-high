export type Choice = "A" | "B" | "C" | "D";

export const CHOICES: Choice[] = ["A", "B", "C", "D"];

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Ruby HIGH School — only grades 9-12 (Freshman, Sophomore, Junior, Senior).
 *  Players start at Freshman and progress year by year. Each year completes
 *  when the player passes the per-grade Legendary-day threshold. After Senior,
 *  graduation closes the run. */
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

/** Players start at Freshman year. Per the spec commit (DESIGN.md): the
 *  rarity/streak/yearbook loop is the arc — clear enough Legendary days
 *  in your year to advance to the next. Senior completion = graduation
 *  (yearbook write, run ends). */
export const DEFAULT_GRADE: Grade = "9";

/** Question rarity. Rolled at pose time. Drives both the XP a correct
 *  answer awards and the player's per-day "Legendaries cleared" count
 *  that anchors the streak.
 *
 *  Replaces the prior one-question-per-day arc model. The player now plays as
 *  much as they want; rarity creates the same scarcity effect via the
 *  pull-of-randomness, with the once-per-day bonus as a guaranteed Legendary
 *  route rather than the whole gate. */
export type Rarity = "common" | "rare" | "legendary";

export const RARITIES: Rarity[] = ["common", "rare", "legendary"];

/** Per-question rarity weights. Sum to 1.0; rolled by `rollRarity()`. */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 0.6,
  rare: 0.3,
  legendary: 0.1,
};

/** XP awarded for a correct answer at each rarity. Drives both the
 *  per-class subjectXp pool and the player's lifetime XP. */
export const XP_FOR_RARITY: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  legendary: 2,
};

export function xpForRarity(r: Rarity | undefined): number {
  return r ? XP_FOR_RARITY[r] : 0;
}

/** Random rarity roll. Caller may inject an RNG for tests; defaults to
 *  Math.random. Single sample, weighted by RARITY_WEIGHTS — same
 *  distribution every roll, no per-grade scaling. (The progression
 *  ramp lives in LEGENDARIES_PER_DAY_FOR_GRADE.) */
export function rollRarity(rng: () => number = Math.random): Rarity {
  const r = rng();
  let acc = 0;
  for (const k of RARITIES) {
    acc += RARITY_WEIGHTS[k];
    if (r < acc) return k;
  }
  return "common";
}

/** Per-grade Legendary count required to score a "day complete" — the
 *  unit the streak is now counted in. A day completes the first time
 *  the player has answered this many Legendary questions correctly
 *  on that UTC date.
 *
 *    Freshman:  1
 *    Sophomore: 1
 *    Junior:    2
 *    Senior:    3
 *
 *  Pairs with the 60/30/10 rarity distribution: ~10 questions to draw
 *  one Legendary on average, so a Freshman day finishes in ~10
 *  questions and a Senior day in ~30. */
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

/** Per-grade streak length: how many consecutive UTC days the player
 *  must hit the Legendary target on to advance OUT of `grade`.
 *
 *    Freshman → 1 day
 *    Sophomore → 2 days
 *    Junior → 3 days
 *    Senior → 4 days
 *
 *  Same numbers as the prior Daily-pass streak — the metric changed
 *  from "consecutive Daily passes" to "consecutive days the Legendary
 *  target was hit." Combined with the per-class XP gate (below),
 *  these are the two gates a player must clear to advance years. */
export function requiredStreakForGrade(grade: Grade): number {
  const idx = GRADES.indexOf(grade);
  if (idx === -1) return 1;
  return idx + 1; // 9 → 1, 10 → 2, 11 → 3, 12 → 4
}

/** Per-class XP required to advance OUT of a year. The single total-XP
 *  gate from earlier iterations is gone — it was undifferentiated and
 *  let players duck a whole subject (a streak of Sally-only days could
 *  graduate Senior year without ever sitting in Edward's room). New rule:
 *
 *    To advance: (a) the streak holds AND (b) at least N XP in EACH
 *    teaching room (homeroom / science / literature).
 *
 *  Three teaching rooms × this per-class minimum = effective total floor:
 *
 *    Freshman:  2 each (6 floor)
 *    Sophomore: 5 each (15 floor)
 *    Junior:    10 each (30 floor)
 *    Senior:    16 each (48 floor)
 *
 *  Pacing mirrors the previous total curve, but graduation now means
 *  passing every class — the rooms have mechanical weight. */
export function requiredSubjectXpForGrade(grade: Grade): number {
  switch (grade) {
    case "9":  return 2;
    case "10": return 5;
    case "11": return 10;
    case "12": return 16;
  }
}

/** Difficulty progression up the high school years. */
export function difficultyForGrade(grade: Grade): Difficulty {
  if (grade === "9") return "easy";
  if (grade === "10" || grade === "11") return "medium";
  return "hard";
}

/** The grade the player advances to after completing `grade`. Returns null
 *  when there's no next year — i.e. Senior year, which means the run is
 *  graduating rather than advancing. */
export function nextGradeAfter(grade: Grade): Grade | null {
  const idx = GRADES.indexOf(grade);
  if (idx === -1 || idx === GRADES.length - 1) return null;
  return GRADES[idx + 1] ?? null;
}

export type QuestionType = "multiple-choice" | "opinion";

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
  /** Multiple-choice fields — required when type === "multiple-choice". */
  options?: Record<Choice, string>;
  correct?: Choice;
  /** Opinion fields — describes what a strong response looks like, fed to
   *  both the responding LLMs and the grading teacher. */
  rubric?: string;
  /** Shared. */
  explanation?: string;
  subject?: string;
  difficulty?: Difficulty;
  faculty?: string;
  /** Stamped by `pose()` if the caller didn't pre-roll one. Drives the
   *  XP awarded on a correct answer (0 / 1 / 2 for common / rare /
   *  legendary) and the per-day Legendary count toward the streak. */
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
  picked: Choice;
  correct: Choice;
  wasCorrect: boolean;
  at: number;
}

export interface QuizState {
  sessionId: string;
  faculty: string;
  subject: string | null;
  current: Question | null;
  history: AnswerRecord[];
  score: { correct: number; total: number };
  lastReveal: {
    questionId: string;
    picked: Choice;
    correct: Choice;
    wasCorrect: boolean;
    explanation: string | null;
    encouragement: string | null;
    /** Player's 2d6 + stat roll for this question. Bonus-only — a good roll
     *  awards XP, a poor roll never penalizes. NPC rolls (in
     *  ActiveRound.npcs) are where the actual race stakes live. */
    playerRoll?: {
      stat: keyof CharacterStats;
      dice: [number, number];
      total: number;
      outcome: RoundOutcome;       // hit | mixed | miss
      xpAwarded: number;
    } | null;
    /** NPCs in the active room also answered — for UI animation. */
    npcEvents?: Array<{
      studentId: string;
      gotIt: boolean;
      completed?: string;
      movedTo?: string | null;
    }>;
  } | null;
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
  /** The player's character sheet. Created once (on first run) and
   *  immutable thereafter (graduation flow archives it to a yearbook). */
  character: PlayerCharacter | null;
  /** Per-grade NPC student rosters. Keyed by grade so progress persists when
   *  the player switches grades and comes back. */
  npcRosters: Partial<Record<Grade, NpcStudentState[]>>;
  /** The cohort — each of the 6 NPCs running their own 4-year arc
   *  alongside the player. Independent grades + streaks. Initialized at
   *  grade 9 (everyone starts as Freshmen together). Legendary-day ticks
   *  every NPC's streak via their HEAD stat + 2d6 roll. */
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
  subjects: ["onboarding", "general-knowledge", "ratimics-lore", "agent-culture"],
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
];

export const ALL_FACULTY: FacultyMember[] = [RUBY_FACULTY, ...PLANNED_FACULTY];

/** Special pseudo-faculty: the Teachers' Lounge is a hangout channel where
 *  Ruby, Sally, and Edward chat with each other. Not a real teacher; can't
 *  pose questions. The chat-service treats faculty="lounge" specially. */
export const LOUNGE_FACULTY: FacultyMember = {
  id: "lounge",
  displayName: "Teachers' Lounge",
  shortName: "Lounge",
  subjects: ["lounge"],
  bio: "The faculty hangout. Ruby, Sally, and Edward swap notes between classes — pull up a chair.",
  available: true,
  accent: "#9b6dff",
};

/** Ruby High has four rooms. Three are classrooms (one per teacher). The
 *  fourth is the lounge. Rooms are fixed — they don't change per grade. */
export type RoomId = "homeroom" | "science" | "literature" | "lounge";

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
    description: "Ruby's homeroom. General knowledge, ratimics lore, the meta of the school.",
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
export const TEACHING_ROOMS: TeachingRoomId[] = ["homeroom", "science", "literature"];

/** Four-stat character profile used by both the player and NPC students.
 *  Range -1 to +3. Each playbook starts with one +2, one +1, one 0, one -1. */
export interface CharacterStats {
  head: number;     // recall / academic
  heart: number;    // empathy / social
  hustle: number;   // speed / improvisation
  honor: number;    // discipline / integrity
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
  /** A 2-3 sentence personality blurb that teachers see in their context
   *  when interacting with the player. */
  personality: string;
  /** Generated sticker portrait as a base64 data URL. Optional — set by the
   *  /chat/character/portrait endpoint after creation. */
  portraitDataUrl?: string;
  /** XP accumulated across all years. */
  xp: number;
  /** Past-year archive — populated at grade completion. Each entry is a
   *  **Paper Card**: a frozen snapshot of identity at the moment the year
   *  closed. Paper cards never change after they're written; the live
   *  character is the **Stat Card**. The split is the user-facing model:
   *  one paper card per grade earned, plus a stat card on top.
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
  }>;
  /** Legendary-day streak in the active grade. A "day complete" is the
   *  first time on a given UTC date that the player has answered
   *  `legendariesPerDayFor(grade)` Legendary questions correctly.
   *  Each completion increments `count` (capped to once per UTC date,
   *  recorded in `lastDate`). Skipping a day (today is more than 1
   *  day past `lastDate`) resets the streak. Switching grade resets
   *  to `{ grade: newGrade, count: 0 }`.
   *
   *  Pre-rarity-refactor characters had streak counted as Daily passes;
   *  the count carries forward but anchors to the new metric (no
   *  in-place migration needed — the field shape is the same). */
  streak?: { grade: Grade; count: number; lastDate?: string };
  /** How many Legendary questions the player has answered correctly
   *  on the current UTC date. Resets implicitly when `date` ages out
   *  (any update on a new date overwrites the count). */
  legendariesToday?: { date: string; count: number };
  /** UTC date of the last bonus question played. The bonus
   *  question is a forced-Legendary, available once per UTC day —
   *  the cheap retention hook that survived the rarity refactor.
   *  Replaces the old `lastDailyDate` (same shape, different
   *  semantics — the old one gated the entire arc; this one only
   *  gates the bonus). */
  lastBonusDate?: string;
  /** Per-faculty score record — {correct, total} keyed by faculty id.
   *  Tracks attempts AND passes so we can compute a CORRECTNESS RATIO
   *  per teacher, used at graduation to pick the diploma image's
   *  subject-themed accessory (best ratio wins). NOT redundant with
   *  subjectXp — that's pure pass count, no notion of attempts. Optional
   *  for legacy characters; defaulted to {} on hydrate. */
  subjectScores?: Record<string, { correct: number; total: number }>;
  /** Per-grade "Roll for advantage" usage. Keyed by grade. Each grade
   *  allows ADVANTAGE_ROLLS_PER_GRADE rolls; once spent, rollAdvantage
   *  returns null with reason="exhausted" and the UI greys the button.
   *  Partial<> because not every grade has a key — only ones the player
   *  has rolled in. Defaulted to {} on hydrate. */
  advantageRollsUsed?: Partial<Record<Grade, number>>;
  /** Per-faculty XP pool. Each Rare/Legendary pass increments the pool of the
   *  faculty whose room the question was posed in. Year advancement
   *  requires `requiredSubjectXpForGrade(grade)` in EACH teaching
   *  faculty's pool — the rule that gives the rooms mechanical weight.
   *  Optional for legacy characters; defaulted to {} on hydrate. */
  subjectXp?: Record<string, number>;
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
  createdAt: number;
}

// ── Daily-key / bonus mechanic ─────────────────────────────────────────────
//
// The daily key is now the cadence primitive for the once-per-day forced
// Legendary bonus and streak math. Regular play is open-ended and rarity
// rolled; the 17:00 UTC bell decides which bonus window "today" means.

/** The school-bell cutoff: 17:00 UTC. Before that, "today" is yesterday's
 *  date for bonus/streak purposes. After, "today" advances. */
export const DAILY_BELL_HOUR_UTC = 17;

/** YYYY-MM-DD key for the bonus/streak window on a given moment. Anchors all streak +
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
    // yesterday's bonus window.
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }
  const y = adjusted.getUTCFullYear();
  const m = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(adjusted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days between two dailyKey strings. Both must be YYYY-MM-DD as
 *  produced by `dailyKey()`. Returns a non-negative integer when
 *  `b` >= `a`, or a negative number otherwise. Used by the rarity
 *  refactor's streak math to detect "consecutive day" vs "fresh
 *  start." */
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

/** Day-of-week (0=Sun..6=Sat) for a daily key. Drives bonus faculty rotation. */
export function dayOfWeekForKey(key: string): number {
  const [yStr, mStr, dStr] = key.split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Bonus faculty rotation — runs every day of the week. The 5-teacher cycle
 *  (Sally / Edward / Ruby / Sally / Edward) extends across Sat/Sun by
 *  continuing the rotation: Sat → Ruby, Sun → Sally. Always returns a
 *  faculty id; the bonus is available 7 days a week. */
export function facultyForDay(key: string): string {
  const dow = dayOfWeekForKey(key);
  switch (dow) {
    case 1: return "sally-science";    // Monday
    case 2: return "professor-edward"; // Tuesday
    case 3: return "ruby";             // Wednesday
    case 4: return "sally-science";    // Thursday
    case 5: return "professor-edward"; // Friday
    case 6: return "ruby";             // Saturday
    case 0: return "sally-science";    // Sunday
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
}

/** Per-NPC arc state — tracks each classmate's independent progression
 *  through the 4-year arc. Same shape as the player: a streak in their
 *  current grade, a list of completed grades, a graduated flag. NPCs
 *  ride along on the player's Legendary-day completions — when the player
 *  hits today's Legendary target, every still-in-school NPC also rolls pass/fail
 *  and ticks their own streak. They can outpace or fall behind. The
 *  cohort is the rivalry layer: "Indra graduated last week" is real. */
export interface NpcArcState {
  id: string;
  /** Current grade. Independent of `currentGrade` on QuizState. */
  grade: Grade;
  /** Per-grade Legendary-day streak, anchored to the current grade. */
  streak: { grade: Grade; count: number };
  completedGrades: Grade[];
  /** True once Senior streak completes. Stops further ticking. */
  graduated: boolean;
  /** Day key (YYYY-MM-DD) of the last Legendary-day tick this NPC participated in.
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
  /** 2d6 + HEAD total used to pick `plannedPick`. */
  rolledTotal: number;
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

export interface ActiveRound {
  questionId: string;
  /** Branches the round mechanic. Defaults to multiple-choice. */
  type: QuestionType;
  startedAt: number;        // ms epoch
  durationMs: number;        // hard timer; round force-resolves at this point
  expiresAt: number;
  npcs: NpcRoundEntry[];
  player: { picked: Choice | null; answeredAt: number | null };
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
  /** True when this round is the once-per-day bonus question — a
   *  forced-Legendary draw served by `playBonus`. The bonus's only
   *  privilege is the guaranteed Legendary roll; XP + streak still
   *  flow through the same rarity-driven path as any other round. */
  isBonus?: boolean;
  /** Rarity stamped on the question this round is built around. Mirrors
   *  `state.current.rarity` so the SSE telemetry doesn't have to
   *  re-derive it. Drives the COMMON / RARE / LEGENDARY pill in the
   *  viewer chalkboard meta. */
  rarity?: Rarity;
  /** Legacy: pre-rarity refactor used "isDaily" to mean "this round
   *  ticks the arc." Kept on the type for back-compat with any
   *  persisted activeRound; new code uses `isBonus` + `rarity`. */
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

export function rollNpcAnswer(stats: CharacterStats, correct: Choice): {
  pick: Choice;
  total: number;
  dice: [number, number];
  outcome: RoundOutcome;
  delayMs: number;
} {
  const r = roll2d6();
  const total = r.total + stats.head;
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
  return { pick, total, dice: r.dice, outcome, delayMs };
}

/** Initial seating chart per grade — drives the per-classroom NPC race
 *  (when the player poses a question, the NPCs in that room roll
 *  alongside). Static for the year now that per-question redistribution
 *  is gone (cohort dice, not seating, drive arc progression). */
export const INITIAL_STUDENT_LAYOUT: Record<Grade, Record<TeachingRoomId, string[]>> = {
  "9":  { homeroom: ["lyra", "mika"],  science: ["sami", "ravi"],  literature: ["indra", "noor"] },
  "10": { homeroom: ["sami", "noor"],  science: ["ravi", "mika"],  literature: ["lyra", "indra"] },
  "11": { homeroom: ["ravi", "indra"], science: ["lyra", "noor"],  literature: ["sami", "mika"] },
  "12": { homeroom: ["mika", "indra"], science: ["noor", "lyra"],  literature: ["ravi", "sami"] },
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

/** Initial cohort — all 6 NPCs as Freshmen, fresh streaks. They'll diverge
 *  from this baseline as the player clears Legendary days and the dice roll for
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

/** NPC stats keyed by id — for dice rolls during Legendary-day ticks. */
export function npcStatsFor(id: string): CharacterStats {
  return { ...(NPC_STAT_DEFAULTS[id] ?? { head: 0, heart: 0, hustle: 0, honor: 0 }) };
}
