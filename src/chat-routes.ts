import { createHash, randomUUID } from "node:crypto";
import type { IAgentRuntime } from "@elizaos/core";
import { AuthService, type AuthRecord } from "./services/auth-service.js";
import { ChatService, type ChatMessage, type ChatStreamEvent, type ToolCall } from "./services/chat-service.js";
import { RubyHighService, type QuestionBankStatus } from "./services/ruby-high-service.js";
import { TokenBucket } from "./services/rate-limit.js";
import { log } from "./services/logger.js";
import {
  getRuntime,
  getSessionId,
  tryGetService as getService,
} from "./services/session-identity.js";
import { type OpenRouterChatCompletion } from "./services/openrouter-client.js";
import {
  fetchLlmChatCompletions,
  isLocalLlmProvider,
  llmProviderName,
  resolveStudentModel,
  throwLlmResponseError,
} from "./services/llm-provider.js";
import {
  getPrivyPublicConfigFromEnv,
  privyServerConfigured,
  verifyPrivyAuth,
} from "./services/privy-auth.js";
import {
  highestScoringFaculty,
  maybeUploadPortrait,
  renderCharacterPortrait,
  renderDiplomaImage,
  renderTeacherPortrait,
  rollRandomCharacter,
  type CharacterComponent,
  type RolledCharacter,
} from "./services/character-generation.js";
import { parseTeacherGrades } from "./grading.js";
import {
  GRADE_LABELS,
  PLAYER_CHAT_INTENTS,
  type CharacterStats,
  type PlayerChatIntent,
  type Question,
  type QuizState,
} from "./types.js";
import { facultyByIdForSession, resolveFacultyIdForSession, roomForFacultyForSession } from "./content/registry.js";
import { STUDENTS, type StudentCharacter } from "./characters/students.js";
import { teacherById } from "./characters/teachers.js";
import { PLAYBOOKS } from "./characters/playbooks.js";
import { statForQuestion } from "./question-stats.js";
import { roll2d6, classifyTotal, type RoundOutcome } from "./types.js";
import {
  hostedEntitlementStatus,
  hostedImageEntitlementStatus,
} from "./hosted-entitlements.js";
import {
  openRouterGenerationRequiredMessage,
  resolveOpenRouterImageCredential,
  resolveTextLlmCredential,
} from "./openrouter-generation-access.js";

function readNonNegativeMs(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const OPINION_SUBMIT_READY_GRACE_MS = readNonNegativeMs(process.env.RUBY_HIGH_OPINION_SUBMIT_READY_GRACE_MS, 1_500);
const OPINION_SUBMIT_READY_POLL_MS = 75;
const HOSTED_IMAGE_PENDING_TTL_MS = readNonNegativeMs(process.env.RUBY_HIGH_HOSTED_IMAGE_PENDING_TTL_MS, 15 * 60 * 1000);

async function llmJson<T = OpenRouterChatCompletion>(args: {
  apiKey: string;
  label: string;
  body: Record<string, unknown>;
  title?: string;
  timeoutMs?: number;
}): Promise<T> {
  const r = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    body: args.body,
    title: args.title,
    timeoutMs: args.timeoutMs,
  });
  if (!r.ok) await throwLlmResponseError(r, args.label);
  return await r.json() as T;
}

async function waitForOpinionReadyToGrade(ruby: RubyHighService, sessionId: string, timeoutMs = OPINION_SUBMIT_READY_GRACE_MS): Promise<boolean> {
  if (ruby.isOpinionRoundReadyToGrade(sessionId)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const delayMs = Math.min(OPINION_SUBMIT_READY_POLL_MS, Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (ruby.isOpinionRoundReadyToGrade(sessionId)) return true;
  }
  return ruby.isOpinionRoundReadyToGrade(sessionId);
}

function fillMissingOpinionResponders(
  ruby: RubyHighService,
  sessionId: string,
  mode: "force" | "offline" | "grace",
): boolean {
  const state = ruby.getOrCreate(sessionId);
  const round = state.activeRound;
  if (!round || round.type !== "opinion" || round.resolved) return false;
  let mutated = false;
  const present = new Set(round.opinionResponses.map((r) => r.responder));
  if (!present.has("player")) {
    ruby.recordOpinion(sessionId, "player", "(no response — ran out the clock)");
    present.add("player");
    mutated = true;
  }
  for (const npc of round.npcs) {
    if (present.has(npc.studentId)) continue;
    const placeholder = mode === "offline"
      ? "(thinking it over silently)"
      : mode === "grace"
        ? "(still thinking it over)"
        : "(no response — couldn't get it down in time)";
    ruby.recordOpinion(sessionId, npc.studentId, placeholder);
    present.add(npc.studentId);
    mutated = true;
  }
  return mutated;
}

export function publicChatHistory(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const pendingTools = new Map<string, { call: ToolCall; faculty?: string }>();
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content, faculty: m.faculty, at: m.at });
      continue;
    }
    if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", content: m.content, faculty: m.faculty, at: m.at });
      if (Array.isArray(m.toolCalls)) {
        for (const call of m.toolCalls) {
          pendingTools.set(call.id, { call, faculty: m.faculty });
        }
      }
      continue;
    }
    if (m.role === "tool" && m.toolCallId) {
      const pending = pendingTools.get(m.toolCallId);
      if (!pending) continue;
      pendingTools.delete(m.toolCallId);
      out.push({
        role: "tool",
        content: "",
        faculty: m.faculty ?? pending.faculty,
        at: m.at,
        tool: pending.call.function.name,
        args: publicToolArgs(pending.call),
        result: safeJsonObject(m.content),
      });
    }
  }
  return out;
}

function publicToolArgs(call: ToolCall): Record<string, unknown> {
  const args = safeJsonObject(call.function.arguments || "{}");
  if (call.function.name === "handoff_faculty" && typeof args.faculty === "string") {
    return { faculty: args.faculty };
  }
  return {};
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function characterGraduated(state: { character?: { yearbook?: unknown[] } | null }): boolean {
  return !!(state.character && Array.isArray(state.character.yearbook) && state.character.yearbook.length >= 4);
}

function graduationReady(state: { character?: { pendingGraduation?: unknown } | null }): boolean {
  return !!(state.character && state.character.pendingGraduation);
}

function gradeLabel(grade: string | undefined | null): string {
  if (!grade) return "";
  return (GRADE_LABELS as Record<string, string>)[grade] ?? grade;
}

function toolPlacedFreshQuestion(ev: ChatStreamEvent): boolean {
  if (ev.type !== "tool" || !ev.result.ok) return false;
  if (ev.tool !== "pick_from_bank" && ev.tool !== "pose_question" && ev.tool !== "pose_opinion") {
    return false;
  }
  return !!(ev.state?.current && ev.state.activeRound && !ev.state.activeRound.resolved);
}

function scheduledPickAvailable(bank: { remaining: number; canPick?: boolean }): boolean {
  return typeof bank.canPick === "boolean" ? bank.canPick : bank.remaining > 0;
}

function nextBoardInstruction(bank: { mode?: string; remaining: number; canPick?: boolean; grade?: string }, banked: string): string {
  if (scheduledPickAvailable(bank)) return banked;
  if (bank.mode === "srs") {
    return "No scheduled deck card is available right now. Do NOT call pick_from_bank or try alternate filters. If the class needs a fresh board, call pose_question exactly once for a custom challenge, or talk briefly about progress.";
  }
  return "No scheduled Ruby High card is available right now. Do NOT call pick_from_bank or try alternate filters. If the class needs a fresh board, call pose_question exactly once and write a custom question.";
}

function requiredNextBoardInstruction(bank: { mode?: string; remaining: number; canPick?: boolean }, banked: string): string {
  if (scheduledPickAvailable(bank)) return banked;
  if (bank.mode === "srs") {
    return "No scheduled deck card is available right now. Do NOT call pick_from_bank or try alternate filters. Call pose_question exactly once for a custom practice challenge.";
  }
  return "No scheduled Ruby High card is available right now. Do NOT call pick_from_bank or try alternate filters. Call pose_question exactly once and write a custom question.";
}

function schedulerOwnsBoard(bank: { remaining: number; canPick?: boolean; todayClass?: { status?: string } }): boolean {
  // The deterministic scheduler can only own the board when it actually
  // has something to post. That includes Ruby's generated homeroom social
  // card, which is not counted in the bank's ready-card total.
  return scheduledPickAvailable(bank);
}

function schedulerBoundaryInstruction(bank: { mode?: string; remaining: number; canPick?: boolean; nextCardRole?: string; todayClass?: { status?: string; questionCount?: number; totalQuestions?: number } }): string {
  if (!schedulerOwnsBoard(bank)) {
    return nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh scheduled card, or pose_question for a custom practice challenge.");
  }
  const today = bank.todayClass;
  const classLine = today?.status === "complete"
    ? "today's graded class is complete"
    : today?.status === "active"
      ? `today's graded class is in progress (${today.questionCount ?? 0}/${today.totalQuestions ?? 3})`
      : "today's graded class is available";
  const readyLine = bank.remaining > 0
    ? `${bank.remaining} scheduled card${bank.remaining === 1 ? "" : "s"} ready`
    : bank.nextCardRole === "social"
      ? "a Ruby High social card ready"
    : "no scheduled cards ready";
  return `The Ruby High scheduler owns the blackboard while ${classLine} and ${readyLine}. Do not call tools or post/replace/clear questions. Do not say tool names like pick_from_bank; speak only as the teacher.`;
}

function classReportOwnsBoard(bank: { todayClass?: { status?: string } }): boolean {
  return bank.todayClass?.status === "complete";
}

type AnswerGradedContext = {
  intent?: PlayerChatIntent | null;
  grade?: string;
  playerLine?: string | null;
  questionId?: string | null;
  prompt?: string | null;
  type?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  options?: Record<string, string> | null;
  picked?: string | null;
  correct?: string | null;
  forfeit?: boolean;
  pickedAnswer?: string | null;
  correctAnswer?: string | null;
  answerText?: string | null;
  expectedAnswer?: string | null;
  answerJudge?: { mode?: string; score?: number } | null;
  explanation?: string | null;
  wasCorrect?: boolean;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function cleanPlayerChatIntent(value: unknown): PlayerChatIntent | undefined {
  const text = cleanText(value);
  return PLAYER_CHAT_INTENTS.includes(text as PlayerChatIntent) ? (text as PlayerChatIntent) : undefined;
}

function cleanOptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["A", "B", "C", "D"]) {
    const text = cleanText(raw[key]);
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function clipped(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function choiceAnswer(options: Record<string, string> | undefined, choice: string | undefined): string | undefined {
  if (!choice) return undefined;
  const label = choice.trim().toUpperCase();
  const option = options?.[label];
  return option ? `${label}) ${option}` : label;
}

function questionOptionsFrom(stateQuestion: Question | null | undefined, reveal: QuizState["lastReveal"], context: AnswerGradedContext | undefined): Record<string, string> | undefined {
  return cleanOptions(context?.options)
    ?? cleanOptions(stateQuestion?.options)
    ?? cleanOptions(reveal?.questionOptions);
}

function buildResolvedAnswerBriefing(args: {
  state: QuizState;
  context?: AnswerGradedContext;
  playerName: string;
}): {
  correctChoice: string;
  pickedLine: string;
  eventText: string;
  extraSystemContext: string;
} {
  const { state, context: c, playerName } = args;
  const q = state.current;
  const reveal = state.lastReveal;
  const options = questionOptionsFrom(q, reveal, c);
  const questionId = cleanText(c?.questionId) ?? q?.id ?? reveal?.questionId ?? "unknown";
  const prompt = cleanText(c?.prompt) ?? q?.prompt ?? reveal?.questionPrompt;
  const type = cleanText(c?.type) ?? q?.type ?? reveal?.questionType ?? (reveal?.expectedAnswer || c?.expectedAnswer ? "typed-answer" : "multiple-choice");

  // Opinion rounds carry no picked letter / correct letter — the teacher's
  // briefing has to come from activeRound.opinionResponses + opinionGrades
  // instead. Without this branch the teacher reacts to a bogus "picked A —
  // answer was A" line and never sees what the player actually wrote.
  if (type === "opinion") {
    const round = state.activeRound;
    const playerResp = round?.type === "opinion"
      ? round.opinionResponses.find((r) => r.responder === "player")
      : undefined;
    const playerGrade = round?.type === "opinion"
      ? round.opinionGrades.find((g) => g.responder === "player")
      : undefined;
    const essayText = playerResp?.text?.trim() || "(no response)";
    const score = typeof playerGrade?.score === "number" ? playerGrade.score : null;
    const passed = typeof reveal?.wasCorrect === "boolean" ? reveal.wasCorrect : (score != null && score >= 7);
    const verdict = passed ? "passed" : "needs another swing";
    const scoreLine = score != null ? ` graded ${score.toFixed(1)}/10` : "";
    const commentLine = playerGrade?.comment ? ` — your note was: "${clipped(playerGrade.comment, 160)}"` : "";
    const pickedLine = `${playerName} wrote: "${clipped(essayText, 220)}"${scoreLine}${commentLine}.`;
    const eventText = [
      prompt ? `Opinion round resolved for "${clipped(prompt, 180)}".` : "Opinion round resolved.",
      pickedLine,
      `Verdict: ${verdict}.`,
    ].join(" ");
    const contextLines = [
      "RESOLVED OPINION SNAPSHOT for this answer-graded reaction.",
      "Use this snapshot for the reaction even if the active board context is empty, cleared, or already showing a different card.",
      `Question ID: ${questionId}`,
      prompt ? `Question: ${prompt}` : "",
      `Question type: opinion`,
      `${playerName}'s answer: ${essayText}`,
      score != null ? `Grade you assigned: ${score.toFixed(1)}/10` : "",
      playerGrade?.comment ? `Your grading comment: ${playerGrade.comment}` : "",
      `Verdict: ${verdict} (≥7/10 passes).`,
    ].filter(Boolean);
    return {
      correctChoice: "A",
      pickedLine,
      eventText,
      extraSystemContext: contextLines.join("\n"),
    };
  }
  const subject = cleanText(c?.subject) ?? q?.subject ?? reveal?.questionSubject;
  const difficulty = cleanText(c?.difficulty) ?? q?.difficulty ?? reveal?.questionDifficulty;
  const picked = cleanText(c?.picked)?.toUpperCase() ?? reveal?.picked;
  const correct = cleanText(c?.correct)?.toUpperCase() ?? reveal?.correct ?? q?.correct ?? "?";
  const forfeit = c?.forfeit === true || reveal?.forfeit === true;
  const wasCorrect = typeof c?.wasCorrect === "boolean"
    ? c.wasCorrect
    : (typeof reveal?.wasCorrect === "boolean" ? reveal.wasCorrect : picked === correct);
  const answerText = cleanText(c?.answerText) ?? reveal?.answerText;
  const expectedAnswer = cleanText(c?.expectedAnswer) ?? reveal?.expectedAnswer ?? q?.expectedAnswer;
  const pickedAnswer = forfeit ? undefined : cleanText(c?.pickedAnswer) ?? answerText ?? choiceAnswer(options, picked);
  const correctAnswer = cleanText(c?.correctAnswer) ?? expectedAnswer ?? choiceAnswer(options, correct);
  const explanation = cleanText(c?.explanation) ?? reveal?.explanation ?? q?.explanation;
  const judgeScore = Number(c?.answerJudge?.score ?? reveal?.answerJudge?.score);
  const judgeMode = cleanText(c?.answerJudge?.mode) ?? reveal?.answerJudge?.mode;
  const resultText = wasCorrect ? "correct" : "wrong";
  const playerDisplay = forfeit ? "no answer before time expired" : pickedAnswer ?? picked ?? "an answer";
  const correctDisplay = correctAnswer ?? correct ?? "?";
  const pickedLine = forfeit
    ? `Time expired before ${playerName} answered; the correct answer was ${correctDisplay}.`
    : wasCorrect
    ? `${playerName} answered ${playerDisplay}; that was correct.`
    : `${playerName} answered ${playerDisplay}; the correct answer was ${correctDisplay}.`;
  const eventParts = [
    prompt ? `Round resolved for "${clipped(prompt, 180)}".` : "Round resolved.",
    forfeit
      ? `${playerName} did not answer before time expired.`
      : `${playerName} answered ${playerDisplay} — ${resultText}.`,
    correctDisplay ? `Correct answer: ${correctDisplay}.` : "",
  ].filter(Boolean);
  const contextLines = [
    "RESOLVED CARD SNAPSHOT for this answer-graded reaction.",
    "Use this snapshot for the reaction even if the active board context is empty, cleared, or already showing a different card.",
    `Question ID: ${questionId}`,
    prompt ? `Question: ${prompt}` : "",
    `Question type: ${type}`,
    subject ? `Subject: ${subject}` : "",
    difficulty ? `Difficulty: ${difficulty}` : "",
  ];
  if (options) {
    contextLines.push("Answer choices:");
    for (const key of ["A", "B", "C", "D"]) {
      if (options[key]) contextLines.push(`  ${key}) ${options[key]}`);
    }
  }
  contextLines.push(forfeit ? "Player answer: no answer (timeout)" : `Player answer: ${playerDisplay}`);
  contextLines.push(`Correct answer: ${correctDisplay}`);
  contextLines.push(`Result: ${forfeit ? "timeout" : resultText}`);
  if (Number.isFinite(judgeScore)) {
    contextLines.push(`Typed-answer judge: ${Math.round(judgeScore * 100)}%${judgeMode ? ` (${judgeMode})` : ""}`);
  }
  if (explanation) contextLines.push(`Explanation shown on board: ${explanation}`);
  return {
    correctChoice: correct,
    pickedLine,
    eventText: eventParts.join(" "),
    extraSystemContext: contextLines.filter(Boolean).join("\n"),
  };
}

function answerGradedContextMatchesReveal(state: QuizState, context: AnswerGradedContext | undefined): boolean {
  const questionId = cleanText(context?.questionId);
  if (!questionId) return true;
  const reveal = state.lastReveal;
  if (!reveal) return true;
  if (reveal.questionId !== questionId) return false;
  const picked = cleanText(context?.picked)?.toUpperCase();
  if (picked && reveal.picked && picked !== reveal.picked) return false;
  const correct = cleanText(context?.correct)?.toUpperCase();
  if (correct && reveal.correct && correct !== reveal.correct) return false;
  const forfeit = context?.forfeit;
  if (typeof forfeit === "boolean" && typeof reveal.forfeit === "boolean" && forfeit !== reveal.forfeit) return false;
  return true;
}

function pickNextLoungeSpeaker(chat: ChatService, sessionToken: string): string {
  const TEACHERS = ["ruby", "sally-science", "professor-edward"];
  const history = chat.history({ sessionToken, faculty: "lounge" });
  // Find the last assistant message and pick the next teacher in rotation.
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === "assistant" && m.faculty) {
      const idx = TEACHERS.indexOf(m.faculty);
      return TEACHERS[(idx + 1) % TEACHERS.length] ?? "ruby";
    }
  }
  return "ruby";
}

/** Have the teacher grade all opinion responses in one call. Returns
 *  parsed { grades, bestResponder, narrativeText }. */
/** Offline (no-OpenRouter) opinion grading. Without an LLM we can't read
 *  the essay, so we resolve the round on dice instead — the player rolls
 *  2d6 + the question's stat, and the outcome maps to a score. NPCs use
 *  their own pre-rolled outcomes from when the round was opened. The
 *  point is to keep the player from getting trapped on a Social card
 *  when AI is off, and to keep stat investments meaningful. */
function buildOfflineOpinionVerdict(args: {
  state: QuizState;
}): import("./grading.js").ParsedTeacherGrades & {
  playerRoll: { stat: keyof CharacterStats; dice: [number, number]; total: number; outcome: RoundOutcome };
} {
  const round = args.state.activeRound;
  const q = args.state.current;
  const character = args.state.character;
  if (!round || !q || round.type !== "opinion") {
    return {
      grades: [],
      bestResponder: null,
      narrativeText: "Class moves on.",
      playerRoll: { stat: "head", dice: [1, 1], total: 2, outcome: "miss" },
    };
  }
  const playerName = character?.name ?? "the player";
  // Prefer the stat already stamped on the round (set when openRound ran)
  // so offline grading rolls against the same modifier the NPCs did.
  const stat = round.stat ?? statForQuestion(q);
  const playerStatMod = character?.stats?.[stat] ?? 0;
  const playerDice = roll2d6();
  const playerTotal = playerDice.total + playerStatMod;
  const playerOutcome = classifyTotal(playerTotal);

  const scoreFor = (outcome: RoundOutcome): number =>
    outcome === "hit" ? 8.5 : outcome === "mixed" ? 7 : 4;
  const playerComment = (outcome: RoundOutcome): string =>
    outcome === "hit" ? `${playerName} brought ${stat.toUpperCase()} to it.`
    : outcome === "mixed" ? `${playerName} just barely landed it on ${stat.toUpperCase()}.`
    : `${playerName} swung at it but came up short on ${stat.toUpperCase()}.`;

  const grades: Array<{ responder: string; score: number; comment: string }> = [
    { responder: "player", score: scoreFor(playerOutcome), comment: playerComment(playerOutcome) },
  ];
  for (const entry of round.npcs) {
    const name = STUDENTS[entry.studentId]?.name ?? entry.studentId;
    const outcome = entry.outcome;
    grades.push({
      responder: entry.studentId,
      score: scoreFor(outcome),
      comment: outcome === "hit"
        ? `${name} found a sharp angle on it.`
        : outcome === "mixed"
        ? `${name} got partway there.`
        : `${name} couldn't get traction on it.`,
    });
  }
  const ranked = [...grades].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const bestResponder = top && top.score >= 7 ? top.responder : null;
  const playerGrade = grades.find((g) => g.responder === "player")!;
  const playerPassed = playerGrade.score >= 7;
  const diceLine = `${playerDice.dice[0]}+${playerDice.dice[1]}${playerStatMod >= 0 ? "+" : ""}${playerStatMod} ${stat.toUpperCase()} = ${playerTotal}`;
  const narrativeText = playerPassed
    ? `${playerName} rolled ${diceLine} — that's a ${playerOutcome}. Class moves on.`
    : `${playerName} rolled ${diceLine} — a ${playerOutcome}. Take another swing tomorrow.`;
  return {
    grades,
    bestResponder,
    narrativeText,
    playerRoll: { stat, dice: playerDice.dice, total: playerTotal, outcome: playerOutcome },
  };
}

async function gradeOpinionResponses(args: {
  apiKey: string;
  facultyId: string;
  question: string;
  rubric?: string;
  responses: Array<{ responder: string; displayName: string; text: string }>;
  playerName: string;
}): Promise<import("./grading.js").ParsedTeacherGrades> {
  const teacher = teacherById(args.facultyId);
  const responseList = args.responses.map((r, i) =>
    `[${i + 1}] ${r.displayName} (responder=${r.responder}):\n${r.text}\n`
  ).join("\n");
  const directive = [
    `You posed: "${args.question}"`,
    args.rubric ? `Rubric: ${args.rubric}` : "",
    "",
    "Below are the student responses (the player + your AI students). Grade each one 0-10 based on how much they actually thought about the question and showed it in the writing — depth, specificity, engagement, originality.",
    "",
    responseList,
    "",
    "Output strictly the following format on its own line for each responder, then a final BEST: line:",
    "GRADE responder=<id> score=<0-10> comment=<one short sentence in your voice>",
    "BEST: <responder id>",
    "",
    "After the grade lines, write 2-3 short sentences in your voice as the teacher delivering the verdict to the class. Reference at least one student by name. Plain and direct, in your voice.",
  ].filter(Boolean).join("\n");

  const body = await llmJson<OpenRouterChatCompletion>({
    apiKey: args.apiKey,
    label: "chat",
    body: {
      model: teacher.defaultModel,
      messages: [
        { role: "system", content: teacher.systemPrompt },
        { role: "user", content: directive },
      ],
      max_tokens: 700,
      temperature: 0.6,
    },
  });
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  return parseTeacherGrades(text);
}

async function generateStudentLine(args: {
  apiKey: string;
  student: StudentCharacter;
  situation: string;
  note?: string;
  faculty?: string;
  /** Player display name. Lets the NPC address them by name when natural
   *  ("nice one Rayan") instead of saying "the player." */
  playerName?: string;
  /** Other AI students in the room. Used so each NPC chime knows who else
   *  is in the group chat — avoids "wait who's everyone else" hallucinations
   *  and lets NPCs riff on each other by name. */
  classmateNames?: string[];
  /** The teacher's most recent spoken line. Without this NPCs would react
   *  to a faceless event instead of the words on screen — "can't see what
   *  edward said so i got nothing" was a real complaint. */
  teacherSaid?: string;
  /** What the player just typed in chat. Required for the "mention"
   *  situation — without it the model produces a generic acknowledgement
   *  ("yo", "fr") instead of an actual reply. Quoted into the prompt
   *  verbatim so the student can react to the words on screen. */
  playerText?: string;
}): Promise<string> {
  const facultyContext = args.faculty
    ? `The current class is taught by ${args.faculty.replace("-", " ")}.`
    : "";
  const playerContext = args.playerName
    ? `The player in the room with you is ${args.playerName}.`
    : "";
  const classmatesContext = args.classmateNames && args.classmateNames.length
    ? `Other classmates also here: ${args.classmateNames.join(", ")}.`
    : "";
  const teacherSaidContext = args.teacherSaid && args.teacherSaid.trim()
    ? `The teacher just said: "${args.teacherSaid.trim()}"`
    : "";
  // Quote the player's actual message when present. Sanitize the
  // closing quote so a player message containing " can't break out
  // of the surrounding quotation. Also cap length so a megapaste
  // doesn't blow the prompt budget.
  const playerSaidContext = args.playerText
    ? `The player just said to you: "${args.playerText.replace(/"/g, "'").slice(0, 400)}"`
    : "";
  const noteContext = args.note ? `Context: ${args.note}` : "";
  const userPrompt = [
    `Situation: ${args.situation}.`,
    facultyContext,
    playerContext,
    classmatesContext,
    teacherSaidContext,
    playerSaidContext,
    noteContext,
    "React in one short line — like a text in a group chat. Lowercase, 12 words max. Address whoever just acted by name when natural. If you genuinely have nothing, 'lol' or 'idk' or 'fr' is plenty.",
  ].filter(Boolean).join("\n");

  const body = await llmJson<OpenRouterChatCompletion>({
    apiKey: args.apiKey,
    label: "chat",
    body: {
      model: resolveStudentModel(),
      messages: [
        { role: "system", content: args.student.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.95,
    },
  });
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  // Strip wrapping quotes if model added them.
  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

function playerIntentForPhase(state: QuizState): PlayerChatIntent {
  if (state.phase === "asking") return "hint";
  if (state.phase === "revealed") return "report";
  if (state.phase === "lounge") return "lounge";
  return "advance";
}

function facultyDisplayNameForState(state: QuizState, facultyId?: string | null): string {
  const id = facultyId || state.faculty || "ruby";
  if (id === "lounge") return "the lounge";
  const packFaculty = facultyByIdForSession(state, id);
  if (packFaculty) return packFaculty.displayName;
  return teacherById(id).displayName;
}

function classmateContextForPlayer(state: QuizState, facultyId: string): string {
  if (!state.currentGrade || facultyId === "lounge") return "";
  const room = roomForFacultyForSession(state, facultyId);
  if (!room?.teaches) return "";
  const roster = state.npcRosters[state.currentGrade] ?? [];
  const names = roster
    .filter((npc) => npc.currentRoom === room.id)
    .map((npc) => STUDENTS[npc.id]?.name ?? npc.id);
  return names.length ? `Classmates in the room: ${names.join(", ")}.` : "";
}

function formatPromptPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "unknown";
}

function playerClassReportContext(bankStatus?: QuestionBankStatus | null): string | null {
  const today = bankStatus?.todayClass;
  if (!bankStatus || today?.status !== "complete") return null;
  const completed = bankStatus.completedClasses ?? 0;
  const required = bankStatus.requiredClasses ?? 0;
  return [
    `Visible board: class report card for ${bankStatus.displayName}.`,
    "Today's graded class is complete.",
    today.letterGrade ? `Final grade shown: ${today.letterGrade}.` : "",
    typeof today.score === "number" ? `Today score shown: ${formatPromptPercent(today.score)}.` : "",
    bankStatus.courseGrade ? `Course grade shown: ${bankStatus.courseGrade}.` : "",
    required > 0 ? `Course progress shown: ${completed}/${required} completed classes.` : "",
    "The report card says practice is open; there is no live challenge on the board yet.",
  ].filter(Boolean).join("\n");
}

function playerVisibleBoardContext(
  state: QuizState,
  intent: PlayerChatIntent,
  bankStatus?: QuestionBankStatus | null,
): string {
  const reveal = state.lastReveal;
  if (intent === "report" && reveal) {
    const answer = reveal.forfeit
      ? "timed out"
      : reveal.wasCorrect
        ? `answered ${reveal.answerText ?? reveal.picked ?? "correctly"} and was right`
        : `answered ${reveal.answerText ?? reveal.picked ?? "incorrectly"} and missed it`;
    const correct = reveal.expectedAnswer
      ? `Expected answer: ${reveal.expectedAnswer}.`
      : reveal.correct
        ? `Correct choice: ${reveal.correct}.`
        : "";
    return [
      "Visible board: the last challenge has resolved.",
      `Result: the player ${answer}.`,
      reveal.questionPrompt ? `Question: ${reveal.questionPrompt}` : "",
      correct,
      reveal.explanation ? `Explanation shown on board: ${reveal.explanation}` : "",
    ].filter(Boolean).join("\n");
  }

  const q = state.current;
  if (q) {
    const type = q.type ?? "multiple-choice";
    const optionLines = type === "multiple-choice" && q.options
      ? Object.entries(q.options).map(([k, v]) => `  ${k}) ${v}`)
      : [];
    return [
      type === "opinion"
        ? "Visible board: open free-response challenge."
        : type === "typed-answer" || type === "image-occlusion"
          ? "Visible board: typed-response challenge."
          : "Visible board: multiple-choice challenge.",
      `Prompt: ${q.prompt}`,
      ...optionLines,
      "Hidden from the player right now: the correct answer.",
    ].join("\n");
  }

  const classReport = playerClassReportContext(bankStatus);
  if (classReport) return classReport;

  if (reveal) {
    return [
      "Visible board: no live challenge; the recent result may still be in the room's memory.",
      reveal.questionPrompt ? `Recent question: ${reveal.questionPrompt}` : "",
      reveal.wasCorrect ? "Recent result: correct." : reveal.forfeit ? "Recent result: timed out." : "Recent result: missed.",
    ].filter(Boolean).join("\n");
  }

  return state.phase === "lounge"
    ? "Visible board: none. This is a lounge conversation."
    : "Visible board: empty. The room is between challenges.";
}

function recentDialogueForPlayer(history: ChatMessage[], state: QuizState): string {
  const rows = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .slice(-8)
    .map((m) => {
      const speaker = m.role === "user"
        ? (state.character?.name ?? "Player")
        : facultyDisplayNameForState(state, m.faculty);
      return `${speaker}: ${clipped(m.content.trim(), 180)}`;
    });
  return rows.length ? ["Recent dialogue:", ...rows].join("\n") : "Recent dialogue: none yet.";
}

function playerIntentDirective(intent: PlayerChatIntent): string {
  if (intent === "hint") {
    return "The player is asking the room for a clue about the live board. Do not answer the challenge; ask for help or name what feels confusing.";
  }
  if (intent === "report") {
    return "The player is reacting to the result or class report. Let them sound proud, annoyed, curious, or reflective based on the context.";
  }
  if (intent === "lounge") {
    return "The player is joining the lounge conversation as a student who overheard the faculty. Comment or ask something social and specific.";
  }
  return "The player is keeping the class moving between challenges. Continue the conversation naturally or ask the teacher/class what comes next without sounding like a UI command.";
}

function sanitizePlayerLine(text: string, playerName: string): string {
  let line = text.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  const prefix = new RegExp(`^(${playerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|player|you)\\s*:\\s*`, "i");
  line = line.replace(prefix, "").trim();
  if (line.length > 220) line = line.slice(0, 219).trimEnd() + "…";
  return line;
}

async function generatePlayerLine(args: {
  apiKey: string;
  state: QuizState;
  faculty: string;
  intent: PlayerChatIntent;
  history: ChatMessage[];
  bankStatus?: QuestionBankStatus | null;
}): Promise<string> {
  const character = args.state.character;
  if (!character) throw new Error("Create a character before using AI Chat.");
  const playbook = PLAYBOOKS.find((p) => p.id === character.playbookId);
  const stats = character.stats;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const facultyName = facultyDisplayNameForState(args.state, args.faculty);
  const roomLine = args.faculty === "lounge"
    ? "Current location: teachers' lounge."
    : `Current class: ${facultyName}.`;
  const userPrompt = [
    `You are writing the next chat bubble for the player's avatar, ${character.name}.`,
    "This is a room scene with teachers and classmates, not a user talking to a chatbot.",
    roomLine,
    playbook ? `Playbook: ${playbook.name}.` : `Playbook id: ${character.playbookId}.`,
    `Personality: ${character.personality}`,
    character.flavorQuote ? `Voice sample: "${character.flavorQuote}"` : "",
    character.arcAnswer ? `Private arc answer: "${character.arcAnswer}"` : "",
    `Stats: HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}.`,
    classmateContextForPlayer(args.state, args.faculty),
    "",
    playerVisibleBoardContext(args.state, args.intent, args.bankStatus),
    "",
    recentDialogueForPlayer(args.history, args.state),
    "",
    `Turn intent: ${args.intent}. ${playerIntentDirective(args.intent)}`,
    "",
    "Write exactly one natural spoken line for the player avatar, 8-24 words.",
    "Speak as the student, not as narrator. No speaker label. No quotation marks.",
    "Do not mention phase names, schedulers, tools, UI buttons, or that a model generated this.",
    "Do not say 'what does the report say' unless the visible context is literally a report and that is the most natural thing to ask.",
  ].filter(Boolean).join("\n");

  const body = await llmJson<OpenRouterChatCompletion>({
    apiKey: args.apiKey,
    label: "player-line",
    body: {
      model: resolveStudentModel(),
      messages: [
        {
          role: "system",
          content: `You are ${character.name}, a Ruby High student avatar. Write only their next line in their voice.`,
        },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.9,
    },
  });
  const text = body.choices?.[0]?.message?.content ?? "";
  const line = sanitizePlayerLine(text, character.name);
  if (!line) throw new Error("Player avatar did not produce a line.");
  return line;
}

export interface ChatRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  runtime: unknown | null;
  res: unknown;
  /** Raw incoming Cookie header. Optional — if the host doesn't expose it, auth degrades to "logged out". */
  cookieHeader?: string | null;
  /** Raw value of the `X-Openrouter-Key` header. Clients store the key in
   *  localStorage and attach it on every LLM-touching request; the server
   *  reads it here without persisting. Empty / missing → 401 at LLM endpoints. */
  apiKeyHeader?: string | null;
  /** Caller-provided callback URL builder. Lets the dev server use http://localhost while the eliza host uses https://app.example.com . */
  callbackUrlBuilder?: (path: string) => string;
  /** True when the response is being served over HTTPS. Controls `Secure` cookie attribute. */
  isSecure?: boolean;
  /** Best-known client IP, derived by the host (x-forwarded-for or socket.remoteAddress).
   *  Optional — when absent, rate limiting falls back to a per-cookie key only. */
  clientIp?: string | null;
  /** Raw Origin request header, when present. Used to reject cross-site auth POSTs. */
  originHeader?: string | string[] | null;
  /** Raw Authorization request header, when present. Privy uses Bearer access tokens. */
  authorizationHeader?: string | string[] | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

/** Module-scope rate limiter for LLM-backed chat endpoints. 60 requests in a
 *  burst, refilling at 1/sec — a comfortable budget for an actively-playing
 *  user, tight enough to stop a runaway script from melting OpenRouter spend.
 *
 *  Keyed by `${clientIp}:${sessionToken|"anon"}` so a signed-in user on a
 *  shared NAT and a script-from-the-same-IP get separate buckets. */
const CHAT_LIMITER = new TokenBucket(60, 1);
const PORTRAIT_LIMITER = new TokenBucket(8, 1 / 30); // image gen: 8 burst, ~1 every 30s
const CHAT_EVENT_TURN_TTL_MS = 2 * 60 * 60 * 1000;
const CHAT_EVENT_TURN_MAX_KEYS = 5_000;
const CHAT_EVENT_TURN_SEQ = new Map<string, { seq: number; lastSeen: number }>();

/** Drop idle keys hourly so the maps don't grow unbounded for one-off IPs. */
const limiterGcTimer = setInterval(() => {
  const now = Date.now();
  CHAT_LIMITER.gc(now);
  PORTRAIT_LIMITER.gc(now);
  gcChatEventTurnSeq(now);
}, 60 * 60 * 1000);
if (typeof limiterGcTimer === "object" && limiterGcTimer && "unref" in limiterGcTimer) {
  (limiterGcTimer as { unref: () => void }).unref();
}

function rateLimitKey(ctx: ChatRouteContext, sessionToken: string | null): string {
  const ip = ctx.clientIp || "no-ip";
  return `${ip}:${sessionToken ?? "anon"}`;
}

function chatEventTurnGuard(sessionId: string, faculty: string, rawSeq: unknown): () => boolean {
  const seq = Number(rawSeq);
  if (!Number.isFinite(seq) || seq <= 0) return () => false;
  const key = `${sessionId}:${faculty}`;
  const now = Date.now();
  const entry = CHAT_EVENT_TURN_SEQ.get(key);
  const prev = entry?.seq ?? 0;
  if (seq > prev) {
    CHAT_EVENT_TURN_SEQ.set(key, { seq, lastSeen: now });
    gcChatEventTurnSeq(now);
  } else if (entry) {
    entry.lastSeen = now;
  }
  return () => (CHAT_EVENT_TURN_SEQ.get(key)?.seq ?? seq) !== seq;
}

function gcChatEventTurnSeq(now: number = Date.now()): void {
  for (const [key, entry] of CHAT_EVENT_TURN_SEQ) {
    if (now - entry.lastSeen > CHAT_EVENT_TURN_TTL_MS) CHAT_EVENT_TURN_SEQ.delete(key);
  }
  if (CHAT_EVENT_TURN_SEQ.size <= CHAT_EVENT_TURN_MAX_KEYS) return;
  const overflow = CHAT_EVENT_TURN_SEQ.size - CHAT_EVENT_TURN_MAX_KEYS;
  const oldest = Array.from(CHAT_EVENT_TURN_SEQ.entries())
    .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
    .slice(0, overflow);
  for (const [key] of oldest) CHAT_EVENT_TURN_SEQ.delete(key);
}

/** Minimum Node.js-like response surface used by the auth/redirect helpers.
 * ctx.res is typed as unknown at the ChatRouteContext boundary; these helpers
 * cast to this interface once rather than repeating an inline structural type. */
interface NodeLikeResponse {
  statusCode: number;
  getHeader?(name: string): unknown;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string): void;
}

interface SseResponse {
  writeHead(status: number, headers: Record<string, string | string[]>): void;
  write(chunk: string): boolean | void;
  end(): void;
  flushHeaders?: () => void;
}

interface SseStream {
  send(event: string, data: unknown): void;
  end(): void;
}

function openSse(response: unknown): SseStream {
  const res = response as SseResponse;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  return {
    send(event: string, data: unknown): void {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end(): void {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    },
  };
}

/** Whether the AI teacher may NOT call tools this turn.
 * Priority order:
 *  1. Class report always blocks tools (post-class board is read-only).
 *  2. room-idle always gets tools — it must call pick_from_bank even when
 *     the scheduler owns the board.
 *  3. Scheduler ownership blocks tools for every other trigger.
 * Callers may still set disableToolsForTurn=true afterwards for
 * graduation / hint / report overrides that are computed mid-branch. */
function shouldDisableTools(opts: {
  trigger: string;
  schedulerControlsBoard: boolean;
  classReportBlocksBoard: boolean;
}): boolean {
  if (opts.classReportBlocksBoard) return true;
  if (opts.trigger === "room-idle") return false;
  return opts.schedulerControlsBoard;
}

/** 429 helper. Sets Retry-After before delegating to ctx.error so the host's
 *  error renderer doesn't have to know about rate-limit semantics. */
function reject429(ctx: ChatRouteContext, retryAfterSeconds: number): void {
  const r = ctx.res as Partial<NodeLikeResponse>;
  if (typeof r.setHeader === "function") {
    r.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
  }
  ctx.error(ctx.res, "Too many requests — slow down a moment.", 429);
}

const CHAT_PREFIX = "/api/apps/ruby-high/chat";
const AUTH_PREFIX = "/api/apps/ruby-high/auth";
const DEFAULT_AUTH_REDIRECT = "/api/apps/ruby-high/viewer";

/** Resolve the text LLM credential for this session. Browser BYOK and local
 *  LLMs are free; server-hosted OpenRouter text AI requires active AI Access
 *  on the Ruby High wallet. */
function readApiKey(ctx: ChatRouteContext, ruby: RubyHighService, sessionId: string): string | null {
  return resolveTextLlmCredential({
    apiKeyHeader: ctx.apiKeyHeader,
    ruby,
    sessionId,
  }).apiKey;
}

type HostedImageChargeRoute = "character-portrait" | "teacher-portrait" | "diploma";

class HostedImageChargeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HostedImageChargeError";
  }
}

interface HostedImageCharge {
  hallPassCost: number;
  hallPasses: number;
  requestId: string | null;
  spendKey: string | null;
  replayUrl: string | null;
  usedPhotoDayCredit?: boolean;
}

function hostedImageSpendKey(route: HostedImageChargeRoute, requestId: string): string {
  const digest = createHash("sha256").update(`${route}:${requestId}`).digest("hex").slice(0, 32);
  return `hosted-image:${route}:${digest}`;
}

function hostedImageRequestId(body: Record<string, unknown> | null | undefined): string {
  const raw = typeof body?.requestId === "string"
    ? body.requestId
    : typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9:_-]{8,128}$/.test(trimmed)) return trimmed;
  return randomUUID();
}

function hostedImageFingerprint(route: HostedImageChargeRoute, payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ route, payload }))
    .digest("hex")
    .slice(0, 32);
}

function walletMetadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function walletHallPassDebit(transaction: { hallPasses?: number } | null | undefined, fallback: number): number {
  const delta = Math.floor(Number(transaction?.hallPasses ?? 0));
  if (Number.isFinite(delta) && delta < 0) return Math.abs(delta);
  const fallbackAmount = Math.floor(Number(fallback));
  return Number.isFinite(fallbackAmount) && fallbackAmount > 0 ? fallbackAmount : 0;
}

async function prepareHostedImageCharge(args: {
  ruby: RubyHighService;
  sessionId: string;
  hosted: boolean;
  route: HostedImageChargeRoute;
  costKind: "portrait" | "diploma";
  body: Record<string, unknown> | null | undefined;
  description: string;
  fingerprintPayload: Record<string, unknown>;
}): Promise<HostedImageCharge> {
  if (!args.hosted) {
    return {
      hallPassCost: 0,
      hallPasses: args.ruby.hallPassBalance(args.sessionId),
      requestId: null,
      spendKey: null,
      replayUrl: null,
    };
  }
  const imageEntitlement = hostedImageEntitlementStatus(
    { ruby: args.ruby, sessionId: args.sessionId },
    args.costKind,
  );
  const hallPassCost = imageEntitlement.cost;
  const requestId = hostedImageRequestId(args.body);
  const spendKey = hostedImageSpendKey(args.route, requestId);
  const fingerprint = hostedImageFingerprint(args.route, args.fingerprintPayload);
  const existing = args.ruby.walletTransaction(args.sessionId, spendKey);
  if (existing) {
    const usedPhotoDayCredit = existing.kind === "photo-day-spend" || Number(existing.photoDayCredits ?? 0) < 0;
    const metadata = existing.metadata ?? {};
    if (metadata.route !== args.route || metadata.requestId !== requestId || metadata.fingerprint !== fingerprint) {
      throw new HostedImageChargeError("Hosted image request id was already used for different image inputs.", 409);
    }
    const spentHallPasses = walletHallPassDebit(existing, hallPassCost);
    const imageUrl = walletMetadataString(metadata.imageUrl);
    if (metadata.status === "completed" && imageUrl) {
      return {
        hallPassCost: usedPhotoDayCredit ? 0 : spentHallPasses,
        hallPasses: args.ruby.hallPassBalance(args.sessionId),
        requestId,
        spendKey,
        replayUrl: imageUrl,
        usedPhotoDayCredit,
      };
    }
    if (metadata.status === "failed") {
      throw new HostedImageChargeError("Hosted image request failed previously. Start a new image request.", 409);
    }
    const pendingAgeMs = Date.now() - Math.floor(Number(existing.at ?? 0));
    if (
      (metadata.status === "pending" || metadata.status == null) &&
      HOSTED_IMAGE_PENDING_TTL_MS > 0 &&
      Number.isFinite(pendingAgeMs) &&
      pendingAgeMs > HOSTED_IMAGE_PENDING_TTL_MS
    ) {
      await refundHostedImageCharge({
        ruby: args.ruby,
        sessionId: args.sessionId,
        charge: {
          hallPassCost: usedPhotoDayCredit ? 0 : spentHallPasses,
          hallPasses: args.ruby.hallPassBalance(args.sessionId),
          requestId,
          spendKey,
          replayUrl: null,
          usedPhotoDayCredit,
        },
        reason: "Hosted image request timed out before completion.",
      });
      throw new HostedImageChargeError("Hosted image request timed out. Start a new image request.", 409);
    }
    throw new HostedImageChargeError("Hosted image request is already in progress. Try again in a moment.", 409);
  }

  const usePhotoDayCredit = args.route === "character-portrait" &&
    args.costKind === "portrait" &&
    args.ruby.photoDayCreditBalance(args.sessionId) > 0;
  if (!usePhotoDayCredit && !imageEntitlement.affordable) {
    throw new HostedImageChargeError(
      `Need ${hallPassCost} Hall Pass${hallPassCost === 1 ? "" : "es"} for a hosted ${args.costKind === "diploma" ? "diploma image" : "portrait"}.`,
      402,
    );
  }

  try {
    if (usePhotoDayCredit) {
      const spend = args.ruby.consumePhotoDayCredit(args.sessionId, {
        amount: 1,
        idempotencyKey: spendKey,
        source: "photo-day",
        description: "Photo Day character portrait",
        metadata: {
          route: args.route,
          requestId,
          fingerprint,
          status: "pending",
        },
      });
      await args.ruby.flushSession(args.sessionId);
      return {
        hallPassCost: 0,
        hallPasses: spend.state.wallet.hallPasses,
        requestId,
        spendKey,
        replayUrl: null,
        usedPhotoDayCredit: true,
      };
    }
    const spend = args.ruby.spendHallPasses(args.sessionId, {
      amount: hallPassCost,
      idempotencyKey: spendKey,
      source: "hosted-image",
      description: args.description,
      metadata: {
        route: args.route,
        requestId,
        fingerprint,
        status: "pending",
      },
    });
    await args.ruby.flushSession(args.sessionId);
    return {
      hallPassCost,
      hallPasses: spend.state.wallet.hallPasses,
      requestId,
      spendKey,
      replayUrl: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HostedImageChargeError(
      message,
      message.startsWith("Not enough Hall Passes") || message.startsWith("Not enough Photo Day credits") ? 402 : 503,
    );
  }
}

async function completeHostedImageCharge(args: {
  ruby: RubyHighService;
  sessionId: string;
  charge: HostedImageCharge;
  imageUrl: string;
}): Promise<number> {
  if (!args.charge.spendKey) return args.ruby.hallPassBalance(args.sessionId);
  args.ruby.annotateWalletTransaction(args.sessionId, args.charge.spendKey, {
    status: "completed",
    imageUrl: args.imageUrl,
  });
  await args.ruby.flushSession(args.sessionId);
  return args.ruby.hallPassBalance(args.sessionId);
}

async function refundHostedImageCharge(args: {
  ruby: RubyHighService;
  sessionId: string;
  charge: HostedImageCharge;
  reason: string;
}): Promise<void> {
  if (!args.charge.spendKey || !args.charge.requestId) return;
  try {
    args.ruby.annotateWalletTransaction(args.sessionId, args.charge.spendKey, {
      status: "failed",
      error: args.reason.slice(0, 160),
    });
    if (args.charge.usedPhotoDayCredit) {
      args.ruby.refundPhotoDayCredit(args.sessionId, {
        amount: 1,
        idempotencyKey: `${args.charge.spendKey}:refund`,
        source: "photo-day",
        description: "Photo Day credit refund",
        metadata: {
          spendKey: args.charge.spendKey,
          requestId: args.charge.requestId,
          reason: args.reason.slice(0, 160),
        },
      });
    } else if (args.charge.hallPassCost > 0) {
      args.ruby.refundHallPasses(args.sessionId, {
        amount: args.charge.hallPassCost,
        idempotencyKey: `${args.charge.spendKey}:refund`,
        source: "hosted-image",
        description: "Hosted image generation refund",
        metadata: {
          spendKey: args.charge.spendKey,
          requestId: args.charge.requestId,
          reason: args.reason.slice(0, 160),
        },
      });
    }
    await args.ruby.flushSession(args.sessionId);
  } catch (err) {
    log.error("hosted-image.refund-failed", err, {
      sessionId: args.sessionId,
      spendKey: args.charge.spendKey,
    });
  }
}

function rejectHostedImageChargeError(ctx: ChatRouteContext, err: unknown): void {
  if (err instanceof HostedImageChargeError) {
    ctx.error(ctx.res, err.message, err.status);
    return;
  }
  ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 500);
}

/** Pull the session cookie + API key for an LLM endpoint. The cookie
 *  identifies the QuizState bucket; the header carries the credential.
 *  Returns null on either missing piece — callers respond with 401. */
function requireAuth(
  ctx: ChatRouteContext,
  auth: AuthService,
  ruby: RubyHighService,
): { token: string; apiKey: string; record: AuthRecord; stateKey: string } | null {
  const token = auth.parseSessionToken(ctx.cookieHeader);
  const record = auth.resolve(token);
  const stateKey = record ? auth.stateKeyForRecord(record) : "";
  const apiKey = record ? readApiKey(ctx, ruby, stateKey) : null;
  if (!token || !apiKey || !record) return null;
  return { token, apiKey, record, stateKey };
}

function requireSession(
  ctx: ChatRouteContext,
  auth: AuthService,
  ruby: RubyHighService,
): { token: string; apiKey: string | null; record: AuthRecord; stateKey: string } | null {
  const token = auth.parseSessionToken(ctx.cookieHeader);
  const record = auth.resolve(token);
  if (!token || !record) return null;
  const stateKey = auth.stateKeyForRecord(record);
  return { token, apiKey: readApiKey(ctx, ruby, stateKey), record, stateKey };
}

function canonicalFacultyForRoute(ruby: RubyHighService, sessionId: string, requested?: string | null): string {
  const state = ruby.getOrCreate(sessionId);
  const raw = requested && requested.trim().length > 0 ? requested.trim() : state.faculty;
  if (raw === "lounge") return raw;
  return resolveFacultyIdForSession(state, raw) ?? raw;
}

function activeFacultyMatches(ruby: RubyHighService, sessionId: string, faculty: string): boolean {
  const state = ruby.getOrCreate(sessionId);
  const active = state.faculty === "lounge"
    ? state.faculty
    : (resolveFacultyIdForSession(state, state.faculty) ?? state.faculty);
  return active === faculty;
}

function setCookieHeader(res: unknown, value: string): void {
  const r = res as NodeLikeResponse;
  const existing = r.getHeader?.("Set-Cookie");
  if (Array.isArray(existing)) r.setHeader("Set-Cookie", [...existing, value]);
  else if (typeof existing === "string") r.setHeader("Set-Cookie", [existing, value]);
  else r.setHeader("Set-Cookie", value);
}

function redirect(res: unknown, location: string): void {
  const r = res as NodeLikeResponse;
  r.statusCode = 302;
  r.setHeader("Location", location);
  r.end();
}

function safeAuthRedirect(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AUTH_REDIRECT;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) {
    return DEFAULT_AUTH_REDIRECT;
  }
  try {
    const parsed = new URL(trimmed, "https://ruby-high.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

/** Render the OAuth-callback HTML shim that lands the API key in the
 *  browser's localStorage and gets the OAuth tab out of the way. The key
 *  is the only piece that actually has to travel back to the client; we
 *  embed it as JSON inside an inline script. localStorage is per-origin
 *  shared, so the original SPA tab notices via the `storage` event and
 *  can flip to authed without polling. */
function writeAuthCallbackHtml(
  res: unknown,
  args: { apiKey: string; label: string | null; redirectTo: string },
): void {
  const payload = JSON.stringify({ apiKey: args.apiKey, label: args.label });
  // The </script> escape is paranoia: if the OpenRouter response ever
  // included that exact substring inside a key it would otherwise terminate
  // our inline script early. The unicode escape keeps JSON.parse happy.
  const safePayload = payload.replace(/<\/script>/gi, "<\\/script>");
  const safeRedirect = JSON.stringify(args.redirectTo);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signed in to Ruby High</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0d1018; color: #f1f1f1; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 24px; max-width: 420px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #b8b8c8; margin: 4px 0 0; }
</style>
</head>
<body>
<main>
  <h1>You're signed in.</h1>
  <p>Heading back to the school…</p>
</main>
<script>
(function () {
  try {
    var data = JSON.parse(${JSON.stringify(safePayload)});
    if (data && data.apiKey) {
      try { localStorage.setItem("rh_openrouter_key", data.apiKey); } catch (e) {}
      try { if (data.label) localStorage.setItem("rh_openrouter_label", data.label); } catch (e) {}
      try { localStorage.setItem("rh_openrouter_at", String(Date.now())); } catch (e) {}
    }
  } catch (e) {}
  // Redirect back to the viewer. Always — no opener-close branch. Safari
  // preserves window.opener across same-origin navigations in some cases,
  // and the previous "if (window.opener) window.close(); return;" hit
  // that path and swallowed the redirect, leaving the player stuck on
  // this stub page after a successful sign-in. localStorage writes above
  // are synchronous so the next line sees the key already persisted.
  try { window.location.replace(${safeRedirect}); } catch (e) {}
})();
</script>
</body>
</html>`;
  const r = res as NodeLikeResponse;
  r.statusCode = 200;
  r.setHeader("Content-Type", "text/html; charset=utf-8");
  r.setHeader("Cache-Control", "no-store");
  r.end(html);
}

/** Render a friendly "you declined" page that auto-redirects back to the app
 *  instead of showing a raw JSON error when the user cancels the OAuth flow. */
function writeAuthDeclinedHtml(res: unknown, redirectTo: string): void {
  const safeRedirect = JSON.stringify(redirectTo);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ruby High</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0d1018; color: #f1f1f1; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 24px; max-width: 420px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #b8b8c8; margin: 4px 0 0; }
</style>
</head>
<body>
<main>
  <h1>Sign-in cancelled.</h1>
  <p>Heading back to the school…</p>
</main>
<script>
(function () {
  try { window.location.replace(${safeRedirect}); } catch (e) {}
})();
</script>
</body>
</html>`;
  const r = res as NodeLikeResponse;
  r.statusCode = 200;
  r.setHeader("Content-Type", "text/html; charset=utf-8");
  r.setHeader("Cache-Control", "no-store");
  r.end(html);
}

function defaultCallbackBuilder(ctx: ChatRouteContext): (path: string) => string {
  if (ctx.callbackUrlBuilder) return ctx.callbackUrlBuilder;
  return (path: string) => {
    const base = ctx.url?.origin ?? "http://127.0.0.1:4711";
    return `${base}${path}`;
  };
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function authOriginAllowed(ctx: ChatRouteContext, buildCallback: (path: string) => string): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidates = [
      buildCallback("/"),
      ctx.url?.origin ?? null,
    ].filter(Boolean) as string[];
    if (candidates.length === 0) return true;
    return candidates.some((candidate) => {
      const candidateUrl = new URL(candidate);
      return candidateUrl.origin === originUrl.origin
        || (originUrl.protocol === "https:" && candidateUrl.host === originUrl.host);
    });
  } catch {
    return false;
  }
}

function rejectBadAuthOrigin(ctx: ChatRouteContext, buildCallback: (path: string) => string): boolean {
  if (authOriginAllowed(ctx, buildCallback)) return false;
  ctx.error(ctx.res, "Auth request origin is not allowed.", 403);
  return true;
}

async function readPrivyAuthBody(ctx: ChatRouteContext): Promise<{ accessToken?: string; identityToken?: string }> {
  const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return {};
  return {
    ...(typeof body.accessToken === "string" ? { accessToken: body.accessToken.trim() } : {}),
    ...(typeof body.identityToken === "string" ? { identityToken: body.identityToken.trim() } : {}),
  };
}

function bearerToken(value: string | string[] | null | undefined): string {
  const raw = firstHeader(value).trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function privySessionStatus(auth: AuthService, record: AuthRecord): Record<string, unknown> {
  const walletAddress = auth.walletAddressForRecord(record);
  return {
    configured: !!getPrivyPublicConfigFromEnv(),
    authenticated: record.provider === "privy",
    walletAddress: walletAddress || null,
    walletChainType: record.walletChainType ?? null,
    label: record.label ?? null,
  };
}

/**
 * Returns true if the route was handled. Otherwise the host should try other handlers.
 */
export async function handleChatRoutes(ctx: ChatRouteContext): Promise<boolean> {
  if (!ctx.pathname.startsWith(CHAT_PREFIX) && !ctx.pathname.startsWith(AUTH_PREFIX)) return false;

  const runtime = getRuntime(ctx.runtime);
  const auth = getService<AuthService>(runtime, AuthService.serviceType);
  const chat = getService<ChatService>(runtime, ChatService.serviceType);
  const ruby = getService<RubyHighService>(runtime, RubyHighService.serviceType);

  if (!auth || !chat || !ruby) {
    ctx.error(ctx.res, "Ruby High auth/chat services unavailable.", 503);
    return true;
  }

  const buildCallback = defaultCallbackBuilder(ctx);
  const secure = ctx.isSecure ?? false;

  // ── auth ──────────────────────────────────────────────────────────────────
  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/start`) {
    const callbackUrl = buildCallback(`${AUTH_PREFIX}/callback`);
    const { redirectUrl } = auth.startPkce(callbackUrl);
    redirect(ctx.res, redirectUrl);
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${AUTH_PREFIX}/guest`) {
    if (rejectBadAuthOrigin(ctx, buildCallback)) return true;
    const existingToken = auth.parseSessionToken(ctx.cookieHeader);
    const { token, record } = await auth.createGuestSession(existingToken);
    if (token !== existingToken) {
      setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
    }
    const stateKey = auth.stateKeyForRecord(record);
    const apiKey = readApiKey(ctx, ruby, stateKey);
    const entitlements = hostedEntitlementStatus({ ruby, sessionId: stateKey });
    ctx.json(ctx.res, {
      ok: true,
      session: true,
      ai: !!apiKey,
      ai_provider: llmProviderName(),
      local_ai: isLocalLlmProvider(),
      hosted_ai: entitlements.hosted_ai,
      entitlements,
      privy: privySessionStatus(auth, record),
      privy_configured: !!getPrivyPublicConfigFromEnv(),
      since: record.createdAt,
      label: record.label ?? "Guest",
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${AUTH_PREFIX}/privy`) {
    if (rejectBadAuthOrigin(ctx, buildCallback)) return true;
    if (!privyServerConfigured()) {
      ctx.error(ctx.res, "Privy is not configured on this Ruby High server.", 503);
      return true;
    }
    try {
      const body = await readPrivyAuthBody(ctx);
      const verified = await verifyPrivyAuth({
        accessToken: body.accessToken ?? bearerToken(ctx.authorizationHeader),
        identityToken: body.identityToken,
      });
      const existingToken = auth.parseSessionToken(ctx.cookieHeader);
      const { token, record } = await auth.completePrivyLogin(verified, existingToken);
      if (token !== existingToken) {
        setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
      }
      const stateKey = auth.stateKeyForRecord(record);
      const apiKey = readApiKey(ctx, ruby, stateKey);
      const entitlements = hostedEntitlementStatus({ ruby, sessionId: stateKey });
      ctx.json(ctx.res, {
        ok: true,
        session: true,
        ai: !!apiKey,
        ai_provider: llmProviderName(),
        local_ai: isLocalLlmProvider(),
        hosted_ai: entitlements.hosted_ai,
        entitlements,
        privy: privySessionStatus(auth, record),
        since: record.createdAt,
        label: record.label ?? verified.label ?? "Privy",
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 401);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/callback`) {
    const code = ctx.url?.searchParams.get("code") ?? "";
    const state = ctx.url?.searchParams.get("state") ?? "";
    if (!code || !state) {
      // User declined the OAuth flow (or arrived without valid params).
      // Redirect back to the app rather than surfacing a raw JSON error.
      const back = safeAuthRedirect(ctx.url?.searchParams.get("redirect"));
      writeAuthDeclinedHtml(ctx.res, back);
      return true;
    }
    try {
      const { token, apiKey, record } = await auth.completePkce(state, code, auth.parseSessionToken(ctx.cookieHeader));
      setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
      const back = safeAuthRedirect(ctx.url?.searchParams.get("redirect"));
      // Hand the API key back to the browser via a tiny HTML shim. We write
      // it to localStorage (not a cookie, not a URL fragment) so it never
      // leaves the client and survives reloads. localStorage events fan out
      // across same-origin tabs, so the original SPA tab notices and flips
      // to authed without a poll. Redirect targets are sanitized to
      // root-relative same-origin paths before they hit the inline shim.
      writeAuthCallbackHtml(ctx.res, { apiKey, label: record.label ?? null, redirectTo: back });
    } catch (err) {
      ctx.error(ctx.res, `Auth failed: ${err instanceof Error ? err.message : String(err)}`, 400);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/me`) {
    // Ruby High play requires only the app-owned session cookie. AI/chat
    // additionally requires the browser-owned OpenRouter key. The key still
    // never persists server-side.
    const record = auth.resolve(auth.parseSessionToken(ctx.cookieHeader));
    const stateKey = record ? auth.stateKeyForRecord(record) : "";
    const apiKey = record ? readApiKey(ctx, ruby, stateKey) : null;
    const entitlements = record ? hostedEntitlementStatus({ ruby, sessionId: stateKey }) : null;
    ctx.json(ctx.res, {
      authed: !!record,
      session: !!record,
      ai: !!apiKey && !!record,
      ai_provider: llmProviderName(),
      local_ai: isLocalLlmProvider(),
      hosted_ai: entitlements?.hosted_ai ?? null,
      entitlements,
      privy: record ? privySessionStatus(auth, record) : {
        configured: !!getPrivyPublicConfigFromEnv(),
        authenticated: false,
        walletAddress: null,
        walletChainType: null,
      },
      since: record?.createdAt ?? null,
      label: record?.label ?? null,
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${AUTH_PREFIX}/logout`) {
    if (rejectBadAuthOrigin(ctx, buildCallback)) return true;
    const token = auth.parseSessionToken(ctx.cookieHeader);
    auth.destroy(token);
    setCookieHeader(ctx.res, auth.buildClearCookie({ secure }));
    ctx.json(ctx.res, { ok: true });
    return true;
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  if (ctx.method === "GET" && ctx.pathname === `${CHAT_PREFIX}/history`) {
    const requestedFaculty = ctx.url?.searchParams.get("faculty") ?? "ruby";
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!token || !record) {
      ctx.json(ctx.res, { authed: false, history: [] });
      return true;
    }
    const faculty = canonicalFacultyForRoute(ruby, auth.stateKeyForRecord(record), requestedFaculty);
    const messages = chat.history({ sessionToken: token, faculty });
    // History is bucketed by the cookie; the X-Openrouter-Key header decides
    // whether the client is "authed" for chat actions. Both can be present
    // independently — a fresh tab might have a cookie from a prior session
    // and want history but not have a key yet (or vice versa).
    const stateKey = auth.stateKeyForRecord(record);
    const entitlements = hostedEntitlementStatus({ ruby, sessionId: stateKey });
    ctx.json(ctx.res, {
      authed: !!readApiKey(ctx, ruby, stateKey),
      local_ai: isLocalLlmProvider(),
      hosted_ai: entitlements.hosted_ai,
      entitlements,
      history: publicChatHistory(messages),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === CHAT_PREFIX) {
    const cred = requireSession(ctx, auth, ruby);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }

    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; message?: string; model?: string }
      | null;
    const faculty = canonicalFacultyForRoute(ruby, sessionId, body?.faculty);
    if (!apiKey && chat.requiresBrowserApiKey(sessionId, faculty)) {
      ctx.error(ctx.res, "Sign in with OpenRouter first for this teacher.", 401);
      return true;
    }
    const message = (body?.message ?? "").trim();
    if (!message) {
      ctx.error(ctx.res, "Missing 'message'.", 400);
      return true;
    }

    const { send, end } = openSse(ctx.res);

    try {
      const bank = ruby.questionBankStatus(getSessionId(runtime, ctx.cookieHeader), faculty);
      for await (const ev of chat.send({
        apiKey,
        sessionToken: token,
        agentSessionId: sessionId,
        faculty,
        userMessage: message,
        model: body?.model,
        disableTools: schedulerOwnsBoard(bank),
      })) {
        send(ev.type, ev);
      }
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      end();
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/player-line`) {
    const cred = requireAuth(ctx, auth, ruby);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated. Sign in with OpenRouter first.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; context?: { intent?: unknown } }
      | null;
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const faculty = canonicalFacultyForRoute(ruby, sessionId, body?.faculty);
    const state = ruby.getOrCreate(sessionId);
    const intent = cleanPlayerChatIntent(body?.context?.intent) ?? playerIntentForPhase(state);
    const bankStatus = faculty === "lounge" ? null : ruby.questionBankStatus(sessionId, faculty);
    try {
      const line = await generatePlayerLine({
        apiKey,
        state,
        faculty,
        intent,
        history: chat.history({ sessionToken: token, faculty }),
        bankStatus,
      });
      ctx.json(ctx.res, { ok: true, line, intent });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // Fire a teacher-driven turn (no user message). The client calls this when
  // a state event happens — the student enters a classroom, answers a question,
  // etc. The server constructs the appropriate system directive and runs the
  // model, streaming the response back.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/event`) {
    const cred = requireSession(ctx, auth, ruby);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; trigger?: string; context?: AnswerGradedContext; clientTurnSeq?: number }
      | null;
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const faculty = canonicalFacultyForRoute(ruby, sessionId, body?.faculty);
    if (!apiKey && chat.requiresBrowserApiKey(sessionId, faculty)) {
      ctx.error(ctx.res, "Sign in with OpenRouter first for this teacher.", 401);
      return true;
    }
    const trigger = String(body?.trigger ?? "manual");
    const grade = body?.context?.grade;
    const contextIntent = cleanPlayerChatIntent(body?.context?.intent);
    const isStaleChatEvent = chatEventTurnGuard(sessionId, faculty, body?.clientTurnSeq);

    const { send, end } = openSse(ctx.res);
    if (isStaleChatEvent()) {
      send("done", { type: "done", finishReason: "stale-turn" });
      end();
      return true;
    }

    // ── Teachers' Lounge: round-robin three teachers in a shared bucket. ───
    if (faculty === "lounge") {
      const TEACHERS = ["ruby", "sally-science", "professor-edward"];
      const order = trigger === "lounge-enter"
        ? TEACHERS
        : [pickNextLoungeSpeaker(chat, token)];
      const playerLine = trigger === "manual" ? cleanText(body?.context?.playerLine) : undefined;
      const loungeSystem =
        "LOUNGE CONTEXT: You're hanging out in the Ruby High teachers' lounge with the other faculty (Ruby, Sally Science, Professor Edward). This is downtime — just conversation, no blackboard, no tools. Chat in 1-2 short sentences in your voice — riff on a student you saw, ask a colleague's opinion, share a small observation. Address colleagues by name when natural. The student is lurking and may chime in.";

      // For lounge-enter, log the event so each speaker's first-turn
      // synopsis includes "the student just walked in."
      if (trigger === "lounge-enter") {
        chat.appendEvent(
          { sessionToken: token, faculty: "lounge" },
          {
            kind: "lounge-enter",
            text: "The student just walked into the teachers' lounge to lurk.",
          },
        );
      }
      try {
        for (const speaker of order) {
          send("speaker", { facultyId: speaker });
          // The "Ruby goes first" kickoff is a per-turn directive for
          // Ruby only, on a lounge-enter trigger. Sally + Edward pick
          // up the room state from RECENT EVENTS + the prior speakers'
          // utterances in history.
          const turnDirective =
            trigger === "lounge-enter" && speaker === "ruby"
              ? "The student just walked in. You go first — open a quick chat thread with Sally and Edward. They'll each chime in after."
              : playerLine
              ? "The student just spoke in the lounge. Reply to them directly in character in 1-2 short sentences, then keep the faculty-room scene moving."
              : undefined;
          for await (const ev of chat.send({
            apiKey,
            sessionToken: token,
            agentSessionId: getSessionId(runtime, ctx.cookieHeader),
            faculty: "lounge",
            speakerFacultyId: speaker,
            bucketKey: "lounge",
            userMessage: playerLine,
            disableTools: true,
            extraSystemContext: loungeSystem,
            systemEventNote: turnDirective,
            maxTokens: 220,
            isStale: isStaleChatEvent,
          })) {
            send(ev.type, ev);
          }
        }
      } catch (err) {
        send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        end();
      }
      return true;
    }

    // ── Classroom: a single teacher takes a turn. ───────────────────────────
    //
    // Trigger ⇒ (event log entry, thin directive). We split the round-state
    // describing event ("Vee picked B; Sami picked C; correct was C") from
    // the action ask ("react in one sentence and pose the next question")
    // because the event lives in the room's awareness layer (synopsised
    // into RECENT EVENTS each turn) and the directive is per-turn-only.
    // Pre-refactor these were fused into one bloated system note that got
    // appended to history and then re-read every subsequent turn as if it
    // were a fresh instruction.
    const bank = ruby.questionBankStatus(sessionId, faculty);
    const classReportControlsBoard = classReportOwnsBoard(bank);
    const manualAdvanceIntent = trigger === "manual" && contextIntent === "advance";
    const classReportBlocksBoard = classReportControlsBoard && !manualAdvanceIntent;
    const schedulerControlsBoard = !classReportBlocksBoard && schedulerOwnsBoard(bank);
    const playerLine = trigger === "manual" ? cleanText(body?.context?.playerLine) : undefined;
    let directive = "";
    let disableToolsForTurn = shouldDisableTools({ trigger, schedulerControlsBoard, classReportBlocksBoard });
    let extraSystemContext: string | undefined;
    if (trigger === "channel-enter") {
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "the player";
      chat.appendEvent(
        { sessionToken: token, faculty },
        {
          kind: "channel-enter",
          text: `${playerName} just walked into your classroom${grade ? ` for ${gradeLabel(grade)} year` : ""}.`,
        },
      );
      directive = classReportBlocksBoard
        ? `Greet ${playerName} in ONE short sentence and acknowledge that today's class report is on the blackboard${bank.todayClass?.letterGrade ? ` with a ${bank.todayClass.letterGrade}` : ""}. Do not call tools or put another question on the board.`
        : schedulerControlsBoard
        ? `Greet ${playerName} in ONE short sentence. Do not mention UI controls. ${schedulerBoundaryInstruction(bank)}`
        : `Greet ${playerName} in ONE short sentence. Do not mention a "Next question" button or tell the player to press a UI control. ${nextBoardInstruction(bank, "Then call pick_from_bank to put the first question on the board. Pick something fitting their year — your call, not theirs.")}`;
    } else if (trigger === "answer-graded") {
      const c = body?.context;
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "the player";
      if (!answerGradedContextMatchesReveal(state, c)) {
        send("done", { type: "done", finishReason: "stale-answer" });
        end();
        return true;
      }
      const round = state.activeRound;
      const resolved = buildResolvedAnswerBriefing({ state, context: c, playerName });
      const correctAns = resolved.correctChoice;
      extraSystemContext = resolved.extraSystemContext;
      // Build the round summary as a structured event line. Synopsised
      // exactly once into the model's RECENT EVENTS block — never
      // re-quoted in subsequent directives.
      const parts: string[] = [resolved.eventText];
      if (round && Array.isArray(round.npcs)) {
        for (const n of round.npcs) {
          const nm = STUDENTS[n.studentId]?.name ?? n.studentId;
          const pick = n.plannedPick ?? "?";
          parts.push(`${nm} picked ${pick} — ${pick === correctAns ? "right" : "wrong"}.`);
        }
      }
      chat.appendEvent(
        { sessionToken: token, faculty },
        { kind: "answer-resolved", text: parts.join(" ") },
      );
      if (characterGraduated(state)) {
        disableToolsForTurn = true;
        directive = `The player has completed Senior year and graduated. Congratulate ${playerName} in one or two short sentences. Do not call tools or put another question on the board.`;
      } else if (graduationReady(state)) {
        disableToolsForTurn = true;
        directive = `${playerName} has completed the year's requirements and is ready for the graduation ceremony. Congratulate them in one or two short sentences and remind them to choose a ceremony reward on their School Career card. Do not call tools or put another question on the board.`;
      } else if (classReportBlocksBoard) {
        disableToolsForTurn = true;
        const classGrade = bank.todayClass?.letterGrade ? ` The class report shows ${bank.todayClass.letterGrade}.` : "";
        directive = `React in ONE short sentence to the round that just resolved: ${resolved.pickedLine}.${classGrade} The class report is on the blackboard now; do not call tools or put another question on the board.`;
      } else {
        const pickedLine = resolved.pickedLine;
        disableToolsForTurn = true;
        directive = `React in ONE short sentence to the round that just resolved: ${pickedLine} Name whoever did something interesting (the player or a classmate by name). Do not call tools or put another question on the board; the player will continue when ready.`;
      }
    } else if (trigger === "room-idle") {
      // disableToolsForTurn is already correct: shouldDisableTools() lets
      // room-idle override the scheduler's block while still respecting the
      // class report block. No manual override needed here.
      const state = ruby.getOrCreate(sessionId);
      // Guard against concurrent or duplicate room-idle requests for the same round.
      if (!state.activeRound || state.activeRound.resolved || !state.activeRound.idleTriggered) {
        send("done", { type: "done", finishReason: "stale-idle" });
        end();
        return true;
      }
      const playerName = state.character?.name ?? "the student";
      // forceAdvanceRound must come before buildResolvedAnswerBriefing because
      // the briefing reads state.lastReveal, which is only populated after the
      // round resolves. The ordering is intentional: the teacher's directive
      // describes a just-forfeited round, not an open one.
      ruby.forceAdvanceRound(sessionId);
      const resolvedState = ruby.getOrCreate(sessionId);
      const resolved = buildResolvedAnswerBriefing({ state: resolvedState, playerName });
      extraSystemContext = resolved.extraSystemContext;
      chat.appendEvent(
        { sessionToken: token, faculty },
        { kind: "answer-resolved", text: `Nobody answered in time. ${resolved.eventText}` },
      );
      directive = classReportBlocksBoard
        ? `Nobody answered the question in time. React briefly as yourself — call on someone by name, make it a moment — then acknowledge the class report on the board. Do not call tools.`
        : `Nobody answered the question in time. This is your DM moment: call on a student by name, make it a beat, then put the next question on the board. ${nextBoardInstruction(bank, "Use pick_from_bank for the next question.")}`;
    } else if (trigger === "manual") {
      const intent = contextIntent;
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "The player";
      if (intent === "hint") {
        disableToolsForTurn = true;
        directive = playerLine
          ? `${playerName} just said: "${clipped(playerLine, 260)}" Give ONE short hint that helps them reason, but do not reveal the answer, the correct choice, or any exact expected answer. Do not call tools or change the board.`
          : "The player pressed Chat while a live challenge is on the blackboard. Give ONE short hint that helps them reason, but do not reveal the answer, the correct choice, or any exact expected answer. Do not call tools or change the board.";
      } else if (playerLine) {
        if (intent === "report") disableToolsForTurn = true;
        directive = intent === "report" || classReportBlocksBoard
          ? `${playerName} just said: "${clipped(playerLine, 260)}" Reply directly in character about today's class report or the recent class. Do not call tools or put another question on the board.`
          : intent === "advance" && schedulerControlsBoard
          ? `${playerName} just said: "${clipped(playerLine, 260)}" Reply directly in character in ONE short sentence. The Ruby High scheduler will put the next card on the board after your reply. ${schedulerBoundaryInstruction(bank)}`
          : intent === "advance"
          ? `${playerName} just said: "${clipped(playerLine, 260)}" Reply directly in character in ONE short sentence, then put a fresh challenge on the board. ${requiredNextBoardInstruction(bank, "Call pick_from_bank exactly once to put the next scheduled question on the board.")}`
          : schedulerControlsBoard
          ? `${playerName} just said: "${clipped(playerLine, 260)}" Reply directly in character, explain the current or recent board if useful, or keep the room moving. ${schedulerBoundaryInstruction(bank)}`
          : `${playerName} just said: "${clipped(playerLine, 260)}" Reply directly in character, then either keep the room moving or put a fresh challenge on the board. ${nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh banked question.")}`;
      } else {
        if (intent === "report") disableToolsForTurn = true;
        directive = intent === "report" || classReportBlocksBoard
          ? `The player pressed Chat while today's class report is on the blackboard. Discuss the result or the recent class in character. Do not call tools or put another question on the board.`
          : schedulerControlsBoard
          ? `The player pressed Chat to move the room forward. Follow up on the last exchange, explain the current or recent board if useful, or keep the scene moving. ${schedulerBoundaryInstruction(bank)}`
          : `The player pressed Chat to move the room forward. Either follow up on the last exchange, or put a fresh challenge on the board. ${nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh banked question.")}`;
      }
    }

    try {
      send("speaker", { facultyId: faculty });
      let questionPosted = false;
      let handoffFired = false;
      const allowOpinionTool = !(trigger === "manual" && contextIntent === "advance");
      for await (const ev of chat.send({
        apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
        faculty,
        userMessage: playerLine,
        disableTools: disableToolsForTurn,
        allowOpinionTool,
        extraSystemContext,
        systemEventNote: directive,
        isStale: isStaleChatEvent,
      })) {
        if (ev.type === "tool") {
          if (toolPlacedFreshQuestion(ev)) questionPosted = true;
          if (ev.tool === "handoff_faculty" && ev.result.ok) handoffFired = true;
        }
        send(ev.type, ev);
      }
      // When the scheduled class loop is done, AI mode regains its previous
      // board-control behavior. If it narrates a transition but forgets the
      // tool call, keep the board state matched by posting a scheduled card
      // when available or asking it once for a custom practice challenge.
      const manualAdvanceNeedsFreshQuestion = trigger === "manual" && contextIntent === "advance" && !classReportBlocksBoard;
      const needsFreshQuestion = manualAdvanceNeedsFreshQuestion
        || (!disableToolsForTurn && (trigger === "channel-enter" || trigger === "room-idle"));
      if (needsFreshQuestion && !questionPosted && !handoffFired && activeFacultyMatches(ruby, sessionId, faculty)) {
        const agentSessionId = getSessionId(runtime, ctx.cookieHeader);
        const latestBank = ruby.questionBankStatus(agentSessionId, faculty);
        let fallbackPosted = false;
        if (scheduledPickAvailable(latestBank)) {
          try {
            const state = ruby.pickAndPose(agentSessionId, { faculty });
            send("tool", {
              tool: "pick_from_bank",
              args: { faculty },
              result: { ok: true, message: `fallback: auto-posed next question (model narrated ${trigger} without tool)` },
              state,
            });
            fallbackPosted = true;
          } catch (err) {
            log.event("chat.bank-exhausted", { faculty, trigger, reason: err instanceof Error ? err.message : String(err) });
          }
        } else {
          log.event("chat.bank-exhausted", { faculty, trigger, reason: "active faculty bank exhausted before fallback" });
        }
        if (!fallbackPosted) {
          const noQuestionNote = latestBank.mode === "srs"
            ? `No scheduled deck card is available for ${latestBank.displayName} right now.`
            : `No scheduled Ruby High card is available for ${latestBank.displayName} right now.`;
          const noQuestionDirective = latestBank.mode === "srs"
            ? "No scheduled deck card is available right now, and pick_from_bank is unavailable. Do not say the deck is exhausted or dry. Call pose_question exactly once for a custom practice challenge."
            : "No scheduled Ruby High card is available, and pick_from_bank is unavailable. Call pose_question exactly once and write a custom practice question.";
          chat.appendEvent(
            { sessionToken: token, faculty },
            { kind: "note", text: noQuestionNote },
          );
          for await (const ev of chat.send({
            apiKey,
            sessionToken: token,
            agentSessionId,
            faculty,
            systemEventNote: noQuestionDirective,
            allowOpinionTool: false,
            isStale: isStaleChatEvent,
          })) {
            send(ev.type, ev);
          }
        }
      }
    } catch (err) {
      log.error("chat.event-failed", err, { faculty, trigger });
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      end();
    }
    return true;
  }

  // Cheap one-shot LLM call for an AI student to chime in. Returns a single
  // short line (no streaming, no history). Client fires this on triggers like
  // an answer reveal or a teacher message landing.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/student-chime`) {
    const cred = requireAuth(ctx, auth, ruby);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { studentId?: string; situation?: string; note?: string; faculty?: string; playerText?: string; recordPlayerText?: boolean }
      | null;
    const student = STUDENTS[String(body?.studentId ?? "")];
    if (!student) {
      ctx.error(ctx.res, "Unknown studentId.", 400);
      return true;
    }
    const situation = String(body?.situation ?? "ambient classroom moment");
    // Plumb group-chat context into the chime: who the player is, who else
    // is seated nearby. Keeps NPCs grounded in the room instead of riffing
    // on a faceless "user" — and lets them address each other by name.
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const state = ruby.getOrCreate(sessionId);
    const faculty = body?.faculty ? canonicalFacultyForRoute(ruby, sessionId, body.faculty) : undefined;
    const playerName = state.character?.name;
    let classmateNames: string[] = [];
    if (state.currentGrade && state.faculty) {
      const r = state.npcRosters[state.currentGrade] ?? [];
      const room = roomForFacultyForSession(state, state.faculty);
      if (room && room.teaches) {
        classmateNames = r
          .filter((n) => n.currentRoom === room.id && n.id !== student.id)
          .map((n) => STUDENTS[n.id]?.name ?? n.id);
      }
    }
    // Pull the teacher's most recent spoken line so the NPC reacts to actual
    // words on screen, not a faceless event tag. Without this an NPC will
    // openly admit it can't see the conversation ("can't see what edward
    // actually said to iris so i got nothing rn lol").
    let teacherSaid: string | undefined;
    if (faculty) {
      const history = chat.history({ sessionToken: token, faculty });
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === "assistant" && m.content && m.content.trim()) {
          teacherSaid = m.content.trim();
          break;
        }
      }
    }
    const playerText = body?.playerText?.trim() || undefined;
    if (playerText && faculty && body?.recordPlayerText) {
      chat.appendPlayerMessage({ sessionToken: token, faculty }, playerText);
    }
    if (playerText && faculty) {
      chat.appendEvent(
        { sessionToken: token, faculty },
        {
          kind: "note",
          text: `${playerName ?? "The player"} said: "${clipped(playerText, 180)}"`,
        },
      );
    }
    try {
      const line = await generateStudentLine({
        apiKey,
        student,
        situation,
        note: body?.note,
        faculty,
        playerName,
        classmateNames,
        teacherSaid,
        playerText,
      });
      // Stamp the chime into the active teacher's room awareness so the
      // next teacher turn's RECENT EVENTS synopsis includes it. Without
      // this, an NPC speaks on screen, the player replies "Thanks Sami!"
      // and the teacher — whose dialogue history only carries her own
      // messages plus the player's — has no record of Sami at all and
      // denies knowing him. Routed through the structured event log so
      // it shows up in synopsis order, never as a stale system note in
      // the dialogue stream.
      if (line && faculty) {
        chat.appendEvent(
          { sessionToken: token, faculty },
          {
            kind: "chime",
            text: `${student.name} (classmate) chimed in: "${line}"`,
          },
        );
      }
      ctx.json(ctx.res, {
        ok: true,
        student: { id: student.id, name: student.name, color: student.color },
        line,
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // Player submits their written response to an opinion question. If all
  // responses are in (player + both NPCs), this also runs the grading turn
  // and streams the teacher's verdict as SSE. Works in offline (non-AI)
  // mode too — without an apiKey we use a deterministic auto-grade so the
  // player isn't trapped on a Social card with no way forward.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/opinion-submit`) {
    const sessionToken = auth.parseSessionToken(ctx.cookieHeader);
    const sessionRecord = sessionToken ? auth.resolve(sessionToken) : null;
    if (!sessionToken || !sessionRecord) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const token = sessionToken;
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const apiKey = readApiKey(ctx, ruby, sessionId);
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { text?: string; force?: boolean } | null;
    const text = (body?.text ?? "").trim();
    const force = !!body?.force;
    let mutated = false;
    if (text) {
      ruby.recordOpinion(sessionId, "player", text);
      mutated = true;
    }
    const offline = !apiKey;
    if (apiKey && text && !force) {
      void chat.kickoffNpcOpinions(apiKey, sessionId).catch((err) => {
        log.error("opinion.npc-kickoff-failed", err, { sessionId });
      });
    }

    // Force-grade path: the round timer expired or all NPCs are in but the
    // player never spoke. Fill missing responders with placeholders so the
    // teacher can grade what's there. In offline mode we always force-fill
    // so the round can resolve without an LLM-driven NPC turn.
    if (force || offline) {
      mutated = fillMissingOpinionResponders(ruby, sessionId, offline ? "offline" : "force") || mutated;
    }
    if (mutated) {
      try {
        await ruby.flushSession(sessionId);
      } catch (err) {
        log.error("opinion.persist-failed", err, { sessionId });
        ctx.error(ctx.res, "Opinion response could not be persisted. Please retry.", 503);
        return true;
      }
    }

    // Normal AI path: player submissions used to return "waiting" until
    // every NPC response arrived, which made the UI look frozen when NPC
    // generation stalled or had been skipped by a race. Give classmates a
    // short chance to land, then fill the missing slots and grade now; the
    // long OpenRouter timeout should not be user-visible control flow.
    if (!force && !offline && text && !ruby.isOpinionRoundReadyToGrade(sessionId)) {
      await waitForOpinionReadyToGrade(ruby, sessionId);
      if (!ruby.isOpinionRoundReadyToGrade(sessionId)) {
        const filled = fillMissingOpinionResponders(ruby, sessionId, "grace");
        if (filled) {
          try {
            await ruby.flushSession(sessionId);
          } catch (err) {
            log.error("opinion.persist-failed", err, { sessionId });
            ctx.error(ctx.res, "Opinion response could not be persisted. Please retry.", 503);
            return true;
          }
        }
      }
    }

    const { send, end } = openSse(ctx.res);

    if (!ruby.isOpinionRoundReadyToGrade(sessionId)) {
      send("waiting", { ok: true });
      end();
      return true;
    }

    // Everyone's in — run the grading.
    try {
      const state = ruby.getOrCreate(sessionId);
      const round = state.activeRound;
      if (!round || !state.current) throw new Error("No active opinion round.");
      const responses = round.opinionResponses.map((r) => ({
        responder: r.responder,
        displayName: r.responder === "player"
          ? "the Player"
          : (STUDENTS[r.responder]?.name ?? r.responder),
        text: r.text,
      }));
      const facultyId = state.faculty;
      send("speaker", { facultyId });
      let offlinePlayerRoll: { stat: keyof CharacterStats; dice: [number, number]; total: number; outcome: RoundOutcome } | null = null;
      let grades: import("./grading.js").ParsedGrade[] = [];
      let bestResponder: string | null = null;
      let narrativeText = "";
      const useOfflineVerdict = () => {
        const verdict = buildOfflineOpinionVerdict({ state });
        grades = verdict.grades;
        bestResponder = verdict.bestResponder;
        narrativeText = verdict.narrativeText;
        offlinePlayerRoll = verdict.playerRoll;
      };
      if (apiKey) {
        try {
          const verdict = await gradeOpinionResponses({
            apiKey,
            facultyId,
            question: state.current.prompt,
            rubric: state.current.rubric,
            responses,
            playerName: "the player",
          });
          if (!verdict.grades.some((g) => g.responder === "player")) {
            throw new Error("Teacher grading omitted the player grade.");
          }
          grades = verdict.grades;
          bestResponder = verdict.bestResponder;
          narrativeText = verdict.narrativeText;
        } catch (err) {
          log.error("opinion.grade-ai-failed", err, { sessionId, facultyId, questionId: state.current.id });
          useOfflineVerdict();
        }
      } else {
        useOfflineVerdict();
      }
      // Stream the narrative as deltas (chunked by sentence so the typewriter
      // effect lands).
      const chunks = narrativeText.match(/[^.!?]+[.!?]+\s*|.+$/g) ?? [narrativeText];
      for (const chunk of chunks) {
        send("delta", { text: chunk });
        await new Promise((r) => setTimeout(r, 80));
      }
      // Finalize.
      ruby.recordGrades(sessionId, grades, bestResponder);
      if (offlinePlayerRoll) {
        // recordGrades doesn't know about the offline dice; attach the
        // roll to the freshly-set lastReveal so the reveal renders the
        // dice chip alongside the verdict.
        const finalState = ruby.getOrCreate(sessionId);
        if (finalState.lastReveal) {
          finalState.lastReveal.playerRoll = offlinePlayerRoll;
        }
      }
      await ruby.flushSession(sessionId);
      send("opinion-graded", {
        grades,
        bestResponder,
        responses,
      });
      send("done", { finishReason: "stop" });
      // Log the grading event for the next teacher turn's synopsis. The
      // narrativeText itself is yielded as deltas above (visible in
      // chat); this entry exists so a follow-up teacher turn knows the
      // grading has already happened and doesn't re-grade.
      chat.appendEvent(
        { sessionToken: token, faculty: facultyId },
        { kind: "opinion-graded", text: `Opinion grading delivered: ${narrativeText}` },
      );
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      end();
    }
    return true;
  }

  // Roll a random character preview. Returns JSON; the client either accepts
  // (calls the regular /command create-character) or rerolls.
  // Generate a sticker portrait of the player's character. Returns a base64
  // data URL that the client persists onto the character via set-portrait.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/portrait`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    const imageCredential = resolveOpenRouterImageCredential({
      apiKeyHeader: ctx.apiKeyHeader,
    });
    const apiKey = imageCredential.apiKey;
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    if (!apiKey) {
      ctx.error(
        ctx.res,
        isLocalLlmProvider()
          ? "Local text AI is enabled, but portrait generation still requires an OpenRouter image model."
          : "Sign in with OpenRouter first.",
        isLocalLlmProvider() ? 501 : 401,
      );
      return true;
    }
    // Image generation is the most expensive call we make — keep its bucket
    // separate and tighter than the chat one.
    const rlKey = rateLimitKey(ctx, token);
    if (!PORTRAIT_LIMITER.take(rlKey)) {
      reject429(ctx, PORTRAIT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { name?: string; playbookId?: string; personality?: string; stats?: { head?: number; heart?: number; hustle?: number; honor?: number } }
      | null;
    const name = String(body?.name ?? "").trim();
    const personality = String(body?.personality ?? "").trim();
    if (!name || !personality) {
      ctx.error(ctx.res, "Missing name or personality.", 400);
      return true;
    }
    const sessionId = auth.stateKeyForRecord(record);
    let charge: HostedImageCharge;
    try {
      charge = await prepareHostedImageCharge({
        ruby,
        sessionId,
        hosted: imageCredential.hosted,
        route: "character-portrait",
        costKind: "portrait",
        body: body as Record<string, unknown> | null,
        description: "Custom character portrait",
        fingerprintPayload: {
          name,
          personality,
          playbookId: body?.playbookId ?? null,
          stats: body?.stats ?? null,
        },
      });
    } catch (err) {
      rejectHostedImageChargeError(ctx, err);
      return true;
    }
    if (charge.replayUrl) {
      ctx.json(ctx.res, {
        ok: true,
        portraitDataUrl: charge.replayUrl,
        hallPassCost: charge.hallPassCost,
        hallPasses: charge.hallPasses,
        photoDayCreditsUsed: !!charge.usedPhotoDayCredit,
        characterSlots: ruby.characterSlotEntitlements(sessionId),
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      });
      return true;
    }
    let url: string;
    try {
      const dataUrl = await renderCharacterPortrait({
        apiKey,
        name,
        personality,
      });
      // S3 upload returns the public URL; falls through to the dataUrl
      // when RUBY_HIGH_PORTRAITS_BUCKET isn't set (the createCharacter
      // size cap will then reject on save and the user sees a clear
      // error). The field name stays portraitDataUrl for callsite
      // backward compat — value is now usually an https:// URL.
      url = await maybeUploadPortrait(dataUrl, "portrait");
    } catch (err) {
      await refundHostedImageCharge({
        ruby,
        sessionId,
        charge,
        reason: err instanceof Error ? err.message : String(err),
      });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
      return true;
    }
    const hallPasses = await completeHostedImageCharge({ ruby, sessionId, charge, imageUrl: url });
    ctx.json(ctx.res, {
      ok: true,
      portraitDataUrl: url,
      ...(imageCredential.hosted ? {
        hallPassCost: charge.hallPassCost,
        hallPasses,
        photoDayCreditsUsed: !!charge.usedPhotoDayCredit,
        characterSlots: ruby.characterSlotEntitlements(sessionId),
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      } : {}),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/teacher/portrait`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const sessionId = auth.stateKeyForRecord(record);
    const imageCredential = resolveOpenRouterImageCredential({
      apiKeyHeader: ctx.apiKeyHeader,
    });
    const apiKey = imageCredential.apiKey;
    if (!apiKey) {
      ctx.error(ctx.res, openRouterGenerationRequiredMessage("generating teacher images"), 401);
      return true;
    }
    const rlKey = rateLimitKey(ctx, token);
    if (!PORTRAIT_LIMITER.take(rlKey)) {
      reject429(ctx, PORTRAIT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { name?: string; personality?: string }
      | null;
    const name = String(body?.name ?? "").trim();
    const personality = String(body?.personality ?? "").trim();
    if (!name || !personality) {
      ctx.error(ctx.res, "Missing name or personality.", 400);
      return true;
    }
    let charge: HostedImageCharge;
    try {
      charge = await prepareHostedImageCharge({
        ruby,
        sessionId,
        hosted: imageCredential.hosted,
        route: "teacher-portrait",
        costKind: "portrait",
        body: body as Record<string, unknown> | null,
        description: "Custom teacher portrait",
        fingerprintPayload: { name, personality },
      });
    } catch (err) {
      rejectHostedImageChargeError(ctx, err);
      return true;
    }
    if (charge.replayUrl) {
      ctx.json(ctx.res, {
        ok: true,
        profileImageUrl: charge.replayUrl,
        hallPassCost: charge.hallPassCost,
        hallPasses: charge.hallPasses,
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      });
      return true;
    }
    let url: string;
    try {
      const dataUrl = await renderTeacherPortrait({ apiKey, name, personality });
      url = await maybeUploadPortrait(dataUrl, "portrait");
    } catch (err) {
      await refundHostedImageCharge({
        ruby,
        sessionId,
        charge,
        reason: err instanceof Error ? err.message : String(err),
      });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
      return true;
    }
    const hallPasses = await completeHostedImageCharge({ ruby, sessionId, charge, imageUrl: url });
    ctx.json(ctx.res, {
      ok: true,
      profileImageUrl: url,
      ...(imageCredential.hosted ? {
        hallPassCost: charge.hallPassCost,
        hallPasses,
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      } : {}),
    });
    return true;
  }

  // Diploma image — fired by the viewer when graduation lands. Reads the
  // character's subjectScores server-side to pick the subject-themed
  // accessory. Same rate-limiter as portrait gen (8 burst, 1/30s).
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/diploma`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    const imageCredential = resolveOpenRouterImageCredential({
      apiKeyHeader: ctx.apiKeyHeader,
    });
    const apiKey = imageCredential.apiKey;
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    if (!apiKey) {
      ctx.error(
        ctx.res,
        isLocalLlmProvider()
          ? "Local text AI is enabled, but diploma image generation still requires an OpenRouter image model."
          : "Sign in with OpenRouter first.",
        isLocalLlmProvider() ? 501 : 401,
      );
      return true;
    }
    const rlKey = rateLimitKey(ctx, token);
    if (!PORTRAIT_LIMITER.take(rlKey)) {
      reject429(ctx, PORTRAIT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const sessionId = auth.stateKeyForRecord(record);
    const state = ruby.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) {
      ctx.error(ctx.res, "No character on this session.", 400);
      return true;
    }
    if ((ch.yearbook ?? []).length < 4) {
      ctx.error(ctx.res, "Diploma is only available after Senior graduation.", 400);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown> | null;
    let charge: HostedImageCharge;
    try {
      charge = await prepareHostedImageCharge({
        ruby,
        sessionId,
        hosted: imageCredential.hosted,
        route: "diploma",
        costKind: "diploma",
        body,
        description: "Graduation diploma image",
        fingerprintPayload: {
          name: ch.name,
          personality: ch.personality,
          bestSubjectFacultyId: highestScoringFaculty(ch.subjectScores),
          yearbookCount: ch.yearbook?.length ?? 0,
        },
      });
    } catch (err) {
      rejectHostedImageChargeError(ctx, err);
      return true;
    }
    if (charge.replayUrl) {
      ruby.setDiplomaImage(sessionId, charge.replayUrl);
      await ruby.flushSession(sessionId);
      ctx.json(ctx.res, {
        ok: true,
        diplomaImageDataUrl: charge.replayUrl,
        bestSubject: highestScoringFaculty(ch.subjectScores),
        hallPassCost: charge.hallPassCost,
        hallPasses: charge.hallPasses,
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      });
      return true;
    }
    let url: string;
    try {
      const dataUrl = await renderDiplomaImage({
        apiKey,
        name: ch.name,
        personality: ch.personality,
        bestSubjectFacultyId: highestScoringFaculty(ch.subjectScores),
      });
      url = await maybeUploadPortrait(dataUrl, "diploma");
      ruby.setDiplomaImage(sessionId, url);
    } catch (err) {
      await refundHostedImageCharge({
        ruby,
        sessionId,
        charge,
        reason: err instanceof Error ? err.message : String(err),
      });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
      return true;
    }
    const hallPasses = await completeHostedImageCharge({ ruby, sessionId, charge, imageUrl: url });
    ctx.json(ctx.res, {
      ok: true,
      diplomaImageDataUrl: url,
      bestSubject: highestScoringFaculty(ch.subjectScores),
      ...(imageCredential.hosted ? {
        hallPassCost: charge.hallPassCost,
        hallPasses,
        entitlements: hostedEntitlementStatus({ ruby, sessionId }),
      } : {}),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/generate`) {
    const cred = requireAuth(ctx, auth, ruby);
    if (!cred) {
      ctx.error(ctx.res, "Sign in with OpenRouter first to roll a character.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    // Body: { regen?: CharacterComponent[], keep?: Partial<RolledCharacter> }
    // No body / empty body → full roll (current behaviour).
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { regen?: unknown; keep?: unknown }
      | null;
    const regen = Array.isArray(body?.regen)
      ? (body!.regen.filter((x): x is CharacterComponent =>
          x === "name" || x === "personality" || x === "arcAnswer" ||
          x === "flavorQuote" || x === "stats" || x === "playbook"))
      : undefined;
    const keep = body?.keep && typeof body.keep === "object"
      ? body.keep as Partial<RolledCharacter>
      : undefined;
    // Rate-limit only when an LLM call is actually going to fire. Pure
    // dice rerolls (regen ⊆ {stats, playbook}) skip the limiter so
    // tapping the dice icon stays snappy.
    const willHitLLM =
      !regen ||
      regen.some((c) => c === "name" || c === "personality" || c === "arcAnswer" || c === "flavorQuote");
    if (willHitLLM) {
      const rlKey = rateLimitKey(ctx, token);
      if (!CHAT_LIMITER.take(rlKey)) {
        reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
        return true;
      }
    }
    try {
      const c = await rollRandomCharacter({ apiKey, regen, keep });
      ctx.json(ctx.res, { ok: true, character: c });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/reset`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { faculty?: string } | null;
    const faculty = canonicalFacultyForRoute(ruby, auth.stateKeyForRecord(record), body?.faculty ?? "ruby");
    chat.resetHistory({ sessionToken: token, faculty });
    ctx.json(ctx.res, { ok: true });
    return true;
  }

  return false;
}

/**
 * Helper for the answer-was-graded notification. Call this after the user
 * answers via the existing /command path so the active teacher's history
 * gets a system note that they can react to.
 */
export function noteGradedAnswer(args: {
  runtime: IAgentRuntime | null;
  cookieHeader: string | null | undefined;
  faculty: string;
  picked: string;
  correct: string;
  wasCorrect: boolean;
}): void {
  const auth = getService<AuthService>(args.runtime, AuthService.serviceType);
  const chat = getService<ChatService>(args.runtime, ChatService.serviceType);
  const ruby = getService<RubyHighService>(args.runtime, RubyHighService.serviceType);
  if (!auth || !chat || !ruby) return;
  const token = auth.parseSessionToken(args.cookieHeader);
  if (!token || !auth.resolve(token)) return;
  const sessionId = getSessionId(getRuntime(args.runtime), args.cookieHeader);
  const faculty = canonicalFacultyForRoute(ruby, sessionId, args.faculty);
  const state = ruby.getOrCreate(sessionId);
  const playerName = state.character?.name ?? "the player";
  const resolved = buildResolvedAnswerBriefing({
    state,
    playerName,
    context: {
      picked: args.picked,
      correct: args.correct,
      forfeit: false,
      wasCorrect: args.wasCorrect,
    },
  });
  const note = `${resolved.eventText} Do not ask for this answer again.`;
  chat.noteAnswer({ sessionToken: token, faculty }, note);
}
