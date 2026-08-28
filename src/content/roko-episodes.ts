import episodeData from "../../assets/episodes/roko.json";
import {
  difficultyForGrade,
  type BankedQuestion,
  type CaseStudyActionResult,
  type CaseStudyCard,
  type CaseStudyOutcome,
  type CaseStudyProgress,
  type CharacterStats,
  type Grade,
} from "../types.js";

export interface RokoEpisodeChoice {
  prompt: string;
  correct: string;
  decoys: string[];
  explanation: string;
  consequences?: Record<string, string>;
  actionResults?: Record<string, CaseStudyActionResult>;
}

export interface RokoEpisode {
  id: string;
  title: string;
  hook: string;
  scene: string;
  subject: string;
  stat: keyof CharacterStats;
  evidence: CaseStudyCard["evidence"];
  investigation: RokoEpisodeChoice;
  decision: RokoEpisodeChoice;
  take: {
    prompt: string;
    rubric: string;
  };
  outcome: Omit<CaseStudyOutcome, "episodeId" | "title">;
}

type EpisodeFile = { version: number; episodes: RokoEpisode[] };

const parsed = episodeData as unknown as EpisodeFile;

if (parsed.version !== 1 || !Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
  throw new Error("Roko episode data is missing or has an unsupported version.");
}

export const ROKO_EPISODES: readonly RokoEpisode[] = parsed.episodes;

export function rokoOnboardingEpisode(): RokoEpisode {
  return ROKO_EPISODES.find((episode) => episode.id === "exact-treasure") ?? ROKO_EPISODES[0]!;
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

/** The same student, date, and grade always get the same episode. */
export function rokoEpisodeForClass(date: string, grade: Grade): RokoEpisode {
  return ROKO_EPISODES[stableIndex(`${date}:${grade}`, ROKO_EPISODES.length)]!;
}

function caseCard(
  episode: RokoEpisode,
  stage: CaseStudyCard["stage"],
  progress?: CaseStudyProgress | null,
): CaseStudyCard {
  return {
    episodeId: episode.id,
    title: episode.title,
    hook: episode.hook,
    scene: episode.scene,
    stage,
    evidence: episode.evidence.map((item) => ({ ...item })),
    ...(progress?.episodeId === episode.id ? { investigation: { ...progress.action } } : {}),
  };
}

export function rokoEpisodeQuestion(
  episode: RokoEpisode,
  stage: "investigate" | "decide",
  grade: Grade,
  progress?: CaseStudyProgress | null,
): BankedQuestion {
  const card = stage === "investigate" ? episode.investigation : episode.decision;
  return {
    id: `roko_case_${episode.id}_${stage}_${grade}`,
    prompt: card.prompt,
    type: "multiple-choice",
    correct: card.correct,
    decoys: [...card.decoys],
    explanation: card.explanation,
    ...(card.consequences ? { answerConsequences: { ...card.consequences } } : {}),
    ...(card.actionResults ? { caseActionResults: { ...card.actionResults } } : {}),
    caseStudy: caseCard(episode, stage, progress),
    subject: episode.subject,
    stat: episode.stat,
    difficulty: difficultyForGrade(grade),
    minGrade: grade,
    faculty: "roko",
  };
}

export function rokoEpisodeTake(episode: RokoEpisode, progress?: CaseStudyProgress | null): {
  prompt: string;
  rubric: string;
  subject: string;
  caseStudy: CaseStudyCard;
  caseOutcome: CaseStudyOutcome;
} {
  const investigation = progress?.episodeId === episode.id ? progress.action : null;
  const verificationSuffix = investigation
    ? ` Also say how you would verify ${investigation.actorName}'s report before relying on it.`
    : "";
  const verificationRubric = investigation
    ? " Names a concrete check that could confirm or challenge the investigation report."
    : "";
  return {
    prompt: `${episode.take.prompt}${verificationSuffix}`,
    rubric: `${episode.take.rubric}${verificationRubric}`,
    subject: episode.subject,
    caseStudy: caseCard(episode, "explain", progress),
    caseOutcome: {
      episodeId: episode.id,
      title: episode.title,
      ...episode.outcome,
      ...(investigation ? { investigation: { ...investigation } } : {}),
    },
  };
}
