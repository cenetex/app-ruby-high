import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
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

// Pack-routes integration tests. Auth is exercised; the .apkg import
// flow uses a programmatic fixture so the round-trip is real (parser +
// distractor generator + pack registration). OpenRouter is mocked.

let tmpDir: string;
let storePath: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;
let captured: { url: string; body: any } | null = null;

function makeCtx(opts: { method: string; path: string; cookie?: string | null; apiKey?: string | null; body?: any }): PackRouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    apiKeyHeader: opts.apiKey ?? null,
    clientIp: "127.0.0.1",
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
  captured = null;
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

  it("POST /packs/import-anki returns 401 without a session cookie", async () => {
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
  it("GET /packs returns built-ins + this user's own imports — not other users'", async () => {
    signInUser("alice");
    signInUser("bob");
    // Alice imports a pack; Bob imports a different one.
    registerPack(syntheticAnkiPack("anki:alice-1"), "rh:user:test-alice");
    registerPack(syntheticAnkiPack("anki:bob-1"), "rh:user:test-bob");

    const aliceCtx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs", cookie: "rh_session=alice" });
    await handlePackRoutes(aliceCtx, makeDeps());
    const aliceIds = (lastResponse?.body.packs as Array<{ id: string }>).map((p) => p.id).sort();
    expect(aliceIds).toEqual(["anki:alice-1", ORIGINAL_PACK_ID].sort());

    const bobCtx = makeCtx({ method: "GET", path: "/api/apps/ruby-high/packs", cookie: "rh_session=bob" });
    await handlePackRoutes(bobCtx, makeDeps());
    const bobIds = (lastResponse?.body.packs as Array<{ id: string }>).map((p) => p.id).sort();
    expect(bobIds).toEqual(["anki:bob-1", ORIGINAL_PACK_ID].sort());
    // Critically: Bob never sees Alice's pack.
    expect(bobIds).not.toContain("anki:alice-1");
  });
});

describe("/packs/active — switch flow", () => {
  it("404s on unknown id (and on someone else's pack — same response, no leak)", async () => {
    signInUser("alice");
    signInUser("bob");
    registerPack(syntheticAnkiPack("anki:alice-1"), "rh:user:test-alice");

    // Bob tries to activate Alice's pack — should look the same as a
    // non-existent id.
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=bob",
      body: { packId: "anki:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(404);

    // Sanity: a totally fake id gets the same 404.
    const ctx2 = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=bob",
      body: { packId: "anki:does-not-exist" },
    });
    await handlePackRoutes(ctx2, makeDeps());
    expect(lastResponse?.status).toBe(404);
  });

  it("activates the pack + writes activePackId to state", async () => {
    signInUser("alice");
    registerPack(syntheticAnkiPack("anki:alice-1"), "rh:user:test-alice");

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/active",
      cookie: "rh_session=alice",
      body: { packId: "anki:alice-1" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(200);
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBe("anki:alice-1");
  });
});

describe("/packs/import-anki — body validation", () => {
  it("rejects requests over the body cap with 413 (fast-path)", async () => {
    signInUser("alice");
    // 20 MB string > 16 MB cap.
    const huge = "A".repeat(20 * 1024 * 1024);
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      apiKey: "sk-test",
      body: { filename: "huge.apkg", data: huge },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(413);
  });

  it("rejects missing data with 400", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      apiKey: "sk-test",
      body: { filename: "x.apkg" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(400);
  });

  it("rejects missing OpenRouter key with 400", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      // no apiKey header
      body: { filename: "x.apkg", data: "AAAA" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(400);
    expect(String(lastResponse?.body.error)).toMatch(/OpenRouter API key/i);
  });

  it("rejects unknown teacher ids with 400", async () => {
    signInUser("alice");
    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      apiKey: "sk-test",
      body: { filename: "x.apkg", data: "AAAA", teacherId: "fake-teacher" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(400);
    expect(String(lastResponse?.body.error)).toMatch(/Unknown teacher id/i);
  });
});

describe("/packs/import-anki — end-to-end", () => {
  it("parses a real .apkg + generates distractors + registers the pack to the importing session", async () => {
    signInUser("alice");
    // Mock OpenRouter to always return a valid 3-distractor JSON response.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (...args: any[]) => {
      const init = args[1];
      captured = { url: typeof args[0] === "string" ? args[0] : (args[0] as URL).toString(), body: init?.body ? JSON.parse(init.body) : null };
      const respBody = JSON.stringify({
        choices: [{ message: { content: JSON.stringify(["WrongA", "WrongB", "WrongC"]) } }],
      });
      return new Response(respBody, { status: 200 });
    });

    // Build a real .apkg fixture (3 cards) using the same libs the parser uses.
    const apkgBytes = await buildApkgFixture("Test Deck", [
      { front: "Q1", back: "A1" },
      { front: "Q2", back: "A2" },
      { front: "Q3", back: "A3" },
    ]);
    const b64 = Buffer.from(apkgBytes).toString("base64");

    const ctx = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/packs/import-anki",
      cookie: "rh_session=alice",
      apiKey: "sk-test",
      body: { filename: "test.apkg", data: b64, maxCards: 5, teacherId: "professor-edward" },
    });
    await handlePackRoutes(ctx, makeDeps());
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.ok).toBe(true);
    expect(lastResponse?.body.deck_name).toBe("Test Deck");
    const pack = lastResponse?.body.pack;
    expect(pack.question_count).toBe(3);
    expect(pack.faculty[0].id).toContain("test-deck");
    expect(pack.faculty[0].displayName).toBe("Professor Edward");
    expect(pack.faculty[0].assetTeacherId).toBe("professor-edward");
    // Pack is now active for the importing session.
    const state = ruby.getOrCreate("rh:user:test-alice");
    expect(state.activePackId).toBe(pack.id);
    expect(state.faculty).toBe(pack.faculty[0].id);
    await ruby.flush();
    const persisted = await new StateStore(storePath).loadPacks();
    expect(persisted.map((p) => p.pack.id)).toContain(pack.id);

    resetActivePack();
    await getActivePack();
    const rubyAfterRestart = new RubyHighService({} as never, new StateStore(storePath));
    await rubyAfterRestart["hydrate"]();
    const visibleAfterRestart = availablePacksForSession("rh:user:test-alice").map((p) => p.id);
    expect(visibleAfterRestart).toContain(pack.id);
    expect(packForSession(rubyAfterRestart.getOrCreate("rh:user:test-alice")).id).toBe(pack.id);
    // OpenRouter was called once per card.
    // (The mock captured the LAST call; we rely on the question count
    // assertion to verify per-card calls happened.)
    expect(captured?.url).toContain("openrouter.ai");
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

function syntheticAnkiPack(id: string): ContentPack {
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

async function buildApkgFixture(deckName: string, cards: Array<{ front: string; back: string }>): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT, conf TEXT, models TEXT, dconf TEXT, tags TEXT)`);
  db.run(`CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT, sfld TEXT)`);
  db.run(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER)`);
  db.run(`INSERT INTO col (id, decks, conf, models, dconf, tags) VALUES (1, ?, '{}', '{}', '{}', '{}')`,
    [JSON.stringify({ "1": { name: deckName } })]);
  const FS = String.fromCharCode(0x1f);
  let nid = 1;
  for (const c of cards) {
    db.run(`INSERT INTO notes (id, flds, sfld) VALUES (?, ?, ?)`, [nid, `${c.front}${FS}${c.back}`, c.front]);
    db.run(`INSERT INTO cards (id, nid, did) VALUES (?, ?, ?)`, [nid, nid, 1]);
    nid++;
  }
  const dbBytes = db.export();
  db.close();
  const zip = new JSZip();
  zip.file("collection.anki21", dbBytes);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
