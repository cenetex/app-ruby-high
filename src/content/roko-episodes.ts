import episodeData from "../../assets/episodes/roko.json";
import {
  difficultyForGrade,
  type BankedQuestion,
  type CaseStudyActionResult,
  type CaseStudyCard,
  type CaseStudyChoiceResult,
  type CaseStudyEvent,
  type CaseStudyFunction,
  type CaseStudyOutcome,
  type CaseStudyProgress,
  type CaseStudyStage,
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
  results?: Record<string, Omit<CaseStudyChoiceResult, "stage" | "choiceLabel" | "event"> & {
    event?: CaseStudyEvent;
    delayedLabel?: string;
    delayedConsequence?: string;
  }>;
}

export interface RokoAssignmentChoice {
  label: string;
  choiceId: string;
  lockedText: string;
  nextNodeId?: string;
  event: CaseStudyEvent;
  revealedEvidence?: CaseStudyCard["evidence"];
  reflection: string;
}

export interface RokoAssignmentNode {
  id: string;
  title: string;
  stage: Exclude<CaseStudyStage, "explain">;
  function: CaseStudyFunction;
  scene: string;
  prompt: string;
  explanation: string;
  evidence?: CaseStudyCard["evidence"];
  choices: RokoAssignmentChoice[];
}

export interface RokoAssignmentGraph {
  label: string;
  entryNodeId: string;
  /** Number of committed assignment moves before the final Return. */
  assignmentCount: number;
  nodes: RokoAssignmentNode[];
}

export interface RokoEpisode {
  id: string;
  title: string;
  hook: string;
  scene: string;
  scenes?: Partial<Record<CaseStudyStage, string>>;
  subject: string;
  stat: keyof CharacterStats;
  evidence: CaseStudyCard["evidence"];
  sources?: CaseStudyCard["sources"];
  assignmentGraph?: RokoAssignmentGraph;
  investigation?: RokoEpisodeChoice;
  decision?: RokoEpisodeChoice;
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

for (const episode of parsed.episodes) {
  const graph = episode.assignmentGraph;
  if (!graph) {
    if (!episode.investigation || !episode.decision) {
      throw new Error(`Roko episode ${episode.id} needs an assignment graph or two legacy choices.`);
    }
    continue;
  }
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(graph.entryNodeId)) throw new Error(`Roko episode ${episode.id} has no graph entry node.`);
  if (graph.assignmentCount < 1) throw new Error(`Roko episode ${episode.id} has an empty assignment graph.`);
  const choiceIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.choices.length !== 4) throw new Error(`Roko assignment ${node.id} must offer four moves.`);
    for (const choice of node.choices) {
      if (choiceIds.has(choice.choiceId)) throw new Error(`Roko episode ${episode.id} repeats choice ${choice.choiceId}.`);
      if (eventIds.has(choice.event.eventId)) throw new Error(`Roko episode ${episode.id} repeats event ${choice.event.eventId}.`);
      choiceIds.add(choice.choiceId);
      eventIds.add(choice.event.eventId);
      if (choice.nextNodeId && !ids.has(choice.nextNodeId)) {
        throw new Error(`Roko assignment ${node.id} points to missing node ${choice.nextNodeId}.`);
      }
    }
  }
  const reachable = new Set<string>();
  const walk = (nodeId: string, move: number, route: Set<string>): void => {
    if (route.has(nodeId)) throw new Error(`Roko episode ${episode.id} loops through ${nodeId} without a retreat rule.`);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId)!;
    reachable.add(nodeId);
    const nextRoute = new Set(route).add(nodeId);
    for (const choice of node.choices) {
      if (move === graph.assignmentCount) {
        if (choice.nextNodeId) throw new Error(`Roko route ${nodeId} continues past its Return.`);
      } else {
        if (!choice.nextNodeId) throw new Error(`Roko route ${nodeId} returns before move ${graph.assignmentCount}.`);
        walk(choice.nextNodeId, move + 1, nextRoute);
      }
    }
  };
  walk(graph.entryNodeId, 1, new Set());
  if (reachable.size !== graph.nodes.length) throw new Error(`Roko episode ${episode.id} contains an unreachable assignment.`);
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

function graphNode(episode: RokoEpisode, nodeId: string | null | undefined): RokoAssignmentNode | null {
  if (!nodeId || !episode.assignmentGraph) return null;
  return episode.assignmentGraph.nodes.find((node) => node.id === nodeId) ?? null;
}

function routeFor(
  episode: RokoEpisode,
  progress: CaseStudyProgress | null | undefined,
  currentNode: RokoAssignmentNode | null,
): Array<{ nodeId: string; label: string }> | undefined {
  if (!episode.assignmentGraph) return undefined;
  const routeIds = [...(progress?.visitedNodeIds ?? [])];
  if (currentNode && !routeIds.includes(currentNode.id)) routeIds.push(currentNode.id);
  const route = routeIds.flatMap((nodeId) => {
    const node = graphNode(episode, nodeId);
    return node ? [{ nodeId, label: node.title }] : [];
  });
  return route.length > 0 ? route : undefined;
}

function caseCard(
  episode: RokoEpisode,
  stage: CaseStudyStage,
  progress?: CaseStudyProgress | null,
  node?: RokoAssignmentNode | null,
): CaseStudyCard {
  const route = routeFor(episode, progress, node ?? null);
  return {
    episodeId: episode.id,
    title: episode.title,
    hook: episode.hook,
    scene: node?.scene ?? episode.scenes?.[stage] ?? episode.scene,
    stage,
    ...(episode.assignmentGraph ? { assignmentLabel: episode.assignmentGraph.label } : {}),
    ...(node ? {
      nodeId: node.id,
      nodeTitle: node.title,
      storyFunction: node.function,
    } : stage === "explain" && episode.assignmentGraph ? {
      nodeId: "return",
      nodeTitle: "Council Chamber",
      storyFunction: "return" as const,
    } : {}),
    ...(route ? { route } : {}),
    evidence: (node?.evidence ?? episode.evidence).map((item) => ({ ...item })),
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

function legacyStoryResults(
  card: RokoEpisodeChoice,
  stage: "investigate" | "decide",
): Record<string, CaseStudyChoiceResult> {
  return Object.fromEntries(episodeChoices(card).map((choice) => {
    const authored = card.results?.[choice];
    const investigation = card.actionResults?.[choice];
    const detail = authored?.event?.detail
      ?? authored?.delayedConsequence
      ?? card.consequences?.[choice]
      ?? investigation?.report
      ?? "The move changes the situation. The next assignment will show which question it opens.";
    const event: CaseStudyEvent = authored?.event ?? {
      eventId: `legacy:${investigation?.actionId ?? choiceId(stage, choice)}`,
      label: authored?.delayedLabel ?? (stage === "investigate" ? "The move uncovers a sign" : "The situation changes"),
      detail,
    };
    const revealedEvidence = authored?.revealedEvidence ?? (investigation?.revealedEvidence
      ? [{ ...investigation.revealedEvidence }]
      : undefined);
    return [choice, {
      choiceId: authored?.choiceId ?? investigation?.actionId ?? choiceId(stage, choice),
      stage,
      choiceLabel: choice,
      lockedText: authored?.lockedText ?? "Roko records the move without marking it right or wrong.",
      event,
      ...(revealedEvidence ? { revealedEvidence: structuredClone(revealedEvidence) } : {}),
      reflection: authored?.reflection ?? investigation?.verificationPrompt ?? card.explanation,
    }];
  }));
}

function graphQuestion(
  episode: RokoEpisode,
  node: RokoAssignmentNode,
  grade: Grade,
  progress?: CaseStudyProgress | null,
): BankedQuestion {
  const storyChoices = node.choices.map((choice) => choice.label);
  const storyChoiceResults = Object.fromEntries(node.choices.map((choice) => [choice.label, {
    choiceId: choice.choiceId,
    nodeId: node.id,
    stage: node.stage,
    choiceLabel: choice.label,
    lockedText: choice.lockedText,
    ...(choice.nextNodeId ? { nextNodeId: choice.nextNodeId } : {}),
    event: structuredClone(choice.event),
    ...(choice.revealedEvidence ? { revealedEvidence: structuredClone(choice.revealedEvidence) } : {}),
    reflection: choice.reflection,
  } satisfies CaseStudyChoiceResult]));
  return {
    id: `roko_case_${episode.id}_${node.id}_${grade}`,
    prompt: node.prompt,
    type: "story-choice",
    storyChoices,
    explanation: "The move is committed. Follow the event it causes; there is no answer key for this room.",
    storyChoiceResults,
    caseStudy: caseCard(episode, node.stage, progress, node),
    subject: episode.subject,
    stat: episode.stat,
    difficulty: difficultyForGrade(grade),
    minGrade: grade,
    faculty: "roko",
  };
}

export function rokoAssignmentCount(episode: RokoEpisode): number {
  return episode.assignmentGraph?.assignmentCount ?? 2;
}

export function rokoNextAssignmentNode(
  episode: RokoEpisode,
  progress?: CaseStudyProgress | null,
): RokoAssignmentNode | null {
  const graph = episode.assignmentGraph;
  if (!graph) return null;
  const nodeId = progress?.episodeId === episode.id
    ? progress.currentNodeId
    : graph.entryNodeId;
  return graphNode(episode, nodeId ?? null);
}

/** Select the next assignment from graph state. No wall-clock value is read. */
export function rokoEpisodeAssignment(
  episode: RokoEpisode,
  grade: Grade,
  progress?: CaseStudyProgress | null,
): BankedQuestion | null {
  const node = rokoNextAssignmentNode(episode, progress);
  if (node) return graphQuestion(episode, node, grade, progress);
  const completed = progress?.episodeId === episode.id ? progress.choices.length : 0;
  if (completed >= 2) return null;
  return rokoEpisodeQuestion(episode, completed === 0 ? "investigate" : "decide", grade, progress);
}

export function rokoEpisodeQuestion(
  episode: RokoEpisode,
  stage: "investigate" | "decide",
  grade: Grade,
  progress?: CaseStudyProgress | null,
): BankedQuestion {
  if (episode.assignmentGraph) {
    const node = stage === "investigate"
      ? graphNode(episode, episode.assignmentGraph.entryNodeId)
      : rokoNextAssignmentNode(episode, progress);
    if (!node) throw new Error(`Roko episode ${episode.id} has no open ${stage} assignment.`);
    return graphQuestion(episode, node, grade, progress);
  }
  const card = stage === "investigate" ? episode.investigation! : episode.decision!;
  return {
    id: `roko_case_${episode.id}_${stage}_${grade}`,
    prompt: card.prompt,
    type: "story-choice",
    storyChoices: episodeChoices(card),
    explanation: "The move is committed. The next event will show what it changed.",
    storyChoiceResults: legacyStoryResults(card, stage),
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
    ? ` Your route: ${choices.map((choice) => `“${choice.choiceLabel}” caused “${choice.event.label}”`).join("; ")}.`
    : "";
  return {
    prompt: `${episode.take.prompt}${pathSuffix}`,
    rubric: `${episode.take.rubric} Judge the update across the whole route; do not reward or punish a particular door by itself.`,
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
