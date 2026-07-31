import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getActivePack, resetActivePack } from "../content/registry.js";
import {
  AGENT_API_PREFIX,
  handleAgentRoutes,
} from "../routes/agent.js";
import type { RouteContext } from "../routes/context.js";
import { AgentAccessService } from "../services/agent-access-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

interface TestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

describe("Ruby High Agent API", () => {
  let dir = "";
  let store: StateStore;
  let access: AgentAccessService;
  let faculty: FacultyService;
  let ruby: RubyHighService;

  beforeEach(async () => {
    resetActivePack();
    await getActivePack();
    dir = await mkdtemp(join(tmpdir(), "ruby-high-agent-api-"));
    store = new StateStore(join(dir, "state.json"));
    const runtime = {
      agentId: "agent-api-test",
      character: { name: "Ruby" },
      getService: () => null,
      getSetting: (key: string) =>
        key === "RUBY_HIGH_AGENT_TOKEN_SECRET" ? "test-agent-secret" : null,
    };
    faculty = await FacultyService.start(runtime);
    ruby = new RubyHighService(runtime, store);
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    access = new AgentAccessService(runtime, store);
    await access.hydrate();
  });

  afterEach(async () => {
    await access?.stop();
    await faculty?.stop();
    resetActivePack();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("uses approval-bound, hash-at-rest device credentials and one-time viewer launches", async () => {
    const issued = await access.issueDeviceCode({
      agentName: "Ada Agent",
      scopes: ["school:read", "student:play"],
    });
    expect(await access.exchangeDeviceCode(issued.deviceCode)).toEqual({
      status: "authorization_pending",
    });

    const approved = await access.approveDeviceCode(issued.userCode, "rh:user:owner");
    const tokenResult = await access.exchangeDeviceCode(issued.deviceCode);
    expect(tokenResult.status).toBe("approved");
    if (tokenResult.status !== "approved") throw new Error("Expected approved token.");

    expect(access.authenticateBearer(`Bearer ${tokenResult.accessToken}`)?.id).toBe(
      approved.id,
    );
    expect(await access.exchangeDeviceCode(issued.deviceCode)).toEqual({
      status: "expired_token",
    });
    const stored = await store.loadServiceState("ruby-high:agent-access:v1");
    expect(JSON.stringify(stored)).not.toContain(tokenResult.accessToken);

    const launch = await access.createLaunch(approved.id);
    const viewer = await access.consumeLaunch(launch);
    const cookie = access.buildViewerCookie(viewer.viewerToken, true);
    expect(access.stateKeyForViewerCookie(cookie)).toBe(approved.stateKey);
    await expect(access.consumeLaunch(launch)).rejects.toMatchObject({
      code: "invalid_launch",
    });
  });

  it("allows the branded Eliza avatar on the browser approval page", async () => {
    const response = await request({
      method: "GET",
      path: `${AGENT_API_PREFIX}/connect`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain(
      "img-src 'self'",
    );
    expect(response.body).toContain(
      "/api/apps/ruby-high/assets/teachers/eliza-face.png",
    );
  });

  it("enrolls, attends Eliza's course, hides the answer, and applies an idempotent answer", async () => {
    const issued = await access.issueDeviceCode({
      agentName: "Ada Agent",
      scopes: ["school:read", "student:play"],
    });
    await access.approveDeviceCode(issued.userCode, "rh:user:owner");
    const exchanged = await access.exchangeDeviceCode(issued.deviceCode);
    if (exchanged.status !== "approved") throw new Error("Expected approved token.");
    const authorization = `Bearer ${exchanged.accessToken}`;

    const enrolled = await request({
      path: `${AGENT_API_PREFIX}/enroll`,
      body: {
        requestId: "enroll-ada-0001",
        name: "Ada Agent",
      },
      authorization,
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.body).toMatchObject({
      ok: true,
      action: "ENROLL",
      state: {
        student: {
          name: "Ada Agent",
          publicWorldVisible: false,
        },
        nextActions: ["ATTEND", "CHANGE_CLASS", "CHECK_PROGRESS"],
      },
    });

    const attended = await request({
      path: `${AGENT_API_PREFIX}/actions`,
      body: {
        requestId: "attend-eliza-0001",
        type: "ATTEND",
        input: { faculty: "eliza" },
      },
      authorization,
    });
    expect(attended.statusCode).toBe(200);
    expect(attended.body).toMatchObject({
      ok: true,
      state: {
        phase: "asking",
        faculty: "guest",
        activeGuest: { name: "ElizaOS Systems Lab" },
        nextActions: ["ANSWER", "CHECK_PROGRESS"],
      },
    });
    const safeQuestion = (attended.body as {
      state: { question: Record<string, unknown> };
    }).state.question;
    expect(safeQuestion).not.toHaveProperty("correct");
    expect(safeQuestion).not.toHaveProperty("explanation");

    const internal = ruby.getOrCreate(exchanged.credential.stateKey);
    const version = internal.updatedAt;
    const correct = internal.current?.correctChoice;
    expect(correct).toMatch(/^[A-D]$/);
    const answered = await request({
      path: `${AGENT_API_PREFIX}/actions`,
      body: {
        requestId: "answer-eliza-0001",
        ifVersion: version,
        type: "ANSWER",
        input: { picked: correct },
      },
      authorization,
    });
    expect(answered.body).toMatchObject({
      ok: true,
      result: { answered: true, wasCorrect: true },
      state: {
        reveal: { wasCorrect: true, correct },
        nextActions: ["ATTEND", "CHANGE_CLASS", "CHECK_PROGRESS"],
      },
    });

    const replay = await request({
      path: `${AGENT_API_PREFIX}/actions`,
      body: {
        requestId: "answer-eliza-0001",
        ifVersion: version,
        type: "ANSWER",
        input: { picked: correct },
      },
      authorization,
    });
    expect(replay.body).toMatchObject({ ok: true, replayed: true });
    expect(ruby.getOrCreate(exchanged.credential.stateKey).score.total).toBe(1);
  });

  it("keeps autonomy off by default and clamps owner-configured budgets", async () => {
    const issued = await access.issueDeviceCode({ agentName: "Scheduler" });
    const credential = await access.approveDeviceCode(
      issued.userCode,
      "rh:user:owner",
    );
    expect(credential.autonomy.enabled).toBe(false);

    const config = await access.setAutonomy(credential.id, {
      enabled: true,
      intervalMinutes: 1,
      maxActionsPerRun: 999,
      maxModelCallsPerRun: 999,
      publicPresence: true,
    });
    expect(config).toMatchObject({
      enabled: true,
      intervalMinutes: 15,
      maxActionsPerRun: 8,
      maxModelCallsPerRun: 2,
      publicPresence: false,
    });
  });

  it("restores approved credentials and completed class state after a service restart", async () => {
    const issued = await access.issueDeviceCode({
      agentName: "Restart Agent",
      scopes: ["school:read", "student:play"],
    });
    await access.approveDeviceCode(issued.userCode, "rh:user:owner");
    const exchanged = await access.exchangeDeviceCode(issued.deviceCode);
    if (exchanged.status !== "approved") throw new Error("Expected approved token.");
    const authorization = `Bearer ${exchanged.accessToken}`;

    await request({
      path: `${AGENT_API_PREFIX}/enroll`,
      body: { requestId: "restart-enroll-0001", name: "Restart Agent" },
      authorization,
    });
    await request({
      path: `${AGENT_API_PREFIX}/actions`,
      body: {
        requestId: "restart-attend-0001",
        type: "ATTEND",
        input: { faculty: "eliza" },
      },
      authorization,
    });
    const beforeAnswer = ruby.getOrCreate(exchanged.credential.stateKey);
    const answered = await request({
      path: `${AGENT_API_PREFIX}/actions`,
      body: {
        requestId: "restart-answer-0001",
        ifVersion: beforeAnswer.updatedAt,
        type: "ANSWER",
        input: { picked: beforeAnswer.current?.correctChoice },
      },
      authorization,
    });
    expect(answered.statusCode).toBe(200);

    await access.stop();
    access = new AgentAccessService(
      {
        getSetting: (key: string) =>
          key === "RUBY_HIGH_AGENT_TOKEN_SECRET" ? "test-agent-secret" : null,
      } as never,
      store,
    );
    await access.hydrate();
    ruby = new RubyHighService(undefined, store);
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    expect(access.authenticateBearer(authorization)?.id).toBe(
      exchanged.credential.id,
    );
    const restored = await request({
      method: "GET",
      path: `${AGENT_API_PREFIX}/state`,
      authorization,
    });
    expect(restored.body).toMatchObject({
      ok: true,
      state: {
        student: { name: "Restart Agent" },
        reveal: { wasCorrect: true },
      },
    });
  });

  it("keeps two approved agents in isolated student sessions", async () => {
    const connect = async (agentName: string) => {
      const issued = await access.issueDeviceCode({
        agentName,
        scopes: ["school:read", "student:play"],
      });
      await access.approveDeviceCode(issued.userCode, "rh:user:owner");
      const exchanged = await access.exchangeDeviceCode(issued.deviceCode);
      if (exchanged.status !== "approved") throw new Error("Expected approved token.");
      return exchanged;
    };
    const first = await connect("Agent One");
    const second = await connect("Agent Two");
    expect(first.credential.stateKey).not.toBe(second.credential.stateKey);

    await request({
      path: `${AGENT_API_PREFIX}/enroll`,
      body: { requestId: "isolation-enroll-one", name: "Agent One" },
      authorization: `Bearer ${first.accessToken}`,
    });
    await request({
      path: `${AGENT_API_PREFIX}/enroll`,
      body: { requestId: "isolation-enroll-two", name: "Agent Two" },
      authorization: `Bearer ${second.accessToken}`,
    });

    const firstState = await request({
      method: "GET",
      path: `${AGENT_API_PREFIX}/state`,
      authorization: `Bearer ${first.accessToken}`,
    });
    const secondState = await request({
      method: "GET",
      path: `${AGENT_API_PREFIX}/state`,
      authorization: `Bearer ${second.accessToken}`,
    });
    expect(firstState.body).toMatchObject({
      state: { student: { name: "Agent One" } },
    });
    expect(secondState.body).toMatchObject({
      state: { student: { name: "Agent Two" } },
    });
  });

  async function request(args: {
    method?: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
    authorization?: string;
  }): Promise<TestResponse> {
    const response = makeResponse();
    const context: RouteContext = {
      method: args.method ?? "POST",
      pathname: args.path,
      url: new URL(`https://ruby-high.test${args.path}`),
      runtime: null,
      res: response,
      cookieHeader: null,
      authorizationHeader: args.authorization ?? null,
      contentTypeHeader: "application/json",
      clientIp: `test-${Math.random()}`,
      callbackUrlBuilder: (path) => `https://ruby-high.test${path}`,
      error: (_res, message, status = 500) => {
        response.statusCode = status;
        response.body = { error: message };
      },
      json: (_res, data, status = 200) => {
        response.statusCode = status;
        response.body = data;
      },
      readJsonBody: async () => args.body ?? {},
    };
    await handleAgentRoutes(context, { access, auth: null, ruby, faculty });
    return response;
  }
});

function makeResponse(): TestResponse {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body ?? null;
    },
  };
}
