import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { handleAppRoutes, type RouteContext } from "../routes.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack, resetActivePack } from "../content/registry.js";
import { cardMemoryKey } from "../services/ruby-high/helpers.js";
import type { Grade, QuizState } from "../types.js";

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
  visitorHeader?: string | string[] | null;
  lastEventIdHeader?: string | string[] | null;
  clientIp?: string | null;
  body?: unknown;
  throwOnWriteNumber?: number;
}): {
  ctx: RouteContext;
  response: () => { status: number; body: any; headers: Record<string, string> } | null;
  emitResponse: (event: "close" | "finish") => void;
} {
  let response: { status: number; body: any; headers: Record<string, string> } | null = null;
  const headers: Record<string, string> = {};
  const listeners: Record<"close" | "finish", Array<() => void>> = { close: [], finish: [] };
  let writeCount = 0;
  const url = new URL(opts.path, "https://ruby-high.ai");
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    writeHead(status: number, values: Record<string, string | string[]>) {
      res.statusCode = status;
      for (const [name, value] of Object.entries(values)) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
    },
    write(chunk: string) {
      writeCount += 1;
      if (opts.throwOnWriteNumber && writeCount === opts.throwOnWriteNumber) {
        throw new Error("simulated broken socket");
      }
      const current = response?.body ?? "";
      response = { status: (res as { statusCode?: number }).statusCode ?? 200, body: `${current}${chunk}`, headers };
      return true;
    },
    flushHeaders() {
      // no-op for route tests
    },
    end(body?: string) {
      const current = response?.body ?? "";
      response = { status: (res as { statusCode?: number }).statusCode ?? 200, body: `${current}${body ?? ""}`, headers };
    },
    on(event: "close" | "finish", listener: () => void) {
      listeners[event].push(listener);
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
    lastEventIdHeader: opts.lastEventIdHeader ?? null,
    cookieHeader: opts.cookieHeader ?? null,
    userAgentHeader: opts.userAgentHeader ?? null,
    visitorHeader: opts.visitorHeader ?? null,
    clientIp: opts.clientIp ?? null,
    callbackUrlBuilder: (path) => `https://ruby-high.ai${path}`,
    error: (_res, message, status = 500) => {
      response = { status, body: { error: message }, headers };
    },
    json: (_res, data, status = 200) => {
      response = { status, body: data, headers };
    },
    readJsonBody: async () => opts.body ?? {},
  };
  return {
    ctx,
    response: () => response,
    emitResponse(event: "close" | "finish") {
      for (const listener of listeners[event]) listener();
    },
  };
}

async function appRoute(opts: Parameters<typeof route>[0]) {
  const harness = route(opts);
  const handled = await handleAppRoutes(harness.ctx);
  expect(handled).toBe(true);
  expect(harness.response()).not.toBeNull();
  return harness.response()!;
}

async function worldLiveStreamMetrics(): Promise<Record<string, number>> {
  const metrics = await appRoute({
    path: "/api/apps/ruby-high/admin/metrics",
    authorizationHeader: "Bearer admin-test-token",
  });
  return metrics.body.ops.worldLiveStreams;
}

async function publicReadLimiterMetrics(): Promise<{ trackedKeys: number; gcIntervalMs: number; lastGcAt: number | null }> {
  const metrics = await appRoute({
    path: "/api/apps/ruby-high/admin/metrics",
    authorizationHeader: "Bearer admin-test-token",
  });
  return metrics.body.ops.publicReadLimiter;
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

function attachCohortStudent(sessionId: string, name: string, grade: Grade, letterGrade: string): void {
  const now = Date.now();
  const state = ruby.getOrCreate(sessionId);
  state.currentGrade = grade;
  state.character = {
    name,
    playbookId: "overachiever",
    stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
    arcAnswer: "I show up for the class leaderboard.",
    personality: "Focused and friendly.",
    createdAt: now,
    dailyClasses: {
      [`${grade}:ruby:2026-06-14`]: {
        grade,
        facultyId: "ruby",
        date: "2026-06-14",
        status: "complete",
        questionCount: 3,
        correctCount: letterGrade === "F" ? 0 : 3,
        scoreTotal: letterGrade === "F" ? 0 : 300,
        scoreMax: 300,
        letterGrade,
        completedAt: now,
        updatedAt: now,
      },
    },
    yearbook: [],
  };
}

function publicWorldEventId(kind: string, at: number, id: string): string {
  return `world:event:${createHash("sha256").update(`${kind}:${at}:${id}`).digest("hex").slice(0, 16)}`;
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

describe("cohort route", () => {
  it("serves explicit grade cohorts and preserves current-session fallback", async () => {
    const freshman = await auth.createGuestSession();
    const sophomore = await auth.createGuestSession();
    const junior = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${freshman.token}`), "Fresh Mina", "9", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${sophomore.token}`), "Soph Noor", "10", "B");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${junior.token}`), "Junior Sol", "11", "A");

    let response = await appRoute({ path: "/api/apps/ruby-high/cohort/10" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.grade).toBe("10");
    expect(response.body.students.map((student: { name: string }) => student.name)).toEqual(["Soph Noor"]);
    expect(response.body.students[0]).not.toHaveProperty("sessionId");

    response = await appRoute({
      path: "/api/apps/ruby-high/cohort",
      cookieHeader: `rh_session=${junior.token}`,
    });
    expect(response.status).toBe(200);
    expect(response.body.grade).toBe("11");
    expect(response.body.students.map((student: { name: string }) => student.name)).toEqual(["Junior Sol"]);
    expect(response.body.students[0]).not.toHaveProperty("sessionId");
  });

  it("keeps inline portrait data out of public cohort responses", async () => {
    const inlinePortrait = await auth.createGuestSession();
    const pathPortrait = await auth.createGuestSession();
    const protocolPortrait = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${inlinePortrait.token}`), "Inline Mina", "9", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${pathPortrait.token}`), "Path Noor", "9", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${protocolPortrait.token}`), "Protocol Sol", "9", "A");

    const inlineState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${inlinePortrait.token}`));
    inlineState.character!.portraitDataUrl = "data:image/png;base64,INLINE";
    const pathState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${pathPortrait.token}`));
    pathState.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/path-noor.png";
    const protocolState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${protocolPortrait.token}`));
    protocolState.character!.portraitDataUrl = "//example.test/portrait.png";

    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/9" });

    expect(response.status).toBe(200);
    const inlineStudent = response.body.students.find((student: { name: string }) => student.name === "Inline Mina");
    const pathStudent = response.body.students.find((student: { name: string }) => student.name === "Path Noor");
    const protocolStudent = response.body.students.find((student: { name: string }) => student.name === "Protocol Sol");
    expect(inlineStudent).not.toHaveProperty("portraitUrl");
    expect(protocolStudent).not.toHaveProperty("portraitUrl");
    expect(pathStudent).toMatchObject({
      portraitUrl: "/api/apps/ruby-high/assets/portrait/path-noor.png",
    });
    expect(JSON.stringify(response.body)).not.toContain("data:image");
    expect(JSON.stringify(response.body)).not.toContain("INLINE");
    expect(JSON.stringify(response.body)).not.toContain("example.test");
  });

  it("normalizes public cohort student names and excludes blank names", async () => {
    const messyName = await auth.createGuestSession();
    const blankName = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${messyName.token}`), "  Noor\n\tSol\u0000  ", "9", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${blankName.token}`), "   ", "9", "A");

    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/9" });

    expect(response.status).toBe(200);
    expect(response.body.students.map((student: { name: string }) => student.name)).toEqual(["Noor Sol"]);
    expect(JSON.stringify(response.body)).not.toContain("\n");
    expect(JSON.stringify(response.body)).not.toContain("\u0000");
  });

  it("keeps public cohort numeric and class-grade fields JSON-safe", async () => {
    const malformed = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${malformed.token}`), "Malformed Mina", "9", "A");
    const state = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${malformed.token}`));
    state.character!.playbookId = "  overachiever\n\u0000  ";
    state.character!.stats = {
      head: Number.NaN,
      heart: Number.POSITIVE_INFINITY,
      hustle: -4.8,
      honor: 3.9,
    };
    state.character!.yearbook = new Array(3).fill(null).map((_, index) => ({
      grade: "9",
      completedAt: Date.now() + index,
      summary: { correct: 3, total: 3 },
      stats: { head: 1, heart: 1, hustle: 1, honor: 1 },
      answers: [],
      signature: `sig-${index}`,
    }));
    const record = Object.values(state.character!.dailyClasses ?? {})[0];
    if (record) {
      record.facultyId = "ruby\nlab";
      record.letterGrade = " A+\nwith honors forever ";
    }

    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/9" });
    const student = response.body.students.find((entry: { name: string }) => entry.name === "Malformed Mina");

    expect(student).toMatchObject({
      playbookId: "overachiever",
      stats: { head: 0, heart: 0, hustle: 0, honor: 3 },
      classGrades: { "ruby lab": "A+ wi..." },
      yearbookCount: 3,
    });
    expect(JSON.stringify(response.body)).not.toContain("Infinity");
    expect(JSON.stringify(response.body)).not.toContain("NaN");
    expect(JSON.stringify(response.body)).not.toContain("\n");
    expect(JSON.stringify(response.body)).not.toContain("\u0000");
  });

  it("refreshes explicit grade cohorts from durable sessions", async () => {
    const now = Date.UTC(2026, 5, 15, 12);
    const external = structuredClone(ruby.getOrCreate("test:cohort-template")) as QuizState;
    external.sessionId = "test:cohort-external";
    external.currentGrade = "10";
    external.faculty = "ruby";
    external.updatedAt = now;
    external.character = {
      name: "External Mina",
      playbookId: "overachiever",
      stats: { head: 4, heart: 3, hustle: 2, honor: 1 },
      arcAnswer: "I joined from the other server.",
      personality: "Curious and game.",
      createdAt: now,
      dailyClasses: {
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
      },
      yearbook: [],
    };
    const externalStore = new StateStore(store.describe(), { debounceMs: 0 });
    await externalStore.saveSession(external);
    await externalStore.flush?.();

    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/10" });

    expect(response.status).toBe(200);
    expect(response.body.students.map((student: { name: string }) => student.name)).toContain("External Mina");
    expect(response.body.students.find((student: { name: string }) => student.name === "External Mina")).not.toHaveProperty("sessionId");
  });

  it("rate-limits public cohort reads by client IP", async () => {
    let response: Awaited<ReturnType<typeof appRoute>> | null = null;
    for (let i = 0; i < 121; i += 1) {
      response = await appRoute({
        path: "/api/apps/ruby-high/cohort/9",
        clientIp: "203.0.113.91",
      });
    }

    expect(response?.status).toBe(429);
    expect(response?.body.error).toBe("Too many public read requests.");
    expect(response?.headers["retry-after"]).toBe("1");
  });

  it("separates public read limits by visitor behind a shared IP", async () => {
    let response: Awaited<ReturnType<typeof appRoute>> | null = null;
    for (let i = 0; i < 121; i += 1) {
      response = await appRoute({
        path: "/api/apps/ruby-high/cohort/9",
        clientIp: "203.0.113.92",
        visitorHeader: "rhv_visitor_a",
      });
    }
    expect(response?.status).toBe(429);

    const neighbor = await appRoute({
      path: "/api/apps/ruby-high/cohort/9",
      clientIp: "203.0.113.92",
      visitorHeader: "rhv_visitor_b",
    });
    expect(neighbor.status).toBe(200);
  });

  it("falls back to IP-only public read limits for malformed visitor headers", async () => {
    for (let i = 0; i < 120; i += 1) {
      const response = await appRoute({
        path: "/api/apps/ruby-high/cohort/9",
        clientIp: "203.0.113.93",
        visitorHeader: `bad ${i}`,
      });
      expect(response.status).toBe(200);
    }

    const response = await appRoute({
      path: "/api/apps/ruby-high/cohort/9",
      clientIp: "203.0.113.93",
      visitorHeader: "also bad",
    });
    expect(response.status).toBe(429);
  });

  it("does not let unprefixed visitor headers bypass public read limits", async () => {
    let response: Awaited<ReturnType<typeof appRoute>> | null = null;
    for (let i = 0; i < 121; i += 1) {
      response = await appRoute({
        path: "/api/apps/ruby-high/cohort/9",
        clientIp: "203.0.113.95",
        visitorHeader: `visitor_rotation_${i}`,
      });
    }

    expect(response?.status).toBe(429);
    expect(response?.body.error).toBe("Too many public read requests.");
  });

  it("garbage-collects idle public read limiter visitor keys", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2030, 0, 1, 0, 0, 0));
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const prefix = "rhv_gc_public_read_";
    const clientIp = "203.0.113.94";

    await appRoute({
      path: "/api/apps/ruby-high/cohort/9",
      clientIp,
      visitorHeader: `${prefix}seed`,
    });
    const seeded = await publicReadLimiterMetrics();

    for (let i = 0; i < 5; i += 1) {
      await appRoute({
        path: "/api/apps/ruby-high/cohort/9",
        clientIp,
        visitorHeader: `${prefix}${i}`,
      });
    }
    const afterBurst = await publicReadLimiterMetrics();
    expect(afterBurst.trackedKeys).toBeGreaterThanOrEqual(seeded.trackedKeys + 5);

    vi.advanceTimersByTime(61_000);
    await appRoute({
      path: "/api/apps/ruby-high/cohort/9",
      clientIp,
      visitorHeader: `${prefix}after`,
    });
    const afterGc = await publicReadLimiterMetrics();

    expect(afterGc.trackedKeys).toBeLessThan(afterBurst.trackedKeys);
    expect(afterGc.gcIntervalMs).toBe(60_000);
    expect(afterGc.lastGcAt).toBe(Date.UTC(2030, 0, 1, 0, 1, 1));
  });

  it("rejects unknown cohort grades before creating a session", async () => {
    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/13" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Unknown grade: 13");
    expect(ruby.analyticsSnapshot().sessions).toBe(0);
  });

  it("handles malformed public path encodings without throwing", async () => {
    const response = await appRoute({ path: "/api/apps/ruby-high/cohort/%E0%A4%A" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Unknown grade: malformed");
    expect(ruby.analyticsSnapshot().sessions).toBe(0);

    const malformedSession = route({ path: "/api/apps/ruby-high/session/%E0%A4%A" });
    await expect(handleAppRoutes(malformedSession.ctx)).resolves.toBe(false);
    expect(malformedSession.response()).toBeNull();
  });
});

describe("school world route", () => {
  it("returns a public aggregate world snapshot without private or synthetic students", async () => {
    const publicStudent = await auth.createGuestSession();
    const privateStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "World Noor", "10", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${privateStudent.token}`), "Private Ari", "10", "A");

    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "sally-science";
    publicState.schoolEvents.push({
      id: "school:event:visible",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 12),
      faculty: "sally-science",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-02",
      pageNumber: 2,
      reason: "teacher-class-aced",
      sourceId: "teacher:sally-science:grade:10",
      label: "Signals in the lab",
    });

    const privateState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${privateStudent.token}`));
    privateState.character!.socialConsent = false;
    privateState.schoolEvents.push({
      id: "school:event:private",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 13),
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-03",
      pageNumber: 3,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Private page",
    });

    const synthetic = ruby.getOrCreate("test:world-smoke");
    synthetic.currentGrade = "9";
    synthetic.character = {
      name: "Smoke mqe1pkx3",
      playbookId: "overachiever",
      stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
      arcAnswer: "Synthetic test character.",
      personality: "Synthetic.",
      createdAt: Date.now(),
      dailyClasses: {
        "9:ruby:2026-06-14": {
          grade: "9",
          facultyId: "ruby",
          date: "2026-06-14",
          status: "complete",
          questionCount: 3,
          correctCount: 3,
          scoreTotal: 300,
          scoreMax: 300,
          letterGrade: "A",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      yearbook: [],
    };

    const response = await appRoute({ path: "/api/apps/ruby-high/world?limit=1" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.ok).toBe(true);
    expect(response.body.world).toMatchObject({
      activeStudents: 1,
      curriculum: {
        activeCharacterSessions: expect.any(Number),
        lowPools: expect.any(Array),
      },
    });
    expect(response.body.world.activeRooms).toEqual([
      expect.objectContaining({
        grade: "10",
        facultyId: "sally-science",
        activeStudents: 1,
        students: [expect.objectContaining({ name: "World Noor" })],
      }),
    ]);
    expect(response.body.world.cohorts["10"]).toEqual([
      expect.not.objectContaining({ sessionId: expect.any(String) }),
    ]);
    expect(JSON.stringify(response.body.world)).toContain("World Noor");
    expect(JSON.stringify(response.body.world)).toContain("Signals in the lab");
    expect(JSON.stringify(response.body.world)).not.toContain("Private Ari");
    expect(JSON.stringify(response.body.world)).not.toContain("Smoke");
    expect(JSON.stringify(response.body.world)).not.toContain("school:event:visible");
    expect(JSON.stringify(response.body.world)).not.toContain("school:event:private");
    expect(JSON.stringify(response.body.world)).not.toContain("teacher:sally-science:grade:10");
    expect(response.body.world.recentEvents).toHaveLength(1);
    expect(response.body.world.recentEvents[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^world:event:/),
      kind: "comic.page-unlocked",
      label: "Signals in the lab",
    }));
    expect(response.body.world.recentEvents[0]).not.toHaveProperty("sourceId");
  });

  it("streams sanitized public world snapshot and event frames for MMO clients", async () => {
    const publicStudent = await auth.createGuestSession();
    const privateStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Stream Noor", "10", "A");
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${privateStudent.token}`), "Stream Private", "10", "A");

    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    publicState.schoolEvents.push({
      id: "school:event:stream-visible-old",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 11),
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-01",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Old stream page",
    });
    publicState.schoolEvents.push({
      id: "school:event:stream-visible-new",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 12),
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-02",
      pageNumber: 2,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "New stream page",
    });

    const privateState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${privateStudent.token}`));
    privateState.character!.socialConsent = false;
    privateState.schoolEvents.push({
      id: "school:event:stream-private",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 13),
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-03",
      pageNumber: 3,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Private stream page",
    });

    const response = await appRoute({
      path: `/api/apps/ruby-high/world/events?limit=5&since=${Date.UTC(2026, 5, 14, 11)}`,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("retry: 5000");
    expect(response.body).toContain("event: world-snapshot");
    expect(response.body).toContain("event: world-event");
    expect(response.body).toContain("event: end");
    expect(response.body).toContain("Stream Noor");
    expect(response.body).toContain("New stream page");
    expect(response.body).not.toContain("Old stream page");
    expect(response.body).not.toContain("Stream Private");
    expect(response.body).not.toContain("Private stream page");
    expect(response.body).not.toContain("school:event:stream-visible-new");
    expect(response.body).not.toContain("school:event:stream-private");
    expect(response.body).not.toContain("teacher:ruby:grade:10");
    expect(response.body).toMatch(/^id: world:cursor:/m);
  });

  it("does not drop distinct same-millisecond world events when clients replay the edge", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Tie Noor", "10", "A");
    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    const sharedAt = Date.UTC(2026, 5, 14, 12);
    publicState.schoolEvents.push({
      id: "school:event:same-ms-a",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-05",
      pageNumber: 5,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Same millisecond A",
    });
    publicState.schoolEvents.push({
      id: "school:event:same-ms-b",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-06",
      pageNumber: 6,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Same millisecond B",
    });

    const response = await appRoute({
      path: `/api/apps/ruby-high/world/events?limit=5&since=${sharedAt - 1}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("Same millisecond A");
    expect(response.body).toContain("Same millisecond B");
    expect(response.body).not.toContain("school:event:same-ms-a");
    expect(response.body).not.toContain("school:event:same-ms-b");
  });

  it("resumes world event streams from standard Last-Event-ID reconnect headers", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Reconnect Noor", "10", "A");
    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    const oldAt = Date.UTC(2026, 5, 14, 11);
    const middleAt = Date.UTC(2026, 5, 14, 12);
    const newAt = Date.UTC(2026, 5, 14, 13);
    publicState.schoolEvents.push({
      id: "school:event:reconnect-old",
      kind: "comic.page-unlocked",
      at: oldAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-09",
      pageNumber: 9,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Reconnect old page",
    });
    publicState.schoolEvents.push({
      id: "school:event:reconnect-middle",
      kind: "comic.page-unlocked",
      at: middleAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-10",
      pageNumber: 10,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Reconnect middle page",
    });
    publicState.schoolEvents.push({
      id: "school:event:reconnect-new",
      kind: "comic.page-unlocked",
      at: newAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-11",
      pageNumber: 11,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Reconnect new page",
    });

    const response = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5",
      lastEventIdHeader: publicWorldEventId("comic.page-unlocked", middleAt, "school:event:reconnect-middle"),
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("Reconnect Noor");
    expect(response.body).toContain("Reconnect new page");
    expect(response.body).not.toContain("Reconnect old page");
    expect(response.body).not.toContain("Reconnect middle page");
    expect(response.body).not.toContain("school:event:reconnect-new");
  });

  it("resumes world event streams from durable cursor Last-Event-ID headers", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Cursor Noor", "10", "A");
    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    const sharedAt = Date.UTC(2026, 5, 14, 12);
    publicState.schoolEvents.push({
      id: "school:event:cursor-a",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-cursor-a",
      pageNumber: 9,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Cursor page A",
    });
    publicState.schoolEvents.push({
      id: "school:event:cursor-b",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-cursor-b",
      pageNumber: 10,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Cursor page B",
    });
    publicState.schoolEvents.push({
      id: "school:event:cursor-c",
      kind: "comic.page-unlocked",
      at: sharedAt + 1,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-cursor-c",
      pageNumber: 11,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Cursor page C",
    });

    const first = await appRoute({
      path: `/api/apps/ruby-high/world/events?limit=5&since=${sharedAt - 1}`,
    });
    const eventBlocks = String(first.body)
      .split("\n\n")
      .filter((block) => block.includes("event: world-event"));
    expect(eventBlocks).toHaveLength(3);
    const cursorLine = eventBlocks[0]!.split("\n").find((line) => line.startsWith("id: world:cursor:"));
    expect(cursorLine).toBeTruthy();
    const firstLabel = ["Cursor page A", "Cursor page B", "Cursor page C"].find((label) => eventBlocks[0]!.includes(label));
    const remainingLabels = ["Cursor page A", "Cursor page B", "Cursor page C"].filter((label) => label !== firstLabel);

    const response = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5",
      lastEventIdHeader: cursorLine!.slice("id: ".length),
    });

    expect(response.status).toBe(200);
    for (const label of remainingLabels) expect(response.body).toContain(label);
    expect(response.body).not.toContain(firstLabel);

    const queryResponse = await appRoute({
      path: `/api/apps/ruby-high/world/events?limit=5&cursor=${encodeURIComponent(cursorLine!.slice("id: ".length))}`,
    });

    expect(queryResponse.status).toBe(200);
    for (const label of remainingLabels) expect(queryResponse.body).toContain(label);
    expect(queryResponse.body).not.toContain(firstLabel);
  });

  it("emits public world events from the durable school event outbox", async () => {
    const now = Date.UTC(2026, 5, 14, 12);
    const external = structuredClone(ruby.getOrCreate("test:world-route-outbox-template")) as QuizState;
    external.sessionId = "test:world-route-outbox";
    external.currentGrade = "10";
    external.faculty = "ruby";
    external.updatedAt = now;
    external.schoolEvents = [];
    external.character = {
      name: "Route Outbox Noor",
      playbookId: "overachiever",
      stats: { head: 4, heart: 3, hustle: 2, honor: 1 },
      arcAnswer: "I arrived from durable events.",
      personality: "Curious and game.",
      createdAt: now,
      dailyClasses: {
        "10:ruby:2026-06-14": {
          grade: "10",
          facultyId: "ruby",
          date: "2026-06-14",
          status: "complete",
          questionCount: 3,
          correctCount: 3,
          scoreTotal: 300,
          scoreMax: 300,
          letterGrade: "A",
          completedAt: now,
          updatedAt: now,
        },
      },
      yearbook: [],
    };
    const externalStore = new StateStore(store.describe(), { debounceMs: 0 });
    await externalStore.saveSession(external);
    await externalStore.saveSchoolEvent({
      id: "school:event:route-outbox",
      sessionId: external.sessionId,
      occurredAt: now + 1,
      day: "2026-06-14",
      event: {
        id: "school:event:route-outbox",
        kind: "comic.page-unlocked",
        at: now + 1,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-route-outbox",
        pageNumber: 7,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Route outbox page",
      },
    });
    await externalStore.flush?.();

    const response = await appRoute({
      path: `/api/apps/ruby-high/world/events?limit=5&since=${now}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("Route Outbox Noor");
    expect(response.body).toContain("event: world-event");
    expect(response.body).toContain("Route outbox page");
    expect(response.body).not.toContain("school:event:route-outbox");
    expect(response.body).not.toContain("teacher:ruby:grade:10");
  });

  it("keeps live world streams open and emits newly observed public events", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Live Noor", "10", "A");
    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 14, 12));

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=2500&heartbeatMs=1000",
    });
    const handled = await handleAppRoutes(harness.ctx);
    expect(handled).toBe(true);
    expect(harness.response()).not.toBeNull();
    expect(harness.response()!.body).toContain("event: world-snapshot");
    expect(harness.response()!.body).not.toContain("Live stream page");

    publicState.schoolEvents.push({
      id: "school:event:live-visible",
      kind: "comic.page-unlocked",
      at: Date.UTC(2026, 5, 14, 12, 0, 1),
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-04",
      pageNumber: 4,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Live stream page",
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.response()!.body).toContain("event: world-event");
    expect(harness.response()!.body).toContain("Live stream page");
    expect(harness.response()!.body).toContain("event: heartbeat");
    expect(harness.response()!.body).not.toContain("school:event:live-visible");
    expect(harness.response()!.body).not.toContain("teacher:ruby:grade:10");

    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.response()!.body).toContain("event: end");
  });

  it("keeps idle live world stream ticks to heartbeats instead of repeated snapshots", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Idle Noor", "10", "A");
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 14, 12));

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=2500&heartbeatMs=1000",
    });
    const handled = await handleAppRoutes(harness.ctx);
    expect(handled).toBe(true);
    expect(harness.response()!.body.match(/event: world-snapshot/g)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.response()!.body.match(/event: heartbeat/g)).toHaveLength(1);
    expect(harness.response()!.body.match(/event: world-snapshot/g)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.response()!.body.match(/event: heartbeat/g)).toHaveLength(2);
    expect(harness.response()!.body.match(/event: world-snapshot/g)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(harness.response()!.body).toContain("event: end");
  });

  it("keeps same-millisecond live world events distinct after the first frame", async () => {
    const publicStudent = await auth.createGuestSession();
    attachCohortStudent(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`), "Live Tie Noor", "10", "A");
    const publicState = ruby.getOrCreate(auth.stateKeyForCookie(`rh_session=${publicStudent.token}`));
    publicState.faculty = "ruby";
    vi.useFakeTimers();
    const sharedAt = Date.UTC(2026, 5, 14, 12);
    vi.setSystemTime(sharedAt);
    publicState.schoolEvents.push({
      id: "school:event:live-same-ms-a",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-07",
      pageNumber: 7,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Live same millisecond A",
    });

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=2500&heartbeatMs=1000",
    });
    const handled = await handleAppRoutes(harness.ctx);
    expect(handled).toBe(true);
    expect(harness.response()!.body).toContain("Live same millisecond A");

    publicState.schoolEvents.push({
      id: "school:event:live-same-ms-b",
      kind: "comic.page-unlocked",
      at: sharedAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-08",
      pageNumber: 8,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Live same millisecond B",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const body = harness.response()!.body;
    expect(body).toContain("Live same millisecond B");
    expect(body.match(/Live same millisecond A/g)).toHaveLength(1);
    expect(body).not.toContain("school:event:live-same-ms-b");

    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.response()!.body).toContain("event: end");
  });

  it("caps concurrent live world streams per client and releases slots when streams end", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const clientIp = "203.0.113.200";
    const openStreams: Array<ReturnType<typeof route>> = [];
    const before = await worldLiveStreamMetrics();

    for (let i = 0; i < 6; i += 1) {
      const harness = route({
        path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
        clientIp,
      });
      expect(await handleAppRoutes(harness.ctx)).toBe(true);
      expect(harness.response()!.status).toBe(200);
      openStreams.push(harness);
    }

    const blocked = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("5");
    expect(blocked.body.error).toBe("Too many live world streams.");

    let metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      active: 6,
      clients: 1,
      limitPerClient: 6,
      saturatedClients: 1,
      maxClientStreams: 6,
      accepted: before.accepted + 6,
      rejected: before.rejected + 1,
    });

    await vi.advanceTimersByTimeAsync(1000);
    for (const harness of openStreams) {
      expect(harness.response()!.body).toContain("event: end");
    }

    metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      active: 0,
      clients: 0,
      saturatedClients: 0,
      maxClientStreams: 0,
      closed: before.closed + 6,
      closedByTimeout: before.closedByTimeout + 6,
    });

    const afterRelease = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
    });
    expect(await handleAppRoutes(afterRelease.ctx)).toBe(true);
    expect(afterRelease.response()!.status).toBe(200);
    await vi.advanceTimersByTimeAsync(1000);
    expect(afterRelease.response()!.body).toContain("event: end");
  });

  it("releases live world stream slots when clients close during initial snapshot loading", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const original = ruby.getFreshSchoolWorldSnapshot.bind(ruby);
    vi.spyOn(ruby, "getFreshSchoolWorldSnapshot").mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return original(...args);
    });
    const clientIp = "203.0.113.203";
    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
    });
    const pending = handleAppRoutes(harness.ctx);
    await vi.advanceTimersByTimeAsync(1);

    let metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 1, clients: 1 });

    harness.emitResponse("close");
    metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 0, clients: 0 });

    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
  });

  it("stops one-shot world event work when clients close during initial snapshot loading", async () => {
    vi.useFakeTimers();
    const original = ruby.getFreshSchoolWorldSnapshot.bind(ruby);
    vi.spyOn(ruby, "getFreshSchoolWorldSnapshot").mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return original(...args);
    });
    const eventsSpy = vi.spyOn(ruby, "getFreshSchoolWorldEvents");
    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5",
      clientIp: "203.0.113.209",
    });
    const pending = handleAppRoutes(harness.ctx);
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.response()!.body).toBe("retry: 5000\n\n");

    harness.emitResponse("close");
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(eventsSpy).not.toHaveBeenCalled();
    expect(harness.response()!.body).toBe("retry: 5000\n\n");
  });

  it("releases live world stream slots when socket writes fail", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const clientIp = "203.0.113.204";
    const before = await worldLiveStreamMetrics();
    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=5000&heartbeatMs=1000",
      clientIp,
      throwOnWriteNumber: 3,
    });

    expect(await handleAppRoutes(harness.ctx)).toBe(true);
    let metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 1, clients: 1 });

    await vi.advanceTimersByTimeAsync(1000);
    metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 0, clients: 0 });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      closed: before.closed + 1,
      closedByWriteFailure: before.closedByWriteFailure + 1,
      writeFailures: before.writeFailures + 1,
      heartbeatWriteFailures: before.heartbeatWriteFailures + 1,
    });
  });

  it("skips initial world snapshot work when the first live stream write fails", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const before = await worldLiveStreamMetrics();
    const snapshotSpy = vi.spyOn(ruby, "getFreshSchoolWorldSnapshot");
    const eventsSpy = vi.spyOn(ruby, "getFreshSchoolWorldEvents");
    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=5000&heartbeatMs=1000",
      clientIp: "203.0.113.206",
      throwOnWriteNumber: 1,
    });

    expect(await handleAppRoutes(harness.ctx)).toBe(true);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
    const metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 0, clients: 0 });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      accepted: before.accepted + 1,
      closed: before.closed + 1,
      closedByWriteFailure: before.closedByWriteFailure + 1,
      writeFailures: before.writeFailures + 1,
      initialWriteFailures: before.initialWriteFailures + 1,
    });
  });

  it("ends live world streams cleanly when the initial snapshot fails", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const before = await worldLiveStreamMetrics();
    vi.spyOn(ruby, "getFreshSchoolWorldSnapshot").mockRejectedValueOnce(new Error("storage offline"));

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=5000&heartbeatMs=1000",
      clientIp: "203.0.113.207",
    });

    expect(await handleAppRoutes(harness.ctx)).toBe(true);
    expect(harness.response()!.status).toBe(200);
    expect(harness.response()!.body).toContain("event: end");
    expect(harness.response()!.body).toContain('"ok":false');
    expect(harness.response()!.body).toContain("World stream unavailable.");

    const metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 0, clients: 0 });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      accepted: before.accepted + 1,
      closed: before.closed + 1,
      handlerErrors: before.handlerErrors + 1,
    });
  });

  it("ends one-shot world event streams cleanly when the initial snapshot fails", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const before = await worldLiveStreamMetrics();
    vi.spyOn(ruby, "getFreshSchoolWorldSnapshot").mockRejectedValueOnce(new Error("storage offline"));

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5",
      clientIp: "203.0.113.208",
    });

    expect(await handleAppRoutes(harness.ctx)).toBe(true);
    expect(harness.response()!.status).toBe(200);
    expect(harness.response()!.body).toContain("retry: 5000");
    expect(harness.response()!.body).toContain("event: end");
    expect(harness.response()!.body).toContain('"ok":false');
    expect(harness.response()!.body).toContain("World stream unavailable.");

    const metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      active: before.active,
      clients: before.clients,
      accepted: before.accepted,
      closed: before.closed,
      handlerErrors: before.handlerErrors,
    });
  });

  it("stops replay accounting at the delivered event when socket writes fail mid-batch", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const session = await auth.createGuestSession();
    const sessionId = auth.stateKeyForCookie(`rh_session=${session.token}`);
    attachCohortStudent(sessionId, "Socket Noor", "10", "A");
    const state = ruby.getOrCreate(sessionId);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const now = Date.now();
    state.schoolEvents.push({
      id: "school:event:socket-write-a",
      kind: "comic.page-unlocked",
      at: now - 2,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-01",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Socket write A",
    });
    state.schoolEvents.push({
      id: "school:event:socket-write-b",
      kind: "comic.page-unlocked",
      at: now - 1,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-02",
      pageNumber: 2,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Socket write B",
    });

    const harness = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=5000&heartbeatMs=1000",
      clientIp: "203.0.113.205",
      throwOnWriteNumber: 4,
    });

    expect(await handleAppRoutes(harness.ctx)).toBe(true);
    expect(harness.response()!.body).toContain("Socket write A");
    expect(harness.response()!.body).not.toContain("Socket write B");
    const metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({ active: 0, clients: 0 });
  });

  it("separates live world stream slots by visitor behind a shared IP", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const clientIp = "203.0.113.201";
    const openStreams: Array<ReturnType<typeof route>> = [];

    for (let i = 0; i < 6; i += 1) {
      const harness = route({
        path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
        clientIp,
        visitorHeader: "rhv_visitor_a",
      });
      expect(await handleAppRoutes(harness.ctx)).toBe(true);
      expect(harness.response()!.status).toBe(200);
      openStreams.push(harness);
    }

    const blocked = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
      visitorHeader: "rhv_visitor_a",
    });
    expect(blocked.status).toBe(429);

    const neighbor = route({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
      visitorHeader: "rhv_visitor_b",
    });
    expect(await handleAppRoutes(neighbor.ctx)).toBe(true);
    expect(neighbor.response()!.status).toBe(200);
    openStreams.push(neighbor);

    const metrics = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(metrics.body.ops.worldLiveStreams).toMatchObject({
      active: 7,
      clients: 2,
      limitPerClient: 6,
      saturatedClients: 1,
      maxClientStreams: 6,
    });

    await vi.advanceTimersByTimeAsync(1000);
    for (const harness of openStreams) {
      expect(harness.response()!.body).toContain("event: end");
    }
  });

  it("falls back to IP-only live world stream slots for malformed visitor headers", async () => {
    vi.useFakeTimers();
    const clientIp = "203.0.113.202";
    const openStreams: Array<ReturnType<typeof route>> = [];

    for (let i = 0; i < 6; i += 1) {
      const harness = route({
        path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
        clientIp,
        visitorHeader: `bad ${i}`,
      });
      expect(await handleAppRoutes(harness.ctx)).toBe(true);
      expect(harness.response()!.status).toBe(200);
      openStreams.push(harness);
    }

    const blocked = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
      visitorHeader: "also bad",
    });
    expect(blocked.status).toBe(429);

    await vi.advanceTimersByTimeAsync(1000);
    for (const harness of openStreams) {
      expect(harness.response()!.body).toContain("event: end");
    }
  });

  it("does not let unprefixed visitor headers bypass live world stream slots", async () => {
    vi.useFakeTimers();
    const clientIp = "203.0.113.210";
    const openStreams: Array<ReturnType<typeof route>> = [];

    for (let i = 0; i < 6; i += 1) {
      const harness = route({
        path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
        clientIp,
        visitorHeader: `visitor_rotation_${i}`,
      });
      expect(await handleAppRoutes(harness.ctx)).toBe(true);
      expect(harness.response()!.status).toBe(200);
      openStreams.push(harness);
    }

    const blocked = await appRoute({
      path: "/api/apps/ruby-high/world/events?limit=5&live=1&streamMs=1000&heartbeatMs=1000",
      clientIp,
      visitorHeader: "visitor_rotation_neighbor",
    });
    expect(blocked.status).toBe(429);

    await vi.advanceTimersByTimeAsync(1000);
    for (const harness of openStreams) {
      expect(harness.response()!.body).toContain("event: end");
    }
  });
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
    expect(response.body).toContain("/api/apps/ruby-high/admin/curriculum/replenishment");
    expect(response.body).toContain("Trends");
    expect(response.body).toContain("Create review drafts");
    expect(response.body).toContain("curriculum-export-btn");
    expect(response.body).toContain("Photo posts");
    expect(response.body).toContain("photoPostMetricValue");
    expect(response.body).toContain("Reconnect for image posts - missing media.write");
    expect(response.body).toContain("reconnect for images");
    expect(response.body).toContain("Image posts enabled");
    expect(response.body).toContain("World health");
    expect(response.body).toContain("worldHealthMetricValue");
    expect(response.body).toContain("Public reads");
    expect(response.body).toContain("publicReadMetricValue");
    expect(response.body).toContain("World streams");
    expect(response.body).toContain("worldStreamMetricValue");
    expect(response.body).toContain("Identity records");
    expect(response.body).toContain("localStorage");
    expect(response.body).not.toContain("admin-test-token");
    expect(response.body).not.toContain("\"auth\":");
    const script = String(response.body).match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("requires an admin token and returns auth, Ruby High, and log snapshots", async () => {
    await createSession();
    const publicSessionId = "rh:user:metrics-world-health";
    attachCohortStudent(publicSessionId, "Metrics Noor", "10", "A");
    const publicState = ruby.getOrCreate(publicSessionId);
    const eventAt = Date.UTC(2026, 5, 14, 12);
    publicState.faculty = "ruby";
    publicState.updatedAt = eventAt;
    publicState.schoolEvents.push({
      id: "school:event:metrics-world-health",
      kind: "comic.page-unlocked",
      at: eventAt,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-metrics",
      pageNumber: 9,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Metrics world health page",
    });

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
      schemaVersion: "ruby-high-admin-metrics.v5",
      schemaPath: "/api/apps/ruby-high/admin/metrics/schema",
      auth: {
        users: 1,
        activeSessions: 1,
        providers: { guest: 1 },
      },
      ruby: {
        sessions: 1,
        world: {
          lastRefreshAt: null,
          refreshAgeMs: null,
          refreshIntervalMs: 2_000,
          activeStudents: 1,
          activeRooms: 1,
          recentEvents: 1,
          newestEventAt: eventAt,
          durableEventCacheSize: 0,
          durableEventCacheLimit: 400,
        },
        photoPosts: {
          schedulerActive: false,
          schedulerRunning: false,
          schedulerIntervalMs: null,
          pendingPhotos: 0,
          inFlightPosts: 0,
          deferredPosts: 0,
          nextRetryAt: null,
          lastAttemptAt: null,
          lastResult: null,
        },
        events: {
          total: expect.any(Number),
        },
      },
      logs: {
        build: expect.any(String),
        counters: expect.any(Array),
      },
      ops: {
        publicReadLimiter: {
          trackedKeys: expect.any(Number),
          gcIntervalMs: 60_000,
        },
        worldLiveStreams: {
          active: 0,
          clients: 0,
          limitPerClient: 6,
          saturatedClients: 0,
          maxClientStreams: 0,
        },
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

  it("exports token-gated curriculum replenishment steps without mutating banks", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const sessionId = "rh:user:admin-curriculum-low-pool";
    const state = ruby.getOrCreate(sessionId);
    state.character = {
      name: "Mira",
      playbookId: "overachiever",
      stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
      arcAnswer: "I turn thin question pools into stronger classes.",
      personality: "Careful, competitive, and generous with classmates.",
      createdAt: Date.UTC(2026, 5, 1),
      yearbook: [],
    };
    state.currentGrade = "10";
    state.faculty = "ruby";
    const pack = await getActivePack();
    const rubyFaculty = pack.faculty.find((faculty) => faculty.id === "ruby")!;
    const eligibleIds = [
      ...rubyFaculty.questions,
      ...(rubyFaculty.sourceCards ?? []),
    ]
      .filter((question) =>
        (question.difficulty === "easy" || question.difficulty === "medium") &&
        (!question.minGrade || Number(question.minGrade) <= 10)
      )
      .map((question) => question.id);
    state.cardMemory = {};
    for (const questionId of eligibleIds.slice(0, -1)) {
      state.cardMemory[cardMemoryKey("ruby", questionId)] = {
        courseId: "ruby",
        questionId,
        phase: "learning",
        dueAt: Date.UTC(2026, 6, 1),
        stability: 1,
        difficulty: 0.5,
        consecutiveCorrect: 1,
        correctCount: 1,
        wrongCount: 0,
        delayedCorrectCount: 0,
        lastReviewedAt: Date.UTC(2026, 5, 1),
        lastResult: "good",
        lapses: 0,
      };
    }

    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(401);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: true,
      source: "/api/apps/ruby-high/admin/metrics",
      planCount: expect.any(Number),
      reviewQueue: [],
    });
    const rubyStep = response.body.steps.find((step: { facultyId: string; grade: string }) =>
      step.facultyId === "ruby" && step.grade === "10"
    );
    expect(rubyStep).toMatchObject({
      mode: "generate",
      targetDifficulty: "easy",
      targetMinGrade: "10",
      command: expect.arrayContaining([
        "node",
        "scripts/generate-built-in-question-bank.mjs",
        "--faculty=ruby",
      ]),
    });
    expect(rubyStep.displayCommand).toContain("scripts/generate-built-in-question-bank.mjs");
    expect(rubyStep.promptSeed).toContain("actively researching");
    expect(rubyStep.reason).toContain("Built-in teacher pool");

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { limit: 1 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      created: 1,
      reused: 0,
      drafts: [
        expect.objectContaining({
          facultyId: "ruby",
          grade: "10",
          mode: "generate",
          status: "created",
          teacherCount: 1,
          questionCount: 0,
        }),
      ],
    });
    const persistedDrafts = await store.loadDraftPacks();
    expect(persistedDrafts).toHaveLength(1);
    expect(persistedDrafts[0]!.name).toContain("Curriculum Replenishment");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Prompt Seed");
    expect(persistedDrafts[0]!.teachers[0]!.sourceCards.length).toBeGreaterThan(0);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "export-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Review and generate questions");

    const reviewedDraft = {
      ...persistedDrafts[0]!,
      teachers: [{
        ...persistedDrafts[0]!.teachers[0]!,
        questions: [{
          id: "draft-ruby-ai-1",
          type: "multiple-choice" as const,
          prompt: "Which habit helps Ruby notice a curriculum gap before it becomes repetition?",
          options: {
            A: "Watching low-pool metrics",
            B: "Ignoring prior cards",
            C: "Removing source notes",
            D: "Posting the same question daily",
          },
          correct: "A" as const,
          explanation: "The replenishment loop starts from low-pool metrics and review.",
          subject: "ai-literacy",
          difficulty: "easy" as const,
          faculty: "draft-ruby",
          stat: "head" as const,
        }],
      }],
    };
    await ruby.saveDraftPackRecord(reviewedDraft);

    await ruby.saveDraftPackRecord({
      ...reviewedDraft,
      teachers: [{
        ...reviewedDraft.teachers[0]!,
        questions: [{
          ...reviewedDraft.teachers[0]!.questions[0]!,
          prompt: rubyFaculty.questions[0]!.prompt,
        }],
      }],
    });
    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "export-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("duplicates existing built-in question");

    await ruby.saveDraftPackRecord(reviewedDraft);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "export-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: true,
      draftId: persistedDrafts[0]!.id,
      facultyId: "ruby",
      grade: "10",
      targetFile: "assets/questions/ruby.json",
      questionCount: 1,
      sourceQuestionIds: ["draft-ruby-ai-1"],
      questions: [
        expect.objectContaining({
          faculty: "ruby",
          minGrade: "10",
          id: expect.stringMatching(/^ruby-review-\d{8}-001$/),
        }),
      ],
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.reviewQueue).toEqual([
      expect.objectContaining({
        id: persistedDrafts[0]!.id,
        facultyId: "ruby",
        grade: "10",
        teacherCount: 1,
        questionCount: 1,
        sourceCardCount: persistedDrafts[0]!.teachers[0]!.sourceCards.length,
      }),
    ]);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { limit: "not-a-number" },
    });
    expect(response.body).toMatchObject({
      created: 0,
      reused: 1,
      drafts: [expect.objectContaining({ status: "existing" })],
    });
    expect(await store.loadDraftPacks()).toHaveLength(1);
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
      schemaVersion: "ruby-high-admin-metrics.v5",
      endpoint: "/api/apps/ruby-high/admin/metrics",
      bucketTimezone: "UTC",
      trustStart: "2026-06-15",
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
      expect.objectContaining({
        path: "auth.visitors",
        reliability: "authoritative",
      }),
      expect.objectContaining({
        path: "ruby.retention.visitorD1",
        reliability: "authoritative",
      }),
      expect.objectContaining({
        path: "ruby.funnel.first10m",
        reliability: "authoritative",
      }),
      expect.objectContaining({
        path: "ruby.guestSpotlight",
        reliability: "authoritative",
      }),
      expect.objectContaining({
        path: "ruby.balance.repeatRate",
        reliability: "proxy",
      }),
      expect.objectContaining({
        path: "ruby.world",
        reliability: "proxy",
      }),
      expect.objectContaining({
        path: "ruby.photoPosts",
        reliability: "proxy",
      }),
      expect.objectContaining({
        path: "ops.publicReadLimiter",
        reliability: "volatile",
      }),
      expect.objectContaining({
        path: "ops.worldLiveStreams",
        reliability: "volatile",
      }),
    ]));
    const activityProxy = response.body.fields.find((field: { path: string }) => field.path === "ruby.characterSessionsUpdatedLast24h");
    expect(activityProxy?.caveat).toContain("ruby.events.appOpen");
    expect(JSON.stringify(response.body)).not.toContain("until durable app_open/session_resume events exist");
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
      visitorHeader: "rhv_metrics_test_visitor",
      body: { type: "app_open", path: "/api/apps/ruby-high/viewer" },
    });
    expect(response.status).toBe(200);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      visitorHeader: "rhv_metrics_test_visitor",
      body: { type: "session_resume", inactiveMs: 600_000, reason: "focus" },
    });
    expect(response.status).toBe(200);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });
    const persistedEvents = await store.loadMetricEvents();
    expect(persistedEvents.map((event) => event.name).sort()).toEqual(["app_open", "session_resume", "visitor_seen", "visitor_seen"]);
    expect(response.body.ruby.events.appOpen).toMatchObject({
      total: 1,
      uniqueSessions: 1,
      uniqueVisitors: 1,
    });
    expect(response.body.ruby.events.sessionResume).toMatchObject({
      total: 1,
      uniqueSessions: 1,
      uniqueVisitors: 1,
    });
    expect(response.body.ruby.events.visitorSeen).toMatchObject({
      total: 2,
      uniqueVisitors: 1,
    });
    expect(response.body.ruby.daily.at(-1)).toMatchObject({
      appOpens: 1,
      sessionResumes: 1,
      visitorSeen: 2,
    });
    expect(response.body.ruby.events.total).toBeGreaterThanOrEqual(2);
    expect(sessionId).toMatch(/^rh:user:/);
    expect(ruby.analyticsSnapshot().events.appOpen.uniqueSessions).toBe(1);
    expect(ruby.analyticsSnapshot().events.appOpen.uniqueVisitors).toBe(1);
    const appOpen = (await store.loadMetricEvents()).find((event) => event.name === "app_open");
    expect(appOpen?.metadata).toMatchObject({
      path: "/api/apps/ruby-high/viewer",
      userAgent: "Vitest Browser",
    });
  });

  it("ignores legacy unprefixed visitor ids for durable visitor metrics", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const { token } = await auth.createGuestSession();
    const cookieHeader = `rh_session=${token}`;

    const response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      visitorHeader: "legacy_metrics_visitor",
      body: { type: "app_open", path: "/api/apps/ruby-high/viewer" },
    });
    expect(response.status).toBe(200);

    const persistedEvents = await store.loadMetricEvents();
    expect(persistedEvents.map((event) => event.name)).toEqual(["app_open"]);
    expect(persistedEvents[0]?.visitorHash).toBeUndefined();
  });

  it("accepts Privy wallet auth diagnostics as durable error metrics", async () => {
    const { token } = await auth.createGuestSession();
    const cookieHeader = `rh_session=${token}`;

    const response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      visitorHeader: "rhv_privy_diag_test_visitor",
      body: {
        type: "privy_auth_error",
        diagnosticType: "phantom.siws.authenticate.error",
        level: "error",
        stage: "authenticate",
        errorMessage: "Could not log in with wallet",
        dataMessage: "Solana wallet auth is disabled",
        privyErrorCode: "ERROR_WALLET_CONNECTION",
        walletClientType: "phantom",
        connectorType: "injected",
        provider: "privy",
        phantomAvailable: true,
        hasWindowPhantom: true,
        hasSignMessage: true,
      },
    });
    expect(response.status).toBe(200);

    const events = await store.loadMetricEvents();
    const diagnostic = events.find((event) => event.name === "error");
    expect(diagnostic).toMatchObject({
      name: "error",
      source: "viewer",
      feature: "privy_wallet_auth",
      step: "phantom.siws.authenticate.error",
      status: "error",
      metadata: expect.objectContaining({
        diagnosticType: "phantom.siws.authenticate.error",
        errorMessage: "Could not log in with wallet",
        dataMessage: "Solana wallet auth is disabled",
        privyErrorCode: "ERROR_WALLET_CONNECTION",
        walletClientType: "phantom",
        connectorType: "injected",
        provider: "privy",
        phantomAvailable: true,
        hasWindowPhantom: true,
        hasSignMessage: true,
      }),
    });
  });

  it("computes event-backed visitor and character D1 retention", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const base = Date.UTC(2026, 4, 1, 12);
    const { token } = await auth.createGuestSession(null, "rhv_retention_visitor");
    const cookieHeader = `rh_session=${token}`;
    const sessionId = auth.stateKeyForCookie(cookieHeader);

    ruby.recordMetricEvent("visitor_seen", {
      sessionId,
      visitorHash: "visitor-hash-test",
      feature: "viewer",
      occurredAt: base,
    });
    ruby.recordMetricEvent("app_open", {
      sessionId,
      visitorHash: "visitor-hash-test",
      feature: "viewer",
      occurredAt: base,
    });
    ruby.recordMetricEvent("funnel_step", {
      sessionId,
      feature: "activation",
      step: "first_character_created",
      status: "success",
      occurredAt: base + 60_000,
    });
    ruby.recordMetricEvent("session_resume", {
      sessionId,
      visitorHash: "visitor-hash-test",
      feature: "viewer",
      occurredAt: base + 24 * 60 * 60 * 1000 + 60_000,
      metadata: { inactiveMs: 24 * 60 * 60 * 1000 },
    });

    const response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.body.ruby.retention.visitorD1).toMatchObject({
      eligibleVisitors: 1,
      returnedVisitors: 1,
      rate: 1,
    });
    expect(response.body.ruby.retention.characterD1).toMatchObject({
      eligibleSessions: 1,
      returnedSessions: 1,
      rate: 1,
    });
  });

  it("rate-limits durable viewer metrics events", async () => {
    const { token } = await auth.createGuestSession();
    const cookieHeader = `rh_session=${token}`;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T00:00:00.000Z"));

    for (let i = 0; i < 60; i++) {
      const response = await appRoute({
        method: "POST",
        path: "/api/apps/ruby-high/metrics/event",
        cookieHeader,
        clientIp: "203.0.113.9",
        body: { type: "app_open", path: `/viewer?refresh=${i}` },
      });
      expect(response.status).toBe(200);
    }

    const response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/metrics/event",
      cookieHeader,
      clientIp: "203.0.113.9",
      body: { type: "app_open", path: "/viewer?refresh=overflow" },
    });
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
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
    ruby.recordMetricEvent("llm_usage", {
      sessionId,
      provider: "OpenRouter",
      model: "test-model",
      status: "skipped",
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
      llmCalls: 2,
      durableErrors: 1,
    });
    expect(response.body.ruby.events.llm).toMatchObject({
      calls: 2,
      successes: 1,
      errors: 0,
      byProvider: { OpenRouter: 2 },
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

  it("keeps malformed persisted commerce deltas from poisoning aggregate metrics", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    await store.saveMetricEvent({
      id: "bad-commerce",
      name: "commerce",
      occurredAt: Date.UTC(2026, 4, 18),
      day: "2026-05-18",
      sessionId: "rh:user:bad-commerce",
      source: "legacy-import",
      feature: "hall-pass-grant",
      status: "success",
      hallPassesDelta: "not-a-number" as never,
      amountCents: "also-bad" as never,
    });
    ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();

    const response = await appRoute({
      path: "/api/apps/ruby-high/admin/metrics",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.status).toBe(200);
    expect(response.body.ruby.events.commerce).toMatchObject({
      events: 1,
      hallPassesDelta: 0,
      amountCents: 0,
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
    expect(prompt).toContain("ruby-high-admin-metrics.v5");
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
    expect(response.status).toBe(200);
  });

  it("rejects malformed share ids without throwing", async () => {
    const response = await appRoute({
      path: "/api/apps/ruby-high/yearbook/%E0%A4%A/9?format=json",
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Yearbook card not found.");
  });
});
