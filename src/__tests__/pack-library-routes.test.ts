import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePackLibraryRoutes, type PackLibraryRouteContext } from "../pack-library-routes.js";
import { ORIGINAL_PACK_ID, getActivePack, resetActivePack } from "../content/registry.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  body?: Record<string, unknown>;
}): PackLibraryRouteContext {
  lastResponse = null;
  const url = new URL(opts.path, "https://ruby.example.test");
  return {
    method: opts.method,
    pathname: url.pathname,
    url,
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
  const userId = `test-${token}`;
  const now = Date.now();
  auth.injectSessionForTest(token, {
    userId,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  });
  return `rh:user:${userId}`;
}

async function route(opts: Parameters<typeof makeCtx>[0]): Promise<{ status: number; body: any }> {
  const handled = await handlePackLibraryRoutes(makeCtx(opts), makeDeps());
  expect(handled).toBe(true);
  expect(lastResponse).not.toBeNull();
  return lastResponse!;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-pack-library-"));
  resetActivePack();
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"));
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

describe("/pack-library", () => {
  it("requires auth", async () => {
    const response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
    });

    expect(response.status).toBe(401);
  });

  it("shows the built-in Ruby High pack as read-only, enabled, and active", async () => {
    signInUser("alice");

    const response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(response.body.drafts).toEqual([]);
    expect(response.body.packs[0]).toMatchObject({
      id: ORIGINAL_PACK_ID,
      readOnly: true,
      builtIn: true,
      enabled: true,
      active: true,
      canEdit: false,
      status: "published",
    });
  });

  it("persists draft packs, generates cards manually, publishes, and keeps enable separate from active", async () => {
    const aliceSessionId = signInUser("alice");

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: {
        name: "Signals Pack",
        description: "Teacher-authored markdown lessons.",
      },
    });
    expect(response.status).toBe(201);
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Signal Coach",
        description: "Turns signal notes into study cards.",
        assetTeacherId: "sally-science",
        stats: { head: 3, heart: 1, hustle: 0, honor: 2 },
      },
    });
    expect(response.status).toBe(201);
    const teacherId = response.body.teacher.id as string;
    expect(response.body.teacher).toMatchObject({
      assetTeacherId: "sally-science",
      stats: { head: 3, heart: 1, hustle: 0, honor: 2 },
    });

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
      body: {
        materials: [
          "# Sampling",
          "Sampling bias changes what a signal can prove.",
          "",
          "# Controls",
          "A control group keeps noisy explanations from winning too early.",
          "",
          "# Replication",
          "Replication is the check that separates patterns from luck.",
        ].join("\n"),
      },
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.teacher.generationCount).toBe(1);
    expect(response.body.teacher.questions.length).toBeGreaterThan(1);
    const firstQuestionId = response.body.teacher.questions[0].id as string;

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/${firstQuestionId}`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.teacher.questions.some((q: { id: string }) => q.id === firstQuestionId)).toBe(false);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    const packId = response.body.pack.id as string;
    const persistedPack = (await ruby.listPersistedPackRecords()).find((entry) => entry.pack.id === packId)?.pack;
    expect(persistedPack?.faculty[0]).toMatchObject({
      assetTeacherId: "sally-science",
      stats: { head: 3, heart: 1, hustle: 0, honor: 2 },
    });
    expect(response.body.pack).toMatchObject({
      name: "Signals Pack",
      enabled: true,
      active: false,
      owner: true,
      canEdit: false,
      readOnly: false,
    });
    expect(ruby.getOrCreate(aliceSessionId).activePackId).not.toBe(packId);

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });
    const published = response.body.packs.find((pack: { id: string }) => pack.id === packId);
    expect(published).toMatchObject({
      enabled: true,
      active: false,
      owner: true,
      canEdit: false,
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(packId)}/active`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(aliceSessionId).activePackId).toBe(packId);
    expect(response.body.packs.find((pack: { id: string }) => pack.id === packId)).toMatchObject({
      enabled: true,
      active: true,
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(packId)}/install`,
      cookie: "rh_session=alice",
      body: { enabled: false },
    });
    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(aliceSessionId).activePackId).toBe(ORIGINAL_PACK_ID);
    expect(response.body.packs.find((pack: { id: string }) => pack.id === packId)).toMatchObject({
      enabled: false,
      active: false,
    });
    expect(response.body.packs.find((pack: { id: string }) => pack.id === ORIGINAL_PACK_ID)).toMatchObject({
      enabled: true,
      active: true,
      readOnly: true,
    });
  });
});
