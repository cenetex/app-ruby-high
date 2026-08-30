import episodeData from "../../assets/episodes/roko.json";
import {
  difficultyForGrade,
  type BankedQuestion,
  type CaseStudyActionResult,
  type CaseStudyCard,
  type CaseStudyChoiceResult,
  type CaseStudyEvent,
  type CaseStudyFunction,
  type CaseStudyLabyrinthState,
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
  /** OSR labyrinths accept a described action and resolve it against the
   *  room state. Other graphs keep the four-button story format. */
  interactionMode?: "story-choice" | "osr";
  nodes: RokoAssignmentNode[];
}

export interface RokoLabyrinthContext {
  presentHumans?: number;
  collaboratorRoles?: string[];
}

export interface RokoLabyrinthActionResolution {
  result: CaseStudyChoiceResult;
  labyrinth: CaseStudyLabyrinthState;
  currentNodeId: string | null;
  roomCompleted: boolean;
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

const BASILISK_LINKS: Record<string, string[]> = {
  "hall-of-four-doors": ["sealed-reading-cell", "mirror-gallery", "ash-stair", "map-room"],
  "sealed-reading-cell": ["hall-of-four-doors", "evidence-well", "repair-workshop", "warden-gate", "rumor-market"],
  "mirror-gallery": ["hall-of-four-doors", "evidence-well", "repair-workshop", "warden-gate", "rumor-market"],
  "ash-stair": ["hall-of-four-doors", "evidence-well", "repair-workshop", "warden-gate", "rumor-market"],
  "map-room": ["hall-of-four-doors", "evidence-well", "repair-workshop", "warden-gate", "rumor-market"],
  "evidence-well": ["map-room", "sealed-reading-cell", "repair-workshop", "hall-of-four-doors"],
  "repair-workshop": ["sealed-reading-cell", "mirror-gallery", "evidence-well", "warden-gate", "hall-of-four-doors"],
  "warden-gate": ["ash-stair", "map-room", "repair-workshop", "rumor-market", "hall-of-four-doors"],
  "rumor-market": ["mirror-gallery", "ash-stair", "warden-gate", "evidence-well", "hall-of-four-doors"],
};

const BASILISK_HUMAN_GATES: Record<string, number> = {
  "sealed-reading-cell": 2,
  "mirror-gallery": 2,
  "ash-stair": 2,
  "repair-workshop": 3,
  "warden-gate": 3,
  "rumor-market": 4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function defaultLabyrinthState(episode: RokoEpisode): CaseStudyLabyrinthState {
  const entry = episode.assignmentGraph?.entryNodeId ?? "hall-of-four-doors";
  return {
    discoveredNodeIds: [entry],
    completedNodeIds: [],
    inventory: ["chalk", "twine"],
    rumor: 1,
    trust: 0,
    distress: 1,
    actionCount: 0,
    contributions: [],
  };
}

function labyrinthState(episode: RokoEpisode, progress?: CaseStudyProgress | null): CaseStudyLabyrinthState {
  const base = defaultLabyrinthState(episode);
  const saved = progress?.labyrinth;
  if (!saved) return base;
  return {
    discoveredNodeIds: [...new Set(saved.discoveredNodeIds)],
    completedNodeIds: [...new Set(saved.completedNodeIds)],
    inventory: [...new Set(saved.inventory)],
    rumor: clamp(saved.rumor, 0, 6),
    trust: clamp(saved.trust, -3, 3),
    distress: clamp(saved.distress, 0, 6),
    actionCount: Math.max(0, saved.actionCount),
    contributions: saved.contributions.map((entry) => ({ ...entry })),
  };
}

function roomLinks(episode: RokoEpisode, nodeId: string): RokoAssignmentNode[] {
  const graph = episode.assignmentGraph;
  if (!graph) return [];
  const ids = episode.id === "basilisk-archive" ? BASILISK_LINKS[nodeId] ?? [] : [];
  return ids.flatMap((id) => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    return node ? [node] : [];
  });
}

function requiredHumans(episode: RokoEpisode, nodeId: string): number {
  return episode.id === "basilisk-archive" ? BASILISK_HUMAN_GATES[nodeId] ?? 1 : 1;
}

function visibleRoomLinks(
  episode: RokoEpisode,
  node: RokoAssignmentNode,
  state: CaseStudyLabyrinthState,
): RokoAssignmentNode[] {
  const soloPassage: Record<string, string> = {
    "hall-of-four-doors": "map-room",
    "map-room": "evidence-well",
  };
  return roomLinks(episode, node.id).filter((exit) => (
    state.discoveredNodeIds.includes(exit.id) || soloPassage[node.id] === exit.id
  ));
}

function labyrinthCardState(
  episode: RokoEpisode,
  progress: CaseStudyProgress | null | undefined,
  node: RokoAssignmentNode | null,
  context: RokoLabyrinthContext = {},
): NonNullable<CaseStudyCard["labyrinth"]> | undefined {
  if (episode.assignmentGraph?.interactionMode !== "osr" || !node) return undefined;
  const state = labyrinthState(episode, progress);
  const visibleExits = visibleRoomLinks(episode, node, state);
  return {
    completedRooms: state.completedNodeIds.length,
    requiredRooms: episode.assignmentGraph.assignmentCount,
    inventory: [...state.inventory],
    rumor: state.rumor,
    trust: state.trust,
    distress: state.distress,
    availableExits: visibleExits.map((exit) => ({ nodeId: exit.id, label: exit.title })),
    requiredHumans: requiredHumans(episode, node.id),
    presentHumans: Math.max(1, context.presentHumans ?? 1),
  };
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
  context: RokoLabyrinthContext = {},
): CaseStudyCard {
  const route = routeFor(episode, progress, node ?? null);
  const labyrinth = labyrinthCardState(episode, progress, node ?? null, context);
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
    ...(labyrinth ? { labyrinth } : {}),
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
  context: RokoLabyrinthContext = {},
): BankedQuestion {
  if (episode.assignmentGraph?.interactionMode === "osr") {
    return {
      id: `roko_case_${episode.id}_${node.id}_${grade}_${progress?.labyrinth?.actionCount ?? 0}`,
      prompt: `${node.prompt} Choose how you approach the room: HEAD, HEART, HUSTLE, or HONOR. The attribute is a method, not an answer.`,
      type: "story-action",
      explanation: "The labyrinth resolves the action against its rooms, objects, factions, and current pressure. It does not compare it with an answer key.",
      caseStudy: caseCard(episode, node.stage, progress, node, context),
      subject: episode.subject,
      stat: episode.stat,
      difficulty: difficultyForGrade(grade),
      minGrade: grade,
      faculty: "roko",
    };
  }
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
    caseStudy: caseCard(episode, node.stage, progress, node, context),
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
  context: RokoLabyrinthContext = {},
): BankedQuestion | null {
  const node = rokoNextAssignmentNode(episode, progress);
  if (node) return graphQuestion(episode, node, grade, progress, context);
  const completed = progress?.episodeId === episode.id ? progress.choices.length : 0;
  if (completed >= 2) return null;
  return rokoEpisodeQuestion(episode, completed === 0 ? "investigate" : "decide", grade, progress);
}

type LabyrinthAttribute = "head" | "heart" | "hustle" | "honor";

const LABYRINTH_ATTRIBUTE_LABELS: Record<LabyrinthAttribute, string> = {
  head: "HEAD · Study the mechanism",
  heart: "HEART · Work through people",
  hustle: "HUSTLE · Change the situation",
  honor: "HONOR · Make or defend a rule",
};

const LABYRINTH_ATTRIBUTE_ROLES: Record<LabyrinthAttribute, string> = {
  head: "evidence",
  heart: "care",
  hustle: "witness",
  honor: "dissent",
};

function choiceForAttribute(node: RokoAssignmentNode, attribute: LabyrinthAttribute): RokoAssignmentChoice {
  const patterns: Record<LabyrinthAttribute, RegExp> = {
    head: /audit|premise|proof|evidence|reconstruct|analysis|technical|confidence|summary|map/,
    heart: /reader|support|care|wellbeing|student|coauthor|affected|participation/,
    hustle: /open|brief|vote|seed|joke|reply|exercise|flood|private|intervene/,
    honor: /gate|ban|unanim|retract|confisc|charter|custody|ledger|rule|verdict/,
  };
  const preferred = node.choices.find((choice) => patterns[attribute].test(`${choice.choiceId} ${choice.label}`.toLowerCase()));
  const fallbackIndex: Record<LabyrinthAttribute, number> = { head: 0, heart: 1, hustle: 3, honor: 2 };
  return preferred ?? node.choices[fallbackIndex[attribute]] ?? node.choices[0]!;
}

function adjustedWorldState(
  current: CaseStudyLabyrinthState,
  event: CaseStudyEvent,
  action: string,
): CaseStudyLabyrinthState {
  const words = `${event.label} ${event.detail} ${action}`.toLowerCase();
  const rumorDelta = /(public|leak|rumor|copy|copies|joke|mirror|attention)/.test(words) ? 1 : 0;
  const trustDelta = /(audit|admit|appeal|source|correction|reversible|accountab)/.test(words)
    ? 1
    : /(false|decoy|poison|permanent ban|confiscat)/.test(words) ? -1 : 0;
  const distressDelta = /(support|calm|care|wellbeing)/.test(words)
    ? -1
    : /(fear|punish|threat|distress|exposure)/.test(words) ? 1 : 0;
  const inventory = new Set(current.inventory);
  if (/\b(take|carry|keep|use|put)\b/.test(action.toLowerCase()) && /\b(bowl|soup)\b/.test(action.toLowerCase())) {
    inventory.add("soup-bowl seal");
  }
  if (/\b(drop|leave|give)\b/.test(action.toLowerCase()) && /\b(bowl|soup)\b/.test(action.toLowerCase())) {
    inventory.delete("soup-bowl seal");
  }
  return {
    ...current,
    inventory: [...inventory],
    rumor: clamp(current.rumor + rumorDelta, 0, 6),
    trust: clamp(current.trust + trustDelta, -3, 3),
    distress: clamp(current.distress + distressDelta, 0, 6),
    actionCount: current.actionCount + 1,
  };
}

function actionResult(args: {
  node: RokoAssignmentNode;
  action: string;
  actionCount: number;
  label: string;
  detail: string;
  reflection: string;
  nextNodeId?: string;
  roomCompleted: boolean;
  eventSuffix: string;
  revealedEvidence?: CaseStudyCard["evidence"];
}): CaseStudyChoiceResult {
  return {
    choiceId: `action:${args.node.id}:${args.actionCount}:${args.eventSuffix}`,
    nodeId: args.node.id,
    stage: args.node.stage,
    choiceLabel: args.action,
    actionText: args.action,
    lockedText: args.detail,
    ...(args.nextNodeId ? { nextNodeId: args.nextNodeId } : {}),
    event: {
      eventId: `action:${args.node.id}:${args.actionCount}:${args.eventSuffix}`,
      label: args.label,
      detail: args.detail,
    },
    ...(args.revealedEvidence ? { revealedEvidence: structuredClone(args.revealedEvidence) } : {}),
    reflection: args.reflection,
    roomCompleted: args.roomCompleted,
  };
}

/** Resolve one fixed attribute or passage move against the authored room.
 * Students never need to write text, and the move is not graded for
 * correctness. */
export function resolveRokoLabyrinthAction(
  episode: RokoEpisode,
  progress: CaseStudyProgress | null | undefined,
  actionText: string,
  context: RokoLabyrinthContext = {},
): RokoLabyrinthActionResolution {
  const graph = episode.assignmentGraph;
  if (!graph || graph.interactionMode !== "osr") throw new Error("This episode does not accept labyrinth actions.");
  const node = rokoNextAssignmentNode(episode, progress);
  if (!node) throw new Error("The labyrinth route is ready for its Return.");
  const command = actionText.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
  const attribute = (["head", "heart", "hustle", "honor"] as const).find((candidate) => candidate === command);
  const movement = /^go ([a-z0-9-]+)$/.exec(command);
  if (!attribute && !movement) throw new Error("Choose HEAD, HEART, HUSTLE, HONOR, or one of the visible passages.");
  const action = attribute ? LABYRINTH_ATTRIBUTE_LABELS[attribute] : command;
  let state = labyrinthState(episode, progress);
  const count = state.actionCount + 1;
  const exits = visibleRoomLinks(episode, node, state);
  const target = movement ? exits.find((exit) => exit.id === movement[1]) : undefined;

  if (movement) {
    const destination = target;
    if (!destination) throw new Error("Name an exit you can see, or look around for another route.");
    const result = actionResult({
      node,
      action,
      actionCount: count,
      label: `You reach ${destination.title}`,
      detail: `You leave ${node.title} without settling it. The route remains open behind you.`,
      reflection: "Changing position preserved the option to return; it did not solve the room.",
      nextNodeId: destination.id,
      roomCompleted: false,
      eventSuffix: `move-${destination.id}`,
    });
    state = adjustedWorldState(state, result.event, action);
    state.discoveredNodeIds = [...new Set([...state.discoveredNodeIds, destination.id])];
    return { result, labyrinth: state, currentNodeId: destination.id, roomCompleted: false };
  }

  const gate = requiredHumans(episode, node.id);
  const presentHumans = Math.max(1, context.presentHumans ?? 1);
  const role = LABYRINTH_ATTRIBUTE_ROLES[attribute!];
  const distinctRoles = new Set([...(context.collaboratorRoles ?? []), role]).size;
  const effectiveHumans = gate >= 3 ? Math.min(presentHumans, distinctRoles) : presentHumans;
  if (gate > effectiveHumans) {
    const contributions = state.contributions.filter((entry) => entry.nodeId !== node.id);
    contributions.push({ nodeId: node.id, role, at: Date.now() });
    const result = actionResult({
      node,
      action,
      actionCount: count,
      label: `${node.title} keeps your ${role} handprint`,
      detail: `The mechanism takes your ${role} contribution but needs ${gate - effectiveHumans} more distinct human role${gate - effectiveHumans === 1 ? "" : "s"}. It stays open for a later visitor.`,
      reflection: "The lock records an asynchronous contribution; waiting is not a wall-clock puzzle.",
      nextNodeId: node.id,
      roomCompleted: false,
      eventSuffix: `contribute-${role}`,
    });
    state = adjustedWorldState({ ...state, contributions }, result.event, action);
    return { result, labyrinth: state, currentNodeId: node.id, roomCompleted: false };
  }

  const matched = choiceForAttribute(node, attribute!);

  const wasCompleted = state.completedNodeIds.includes(node.id);
  const roomCompleted = !wasCompleted;
  const completedNodeIds = roomCompleted
    ? [...state.completedNodeIds, node.id]
    : [...state.completedNodeIds];
  const finished = completedNodeIds.length >= graph.assignmentCount;
  const nextNodeId = finished ? undefined : matched.nextNodeId ?? node.id;
  const result: CaseStudyChoiceResult = {
    choiceId: `action:${node.id}:${count}:${attribute}:${matched.choiceId}`,
    nodeId: node.id,
    stage: node.stage,
    choiceLabel: action,
    actionText: action,
    lockedText: matched.lockedText,
    ...(nextNodeId ? { nextNodeId } : { nextNodeId: undefined }),
    event: structuredClone(matched.event),
    ...(matched.revealedEvidence ? { revealedEvidence: structuredClone(matched.revealedEvidence) } : {}),
    reflection: matched.reflection,
    roomCompleted,
  };
  state = adjustedWorldState({ ...state, completedNodeIds }, result.event, action);
  if (nextNodeId) state.discoveredNodeIds = [...new Set([...state.discoveredNodeIds, nextNodeId])];
  return { result, labyrinth: state, currentNodeId: nextNodeId ?? null, roomCompleted };
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
