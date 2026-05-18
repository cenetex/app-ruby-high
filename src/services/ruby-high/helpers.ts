import {
  dailyIndex,
  dailyKey,
  daysBetween,
  facultyForDay,
  streakScoreMultiplier,
  type CardMemory,
  type CardReviewRating,
  type DailyClassRecord,
  type Grade,
  type QuizState,
} from "../../types.js";
import {
  coursesForPack,
  packForSession,
  resolveFacultyIdForSession,
} from "../../content/registry.js";

export interface TypedAnswerJudgeResult {
  correct: boolean;
  mode: "exact" | "alias" | "fuzzy";
  score: number;
}

export const SRS_AGAIN_MS = 5 * 60 * 1000;
const SRS_HARD_MS = 30 * 60 * 1000;
export const SRS_ONE_DAY_MS = 24 * 60 * 60 * 1000;
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
const MAX_STORED_IMAGE_REF_LENGTH = 280_000;

export function dailyFacultyForQuizState(state: QuizState, key: string): string {
  const scheduled = facultyForDay(key);
  const resolved = resolveFacultyIdForSession(state, scheduled);
  if (resolved) return resolved;

  const pack = packForSession(state);
  const courseFacultyIds = coursesForPack(pack)
    .map((c) => c.facultyId)
    .filter((facultyId) => pack.faculty.some((f) =>
      f.id === facultyId && (f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
    ));
  if (courseFacultyIds.length === 0) return scheduled;
  const idx = ((dailyIndex(key) % courseFacultyIds.length) + courseFacultyIds.length) % courseFacultyIds.length;
  return courseFacultyIds[idx]!;
}

export function cardMemoryKey(courseId: string, questionId: string): string {
  return `${courseId}::${questionId}`;
}

export function defaultCardMemory(courseId: string, questionId: string): CardMemory {
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

function carriedStreakCountForPass(state: QuizState, now: number): number {
  const ch = state.character;
  const grade = state.currentGrade;
  if (!ch || !grade) return 0;
  const today = dailyKey(new Date(now));
  const current = ch.streak && ch.streak.grade === grade ? ch.streak : null;
  if (!current?.lastDate) return 0;
  if (current.lastDate === today) return Math.max(0, current.count - 1);
  if (daysBetween(current.lastDate, today) === 1) return current.count;
  return 0;
}

export function scoreMultiplierForPass(state: QuizState, passed: boolean, now: number): number {
  if (!passed) return 1;
  return streakScoreMultiplier(carriedStreakCountForPass(state, now));
}

function normalizeAnswerForJudge(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function answerWords(value: string): string[] {
  return normalizeAnswerForJudge(value).split(" ").filter(Boolean);
}

function wordOverlapScore(submitted: string, expected: string): number {
  const expectedWords = answerWords(expected);
  if (expectedWords.length === 0) return 0;
  const submittedWords = new Set(answerWords(submitted));
  if (submittedWords.size === 0) return 0;
  let matched = 0;
  for (const word of expectedWords) {
    if (submittedWords.has(word)) matched += 1;
  }
  return matched / expectedWords.length;
}

export function judgeTypedAnswer(submitted: string, acceptedAnswers: string[]): TypedAnswerJudgeResult {
  const normalizedSubmitted = normalizeAnswerForJudge(submitted);
  const candidates = acceptedAnswers
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);
  if (!normalizedSubmitted || candidates.length === 0) {
    return { correct: false, mode: "fuzzy", score: 0 };
  }
  for (let i = 0; i < candidates.length; i++) {
    if (normalizedSubmitted === normalizeAnswerForJudge(candidates[i]!)) {
      return { correct: true, mode: i === 0 ? "exact" : "alias", score: 1 };
    }
  }
  const score = Math.max(...candidates.map((answer) => wordOverlapScore(submitted, answer)));
  return { correct: score >= 0.8, mode: "fuzzy", score: Math.round(score * 100) / 100 };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function intervalForCorrect(rating: CardReviewRating, consecutiveCorrect: number): number {
  if (rating === "hard") return SRS_HARD_MS;
  const table = rating === "easy" ? SRS_EASY_INTERVALS_MS : SRS_GOOD_INTERVALS_MS;
  return table[Math.min(consecutiveCorrect - 1, table.length - 1)] ?? SRS_GOOD_INTERVALS_MS[0]!;
}

export function dueKnownCard(memory: CardMemory, now: number): boolean {
  return memory.dueAt <= now;
}

export function classRecordKey(grade: Grade, facultyId: string, date: string): string {
  return `${grade}:${facultyId}:${date}`;
}

export function requiredClassCompletionsForGrade(grade: Grade): number {
  void grade;
  // Course grades are withheld until a room has three C-or-better daily
  // classes in a row; the per-year streak gate still scales separately.
  return 3;
}

export function letterGradeForClassScore(score: number | undefined): string | undefined {
  if (score == null || Number.isNaN(score)) return undefined;
  // Daily class score is the correctness percentage: 3/3 A, 2/3 C,
  // 1/3 D, 0/3 F. Dice rolls are applied separately as + / - suffixes.
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 67) return "C";
  if (score > 0) return "D";
  return "F";
}

export type ClassRollGradeModifier = "" | "+" | "-";

export function classRollGradeModifier(hitCount: number | undefined, missCount: number | undefined): ClassRollGradeModifier {
  const hits = Math.max(0, Math.floor(Number(hitCount ?? 0)));
  const misses = Math.max(0, Math.floor(Number(missCount ?? 0)));
  if (hits > misses) return "+";
  if (misses > hits) return "-";
  return "";
}

export function applyClassRollGradeModifier(
  baseLetter: string | undefined,
  modifier: ClassRollGradeModifier,
): string | undefined {
  if (!baseLetter) return undefined;
  if (!modifier || baseLetter === "F") return baseLetter;
  return `${baseLetter}${modifier}`;
}

export function letterGradeForClassRecord(record: DailyClassRecord): string | undefined {
  return applyClassRollGradeModifier(
    letterGradeForClassScore(classAverage(record)),
    classRollGradeModifier(record.rollHitCount, record.rollMissCount),
  );
}

export function classQuestionScore(
  wasCorrect: boolean,
  playerRoll: NonNullable<NonNullable<QuizState["lastReveal"]>["playerRoll"]> | null,
): number {
  // Wrong answers earn no Merit Stars. Per DESIGN.md 1.6.4 the dice classify
  // the round, but rolls only ever upgrade a correct outcome's reward score.
  if (!wasCorrect) return 0;
  const outcome = playerRoll?.outcome ?? "miss";
  const base = outcome === "hit" ? 100 : outcome === "mixed" ? 90 : 80;
  return clamp(base, 0, 100);
}

export function classGradeQuestionScore(wasCorrect: boolean): number {
  return wasCorrect ? 100 : 0;
}

export function awardSessionScore(
  state: QuizState,
  baseScore: number,
  scoreMultiplier = 1,
): NonNullable<NonNullable<QuizState["lastReveal"]>["scoreAward"]> {
  const multiplier = clamp(Math.floor(scoreMultiplier), 1, 5);
  const base = clamp(Math.round(baseScore), 0, 100);
  const points = base * multiplier;
  const possible = 100 * multiplier;
  const currentScorePoints = Math.max(0, Math.floor(Number(state.score.points ?? 0)));
  const currentMeritStars = Math.max(0, Math.floor(Number(state.wallet?.meritStars ?? currentScorePoints)));
  state.score.points = currentScorePoints + points;
  state.score.possible = Math.max(0, Math.floor(Number(state.score.possible ?? 0))) + possible;
  state.wallet = {
    ...(state.wallet ?? {}),
    meritStars: currentMeritStars + points,
    hallPasses: Math.max(0, Math.floor(Number(state.wallet?.hallPasses ?? 0))),
  };
  return { base, multiplier, points, possible };
}

export function classAverage(record: DailyClassRecord): number | undefined {
  if (record.questionCount <= 0) return undefined;
  return Math.round(record.scoreTotal / record.questionCount);
}

export function normalizeStoredImageRef(
  value: string | undefined | null,
  fieldName: "portraitDataUrl" | "diplomaImageDataUrl",
): string | undefined {
  if (value == null) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > MAX_STORED_IMAGE_REF_LENGTH) {
    throw new Error(
      `${fieldName} too large (${text.length} bytes; cap is ${MAX_STORED_IMAGE_REF_LENGTH}). Store the image externally before saving.`,
    );
  }
  if (text.startsWith("data:image/")) return text;
  if (text.startsWith("/api/apps/ruby-high/assets/")) return text;
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") return text;
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error(`${fieldName} must be an image data URL, http(s) URL, or Ruby High asset URL.`);
}
