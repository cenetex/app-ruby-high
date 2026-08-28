import episodeData from "../../assets/episodes/roko.json";
import {
  difficultyForGrade,
  type BankedQuestion,
  type CaseStudyCard,
  type CaseStudyOutcome,
  type CharacterStats,
  type Grade,
} from "../types.js";

export interface RokoEpisodeChoice {
  prompt: string;
  correct: string;
  decoys: string[];
  explanation: string;
  consequences?: Record<string, string>;
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

function caseCard(episode: RokoEpisode, stage: CaseStudyCard["stage"]): CaseStudyCard {
  return {
    episodeId: episode.id,
    title: episode.title,
    hook: episode.hook,
    scene: episode.scene,
    stage,
    evidence: episode.evidence.map((item) => ({ ...item })),
  };
}

export function rokoEpisodeQuestion(
  episode: RokoEpisode,
  stage: "investigate" | "decide",
  grade: Grade,
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
    caseStudy: caseCard(episode, stage),
    subject: episode.subject,
    stat: episode.stat,
    difficulty: difficultyForGrade(grade),
    minGrade: grade,
    faculty: "roko",
  };
}

export function rokoEpisodeTake(episode: RokoEpisode): {
  prompt: string;
  rubric: string;
  subject: string;
  caseStudy: CaseStudyCard;
  caseOutcome: CaseStudyOutcome;
} {
  return {
    prompt: episode.take.prompt,
    rubric: episode.take.rubric,
    subject: episode.subject,
    caseStudy: caseCard(episode, "explain"),
    caseOutcome: {
      episodeId: episode.id,
      title: episode.title,
      ...episode.outcome,
    },
  };
}
