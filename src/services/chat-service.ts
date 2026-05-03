import { Service, type IAgentRuntime } from "@elizaos/core";
import { teacherById, type TeacherCharacter } from "../characters/teachers.js";
import { STUDENTS, type StudentCharacter } from "../characters/students.js";
import type { Choice, Difficulty, NpcStudentState, QuizState } from "../types.js";
import { GRADE_LABELS, npcsInRoom, type TeachingRoomId } from "../types.js";
import { roomForFacultyForSession } from "../content/registry.js";
import { RubyHighService } from "./ruby-high-service.js";

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

export interface ChatHistoryKey {
  sessionToken: string;
  faculty: string;
}

/**
 * A room-event is the architectural counterpart to a ChatMessage.
 *
 *  - ChatMessage = persistent dialogue (user / assistant / tool). Goes into
 *    `histories`. Round-trips to OpenRouter as role-shaped messages.
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

const HISTORY_LIMIT = 30;
const EVENT_LOG_LIMIT = 60;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REFERER_HEADER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
const TITLE_HEADER = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; tool: string; args: Record<string, unknown>; result: { ok: boolean; message?: string; error?: string }; state?: QuizState }
  | { type: "state"; state: QuizState }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; message: string };

export interface SendOpts {
  apiKey: string;
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
  /** Disable the blackboard tool surface for this turn (lounge mode). */
  disableTools?: boolean;
  /** Append additional context to the system prompt for this turn. */
  extraSystemContext?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * ChatService is the bridge from the viewer to OpenRouter.
 *  - Owns per-(cookie, faculty) chat history (in memory).
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
  private ruby: RubyHighService | null = null;

  static async start(runtime: IAgentRuntime): Promise<ChatService> {
    return new ChatService(runtime);
  }

  async stop(): Promise<void> {
    this.histories.clear();
    this.events.clear();
  }

  setRubyHighService(ruby: RubyHighService): void {
    this.ruby = ruby;
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

  events_for_test(key: ChatHistoryKey): RoomEvent[] {
    return this.events.get(this.keyOf(key)) ?? [];
  }

  async *send(opts: SendOpts): AsyncGenerator<ChatStreamEvent> {
    if (!this.ruby) throw new Error("RubyHighService not bound to ChatService.");
    const speakerId = opts.speakerFacultyId ?? opts.faculty;
    const teacher = teacherById(speakerId);
    const bucketFaculty = opts.bucketKey ?? opts.faculty;
    const key: ChatHistoryKey = { sessionToken: opts.sessionToken, faculty: bucketFaculty };
    const history = this.ensure(key);

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

    const toolDefs = opts.disableTools ? [] : buildToolDefs();
    // 2 rounds is enough for the standard "speak + pose question" flow.
    // More than that has only ever produced loops where the model tries to
    // "fix" a non-problem (e.g., re-picking what it thinks is a duplicate).
    let safety = opts.disableTools ? 1 : 2;
    // Once any tool has fired in this turn, iteration 2 runs without tools
    // — it's narration-only. This is the structural fix for the
    // "model second-guesses pick_from_bank and picks again" loop: in
    // iteration 2 the system message describes the freshly-placed question,
    // and the model's own tool result from iteration 1 describes the same
    // question; reading both literally, the model sometimes concludes
    // "same question on the board, must re-pick." Removing the tools from
    // its iteration-2 menu forecloses that path entirely.
    let toolsFiredThisTurn = false;

    while (safety-- > 0) {
      const messages = this.composeForOpenRouter({
        teacher,
        history,
        agentSessionId: opts.agentSessionId,
        bucketKey: key,
        speakerId,
        turnDirective,
        extraSystemContext: opts.extraSystemContext,
        disableTools: !!opts.disableTools,
      });

      const stream = streamOpenRouter({
        apiKey: opts.apiKey,
        model: opts.model ?? teacher.defaultModel,
        messages,
        tools: toolsFiredThisTurn ? [] : toolDefs,
        maxTokens: opts.maxTokens ?? 600,
      });

      let assistantText = "";
      const assistantToolCalls: ToolCall[] = [];
      let finishReason: string | null = null;

      try {
        for await (const chunk of stream) {
          if (chunk.kind === "text") {
            assistantText += chunk.text;
            yield { type: "delta", text: chunk.text };
          } else if (chunk.kind === "tool-call") {
            assistantToolCalls.push(chunk.toolCall);
          } else if (chunk.kind === "finish") {
            finishReason = chunk.reason;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message };
        return;
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText,
        toolCalls: assistantToolCalls.length ? assistantToolCalls : undefined,
        // Tag with the SPEAKER id so the lounge can attribute messages to the
        // right teacher when replaying history.
        faculty: speakerId,
        at: Date.now(),
      };
      history.push(assistantMessage);
      this.trim(key);

      if (assistantToolCalls.length === 0) {
        yield { type: "done", finishReason };
        return;
      }

      // Mark the turn as having fired tools BEFORE dispatch — even if
      // dispatch fails, the next iteration must be narration-only so we
      // don't loop. (Tool-result framing tells the model what happened;
      // re-trying is the user-event handler's job, not this loop's.)
      toolsFiredThisTurn = true;
      let handoffFired = false;
      for (const call of assistantToolCalls) {
        const result = await this.dispatchTool(opts.agentSessionId, call);
        history.push({
          role: "tool",
          content: JSON.stringify(result.payload),
          toolCallId: call.id,
          faculty: opts.faculty,
          at: Date.now(),
        });
        this.trim(key);
        yield {
          type: "tool",
          tool: call.function.name,
          args: result.args,
          result: { ok: result.payload.ok, message: result.payload.message, error: result.payload.error },
          state: result.state ?? undefined,
        };
        if (call.function.name === "pose_opinion" && result.payload.ok && result.state) {
          void this.kickoffNpcOpinions(opts.apiKey, opts.agentSessionId);
        }
        if (call.function.name === "handoff_faculty" && result.payload.ok) {
          handoffFired = true;
        }
      }
      // After handoff_faculty, stop the agent loop. The current speaker is no
      // longer the active faculty; further turns belong to the new teacher
      // and should be triggered by the next channel-enter event.
      if (handoffFired) {
        yield { type: "done", finishReason: "handoff" };
        return;
      }
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
    // 3. Board.
    if (!disableTools) {
      const ctx = describeBoardForModel(state);
      messages.push({ role: "system", content: `Active board context for this turn:\n${ctx}` });
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
    if (round.opinionResponses.length > 0) return; // already kicked off

    const grade = state.currentGrade;
    const facultyId = state.faculty;
    const playerName = "the player"; // could thread real name through later
    const npcsInRound = round.npcs.map((n) => n.studentId);
    const classmates = npcsInRound
      .map((id) => STUDENTS[id])
      .filter((s): s is StudentCharacter => !!s);

    // Resolve each NPC's character + stats from the roster.
    const roster = grade ? state.npcRosters[grade] ?? [] : [];

    const tasks = round.npcs.map(async (entry) => {
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
  }

  private async dispatchTool(
    agentSessionId: string,
    call: ToolCall,
  ): Promise<{ args: Record<string, unknown>; payload: { ok: boolean; message?: string; error?: string }; state?: QuizState }> {
    const ruby = this.ruby!;
    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (err) {
      return {
        args: {},
        payload: { ok: false, error: `Bad tool arguments JSON: ${(err as Error).message}` },
      };
    }

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
            difficulty: args.difficulty as Difficulty | undefined,
            faculty: args.faculty ? String(args.faculty) : undefined,
          });
          return { args, payload: { ok: true, message: "Question posted." }, state };
        }
        case "pick_from_bank": {
          const state = ruby.pickAndPose(agentSessionId, {
            faculty: args.faculty ? String(args.faculty) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            difficulty: args.difficulty as Difficulty | undefined,
          });
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
          return {
            args,
            payload: { ok: true, message: `Opinion question on the board: ${state.current?.prompt ?? ""}` },
            state,
          };
        }
        case "clear_board": {
          const state = ruby.clearBoard(agentSessionId);
          return { args, payload: { ok: true, message: "Cleared." }, state };
        }
        case "handoff_faculty": {
          const facultyId = String(args.faculty ?? "");
          const state = ruby.setFaculty(agentSessionId, facultyId);
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
    if (list.length <= HISTORY_LIMIT) return;
    let next = list.slice(list.length - HISTORY_LIMIT);
    // The slice can land between an assistant-with-tool_calls and its
    // matching tool result, leaving orphan `tool` messages at the head.
    // Anthropic (and most providers) reject these with
    //   "tool_result block must have a corresponding tool_use block in the
    //    previous message"
    // Drop any leading `tool` messages (and any leading assistant messages
    // that have tool_calls but whose tool results were trimmed away — these
    // also dangle and confuse the provider).
    let drop = 0;
    while (drop < next.length) {
      const m = next[drop]!;
      if (m.role === "tool") { drop++; continue; }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        // Check whether the next message satisfies all tool calls. If any
        // are missing, this assistant message is orphaned and we drop it.
        const ids = new Set(m.toolCalls.map((tc) => tc.id));
        let scan = drop + 1;
        while (scan < next.length && next[scan]!.role === "tool") {
          ids.delete(next[scan]!.toolCallId ?? "");
          scan++;
        }
        if (ids.size > 0) { drop = scan; continue; }
      }
      break;
    }
    if (drop > 0) next = next.slice(drop);
    this.histories.set(k, next);
  }

  private keyOf(key: ChatHistoryKey): string {
    return `${key.sessionToken}::${key.faculty}`;
  }
}

/** One-shot OpenRouter call asking an NPC to write an opinion in their voice
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

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": REFERER_HEADER,
      "X-Title": TITLE_HEADER,
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: args.student.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.95,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const trimmed = text.length > 500 ? text.slice(0, 500) + "…" : text;
    throw new Error(`opinion-npc: OpenRouter ${r.status} ${r.statusText}${trimmed ? ` — ${trimmed}` : ""}`);
  }
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  return ((body.choices?.[0]?.message?.content ?? "").trim()).replace(/^["'\s]+|["'\s]+$/g, "");
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

/** Group-chat framing for the teacher: who's in the room. The player and
 *  the seated NPCs (the classmates whose dice rolled alongside the player
 *  on the last question) get named. Tells the teacher: "you're running a
 *  class, not tutoring." Without this the model defaults to 1:1 framing
 *  and either ignores the NPCs or invents new ones. */
function describeRoomForTeacher(state: QuizState): string {
  if (!state.character) return "";
  const c = state.character;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const lines: string[] = [];
  lines.push(`You are running a class — group chat, not 1:1 tutoring.`);
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
  lines.push(`Address whoever just acted by name. ${c.name.split(" ")[0] ?? c.name} is the player; the others are AI classmates but treat them as real students in the room.`);
  return lines.join("\n");
}

function describeBoardForModel(state: QuizState): string {
  if (!state.current) {
    return `No question on the board. Faculty: ${state.faculty}. Score this session: ${state.score.correct}/${state.score.total}.`;
  }
  const q = state.current;
  if (q.type === "opinion") {
    return [
      `Active faculty: ${state.faculty}.`,
      `Score this session: ${state.score.correct}/${state.score.total}.`,
      `OPINION question on the board:`,
      `  ${q.prompt}`,
      q.rubric ? `  rubric: ${q.rubric}` : "",
      "(The student is writing a free-form response. The system will call you back to grade.)",
    ].filter(Boolean).join("\n");
  }
  const opts = q.options ?? { A: "", B: "", C: "", D: "" };
  // Only mention the reveal when it belongs to the question CURRENTLY on the
  // board — otherwise a new question + an old reveal would race-render and
  // confuse the model into thinking questions repeat. When the active round
  // is resolved we tell the teacher to react instead of nagging for a pick.
  const round = state.activeRound;
  const resolvedThisQ =
    !!round && round.questionId === q.id && round.resolved &&
    !!state.lastReveal && state.lastReveal.questionId === q.id;
  const statusLine = resolvedThisQ && state.lastReveal
    ? `(The student already answered ${state.lastReveal.picked} — ${state.lastReveal.wasCorrect ? "correct" : "missed; correct was " + state.lastReveal.correct}. React to the outcome and call pick_from_bank for the next question.)`
    : "(The student is now picking. Wait for the answer-graded event before calling another tool.)";
  return [
    `Active faculty: ${state.faculty}.`,
    `Score this session: ${state.score.correct}/${state.score.total}.`,
    `Current question on the blackboard (${q.difficulty ?? "?"} · ${q.subject ?? "?"}):`,
    `  ${q.prompt}`,
    `  A) ${opts.A}`,
    `  B) ${opts.B}`,
    `  C) ${opts.C}`,
    `  D) ${opts.D}`,
    `Correct answer: ${q.correct ?? "?"}.`,
    statusLine,
  ].join("\n");
}

function buildToolDefs(): unknown[] {
  return [
    {
      type: "function",
      function: {
        name: "pick_from_bank",
        description:
          "Draw the next question from the active faculty's vetted question pack. Preferred over pose_question for normal classroom flow. Never repeats a question in the same session.",
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
          "Pose an OPINION question (no A/B/C/D). The student writes a free-form response and so do the AI students; you grade them comparatively at the end. Use this once every 3-5 questions to break up the rhythm — pick something open-ended and personal to your subject. After this fires, the round opens; you don't grade until later (the system will call you back to grade).",
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

type StreamChunk =
  | { kind: "text"; text: string }
  | { kind: "tool-call"; toolCall: ToolCall }
  | { kind: "finish"; reason: string | null };

interface OpenRouterArgs {
  apiKey: string;
  model: string;
  messages: unknown[];
  tools: unknown[];
  maxTokens: number;
}

async function* streamOpenRouter(args: OpenRouterArgs): AsyncGenerator<StreamChunk> {
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": REFERER_HEADER,
      "X-Title": TITLE_HEADER,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      tools: args.tools,
      tool_choice: "auto",
      stream: true,
      max_tokens: args.maxTokens,
    }),
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${text || r.statusText}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame) continue;
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: any;
        try { parsed = JSON.parse(payload); } catch { continue; }
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { kind: "text", text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const slot = typeof tc.index === "number" ? tc.index : toolCalls.size;
            const existing = toolCalls.get(slot) ?? { id: tc.id ?? "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCalls.set(slot, existing);
          }
        }
        if (choice.finish_reason) {
          for (const [, tc] of toolCalls) {
            if (tc.id && tc.name) {
              yield {
                kind: "tool-call",
                toolCall: {
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: tc.arguments || "{}" },
                },
              };
            }
          }
          yield { kind: "finish", reason: choice.finish_reason };
          return;
        }
      }
    }
  }

  for (const [, tc] of toolCalls) {
    if (tc.id && tc.name) {
      yield {
        kind: "tool-call",
        toolCall: {
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments || "{}" },
        },
      };
    }
  }
  yield { kind: "finish", reason: null };
}
