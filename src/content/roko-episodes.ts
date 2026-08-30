import episodeData from "../../assets/episodes/roko.json";
import {
  difficultyForGrade,
  type BankedQuestion,
  type CaseStudyActionResult,
  type CaseStudyCard,
  type CaseStudyChoiceResult,
  type CaseStudyOutcome,
  type CaseStudyProgress,
  type CharacterStats,
  type Grade,
} from "../types.js";

export interface RokoEpisodeChoice {
  prompt: string;
  correct?: string;
  decoys?: string[];
  choices?: string[];
  explanation: string;
  consequences?: Record<string, string>;
  actionResults?: Record<string, CaseStudyActionResult>;
  results?: Record<string, Omit<CaseStudyChoiceResult, "stage" | "choiceLabel">>;
}

export interface RokoEpisode {
  id: string;
  title: string;
  hook: string;
  scene: string;
  scenes?: Partial<Record<CaseStudyCard["stage"], string>>;
  subject: string;
  stat: keyof CharacterStats;
  evidence: CaseStudyCard["evidence"];
  sources?: CaseStudyCard["sources"];
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
  return ROKO_EPISODES.find((episode) => episode.id === "basilisk-archive") ?? ROKO_EPISODES[0]!;
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
    scene: episode.scenes?.[stage] ?? episode.scene,
    stage,
    evidence: episode.evidence.map((item) => ({ ...item })),
    ...(episode.sources ? { sources: episode.sources.map((source) => ({ ...source })) } : {}),
    ...(progress?.episodeId === episode.id
      ? { priorChoices: progress.choices.map((choice) => structuredClone(choice)) }
      : {}),
  };
}

function episodeChoices(card: RokoEpisodeChoice): string[] {
  if (card.choices?.length) return [...card.choices];
  return [card.correct, ...(card.decoys ?? [])].filter((choice): choice is string => Boolean(choice));
}

function choiceId(stage: "investigate" | "decide", choice: string): string {
  return `${stage}-${choice.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`;
}

function storyResults(
  card: RokoEpisodeChoice,
  stage: "investigate" | "decide",
): Record<string, CaseStudyChoiceResult> {
  return Object.fromEntries(episodeChoices(card).map((choice) => {
    const authored = card.results?.[choice];
    if (authored) {
      return [choice, { ...structuredClone(authored), stage, choiceLabel: choice }];
    }
    const investigation = card.actionResults?.[choice];
    const delayedConsequence = card.consequences?.[choice]
      ?? investigation?.report
      ?? `The class follows this move. Its value depends on what the next evidence shows.`;
    const revealedEvidence = investigation?.revealedEvidence
      ? [{ ...investigation.revealedEvidence }]
      : undefined;
    return [choice, {
      choiceId: investigation?.actionId ?? choiceId(stage, choice),
      stage,
      choiceLabel: choice,
      lockedText: "Roko records the move without marking it right or wrong.",
      delayedLabel: stage === "investigate" ? "What the move uncovered" : "What happened later",
      delayedConsequence,
      ...(revealedEvidence ? { revealedEvidence } : {}),
      reflection: investigation?.verificationPrompt ?? card.explanation,
    }];
  }));
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
    type: "story-choice",
    storyChoices: episodeChoices(card),
    explanation: "No verdict yet. The next scene will show what this move changed.",
    storyChoiceResults: storyResults(card, stage),
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
  const choices = progress?.episodeId === episode.id ? progress.choices : [];
  const pathSuffix = choices.length > 0
    ? ` Your path so far: ${choices.map((choice) => `“${choice.choiceLabel}”`).join("; ")}.`
    : "";
  return {
    prompt: `${episode.take.prompt}${pathSuffix}`,
    rubric: `${episode.take.rubric} Judge the update across the whole path; do not reward or punish a particular earlier branch by itself.`,
    subject: episode.subject,
    caseStudy: caseCard(episode, "explain", progress),
    caseOutcome: {
      episodeId: episode.id,
      title: episode.title,
      ...episode.outcome,
      ...(choices.length > 0 ? { choices: choices.map((choice) => structuredClone(choice)) } : {}),
    },
  };
}
