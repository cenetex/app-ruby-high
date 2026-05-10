import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatService } from "../services/chat-service.js";
import { publicChatHistory } from "../chat-routes.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { FacultyService } from "../services/faculty-service.js";
import {
  StateStore,
  type AuthSessionRecord,
  type AuthStoreSnapshot,
  type AuthUserRecord,
  type StateStoreLike,
  type StoredContentPackRecord,
} from "../services/state-store.js";
import { registerPack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import type { QuizState } from "../types.js";

// Smoke tests for the chat layer. The OpenRouter call is mocked so we
// can assert on the messages that would be sent to the LLM (system
// prompt, conversation history, the directive that drives a turn) and
// drive the SSE generator with a canned response.
//
// The bug class these are meant to catch: the user-reported "Hey Rayan,
// let's get to work" double-greeting after a correct answer was a prompt
// regression — the answer-graded directive looked like a fresh hello to
// the model. A unit test on the composed messages would have caught it
// pre-deploy.

let tmpDir: string;
let storePath: string;
let captured: { url: string; body: any } | null = null;
let activeRuby: RubyHighService | null = null;

function buildSseChunk(events: Array<{ content?: string; toolCalls?: any[]; finish?: string }>): Uint8Array {
  const lines: string[] = [];
  for (const ev of events) {
    const delta: any = {};
    if (ev.content) delta.content = ev.content;
    if (ev.toolCalls) delta.tool_calls = ev.toolCalls;
    const choice: any = { delta };
    if (ev.finish) choice.finish_reason = ev.finish;
    const payload = { choices: [choice] };
    lines.push(`data: ${JSON.stringify(payload)}\n\n`);
  }
  lines.push("data: [DONE]\n\n");
  return new TextEncoder().encode(lines.join(""));
}

function mockOpenRouter(sseBody: Uint8Array) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (...args: any[]) => {
    const [input, init] = args;
    captured = {
      url: typeof input === "string" ? input : input.url,
      body: init?.body ? JSON.parse(init.body) : null,
    };
    return new Response(sseBody as BodyInit, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

function mockOpenRouterSequence(sseBodies: Uint8Array[]) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (...args: any[]) => {
    const [input, init] = args;
    const body = sseBodies.shift();
    if (!body) throw new Error("mockOpenRouterSequence exhausted");
    const call = {
      url: typeof input === "string" ? input : input.url,
      body: init?.body ? JSON.parse(init.body) : null,
    };
    captured = call;
    calls.push(call);
    return new Response(body as BodyInit, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return calls;
}

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  const chat = await ChatService.start({} as never);
  chat.setRubyHighService(ruby);
  activeRuby = ruby;
  return { ruby, chat, faculty };
}

function fakeImportedPack(): ContentPack {
  return {
    id: "anki:cells-chat-test",
    name: "Cells",
    description: "Imported cells deck",
    version: "1.0.0",
    faculty: [{
      id: "cells-chat-test-teacher",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["cells"],
      bio: "Sally teaching imported cells.",
      accent: "#3aa3e0",
      systemPrompt: "IMPORTED ANKI CELLS PROMPT. Use the cells deck, not the built-in Ruby bank.",
      defaultModel: "test/imported-model",
      questions: [{
        id: "cell-q1",
        faculty: "cells-chat-test-teacher",
        subject: "cells",
        difficulty: "medium",
        prompt: "What powers the cell?",
        options: { A: "Mitochondria", B: "Ribosome", C: "Nucleus", D: "Golgi" },
        correct: "A",
        explanation: "Mitochondria generate ATP.",
      }],
    }],
    courses: [{
      id: "cells-chat-test-teacher",
      title: "Cells",
      facultyId: "cells-chat-test-teacher",
      roomId: "cells-room",
      teacherTemplateId: "sally-science",
      subjects: ["cells"],
    }],
    rooms: [{
      id: "cells-room",
      name: "Cells",
      channelName: "cells",
      teacherId: "cells-chat-test-teacher",
      description: "Imported cells",
      teaches: true,
    }],
  };
}

class FailingSaveSessionStore implements StateStoreLike {
  async load(): Promise<Map<string, QuizState>> {
    return new Map();
  }

  async loadAuth(): Promise<AuthStoreSnapshot> {
    return { users: [], sessions: [] };
  }

  async loadPacks(): Promise<StoredContentPackRecord[]> {
    return [];
  }

  async saveSession(_state: QuizState): Promise<void> {
    throw new Error("DynamoDB unavailable");
  }

  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}

  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}

  async savePack(_record: StoredContentPackRecord): Promise<void> {}

  async deletePack(_ownerSessionId: string, _packId: string): Promise<void> {}

  async deleteAuthSession(_token: string): Promise<void> {}

  async save(_states: Iterable<QuizState>): Promise<void> {}

  describe(): string {
    return "failing-save-session-store";
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-chat-"));
  storePath = join(tmpDir, "state.json");
  captured = null;
  activeRuby = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Drain any in-flight persistSession writes before nuking the dir,
  // otherwise a fire-and-forget write can race the rm and trip ENOTEMPTY.
  if (activeRuby) await activeRuby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ChatService.send — message composition", () => {
  it("includes the teacher's system prompt as the first message", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { chat } = await makeServices();
    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: bell rang.",
    })) {
      events.push(ev);
    }
    expect(captured).not.toBeNull();
    const messages: any[] = captured!.body.messages;
    expect(messages[0].role).toBe("system");
    // Ruby's persona prompt should be in the first system message.
    expect(typeof messages[0].content).toBe("string");
    expect(messages[0].content.length).toBeGreaterThan(20);
  });

  it("uses the active pack faculty prompt/model for imported Anki teachers", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    const sid = "session:anki-chat";
    const pack = fakeImportedPack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-anki",
      agentSessionId: sid,
      faculty: "sally-science",
      systemEventNote: "Start the imported deck.",
    })) { /* consume */ }

    expect(captured).not.toBeNull();
    expect(captured!.body.model).toBe("test/imported-model");
    const messages: any[] = captured!.body.messages;
    expect(messages[0].content).toContain("IMPORTED ANKI CELLS PROMPT");
    expect(messages[0].content).not.toContain("You are Ruby");
  });

  it("describes imported decks as no due cards, not exhausted", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    const sid = "session:anki-chat-srs-dry";
    const pack = fakeImportedPack();
    pack.id = "anki:cells-chat-srs-dry";
    pack.faculty[0]!.questions[0]!.id = "cell-srs-dry-q1";
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    const state = ruby.pickAndPose(sid, { faculty: "sally-science" });
    ruby.submitAnswer(sid, state.current!.correct === "A" ? "B" : "A");

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-anki-dry",
      agentSessionId: sid,
      faculty: "sally-science",
      userMessage: "next",
    })) { /* consume */ }

    const toolNames = captured!.body.tools.map((tool: any) => tool.function.name);
    expect(toolNames).not.toContain("pick_from_bank");
    const promptText = JSON.stringify(captured!.body.messages);
    expect(promptText).toContain("no deck card is due right now");
    expect(promptText).not.toContain("EXHAUSTED");
  });

  it("keeps typed chat tool calls inside an imported course when Sally is only the teacher template", async () => {
    const sse = buildSseChunk([
      {
        toolCalls: [{
          index: 0,
          id: "call_pose_custom",
          function: {
            name: "pose_question",
            arguments: JSON.stringify({
              faculty: "sally-science",
              subject: "science",
              prompt: "What powers the cell?",
              options: { A: "Mitochondria", B: "Desk", C: "Bell", D: "Chalk" },
              correct: "A",
            }),
          },
        }],
      },
      { finish: "tool_calls" },
    ]);
    mockOpenRouter(sse);
    const { ruby, chat } = await makeServices();
    const sid = "session:anki-chat-tool";
    const pack = fakeImportedPack();
    pack.id = "anki:cells-chat-tool-test";
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.getOrCreate(sid).subject = "general-knowledge";

    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-anki-tool",
      agentSessionId: sid,
      faculty: "sally-science",
      userMessage: "make me a fresh one",
    })) {
      events.push(ev);
      if (ev.type === "tool") break;
    }

    const tool = events.find((e) => e.type === "tool");
    expect(tool).toMatchObject({ tool: "pose_question", result: { ok: true } });
    expect(tool.state.faculty).toBe("cells-chat-test-teacher");
    expect(tool.state.current.faculty).toBe("cells-chat-test-teacher");
    expect(tool.state.current.subject).toBe("cells");
  });

  it("returns a tool error when a board-changing tool cannot be persisted", async () => {
    const sse = buildSseChunk([
      {
        toolCalls: [{
          index: 0,
          id: "call_pose_persist_failure",
          function: {
            name: "pose_question",
            arguments: JSON.stringify({
              prompt: "Which write path must succeed before acknowledging a tool?",
              options: { A: "Session save", B: "Console log", C: "Timer", D: "Cache hint" },
              correct: "A",
            }),
          },
        }],
      },
      { finish: "tool_calls" },
    ]);
    mockOpenRouter(sse);
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new FailingSaveSessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const chat = await ChatService.start({} as never);
    chat.setRubyHighService(ruby);
    activeRuby = ruby;

    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-persist-fail",
      agentSessionId: "session:persist-fail",
      faculty: "ruby",
      userMessage: "post one",
    })) {
      events.push(ev);
      if (ev.type === "tool") break;
    }

    const tool = events.find((e) => e.type === "tool");
    expect(tool).toMatchObject({
      tool: "pose_question",
      result: { ok: false, error: "DynamoDB unavailable" },
    });
  });

  it("frames the teacher as running a group chat — names player + classmates", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    // Attach a character so the group-chat block has a player to name.
    ruby["sessions"] // force-init by getOrCreate
      ;
    const state = ruby.getOrCreate("session:1");
    state.character = {
      name: "Rayan", playbookId: "overachiever",
      stats: { head: 1, heart: 0, hustle: 0, honor: 0 },
      arcAnswer: "—", personality: "—",
      yearbook: [], createdAt: Date.now(),
    };
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: A round just resolved.",
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    const systemBlob = messages
      .filter((m: any) => m.role === "system")
      .map((m: any) => String(m.content))
      .join("\n");
    // Group framing — NOT 1:1 tutoring.
    expect(systemBlob).toMatch(/group chat|class/i);
    // Player named explicitly.
    expect(systemBlob).toContain("Rayan");
    // Classmates from the seating chart land in the prompt (Ruby's room is
    // homeroom; the layout puts Lyra + Mika there at Freshman year).
    expect(systemBlob).toMatch(/Lyra|Mika/);
  });

  it("threads systemEventNote into the composed messages as a turn directive", async () => {
    mockOpenRouter(buildSseChunk([{ content: "got it", finish: "stop" }]));
    const { chat } = await makeServices();
    const directive = "The student picked B; correct was A; they MISSED IT.";
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: directive,
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    const systemContents = messages
      .filter((m: any) => m.role === "system")
      .map((m: any) => String(m.content));
    // The directive lands in a system block prefixed with "THIS TURN —".
    expect(systemContents.some((c: string) => c.includes("THIS TURN") && c.includes("MISSED IT"))).toBe(true);
  });

  it("does NOT persist systemEventNote into history (turn directives are ephemeral)", async () => {
    // Turn 1: deliver a directive.
    mockOpenRouter(buildSseChunk([{ content: "got it", finish: "stop" }]));
    const { chat } = await makeServices();
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: very specific marker XYZQ123",
    })) { /* consume */ }
    vi.restoreAllMocks();

    // Turn 2: a fresh user message, no directive. The XYZQ123 marker
    // from turn 1 must NOT show up in turn 2's payload anywhere — it
    // was a turn-scoped instruction, not part of the conversation.
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "follow-up",
    })) { /* consume */ }
    const allText = JSON.stringify(captured!.body.messages);
    expect(allText).not.toContain("XYZQ123");
  });

  it("appendEvent surfaces room events as a RECENT EVENTS synopsis on the next turn", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { chat } = await makeServices();
    chat.appendEvent(
      { sessionToken: "t1", faculty: "ruby" },
      { kind: "chime", text: 'Sami (classmate) chimed in: "yo nice"' },
    );
    chat.appendEvent(
      { sessionToken: "t1", faculty: "ruby" },
      { kind: "answer-resolved", text: "Round resolved (correct: B). Player picked B — right." },
    );
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "React in 1 sentence.",
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    const systemBlob = messages.filter((m: any) => m.role === "system").map((m: any) => String(m.content)).join("\n");
    expect(systemBlob).toContain("RECENT EVENTS");
    expect(systemBlob).toContain("Sami");
    expect(systemBlob).toContain("Round resolved");
  });

  it("includes durable Social relationship facts in teacher room context", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    const sid = "session:relationship-context";
    ruby.createCharacter(sid, {
      name: "Pip",
      playbookId: "overachiever",
      stats: { head: 2, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "keeps receipts",
      personality: "careful and intense",
    });
    const state = ruby.getOrCreate(sid);
    const sami = state.character!.mashCard!.cells.sami!;
    sami.affinity = 2;
    sami.circled = true;
    state.schoolEvents.push({
      id: "ev-test",
      kind: "relationship.ticked",
      at: Date.now(),
      faculty: "ruby",
      grade: "9",
      questionId: "q-opinion",
      studentId: "sami",
      delta: 1,
      reason: "applauder",
      affinity: 2,
      circled: true,
      scratched: false,
    });

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: sid,
      faculty: "ruby",
      systemEventNote: "React briefly.",
    })) { /* consume */ }

    const messages: any[] = captured!.body.messages;
    const systemBlob = messages.filter((m: any) => m.role === "system").map((m: any) => String(m.content)).join("\n");
    expect(systemBlob).toContain("Social relationship state");
    expect(systemBlob).toContain("Sami");
    expect(systemBlob).toContain("relationship +1 to +2");
    expect(systemBlob).toContain("applauded");
  });

  it("kicks off missing NPC opinion responses even when the player answered first", async () => {
    const { ruby, chat } = await makeServices();
    const sid = "session:opinion-player-first";
    ruby.createCharacter(sid, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sid, "9");
    ruby.poseOpinion(sid, {
      prompt: "When a classmate answers confidently, what should you trust and what should you check?",
      faculty: "ruby",
    });
    const beforeRound = ruby.getOrCreate(sid).activeRound;
    expect(beforeRound?.type).toBe("opinion");
    const npcIds = beforeRound!.npcs.map((n) => n.studentId);
    expect(npcIds.length).toBeGreaterThan(0);

    ruby.recordOpinion(sid, "player", "I trust concrete evidence and check claims that skip the source.");
    const calls: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      calls.push(body);
      const userPrompt = String(body.messages?.find((m: any) => m.role === "user")?.content ?? "");
      const name = userPrompt.match(/^You are ([^,]+)/)?.[1] ?? "Classmate";
      return new Response(JSON.stringify({
        choices: [{ message: { content: `${name} gives a concrete answer.` } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await chat.kickoffNpcOpinions("sk-test", sid);

    const afterRound = ruby.getOrCreate(sid).activeRound;
    const responders = afterRound?.opinionResponses.map((r) => r.responder) ?? [];
    expect(responders).toEqual(expect.arrayContaining(["player", ...npcIds]));
    expect(calls).toHaveLength(npcIds.length);
  });

  it("history payload contains no system messages — Tier A is dialogue-only", async () => {
    // Set up: an event in the log, a user message, then a turn.
    mockOpenRouter(buildSseChunk([{ content: "first.", finish: "stop" }]));
    const { chat } = await makeServices();
    chat.appendEvent(
      { sessionToken: "t1", faculty: "ruby" },
      { kind: "note", text: "background hum" },
    );
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "hello",
      systemEventNote: "Greet briefly.",
    })) { /* consume */ }
    vi.restoreAllMocks();

    // Second turn: inspect the history slice (everything after the
    // composed-fresh system blocks). The block boundary is wherever
    // role transitions from system to non-system; all subsequent
    // messages are history. None of them should be role:system.
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "second message",
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    let inHistory = false;
    for (const m of messages) {
      if (!inHistory && m.role !== "system") inHistory = true;
      if (inHistory) {
        // Once we cross into history, no system messages allowed.
        expect(m.role).not.toBe("system");
      }
    }
  });

  it("persists conversation history across send() calls in the same bucket", async () => {
    const { chat } = await makeServices();
    // Turn 1: user says hello, model replies.
    mockOpenRouter(buildSseChunk([{ content: "Hi there.", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "hello",
    })) { /* consume */ }
    vi.restoreAllMocks();

    // Turn 2: directive lands. The history from turn 1 must be passed in.
    mockOpenRouter(buildSseChunk([{ content: "Sharp.", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: student answered.",
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    // The "hello" user message and the "Hi there." assistant reply from
    // turn 1 should both be in turn 2's payload.
    const userMsgs = messages.filter((m: any) => m.role === "user").map((m: any) => m.content);
    const asstMsgs = messages.filter((m: any) => m.role === "assistant").map((m: any) => m.content);
    expect(userMsgs).toContain("hello");
    expect(asstMsgs).toContain("Hi there.");
  });

  it("isolates history per faculty bucket — Sally's thread doesn't leak into Ruby's", async () => {
    const { chat } = await makeServices();
    mockOpenRouter(buildSseChunk([{ content: "Sally here.", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "sally-science",
      userMessage: "what about chemistry",
    })) { /* consume */ }
    vi.restoreAllMocks();

    mockOpenRouter(buildSseChunk([{ content: "Ruby here.", finish: "stop" }]));
    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "hi",
    })) { /* consume */ }
    const messages: any[] = captured!.body.messages;
    const allText = JSON.stringify(messages);
    // Sally's exchange must NOT have leaked into Ruby's thread.
    expect(allText).not.toContain("what about chemistry");
    expect(allText).not.toContain("Sally here.");
  });

  it("yields a delta event for each text chunk and a tool event for tool calls", async () => {
    const sse = buildSseChunk([
      { content: "Welcome." },
      {
        toolCalls: [
          { index: 0, id: "call_1", function: { name: "pick_from_bank", arguments: "{}" } },
        ],
      },
      { finish: "tool_calls" },
    ]);
    mockOpenRouter(sse);
    const { chat } = await makeServices();
    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: bell rang.",
    })) {
      events.push(ev);
      // Tool calls trigger a second LLM round; cap at the first tool event
      // to avoid mocking a multi-turn loop.
      if (ev.type === "tool") break;
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("delta");
    expect(types).toContain("tool");
    const tool = events.find((e) => e.type === "tool");
    expect(tool.tool).toBe("pick_from_bank");
  });

  it("does not expose teacher tools while a board is waiting for the student", async () => {
    mockOpenRouter(buildSseChunk([{ content: "Waiting.", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    ruby.pose("session:waiting-board", {
      prompt: "What is Ruby High?",
      options: { A: "A cafe", B: "A school", C: "A spaceship", D: "A library" },
      correct: "B",
      explanation: "Ruby High is a school.",
      subject: "homeroom",
      difficulty: "easy",
      faculty: "ruby",
      questionId: "waiting-board-q",
    });

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-waiting-board",
      agentSessionId: "session:waiting-board",
      faculty: "ruby",
      userMessage: "hold on",
    })) { /* consume */ }

    expect(captured!.body.tools).toEqual([]);
    const promptText = JSON.stringify(captured!.body.messages);
    expect(promptText).toContain("BOARD STATUS: WAITING_FOR_STUDENT_ANSWER");
    expect(promptText).toContain("Wait for the answer-graded event before calling another tool");
  });

  it("rejects duplicate board posts from the same assistant tool batch", async () => {
    const sse = buildSseChunk([
      {
        toolCalls: [
          { index: 0, id: "call_1", function: { name: "pick_from_bank", arguments: "{}" } },
          { index: 1, id: "call_2", function: { name: "pick_from_bank", arguments: "{}" } },
        ],
      },
      { finish: "tool_calls" },
    ]);
    mockOpenRouter(sse);
    const { ruby, chat } = await makeServices();
    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-duplicate-board",
      agentSessionId: "session:duplicate-board",
      faculty: "ruby",
      systemEventNote: "Put a question on the board.",
    })) {
      events.push(ev);
      if (events.filter((e) => e.type === "tool").length === 2) break;
    }

    const tools = events.filter((e) => e.type === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ tool: "pick_from_bank", result: { ok: true } });
    expect(tools[1]).toMatchObject({ tool: "pick_from_bank", result: { ok: false } });
    expect(tools[1]!.result.error).toContain("already posted");
    const state = ruby.getOrCreate("session:duplicate-board");
    expect(state.current).not.toBeNull();
    expect(state.askedQuestionIds).toHaveLength(1);
  });

  it("ignores board-changing tool calls from a room turn after the user has switched rooms", async () => {
    const sse = buildSseChunk([
      {
        toolCalls: [
          { index: 0, id: "call_1", function: { name: "pick_from_bank", arguments: "{}" } },
        ],
      },
      { finish: "tool_calls" },
    ]);
    mockOpenRouter(sse);
    const { ruby, chat } = await makeServices();
    ruby.setFaculty("session:1", "sally-science");

    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "Put a question on the board.",
    })) {
      events.push(ev);
    }

    const tool = events.find((e) => e.type === "tool");
    expect(tool).toMatchObject({
      tool: "pick_from_bank",
      result: { ok: false },
    });
    expect(tool.result.error).toContain("stale");
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stale-room" });
    const state = ruby.getOrCreate("session:1");
    expect(state.faculty).toBe("sally-science");
    expect(state.current).toBeNull();
  });

  it("keeps tools available after a nonterminal tool round", async () => {
    const calls = mockOpenRouterSequence([
      buildSseChunk([
        {
          toolCalls: [
            { index: 0, id: "call_clear", function: { name: "clear_board", arguments: "{}" } },
          ],
        },
        { finish: "tool_calls" },
      ]),
      buildSseChunk([{ content: "Fresh slate.", finish: "stop" }]),
    ]);
    const { chat } = await makeServices();
    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: reset the board, then continue.",
    })) {
      events.push(ev);
    }

    expect(calls.length).toBe(2);
    expect(calls[0]!.body.tools.length).toBeGreaterThan(0);
    expect(calls[1]!.body.tools.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "tool").map((e) => e.tool)).toEqual(["clear_board"]);
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
  });

  it("removes pick_from_bank when the active faculty has no due cards", async () => {
    mockOpenRouter(buildSseChunk([{ content: "I'll write one fresh.", finish: "stop" }]));
    const { ruby, chat, faculty } = await makeServices();
    const state = ruby.getOrCreate("session:1");
    state.cardMemory = {};
    const future = Date.now() + 60 * 60 * 1000;
    for (const q of faculty.bank("ruby")!.questions) {
      state.askedQuestionIds.push(q.id);
      state.cardMemory[`ruby::${q.id}`] = {
        courseId: "ruby",
        questionId: q.id,
        phase: "learning",
        dueAt: future,
        stability: 1,
        difficulty: 0.5,
        consecutiveCorrect: 1,
        correctCount: 1,
        wrongCount: 0,
        delayedCorrectCount: 0,
        lastReviewedAt: Date.now(),
        lastResult: "good",
        lapses: 0,
      };
    }

    for await (const _ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "Put a question on the board.",
    })) { /* consume */ }

    const toolNames = captured!.body.tools.map((tool: any) => tool.function.name);
    expect(toolNames).not.toContain("pick_from_bank");
    expect(toolNames).toContain("pose_question");
    const promptText = JSON.stringify(captured!.body.messages);
    expect(promptText).toContain("COURSE STATUS for Ruby.");
    expect(promptText).toContain("no Ruby High card is available right now");
    expect(promptText).toContain("pick_from_bank is not available this turn");
  });

  it("marks a resolved board as already answered in the model prompt", async () => {
    mockOpenRouter(buildSseChunk([{ content: "Got it.", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    ruby.pose("session:1", {
      prompt: "Ruby High has both human students and AI agents in the same classroom. What do you call a school like that?",
      options: { A: "A regular classroom", B: "A guild", C: "A lab", D: "An agent-culture school" },
      correct: "D",
      explanation: "The exact jargon varies; the point is the mixed human/agent classroom.",
      subject: "agent-culture",
      difficulty: "easy",
      faculty: "ruby",
      questionId: "prompt-test-q",
    });
    ruby.submitAnswer("session:1", "D");

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "alright D",
    })) { /* consume */ }

    const systemBlob = captured!.body.messages
      .filter((m: any) => m.role === "system")
      .map((m: any) => String(m.content))
      .join("\n");
    expect(systemBlob).toContain("BOARD STATUS: RESOLVED");
    // Resolved branch describes what happened (positive state) and points
    // at the scheduler's next-question handoff rather than telling the
    // model what NOT to do.
    expect(systemBlob).toContain("answered D");
    expect(systemBlob).toContain("auto-post the next question");
  });

  it("keeps the resolved card snapshot when the board has already cleared", async () => {
    mockOpenRouter(buildSseChunk([{ content: "Got it.", finish: "stop" }]));
    const { ruby, chat } = await makeServices();
    const state = ruby.getOrCreate("session:cleared-reveal");
    state.current = null;
    state.activeRound = null;
    state.lastReveal = {
      questionId: "cell-q1",
      questionPrompt: "Which organelle is known as the powerhouse of the cell?",
      questionType: "multiple-choice",
      questionOptions: {
        A: "Nucleus",
        B: "Mitochondria",
        C: "Ribosome",
        D: "Chloroplast",
      },
      questionSubject: "biology",
      questionDifficulty: "easy",
      picked: "B",
      correct: "B",
      wasCorrect: true,
      explanation: "Mitochondria generate ATP.",
      encouragement: "Nice.",
    };

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t-cleared-reveal",
      agentSessionId: "session:cleared-reveal",
      faculty: "sally-science",
      systemEventNote: "React to the answer.",
      disableTools: true,
    })) { /* consume */ }

    const systemBlob = captured!.body.messages
      .filter((m: any) => m.role === "system")
      .map((m: any) => String(m.content))
      .join("\n");
    expect(systemBlob).toContain("BOARD STATUS: RECENTLY_RESOLVED");
    expect(systemBlob).toContain("Which organelle is known as the powerhouse of the cell?");
    expect(systemBlob).toContain("B) Mitochondria");
    expect(systemBlob).toContain("Mitochondria generate ATP");
  });

  it("serializes completed tool calls for viewer history replay", () => {
    const history = publicChatHistory([
      {
        role: "assistant",
        content: "",
        faculty: "ruby",
        at: 1,
        toolCalls: [
          {
            id: "call_pose",
            type: "function",
            function: {
              name: "pose_question",
              arguments: "{\"prompt\":\"hidden\",\"correct\":\"D\"}",
            },
          },
        ],
      },
      {
        role: "tool",
        content: "{\"ok\":true,\"message\":\"Question posted.\"}",
        toolCallId: "call_pose",
        faculty: "ruby",
        at: 2,
      },
    ] as any);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      role: "tool",
      tool: "pose_question",
      args: {},
      result: { ok: true, message: "Question posted." },
    });
    expect(JSON.stringify(history)).not.toContain("hidden");
    expect(JSON.stringify(history)).not.toContain("\"correct\":\"D\"");
  });

  it("drops legacy incomplete tool-call groups before composing", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { chat } = await makeServices();
    (chat as any).histories.set("t1::ruby", [
      { role: "user", content: "old user", faculty: "ruby", at: 1 },
      {
        role: "assistant",
        content: "tooling",
        faculty: "ruby",
        at: 2,
        toolCalls: [
          { id: "call_a", type: "function", function: { name: "pick_from_bank", arguments: "{}" } },
          { id: "call_b", type: "function", function: { name: "clear_board", arguments: "{}" } },
        ],
      },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "call_a", faculty: "ruby", at: 3 },
      { role: "assistant", content: "after broken group", faculty: "ruby", at: 4 },
    ]);

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "next",
    })) { /* consume */ }

    const allText = JSON.stringify(captured!.body.messages);
    expect(allText).not.toContain("call_a");
    expect(allText).not.toContain("call_b");
    expect(captured!.body.messages.some((m: any) => m.role === "tool")).toBe(false);
    expect(allText).toContain("after broken group");
  });

  it("trims history without splitting complete tool-call groups", async () => {
    mockOpenRouter(buildSseChunk([{ content: "ok", finish: "stop" }]));
    const { chat } = await makeServices();
    const filler = Array.from({ length: 28 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `filler ${i}`,
      faculty: "ruby",
      at: i + 1,
    }));
    (chat as any).histories.set("t1::ruby", [
      ...filler,
      {
        role: "assistant",
        content: "tooling",
        faculty: "ruby",
        at: 100,
        toolCalls: [
          { id: "call_a", type: "function", function: { name: "pick_from_bank", arguments: "{}" } },
          { id: "call_b", type: "function", function: { name: "clear_board", arguments: "{}" } },
        ],
      },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "call_a", faculty: "ruby", at: 101 },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "call_b", faculty: "ruby", at: 102 },
    ]);

    for await (const _ of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      userMessage: "next",
    })) { /* consume */ }

    const historyMessages = captured!.body.messages.filter((m: any) => m.role !== "system");
    const idx = historyMessages.findIndex((m: any) =>
      m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length === 2
    );
    expect(idx).toBeGreaterThan(-1);
    expect(historyMessages[idx + 1]?.role).toBe("tool");
    expect(historyMessages[idx + 1]?.tool_call_id).toBe("call_a");
    expect(historyMessages[idx + 2]?.role).toBe("tool");
    expect(historyMessages[idx + 2]?.tool_call_id).toBe("call_b");
    expect(historyMessages.length).toBeLessThanOrEqual(30);
  });

  it("surfaces an error event when OpenRouter returns a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("rate limit", { status: 429 }) as Response,
    );
    const { chat } = await makeServices();
    const events: any[] = [];
    for await (const ev of chat.send({
      apiKey: "sk-test",
      sessionToken: "t1",
      agentSessionId: "session:1",
      faculty: "ruby",
      systemEventNote: "EVENT: anything.",
    })) {
      events.push(ev);
    }
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(String(err.message)).toMatch(/429|rate limit/i);
  });
});
