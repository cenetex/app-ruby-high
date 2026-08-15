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
  getActivePack,
  registerPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { ELIZAOS_SYSTEMS_LAB_PACK_ID } from "../content/packs/elizaos-systems-lab.js";
import { PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID } from "../content/packs/project89-signal-timeline-lab.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";

// Pack-routes integration tests. Auth is exercised; file-based pack imports
// are intentionally absent from the product surface.

let tmpDir: string;
let storePath: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  body?: any;
  contentTypeHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
  callbackOrigin?: string | null;
}): PackRouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    url: new URL(`https://ruby.example.test${opts.path}`),
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    contentTypeHeader: opts.contentTypeHeader === undefined ? "application/json" : opts.contentTypeHeader,
    originHeader: opts.originHeader ?? null,
    callbackUrlBuilder: (path) => `${opts.callbackOrigin ?? "https://ruby.example.test"}${path}`,
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
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
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
    expect(aliceIds).toEqual(
      [
        "agent:alice-1",
        ORIGINAL_PACK_ID,
        ELIZAOS_SYSTEMS_LAB_PACK_ID,
        PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
      ].sort(),
    );

    const bobCtx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs", cookie: "rh_session=bob" });
    await handlePackRoutes(bobCtx, makeDeps());
    const bobIds = (lastResponse?.body.packs as Array<{ id: string }>).map((p) => p.id).sort();
    expect(bobIds).toEqual(
      [
        "agent:bob-1",
        ORIGINAL_PACK_ID,
        ELIZAOS_SYSTEMS_LAB_PACK_ID,
        PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
      ].sort(),
    );
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

  it("rejects cross-origin pack activation before changing activePackId", async () => {
    signInUser("alice");
    registerPack(syntheticPack("agent:alice-1"), "rh:user:test-alice");

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=alice",
      originHeader: "https://evil.example",
      body: { packId: "agent:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse).toEqual({
      status: 403,
      body: { error: "Pack request origin is not allowed." },
    });
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBeNull();
  });

  it("rejects non-json pack activation before changing activePackId", async () => {
    signInUser("alice");
    registerPack(syntheticPack("agent:alice-1"), "rh:user:test-alice");

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=alice",
      contentTypeHeader: "text/plain",
      body: { packId: "agent:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());

    expect(lastResponse).toEqual({
      status: 415,
      body: { error: "Pack requests must be sent as JSON." },
    });
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBeNull();
  });
});

describe("/packs/import-* removal", () => {
  it("does not handle the legacy server-key connect-agent endpoint", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/connect-agent",
      cookie: "rh_session=alice",
      body: { modelId: "legacy:agent" },
    });
    const handled = await handlePackRoutes(ctx, makeDeps());
    expect(handled).toBe(false);
    expect(lastResponse).toBeNull();
  });

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
      defaultModel: DEFAULT_OPENROUTER_MODEL,
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
