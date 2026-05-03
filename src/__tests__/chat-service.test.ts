import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatService } from "../services/chat-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { StateStore } from "../services/state-store.js";

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
    return new Response(sseBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  const chat = await ChatService.start({} as never);
  chat.setRubyHighService(ruby);
  activeRuby = ruby;
  return { ruby, chat };
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
      arcAnswer: "—", personality: "—", xp: 0,
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
