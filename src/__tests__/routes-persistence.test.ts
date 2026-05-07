import { describe, expect, it } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { getActivePack } from "../content/registry.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import type {
  AuthSessionRecord,
  AuthStoreSnapshot,
  AuthUserRecord,
  StateStoreLike,
  StoredContentPackRecord,
} from "../services/state-store.js";
import type { QuizState } from "../types.js";

class FailingSessionStore implements StateStoreLike {
  async load(): Promise<Map<string, QuizState>> { return new Map(); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return { users: [], sessions: [] }; }
  async loadPacks(): Promise<StoredContentPackRecord[]> { return []; }
  async saveSession(_state: QuizState): Promise<void> { throw new Error("DynamoDB unavailable"); }
  async saveAuthUser(_user: AuthUserRecord): Promise<void> {}
  async saveAuthSession(_session: AuthSessionRecord): Promise<void> {}
  async savePack(_record: StoredContentPackRecord): Promise<void> {}
  async deleteAuthSession(_token: string): Promise<void> {}
  async save(_states: Iterable<QuizState>): Promise<void> {}
  describe(): string { return "failing-test-store"; }
}

function runtimeFor(ruby: RubyHighService) {
  return {
    agentId: "test-agent",
    getService(type: string) {
      if (type === RubyHighService.serviceType) return ruby;
      return null;
    },
  };
}

function makeCommandCtx(ruby: RubyHighService): { ctx: RouteContext; response: { status: number; body: any } | null } {
  let response: { status: number; body: any } | null = null;
  const ctx: RouteContext = {
    method: "POST",
    pathname: "/api/apps/ruby-high/session/test-session/command",
    runtime: runtimeFor(ruby),
    res: {} as never,
    cookieHeader: null,
    error: (_res, message, status = 500) => { response = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { response = { status, body: data }; },
    readJsonBody: async () => ({
      type: "create-character",
      name: "Ari",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the transcript to look impossible.",
      personality: "intense but kind",
    }),
  };
  return { ctx, get response() { return response; } };
}

describe("command route persistence failures", () => {
  it("returns a storage error instead of a false success when flushSession fails", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new FailingSessionStore());
    const harness = makeCommandCtx(ruby);

    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(503);
    expect(harness.response?.body.error).toMatch(/could not be persisted/i);
  });
});
