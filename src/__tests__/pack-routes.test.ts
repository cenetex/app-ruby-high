import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePackRoutes, type PackRouteContext } from "../pack-routes.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import {
  ORIGINAL_PACK_ID,
  availablePacksForSession,
  getActivePack,
  packForSession,
  registerPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

// Pack-routes integration tests. Auth is exercised; file-based pack imports
// are intentionally absent from the product surface.

let tmpDir: string;
let storePath: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;
const originalRatiBaseUrl = process.env.RUBY_HIGH_RATI_BASE_URL;
const originalRatiApiKey = process.env.RUBY_HIGH_RATI_API_KEY;
const originalRatiSupportsTools = process.env.RUBY_HIGH_RATI_SUPPORTS_TOOLS;

function makeCtx(opts: { method: string; path: string; cookie?: string | null; body?: any }): PackRouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    error: (_res, message, status = 500) => { lastResponse = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { lastResponse = { status, body: data }; },
    readJsonBody: async () => opts.body ?? {},
  };
}

function makeDeps() {
  return {
    auth,
    ruby,
    sessionIdFor: (cookie?: string | null) => auth.stateKeyForCookie(cookie),
  };
}

function signInUser(token: string): string {
  // Inject a session record into the AuthService directly — saves the
  // OAuth flow for these tests. The token doubles as the cookie value;
  // the actual OpenRouter key is sent as a per-request header (the
  // chat layer's pattern), not stored on the record.
  const userId = `test-${token}`;
  const now = Date.now();
  auth.injectSessionForTest(token, {
    userId,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  });
  return `rh:user:${userId}`;
}

beforeEach(async () => {
  delete process.env.RUBY_HIGH_RATI_BASE_URL;
  delete process.env.RUBY_HIGH_RATI_API_KEY;
  delete process.env.RUBY_HIGH_RATI_SUPPORTS_TOOLS;
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-pack-routes-"));
  storePath = join(tmpDir, "state.json");
  resetActivePack();
  await getActivePack();
  const store = new StateStore(storePath);
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
});

afterEach(async () => {
  restoreEnv("RUBY_HIGH_RATI_BASE_URL", originalRatiBaseUrl);
  restoreEnv("RUBY_HIGH_RATI_API_KEY", originalRatiApiKey);
  restoreEnv("RUBY_HIGH_RATI_SUPPORTS_TOOLS", originalRatiSupportsTools);
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("/connected-teachers", () => {
  it("GET /connected-teachers returns 401 without a session cookie", async () => {
    const ctx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/connected-teachers" });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(401);
  });

  it("GET /connected-teachers reports an unconfigured server without calling RATi", async () => {
    signInUser("alice");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ctx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/connected-teachers", cookie: "rh_session=alice" });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse).toMatchObject({ status: 200, body: { configured: false, teachers: [] } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connects an allowlisted RATi model as this session's active teacher", async () => {
    signInUser("alice");
    process.env.RUBY_HIGH_RATI_BASE_URL = "https://swarm.test/api/v1";
    process.env.RUBY_HIGH_RATI_API_KEY = "sk-rati-test";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
      object: "list",
      data: [{
        id: "avatar:rati",
        root: "rati",
        avatar: {
          name: "RATi",
          description: "Recursive teacher",
          profile_image: "https://media.example.test/avatars/rati/profile.png",
        },
      }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                subject: "recursion",
                difficulty: "easy",
                prompt: "What is recursion?",
                options: { A: "A function calling itself", B: "A color", C: "A file type", D: "A classroom" },
                correct: "A",
                explanation: "Recursion repeats a process by referring back to itself.",
              },
              {
                subject: "systems",
                difficulty: "medium",
                prompt: "Why do feedback loops matter?",
                options: { A: "They never change behavior", B: "They can amplify or stabilize behavior", C: "They delete inputs", D: "They only work in math" },
                correct: "B",
                explanation: "Feedback loops change future behavior based on previous outputs.",
              },
              {
                subject: "agents",
                difficulty: "medium",
                prompt: "What makes an agent useful in a classroom?",
                options: { A: "Ignoring context", B: "Adapting to the student", C: "Never asking questions", D: "Hiding goals" },
                correct: "B",
                explanation: "A useful agent adapts its teaching to the learner and setting.",
              },
              {
                subject: "reasoning",
                difficulty: "hard",
                prompt: "What is the best way to debug a multi-step system?",
                options: { A: "Guess randomly", B: "Inspect each boundary in order", C: "Change everything at once", D: "Ignore logs" },
                correct: "B",
                explanation: "Boundary-by-boundary inspection isolates where behavior changes.",
              },
            ]),
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/connect-agent",
      cookie: "rh_session=alice",
      body: { modelId: "avatar:rati" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.pack.id).toBe("agent:rati-rati");
    expect(lastResponse?.body.pack.question_count).toBe(4);
    expect(lastResponse?.body.pack.faculty[0].profileImageUrl).toBe("https://media.example.test/avatars/rati/profile.png");
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBe("agent:rati-rati");
    const activePack = packForSession(state);
    expect(activePack.faculty[0]?.profileImageUrl).toBe("https://media.example.test/avatars/rati/profile.png");
    expect(activePack.faculty[0]?.questions).toHaveLength(4);
    expect(activePack.faculty[0]?.questions[0]).toMatchObject({
      id: "rati-rati-seed-1",
      faculty: "rati-rati",
      subject: "recursion",
      correct: "A",
    });
    expect(activePack.faculty[0]?.provider).toEqual({
      kind: "rati-openai-compatible",
      model: "avatar:rati",
      externalId: "rati",
      supportsTools: true,
    });
    expect(JSON.stringify(activePack)).not.toContain("sk-rati-test");
  });

  it("drops malformed RATi profile image URLs during import", async () => {
    signInUser("alice");
    process.env.RUBY_HIGH_RATI_BASE_URL = "https://swarm.test/api/v1";
    process.env.RUBY_HIGH_RATI_API_KEY = "sk-rati-test";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: "list",
        data: [{
          id: "avatar:rati",
          root: "rati",
          avatar: {
            name: "RATi",
            description: "Recursive teacher",
            profile_image: "https://6e331855-ac0b-4734-b0f1-343c346a4228.png",
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                subject: "recursion",
                difficulty: "easy",
                prompt: "What is recursion?",
                options: { A: "A function calling itself", B: "A color", C: "A file type", D: "A classroom" },
                correct: "A",
                explanation: "Recursion repeats a process by referring back to itself.",
              },
              {
                subject: "systems",
                difficulty: "medium",
                prompt: "Why do feedback loops matter?",
                options: { A: "They never change behavior", B: "They can amplify or stabilize behavior", C: "They delete inputs", D: "They only work in math" },
                correct: "B",
                explanation: "Feedback loops change future behavior based on previous outputs.",
              },
              {
                subject: "agents",
                difficulty: "medium",
                prompt: "What makes an agent useful in a classroom?",
                options: { A: "Ignoring context", B: "Adapting to the student", C: "Never asking questions", D: "Hiding goals" },
                correct: "B",
                explanation: "A useful agent adapts its teaching to the learner and setting.",
              },
              {
                subject: "reasoning",
                difficulty: "hard",
                prompt: "What is the best way to debug a multi-step system?",
                options: { A: "Guess randomly", B: "Inspect each boundary in order", C: "Change everything at once", D: "Ignore logs" },
                correct: "B",
                explanation: "Boundary-by-boundary inspection isolates where behavior changes.",
              },
            ]),
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/connect-agent",
      cookie: "rh_session=alice",
      body: { modelId: "avatar:rati" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.pack.faculty[0]).not.toHaveProperty("profileImageUrl");
    const state = ruby.getOrCreate("rh:user:test-alice");
    const activePack = packForSession(state);
    expect(activePack.faculty[0]).not.toHaveProperty("profileImageUrl");
  });

  it("drops unreachable RATi profile image URLs during import", async () => {
    signInUser("alice");
    process.env.RUBY_HIGH_RATI_BASE_URL = "https://swarm.test/api/v1";
    process.env.RUBY_HIGH_RATI_API_KEY = "sk-rati-test";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: "list",
        data: [{
          id: "avatar:rati",
          root: "rati",
          avatar: {
            name: "RATi",
            description: "Recursive teacher",
            profile_image: "https://dodxbiygmi95j.cloudfront.net/avatars/agent-1-6yan/profile/6e331855-ac0b-4734-b0f1-343c346a4228.png",
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockRejectedValueOnce(new TypeError("getaddrinfo ENOTFOUND dodxbiygmi95j.cloudfront.net"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                subject: "recursion",
                difficulty: "easy",
                prompt: "What is recursion?",
                options: { A: "A function calling itself", B: "A color", C: "A file type", D: "A classroom" },
                correct: "A",
                explanation: "Recursion repeats a process by referring back to itself.",
              },
              {
                subject: "systems",
                difficulty: "medium",
                prompt: "Why do feedback loops matter?",
                options: { A: "They never change behavior", B: "They can amplify or stabilize behavior", C: "They delete inputs", D: "They only work in math" },
                correct: "B",
                explanation: "Feedback loops change future behavior based on previous outputs.",
              },
              {
                subject: "agents",
                difficulty: "medium",
                prompt: "What makes an agent useful in a classroom?",
                options: { A: "Ignoring context", B: "Adapting to the student", C: "Never asking questions", D: "Hiding goals" },
                correct: "B",
                explanation: "A useful agent adapts its teaching to the learner and setting.",
              },
              {
                subject: "reasoning",
                difficulty: "hard",
                prompt: "What is the best way to debug a multi-step system?",
                options: { A: "Guess randomly", B: "Inspect each boundary in order", C: "Change everything at once", D: "Ignore logs" },
                correct: "B",
                explanation: "Boundary-by-boundary inspection isolates where behavior changes.",
              },
            ]),
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/connect-agent",
      cookie: "rh_session=alice",
      body: { modelId: "avatar:rati" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.pack.faculty[0]).not.toHaveProperty("profileImageUrl");
    const state = ruby.getOrCreate("rh:user:test-alice");
    const activePack = packForSession(state);
    expect(activePack.faculty[0]).not.toHaveProperty("profileImageUrl");
  });

  it("refuses to import a RATi agent owned by another session before generating questions", async () => {
    signInUser("alice");
    signInUser("bob");
    registerPack(syntheticPack("agent:rati-rati"), "rh:user:test-alice");
    process.env.RUBY_HIGH_RATI_BASE_URL = "https://swarm.test/api/v1";
    process.env.RUBY_HIGH_RATI_API_KEY = "sk-rati-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: "list",
        data: [{
          id: "avatar:rati",
          root: "rati",
          avatar: {
            name: "RATi",
            description: "Recursive teacher",
            profile_image: null,
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const rosterCtx = makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/connected-teachers",
      cookie: "rh_session=bob",
    });
    await handlePackRoutes(rosterCtx, makeDeps());
    expect(lastResponse?.body.teachers[0]).toMatchObject({
      model: "avatar:rati",
      packId: "agent:rati-rati",
      ownedByAnotherSession: true,
      unavailableReason: "already-connected",
    });

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      object: "list",
      data: [{
        id: "avatar:rati",
        root: "rati",
        avatar: {
          name: "RATi",
          description: "Recursive teacher",
          profile_image: null,
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/connect-agent",
      cookie: "rh_session=bob",
      body: { modelId: "avatar:rati" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse).toMatchObject({
      status: 409,
      body: { error: "This connected teacher is already owned by another Ruby High session." },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("/packs auth", () => {
  it("GET /packs returns 401 without a session cookie", async () => {
    const ctx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs" });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(401);
  });

  it("POST /packs/active returns 401 without a session cookie", async () => {
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      body: { packId: ORIGINAL_PACK_ID },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(401);
  });

  it("unknown pack management paths still require auth before falling through", async () => {
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      body: { filename: "x.apkg", data: "AAAA" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(401);
  });
});

describe("/packs visibility", () => {
  it("GET /packs returns built-ins + this user's own packs — not other users'", async () => {
    signInUser("alice");
    signInUser("bob");
    registerPack(syntheticPack("agent:alice-1"), "rh:user:test-alice");
    registerPack(syntheticPack("agent:bob-1"), "rh:user:test-bob");

    const aliceCtx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs", cookie: "rh_session=alice" });
    await handlePackRoutes(aliceCtx, makeDeps());
    const aliceIds = (lastResponse?.body.packs as Array<{ id: string }>).map((p) => p.id).sort();
    expect(aliceIds).toEqual(["agent:alice-1", ORIGINAL_PACK_ID].sort());

    const bobCtx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs", cookie: "rh_session=bob" });
    await handlePackRoutes(bobCtx, makeDeps());
    const bobIds = (lastResponse?.body.packs as Array<{ id: string }>).map((p) => p.id).sort();
    expect(bobIds).toEqual(["agent:bob-1", ORIGINAL_PACK_ID].sort());
    // Critically: Bob never sees Alice's pack.
    expect(bobIds).not.toContain("agent:alice-1");
  });
});

describe("/packs/active — switch flow", () => {
  it("404s on unknown id (and on someone else's pack — same response, no leak)", async () => {
    signInUser("alice");
    signInUser("bob");
    registerPack(syntheticPack("agent:alice-1"), "rh:user:test-alice");

    // Bob tries to activate Alice's pack — should look the same as a
    // non-existent id.
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=bob",
      body: { packId: "agent:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(404);

    // Sanity: a totally fake id gets the same 404.
    const ctx2 = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=bob",
      body: { packId: "agent:does-not-exist" },
    });
    await handlePackRoutes(ctx2, makeDeps());
    expect(lastResponse?.status).toBe(404);
  });

  it("activates the pack + writes activePackId to state", async () => {
    signInUser("alice");
    registerPack(syntheticPack("agent:alice-1"), "rh:user:test-alice");

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=alice",
      body: { packId: "agent:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(200);
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBe("agent:alice-1");
  });
});

describe("/packs/import-* removal", () => {
  it("does not handle authenticated Anki import requests", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      body: { filename: "test.apkg", data: "AAAA" },
    });
    const handled = await handlePackRoutes(ctx, makeDeps());
    expect(handled).toBe(false);
    expect(lastResponse).toBeNull();
  });

  it("does not handle authenticated PDF import requests", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-pdf",
      cookie: "rh_session=alice",
      body: { filename: "test.pdf", data: "AAAA" },
    });
    const handled = await handlePackRoutes(ctx, makeDeps());
    expect(handled).toBe(false);
    expect(lastResponse).toBeNull();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

function syntheticPack(id: string): ContentPack {
  return {
    id,
    name: id,
    description: "—",
    version: "0.0.1",
    faculty: [{
      id: `${id}-teacher`,
      displayName: id,
      shortName: id,
      subjects: ["x"],
      bio: "—",
      accent: "#000",
      systemPrompt: "—",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
    }],
    rooms: [{
      id: `${id}-room`,
      name: id,
      channelName: id,
      teacherId: `${id}-teacher`,
      description: "—",
      teaches: true,
    }],
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
