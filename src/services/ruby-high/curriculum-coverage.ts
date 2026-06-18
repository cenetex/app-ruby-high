import type { Difficulty, Grade } from "../../types.js";

export interface RubyHighCurriculumCoverageSnapshot {
  activeCharacterSessions: number;
  rows: RubyHighCurriculumCoverageRow[];
  lowPools: RubyHighCurriculumCoverageRow[];
}

export interface RubyHighCurriculumCoverageRow {
  grade: Grade;
  facultyId: string;
  displayName: string;
  sessions: number;
  totalEligibleMin: number;
  totalEligibleMax: number;
  averageSeen: number;
  averageRemaining: number;
  remainingShare: number | null;
  lowPoolSessions: number;
  exhaustedSessions: number;
  replenishment: RubyHighCurriculumReplenishmentPlan | null;
}

export interface RubyHighCurriculumReplenishmentPlan {
  mode: "manual-curation" | "generate";
  targetMinGrade: Grade;
  targetDifficulty: Difficulty;
  targetNewQuestions: number;
  sourceCardCount: number;
  focusSubjects: string[];
  sourceCardIds: string[];
  promptSeed: string;
}

export interface MutableCurriculumCoverageRow {
  grade: Grade;
  facultyId: string;
  displayName: string;
  sessions: number;
  totalEligibleMin: number;
  totalEligibleMax: number;
  seenSum: number;
  remainingSum: number;
  lowPoolSessions: number;
  exhaustedSessions: number;
  sourceCardIds: Set<string>;
  sourceSubjects: Map<string, number>;
}

export function generationDifficultyForCurriculumGrade(grade: Grade): Difficulty {
  if (grade === "12") return "hard";
  if (grade === "11") return "medium";
  return "easy";
}

export function buildCurriculumReplenishmentPlan(args: {
  grade: Grade;
  facultyId: string;
  displayName: string;
  lowPoolSessions: number;
  exhaustedSessions: number;
  sourceCardCount: number;
  focusSubjects: string[];
  sourceCardIds: string[];
}): RubyHighCurriculumReplenishmentPlan {
  const targetDifficulty = generationDifficultyForCurriculumGrade(args.grade);
  const mode: RubyHighCurriculumReplenishmentPlan["mode"] = args.grade === "9" ? "manual-curation" : "generate";
  const pressure = Math.max(args.lowPoolSessions, args.exhaustedSessions * 2);
  const targetNewQuestions = mode === "manual-curation"
    ? Math.max(6, Math.min(16, pressure * 4))
    : Math.max(12, Math.min(36, pressure * 6));
  const subjectHint = args.focusSubjects.length ? args.focusSubjects.join(", ") : "the teacher's current research corpus";
  const promptSeed = [
    mode === "manual-curation"
      ? `Curate Freshman starter questions for ${args.displayName}; keep grade 9 hand-authored and unusually polished.`
      : `Generate ${targetNewQuestions} ${targetDifficulty} questions for ${args.displayName} with minGrade ${args.grade}.`,
    `Focus subjects: ${subjectHint}.`,
    args.sourceCardIds.length ? `Prioritize source cards: ${args.sourceCardIds.join(", ")}.` : "",
    "Avoid repeating existing prompts; write like the teacher is actively researching this class, not filling a spreadsheet.",
  ].filter(Boolean).join(" ");
  return {
    mode,
    targetMinGrade: args.grade,
    targetDifficulty,
    targetNewQuestions,
    sourceCardCount: args.sourceCardCount,
    focusSubjects: args.focusSubjects,
    sourceCardIds: args.sourceCardIds,
    promptSeed,
  };
}

export function buildCurriculumCoverageSnapshot(
  activeCharacterSessions: number,
  rows: Iterable<MutableCurriculumCoverageRow>,
): RubyHighCurriculumCoverageSnapshot {
  const normalized = Array.from(rows).map(normalizeCurriculumCoverageRow).sort((a, b) =>
    Number(a.grade) - Number(b.grade) ||
    a.displayName.localeCompare(b.displayName) ||
    a.facultyId.localeCompare(b.facultyId)
  );
  const lowPools = normalized
    .filter((row) => row.lowPoolSessions > 0)
    .sort((a, b) =>
      (a.remainingShare ?? 1) - (b.remainingShare ?? 1) ||
      b.lowPoolSessions - a.lowPoolSessions ||
      Number(a.grade) - Number(b.grade) ||
      a.displayName.localeCompare(b.displayName)
    )
    .slice(0, 8);
  return { activeCharacterSessions, rows: normalized, lowPools };
}

function normalizeCurriculumCoverageRow(row: MutableCurriculumCoverageRow): RubyHighCurriculumCoverageRow {
  const averageRemaining = row.sessions > 0 ? row.remainingSum / row.sessions : 0;
  const averageSeen = row.sessions > 0 ? row.seenSum / row.sessions : 0;
  const remainingShare = row.totalEligibleMax > 0 ? averageRemaining / row.totalEligibleMax : null;
  const sourceCardIds = Array.from(row.sourceCardIds).slice(0, 12);
  const focusSubjects = Array.from(row.sourceSubjects.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([subject]) => subject);
  return {
    grade: row.grade,
    facultyId: row.facultyId,
    displayName: row.displayName,
    sessions: row.sessions,
    totalEligibleMin: row.totalEligibleMin,
    totalEligibleMax: row.totalEligibleMax,
    averageSeen,
    averageRemaining,
    remainingShare,
    lowPoolSessions: row.lowPoolSessions,
    exhaustedSessions: row.exhaustedSessions,
    replenishment: row.lowPoolSessions > 0 ? buildCurriculumReplenishmentPlan({
      grade: row.grade,
      facultyId: row.facultyId,
      displayName: row.displayName,
      lowPoolSessions: row.lowPoolSessions,
      exhaustedSessions: row.exhaustedSessions,
      sourceCardCount: row.sourceCardIds.size,
      focusSubjects,
      sourceCardIds,
    }) : null,
  };
}
