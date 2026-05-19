import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack, resetActivePack } from "../content/registry.js";
import type { Grade } from "../types.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let store: StateStore;

function runtime() {
  return {
    getService(type: string) {
      if (type === AuthService.serviceType) return auth;
      if (type === RubyHighService.serviceType) return ruby;
      return null;
    },
  };
}

function route(opts: {
  method?: string;
  path: string;
  authorizationHeader?: string | string[] | null;
  cookieHeader?: string | null;
  userAgentHeader?: string | string[] | null;
  body?: unknown;
}): { ctx: RouteContext; response: () => { status: number; body: any; headers: Record<string, string> } | null } {
  let response: { status: number; body: any; headers: Record<string, string> } | null = null;
  const headers: Record<string, string> = {};
  const url = new URL(opts.path, "https://rubyhighai.com");
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      response = { status: (res as { statusCode?: number }).statusCode ?? 200, body: body ?? "", headers };
    },
    statusCode: 200,
  };
  const ctx: RouteContext = {
    method: opts.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: runtime() as never,
    res: res as never,
    authorizationHeader: opts.authorizationHeader ?? null,
    cookieHeader: opts.cookieHeader ?? null,
    userAgentHeader: opts.userAgentHeader ?? null,
    callbackUrlBuilder: (path) => `https://rubyhighai.com${path}`,
    error: (_res, message, status = 500) => {
      response = { status, body: { error: message }, headers };
    },
    json: (_res, data, status = 200) => {
      response = { status, body: data, headers };
    },
    readJsonBody: async () => opts.body ?? {},
  };
  return { ctx, response: () => response };
}

async function appRoute(opts: Parameters<typeof route>[0]) {
  const harness = route(opts);
  const handled = await handleAppRoutes(harness.ctx);
  expect(handled).toBe(true);
  expect(harness.response()).not.toBeNull();
  return harness.response()!;
}

async function createSession(): Promise<string> {
  const { token } = await auth.createGuestSession();
  return auth.stateKeyForCookie(`rh_session=${token}`);
}

function attachYearbookEntry(sessionId: string, grade: Grade = "9"): void {
  const state = ruby.getOrCreate(sessionId);
  state.character = {
    name: "Mira",
    playbookId: "overachiever",
    stats: { head: 3, heart: 1, hustle: 2, honor: 3 },
    arcAnswer: "I turn study notes into school legends.",
    personality: "Careful, competitive, and generous with classmates.",
    flavorQuote: "The bell is a dare.",
    createdAt: Date.UTC(2026, 4, 1),
    yearbook: [{
      grade,
      completedAt: Date.UTC(2026, 4, 17),
      summary: { correct: 9, total: 10 },
      name: "Mira Vale",
      playbookId: "overachiever",
      stats: { head: 3, heart: 1, hustle: 2, honor: 3 },
      flavorQuote: "The bell is a dare.",
      subjectScores: {
        ruby: { correct: 3, total: 3 },
        "sally-science": { correct: 2, total: 3 },
      },
      superlatives: ["Most likely to annotate the margins."],
    }],
  };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-routes-"));
  resetActivePack();
  await getActivePack();
  store = new StateStore(join(tmpDir, "state.json"));
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("admin metrics route", () => {
  it("serves a browser admin dashboard without embedding metrics or tokens", async () => {
    const response = await appRoute({
      path: "/api/apps/ruby-high/admin",
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Ruby High Admin");
    expect(response.body).toContain("/api/apps/ruby-high/admin/metrics");
    expect(response.body).toContain("/api/apps/ruby-high/admin/metrics/schema");
    expect(response.body).toContain("/api/apps/ruby-high/admin/overview");
    expect(response.body).toContain("Trends");
    expect(response.body).toContain("Identity records");
    expect(response.body).toContain("localStorage");
    expect(response.body).not.toContain("admin-test-token");
    expect(response.body).not.toContain("\"auth\":");
    const script = String(response.body).match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("requires an admin token and returns auth, Ruby High, and log snapshots", async () => {
    await createSession();

    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("not configured");

    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(401);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      schemaVersion: "ruby-high-admin-metrics.v3",
      schemaPath: "/api/apps/ruby-high/admin/metrics/schema",
      auth: {
        users: 1,
        activeSessions: 1,
        providers: { guest: 1 },
      },
      ruby: {
        sessions: 0,
        events: {
          total: expect.any(Number),
        },
      },
      logs: {
        build: expect.any(String),
        counters: expect.any(Array),
      },
    });
    expect(response.body.auth.daily).toHaveLength(14);
    expect(response.body.ruby.daily).toHaveLength(14);
    expect(response.body.quality.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "auth.users",
        severity: "warning",
      }),
    ]));
    expect(response.body.ruby.characterD1Retention).toMatchObject({
      eligibleSessions: 0,
      returnedSessions: 0,
      rate: null,
    });
    expect(response.body.ruby.events.byName).toMatchObject({
      app_open: expect.any(Number),
      session_resume: expect.any(Number),
      funnel_step: expect.any(Number),
      commerce: expect.any(Number),
      llm_usage: expect.any(Number),
      error: expect.any(Number),
    });
    expect(response.body.generatedAt).toEqual(expect.any(String));
  });

  it("publishes the token-gated metrics schema with field reliability notes", async () => {
    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics/schema",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(503);

    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics/schema",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      schemaVersion: "ruby-high-admin-metrics.v3",
      endpoint: "/api/apps/ruby-high/admin/metrics",
      bucketTimezone: "UTC",
    });
    expect(response.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "auth.users",
        reliability: "legacy",
      }),
      expect.objectContaining({
        path: "ruby.characterD1Retention",
        reliability: "proxy",
      }),
      expect.objectContaining({
        path: "ruby.completedGrades",
        reliability: "authoritative",
      }),
      expect.objectContaining({
        path: "ruby.events.appOpen",
        reliability: "authoritative",
      }),
    ]));
    expect(response.body.missingEvents).toEqual([]);
  });

  it("accepts viewer app-open and session-resume events as durable metrics", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const { token } = await auth.createGuestSession();
    const cookieHeader = `rh_session=${token}`;
    const sessionId = auth.stateKeyForCookie(cookieHeader);

    let response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      userAgentHeader: "Vitest Browser",
      body: { type: "app_open", path: "/api/apps/ruby-high/viewer" },
    });
    expect(response.status).toBe(200);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      body: { type: "session_resume", inactiveMs: 600_000, reason: "focus" },
    });
    expect(response.status).toBe(200);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.ruby.events.appOpen).toMatchObject({
      total: 1,
      uniqueSessions: 1,
    });
    expect(response.body.ruby.events.sessionResume).toMatchObject({
      total: 1,
      uniqueSessions: 1,
    });
    expect(response.body.ruby.daily.at(-1)).toMatchObject({
      appOpens: 1,
      sessionResumes: 1,
    });
    expect(response.body.ruby.events.total).toBeGreaterThanOrEqual(2);
    expect(sessionId).toMatch(/^rh:user:/);
    expect(ruby.analyticsSnapshot().events.appOpen.uniqueSessions).toBe(1);
    await ruby.flush();
    const appOpen = (await store.loadMetricEvents()).find((event) => event.name === "app_open");
    expect(appOpen?.metadata).toMatchObject({
      path: "/api/apps/ruby-high/viewer",
      userAgent: "Vitest Browser",
    });
  });

  it("adds daily auth and play series for charts", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const yesterdayMs = now - 24 * 60 * 60 * 1000;
    const yesterday = new Date(yesterdayMs).toISOString().slice(0, 10);

    const sessionId = await createSession();
    const state = ruby.getOrCreate(sessionId);
    state.updatedAt = now;
    state.character = {
      name: "Mira",
      playbookId: "overachiever",
      stats: { head: 3, heart: 1, hustle: 2, honor: 3 },
      arcAnswer: "I turn study notes into school legends.",
      personality: "Careful, competitive, and generous with classmates.",
      createdAt: yesterdayMs,
      yearbook: [{
        grade: "9",
        completedAt: now,
        summary: { correct: 2, total: 3 },
        name: "Mira Vale",
        playbookId: "overachiever",
        stats: { head: 3, heart: 1, hustle: 2, honor: 3 },
        arcAnswer: "I turn study notes into school legends.",
        superlatives: [],
      }],
    };
    state.essayReports = [{
      id: "essay-1",
      questionId: "q1",
      faculty: "ruby",
      grade: "9",
      prompt: "Why Ruby High?",
      response: "Because it has better bells.",
      score: 8,
      passed: true,
      comment: "Clear answer.",
      bestResponder: "player",
      submittedAt: now,
      gradedAt: now,
    }];
    ruby.recordAppOpen(sessionId);
    ruby.recordSessionResume(sessionId, { inactiveMs: 600_000 });
    ruby.recordMetricEvent("llm_usage", {
      sessionId,
      provider: "OpenRouter",
      model: "test-model",
      status: "success",
      durationMs: 42,
    });
    ruby.recordMetricEvent("error", {
      sessionId,
      feature: "test-error",
      status: "error",
      metadata: { message: "boom" },
    });

    const response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });

    const authToday = response.body.auth.daily.at(-1);
    const playToday = response.body.ruby.daily.at(-1);
    const playYesterday = response.body.ruby.daily.at(-2);
    expect(authToday).toMatchObject({
      date: today,
      newUsers: 1,
      signedInUsers: 1,
      sessionStarts: 1,
    });
    expect(playToday).toMatchObject({
      date: today,
      updatedSessions: 1,
      gradesCompleted: 1,
      essaysGraded: 1,
      appOpens: 1,
      sessionResumes: 1,
      llmCalls: 1,
      durableErrors: 1,
    });
    expect(playYesterday).toMatchObject({
      date: yesterday,
      charactersCreated: 1,
    });
    expect(response.body.ruby.characterSessionsUpdatedLast24h).toBe(1);
    expect(response.body.ruby.characterD1Retention).toMatchObject({
      eligibleSessions: 1,
      returnedSessions: 1,
      rate: 1,
    });
  });

  it("returns a token-gated LLM overview from aggregate metrics", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "or-test-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Usage is warming up",
              summary: "New sessions are arriving, but retention is still thin.",
              highlights: ["Users grew today", "Questions are being answered"],
              risks: ["D1 retention is low"],
              actions: ["Improve first-return hooks"],
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/overview",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(401);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/overview",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      provider: "OpenRouter",
      overview: {
        headline: "Usage is warming up",
        risks: ["D1 retention is low"],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer or-test-key");
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    const prompt = body.messages[1].content as string;
    expect(prompt).toContain("ruby-high-admin-metrics.v3");
    expect(prompt).toContain("identityRecords");
    expect(prompt).toContain("not deduped people");
    expect(prompt).toContain("characterD1Retention");
    expect(prompt).toContain("events");
    expect(prompt).toContain("Do not call auth identity records unique users");
  });
});

describe("yearbook share route", () => {
  it("returns immutable yearbook card data without a session cookie", async () => {
    const sessionId = await createSession();
    attachYearbookEntry(sessionId);
    const share = ruby.yearbookSharesForSession(sessionId)[0]!;

    const response = await appRoute({
      path: `/api/apps/ruby-high/yearbook/${share.shareId}/9?format=json`,
    });

    expect(response.status).toBe(200);
    expect(response.body.card).toMatchObject({
      shareId: share.shareId,
      grade: "9",
      characterName: "Mira Vale",
      flavorQuote: "The bell is a dare.",
      summary: { correct: 9, total: 10 },
      source: "current-character",
      superlatives: ["Most likely to annotate the margins."],
    });
  });

  it("renders SVG cards and keeps PNG explicitly unsupported until configured", async () => {
    const sessionId = await createSession();
    attachYearbookEntry(sessionId);
    const share = ruby.yearbookSharesForSession(sessionId)[0]!;

    let response = await appRoute({
      path: `/api/apps/ruby-high/yearbook/${share.shareId}/9?format=svg`,
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(response.body).toContain("<svg");
    expect(response.body).toContain("Mira Vale");

    response = await appRoute({
      path: `/api/apps/ruby-high/yearbook/${share.shareId}/9?format=png`,
    });
    expect(response.status).toBe(501);
    expect(response.body.error).toContain("PNG");
  });
});
