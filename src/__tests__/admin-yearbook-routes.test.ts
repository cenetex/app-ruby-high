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
    end(body?: string | Buffer) {
      if (Buffer.isBuffer(body)) {
        response = { status: (res as { statusCode?: number }).statusCode ?? 200, body, headers };
        return;
      }
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

function useSchoolWorldFixtureTime(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 5, 14, 14));
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 60_000);
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
    useSchoolWorldFixtureTime();
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
      summary: {
        schoolYear: expect.any(String),
        studySparks: {
          total: expect.any(Number),
          byGrade: expect.any(Object),
        },
      },
    });
    expect(response.body.world.activeRooms).toEqual([
      expect.objectContaining({
        grade: "10",
        facultyId: "ruby",
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
    useSchoolWorldFixtureTime();
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
    useSchoolWorldFixtureTime();
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
    useSchoolWorldFixtureTime();
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
    useSchoolWorldFixtureTime();
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
    const comicEventBlocks = eventBlocks.filter((block) => (
      block.includes("Cursor page A") ||
      block.includes("Cursor page B") ||
      block.includes("Cursor page C")
    ));
    expect(comicEventBlocks).toHaveLength(3);
    const cursorLine = comicEventBlocks[0]!.split("\n").find((line) => line.startsWith("id: world:cursor:"));
    expect(cursorLine).toBeTruthy();
    const firstLabel = ["Cursor page A", "Cursor page B", "Cursor page C"].find((label) => comicEventBlocks[0]!.includes(label));
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
    useSchoolWorldFixtureTime();
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
    expect(response.body).toContain("/api/apps/ruby-high/admin/world/moderation");
    expect(response.body).toContain("Trends");
    expect(response.body).toContain("Identity");
    expect(response.body).toContain("Classroom");
    expect(response.body).toContain("Economy");
    expect(response.body).toContain("Operations");
    expect(response.body).toContain("Create review drafts");
    expect(response.body).toContain("curriculum-export-btn");
    expect(response.body).toContain("curriculum-approve-btn");
    expect(response.body).toContain("approval required before promotion");
    expect(response.body).toContain("Photo posts");
    expect(response.body).toContain("photoPostMetricValue");
    expect(response.body).toContain("Reconnect for image posts - missing media.write");
    expect(response.body).toContain("reconnect for images");
    expect(response.body).toContain("Image posts enabled");
    expect(response.body).toContain("Reconnect for text posts - missing tweet.write");
    expect(response.body).toContain("posting paused");
    expect(response.body).toContain("Text posts enabled");
    expect(response.body).toContain("Merit Stars");
    expect(response.body).toContain("Hall Passes");
    expect(response.body).toContain("Solana packs");
    expect(response.body).toContain("Sponsored LLM");
    expect(response.body).toContain("School activity");
    expect(response.body).toContain("schoolActivityMetricValue");
    expect(response.body).toContain("suppressed");
    expect(response.body).toContain("Activity reads");
    expect(response.body).toContain("publicReadMetricValue");
    expect(response.body).toContain("Activity streams");
    expect(response.body).toContain("worldStreamMetricValue");
    expect(response.body).toContain("Identity records");
    expect(response.body).toContain("guest / BYOK OpenRouter / Privy");
    expect(response.body).toContain("localStorage");
    expect(response.body).not.toContain("admin-test-token");
    expect(response.body).not.toContain("\"auth\":");
    const script = String(response.body).match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("serves authenticated public world moderation reports without raw session ids", async () => {
    const now = Date.UTC(2026, 5, 15, 14);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 60_000);
    const sessionId = "rh:user:moderation-reporter";
    const secondSessionId = "rh:user:moderation-second-reporter";
    attachCohortStudent(sessionId, "Report Noor", "10", "A");
    attachCohortStudent(secondSessionId, "Report Mina", "10", "A");
    const state = ruby.getOrCreate(sessionId);
    state.faculty = "ruby";
    state.updatedAt = now;
    state.schoolEvents.push({
      id: "school:event:moderation-page",
      kind: "comic.page-unlocked",
      at: now,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-moderation",
      pageNumber: 6,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Moderation page",
    });
    const eventId = publicWorldEventId("comic.page-unlocked", now, "school:event:moderation-page");
    ruby.reportPublicWorldEvent(sessionId, {
      eventId,
      reason: "spoiler in the world feed\nwith extra whitespace",
      now,
    });
    ruby.reportPublicWorldEvent(secondSessionId, {
      eventId,
      reason: "same event is still noisy",
      now: now + 1,
    });

    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/world/moderation",
      authorizationHeader: "Bearer wrong",
    });
    expect(response.status).toBe(503);

    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    response = await appRoute({
      path: "/api/apps/ruby-high/admin/world/moderation?limit=10",
      authorizationHeader: "Bearer admin-test-token",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      generatedAt: expect.any(Number),
      reportCount: 2,
      moderatorNotes: [],
    });
    expect(response.body.reports).toEqual(expect.arrayContaining([expect.objectContaining({
        eventId,
        reason: "spoiler in the world feed with extra whitespace",
        createdAt: now,
        reporterCharacterName: "Report Noor",
        reportCountForEvent: 2,
        moderatorNote: null,
        event: {
          id: eventId,
          kind: "comic.page-unlocked",
          at: now,
          faculty: "ruby",
          grade: "10",
          label: "Moderation page",
        },
      })]));
    const firstReport = response.body.reports.find((report: { reporterCharacterName: string }) =>
      report.reporterCharacterName === "Report Noor"
    );
    expect(firstReport.reporterId).toMatch(/^world:reporter:[a-f0-9]{16}$/);
    const reportId = firstReport.id;
    expect(JSON.stringify(response.body)).not.toContain(sessionId);
    expect(JSON.stringify(response.body)).not.toContain(secondSessionId);
    expect(JSON.stringify(response.body)).not.toContain("school:event:moderation-page");
    expect(JSON.stringify(response.body)).not.toContain("teacher:ruby:grade:10");

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/world/moderation",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "note-event", eventId, note: "Review name policy\nif this repeats." },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      eventId,
      note: "Review name policy if this repeats.",
      updated: true,
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/world/moderation?limit=10",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.moderatorNotes).toEqual([{
      eventId,
      note: "Review name policy if this repeats.",
      updatedAt: expect.any(Number),
    }]);
    expect(response.body.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId,
        reportCountForEvent: 2,
        moderatorNote: {
          eventId,
          note: "Review name policy if this repeats.",
          updatedAt: expect.any(Number),
        },
      }),
    ]));

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/world/moderation",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "suppress-event", eventId, reason: "globally noisy" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      generatedAt: expect.any(Number),
      eventId,
      reason: "globally noisy",
      suppressed: true,
    });

    const world = await appRoute({ path: "/api/apps/ruby-high/world?limit=10" });
    expect(world.status).toBe(200);
    expect(JSON.stringify(world.body.world.recentEvents)).not.toContain("Moderation page");

    const storedModeration = await store.loadServiceState("ruby-high:public-world-moderation:v1");
    expect(storedModeration?.data).toMatchObject({
      version: 1,
      suppressedEvents: [{
        eventId,
        reason: "globally noisy",
        suppressedAt: expect.any(Number),
      }],
      moderatorNotes: [{
        eventId,
        note: "Review name policy if this repeats.",
        updatedAt: expect.any(Number),
      }],
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/world/moderation?limit=10",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.status).toBe(200);
    expect(response.body.suppressedEvents).toEqual([{
      eventId,
      reason: "globally noisy",
      suppressedAt: expect.any(Number),
    }]);
    expect(response.body.moderatorNotes).toEqual([{
      eventId,
      note: "Review name policy if this repeats.",
      updatedAt: expect.any(Number),
    }]);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/world/moderation",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "note-event", eventId, note: "" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      eventId,
      note: "",
      updated: true,
    });

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/world/moderation",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "dismiss-report", reportId },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      generatedAt: expect.any(Number),
      reportId,
      dismissed: true,
      dismissedCount: 1,
    });
    expect(ruby.getOrCreate(secondSessionId).publicWorldEventReports).toHaveLength(1);
    expect(ruby.getOrCreate(sessionId).publicWorldEventReports).toEqual([]);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/world/moderation?limit=10",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.status).toBe(200);
    expect(response.body.reportCount).toBe(1);
    expect(response.body.moderatorNotes).toEqual([]);
    expect(response.body.reports).toEqual([
      expect.objectContaining({
        eventId,
        reporterCharacterName: "Report Mina",
        reportCountForEvent: 1,
        moderatorNote: null,
      }),
    ]);
  });

  it("requires an admin token and returns auth, Ruby High, and log snapshots", async () => {
    await createSession();
    const publicSessionId = "rh:user:metrics-world-health";
    const eventAt = Date.UTC(2026, 5, 14, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(eventAt));
    attachCohortStudent(publicSessionId, "Metrics Noor", "10", "A");
    const publicState = ruby.getOrCreate(publicSessionId);
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
      schemaVersion: "ruby-high-admin-metrics.v6",
      schemaPath: "/api/apps/ruby-high/admin/metrics/schema",
      auth: {
        users: 1,
        unexpiredAuthSessions: 1,
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
          recentEvents: 2,
          newestEventAt: eventAt,
          durableEventCacheSize: 0,
          durableEventCacheLimit: 400,
          publicEventLogSize: 2,
          publicEventLogLimit: 400,
          durableRoomRecords: 1,
          durableRoomRecordLimit: 80,
          durableRoomOutcomes: 0,
          durableRoomOutcomeLimit: 120,
          recentRoomOutcomes: [],
          durableTermRecords: 1,
          durableTermRecordLimit: 12,
          recentTerms: [
            expect.objectContaining({
              totalSparks: 0,
              level: 0,
              activeRuleLabels: [],
            }),
          ],
          durableTeacherAgendas: 0,
          durableTeacherAgendaLimit: 80,
          teacherAgendaExecution: {
            ready: 0,
            queued: 0,
            watching: 0,
          },
          recentTeacherAgendas: [],
          liveRoomGoals: 0,
          suppressedEvents: 0,
          summary: {
            schoolYear: expect.any(String),
            eventCount: 2,
            byKind: {
              "comic.page-unlocked": 1,
              "room.goal-progress": 1,
            },
            byGrade: {
              "10": 2,
            },
            roomGoalEvents: {
              total: 1,
              complete: 0,
            },
            studySparks: {
              total: 0,
            },
          },
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

  it("exports and promotes token-gated curriculum replenishment steps", async () => {
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
        dueAt: Date.UTC(2036, 0, 1),
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
      corpusId: "ruby-research-corpus",
      corpusTitle: "Ruby Research Corpus",
      corpusPath: "assets/corpora/ruby.md",
      researchInterests: expect.arrayContaining(["AI application design", "agent reliability"]),
      readingList: expect.arrayContaining([expect.stringContaining("Agent operations notes")]),
      canonicalMisconceptions: expect.arrayContaining([expect.stringContaining("context window")]),
      sourcePackets: expect.arrayContaining([
        expect.objectContaining({
          id: "ruby-source-agent-ops",
          title: "Agent operations notes",
          anchor: expect.stringContaining("idempotency"),
        }),
      ]),
      gradeBrief: expect.stringContaining("sophomores"),
      command: expect.arrayContaining([
        "node",
        "scripts/generate-built-in-question-bank.mjs",
        "--faculty=ruby",
      ]),
    });
    expect(rubyStep.displayCommand).toContain("scripts/generate-built-in-question-bank.mjs");
    expect(rubyStep.researchDirective).toContain("Ruby Research Corpus");
    expect(rubyStep.researchDirective).toContain("Grade brief:");
    expect(rubyStep.researchLanes.length).toBeGreaterThan(0);
    expect(rubyStep.promptSeed).toContain("actively researching");
    expect(rubyStep.promptSeed).toContain("Grade brief:");
    expect(rubyStep.promptSeed).toContain("Test one misconception");
    expect(rubyStep.reason).toContain("Built-in teacher pool");
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: expect.stringMatching(/^curriculum-replenishment:\d{4}-\d{2}-\d{2}:10:ruby$/),
        facultyId: "ruby",
        grade: "10",
        status: "ready",
        action: "create-draft",
        draftId: null,
        priority: expect.any(Number),
        corpusId: "ruby-research-corpus",
        researchLanes: expect.any(Array),
      }),
    ]));

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
          questionCount: 6,
        }),
      ],
    });
    const persistedDrafts = await store.loadDraftPacks();
    expect(persistedDrafts).toHaveLength(1);
    expect(persistedDrafts[0]!.name).toContain("Curriculum Replenishment");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Ruby Research Corpus");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Research Directive");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Reading List");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Canonical Misconceptions");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Primary Source Packets");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("ruby-source-agent-ops");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Question seeds:");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Grade brief:");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Prompt Seed");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Automatic Candidate Drafts");
    expect(persistedDrafts[0]!.teachers[0]!.sourceCards.length).toBeGreaterThan(0);
    expect(persistedDrafts[0]!.teachers[0]!.questions).toHaveLength(6);
    expect(persistedDrafts[0]!.teachers[0]!.questions[0]).toMatchObject({
      type: "multiple-choice",
      correct: "A",
      faculty: expect.stringMatching(/^draft-/),
      minGrade: "10",
      difficulty: "easy",
      explanation: expect.stringContaining("Ruby Research Corpus"),
    });
    expect(ruby.publicWorldTeacherAgendas().find((agenda) => agenda.grade === "10" && agenda.facultyId === "ruby")).toMatchObject({
      draftId: persistedDrafts[0]!.id,
      draftStatus: "review-draft-created",
      draftQuestionCount: 6,
      draftUpdatedAt: expect.any(Number),
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "queued",
        action: "review-draft",
        draftId: persistedDrafts[0]!.id,
        teacherAgenda: expect.objectContaining({
          draftId: persistedDrafts[0]!.id,
          draftStatus: "review-draft-created",
          draftQuestionCount: 6,
        }),
      }),
    ]));
    expect(response.body.reviewQueue).toEqual([
      expect.objectContaining({
        id: persistedDrafts[0]!.id,
        facultyId: "ruby",
        grade: "10",
        questionCount: 6,
        validation: {
          ok: true,
          errors: [],
        },
      }),
    ]);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "queued",
        action: "review-draft",
        draftId: persistedDrafts[0]!.id,
        teacherAgenda: expect.objectContaining({
          draftId: persistedDrafts[0]!.id,
          draftStatus: "review-draft-created",
          draftQuestionCount: 6,
        }),
      }),
    ]));

    const reviewedDraft = {
      ...persistedDrafts[0]!,
      teachers: [{
        ...persistedDrafts[0]!.teachers[0]!,
        questions: persistedDrafts[0]!.teachers[0]!.questions,
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
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.reviewQueue[0]).toMatchObject({
      id: persistedDrafts[0]!.id,
      questionCount: 1,
      validation: {
        ok: false,
        errors: [expect.stringContaining("duplicates existing built-in question")],
      },
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
      questionCount: 6,
      sourceQuestionIds: persistedDrafts[0]!.teachers[0]!.questions.map((question) => question.id),
      questions: expect.arrayContaining([
        expect.objectContaining({
          faculty: "ruby",
          minGrade: "10",
          id: expect.stringMatching(/^ruby-review-\d{8}-001$/),
        }),
      ]),
    });

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "promote-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Approve the reviewed curriculum draft before promotion.");

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "approve-reviewed", draftId: persistedDrafts[0]!.id, approvedBy: "curriculum-reviewer" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      draftId: persistedDrafts[0]!.id,
      facultyId: "ruby",
      grade: "10",
      approvedBy: "curriculum-reviewer",
      questionCount: 6,
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.reviewQueue[0]).toMatchObject({
      id: persistedDrafts[0]!.id,
      approval: {
        approved: true,
        approvedBy: "curriculum-reviewer",
        stale: false,
        required: true,
      },
    });
    expect(ruby.publicWorldTeacherAgendas().find((agenda) => agenda.grade === "10" && agenda.facultyId === "ruby")).toMatchObject({
      draftId: persistedDrafts[0]!.id,
      draftStatus: "review-approved",
      draftApprovedAt: expect.any(Number),
      draftQuestionCount: 6,
    });

    await ruby.saveDraftPackRecord({
      ...reviewedDraft,
      curriculumReviewApproval: (await store.loadDraftPacks())[0]!.curriculumReviewApproval,
      teachers: [{
        ...reviewedDraft.teachers[0]!,
        questions: [{
          ...reviewedDraft.teachers[0]!.questions[0]!,
          prompt: "Which concrete review habit keeps a generated Ruby question grounded in the teacher corpus?",
        }],
      }],
    });
    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.reviewQueue[0]).toMatchObject({
      id: persistedDrafts[0]!.id,
      approval: {
        approved: false,
        stale: true,
        required: true,
      },
    });
    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "promote-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("approval is stale");

    await ruby.saveDraftPackRecord(reviewedDraft);
    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "approve-reviewed", draftId: persistedDrafts[0]!.id, approvedBy: "curriculum-reviewer" },
    });
    expect(response.status).toBe(200);

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "promote-reviewed", draftId: persistedDrafts[0]!.id },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      draftId: persistedDrafts[0]!.id,
      facultyId: "ruby",
      grade: "10",
      promoted: {
        packId: "ruby-high-original",
        inserted: 6,
        skipped: 0,
        totalQuestions: expect.any(Number),
      },
    });
    const promotedQuestionId = response.body.questions[0]!.id;
    const activePackAfterPromotion = await getActivePack();
    expect(activePackAfterPromotion.faculty.find((faculty) => faculty.id === "ruby")!.questions.some((question) =>
      question.id === promotedQuestionId
    )).toBe(true);
    const persistedPromotedPack = (await store.loadPacks()).find((record) => record.pack.id === "ruby-high-original");
    expect(persistedPromotedPack?.pack.faculty.find((faculty) => faculty.id === "ruby")!.questions.some((question) =>
      question.id === promotedQuestionId
    )).toBe(true);
    expect(ruby.publicWorldTeacherAgendas().find((agenda) => agenda.grade === "10" && agenda.facultyId === "ruby")).toMatchObject({
      draftId: persistedDrafts[0]!.id,
      draftStatus: "questions-promoted",
      draftPromotedAt: expect.any(Number),
      draftQuestionCount: 6,
      promotedQuestionCount: 6,
    });
    await ruby.flush();
    const durableAgendaState = await store.loadServiceState("ruby-high:public-world-teacher-agendas:v1");
    expect(durableAgendaState?.data).toMatchObject({
      agendas: expect.arrayContaining([
        expect.objectContaining({
          grade: "10",
          facultyId: "ruby",
          draftId: persistedDrafts[0]!.id,
          draftStatus: "questions-promoted",
          draftQuestionCount: 6,
          promotedQuestionCount: 6,
        }),
      ]),
    });
    expect(ruby.worldHealthSnapshot().summary.curriculumLoops).toMatchObject({
      inReview: 0,
      promoted: 1,
      byGrade: {
        "10": {
          inReview: 0,
          promoted: 1,
        },
      },
    });
    expect(ruby.worldHealthSnapshot().summary.curriculumLoopHistory).toEqual([
      expect.objectContaining({
        grade: "10",
        facultyId: "ruby",
        displayName: "Ruby",
        status: "questions-promoted",
        questionCount: 6,
        at: expect.any(Number),
      }),
    ]);
    const health = ruby.worldHealthSnapshot();
    expect(health).toMatchObject({
      durableCohortTerms: 4,
      recentCohortTerms: expect.arrayContaining([
        expect.objectContaining({
          grade: "10",
          curriculumLoops: {
            inReview: 0,
            promoted: 1,
          },
          curriculumLoopHistory: [
            expect.objectContaining({
              grade: "10",
              facultyId: "ruby",
              status: "questions-promoted",
              questionCount: 6,
            }),
          ],
        }),
      ]),
    });
    expect(health.recentTerms[0]!).toMatchObject({
      curriculumLoops: {
        inReview: 0,
        promoted: 1,
        byGrade: {
          "10": {
            inReview: 0,
            promoted: 1,
          },
        },
      },
      curriculumLoopHistory: [
        expect.objectContaining({
          grade: "10",
          facultyId: "ruby",
          status: "questions-promoted",
          questionCount: 6,
        }),
      ],
      cohortTerms: expect.arrayContaining([
        expect.objectContaining({
          grade: "10",
          curriculumLoops: {
            inReview: 0,
            promoted: 1,
          },
          curriculumLoopHistory: [
            expect.objectContaining({
              grade: "10",
              facultyId: "ruby",
              status: "questions-promoted",
              questionCount: 6,
            }),
          ],
        }),
      ]),
    });

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "satisfied",
        action: "monitor-coverage",
        draftId: persistedDrafts[0]!.id,
        autoEligible: false,
        autoReason: "Reviewed questions were promoted; monitor coverage before creating another draft.",
        teacherAgenda: expect.objectContaining({
          draftStatus: "questions-promoted",
          promotedQuestionCount: 6,
        }),
      }),
    ]));
    expect(response.body.reviewQueue).toEqual([
      expect.objectContaining({
        id: persistedDrafts[0]!.id,
        facultyId: "ruby",
        grade: "10",
        teacherCount: 1,
        questionCount: 6,
        sourceCardCount: persistedDrafts[0]!.teachers[0]!.sourceCards.length,
        validation: {
          ok: false,
          errors: expect.arrayContaining([expect.stringContaining("duplicates existing built-in question")]),
        },
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
      reused: 0,
      drafts: [],
    });
    expect(await store.loadDraftPacks()).toHaveLength(1);
  });

  it("can seed replenishment draft questions from the configured course LLM", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "or-course-key");
    vi.stubEnv("RUBY_HIGH_COURSE_MODEL", "test/course-model");
    const sessionId = "rh:user:admin-curriculum-llm-low-pool";
    const state = ruby.getOrCreate(sessionId);
    state.character = {
      name: "LLM Mira",
      playbookId: "overachiever",
      stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
      arcAnswer: "I ask the teacher to research weak pools.",
      personality: "Careful and exacting.",
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
        dueAt: Date.UTC(2036, 0, 1),
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              questions: [{
                id: "llm-ruby-weak-pool-1",
                type: "multiple-choice",
                prompt: "Ruby is researching an exhausted AI literacy pool. Which draft question best avoids repetition?",
                options: {
                  A: "Ask a new classroom scenario about authorization and evidence",
                  B: "Reuse the last prompt with one different classmate name",
                  C: "Hide the weak topic from the review queue",
                  D: "Make the answer depend on a private session id",
                },
                correct: "A",
                explanation: "The LLM-backed draft should turn the weak pool and corpus into a fresh, reviewable scenario.",
                subject: "ai-literacy",
                difficulty: "easy",
                minGrade: "10",
                faculty: "draft-ruby",
                stat: "head",
              }],
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { limit: 1, provider: "llm" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      created: 1,
      drafts: [
        expect.objectContaining({
          facultyId: "ruby",
          grade: "10",
          questionCount: 1,
          generationSource: "llm",
          generationModel: "test/course-model",
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer or-course-key");
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("test/course-model");
    expect(body.messages[1].content).toContain("Weak subjects:");
    expect(body.messages[1].content).toContain("Ruby Research Corpus");
    expect(body.messages[1].content).toContain("Reading list:");
    expect(body.messages[1].content).toContain("Canonical misconceptions:");
    expect(body.messages[1].content).toContain("Grade brief:");
    expect(body.messages[1].content).toContain("Primary source packets:");
    expect(body.messages[1].content).toContain("ruby-source-agent-ops");
    const persistedDrafts = await store.loadDraftPacks();
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Generation source: llm");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Generation model: test/course-model");
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Primary Source Packets");
    expect(persistedDrafts[0]!.teachers[0]!.questions[0]).toMatchObject({
      id: "draft-llm-ruby-weak-pool-1",
      faculty: expect.stringMatching(/^draft-/),
      minGrade: "10",
      subject: "ai-literacy",
    });
  });

  it("auto-enqueues review drafts only for exhausted generated curriculum pools", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const sessionId = "rh:user:admin-curriculum-auto-exhausted";
    const state = ruby.getOrCreate(sessionId);
    state.character = {
      name: "Auto Mira",
      playbookId: "overachiever",
      stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
      arcAnswer: "I want the school to notice exhausted classes.",
      personality: "Practical and persistent.",
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
    for (const questionId of eligibleIds) {
      state.cardMemory[cardMemoryKey("ruby", questionId)] = {
        courseId: "ruby",
        questionId,
        phase: "learning",
        dueAt: Date.UTC(2036, 0, 1),
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
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.status).toBe(200);
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "ready",
        action: "create-draft",
        exhaustedSessions: 1,
        autoEligible: true,
        autoReason: "Coverage exhaustion can auto-create a review draft.",
      }),
    ]));

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "auto-enqueue", limit: 3 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      trigger: "coverage-exhaustion",
      created: 1,
      reused: 0,
      drafts: [
        expect.objectContaining({
          facultyId: "ruby",
          grade: "10",
          mode: "generate",
          status: "created",
          generationSource: "deterministic",
        }),
      ],
    });
    const persistedDrafts = await store.loadDraftPacks();
    expect(persistedDrafts).toHaveLength(1);

    response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "queued",
        action: "review-draft",
        autoEligible: false,
        autoReason: "A replenishment draft is already queued for review.",
        draftId: persistedDrafts[0]!.id,
      }),
    ]));

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "auto-enqueue", limit: 3 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      trigger: "coverage-exhaustion",
      created: 0,
      reused: 0,
      drafts: [],
    });
    expect(await store.loadDraftPacks()).toHaveLength(1);
  });

  it("auto-enqueues term-rule teacher agenda drafts before full exhaustion", async () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-test-token");
    const now = Date.now();
    await store.saveServiceState({
      id: "ruby-high:public-world-events:v1",
      updatedAt: now,
      data: {
        version: 1,
        events: Array.from({ length: 6 }, (_value, index) => ({
          id: publicWorldEventId("room.goal-progress", now - index, `term-rally-${index}`),
          kind: "room.goal-progress",
          at: now - index,
          faculty: "ruby",
          grade: "10",
          roomTitle: "Ruby room",
          goalKind: "live-class",
          progress: 3,
          target: 3,
          complete: true,
          label: "Ruby filled a live class goal",
          rewardLabel: "Ruby earned a class-wide Study Spark",
        })),
      },
    });
    await store.flush?.();
    ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    expect(ruby.worldHealthSnapshot(now).summary).toMatchObject({
      studySparks: {
        total: 6,
        byGrade: {
          "10": 6,
        },
      },
    });

    const sessionId = "rh:user:admin-curriculum-term-rule-low-pool";
    const state = ruby.getOrCreate(sessionId);
    state.character = {
      name: "Term Mira",
      playbookId: "overachiever",
      stats: { head: 3, heart: 2, hustle: 2, honor: 3 },
      arcAnswer: "I want the school term to pull weak classes into review.",
      personality: "Careful, competitive, and generous with classmates.",
      createdAt: now,
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
        dueAt: now + 24 * 60 * 60 * 1000,
        stability: 1,
        difficulty: 0.5,
        consecutiveCorrect: 1,
        correctCount: 1,
        wrongCount: 0,
        delayedCorrectCount: 0,
        lastReviewedAt: now,
        lastResult: "good",
        lapses: 0,
      };
    }

    let response = await appRoute({
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
    });
    expect(response.status).toBe(200);
    expect(response.body.generationQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        facultyId: "ruby",
        grade: "10",
        status: "ready",
        action: "create-draft",
        exhaustedSessions: 0,
        autoEligible: true,
        autoReason: "Teacher agenda is ready from Term Rally.",
        teacherAgenda: expect.objectContaining({
          executionStatus: "ready",
          executionReason: "term-rule-pressure",
          nextAction: "generate-draft",
          termRuleLabel: "Term Rally",
          termRuleTarget: 4,
        }),
      }),
    ]));

    response = await appRoute({
      method: "POST",
      path: "/api/apps/ruby-high/admin/curriculum/replenishment",
      authorizationHeader: "Bearer admin-test-token",
      body: { action: "auto-enqueue", limit: 3 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      trigger: "coverage-exhaustion",
      created: 1,
      reused: 0,
      drafts: [
        expect.objectContaining({
          facultyId: "ruby",
          grade: "10",
          mode: "generate",
          status: "created",
          generationSource: "deterministic",
        }),
      ],
    });
    const persistedDrafts = await store.loadDraftPacks();
    expect(persistedDrafts).toHaveLength(1);
    expect(persistedDrafts[0]!.teachers[0]!.materials).toContain("Term Rally");
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
      schemaVersion: "ruby-high-admin-metrics.v6",
      endpoint: "/api/apps/ruby-high/admin/metrics",
      bucketTimezone: "UTC",
      trustStart: "2026-07-26",
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
        path: "ruby.scheduledPosts",
        reliability: "authoritative",
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

  it("accepts viewer class-ritual visibility events as durable metrics", async () => {
    const { token } = await auth.createGuestSession();
    const cookieHeader = `rh_session=${token}`;

    for (const type of ["teacher_response_viewed", "room_reaction_viewed"] as const) {
      const response = await appRoute({
        method: "POST",
        path: "/api/apps/ruby-high/metrics/event",
        cookieHeader,
        visitorHeader: "rhv_class_ritual_visitor",
        body: { type, questionId: "take-ruby-9", faculty: "ruby" },
      });
      expect(response.status).toBe(200);
    }

    const events = await store.loadMetricEvents();
    expect(events.filter((event) => event.feature === "daily_class_ritual")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "teacher_response_viewed",
          source: "viewer",
          metadata: expect.objectContaining({ questionId: "take-ruby-9", faculty: "ruby" }),
        }),
        expect.objectContaining({
          name: "room_reaction_viewed",
          source: "viewer",
          metadata: expect.objectContaining({ questionId: "take-ruby-9", faculty: "ruby" }),
        }),
      ]),
    );
    expect(ruby.analyticsSnapshot().events.classRitual).toMatchObject({
      teacherResponseViewed: 1,
      roomReactionViewed: 1,
    });
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
    expect(prompt).toContain("ruby-high-admin-metrics.v6");
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

  it("renders SVG cards and falls back to SVG when no raster is configured", async () => {
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

  it("serves inline yearbook image bytes without redirecting through a data URL", async () => {
    const sessionId = await createSession();
    attachYearbookEntry(sessionId);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    ruby.setYearbookImage(sessionId, "9", `data:image/png;base64,${png.toString("base64")}`);
    const share = ruby.yearbookSharesForSession(sessionId)[0]!;

    const response = await appRoute({
      path: `/api/apps/ruby-high/yearbook/${share.shareId}/9?format=png`,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-length"]).toBe(String(png.length));
    expect(response.headers.location).toBeUndefined();
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).equals(png)).toBe(true);
  });

  it("redirects public yearbook images only to bounded asset URLs", async () => {
    const sessionId = await createSession();
    attachYearbookEntry(sessionId);
    ruby.setYearbookImage(sessionId, "9", "https://cdn.example/ruby-high/yearbook-card.png");
    const share = ruby.yearbookSharesForSession(sessionId)[0]!;

    const response = await appRoute({
      path: `/api/apps/ruby-high/yearbook/${share.shareId}/9?format=png`,
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://cdn.example/ruby-high/yearbook-card.png");
    expect(() => ruby.setYearbookImage(
      sessionId,
      "9",
      `data:image/png;base64,${"A".repeat(280_001)}`,
    )).toThrow(/yearbookImageUrl too large/);
  });

  it("rejects malformed share ids without throwing", async () => {
    const response = await appRoute({
      path: "/api/apps/ruby-high/yearbook/%E0%A4%A/9?format=json",
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Yearbook card not found.");
  });
});
