import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleChatRoutes, type ChatRouteContext } from "../chat-routes.js";
import { AuthService } from "../services/auth-service.js";
import { ChatService } from "../services/chat-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let auth: AuthService;
let chat: ChatService;
let ruby: RubyHighService;

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
      if (type === RubyHighService.serviceType) return ruby;
      return null;
    },
  };
}

function makeCtx(url: URL, res: TestResponse): ChatRouteContext {
  return {
    method: "GET",
    pathname: url.pathname,
    url,
    runtime: runtime(),
    res,
    cookieHeader: null,
    error: (_res, message, status = 500) => {
      res.statusCode = status;
      res.body = JSON.stringify({ error: message });
    },
    json: (_res, data, status = 200) => {
      res.statusCode = status;
      res.body = JSON.stringify(data);
    },
    readJsonBody: async () => ({}),
  };
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
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  chat = await ChatService.start({} as never);
  ruby = new RubyHighService({} as never, store);
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
