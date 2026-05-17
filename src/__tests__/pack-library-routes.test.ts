import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePackLibraryRoutes, type PackLibraryRouteContext } from "../pack-library-routes.js";
import { ORIGINAL_PACK_ID, getActivePack, getPackByIdForSession, registerPack, resetActivePack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService, WELCOME_HALL_PASS_GRANT } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  apiKeyHeader?: string | null;
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
    apiKeyHeader: opts.apiKeyHeader ?? null,
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

function emptyWelcomeHallPasses(stateKey: string): void {
  ruby.revokeHallPasses(stateKey, {
    amount: WELCOME_HALL_PASS_GRANT,
    idempotencyKey: `test:empty-welcome:${stateKey}`,
    source: "admin",
  });
}

function fakePack(id: string): ContentPack {
  return {
    id,
    name: id,
    description: "Imported test pack.",
    version: "0.0.1",
    faculty: [{
      id: `${id}-teacher`,
      displayName: id,
      shortName: id,
      subjects: ["test"],
      bio: "Test teacher.",
      accent: "#d22a2a",
      systemPrompt: "Teach the test pack.",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
    }],
    rooms: [{
      id: `${id}-room`,
      name: id,
      channelName: id,
      teacherId: `${id}-teacher`,
      description: "Test room.",
      teaches: true,
    }],
  };
}

function stubCourseGeneratorFetch() {
  const courseSpec = {
    choices: [{
      message: {
        content: JSON.stringify({
          courseTitle: "Signals Seminar",
          courseDescription: "A generated course on reading signals.",
          teacher: {
            displayName: "Dr. Signal",
            subject: "Signal Reading",
            description: "Turns noisy inputs into clear evidence questions.",
            quote: "Every signal needs a control.",
          },
          questions: [
            {
              prompt: "What does sampling bias change?",
              subject: "sampling",
              difficulty: "easy",
              options: {
                A: "What the signal can prove",
                B: "The name of the teacher",
                C: "The number of Hall Passes",
                D: "The classroom wallpaper",
              },
              correct: "A",
              explanation: "Sampling bias changes what a signal can prove.",
            },
            {
              prompt: "Why use a control group?",
              subject: "controls",
              difficulty: "medium",
              options: {
                A: "To remove all uncertainty",
                B: "To keep noisy explanations from winning too early",
                C: "To make the course shorter",
                D: "To avoid reading the materials",
              },
              correct: "B",
              explanation: "A control group helps test competing explanations.",
            },
            {
              prompt: "What does replication separate?",
              subject: "replication",
              difficulty: "medium",
              options: {
                A: "Rooms from teachers",
                B: "Patterns from luck",
                C: "Questions from answers",
                D: "Drafts from published packs",
              },
              correct: "B",
              explanation: "Replication checks whether a pattern survives another run.",
            },
            {
              prompt: "Which habit improves signal interpretation?",
              subject: "evidence",
              difficulty: "hard",
              options: {
                A: "Ignoring base rates",
                B: "Separating evidence from inference",
                C: "Deleting all controls",
                D: "Changing the answer after grading",
              },
              correct: "B",
              explanation: "Signal work improves when evidence and inference stay separate.",
            },
          ],
        }),
      },
    }],
  };
  const teacherPortrait = {
    choices: [{
      message: {
        images: [{ image_url: { url: "data:image/png;base64,VEVBQ0hFUg==" } }],
      },
    }],
  };
  const responses = [courseSpec, teacherPortrait];
  const fetchMock = vi.fn(async () => {
    const body = responses.shift() ?? teacherPortrait;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
      source: "official",
      installed: true,
      readOnly: true,
      builtIn: true,
      enabled: true,
      active: true,
      canEdit: false,
      canDelete: false,
      status: "published",
    });
  });

  it("keeps creator packs in search until a user installs them", async () => {
    signInUser("alice");
    const bobSessionId = signInUser("bob");
    const pack = fakePack("pack:shared-signals");
    pack.name = "Signals Shared";
    pack.description = "Creator lessons about sampling and controls.";
    pack.faculty[0]!.displayName = "Signal Coach";
    pack.faculty[0]!.subjects = ["sampling", "controls"];
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });

    let response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs.some((entry: { id: string }) => entry.id === pack.id)).toBe(false);

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=signals",
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs).toHaveLength(1);
    expect(response.body.packs[0]).toMatchObject({
      id: pack.id,
      source: "creator",
      installed: false,
      enabled: false,
      active: false,
      owner: false,
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/install`,
      cookie: "rh_session=bob",
      body: { enabled: true },
    });
    expect(response.status).toBe(200);
    expect(response.body.packs.find((entry: { id: string }) => entry.id === pack.id)).toMatchObject({
      source: "creator",
      installed: true,
      enabled: true,
      active: false,
    });

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=coach",
      cookie: "rh_session=bob",
    });
    expect(response.body.packs[0]).toMatchObject({
      id: pack.id,
      installed: true,
      enabled: true,
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/active`,
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(bobSessionId).activePackId).toBe(pack.id);
    expect(response.body.packs.find((entry: { id: string }) => entry.id === pack.id)).toMatchObject({
      installed: true,
      enabled: true,
      active: true,
    });
  });

  it("deletes draft packs owned by the signed-in user", async () => {
    signInUser("alice");

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Scratch Pack" },
    });
    expect(response.status).toBe(201);
    const draftId = response.body.draft.id as string;
    expect(response.body.draft.canDelete).toBe(true);

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}`,
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(response.body.drafts.some((draft: { id: string }) => draft.id === draftId)).toBe(false);
    expect((await ruby.listDraftPackRecords()).some((draft) => draft.id === draftId)).toBe(false);
  });

  it("generates a draft course teacher and questions without spending Hall Passes", async () => {
    const aliceSessionId = signInUser("alice");
    const fetchMock = stubCourseGeneratorFetch();

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Untitled Content Pack" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      body: {
        requestId: "course-generate-test-1",
        materials: [
          "# Sampling",
          "Sampling bias changes what a signal can prove.",
          "# Controls",
          "A control group keeps noisy explanations from winning too early.",
          "# Replication",
          "Replication separates patterns from luck.",
        ].join("\n"),
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.hallPassCost).toBe(0);
    expect(response.body.hallPasses).toBe(5);
    expect(response.body.draft.name).toBe("Signals Seminar");
    expect(response.body.teacher).toMatchObject({
      displayName: "Dr. Signal",
      subject: "Signal Reading",
      profileImageUrl: "data:image/png;base64,VEVBQ0hFUg==",
      generationCount: 1,
    });
    expect(response.body.teacher.questions).toHaveLength(4);
    expect(response.body.teacher.questions[0]).toMatchObject({
      prompt: "What does sampling bias change?",
      subject: "sampling",
      difficulty: "easy",
    });
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects publishing a new course slot without enough Hall Passes", async () => {
    const aliceSessionId = signInUser("alice");
    emptyWelcomeHallPasses(aliceSessionId);

    const created = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Empty Wallet Course" },
    });
    const draftId = created.body.draft.id as string;

    let response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Budget Coach",
        description: "Turns budget notes into study cards.",
      },
    });
    expect(response.status).toBe(201);
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
      body: { materials: "A course needs enough evidence to publish." },
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(402);
    expect(response.body.error).toContain("Not enough Hall Passes");
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);
  });

  it("deletes teachers from draft packs", async () => {
    signInUser("alice");

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Teacher Delete Draft" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: { displayName: "Delete Me", description: "Temporary teacher." },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(response.body.draft.teachers).toEqual([]);
    expect((await ruby.listDraftPackRecords()).find((draft) => draft.id === draftId)?.teachers).toEqual([]);
  });

  it("deletes session-imported packs owned by the signed-in user", async () => {
    const aliceSessionId = signInUser("alice");
    const pack = fakePack("anki:vocab-delete");
    registerPack(pack, aliceSessionId);
    await ruby.persistImportedPack(aliceSessionId, pack);

    let response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });
    expect(response.body.packs.find((entry: { id: string }) => entry.id === pack.id)).toMatchObject({
      owner: true,
      canDelete: true,
    });

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}`,
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(response.body.packs.some((entry: { id: string }) => entry.id === pack.id)).toBe(false);
    expect((await ruby.listPersistedPackRecords()).some((entry) => entry.pack.id === pack.id)).toBe(false);
    expect(getPackByIdForSession(pack.id, aliceSessionId)).toBeNull();
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
        clientRequestId: "teacher-save-debug-1",
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
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        clientRequestId: "teacher-save-debug-1",
        displayName: "Signal Coach",
        description: "Turns signal notes into study cards.",
        assetTeacherId: "sally-science",
      },
    });
    expect(response.status).toBe(200);
    expect(response.body.teacher.id).toBe(teacherId);
    expect(response.body.draft.teachers).toHaveLength(1);

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
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Connect OpenRouter");

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
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
    expect(response.body.hallPassCost).toBe(3);
    expect(response.body.hallPasses).toBe(2);
    expect(response.body.courseSlot).toMatchObject({
      draftId,
      status: "published",
    });
    const packId = response.body.pack.id as string;
    const persistedPackRecord = (await ruby.listPersistedPackRecords()).find((entry) => entry.pack.id === packId);
    expect(persistedPackRecord?.courseSlot).toMatchObject({
      draftId,
      status: "published",
      packId,
    });
    expect(persistedPackRecord?.pack.faculty[0]).toMatchObject({
      assetTeacherId: "sally-science",
      stats: { head: 3, heart: 1, hustle: 0, honor: 2 },
    });
    expect(response.body.pack).toMatchObject({
      name: "Signals Pack",
      source: "creator",
      installed: true,
      enabled: true,
      active: false,
      owner: true,
      canEdit: true,
      draftId,
      canDelete: true,
      readOnly: false,
    });
    expect(response.body.draft).toMatchObject({
      id: draftId,
      derivedFrom: packId,
      courseSlot: {
        status: "published",
        packId,
      },
    });
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(2);
    expect(ruby.getOrCreate(aliceSessionId).activePackId).not.toBe(packId);

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });
    const published = response.body.packs.find((pack: { id: string }) => pack.id === packId);
    expect(published).toMatchObject({
      source: "creator",
      installed: true,
      enabled: true,
      active: false,
      owner: true,
      canEdit: true,
      draftId,
    });
    expect(response.body.drafts.some((draft: { id: string }) => draft.id === draftId)).toBe(false);

    response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.draft).toMatchObject({
      id: draftId,
      derivedFrom: packId,
      name: "Signals Pack",
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

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(packId)}`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs.some((pack: { id: string }) => pack.id === packId)).toBe(false);
    expect((await ruby.listPersistedPackRecords()).some((entry) => entry.pack.id === packId)).toBe(false);
    expect((await ruby.listDraftPackRecords()).some((draft) => draft.id === draftId)).toBe(false);
    expect((await ruby.listPackInstallationRecords()).some((entry) => entry.packId === packId)).toBe(false);
    expect(getPackByIdForSession(packId, aliceSessionId)).toBeNull();
    expect(ruby.getOrCreate(aliceSessionId).activePackId).toBe(ORIGINAL_PACK_ID);
  });

  it("does not delete read-only or other users' packs", async () => {
    signInUser("alice");
    signInUser("bob");

    let response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(ORIGINAL_PACK_ID)}`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(400);

    response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Private Draft" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}`,
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(403);
  });
});
