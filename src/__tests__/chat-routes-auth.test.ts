import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleChatRoutes, type ChatRouteContext } from "../chat-routes.js";
import { AuthService } from "../services/auth-service.js";
import { ChatService } from "../services/chat-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack } from "../content/registry.js";

let tmpDir: string;
let auth: AuthService;
let chat: ChatService;
let faculty: FacultyService;
let ruby: RubyHighService;
let capturedChatRequest: any | null = null;

class TestResponse {
  statusCode = 0;
  body = "";
  headers = new Map<string, string | string[]>();

  setHeader(name: string, value: string | string[]): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  writeHead(status: number, headers: Record<string, string | string[]>): void {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  flushHeaders(): void {
    // no-op for route tests
  }

  end(body?: string): void {
    if (body) this.body += body;
  }
}

function runtime() {
  return {
    agentId: "test-agent",
    getService(type: string) {
      if (type === AuthService.serviceType) return auth;
      if (type === ChatService.serviceType) return chat;
      if (type === FacultyService.serviceType) return faculty;
      if (type === RubyHighService.serviceType) return ruby;
      return null;
    },
  };
}

function makeCtx(url: URL, res: TestResponse, opts: {
  method?: string;
  cookieHeader?: string | null;
  apiKeyHeader?: string | null;
  body?: unknown;
} = {}): ChatRouteContext {
  return {
    method: opts.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: runtime(),
    res,
    cookieHeader: opts.cookieHeader ?? null,
    apiKeyHeader: opts.apiKeyHeader ?? null,
    error: (_res, message, status = 500) => {
      res.statusCode = status;
      res.body = JSON.stringify({ error: message });
    },
    json: (_res, data, status = 200) => {
      res.statusCode = status;
      res.body = JSON.stringify(data);
    },
    readJsonBody: async () => opts.body ?? {},
  };
}

function buildSseChunk(text: string): Uint8Array {
  return new TextEncoder().encode([
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""));
}

async function callbackUrl(redirect: string): Promise<URL> {
  const { state } = auth.startPkce("http://localhost:3000/api/apps/ruby-high/auth/callback");
  const url = new URL("http://localhost:3000/api/apps/ruby-high/auth/callback");
  url.searchParams.set("code", "code-1");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect", redirect);
  return url;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-chat-routes-auth-"));
  capturedChatRequest = null;
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  chat = await ChatService.start({} as never);
  faculty = await FacultyService.start({} as never);
  ruby = new RubyHighService({} as never, store);
  ruby.setFacultyService(faculty);
  chat.setRubyHighService(ruby);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-user" }), { status: 200 });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await auth.stop();
  await chat.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("auth callback redirect sanitization", () => {
  it("falls back to the viewer when redirect points off-origin", async () => {
    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(await callbackUrl("https://evil.example/pwn"), res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('window.location.replace("/api/apps/ruby-high/viewer")');
    expect(res.body).not.toContain("evil.example");
  });

  it("allows root-relative same-origin callback redirects", async () => {
    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(await callbackUrl("/api/apps/ruby-high/viewer?tab=packs#store"), res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('window.location.replace("/api/apps/ruby-high/viewer?tab=packs#store")');
  });
});

describe("chat event context", () => {
  it("threads the resolved card snapshot into answer-graded teacher turns", async () => {
    const token = "route-event-token";
    const record = {
      userId: "route-event-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Event",
    };
    auth.injectSessionForTest(token, record);
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Nice work.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            grade: "9",
            questionId: "cell-q1",
            prompt: "Which organelle is known as the powerhouse of the cell?",
            type: "multiple-choice",
            subject: "biology",
            difficulty: "easy",
            options: {
              A: "Nucleus",
              B: "Mitochondria",
              C: "Ribosome",
              D: "Chloroplast",
            },
            picked: "B",
            correct: "B",
            pickedAnswer: "B) Mitochondria",
            correctAnswer: "B) Mitochondria",
            explanation: "Mitochondria generate ATP.",
            wasCorrect: true,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("RESOLVED CARD SNAPSHOT");
    expect(promptText).toContain("Which organelle is known as the powerhouse of the cell?");
    expect(promptText).toContain("B) Mitochondria");
    expect(promptText).toContain("Mitochondria generate ATP");
    expect(promptText).toContain("Use this snapshot for the reaction");
  });

  it("drops answer-graded teacher turns when the live reveal has moved on", async () => {
    const token = "route-stale-answer-token";
    auth.injectSessionForTest(token, {
      userId: "route-stale-answer-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Stale Answer",
    });
    const state = ruby.getOrCreate(auth.stateKeyForToken(token));
    state.faculty = "sally-science";
    state.lastReveal = {
      questionId: "current-q",
      picked: "A",
      correct: "A",
      wasCorrect: true,
      forfeit: false,
      explanation: null,
      encouragement: null,
    };
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("This should not run.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            questionId: "old-q",
            picked: "B",
            correct: "B",
            wasCorrect: true,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).toBeNull();
    expect(res.body).toContain("stale-answer");
  });

  it("threads lounge Chat button player lines into the next faculty turn", async () => {
    const token = "route-lounge-player-line-token";
    auth.injectSessionForTest(token, {
      userId: "route-lounge-player-line-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Lounge Player",
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Pull up a chair.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "lounge",
          trigger: "manual",
          context: {
            playerLine: "Can I sit in for a minute?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const messages = capturedChatRequest.body.messages as Array<{ role?: string; content?: string }>;
    expect(messages.some((m) => m.role === "user" && m.content === "Can I sit in for a minute?")).toBe(true);
    const promptText = JSON.stringify(messages);
    expect(promptText).toContain("The student just spoke in the lounge");
    expect(capturedChatRequest.body.tools).toEqual([]);
  });

  it("threads classroom Chat button player lines into the teacher turn", async () => {
    const token = "route-class-player-line-token";
    auth.injectSessionForTest(token, {
      userId: "route-class-player-line-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Class Player",
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Let's work it from the first clue.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            playerLine: "Can someone pressure-test my answer?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const messages = capturedChatRequest.body.messages as Array<{ role?: string; content?: string }>;
    expect(messages.some((m) => m.role === "user" && m.content === "Can someone pressure-test my answer?")).toBe(true);
    const promptText = JSON.stringify(messages);
    expect(promptText).toContain("Can someone pressure-test my answer?");
    expect(promptText).toContain("Reply directly in character");
  });

  it("manual advance Chat turns post a board even when the teacher only narrates", async () => {
    const token = "route-manual-advance-fallback-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-advance-fallback-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Advance",
    });
    const sessionId = auth.stateKeyForToken(token);
    const state = ruby.getOrCreate(sessionId);
    state.faculty = "ruby";
    expect(state.current).toBeNull();

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Let's take the next card cleanly.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "advance",
            playerLine: "What is the read in this room?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(JSON.stringify(capturedChatRequest.body.messages)).toContain("scheduler will put the next card on the board");
    expect(res.body).toContain("pick_from_bank");
    expect(res.body).toContain("fallback: auto-posed next question");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.resolved).toBe(false);
  });

  it("manual hint Chat turns never change the current board", async () => {
    const token = "route-manual-hint-no-board-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-hint-no-board-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Hint",
    });
    const sessionId = auth.stateKeyForToken(token);
    const before = ruby.pickAndPose(sessionId, { faculty: "ruby" });
    const questionId = before.current!.id;

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Start with the most specific clue.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "hint",
            playerLine: "What should I notice first?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(capturedChatRequest.body.tools).toEqual([]);
    expect(res.body).not.toContain("pick_from_bank");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current?.id).toBe(questionId);
    expect(after.phase).toBe("asking");
    expect(after.activeRound?.resolved).toBe(false);
  });

  it("manual report Chat turns never post a new board", async () => {
    const token = "route-manual-report-no-board-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-report-no-board-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Report",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.pickAndPose(sessionId, { faculty: "ruby" });
    const questionId = ruby.getOrCreate(sessionId).current!.id;
    const correct = ruby.getOrCreate(sessionId).current!.correct as "A" | "B" | "C" | "D";
    ruby.submitAnswer(sessionId, correct);

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("That result tells us where to tighten up.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "report",
            playerLine: "How did that class actually go?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(capturedChatRequest.body.tools).toEqual([]);
    expect(res.body).not.toContain("pick_from_bank");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current?.id).toBe(questionId);
    expect(after.phase).toBe("revealed");
    expect(after.activeRound?.resolved).toBe(true);
  });

  it("describes answer-graded timeouts without inventing a player pick", async () => {
    const token = "route-timeout-token";
    auth.injectSessionForTest(token, {
      userId: "route-timeout-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Clock got them.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            prompt: "Which organelle is known as the powerhouse of the cell?",
            options: { A: "Nucleus", B: "Mitochondria", C: "Ribosome", D: "Chloroplast" },
            picked: null,
            correct: "B",
            correctAnswer: "B) Mitochondria",
            forfeit: true,
            wasCorrect: false,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("Player answer: no answer (timeout)");
    expect(promptText).toContain("Time expired before");
    expect(promptText).not.toContain("answered A");
    expect(promptText).not.toContain("Player answer: A");
  });
});
