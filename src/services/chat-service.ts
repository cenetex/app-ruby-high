import { Service, type IAgentRuntime } from "../runtime.js";
import { teacherById, type TeacherCharacter } from "../characters/teachers.js";
import { STUDENTS, type StudentCharacter } from "../characters/students.js";
import type { CharacterStats, Choice, Difficulty, NpcStudentState, QuizState } from "../types.js";
import { GRADE_LABELS, npcsInRoom, type TeachingRoomId } from "../types.js";
import { facultyByIdForSession, resolveFacultyIdForSession, roomForFacultyForSession } from "../content/registry.js";
import { RubyHighService, type QuestionBankStatus } from "./ruby-high-service.js";
import type { OpenRouterRequest } from "./openrouter-client.js";
import {
  fetchLlmChatCompletions,
  resolveStudentModel,
  throwLlmResponseError,
} from "./llm-provider.js";
import {
  providerForFaculty,
  providerRequiresBrowserKey,
  providerSupportsTools,
  streamTeacherCompletion,
} from "./teacher-providers.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Provider-side tool call id, only meaningful for role='tool' / 'assistant'. */
  toolCallId?: string;
  /** assistant tool calls passed back unchanged on the next round. */
  toolCalls?: ToolCall[];
  /** Faculty id that authored / was active when this message landed. */
  faculty?: string;
  /** Local timestamp for UI ordering. */
  at: number;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ToolDispatchResult = {
  args: Record<string, unknown>;
  payload: { ok: boolean; message?: string; error?: string };
  state?: QuizState;
};

export interface ChatHistoryKey {
  sessionToken: string;
  faculty: string;
}

/**
 * A room-event is the architectural counterpart to a ChatMessage.
 *
 *  - ChatMessage = in-process dialogue (user / assistant / tool). Goes into
 *    `histories`. Round-trips to OpenRouter as role-shaped messages, but is
 *    not part of the durable state store.
 *
 *  - RoomEvent = volatile awareness (who chimed in, what answer just
 *    resolved, who entered the room). Goes into `events`. Surfaces to
 *    the model only as a fresh per-turn "RECENT EVENTS" synopsis block,
 *    *never* as a system message inside history.
 *
 * Why split them: prior to this split, "directive" + "chime" + "answer
 * note" all got pushed into history as `system` messages. They then
 * accumulated turn-over-turn and the model started reading old
 * directives + tool results as a few-shot of "what to do," which
 * produced a string of awareness regressions (re-pick loops,
 * narrate-without-acting, "who is Sami?"). With Tier A/B separated,
 * volatile state is rebuilt from authoritative sources every turn and
 * cannot drift.
 */
export type RoomEventKind =
  | "chime"
  | "answer-resolved"
  | "channel-enter"
  | "lounge-enter"
  | "opinion-graded"
  | "answer-noted"
  | "note";

export interface RoomEvent {
  kind: RoomEventKind;
  /** Pre-formatted line for the model's RECENT EVENTS synopsis. Keep tight. */
  text: string;
  at: number;
}

export interface AvatarPromptContext {
  roomBlock: string;
  boardBlock: string;
  recentEventsBlock: string;
  dialogueBlock: string;
  recentTexts: string[];
}

const HISTORY_LIMIT = 30;
const EVENT_LOG_LIMIT = 60;
const DEFAULT_AGENT_ROUNDS = 4;
const MAX_AGENT_ROUNDS = readAgentRoundLimit(process.env.RUBY_HIGH_CHAT_AGENT_ROUNDS);
const INTERNAL_TOOL_XML_TAGS = new Set([
  "pick_from_bank",
  "pose_question",
  "pose_opinion",
  "clear_board",
  "handoff_faculty",
]);

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; tool: string; args: Record<string, unknown>; result: { ok: boolean; message?: string; error?: string }; state?: QuizState }
  | { type: "state"; state: QuizState }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; message: string };

export type ToolAccessGuard = (args: {
  tool: string;
  args: Record<string, unknown>;
  agentSessionId: string;
}) => string | null;

export interface SendOpts {
  apiKey?: string | null;
  sessionToken: string;
  agentSessionId: string;
  faculty: string;
  /** Optional. If provided, appended as a user message before the model runs. */
  userMessage?: string;
  /** Optional. If provided, appended as a system note before the model runs.
   *  Use this to drive a teacher turn from a state event (channel-enter,
   *  answer-graded, etc.) without the student saying anything. */
  systemEventNote?: string;
  /** Override which teacher's system prompt is used. Defaults to `faculty`.
   *  Useful for lounge mode where 3 different teachers take turns within
   *  the same shared history bucket. */
  speakerFacultyId?: string;
  /** Override the chat-history bucket. Defaults to `faculty`. The lounge
   *  uses a shared "lounge" bucket so all three teachers see the same thread. */
  bucketKey?: string;
  /** Disable the blackboard tool surface for this turn (lounge mode, or
   *  scheduled class flow where the deterministic scheduler owns the board). */
  disableTools?: boolean;
  /** Manual practice/advance turns should post a question, not open a social/opinion round. */
  allowOpinionTool?: boolean;
  /** Append additional context to the system prompt for this turn. */
  extraSystemContext?: string;
  model?: string;
  maxTokens?: number;
  /** Optional turn guard. When true, generated text is not persisted and tools are not run. */
  isStale?: () => boolean;
  /** Optional server-side access guard for tool calls before mutation. */
  toolAccessGuard?: ToolAccessGuard;
}

/**
 * ChatService is the bridge from the viewer to OpenRouter.
 *  - Owns per-(cookie, faculty) chat history (in memory only).
 *  - Builds the system prompt + tool list per teacher.
 *  - Streams the OpenRouter response, dispatches tool calls into RubyHighService,
 *    feeds tool results back, and yields events for the SSE consumer.
 */
export class ChatService extends Service {
  static override readonly serviceType = "ruby-high-chat";
  override readonly capabilityDescription =
    "Routes chat between students and Ruby High teachers via OpenRouter, with tools that drive the chalkboard.";

  private readonly histories = new Map<string, ChatMessage[]>();
  /**
   * Tier B store: per-bucket append-only ring of room events. Compose
   * filters by `at > lastSpeakerAssistantAt(...)` so each turn's
   * synopsis covers exactly "what's happened in the room since I last
   * spoke." Keyed identically to histories so isolation matches.
   */
  private readonly events = new Map<string, RoomEvent[]>();
  private readonly npcOpinionKickoffs = new Map<string, Promise<void>>();
  private ruby: RubyHighService | null = null;

  static async start(runtime: IAgentRuntime): Promise<ChatService> {
    return new ChatService(runtime);
  }

  async stop(): Promise<void> {
    this.histories.clear();
    this.events.clear();
    this.npcOpinionKickoffs.clear();
  }

  setRubyHighService(ruby: RubyHighService): void {
    this.ruby = ruby;
  }

  requiresBrowserApiKey(agentSessionId: string, faculty: string): boolean {
    if (!this.ruby) return true;
    const state = this.ruby.getOrCreate(agentSessionId);
    const resolved = resolveFacultyIdForSession(state, faculty) ?? faculty;
    return providerRequiresBrowserKey(providerForFaculty(facultyByIdForSession(state, resolved)));
  }

  history(key: ChatHistoryKey): ChatMessage[] {
    return this.histories.get(this.keyOf(key)) ?? [];
  }

  resetHistory(key: ChatHistoryKey): void {
    this.histories.delete(this.keyOf(key));
    this.events.delete(this.keyOf(key));
  }

  /** Append a structured room event. Synopsised into the model's per-turn
   *  briefing — never persisted into the role-shaped chat history. */
  appendEvent(key: ChatHistoryKey, event: { kind: RoomEventKind; text: string; at?: number }): void {
    if (!event.text) return;
    const k = this.keyOf(key);
    let list = this.events.get(k);
    if (!list) {
      list = [];
      this.events.set(k, list);
    }
    list.push({ kind: event.kind, text: event.text, at: event.at ?? Date.now() });
    if (list.length > EVENT_LOG_LIMIT) {
      list.splice(0, list.length - EVENT_LOG_LIMIT);
    }
  }

  /** Convenience for the answer-noted event ("student picked X — correct"). */
  noteAnswer(key: ChatHistoryKey, note: string): void {
    this.appendEvent(key, { kind: "answer-noted", text: note });
  }

  /** Legacy convenience kept for the few callers that still hand-roll a
   *  generic system note. New code should prefer `appendEvent` with a
   *  typed kind so the synopsis can group/format intelligently. */
  appendSystemNote(key: ChatHistoryKey, note: string): void {
    this.appendEvent(key, { kind: "note", text: note });
  }

  appendPlayerMessage(key: ChatHistoryKey, text: string, at = Date.now()): void {
    const content = text.trim();
    if (!content) return;
    const history = this.ensure(key);
    history.push({ role: "user", content, faculty: key.faculty, at });
    this.trim(key);
  }

  events_for_test(key: ChatHistoryKey): RoomEvent[] {
    return this.roomEvents(key);
  }

  roomEvents(key: ChatHistoryKey): RoomEvent[] {
    return [...(this.events.get(this.keyOf(key)) ?? [])];
  }

  avatarPromptContext(opts: {
    sessionToken: string;
    agentSessionId: string;
    faculty: string;
    bucketKey?: string;
    historyLimit?: number;
    eventLimit?: number;
  }): AvatarPromptContext {
    if (!this.ruby) throw new Error("RubyHighService not bound to ChatService.");
    const state = this.ruby.getOrCreate(opts.agentSessionId);
    const rawBucketFaculty = opts.bucketKey ?? opts.faculty;
    const bucketFaculty = rawBucketFaculty === "lounge"
      ? rawBucketFaculty
      : (resolveFacultyIdForSession(state, rawBucketFaculty) ?? rawBucketFaculty);
    const activeFaculty = opts.faculty === "lounge"
      ? opts.faculty
      : (resolveFacultyIdForSession(state, opts.faculty) ?? opts.faculty);
    const key: ChatHistoryKey = { sessionToken: opts.sessionToken, faculty: bucketFaculty };
    const historyLimit = opts.historyLimit ?? 8;
    const eventLimit = opts.eventLimit ?? 8;
    const recentHistory = this.history(key)
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
      .slice(-historyLimit);
    const recentEvents = this.roomEvents(key)
      .filter((event) => event.text.trim().length > 0)
      .slice(-eventLimit);
    const bankStatus = activeFaculty === "lounge" ? null : this.ruby.questionBankStatus(opts.agentSessionId, activeFaculty);
    const dialogueLines = recentHistory.map((m) => formatDialogueLineForAvatar(state, m));
    const eventLines = recentEvents.map((event) => `  - ${clipForPrompt(event.text.trim(), 220)}`);
    return {
      roomBlock: describeRoomForAvatar(state),
      boardBlock: describeBoardForAvatar(state, bankStatus),
      recentEventsBlock: eventLines.length
        ? ["Recent visible room events (context only; do not imitate this format):", ...eventLines].join("\n")
        : "Recent visible room events: none.",
      dialogueBlock: dialogueLines.length
        ? ["Recent dialogue (context only; do not imitate this format):", ...dialogueLines].join("\n")
        : "Recent dialogue: none yet.",
      recentTexts: [
        ...recentHistory.map((m) => m.content.trim()),
        ...recentEvents.map((event) => event.text.trim()),
      ],
    };
  }

  async *send(opts: SendOpts): AsyncGenerator<ChatStreamEvent> {
    if (!this.ruby) throw new Error("RubyHighService not bound to ChatService.");
    const state = this.ruby.getOrCreate(opts.agentSessionId);
    const rawSpeakerId = opts.speakerFacultyId ?? opts.faculty;
    const speakerId = resolveFacultyIdForSession(state, rawSpeakerId) ?? rawSpeakerId;
    const rawBucketFaculty = opts.bucketKey ?? opts.faculty;
    const bucketFaculty = rawBucketFaculty === "lounge"
      ? rawBucketFaculty
      : (resolveFacultyIdForSession(state, rawBucketFaculty) ?? rawBucketFaculty);
    const activeFaculty = resolveFacultyIdForSession(state, opts.faculty) ?? opts.faculty;
    const teacher = teacherForSession(state, speakerId);
    const teacherProvider = providerForFaculty(facultyByIdForSession(state, speakerId));
    const teacherSupportsTools = providerSupportsTools(teacherProvider);
    const effectiveTeacher = teacherSupportsTools
      ? teacher
      : { ...teacher, systemPrompt: toolFreeTeacherPrompt(teacher.systemPrompt) };
    if (providerRequiresBrowserKey(teacherProvider) && !opts.apiKey) {
      yield { type: "error", message: "AI key required for this teacher." };
      return;
    }
    const key: ChatHistoryKey = { sessionToken: opts.sessionToken, faculty: bucketFaculty };
    const history = this.ensure(key);
    this.trim(key);

    // systemEventNote is the per-turn directive. It does NOT enter
    // `history` — it is threaded as the last system block before the
    // history when composing. This is the central change of the
    // Tier-A/B refactor: directives are turn-scoped, not persistent.
    // They evaporate after this send() returns.
    const turnDirective =
      opts.systemEventNote && opts.systemEventNote.trim().length > 0
        ? opts.systemEventNote.trim()
        : undefined;
    if (opts.userMessage && opts.userMessage.trim().length > 0) {
      history.push({ role: "user", content: opts.userMessage, faculty: bucketFaculty, at: Date.now() });
      this.trim(key);
    }
    if (history.length === 0 && !turnDirective) {
      // Nothing to say + nothing to react to + no directive — bail.
      // (Pre-refactor this could not happen because the directive was
      // pushed into history; now the check has to consider both.)
      yield { type: "done", finishReason: "no-input" };
      return;
    }
    const isStaleTurn = () => {
      try {
        return !!opts.isStale?.();
      } catch {
        return false;
      }
    };

    // Keep enough room for recovery flows: e.g. pick_from_bank fails because
    // a filter is dry, then the teacher writes a custom question. Once a tool
    // successfully puts a board state in place, the next round is narration-only
    // to preserve the old anti-repeat-pick guard.
    const toolsDisabledForProvider = !teacherSupportsTools;
    const effectiveTurnDirective = toolsDisabledForProvider && turnDirective
      ? toolFreeDirective(turnDirective)
      : turnDirective;
    const effectiveExtraSystemContext = toolsDisabledForProvider && opts.extraSystemContext
      ? stripBoardToolReferences(opts.extraSystemContext)
      : opts.extraSystemContext;
    let safety = opts.disableTools || toolsDisabledForProvider ? 1 : Math.max(2, MAX_AGENT_ROUNDS);
    let narrationOnlyNext = false;

    while (safety-- > 0) {
      const messages = this.composeForOpenRouter({
        teacher: effectiveTeacher,
        history,
        agentSessionId: opts.agentSessionId,
        bucketKey: key,
        speakerId,
        turnDirective: effectiveTurnDirective,
        extraSystemContext: effectiveExtraSystemContext,
        disableTools: !!opts.disableTools || toolsDisabledForProvider,
      });
      const liveStateBeforeCall = this.ruby.getOrCreate(opts.agentSessionId);
      const bankStatus = this.ruby.questionBankStatus(opts.agentSessionId, activeFaculty);
      const toolDefs = opts.disableTools || toolsDisabledForProvider || boardIsWaitingForStudent(liveStateBeforeCall)
        ? []
        : buildToolDefs({
            includePickFromBank: scheduledPickAvailable(bankStatus),
            includePoseOpinion: opts.allowOpinionTool !== false,
          });

      const body: OpenRouterRequest = {
        model: opts.model ?? teacher.defaultModel,
        messages,
        max_tokens: opts.maxTokens ?? 600,
      };
      const activeToolDefs = narrationOnlyNext ? [] : toolDefs;
      const activeToolNames = new Set(activeToolDefs.map(toolNameFromDef).filter((name): name is string => !!name));
      body.tools = activeToolDefs;
      if (activeToolDefs.length > 0) {
        body.tool_choice = "auto";
      }
      const stream = streamTeacherCompletion({
        provider: teacherProvider,
        browserApiKey: opts.apiKey,
        label: "chat-stream",
        body,
      });

      let assistantText = "";
      const assistantToolCalls: ToolCall[] = [];
      let finishReason: string | null = null;

      try {
        const visibleTextFilter = createInternalToolXmlFilter();
        for await (const chunk of stream) {
          if (chunk.kind === "text") {
            assistantText += chunk.text;
            const visibleText = visibleTextFilter.push(chunk.text);
            if (visibleText) yield { type: "delta", text: visibleText };
          } else if (chunk.kind === "tool-call") {
            assistantToolCalls.push(chunk.toolCall);
          } else if (chunk.kind === "finish") {
            finishReason = chunk.reason;
          }
        }
        const finalVisibleText = visibleTextFilter.flush();
        if (finalVisibleText) yield { type: "delta", text: finalVisibleText };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message };
        return;
      }

      if (isStaleTurn()) {
        yield { type: "done", finishReason: "stale-turn" };
        return;
      }

      const historyLenBeforeAssistant = history.length;
      const visibleAssistantText = stripInternalToolXml(assistantText);
      if (assistantToolCalls.length === 0 && visibleAssistantText.trim().length === 0) {
        yield { type: "done", finishReason: finishReason ?? "empty-response" };
        return;
      }
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: visibleAssistantText,
        toolCalls: assistantToolCalls.length ? assistantToolCalls : undefined,
        // Tag with the SPEAKER id so the lounge can attribute messages to the
        // right teacher when replaying history.
        faculty: speakerId,
        at: Date.now(),
      };
      history.push(assistantMessage);

      if (assistantToolCalls.length === 0) {
        this.trim(key);
        yield { type: "done", finishReason };
        return;
      }

      let handoffFired = false;
      let boardToolSucceeded = false;
      let boardPostAcceptedThisBatch = false;
      let staleRoomTurn = false;
      const toolEvents: ChatStreamEvent[] = [];
      for (const call of assistantToolCalls) {
        if (isStaleTurn()) {
          history.splice(historyLenBeforeAssistant);
          yield { type: "done", finishReason: "stale-turn" };
          return;
        }
        const liveState = this.ruby.getOrCreate(opts.agentSessionId);
        const liveFaculty = resolveFacultyIdForSession(liveState, liveState.faculty) ?? liveState.faculty;
        const turnStillOwnsRoom = liveFaculty === activeFaculty;
        const toolAllowed = activeToolNames.has(call.function.name);
        const parsedTool = parseToolArgs(call);
        const toolAccessError = parsedTool.error
          ? null
          : opts.toolAccessGuard?.({
              tool: call.function.name,
              args: parsedTool.args,
              agentSessionId: opts.agentSessionId,
            }) ?? null;
        const boardToolBlocked =
          turnStillOwnsRoom &&
          isBoardChangingTool(call.function.name) &&
          (boardPostAcceptedThisBatch || boardIsWaitingForStudent(liveState));
        const result = !turnStillOwnsRoom
          ? {
              args: {},
              payload: {
                ok: false,
                error: `Ignored stale ${speakerId} tool call; active classroom is now ${liveFaculty}.`,
              },
              state: liveState,
            }
          : !toolAllowed
            ? {
                args: {},
                payload: {
                  ok: false,
                  error: `Tool ${call.function.name} is not available this turn.`,
                },
                state: liveState,
              }
          : !!toolAccessError
            ? {
                args: parsedTool.args,
                payload: {
                  ok: false,
                  error: toolAccessError,
                },
                state: liveState,
              }
          : boardToolBlocked
            ? blockedBoardToolResult(
                call,
                liveState,
                boardPostAcceptedThisBatch
                  ? "Question already posted by this turn; wait for the student answer or timeout before changing it."
                  : "Question already on the board; wait for the student answer or timeout before changing it.",
              )
            : await this.dispatchTool(opts.agentSessionId, call);
        if (!turnStillOwnsRoom) staleRoomTurn = true;
        history.push({
          role: "tool",
          content: JSON.stringify(result.payload),
          toolCallId: call.id,
          faculty: opts.faculty,
          at: Date.now(),
        });
        toolEvents.push({
          type: "tool",
          tool: call.function.name,
          args: result.args,
          result: { ok: result.payload.ok, message: result.payload.message, error: result.payload.error },
          state: result.state ?? undefined,
        });
        if (call.function.name === "pose_opinion" && result.payload.ok && result.state && opts.apiKey) {
          void this.kickoffNpcOpinions(opts.apiKey, opts.agentSessionId);
        }
        if (call.function.name === "handoff_faculty" && result.payload.ok) {
          handoffFired = true;
        }
        if (result.payload.ok && toolShouldForceNarration(call.function.name) && result.state?.current) {
          boardToolSucceeded = true;
          boardPostAcceptedThisBatch = true;
        }
      }
      if (isStaleTurn()) {
        history.splice(historyLenBeforeAssistant);
        yield { type: "done", finishReason: "stale-turn" };
        return;
      }
      this.trim(key);
      for (const ev of toolEvents) yield ev;
      if (staleRoomTurn) {
        yield { type: "done", finishReason: "stale-room" };
        return;
      }
      // After handoff_faculty, stop the agent loop. The current speaker is no
      // longer the active faculty; further turns belong to the new teacher
      // and should be triggered by the next channel-enter event.
      if (handoffFired) {
        yield { type: "done", finishReason: "handoff" };
        return;
      }
      narrationOnlyNext = boardToolSucceeded;
    }

    yield { type: "error", message: "Tool-call loop exceeded safety bound — stopping." };
  }

  /**
   * Compose the OpenRouter message stack. The block ordering encodes the
   * Tier-A/B separation:
   *
   *   1. WHO YOU ARE        — teacher.systemPrompt (static character card)
   *   2. WHO'S IN THE ROOM  — describeRoomForTeacher(state)  [recomputed]
   *   3. WHAT'S ON THE BOARD— describeBoardForModel(state)   [recomputed]
   *   4. RECENT EVENTS      — synopsis of room events since this speaker
   *                           last spoke. Replaces the ad-hoc system-notes
   *                           that used to litter history.
   *   5. THIS TURN          — the per-turn directive. Last thing the model
   *                           reads before its conversational context.
   *   6. ...history         — user / assistant / tool ONLY. System messages
   *                           are filtered out: under the new architecture
   *                           they should never have been there, but legacy
   *                           in-memory state from before the switchover
   *                           might still carry some.
   */
  private composeForOpenRouter(args: {
    teacher: TeacherCharacter;
    history: ChatMessage[];
    agentSessionId: string;
    bucketKey: ChatHistoryKey;
    speakerId: string;
    turnDirective?: string;
    extraSystemContext?: string;
    disableTools?: boolean;
  }): unknown[] {
    const { teacher, history, agentSessionId, bucketKey, speakerId, turnDirective, extraSystemContext, disableTools } = args;
    const messages: unknown[] = [{ role: "system", content: teacher.systemPrompt }];
    const state = this.ruby!.getOrCreate(agentSessionId);
    // 2. Room.
    const groupBlock = describeRoomForTeacher(state);
    if (groupBlock) {
      messages.push({ role: "system", content: groupBlock });
    }
    // 3. Board. Keep the board visible to the teacher even when tools are
    // disabled so narration-only turns can still explain the live question.
    const bankStatus = this.ruby!.questionBankStatus(agentSessionId, state.faculty);
    const ctx = describeBoardForModel(state, bankStatus);
    messages.push({ role: "system", content: `Active board context for this turn:\n${ctx}` });
    if (!disableTools) {
      messages.push({ role: "system", content: describeQuestionBankForModel(bankStatus) });
    }
    // 4. RECENT EVENTS synopsis — events newer than this speaker's last
    //    assistant turn. Floor at 0 so the very first turn includes the
    //    full event log.
    const since = lastAssistantAtForSpeaker(history, speakerId);
    const eventLog = this.events.get(this.keyOf(bucketKey)) ?? [];
    const recent = eventLog.filter((e) => e.at > since);
    if (recent.length > 0) {
      const synopsis = ["RECENT EVENTS in the room since your last turn:", ...recent.map((e) => `  - ${e.text}`)].join("\n");
      messages.push({ role: "system", content: synopsis });
    }
    // 5. extraSystemContext — caller-supplied one-shot. Sits between the
    //    synopsis and the directive on purpose: it's contextual framing,
    //    not an action instruction.
    if (extraSystemContext) {
      messages.push({ role: "system", content: extraSystemContext });
    }
    // 6. THIS TURN directive — the action ask, last thing the model sees
    //    before history. Phrased as a fresh imperative every turn so the
    //    model can't read a stale one out of past history.
    if (turnDirective) {
      messages.push({ role: "system", content: `THIS TURN — ${turnDirective}` });
    }
    // 7. Conversational history, dialogue-only.
    for (const m of history) {
      if (m.role === "system") continue;
      messages.push(toOpenRouterMessage(m));
    }
    return messages;
  }

  /** Kick off the 2 NPC-in-room opinion responses in parallel after a
   *  pose_opinion tool fires. Records each into the round as it completes. */
  async kickoffNpcOpinions(apiKey: string, agentSessionId: string): Promise<void> {
    if (!this.ruby) return;
    const state = this.ruby.getOrCreate(agentSessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return;
    const q = state.current;
    if (!q) return;
    const kickoffKey = `${agentSessionId}:${round.questionId}`;
    const existing = this.npcOpinionKickoffs.get(kickoffKey);
    if (existing) return existing;
    const responded = new Set(round.opinionResponses.map((r) => r.responder));
    const missingNpcs = round.npcs.filter((entry) => !responded.has(entry.studentId));
    if (missingNpcs.length === 0) return;

    const grade = state.currentGrade;
    const facultyId = state.faculty;
    const playerName = "the player"; // could thread real name through later
    const npcsInRound = round.npcs.map((n) => n.studentId);
    const classmates = npcsInRound
      .map((id) => STUDENTS[id])
      .filter((s): s is StudentCharacter => !!s);

    // Resolve each NPC's character + stats from the roster.
    const roster = grade ? state.npcRosters[grade] ?? [] : [];

    const kickoff = (async () => {
      const tasks = missingNpcs.map(async (entry) => {
        const student = STUDENTS[entry.studentId];
        if (!student) return;
        const rosterRow = roster.find((r) => r.id === entry.studentId);
        const stats = rosterRow?.stats ?? { head: 0, heart: 0, hustle: 0, honor: 0 };
        try {
          const text = await callOpinionForNpc({
            apiKey,
            student,
            stats,
            teacherId: facultyId,
            classmates,
            playerName,
            grade,
            question: q.prompt,
            rubric: q.rubric,
          });
          // Record. The recordOpinion in ruby-high-service is a no-op if the
          // round already moved on, so a slow response after grading is harmless.
          this.ruby!.recordOpinion(agentSessionId, entry.studentId, text);
        } catch {
          // Fall back to a placeholder so grading can still proceed.
          this.ruby!.recordOpinion(agentSessionId, entry.studentId, "(...thinking, couldn't get the words out.)");
        }
      });
      await Promise.allSettled(tasks);
      await this.ruby?.flushSession(agentSessionId).catch(() => undefined);
    })();
    this.npcOpinionKickoffs.set(kickoffKey, kickoff);
    try {
      await kickoff;
    } finally {
      if (this.npcOpinionKickoffs.get(kickoffKey) === kickoff) {
        this.npcOpinionKickoffs.delete(kickoffKey);
      }
    }
  }

  private async dispatchTool(
    agentSessionId: string,
    call: ToolCall,
  ): Promise<ToolDispatchResult> {
    const ruby = this.ruby!;
    const parsed = parseToolArgs(call);
    if (parsed.error) {
      return {
        args: {},
        payload: { ok: false, error: parsed.error },
      };
    }
    const args = parsed.args;

    try {
      switch (call.function.name) {
        case "pose_question": {
          const state = ruby.pose(agentSessionId, {
            prompt: String(args.prompt ?? ""),
            options: {
              A: String((args.options as Record<string, unknown> | undefined)?.A ?? ""),
              B: String((args.options as Record<string, unknown> | undefined)?.B ?? ""),
              C: String((args.options as Record<string, unknown> | undefined)?.C ?? ""),
              D: String((args.options as Record<string, unknown> | undefined)?.D ?? ""),
            },
            correct: String(args.correct ?? "").toUpperCase() as Choice,
            explanation: args.explanation ? String(args.explanation) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            stat: args.stat ? String(args.stat) as keyof CharacterStats : undefined,
            difficulty: args.difficulty as Difficulty | undefined,
            faculty: args.faculty ? String(args.faculty) : undefined,
            persistToBank: true,
          });
          await ruby.flushSession(agentSessionId);
          return { args, payload: { ok: true, message: "Question posted." }, state };
        }
        case "pick_from_bank": {
          const state = ruby.pickAndPose(agentSessionId, {
            faculty: args.faculty ? String(args.faculty) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            difficulty: args.difficulty as Difficulty | undefined,
          });
          await ruby.flushSession(agentSessionId);
          const q = state.current;
          // Minimal payload. The "no tools on iteration 2" guard makes
          // it impossible for the model to re-pick from this position,
          // so the only remaining job of this message is to confirm
          // success. The fresh BOARD block on the next iteration carries
          // the new question content; we don't need to echo it here.
          return {
            args,
            payload: {
              ok: true,
              message: q ? "Done." : "Bank is empty for that filter. Try a different subject.",
            },
            state,
          };
        }
        case "pose_opinion": {
          const state = ruby.poseOpinion(agentSessionId, {
            prompt: String(args.prompt ?? ""),
            rubric: args.rubric ? String(args.rubric) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            faculty: args.faculty ? String(args.faculty) : undefined,
          });
          await ruby.flushSession(agentSessionId);
          return {
            args,
            payload: { ok: true, message: `Opinion question on the board: ${state.current?.prompt ?? ""}` },
            state,
          };
        }
        case "clear_board": {
          const state = ruby.clearBoard(agentSessionId);
          await ruby.flushSession(agentSessionId);
          return { args, payload: { ok: true, message: "Cleared." }, state };
        }
        case "handoff_faculty": {
          const facultyId = String(args.faculty ?? "");
          const state = ruby.setFaculty(agentSessionId, facultyId);
          await ruby.flushSession(agentSessionId);
          return { args, payload: { ok: true, message: `Handed off to ${state.faculty}.` }, state };
        }
        default:
          return { args, payload: { ok: false, error: `Unknown tool: ${call.function.name}` } };
      }
    } catch (err) {
      return { args, payload: { ok: false, error: err instanceof Error ? err.message : String(err) } };
    }
  }

  private ensure(key: ChatHistoryKey): ChatMessage[] {
    const k = this.keyOf(key);
    let list = this.histories.get(k);
    if (!list) {
      list = [];
      this.histories.set(k, list);
    }
    return list;
  }

  private trim(key: ChatHistoryKey): void {
    const k = this.keyOf(key);
    const list = this.histories.get(k);
    if (!list) return;
    const next = normalizeHistoryForProvider(list, HISTORY_LIMIT);
    // Preserve the array identity returned by ensure(). send() holds that
    // reference while it is appending the current turn; replacing the map
    // value here would make later pushes land on a detached array.
    list.splice(0, list.length, ...next);
  }

  private keyOf(key: ChatHistoryKey): string {
    return `${key.sessionToken}::${key.faculty}`;
  }
}

function normalizeHistoryForProvider(list: ChatMessage[], limit: number): ChatMessage[] {
  const groups = providerSafeHistoryGroups(list);
  const kept: ChatMessage[][] = [];
  let count = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    if (kept.length > 0 && count + group.length > limit) break;
    kept.push(group);
    count += group.length;
  }
  return kept.reverse().flat();
}

function providerSafeHistoryGroups(list: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (let i = 0; i < list.length;) {
    const m = list[i]!;
    if (m.role === "system" || m.role === "tool") {
      i++;
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const callIds = m.toolCalls.map((tc) => tc.id).filter(Boolean);
      const allCallsHaveIds = callIds.length === m.toolCalls.length;
      const expected = new Set(callIds);
      const toolsById = new Map<string, ChatMessage>();
      let scan = i + 1;
      while (scan < list.length && list[scan]!.role === "tool") {
        const tool = list[scan]!;
        if (tool.toolCallId && expected.has(tool.toolCallId) && !toolsById.has(tool.toolCallId)) {
          toolsById.set(tool.toolCallId, tool);
        }
        scan++;
      }

      if (allCallsHaveIds && expected.size === m.toolCalls.length && toolsById.size === expected.size) {
        groups.push([m, ...callIds.map((id) => toolsById.get(id)!)]);
      }
      i = scan;
      continue;
    }

    groups.push([m]);
    i++;
  }
  return groups;
}

function toolShouldForceNarration(name: string): boolean {
  return name === "pick_from_bank"
    || name === "pose_question"
    || name === "pose_opinion";
}

function isBoardChangingTool(name: string): boolean {
  return name === "pick_from_bank"
    || name === "pose_question"
    || name === "pose_opinion"
    || name === "clear_board";
}

function boardIsWaitingForStudent(state: QuizState): boolean {
  return !!state.current && !!state.activeRound && !state.activeRound.resolved;
}

function scheduledPickAvailable(status: QuestionBankStatus): boolean {
  return typeof status.canPick === "boolean" ? status.canPick : status.remaining > 0;
}

function parseToolArgs(call: ToolCall): { args: Record<string, unknown>; error?: string } {
  try {
    return { args: call.function.arguments ? JSON.parse(call.function.arguments) : {} };
  } catch (err) {
    return { args: {}, error: `Bad tool arguments JSON: ${(err as Error).message}` };
  }
}

function blockedBoardToolResult(call: ToolCall, state: QuizState, error: string): ToolDispatchResult {
  const parsed = parseToolArgs(call);
  return {
    args: parsed.args,
    payload: { ok: false, error: parsed.error ?? error },
    state,
  };
}

function readAgentRoundLimit(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_AGENT_ROUNDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_AGENT_ROUNDS;
  return Math.max(2, Math.floor(n));
}

/** One-shot text LLM call asking an NPC to write an opinion in their voice
 *  with full social context (their teacher, their classmates, their stats). */
async function callOpinionForNpc(args: {
  apiKey: string;
  student: StudentCharacter;
  stats: { head: number; heart: number; hustle: number; honor: number };
  teacherId: string | null;
  classmates: StudentCharacter[];
  playerName: string;
  grade: string | null;
  question: string;
  rubric?: string;
}): Promise<string> {
  const teacher = args.teacherId ? teacherById(args.teacherId) : null;
  const teacherLine = teacher
    ? `Class: ${teacher.displayName} (${args.teacherId === "ruby" ? "homeroom" : args.teacherId === "sally-science" ? "science" : args.teacherId === "professor-edward" ? "literature" : args.teacherId}).`
    : "Class: independent.";
  const classmateLines = args.classmates
    .filter((c) => c.id !== args.student.id)
    .map((c) => `- ${c.name}: ${shortVibe(c.id)}`)
    .join("\n");
  const stats = args.stats;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const userPrompt = [
    `You are ${args.student.name}, a ${args.grade ? (GRADE_LABELS as Record<string, string>)[args.grade] ?? args.grade : "junior"} at Ruby High.`,
    teacherLine,
    `Stats — HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}. Your higher stats shape what you notice.`,
    `Classmates with you in the room:`,
    classmateLines || "- (empty)",
    `Player at the next desk: ${args.playerName}.`,
    "",
    `Teacher's question: ${args.question}`,
    args.rubric ? `Rubric the teacher cares about: ${args.rubric}` : "",
    "",
    "Write 2-3 sentences in your voice (under 60 words). Specific, with an opinion, engaging the question. Reference a classmate or the teacher by name when it fits. The response is the answer itself — just the prose, nothing wrapping it.",
  ].filter(Boolean).join("\n");

  const r = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    body: {
      model: resolveStudentModel(),
      messages: [
        { role: "system", content: args.student.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.95,
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "opinion-npc");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  return ((body.choices?.[0]?.message?.content ?? "").trim()).replace(/^["'\s]+|["'\s]+$/g, "");
}

function teacherForSession(state: QuizState, speakerId: string): TeacherCharacter {
  const packFaculty = facultyByIdForSession(state, speakerId);
  if (!packFaculty) return teacherById(speakerId);
  return {
    id: packFaculty.id,
    displayName: packFaculty.displayName,
    shortName: packFaculty.shortName,
    defaultModel: packFaculty.defaultModel,
    systemPrompt: packFaculty.systemPrompt,
  };
}

function shortVibe(id: string): string {
  switch (id) {
    case "lyra": return "anxious overachiever";
    case "sami": return "dry, sarcastic, deeply chill";
    case "ravi": return "loud, drops obscure facts";
    case "indra": return "quiet sniper, drops one perfect line";
    case "mika": return "bright supportive jock energy";
    case "noor": return "deadpan one-liner master";
    default: return "classmate";
  }
}

// One-line voice/vibe per NPC, used to give teachers + classmates a hint
// of who else is in the room without dumping each character's full system
// prompt into every turn.
const STUDENT_VIBES: Record<string, string> = {
  lyra:  "anxious overachiever",
  sami:  "dry, sarcastic, deeply chill",
  ravi:  "loud, enthusiastic, drops obscure facts",
  indra: "quiet, observant, drops one perfect line",
  mika:  "supportive himbo energy, hypes the room",
  noor:  "deadpan, master of the one-liner",
};

function npcRoomDescriptor(npc: NpcStudentState): string {
  const s = STUDENTS[npc.id];
  const name = s?.name ?? npc.id;
  const vibe = STUDENT_VIBES[npc.id];
  return vibe ? `${name} (${vibe})` : name;
}

function clipForPrompt(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function facultyDisplayNameForPrompt(state: QuizState, facultyId?: string): string {
  const id = facultyId || state.faculty || "ruby";
  if (id === "lounge") return "the lounge";
  const packFaculty = facultyByIdForSession(state, id);
  if (packFaculty) return packFaculty.displayName;
  try {
    return teacherById(id).displayName;
  } catch {
    return id.replace(/-/g, " ");
  }
}

function formatDialogueLineForAvatar(state: QuizState, message: ChatMessage): string {
  const speaker = message.role === "user"
    ? (state.character?.name ?? "Player avatar")
    : facultyDisplayNameForPrompt(state, message.faculty);
  const verb = message.role === "user" ? "said" : "replied";
  return `  - ${speaker} ${verb} "${clipForPrompt(message.content.trim(), 180)}"`;
}

/** Find the timestamp of the most recent assistant message belonging to
 *  this speaker. Used to scope the RECENT EVENTS synopsis to "what's
 *  happened since I last spoke." Returns 0 if the speaker has not yet
 *  spoken in this bucket — the synopsis then includes the full event
 *  log, which is the desired behavior for a first-turn briefing.
 *
 *  Why per-speaker rather than per-bucket: the lounge bucket is shared
 *  across three teachers, each speaking in turn. From Sally's POV, the
 *  events "since I last spoke" should include things Edward said after
 *  her — not just things since the last lounge utterance regardless of
 *  speaker. Scoping by speaker preserves that invariant in classroom
 *  buckets too (only one speaker, so per-speaker = per-bucket). */
function lastAssistantAtForSpeaker(history: ChatMessage[], speakerId: string): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === "assistant" && m.faculty === speakerId) return m.at;
  }
  return 0;
}

function describeRoomForAvatar(state: QuizState): string {
  if (!state.character) return "Room scene context: no player avatar has been created yet.";
  const c = state.character;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const lines: string[] = [];
  lines.push("Room scene context: Ruby High group chat, not a 1:1 chatbot.");
  const room = roomForFacultyForSession(state, state.faculty);
  if (room && room.teaches && state.currentGrade) {
    const roster = state.npcRosters[state.currentGrade] ?? [];
    const inRoom = npcsInRoom(roster, room.id as TeachingRoomId);
    if (inRoom.length) {
      lines.push("Classmates currently in the room:");
      for (const npc of inRoom) lines.push(`  - ${npcRoomDescriptor(npc)}`);
    }
  }
  lines.push(`Player avatar: ${c.name}.`);
  lines.push(`  Personality: ${c.personality}`);
  lines.push(`  Stats: HEAD ${fmt(c.stats.head)}, HEART ${fmt(c.stats.heart)}, HUSTLE ${fmt(c.stats.hustle)}, HONOR ${fmt(c.stats.honor)}.`);
  if (c.arcAnswer) lines.push(`  Private arc answer: "${c.arcAnswer}".`);
  const relationshipLines = describeRelationshipStateForTeacher(state);
  if (relationshipLines.length > 0) lines.push(...relationshipLines);
  lines.push("Treat teachers, the player avatar, and classmates as separate people in the same room.");
  return lines.join("\n");
}

/** Room-scene framing for the teacher: who's in the room. The player and
 *  the seated NPCs (the classmates whose dice rolled alongside the player
 *  on the last question) get named. Tells the teacher: "you're running a
 *  class scene, not tutoring." Without this the model defaults to 1:1 framing
 *  and either ignores the NPCs or invents new ones. */
function describeRoomForTeacher(state: QuizState): string {
  if (!state.character) return "";
  const c = state.character;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const lines: string[] = [];
  lines.push(`You are running a room scene with avatars — not a 1:1 chatbot or tutoring chat.`);
  // Classmate roster (the seated NPCs in the active classroom).
  const room = roomForFacultyForSession(state, state.faculty);
  if (room && room.teaches && state.currentGrade) {
    const roster = state.npcRosters[state.currentGrade] ?? [];
    const inRoom = npcsInRoom(roster, room.id as TeachingRoomId);
    if (inRoom.length) {
      lines.push(`Other students in the room with you right now:`);
      for (const npc of inRoom) lines.push(`  - ${npcRoomDescriptor(npc)}`);
    }
  }
  // The player is just one of the students — but the one whose roll the
  // teacher's reactions hinge on. Name them, give a brief sketch, and
  // make explicit that they're a person, not a "user."
  lines.push(`The PLAYER in this room is ${c.name}.`);
  lines.push(`  Personality: ${c.personality}`);
  lines.push(`  Stats: HEAD ${fmt(c.stats.head)}, HEART ${fmt(c.stats.heart)}, HUSTLE ${fmt(c.stats.hustle)}, HONOR ${fmt(c.stats.honor)}.`);
  if (c.arcAnswer) lines.push(`  Their arc answer: "${c.arcAnswer}".`);
  const relationshipLines = describeRelationshipStateForTeacher(state);
  if (relationshipLines.length > 0) lines.push(...relationshipLines);
  lines.push(`Address whoever just acted by name. ${c.name.split(" ")[0] ?? c.name} is the player; the others are AI classmates but treat them as real students in the room.`);
  return lines.join("\n");
}

function describeRelationshipStateForTeacher(state: QuizState): string[] {
  const card = state.character?.mashCard;
  if (!card?.cells) return [];
  const lines: string[] = [];
  const room = roomForFacultyForSession(state, state.faculty);
  const roster = state.currentGrade ? (state.npcRosters[state.currentGrade] ?? []) : [];
  const inRoom = room && room.teaches
    ? npcsInRoom(roster, room.id as TeachingRoomId).map((npc) => npc.id)
    : [];
  const ids = inRoom.length > 0 ? inRoom : Object.keys(card.cells);
  const cellLines = ids
    .map((id) => ({ id, cell: card.cells[id] }))
    .filter((entry) => !!entry.cell)
    .map(({ id, cell }) => {
      const status = cell!.scratched
        ? "scratched"
        : cell!.circled
          ? "circled"
          : cell!.affinity > 0
            ? "warm"
            : cell!.affinity < 0
              ? "strained"
              : "neutral";
      return `  - ${studentNameFor(id)}: affinity ${formatSigned(cell!.affinity)} (${status})`;
    });
  if (cellLines.length > 0) {
    lines.push("Social relationship state for this room (engine-owned facts; react to them, do not change them):");
    lines.push(...cellLines);
  }

  const recent = (Array.isArray(state.schoolEvents) ? state.schoolEvents : [])
    .filter((event) => event.kind === "relationship.ticked" || event.kind === "mash.axis-resolved")
    .slice(-5);
  if (recent.length > 0) {
    lines.push("Recent durable school events:");
    for (const event of recent) {
      const line = formatSchoolEventForTeacher(event);
      if (line) lines.push(`  - ${line}`);
    }
  }
  return lines;
}

function formatSchoolEventForTeacher(event: NonNullable<QuizState["schoolEvents"]>[number]): string {
  if (event.kind === "relationship.ticked") {
    const name = studentNameFor(event.studentId);
    const reason = event.reason === "best-responder"
      ? "teacher picked them as best responder"
      : event.reason === "applauder"
        ? "they applauded the player's essay"
        : event.reason === "pep-talk"
          ? "Heart pep-talk prevented a relationship hit"
          : "the essay rubbed them wrong";
    const state = event.scratched ? ", now scratched" : event.circled ? ", now circled" : "";
    return `${name} relationship ${formatSigned(event.delta)} to ${formatSigned(event.affinity)} (${reason}${state}).`;
  }
  if (event.kind === "mash.axis-resolved") {
    return `${event.axis} resolved through ${studentNameFor(event.studentId)}: ${event.value}.`;
  }
  return "";
}

function studentNameFor(id: string): string {
  return STUDENTS[id]?.shortName ?? id;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatBoardPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "unknown";
}

function describeClassReportBoardForModel(status: QuestionBankStatus): string | null {
  const today = status.todayClass;
  if (today?.status !== "complete") return null;
  const completed = status.completedClasses ?? 0;
  const required = status.requiredClasses ?? 0;
  return [
    "BOARD STATUS: CLASS_REPORT.",
    `The chalkboard is showing today's ${status.displayName} class report card, not a live question.`,
    "Today's graded class is complete.",
    today.letterGrade ? `Final grade shown: ${today.letterGrade}.` : "",
    typeof today.score === "number" ? `Today score shown: ${formatBoardPercent(today.score)}.` : "",
    status.courseGrade ? `Subject grade shown: ${status.courseGrade}.` : "",
    required > 0 ? `Subject progress shown: ${completed}/${required} daily classes passed.` : "",
    "Practice is open after this report; a fresh board should appear only when the engine or allowed tool flow advances.",
  ].filter(Boolean).join("\n");
}

function describeClassReportBoardForAvatar(status: QuestionBankStatus): string | null {
  const today = status.todayClass;
  if (today?.status !== "complete") return null;
  const completed = status.completedClasses ?? 0;
  const required = status.requiredClasses ?? 0;
  return [
    `Visible board: class report card for ${status.displayName}.`,
    "Today's graded class is complete.",
    today.letterGrade ? `Final grade shown: ${today.letterGrade}.` : "",
    typeof today.score === "number" ? `Today score shown: ${formatBoardPercent(today.score)}.` : "",
    status.courseGrade ? `Course grade shown: ${status.courseGrade}.` : "",
    required > 0 ? `Course progress shown: ${completed}/${required} completed classes.` : "",
    "The report card says practice is open; there is no live challenge on the board yet.",
  ].filter(Boolean).join("\n");
}

function describeBoardForAvatar(state: QuizState, bankStatus?: QuestionBankStatus | null): string {
  const q = state.current;
  const reveal = state.lastReveal;
  if (q) {
    const resolvedThisQ =
      !!state.activeRound && state.activeRound.questionId === q.id && state.activeRound.resolved &&
      !!reveal && reveal.questionId === q.id;
    if (resolvedThisQ && reveal) {
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
        reveal.questionPrompt ? `Question: ${reveal.questionPrompt}` : `Question: ${q.prompt}`,
        correct,
        reveal.explanation ? `Explanation shown on board: ${reveal.explanation}` : "",
      ].filter(Boolean).join("\n");
    }
    if (q.type === "opinion") {
      return [
        "Visible board: open free-response challenge.",
        `Prompt: ${q.prompt}`,
        q.rubric ? `Rubric shown: ${q.rubric}` : "",
      ].filter(Boolean).join("\n");
    }
    const optionLines = q.type === "multiple-choice" && q.options
      ? Object.entries(q.options).map(([k, v]) => `  ${k}) ${v}`)
      : [];
    return [
      q.type === "typed-answer" || q.type === "image-occlusion"
        ? "Visible board: typed-response challenge."
        : "Visible board: multiple-choice challenge.",
      `Prompt: ${q.prompt}`,
      ...optionLines,
      "Hidden from the player right now: the correct answer.",
    ].join("\n");
  }

  const classReport = bankStatus ? describeClassReportBoardForAvatar(bankStatus) : null;
  if (classReport) return classReport;

  if (reveal) {
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

  return state.phase === "lounge"
    ? "Visible board: none. This is a lounge conversation."
    : "Visible board: empty. The room is between challenges.";
}

function describeBoardForModel(state: QuizState, bankStatus?: QuestionBankStatus | null): string {
  const meritStars = Math.max(0, Math.floor(Number(state.wallet?.meritStars ?? state.score.points ?? 0)));
  const scoreLine = `${state.score.correct}/${state.score.total} answers · ${meritStars} Merit Stars`;
  const header = [
    `Active faculty: ${state.faculty}.`,
    `Session progress: ${scoreLine}.`,
  ];
  // Senior arc complete — ceremony done, diploma issued. The chalkboard
  // renders a graduated state with no question.
  if (state.character && Array.isArray(state.character.yearbook) && state.character.yearbook.length >= 4) {
    return [
      ...header,
      "BOARD STATUS: ARC_COMPLETE.",
      "The player has graduated; Senior is sealed and the diploma is on the chalkboard. There are no more questions this run.",
    ].join("\n");
  }
  // Year cleared, ceremony pending. The chalkboard renders a ceremony
  // panel and the player is selecting a reward on their School Career card.
  if (state.character?.pendingGraduation) {
    return [
      ...header,
      "BOARD STATUS: GRADUATION_CEREMONY.",
      "The player cleared the year's gates and is selecting a ceremony reward on their School Career card. The chalkboard is showing the ceremony, not a question.",
    ].join("\n");
  }
  if (!state.current) {
    const classReport = bankStatus ? describeClassReportBoardForModel(bankStatus) : null;
    if (classReport) {
      return [
        ...header,
        classReport,
      ].join("\n");
    }

    const reveal = state.lastReveal;
    if (reveal?.questionPrompt) {
      const opts = reveal.questionOptions;
      const answerLines = opts
        ? [
            `  A) ${opts.A ?? ""}`,
            `  B) ${opts.B ?? ""}`,
            `  C) ${opts.C ?? ""}`,
            `  D) ${opts.D ?? ""}`,
            `Correct answer: ${reveal.correct}) ${opts[reveal.correct] ?? ""}.`,
          ]
        : [
            reveal.expectedAnswer ? `Expected answer: ${reveal.expectedAnswer}` : `Correct answer: ${reveal.correct}.`,
          ];
      return [
        ...header,
        "BOARD STATUS: RECENTLY_RESOLVED.",
        "No live question is on the board now, but the last resolved card is still relevant for this turn.",
        reveal.forfeit
          ? "The player did not answer before the timer expired."
          : `The player answered ${reveal.answerText ?? reveal.picked} and was ${reveal.wasCorrect ? "correct" : "wrong"}.`,
        `Resolved question (${reveal.questionDifficulty ?? "?"} · ${reveal.questionSubject ?? "?"}):`,
        `  ${reveal.questionPrompt}`,
        ...answerLines,
        reveal.explanation ? `Explanation: ${reveal.explanation}` : "",
      ].filter(Boolean).join("\n");
    }
    return [
      ...header,
      "BOARD STATUS: EMPTY.",
      "No question is on the board. The question scheduler auto-posts the next one when appropriate; you'll be fired again once the player engages with it.",
    ].join("\n");
  }
  const q = state.current;
  if (q.type === "opinion") {
    return [
      ...header,
      "BOARD STATUS: OPINION_PENDING.",
      "An OPINION question is on the board. The player is writing a free-form response; the system will call you back to grade.",
      `Question: ${q.prompt}`,
      q.rubric ? `Rubric: ${q.rubric}` : "",
    ].filter(Boolean).join("\n");
  }
  const opts = q.options ?? state.lastReveal?.questionOptions ?? { A: "", B: "", C: "", D: "" };
  // Only describe the reveal when it belongs to the question currently on
  // the board. After a resolve, a fresh question can land before this is
  // re-read — in that case .current is the new question and lastReveal
  // points at the previous one; the WAITING branch is correct.
  const round = state.activeRound;
  // A round may have expired on the clock but not yet been resolved by the
  // server tick. Treat clock-expired rounds as timed out so the AI doesn't
  // tell students to keep waiting.
  const clockExpired = !!round && round.questionId === q.id && !round.resolved &&
    !!round.expiresAt && Date.now() >= round.expiresAt;
  const resolvedThisQ =
    !!round && round.questionId === q.id && round.resolved &&
    !!state.lastReveal && state.lastReveal.questionId === q.id;
  const statusLines = resolvedThisQ && state.lastReveal
    ? [
        "BOARD STATUS: RESOLVED.",
        state.lastReveal.forfeit
          ? `The timer expired before the player answered; correct was ${state.lastReveal.correct}.`
          : `The player answered ${state.lastReveal.picked} and was ${state.lastReveal.wasCorrect ? "correct" : "wrong; correct was " + state.lastReveal.correct}.`,
        "The question scheduler will auto-post the next question when the board clears; you'll be fired again at that point.",
      ]
    : clockExpired
    ? [
        "BOARD STATUS: TIMED_OUT.",
        "The timer has expired. No student answered in time. The round is being resolved server-side.",
      ]
    : [
        "BOARD STATUS: WAITING_FOR_STUDENT_ANSWER.",
        "The player has not answered this board yet. Do not reveal the correct answer. Wait for the answer-graded event before calling another tool.",
      ];
  const answerLines = q.type === "typed-answer" || q.type === "image-occlusion"
    ? resolvedThisQ && state.lastReveal
      ? [
          state.lastReveal.answerText ? `Player typed: ${state.lastReveal.answerText}` : "",
          state.lastReveal.expectedAnswer ? `Expected answer: ${state.lastReveal.expectedAnswer}` : "",
        ].filter(Boolean)
      : ["Expected answer: hidden until reveal."]
    : [
        `  A) ${opts.A}`,
        `  B) ${opts.B}`,
        `  C) ${opts.C}`,
        `  D) ${opts.D}`,
        `Correct answer: ${q.correct ?? "?"}.`,
      ];
  return [
    ...header,
    ...statusLines,
    `Current question on the blackboard (${q.difficulty ?? "?"} · ${q.subject ?? "?"}):`,
    `  ${q.prompt}`,
    ...answerLines,
  ].join("\n");
}

function describeQuestionBankForModel(status: QuestionBankStatus): string {
  const classLine = status.todayClass
    ? status.todayClass.status === "complete"
      ? `Today's graded class is complete${status.todayClass.letterGrade ? `: ${status.todayClass.letterGrade}` : ""}. Further boards are practice.`
      : status.todayClass.status === "active"
        ? `Today's graded class is in progress: ${status.todayClass.questionCount}/${status.todayClass.totalQuestions}; practice cards ${status.todayClass.practiceCount ?? 0}, reflection prompts ${status.todayClass.socialCount ?? 0}.`
        : `Today's graded class is available: ${status.todayClass.questionCount}/${status.todayClass.totalQuestions}; practice and reflection prompts may appear before class cards.`
    : "Today's class status is unavailable.";
  const standing = status.courseGrade
    ? `Subject standing: ${status.courseGrade} (${status.completedClasses ?? 0}/${status.requiredClasses ?? 0} daily classes passed).`
    : `Subject standing: no course grade yet (${status.completedClasses ?? 0}/${status.requiredClasses ?? 0} daily classes passed).`;
  if (status.mode === "srs") {
    const mastered = status.masteredCount ?? 0;
    const shaky = status.shakyCount ?? 0;
    const learning = status.learningCount ?? 0;
    if (!scheduledPickAvailable(status)) {
      return [
        `SUBJECT STATUS for ${status.displayName}. ${standing} ${classLine}`,
        `Scheduler detail: no deck card is due right now (${mastered}/${status.total} learned, ${shaky} shaky, ${learning} learning).`,
        "pick_from_bank is not available this turn. Do not say the deck is exhausted, dry, depleted, or used up.",
        "If the room needs a board, either speak briefly about progress or call pose_question exactly once for a custom challenge.",
      ].join("\n");
    }
    const subjects = Object.entries(status.remainingBySubject)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([subject, count]) => `${subject}:${count}`)
      .join(", ");
    return [
      `SUBJECT STATUS for ${status.displayName}. ${standing} ${classLine}`,
      `Scheduler detail: deck material is available (${mastered}/${status.total} learned, ${shaky} shaky).`,
      subjects ? `Available subjects: ${subjects}.` : "",
      "Use pick_from_bank for the next board. Do not describe cards as consumed or exhausted; this subject uses spaced review.",
    ].filter(Boolean).join("\n");
  }
  const difficultyCounts = ["easy", "medium", "hard"]
    .map((d) => `${d}:${status.remainingByDifficulty[d as Difficulty] ?? 0}`)
    .join(", ");
  const subjects = Object.entries(status.remainingBySubject)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([subject, count]) => `${subject}:${count}`)
    .join(", ");
  if (!scheduledPickAvailable(status)) {
    return [
      `SUBJECT STATUS for ${status.displayName}. ${standing} ${classLine}`,
      `Scheduler detail: no Ruby High card is available right now (${status.masteredCount ?? 0}/${status.total} mastered, ${status.shakyCount ?? 0} shaky, ${status.learningCount ?? 0} learning).`,
      "pick_from_bank is not available this turn. Do not say the bank is exhausted, dry, depleted, or used up.",
      "If the room needs a board, call pose_question exactly once and author a custom question; it will join the reusable Ruby High bank.",
    ].join("\n");
  }
  if (status.remaining <= 0 && status.nextCardRole === "social") {
    return [
      `SUBJECT STATUS for ${status.displayName}. ${standing} ${classLine}`,
      "Scheduler detail: Ruby High has a generated homeroom reflection prompt ready.",
      "Use pick_from_bank for the next board; it will post the scheduled reflection prompt.",
    ].join("\n");
  }
  return [
    `SUBJECT STATUS for ${status.displayName}. ${standing} ${classLine}`,
    status.defaultDifficulty ? `Default grade difficulty: ${status.defaultDifficulty}. Scheduler by difficulty: ${difficultyCounts}.` : `Scheduler by difficulty: ${difficultyCounts}.`,
    subjects ? `Available subjects: ${subjects}.` : "",
    "Use pick_from_bank as the normal next-board move. This subject uses spaced review; do not describe cards as consumed or exhausted.",
  ].filter(Boolean).join("\n");
}

function stripBoardToolReferences(text: string): string {
  return text
    .replace(/Then call pick_from_bank[^.]*\./gi, "Then offer a short conversational practice prompt in chat.")
    .replace(/Call pick_from_bank exactly once[^.]*\./gi, "Offer a short conversational practice prompt in chat.")
    .replace(/Use pick_from_bank[^.]*\./gi, "Offer a short conversational practice prompt in chat.")
    .replace(/call pose_question exactly once[^.]*\./gi, "offer a short conversational practice prompt in chat.")
    .replace(/Call pose_question exactly once[^.]*\./g, "Offer a short conversational practice prompt in chat.")
    .replace(/Do NOT call pick_from_bank or try alternate filters\./gi, "")
    .replace(/Do not call tools or put another question on the board\./gi, "Do not put another question on the board.")
    .replace(/Do not call tools or change the board\./gi, "Do not change the board.")
    .replace(/Do not call tools or post\/replace\/clear questions\./gi, "Do not change the board.")
    .replace(/Do not call tools\./gi, "Do not change the board.")
    .replace(/Do not say tool names like [^.]+\./gi, "Stay in character and avoid implementation details.")
    .replace(/pick_from_bank|pose_question|pose_opinion|clear_board|handoff_faculty/gi, "the board")
    .replace(/\s+/g, " ")
    .trim();
}

function toolFreeTeacherPrompt(text: string): string {
  const withoutToolSection = text.replace(
    /\s*Tools \(only when THIS TURN explicitly invites them\):[\s\S]*$/i,
    "\n\nRuby High handles board actions outside your reply. Stay in character and respond as the teacher.",
  );
  return stripBoardToolReferences(withoutToolSection);
}

function toolFreeDirective(text: string): string {
  const cleaned = stripBoardToolReferences(text);
  return [
    cleaned,
    "Keep the reply conversational and in character. Ruby High will handle any board state outside this turn; do not mention implementation details or technical limitations.",
  ].filter(Boolean).join(" ");
}

function stripInternalToolXml(text: string): string {
  const filter = createInternalToolXmlFilter();
  return filter.push(text) + filter.flush();
}

function createInternalToolXmlFilter(): {
  push(text: string): string;
  flush(): string;
} {
  let pending = "";
  let suppressingTag = "";
  const maxCloseTagLength = Math.max(...Array.from(INTERNAL_TOOL_XML_TAGS).map((name) => name.length)) + 8;

  const push = (text: string): string => {
    pending += text;
    let out = "";
    while (pending) {
      if (suppressingTag) {
        const closeMatch = new RegExp(`<\\s*/\\s*${escapeRegExp(suppressingTag)}\\s*>`, "i").exec(pending);
        if (!closeMatch) {
          pending = pending.slice(-maxCloseTagLength);
          return out;
        }
        pending = pending.slice(closeMatch.index + closeMatch[0].length);
        suppressingTag = "";
        continue;
      }

      const openIndex = pending.indexOf("<");
      if (openIndex < 0) {
        out += pending;
        pending = "";
        return out;
      }
      out += pending.slice(0, openIndex);
      pending = pending.slice(openIndex);
      const closeIndex = pending.indexOf(">");
      if (closeIndex < 0) return out;

      const rawTag = pending.slice(0, closeIndex + 1);
      const tag = rawTag.match(/^<\s*(\/?)\s*([a-z_][a-z0-9_]*)\b[^>]*(\/?)\s*>$/i);
      if (!tag || !INTERNAL_TOOL_XML_TAGS.has(tag[2]!.toLowerCase())) {
        out += rawTag;
        pending = pending.slice(closeIndex + 1);
        continue;
      }

      const closing = !!tag[1];
      const selfClosing = !!tag[3] || /\/\s*>$/.test(rawTag);
      const tagName = tag[2]!.toLowerCase();
      pending = pending.slice(closeIndex + 1);
      if (!closing && !selfClosing) suppressingTag = tagName;
    }
    return out;
  };

  return {
    push,
    flush() {
      if (suppressingTag) {
        pending = "";
        suppressingTag = "";
        return "";
      }
      const out = pending;
      pending = "";
      return out;
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildToolDefs(opts: { includePickFromBank?: boolean; includePoseOpinion?: boolean } = {}): unknown[] {
  const tools: unknown[] = [
    {
      type: "function",
      function: {
        name: "pick_from_bank",
        description:
          "Draw the next scheduled question from the active faculty's vetted question pack. Preferred over pose_question for normal classroom flow.",
        parameters: {
          type: "object",
          properties: {
            faculty: { type: "string", description: "Faculty id to draw from. Defaults to the active faculty." },
            subject: { type: "string", description: "Optional subject filter, e.g. 'physics', 'literature'." },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pose_opinion",
        description:
          "Pose the graded essay question — the milestone for this grade. No A/B/C/D: the student writes a free-form response and the AI students do too, then you judge them all comparatively. Use this once per grade, when the student has built up enough daily class credits. After this fires, the round opens; you don't grade until later (the system calls you back).",
        parameters: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "The open-ended question. 1-2 sentences max." },
            rubric: { type: "string", description: "What a strong response looks like — feeds into grading." },
            subject: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pose_question",
        description:
          "Author a brand new multiple-choice question on the chalkboard (free-form, not from the bank). Use this only when no banked question fits.",
        parameters: {
          type: "object",
          required: ["prompt", "options", "correct"],
          properties: {
            prompt: { type: "string" },
            options: {
              type: "object",
              required: ["A", "B", "C", "D"],
              properties: {
                A: { type: "string" }, B: { type: "string" }, C: { type: "string" }, D: { type: "string" },
              },
            },
            correct: { type: "string", enum: ["A", "B", "C", "D"] },
            explanation: { type: "string" },
            subject: { type: "string" },
            stat: {
              type: "string",
              enum: ["head", "heart", "hustle", "honor"],
              description: "Optional roll stat for this card. Omit to let Ruby High classify it.",
            },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            faculty: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clear_board",
        description: "Wipe the chalkboard. Use between rounds or when changing topics.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "handoff_faculty",
        description:
          "Switch the active teacher. Use when the topic falls into another teacher's range (e.g. you are Ruby and the student wants real physics depth — hand off to sally-science).",
        parameters: {
          type: "object",
          required: ["faculty"],
          properties: {
            faculty: { type: "string", enum: ["ruby", "sally-science", "professor-edward"] },
          },
        },
      },
    },
  ];
  const filtered = tools.filter((tool) => {
    const name = (tool as { function?: { name?: string } }).function?.name;
    if (opts.includePickFromBank === false && name === "pick_from_bank") return false;
    if (opts.includePoseOpinion === false && name === "pose_opinion") return false;
    return true;
  });
  return filtered;
}

function toolNameFromDef(tool: unknown): string | null {
  const name = (tool as { function?: { name?: unknown } }).function?.name;
  return typeof name === "string" ? name : null;
}

function toOpenRouterMessage(m: ChatMessage): unknown {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content };
}
