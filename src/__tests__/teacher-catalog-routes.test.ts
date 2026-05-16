import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTeacherCatalogRoutes, type TeacherCatalogRouteContext } from "../teacher-catalog-routes.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import type { RatiTeacherAvatarProvider, RatiUserAvatar } from "../services/rati-avatar-provider.js";
import type { ConnectedTeacherCandidate } from "../services/teacher-providers.js";
import type { BankedQuestion } from "../types.js";
import { getActivePack, packForSession, resetActivePack } from "../content/registry.js";

class FakeAvatarProvider implements RatiTeacherAvatarProvider {
  grants: Array<{ walletAddress: string; avatarId: string; visibility: "public" | "unlisted" }> = [];
  readonly avatar: RatiUserAvatar = {
    id: "spartan",
    model: "avatar:spartan",
    name: "Spartan",
    description: "Teaches agent lore.",
    profileImage: "https://media.example.test/spartan.png",
    supportsTools: true,
  };

  configured(): boolean {
    return true;
  }

  async listUserAvatars(_walletAddress: string): Promise<RatiUserAvatar[]> {
    return [this.avatar];
  }

  async createTeacherAvatar(input: { walletAddress: string; name: string }): Promise<RatiUserAvatar> {
    return {
      ...this.avatar,
      id: "created",
      model: "avatar:created",
      name: input.name,
    };
  }

  async updateTeacherAvatar(): Promise<RatiUserAvatar> {
    return this.avatar;
  }

  async createTeacherGrant(input: { walletAddress: string; avatarId: string; visibility: "public" | "unlisted" }): Promise<{ grantId?: string | null }> {
    this.grants.push(input);
    return { grantId: `grant-${input.avatarId}` };
  }
}

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let provider: FakeAvatarProvider;
let lastResponse: { status: number; body: any } | null = null;

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  apiKeyHeader?: string | null;
  body?: Record<string, unknown>;
  wallet?: string | null;
}): TeacherCatalogRouteContext {
  lastResponse = null;
  const url = new URL(opts.path, "https://ruby.example.test");
  return {
    method: opts.method,
    pathname: url.pathname,
    url,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    apiKeyHeader: opts.apiKeyHeader ?? null,
    walletAddressHeader: opts.wallet ?? null,
    error: (_res, message, status = 500) => { lastResponse = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { lastResponse = { status, body: data }; },
    readJsonBody: async () => opts.body ?? {},
  };
}

function makeDeps() {
  return {
    auth,
    ruby,
    avatarProvider: provider,
    sessionIdFor: (cookie?: string | null) => auth.stateKeyForCookie(cookie),
    generateQuestions: async (candidate: ConnectedTeacherCandidate, _materials: string, opts: { questionCount?: number }): Promise<BankedQuestion[]> => {
      const count = opts.questionCount ?? 4;
      return Array.from({ length: count }, (_, index) => ({
        id: `rati-spartan-seed-${index + 1}`,
        prompt: `Question ${index + 1} from ${candidate.name}?`,
        type: "multiple-choice",
        options: { A: "Correct", B: "Wrong 1", C: "Wrong 2", D: "Wrong 3" },
        correct: "A",
        explanation: "The material says so.",
        subject: index % 2 === 0 ? "agents" : "visibility",
        difficulty: "medium",
        faculty: "rati-spartan",
      }));
    },
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

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-teachers-"));
  resetActivePack();
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"));
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
  provider = new FakeAvatarProvider();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("/teachers creator catalog", () => {
  it("requires OpenRouter AI before creating generated teacher drafts", async () => {
    signInUser("alice");

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/teachers/drafts",
      cookie: "rh_session=alice",
      body: {
        displayName: "Archivist",
        materials: "# Memory systems\nSpaced repetition schedules cards by recall strength.",
      },
    }), makeDeps());

    expect(lastResponse?.status).toBe(401);
    expect(lastResponse?.body.error).toContain("Enable OpenRouter AI");
  });

  it("creates a local pack teacher draft without wallet-linked RATi avatars", async () => {
    const aliceSessionId = signInUser("alice");

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/teachers/drafts",
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      body: {
        displayName: "Archivist",
        description: "Teaches from uploaded notes.",
        materials: "# Memory systems\nSpaced repetition schedules cards by recall strength.\n\n# Review loops\nHard cards come back sooner than easy cards.",
        questionCount: 2,
      },
    }), makeDeps());

    expect(lastResponse?.status).toBe(201);
    expect(lastResponse?.body.teacher).toMatchObject({
      displayName: "Archivist",
      status: "draft",
      visibility: "private",
      providerKind: "openrouter",
      questionCount: 2,
      owner: true,
    });
    expect(provider.grants).toEqual([]);
    const activePack = packForSession(ruby.getOrCreate(aliceSessionId));
    expect(activePack.faculty[0]?.provider).toEqual({ kind: "openrouter", supportsTools: true });
    expect(activePack.faculty[0]?.sourceCards).toHaveLength(2);
    expect(activePack.faculty[0]?.questions).toHaveLength(0);
  });

  it("creates a private teacher draft from a wallet-linked RATi avatar", async () => {
    const aliceSessionId = signInUser("alice");
    const wallet = "0x1111111111111111111111111111111111111111";

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/teachers/drafts",
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      wallet,
      body: {
        avatarId: "spartan",
        materials: "# Agent visibility\nCreators submit curriculum.",
        questionCount: 4,
        socialsUrl: "https://example.test/spartan",
      },
    }), makeDeps());

    expect(lastResponse?.status).toBe(201);
    expect(lastResponse?.body.teacher).toMatchObject({
      displayName: "Spartan",
      status: "draft",
      visibility: "private",
      questionCount: 4,
      socialsUrl: "https://example.test/spartan",
      owner: true,
    });
    const state = ruby.getOrCreate(aliceSessionId);
    expect(state.activePackId).toBe(lastResponse?.body.teacher.packId);
    expect(packForSession(state).faculty[0]?.provider).toMatchObject({
      kind: "rati-openai-compatible",
      model: "avatar:spartan",
    });

    await handleTeacherCatalogRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/teachers",
      cookie: "rh_session=alice",
    }), makeDeps());
    expect(lastResponse?.body.teachers).toHaveLength(1);
    expect(lastResponse?.body.teachers[0].owner).toBe(true);
  });

  it("publishes a custom teacher globally and lets another user activate it", async () => {
    signInUser("alice");
    const wallet = "0x1111111111111111111111111111111111111111";

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/teachers/drafts",
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      body: {
        walletAddress: wallet,
        avatarId: "spartan",
        materials: "# Agent visibility\nCreators submit curriculum.",
        questionCount: 4,
      },
    }), makeDeps());
    const teacherId = lastResponse?.body.teacher.id;

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: `/api/apps/ruby-high/teachers/${teacherId}/publish`,
      cookie: "rh_session=alice",
      body: { visibility: "public" },
    }), makeDeps());
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.teacher).toMatchObject({
      id: teacherId,
      status: "published",
      visibility: "public",
    });
    expect(provider.grants).toEqual([{
      walletAddress: wallet,
      avatarId: "spartan",
      visibility: "public",
    }]);

    const bobSessionId = signInUser("bob");
    await handleTeacherCatalogRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/teachers",
      cookie: "rh_session=bob",
    }), makeDeps());
    expect(lastResponse?.body.teachers).toHaveLength(1);
    expect(lastResponse?.body.teachers[0]).toMatchObject({
      id: teacherId,
      owner: false,
      visibility: "public",
    });

    await handleTeacherCatalogRoutes(makeCtx({
      method: "POST",
      path: `/api/apps/ruby-high/teachers/${teacherId}/activate`,
      cookie: "rh_session=bob",
    }), makeDeps());
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.pack.id).toBe(lastResponse?.body.teacher.packId);
    expect(ruby.getOrCreate(bobSessionId).activePackId).toBe(lastResponse?.body.teacher.packId);
    expect(packForSession(ruby.getOrCreate(bobSessionId)).name).toBe("Spartan Teacher");
  });
});
