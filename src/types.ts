export type Choice = "A" | "B" | "C" | "D";

export const CHOICES: Choice[] = ["A", "B", "C", "D"];

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Ruby HIGH School — only grades 9-12 (Freshman, Sophomore, Junior, Senior).
 *  Players default into Junior year. */
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

export const DEFAULT_GRADE: Grade = "11";

/** Number of correct answers required to mark a grade complete. */
export const GRADE_COMPLETION_THRESHOLD = 5;

/** Difficulty progression up the high school years. */
export function difficultyForGrade(grade: Grade): Difficulty {
  if (grade === "9") return "easy";
  if (grade === "10" || grade === "11") return "medium";
  return "hard";
}

export type QuestionType = "multiple-choice" | "opinion";

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
    /** NPCs in the active room also answered — for UI animation. */
    npcEvents?: Array<{
      studentId: string;
      gotIt: boolean;
      completed?: string;
      movedTo?: string | null;
    }>;
  } | null;
  status: "idle" | "awaiting-answer" | "revealed";
  askedQuestionIds: string[];
  /** Currently selected grade. null until the student picks one. */
  currentGrade: Grade | null;
  /** Grades the student has completed (≥ GRADE_COMPLETION_THRESHOLD correct). */
  completedGrades: Grade[];
  /** Per-grade correct-answer counter, working toward completion. */
  gradeProgress: Record<string, number>;
  /** Whether the student has finished the splash/intro and is into the app. */
  hasSeenIntro: boolean;
  /** Per-grade NPC student rosters. Keyed by grade so progress persists when
   *  the player switches grades and comes back. */
  npcRosters: Partial<Record<Grade, NpcStudentState[]>>;
  /** The currently-running race to answer, if any. Cleared when the round
   *  resolves and lastReveal takes over. */
  activeRound: ActiveRound | null;
  updatedAt: number;
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
  currentRoom: TeachingRoomId | null; // null when all subjects done for this grade
  stats: CharacterStats;
  subjects: Record<TeachingRoomId, { correct: number; completed: boolean }>;
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

/** Initial distribution per grade — used as the FIRST seating chart. As
 *  students pass subjects they redistribute via redistributeStudent(). */
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
    subjects: {
      homeroom:   { correct: 0, completed: false },
      science:    { correct: 0, completed: false },
      literature: { correct: 0, completed: false },
    },
  }));
}

/** Roster of students currently in a given room (max 2). */
export function npcsInRoom(roster: NpcStudentState[], room: TeachingRoomId): NpcStudentState[] {
  return roster.filter((n) => n.currentRoom === room);
}

/** When a student completes a subject, find their next room: an incomplete
 *  subject for them with capacity (< 2 active students). Prefers rooms with
 *  fewer active students. Returns null if no room has space + work for them. */
export function pickNextRoomForStudent(
  roster: NpcStudentState[],
  student: NpcStudentState,
): TeachingRoomId | null {
  const candidates = TEACHING_ROOMS.filter(
    (r) => r !== student.currentRoom && !student.subjects[r].completed,
  );
  const occupancy: Record<TeachingRoomId, number> = {
    homeroom: npcsInRoom(roster, "homeroom").length,
    science: npcsInRoom(roster, "science").length,
    literature: npcsInRoom(roster, "literature").length,
  };
  const open = candidates.filter((r) => occupancy[r] < 2);
  if (open.length === 0) return null;
  open.sort((a, b) => occupancy[a] - occupancy[b]);
  return open[0] ?? null;
}
