import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { getActivePack, registerPack, resetActivePack, setActivePack } from "../content/registry.js";
import { AuthService } from "../services/auth-service.js";
import { AgentAccessService } from "../services/agent-access-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import type {
  AuthSessionRecord,
  AuthStoreSnapshot,
  AuthUserRecord,
  StateStoreLike,
  StoredContentPackRecord,
  StoredDraftContentPackRecord,
  StoredPackInstallationRecord,
  StoredTeacherRecord,
} from "../services/state-store.js";
import type { ContentPack } from "../content/types.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";
import type { QuizState } from "../types.js";

afterEach(() => {
  resetActivePack();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

class FailingSessionStore implements StateStoreLike {
  async load(): Promise<Map<string, QuizState>> { return new Map(); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return { users: [], sessions: [] }; }
  async loadPacks(): Promise<StoredContentPackRecord[]> { return []; }
  async loadTeachers(): Promise<StoredTeacherRecord[]> { return []; }
  async loadDraftPacks(): Promise<StoredDraftContentPackRecord[]> { return []; }
  async loadPackInstallations(): Promise<StoredPackInstallationRecord[]> { return []; }
  async saveSession(_state: QuizState): Promise<void> { throw new Error("DynamoDB unavailable"); }
  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}
  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}
  async savePack(_record: StoredContentPackRecord): Promise<void> {}
  async saveDraftPack(_record: StoredDraftContentPackRecord): Promise<void> {}
  async savePackInstallation(_record: StoredPackInstallationRecord): Promise<void> {}
  async deletePack(_ownerSessionId: string | null, _packId: string): Promise<void> {}
  async deleteTeacher(_teacherId: string): Promise<void> {}
  async saveTeacher(_record: StoredTeacherRecord): Promise<void> {}
  async deleteDraftPack(_draftId: string): Promise<void> {}
  async deletePackInstallation(_userId: string, _packId: string): Promise<void> {}
  async deleteAuthSession(_token: string): Promise<void> {}
  async save(_states: Iterable<QuizState>): Promise<void> {}
  describe(): string { return "failing-test-store"; }
}

class MemorySessionStore implements StateStoreLike {
  sessions = new Map<string, QuizState>();
  async load(): Promise<Map<string, QuizState>> { return new Map(this.sessions); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return { users: [], sessions: [] }; }
  async loadPacks(): Promise<StoredContentPackRecord[]> { return []; }
  async loadTeachers(): Promise<StoredTeacherRecord[]> { return []; }
  async loadDraftPacks(): Promise<StoredDraftContentPackRecord[]> { return []; }
  async loadPackInstallations(): Promise<StoredPackInstallationRecord[]> { return []; }
  async saveSession(state: QuizState): Promise<void> { this.sessions.set(state.sessionId, state); }
  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}
  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}
  async savePack(_record: StoredContentPackRecord): Promise<void> {}
  async saveDraftPack(_record: StoredDraftContentPackRecord): Promise<void> {}
  async savePackInstallation(_record: StoredPackInstallationRecord): Promise<void> {}
  async deletePack(_ownerSessionId: string | null, _packId: string): Promise<void> {}
  async deleteTeacher(_teacherId: string): Promise<void> {}
  async saveTeacher(_record: StoredTeacherRecord): Promise<void> {}
  async deleteDraftPack(_draftId: string): Promise<void> {}
  async deletePackInstallation(_userId: string, _packId: string): Promise<void> {}
  async deleteAuthSession(_token: string): Promise<void> {}
  async save(states: Iterable<QuizState>): Promise<void> {
    this.sessions = new Map(Array.from(states).map((s) => [s.sessionId, s]));
  }
  async flush(): Promise<void> {}
  describe(): string { return "memory-test-store"; }
}

function runtimeFor(
  ruby: RubyHighService,
  faculty?: FacultyService,
  auth?: AuthService | null,
  agentAccess?: AgentAccessService | null,
) {
  return {
    agentId: "test-agent",
    getService(type: string) {
      if (type === AuthService.serviceType) return auth ?? null;
      if (type === AgentAccessService.serviceType) return agentAccess ?? null;
      if (type === RubyHighService.serviceType) return ruby;
      if (type === FacultyService.serviceType) return faculty;
      return null;
    },
  };
}

function makeCommandCtx(
  ruby: RubyHighService,
  body: Record<string, unknown> = {
    type: "create-character",
    name: "Ari",
    playbookId: "overachiever",
    stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
    arcAnswer: "I want the transcript to look impossible.",
    personality: "intense but kind",
  },
  faculty?: FacultyService,
  apiKeyHeader?: string | null,
  auth?: AuthService | null,
  cookieHeader?: string | null,
  options: {
    contentTypeHeader?: string | string[] | null;
    originHeader?: string | string[] | null;
    callbackOrigin?: string;
    agentAccess?: AgentAccessService | null;
  } = {},
): {
  ctx: RouteContext;
  response: { status: number; body: any } | null;
  getHeader: (name: string) => string | string[] | undefined;
} {
  let response: { status: number; body: any } | null = null;
  const headers = new Map<string, string | string[]>();
  const res = {
    setHeader(name: string, value: string | string[]): void {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string): string | string[] | undefined {
      return headers.get(name.toLowerCase());
    },
  };
  const ctx: RouteContext = {
    method: "POST",
    pathname: "/api/apps/ruby-high/session/test-session/command",
    url: new URL("https://ruby-high.test/api/apps/ruby-high/session/test-session/command"),
    runtime: runtimeFor(ruby, faculty, auth, options.agentAccess),
    res,
    cookieHeader: cookieHeader ?? null,
    apiKeyHeader,
    contentTypeHeader: options.contentTypeHeader === undefined ? "application/json" : options.contentTypeHeader,
    originHeader: options.originHeader ?? null,
    callbackUrlBuilder: (path) => `${options.callbackOrigin ?? "https://ruby-high.test"}${path}`,
    error: (_res, message, status = 500) => { response = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { response = { status, body: data }; },
    readJsonBody: async () => body,
  };
  return { ctx, get response() { return response; }, getHeader: (name) => headers.get(name.toLowerCase()) };
}

function makeGetCtx(
  ruby: RubyHighService,
  path: string,
  auth?: AuthService | null,
  cookieHeader?: string | null,
): {
  ctx: RouteContext;
  response: { status: number; body: any } | null;
} {
  let response: { status: number; body: any } | null = null;
  const ctx: RouteContext = {
    method: "GET",
    pathname: path.split("?")[0] ?? path,
    url: new URL(`https://ruby-high.test${path}`),
    runtime: runtimeFor(ruby, undefined, auth),
    res: {},
    cookieHeader: cookieHeader ?? null,
    error: (_res, message, status = 500) => { response = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { response = { status, body: data }; },
    readJsonBody: async () => ({}),
  };
  return { ctx, get response() { return response; } };
}

function singleQuestionPack(): ContentPack {
  return {
    id: "route-test-pack",
    name: "Route Test Pack",
    description: "Small pack for command route tests.",
    version: "1.0.0",
    faculty: [{
      id: "ruby",
      displayName: "Ruby",
      shortName: "Ruby",
      subjects: ["homeroom"],
      bio: "Test teacher.",
      accent: "#d22a2a",
      systemPrompt: "Teach the test card.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [{
        id: "route-test-q1",
        prompt: "What is 1 + 1?",
        options: { A: "2", B: "3", C: "4", D: "5" },
        correct: "A",
        explanation: "One plus one is two.",
        subject: "homeroom",
        difficulty: "easy",
        faculty: "ruby",
      }],
    }],
    courses: [{
      id: "ruby",
      title: "Homeroom",
      facultyId: "ruby",
      roomId: "ruby-room",
      teacherTemplateId: "ruby",
      subjects: ["homeroom"],
    }],
    rooms: [{
      id: "ruby-room",
      name: "Homeroom",
      channelName: "homeroom",
      teacherId: "ruby",
      description: "Ruby's classroom.",
      teaches: true,
    }],
  };
}

function rubyHomeroomSocialPack(): ContentPack {
  const pack = singleQuestionPack();
  pack.id = "route-test-homeroom-social-pack";
  pack.faculty[0]!.questions = Array.from({ length: 3 }, (_, i) => ({
    id: `route-test-ruby-q${i + 1}`,
    prompt: `Ruby homeroom card ${i + 1}?`,
    options: { A: "yes", B: "no", C: "maybe", D: "later" },
    correct: "A",
    explanation: "Test card.",
    subject: "homeroom",
    difficulty: "easy",
    faculty: "ruby",
  }));
  return pack;
}

function sourceCardPack(): ContentPack {
  return {
    id: "anki:route-test-source-pack",
    name: "Route Test Source Pack",
    description: "Source-card pack for command route tests.",
    version: "1.0.0",
    faculty: [{
      id: "vocab-source-course",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["vocab"],
      bio: "Test teacher for source cards.",
      accent: "#3aa3e0",
      systemPrompt: "Teach the source card.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [],
      sourceCards: [{
        id: "route-test-source-card-1",
        kind: "basic",
        front: "What does ephemeral mean?",
        back: "short-lived",
        acceptedAnswers: ["short-lived", "brief"],
        deckName: "Route Test Source Pack",
        tags: ["vocab"],
        subject: "vocab",
        difficulty: "medium",
        faculty: "vocab-source-course",
      }],
    }],
    courses: [{
      id: "vocab-source-course",
      title: "Route Test Source",
      facultyId: "vocab-source-course",
      roomId: "vocab-source-room",
      teacherTemplateId: "sally-science",
      subjects: ["vocab"],
    }],
    rooms: [{
      id: "vocab-source-room",
      name: "Route Test Source",
      channelName: "route-test-source",
      teacherId: "vocab-source-course",
      description: "Source-card classroom.",
      teaches: true,
    }],
  };
}

describe("command route persistence and scheduler misses", () => {
  it("returns a storage error instead of a false success when flushSession fails", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new FailingSessionStore());
    const harness = makeCommandCtx(ruby);

    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(503);
    expect(harness.response?.body.error).toMatch(/could not be persisted/i);
  });

  it("mints a guest session before no-cookie command mutations", async () => {
    await getActivePack();
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const harness = makeCommandCtx(
        ruby,
        {
          type: "create-character",
          name: "Ari",
          playbookId: "overachiever",
          stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
          arcAnswer: "I want the transcript to look impossible.",
          personality: "intense but kind",
        },
        undefined,
        null,
        auth,
        null,
      );
      const handled = await handleAppRoutes(harness.ctx);

      expect(handled).toBe(true);
      expect(harness.response?.status).toBe(200);
      expect(ruby.getOrCreate("rh:anonymous").character).toBeNull();
      const cookie = String(harness.getHeader("set-cookie"));
      const token = cookie.match(/rh_session=([^;]+)/)?.[1];
      expect(token).toBeTruthy();
      const record = auth.resolve(decodeURIComponent(token!));
      expect(record).not.toBeNull();
      expect(ruby.getOrCreate(auth.stateKeyForRecord(record!)).character?.name).toBe("Ari");
    } finally {
      await auth.stop();
    }
  });

  it("keeps browser commands on the launched agent viewer session", async () => {
    await getActivePack();
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    const agentRuntime = {
      agentId: "agent-viewer-route-test",
      character: { name: "ElizaOS Agent" },
      getService: () => null,
      getSetting: (key: string) =>
        key === "RUBY_HIGH_AGENT_TOKEN_SECRET"
          ? "agent-viewer-route-secret"
          : null,
    };
    const agentAccess = new AgentAccessService(agentRuntime as never, store);
    await agentAccess.hydrate();
    try {
      const issued = await agentAccess.issueDeviceCode({
        agentName: "ElizaOS Agent",
        scopes: ["school:read", "student:play"],
      });
      const credential = await agentAccess.approveDeviceCode(
        issued.userCode,
        "rh:user:owner",
      );
      const launchCode = await agentAccess.createLaunch(credential.id);
      const launched = await agentAccess.consumeLaunch(launchCode);
      const cookie = agentAccess.buildViewerCookie(
        launched.viewerToken,
        false,
      );
      ruby.getOrCreate(credential.stateKey).hasSeenIntro = false;

      const harness = makeCommandCtx(
        ruby,
        { type: "mark-intro-seen" },
        undefined,
        null,
        auth,
        cookie,
        { agentAccess },
      );

      expect(await handleAppRoutes(harness.ctx)).toBe(true);
      expect(harness.response?.status).toBe(200);
      expect(ruby.getOrCreate(credential.stateKey).hasSeenIntro).toBe(true);
      expect(auth.sessionCount()).toBe(0);
      expect(harness.getHeader("set-cookie")).toBeUndefined();
    } finally {
      await agentAccess.stop();
      await auth.stop();
    }
  });

  it("updates an autosaved character candidate without resetting career state", async () => {
    await getActivePack();
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const created = makeCommandCtx(ruby);

    expect(await handleAppRoutes(created.ctx)).toBe(true);
    expect(created.response?.status).toBe(200);

    const state = ruby.getOrCreate("rh:anonymous");
    state.character!.yearbook.push({
      grade: "9",
      completedAt: 123,
      summary: { correct: 4, total: 5 },
    });

    const updated = makeCommandCtx(ruby, {
      type: "update-character",
      name: "Mina",
      playbookId: "lifer",
      stats: { head: -1, heart: 2, hustle: 1, honor: 0 },
      arcAnswer: "I want to make this school impossible to ignore.",
      flavorQuote: "homeroom is not ready for me",
      personality: "warm, direct, and extremely prepared",
      portraitDataUrl: "/api/apps/ruby-high/assets/students/lyra-full.png",
    });

    expect(await handleAppRoutes(updated.ctx)).toBe(true);
    expect(updated.response?.status).toBe(200);

    const character = ruby.getOrCreate("rh:anonymous").character!;
    expect(character.name).toBe("Mina");
    expect(character.playbookId).toBe("lifer");
    expect(character.yearbook).toHaveLength(1);
    expect(character.yearbook[0]?.grade).toBe("9");
    expect(character.portraitDataUrl).toBe("/api/apps/ruby-high/assets/students/lyra-full.png");
    expect(character.advantageRollBonuses).toEqual({ "9": 1, "10": 1, "11": 1, "12": 1 });
  });

  it("rejects bad browser command mutations before minting a guest session", async () => {
    await getActivePack();
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const crossOrigin = makeCommandCtx(
        ruby,
        { type: "mark-intro-seen" },
        undefined,
        null,
        auth,
        null,
        { originHeader: "https://evil.example" },
      );

      expect(await handleAppRoutes(crossOrigin.ctx)).toBe(true);
      expect(crossOrigin.response).toEqual({
        status: 403,
        body: { error: "Command request origin is not allowed." },
      });
      expect(crossOrigin.getHeader("set-cookie")).toBeUndefined();

      const nonJson = makeCommandCtx(
        ruby,
        { type: "mark-intro-seen" },
        undefined,
        null,
        auth,
        null,
        { contentTypeHeader: "text/plain" },
      );

      expect(await handleAppRoutes(nonJson.ctx)).toBe(true);
      expect(nonJson.response).toEqual({
        status: 415,
        body: { error: "Command requests must be sent as JSON." },
      });
      expect(nonJson.getHeader("set-cookie")).toBeUndefined();
      expect(auth.sessionCount()).toBe(0);
    } finally {
      await auth.stop();
    }
  });

  it("rejects unknown command types without mutating state", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    const harness = makeCommandCtx(ruby, {
      type: "typo-command",
      prompt: "this used to be accepted as a suggestion",
    });

    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(400);
    expect(harness.response?.body.error).toBe("Unknown command type: typo-command");
    expect(ruby.getOrCreate("rh:anonymous").character).toBeNull();
  });

  it("lets two routed clients contribute to the same public live-room goal", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.setSystemTime(now);
    setActivePack(rubyHomeroomSocialPack());
    const store = new MemorySessionStore();
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, store);
    ruby.setFacultyService(faculty);
    const auth = await AuthService.start({} as never, store);
    try {
      const firstSession = await auth.createGuestSession();
      const secondSession = await auth.createGuestSession();
      const firstCookie = `rh_session=${firstSession.token}`;
      const secondCookie = `rh_session=${secondSession.token}`;
      const firstState = ruby.getOrCreate(auth.stateKeyForRecord(firstSession.record));
      const secondState = ruby.getOrCreate(auth.stateKeyForRecord(secondSession.record));

      ruby.createCharacter(firstState.sessionId, {
        name: "Route Goal Noor",
        playbookId: "overachiever",
        stats: { head: 2, heart: 1, hustle: 0, honor: 1 },
        arcAnswer: "I help shared goals move.",
        personality: "Brisk and kind.",
      });
      ruby.createCharacter(secondState.sessionId, {
        name: "Route Goal Mina",
        playbookId: "overachiever",
        stats: { head: 1, heart: 2, hustle: 1, honor: 0 },
        arcAnswer: "I watch the room progress.",
        personality: "Steady and bright.",
      });
      for (const state of [firstState, secondState]) {
        state.currentGrade = "10";
        state.faculty = "ruby";
        state.character!.dailyClasses = {
          "10:ruby:2026-06-15": {
            grade: "10",
            facultyId: "ruby",
            date: "2026-06-15",
            status: "complete",
            questionCount: 3,
            correctCount: 3,
            scoreTotal: 300,
            scoreMax: 300,
            letterGrade: "A",
            completedAt: now,
            updatedAt: now,
          },
        };
      }

      const runCommand = async (cookieHeader: string, body: Record<string, unknown>) => {
        const harness = makeCommandCtx(ruby, body, faculty, null, auth, cookieHeader);
        const handled = await handleAppRoutes(harness.ctx);
        expect(handled).toBe(true);
        if (harness.response?.status !== 200) throw new Error(JSON.stringify(harness.response?.body));
        expect(harness.response?.status).toBe(200);
        return harness.response!.body;
      };
      await runCommand(firstCookie, { type: "pick", faculty: "ruby" });
      await runCommand(secondCookie, { type: "pick", faculty: "ruby" });
      await runCommand(firstCookie, { type: "answer", picked: firstState.current!.correctChoice });
      await runCommand(secondCookie, { type: "answer", picked: secondState.current!.correctChoice });

      const world = ruby.getSchoolWorldSnapshot(10, now);
      expect(world.activeRooms[0]).toMatchObject({
        grade: "10",
        facultyId: "ruby",
        activeStudents: 2,
        goal: {
          progress: 2,
          target: 3,
          complete: false,
          updatedAt: now,
        },
      });
      expect(world.recentEvents.filter((event) => event.kind === "room.goal-progress")).toEqual([
        expect.objectContaining({
          kind: "room.goal-progress",
          faculty: "ruby",
          grade: "10",
          progress: 2,
          target: 3,
          complete: false,
        }),
      ]);
      expect(JSON.stringify(world.recentEvents)).not.toContain("rh:guest");
      expect(JSON.stringify(world.recentEvents)).not.toContain("Route Goal Noor");
      expect(JSON.stringify(world.recentEvents)).not.toContain("Route Goal Mina");
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it("toggles public world presence separately from social posting consent", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.setSystemTime(now);
    setActivePack(rubyHomeroomSocialPack());
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const session = await auth.createGuestSession();
      const cookie = `rh_session=${session.token}`;
      const state = ruby.getOrCreate(auth.stateKeyForRecord(session.record));
      ruby.createCharacter(state.sessionId, {
        name: "Presence Noor",
        playbookId: "overachiever",
        stats: { head: 2, heart: 1, hustle: 0, honor: 1 },
        arcAnswer: "I want control over where I appear.",
        personality: "Careful but public.",
      });
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.character!.socialConsent = true;
      state.character!.dailyClasses = {
        "10:ruby:2026-06-15": {
          grade: "10",
          facultyId: "ruby",
          date: "2026-06-15",
          status: "complete",
          questionCount: 3,
          correctCount: 3,
          scoreTotal: 300,
          scoreMax: 300,
          letterGrade: "A",
          completedAt: now,
          updatedAt: now,
        },
      };

      expect(ruby.getSchoolWorldSnapshot(10, now).activeStudents).toBe(1);
      const hide = makeCommandCtx(ruby, { type: "set-public-presence", publicWorldVisible: false }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(hide.ctx)).toBe(true);
      expect(hide.response?.status).toBe(200);
      expect(hide.response?.body.message).toBe("Public world presence hidden");
      expect(state.character!.socialConsent).toBe(true);
      expect(state.character!.publicWorldVisible).toBe(false);
      const hiddenWorld = ruby.getSchoolWorldSnapshot(10, now);
      expect(hiddenWorld.activeStudents).toBe(0);
      expect(JSON.stringify(hiddenWorld)).not.toContain("Presence Noor");

      const show = makeCommandCtx(ruby, { type: "set-public-presence", publicWorldVisible: true }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(show.ctx)).toBe(true);
      expect(show.response?.status).toBe(200);
      expect(show.response?.body.message).toBe("Public world presence enabled");
      expect(state.character!.socialConsent).toBe(true);
      expect(state.character!.publicWorldVisible).toBe(true);
      expect(ruby.getSchoolWorldSnapshot(10, now).activeStudents).toBe(1);
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it("blocks public presence when a student name needs review", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.setSystemTime(now);
    setActivePack(rubyHomeroomSocialPack());
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const session = await auth.createGuestSession();
      const cookie = `rh_session=${session.token}`;
      const state = ruby.getOrCreate(auth.stateKeyForRecord(session.record));
      ruby.createCharacter(state.sessionId, {
        name: "Admin",
        playbookId: "overachiever",
        stats: { head: 2, heart: 1, hustle: 0, honor: 1 },
        arcAnswer: "I want control over where I appear.",
        personality: "Careful but public.",
      });
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.character!.socialConsent = true;
      state.character!.publicWorldVisible = false;
      state.character!.dailyClasses = {
        "10:ruby:2026-06-15": {
          grade: "10",
          facultyId: "ruby",
          date: "2026-06-15",
          status: "complete",
          questionCount: 3,
          correctCount: 3,
          scoreTotal: 300,
          scoreMax: 300,
          letterGrade: "A",
          completedAt: now,
          updatedAt: now,
        },
      };

      const show = makeCommandCtx(ruby, { type: "set-public-presence", publicWorldVisible: true }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(show.ctx)).toBe(true);
      expect(show.response?.status).toBe(400);
      expect(show.response?.body.error).toBe("Choose a student name that is not a reserved staff or system name before joining school rooms.");
      expect(state.character!.publicWorldVisible).toBe(false);

      const world = ruby.getSchoolWorldSnapshot(10, now);
      expect(world.activeStudents).toBe(0);
      expect(JSON.stringify(world)).not.toContain("Admin");
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it("lets a player hide and report public world events from their own feed", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.setSystemTime(now);
    setActivePack(rubyHomeroomSocialPack());
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const session = await auth.createGuestSession();
      const cookie = `rh_session=${session.token}`;
      const stateKey = auth.stateKeyForRecord(session.record);
      const state = ruby.getOrCreate(stateKey);
      ruby.createCharacter(state.sessionId, {
        name: "Moderator Noor",
        playbookId: "overachiever",
        stats: { head: 2, heart: 1, hustle: 0, honor: 1 },
        arcAnswer: "I curate what I see.",
        personality: "Protective and precise.",
      });
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.character!.dailyClasses = {
        "10:ruby:2026-06-15": {
          grade: "10",
          facultyId: "ruby",
          date: "2026-06-15",
          status: "complete",
          questionCount: 3,
          correctCount: 3,
          scoreTotal: 300,
          scoreMax: 300,
          letterGrade: "A",
          completedAt: now,
          updatedAt: now,
        },
      };
      state.schoolEvents.push({
        id: "school:event:hide-route",
        kind: "comic.page-unlocked",
        at: now,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-hide-route",
        pageNumber: 2,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Hidden route page",
      });

      const visible = makeGetCtx(ruby, "/api/apps/ruby-high/world?limit=10", auth, cookie);
      expect(await handleAppRoutes(visible.ctx)).toBe(true);
      expect(visible.response?.status).toBe(200);
      expect(JSON.stringify(visible.response?.body.world.recentEvents)).toContain("Hidden route page");
      const eventId = visible.response!.body.world.recentEvents.find((event: { label?: string }) => event.label === "Hidden route page").id;

      const hide = makeCommandCtx(ruby, { type: "hide-public-world-event", eventId }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(hide.ctx)).toBe(true);
      expect(hide.response?.status).toBe(200);
      expect(hide.response?.body.message).toBe("Public world event hidden");
      expect(state.publicWorldHiddenEventIds).toEqual([eventId]);

      const hidden = makeGetCtx(ruby, "/api/apps/ruby-high/world?limit=10", auth, cookie);
      expect(await handleAppRoutes(hidden.ctx)).toBe(true);
      expect(hidden.response?.status).toBe(200);
      expect(JSON.stringify(hidden.response?.body.world.recentEvents)).not.toContain("Hidden route page");

      const report = makeCommandCtx(ruby, {
        type: "report-public-world-event",
        eventId,
        reason: "spoiler and ugly",
      }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(report.ctx)).toBe(true);
      expect(report.response?.status).toBe(200);
      expect(report.response?.body.message).toBe("Public world event reported");
      expect(state.publicWorldEventReports).toEqual([
        expect.objectContaining({
          eventId,
          reason: "spoiler and ugly",
          createdAt: now,
        }),
      ]);
      expect(state.publicWorldHiddenEventIds).toEqual([eventId]);
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it("rate limits repeated school activity safety actions per player", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 13));
    setActivePack(singleQuestionPack());
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    const auth = await AuthService.start({} as never, store);
    try {
      const session = await auth.createGuestSession();
      const cookie = `rh_session=${session.token}`;
      const eventId = `world:event:${"a".repeat(16)}`;
      for (let i = 0; i < 6; i += 1) {
        const ok = makeCommandCtx(ruby, { type: "hide-public-world-event", eventId }, undefined, null, auth, cookie);
        expect(await handleAppRoutes(ok.ctx)).toBe(true);
        expect(ok.response?.status).toBe(200);
      }

      const limited = makeCommandCtx(ruby, {
        type: "report-public-world-event",
        eventId,
        reason: "repeat",
      }, undefined, null, auth, cookie);
      expect(await handleAppRoutes(limited.ctx)).toBe(true);
      expect(limited.response?.status).toBe(429);
      expect(limited.response?.body.error).toBe("Too many school activity safety actions — slow down a moment.");
      expect(limited.getHeader("Retry-After")).toBe("60");
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it("returns a no-op success when offline pick has no scheduled card due", async () => {
    setActivePack(singleQuestionPack());
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const sid = "rh:anonymous";
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
      yearbook: [],
      createdAt: Date.now(),
    };
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.submitAnswer(sid, "A");
    ruby.clearBoard(sid);

    const harness = makeCommandCtx(ruby, { type: "pick" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body).toMatchObject({
      success: true,
      noQuestionDue: true,
      message: "No scheduled question is ready right now.",
    });
    expect(harness.response?.body.session.telemetry.current).toBeNull();
  });

  it("returns a no-op success when offline pick races an existing live board", async () => {
    setActivePack(singleQuestionPack());
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const sid = "rh:anonymous";
    ruby.createCharacter(sid, {
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
    });
    const first = ruby.pickAndPose(sid, { faculty: "ruby" });

    const harness = makeCommandCtx(ruby, { type: "pick" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body).toMatchObject({
      success: true,
      questionAlreadyLive: true,
      message: "Question already live.",
    });
    expect(harness.response?.body.session.telemetry.current.id).toBe(first.current!.id);
  });

  it("uses the sponsored hosted OpenRouter key for MC generation when configured", async () => {
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-hosted");
    const pack = sourceCardPack();
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const sid = "rh:anonymous";
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.createCharacter(sid, {
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
    });
    ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
      }), { status: 200 }),
    );

    const harness = makeCommandCtx(ruby, { type: "generate-mc" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body.message).toBe("Multiple choice generated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows MC generation with the hosted key after server AI is active", async () => {
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-hosted");
    const pack = sourceCardPack();
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const sid = "rh:anonymous";
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.grantHallPasses(sid, {
      amount: 1,
      idempotencyKey: "test:command-hosted-ai-seed",
      source: "admin",
    });
    ruby.activateHostedAiAccess(sid, {
      hallPassCost: 1,
      durationMs: 604_800_000,
      now: Date.now(),
    });
    ruby.createCharacter(sid, {
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
    });
    ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
      }), { status: 200 }),
    );

    const harness = makeCommandCtx(ruby, { type: "generate-mc" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body.message).toBe("Multiple choice generated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.response?.body.session.telemetry.current).toMatchObject({
      type: "multiple-choice",
      sourceCardId: "route-test-source-card-1",
    });
  });

  it("offline pick reports no scheduled Ruby card when the direct class bank is complete", async () => {
    const pack = rubyHomeroomSocialPack();
    pack.faculty[0]!.questions = pack.faculty[0]!.questions.slice(0, 2);
    setActivePack(pack);
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new MemorySessionStore());
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const sid = "rh:anonymous";
    ruby.createCharacter(sid, {
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
    });
    ruby.selectGrade(sid, "9");

    const pickedIds = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
      if (posed.current?.type === "opinion") {
        expect(posed.current.opinionPurpose).toBe("daily-take");
        ruby.recordOpinion(sid, "player", "I would verify the claim against concrete evidence.");
        ruby.recordGrades(sid, [{ responder: "player", score: 3, comment: "Too general." }], "player");
      } else {
        expect(posed.current?.id).toMatch(/^route-test-ruby-q[1-2]$/);
        const pick = pickedIds.size === 0 ? "B" : "A";
        pickedIds.add(posed.current!.id);
        ruby.submitAnswer(sid, pick);
      }
      ruby.clearBoard(sid);
    }
    expect(pickedIds).toEqual(new Set(["route-test-ruby-q1", "route-test-ruby-q2"]));
    const progress = ruby.courseProgress(sid, "ruby");
    expect(progress.ready).toBe(0);
    expect(progress.canPick).toBe(false);
    expect(progress.nextCardRole).toBe("practice");

    const harness = makeCommandCtx(ruby, { type: "pick" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body.success).toBe(true);
    expect(harness.response?.body.noQuestionDue).toBe(true);
    expect(harness.response?.body.session.telemetry.current).toBeNull();
    expect(harness.response?.body.session.telemetry.active_round).toBeNull();
  });

  it("blocks guests from switching to classrooms outside homeroom + daily lesson", async () => {
    const faculty = await FacultyService.start({} as never);
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const auth = await AuthService.start({} as never, store);
    try {
      const token = "guest-gate-faculty-token";
      const record = {
        userId: "guest-gate-faculty-user",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        provider: "guest" as const,
        label: "Guest",
      };
      auth.injectSessionForTest(token, record);
      const sid = auth.stateKeyForRecord(record);
      ruby.createCharacter(sid, {
        name: "Ari",
        playbookId: "overachiever",
        stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
        arcAnswer: "I want the transcript to look impossible.",
        personality: "intense but kind",
      });
      ruby.selectGrade(sid, "9");
      const dailyFaculty = ruby.dailyStatus(sid).facultyId;
      const blockedFaculty = ["sally-science", "professor-edward", "guest", "lounge"]
        .find((id) => id !== "ruby" && id !== dailyFaculty) ?? "lounge";

      const harness = makeCommandCtx(
        ruby,
        { type: "set-faculty", faculty: blockedFaculty },
        faculty,
        null,
        auth,
        `rh_session=${token}`,
      );
      const handled = await handleAppRoutes(harness.ctx);

      expect(handled).toBe(true);
      expect(harness.response?.status).toBe(403);
      expect(harness.response?.body.error).toMatch(/Guest mode is limited to Homeroom/i);
    } finally {
      await auth.stop();
    }
  });

  it("requires signup after a guest completes the daily lesson", async () => {
    const faculty = await FacultyService.start({} as never);
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const auth = await AuthService.start({} as never, store);
    try {
      const token = "guest-gate-signup-token";
      const record = {
        userId: "guest-gate-signup-user",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        provider: "guest" as const,
        label: "Guest",
      };
      auth.injectSessionForTest(token, record);
      const sid = auth.stateKeyForRecord(record);
      ruby.createCharacter(sid, {
        name: "Ari",
        playbookId: "overachiever",
        stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
        arcAnswer: "I want the transcript to look impossible.",
        personality: "intense but kind",
      });
      ruby.selectGrade(sid, "9");
      const dailyFaculty = ruby.dailyStatus(sid).facultyId;
      for (let i = 0; i < 8; i += 1) {
        const status = ruby.dailyStatus(sid);
        if (!status.available) break;
        ruby.playBonus(sid);
        ruby.submitAnswer(sid, "A");
      }
      expect(ruby.dailyStatus(sid).available).toBe(false);
      expect(ruby.dailyStatus(sid).reason).toBe("completed");

      const harness = makeCommandCtx(
        ruby,
        { type: "pick", faculty: dailyFaculty },
        faculty,
        null,
        auth,
        `rh_session=${token}`,
      );
      const handled = await handleAppRoutes(harness.ctx);

      expect(handled).toBe(true);
      expect(harness.response?.status).toBe(403);
      expect(harness.response?.body.error).toMatch(/Sign up to keep your character/i);
    } finally {
      await auth.stop();
    }
  });

  it("surfaces signup-required guest state in session telemetry", async () => {
    const faculty = await FacultyService.start({} as never);
    const store = new MemorySessionStore();
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const auth = await AuthService.start({} as never, store);
    try {
      const token = "guest-gate-telemetry-token";
      const record = {
        userId: "guest-gate-telemetry-user",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        provider: "guest" as const,
        label: "Guest",
      };
      auth.injectSessionForTest(token, record);
      const sid = auth.stateKeyForRecord(record);
      ruby.createCharacter(sid, {
        name: "Ari",
        playbookId: "overachiever",
        stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
        arcAnswer: "I want the transcript to look impossible.",
        personality: "intense but kind",
      });
      ruby.selectGrade(sid, "9");
      for (let i = 0; i < 8; i += 1) {
        const status = ruby.dailyStatus(sid);
        if (!status.available) break;
        ruby.playBonus(sid);
        ruby.submitAnswer(sid, "A");
      }
      expect(ruby.dailyStatus(sid).reason).toBe("completed");

      let response: any = null;
      const handled = await handleAppRoutes({
        method: "GET",
        pathname: "/api/apps/ruby-high/session/test-session",
        runtime: runtimeFor(ruby, faculty, auth),
        res: {},
        cookieHeader: `rh_session=${token}`,
        error: (_res, message, status = 500) => { response = { status, body: { error: message } }; },
        json: (_res, data, status = 200) => { response = { status, body: data }; },
        readJsonBody: async () => ({}),
      });

      expect(handled).toBe(true);
      expect(response?.status).toBe(200);
      expect(response?.body.telemetry.guest_access).toMatchObject({
        requiresSignup: true,
        message: "Today's class is done. Sign up to keep your character, earn Merit Stars, and unlock all classrooms. It just takes a moment.",
      });
    } finally {
      await auth.stop();
    }
  });
});
