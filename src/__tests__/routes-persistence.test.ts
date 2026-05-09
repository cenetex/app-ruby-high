import { afterEach, describe, expect, it } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { getActivePack, resetActivePack, setActivePack } from "../content/registry.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import type {
  AuthSessionRecord,
  AuthStoreSnapshot,
  AuthUserRecord,
  StateStoreLike,
  StoredContentPackRecord,
} from "../services/state-store.js";
import type { ContentPack } from "../content/types.js";
import type { QuizState } from "../types.js";

afterEach(() => {
  resetActivePack();
});

class FailingSessionStore implements StateStoreLike {
  async load(): Promise<Map<string, QuizState>> { return new Map(); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return { users: [], sessions: [] }; }
  async loadPacks(): Promise<StoredContentPackRecord[]> { return []; }
  async saveSession(_state: QuizState): Promise<void> { throw new Error("DynamoDB unavailable"); }
  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}
  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}
  async savePack(_record: StoredContentPackRecord): Promise<void> {}
  async deletePack(_ownerSessionId: string, _packId: string): Promise<void> {}
  async deleteAuthSession(_token: string): Promise<void> {}
  async save(_states: Iterable<QuizState>): Promise<void> {}
  describe(): string { return "failing-test-store"; }
}

class MemorySessionStore implements StateStoreLike {
  sessions = new Map<string, QuizState>();
  async load(): Promise<Map<string, QuizState>> { return new Map(this.sessions); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return { users: [], sessions: [] }; }
  async loadPacks(): Promise<StoredContentPackRecord[]> { return []; }
  async saveSession(state: QuizState): Promise<void> { this.sessions.set(state.sessionId, state); }
  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}
  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}
  async savePack(_record: StoredContentPackRecord): Promise<void> {}
  async deletePack(_ownerSessionId: string, _packId: string): Promise<void> {}
  async deleteAuthSession(_token: string): Promise<void> {}
  async save(states: Iterable<QuizState>): Promise<void> {
    this.sessions = new Map(Array.from(states).map((s) => [s.sessionId, s]));
  }
  async flush(): Promise<void> {}
  describe(): string { return "memory-test-store"; }
}

function runtimeFor(ruby: RubyHighService, faculty?: FacultyService) {
  return {
    agentId: "test-agent",
    getService(type: string) {
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
): { ctx: RouteContext; response: { status: number; body: any } | null } {
  let response: { status: number; body: any } | null = null;
  const ctx: RouteContext = {
    method: "POST",
    pathname: "/api/apps/ruby-high/session/test-session/command",
    runtime: runtimeFor(ruby, faculty),
    res: {} as never,
    cookieHeader: null,
    error: (_res, message, status = 500) => { response = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { response = { status, body: data }; },
    readJsonBody: async () => body,
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
      defaultModel: "anthropic/claude-haiku-4.5",
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

  it("offline pick still advances generated Ruby social cards when no bank card is ready", async () => {
    setActivePack(rubyHomeroomSocialPack());
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

    const pickedIds = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
      expect(posed.current?.id).toMatch(/^route-test-ruby-q[1-3]$/);
      pickedIds.add(posed.current!.id);
      ruby.submitAnswer(sid, "A");
      ruby.clearBoard(sid);
    }
    expect(pickedIds).toEqual(new Set(["route-test-ruby-q1", "route-test-ruby-q2", "route-test-ruby-q3"]));
    const progress = ruby.courseProgress(sid, "ruby");
    expect(progress.ready).toBe(0);
    expect(progress.canPick).toBe(true);
    expect(progress.nextCardRole).toBe("social");

    const harness = makeCommandCtx(ruby, { type: "pick" }, faculty);
    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body.success).toBe(true);
    expect(harness.response?.body.noQuestionDue).toBeUndefined();
    expect(harness.response?.body.session.telemetry.current).toMatchObject({
      type: "opinion",
    });
    expect(harness.response?.body.session.telemetry.current.id).toContain("social_ruby");
    expect(harness.response?.body.session.telemetry.active_round).toMatchObject({
      type: "opinion",
      cardRole: "social",
    });
  });
});
