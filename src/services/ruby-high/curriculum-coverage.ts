import type { Difficulty, Grade } from "../../types.js";
import type { RubyHighTeacherResearchCorpus } from "./teacher-research-corpus.js";

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
  corpusId: string | null;
  corpusTitle: string | null;
  corpusPath: string | null;
  researchInterests: string[];
  researchLanes: string[];
  researchDirective: string;
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
  researchCorpus: RubyHighTeacherResearchCorpus | null;
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
  researchCorpus?: RubyHighTeacherResearchCorpus | null;
}): RubyHighCurriculumReplenishmentPlan {
  const targetDifficulty = generationDifficultyForCurriculumGrade(args.grade);
  const mode: RubyHighCurriculumReplenishmentPlan["mode"] = args.grade === "9" ? "manual-curation" : "generate";
  const pressure = Math.max(args.lowPoolSessions, args.exhaustedSessions * 2);
  const targetNewQuestions = mode === "manual-curation"
    ? Math.max(6, Math.min(16, pressure * 4))
    : Math.max(12, Math.min(36, pressure * 6));
  const researchCorpus = args.researchCorpus ?? null;
  const researchInterests = researchCorpus?.researchInterests.slice(0, 8) ?? [];
  const researchLanes = researchCorpus?.lanes.slice(0, 5) ?? [];
  const subjectHint = args.focusSubjects.length
    ? args.focusSubjects.join(", ")
    : researchInterests.length
      ? researchInterests.join(", ")
      : "the teacher's current research corpus";
  const researchDirective = buildResearchDirective({
    displayName: args.displayName,
    focusSubjects: args.focusSubjects,
    researchCorpus,
    targetDifficulty,
    targetMinGrade: args.grade,
    mode,
  });
  const promptSeed = [
    mode === "manual-curation"
      ? `Curate Freshman starter questions for ${args.displayName}; keep grade 9 hand-authored and unusually polished.`
      : `Generate ${targetNewQuestions} ${targetDifficulty} questions for ${args.displayName} with minGrade ${args.grade}.`,
    `Focus subjects: ${subjectHint}.`,
    researchDirective,
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
    corpusId: researchCorpus?.id ?? null,
    corpusTitle: researchCorpus?.title ?? null,
    corpusPath: researchCorpus?.corpusPath ?? null,
    researchInterests,
    researchLanes,
    researchDirective,
    promptSeed,
  };
}

function buildResearchDirective(args: {
  displayName: string;
  focusSubjects: string[];
  researchCorpus: RubyHighTeacherResearchCorpus | null;
  targetDifficulty: Difficulty;
  targetMinGrade: Grade;
  mode: RubyHighCurriculumReplenishmentPlan["mode"];
}): string {
  if (!args.researchCorpus) {
    return `Use ${args.displayName}'s source cards as a temporary corpus and expand from the strongest subject gaps.`;
  }
  const lane = args.researchCorpus.lanes.find((entry) =>
    args.focusSubjects.some((subject) => entry.toLowerCase().includes(subject.toLowerCase()))
  ) ?? args.researchCorpus.lanes[0];
  return [
    `Research corpus: ${args.researchCorpus.title} (${args.researchCorpus.corpusPath}).`,
    `Research interests: ${args.researchCorpus.researchInterests.join(", ")}.`,
    lane ? `Current lane: ${lane}` : "",
    args.mode === "manual-curation"
      ? `Keep grade ${args.targetMinGrade} tight, concrete, and hand-curated before broad generation.`
      : `Expand grade ${args.targetMinGrade} with ${args.targetDifficulty} questions that feel like fresh research from this corpus.`,
  ].filter(Boolean).join(" ");
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
      researchCorpus: row.researchCorpus,
    }) : null,
  };
}
