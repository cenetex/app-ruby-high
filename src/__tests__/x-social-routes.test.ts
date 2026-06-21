import { afterEach, describe, expect, it, vi } from "vitest";
import { handleXSocialRoutes } from "../routes/x-social.js";
import type { RouteContext } from "../routes/context.js";
import type { ClassPhotoCandidate } from "../services/ruby-high-service.js";

function makeCtx(opts: {
  method: string;
  path: string;
  authorizationHeader?: string;
  runtime?: unknown;
  body?: unknown;
}): { ctx: RouteContext; body: () => any } {
  let captured: any = null;
  const url = new URL(`http://ruby.test${opts.path}`);
  const ctx: RouteContext = {
    method: opts.method,
    pathname: url.pathname,
    url,
    runtime: opts.runtime ?? null,
    res: {},
    authorizationHeader: opts.authorizationHeader,
    error: (_res, message, status = 400) => {
      captured = { status, body: { error: message } };
    },
    json: (_res, data, status = 200) => {
      captured = { status, body: data };
    },
    readJsonBody: async () => opts.body ?? {},
  };
  return { ctx, body: () => captured };
}

describe("X social routes", () => {
  const previousAdminToken = process.env.RUBY_HIGH_ADMIN_TOKEN;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousAdminToken === undefined) delete process.env.RUBY_HIGH_ADMIN_TOKEN;
    else process.env.RUBY_HIGH_ADMIN_TOKEN = previousAdminToken;
  });

  it("uses fresh recently-active students for admin student lists", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const stale = vi.fn(() => []);
    const fresh = vi.fn(async () => [{
      sessionId: "fresh-session",
      name: "Fresh Noor",
      playbookId: "lifer",
      grade: "10",
      stats: { head: 4, heart: 3, hustle: 2, honor: 1 },
      classGrades: { ruby: "A" },
      yearbookCount: 0,
      lastActive: 1,
    }]);
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? {
          getRecentlyActiveStudents: stale,
          getFreshRecentlyActiveStudents: fresh,
        } : null,
      },
    };
    const { ctx, body } = makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/x/students",
      authorizationHeader: "Bearer admin-route-test",
    });

    expect(await handleXSocialRoutes(ctx, xSocial as any)).toBe(true);

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    expect(body()).toMatchObject({
      status: 200,
      body: { students: [expect.objectContaining({ name: "Fresh Noor" })] },
    });
  });

  it("uses fresh school snapshots for admin snapshot and reflection posts", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const snapshot = {
      topByYear: {},
      photoPool: [],
      classPhotoHistory: [],
      dailyMemories: {
        date: "2026-06-15",
        charactersCreated: ["Fresh Noor"],
        classesPassed: [],
        gradesAdvanced: [],
        graduations: [],
        totalStudents: 1,
        totalQuestionsAnswered: 3,
      },
    };
    const fresh = vi.fn(async () => snapshot);
    const postReflection = vi.fn(async () => "tweet:fresh");
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? {
          getSchoolSnapshot: vi.fn(() => ({ ...snapshot, dailyMemories: { ...snapshot.dailyMemories, charactersCreated: ["Stale"] } })),
          getFreshSchoolSnapshot: fresh,
        } : null,
      },
      postReflection,
    };

    let harness = makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/x/snapshot",
      authorizationHeader: "Bearer admin-route-test",
    });
    expect(await handleXSocialRoutes(harness.ctx, xSocial as any)).toBe(true);
    expect(harness.body()).toEqual({ status: 200, body: snapshot });

    harness = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/post/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });
    expect(await handleXSocialRoutes(harness.ctx, xSocial as any)).toBe(true);

    expect(fresh).toHaveBeenCalledTimes(2);
    expect(postReflection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ruby" }),
      snapshot.dailyMemories,
      { imageUrl: "/api/apps/ruby-high/assets/teachers/ruby-full.png" },
    );
    expect(harness.body()).toEqual({ status: 200, body: { ok: true, tweetId: "tweet:fresh" } });
  });

  it("uses fresh students for report-card posts", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const fresh = vi.fn(async () => [{
      sessionId: "student-session",
      name: "Fresh Mina",
      playbookId: "overachiever",
      grade: "11",
      stats: { head: 5, heart: 4, hustle: 3, honor: 2 },
      classGrades: { ruby: "A" },
      yearbookCount: 2,
      lastActive: 10,
    }]);
    const postReportCard = vi.fn(async () => "tweet:report");
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? {
          getFreshRecentlyActiveStudents: fresh,
        } : null,
      },
      postReportCard,
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/post-report/ruby",
      authorizationHeader: "Bearer admin-route-test",
      body: { sessionId: "student-session" },
    });

    expect(await handleXSocialRoutes(ctx, xSocial as any)).toBe(true);

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(postReportCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ruby" }),
      expect.objectContaining({ name: "Fresh Mina", stats: { head: 5, heart: 4, hustle: 3, honor: 2 } }),
    );
    expect(body()).toEqual({ status: 200, body: { ok: true, tweetId: "tweet:report" } });
  });

  it("uses fresh class-photo candidates when available", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const candidates: ClassPhotoCandidate[] = [
      {
        sessionId: "fresh-student",
        name: "Fresh Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/fresh-noor.png",
        grade: "10",
      },
    ];
    const stale = vi.fn(() => []);
    const fresh = vi.fn(async () => candidates);
    const enqueueClassPhotoReveal = vi.fn(() => "photo:fresh");
    const maybePostDailyPhoto = vi.fn(async () => null);
    const rubyService = {
      getClassPhotoCandidates: stale,
      getFreshClassPhotoCandidates: fresh,
      hasClassPhotoRevealTarget: vi.fn(() => true),
      enqueueClassPhotoReveal,
      maybePostDailyPhoto,
    };
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? rubyService : null,
      },
      generateClassPhoto: vi.fn(async () => "/api/apps/ruby-high/assets/class-photo/fresh.png"),
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/class-photo/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });

    expect(await handleXSocialRoutes(ctx, xSocial as any)).toBe(true);

    expect(fresh).toHaveBeenCalledWith(8);
    expect(stale).not.toHaveBeenCalled();
    expect(xSocial.generateClassPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: "ruby" }), candidates);
    expect(enqueueClassPhotoReveal).toHaveBeenCalledWith("ruby", "/api/apps/ruby-high/assets/class-photo/fresh.png", candidates);
    expect(body()).toMatchObject({
      status: 200,
      body: {
        ok: true,
        photoId: "photo:fresh",
        studentCount: 1,
      },
    });
  });

  it("filters malformed and synthetic class-photo candidates before generation", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const candidates: ClassPhotoCandidate[] = [
      {
        sessionId: "blank-name",
        name: "   ",
        imageUrl: "/api/apps/ruby-high/assets/portrait/blank.png",
        grade: "9",
      },
      {
        sessionId: "synthetic-smoke",
        name: "Smoke mqe1pkx3",
        imageUrl: "/api/apps/ruby-high/assets/portrait/smoke.png",
        grade: "9",
      },
      {
        sessionId: "real-student",
        name: "  Noor  ",
        imageUrl: "  /api/apps/ruby-high/assets/portrait/noor.png  ",
        grade: " 10 ",
      },
      {
        sessionId: "",
        name: "Missing Session",
        imageUrl: "/api/apps/ruby-high/assets/portrait/missing.png",
        grade: "10",
      },
    ];
    const publicCandidates = [{
      sessionId: "real-student",
      name: "Noor",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
      grade: "10",
    }];
    const rubyService = {
      getClassPhotoCandidates: vi.fn(() => candidates),
      hasClassPhotoRevealTarget: vi.fn(() => true),
      enqueueClassPhotoReveal: vi.fn(() => "photo:public-only"),
      maybePostDailyPhoto: vi.fn(async () => null),
    };
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? rubyService : null,
      },
      generateClassPhoto: vi.fn(async () => "/api/apps/ruby-high/assets/class-photo/public-only.png"),
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/class-photo/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });

    expect(await handleXSocialRoutes(ctx, xSocial as any)).toBe(true);

    expect(rubyService.hasClassPhotoRevealTarget).toHaveBeenCalledWith(publicCandidates);
    expect(xSocial.generateClassPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: "ruby" }), publicCandidates);
    expect(rubyService.enqueueClassPhotoReveal).toHaveBeenCalledWith(
      "ruby",
      "/api/apps/ruby-high/assets/class-photo/public-only.png",
      publicCandidates,
    );
    expect(body()).toMatchObject({
      status: 200,
      body: {
        ok: true,
        photoId: "photo:public-only",
        studentCount: 1,
      },
    });
  });

  it("awaits the targeted class-photo post and reports the tweet result", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const candidates: ClassPhotoCandidate[] = [
      {
        sessionId: "student-session",
        name: "Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
        grade: "9",
      },
    ];
    const getClassPhotoCandidates = vi.fn(() => candidates);
    const enqueueClassPhotoReveal = vi.fn(() => "photo:route-target");
    const maybePostDailyPhoto = vi.fn(async () => ({
      photoId: "photo:route-target",
      sessionId: "student-session",
      kind: "class-photo" as const,
      teacherFacultyId: "ruby",
      posted: true,
      revealed: true,
      tweetId: "tweet-route-target",
    }));
    const rubyService = {
      getClassPhotoCandidates,
      enqueueClassPhotoReveal,
      maybePostDailyPhoto,
    };
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? rubyService : null,
      },
      generateClassPhoto: vi.fn(async () => "/api/apps/ruby-high/assets/class-photo/noor.png"),
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/class-photo/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });

    const handled = await handleXSocialRoutes(ctx, xSocial as any);

    expect(handled).toBe(true);
    expect(getClassPhotoCandidates).toHaveBeenCalledWith(8);
    expect(xSocial.generateClassPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: "ruby" }), candidates);
    expect(enqueueClassPhotoReveal).toHaveBeenCalledWith("ruby", "/api/apps/ruby-high/assets/class-photo/noor.png", candidates);
    expect(maybePostDailyPhoto).toHaveBeenCalledWith({ photoId: "photo:route-target" });
    expect(body()).toEqual({
      status: 200,
      body: {
        ok: true,
        photoId: "photo:route-target",
        imageUrl: "/api/apps/ruby-high/assets/class-photo/noor.png",
        studentCount: 1,
        posted: true,
        revealed: true,
        tweetId: "tweet-route-target",
      },
    });
  });

  it("reports class-photo enqueue failure instead of fabricating a queued photo id", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const candidates: ClassPhotoCandidate[] = [
      {
        sessionId: "student-session",
        name: "Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
        grade: "9",
      },
    ];
    const enqueueClassPhotoReveal = vi.fn(() => null);
    const maybePostDailyPhoto = vi.fn();
    const rubyService = {
      getClassPhotoCandidates: vi.fn(() => candidates),
      enqueueClassPhotoReveal,
      maybePostDailyPhoto,
    };
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? rubyService : null,
      },
      generateClassPhoto: vi.fn(async () => "/api/apps/ruby-high/assets/class-photo/noor.png"),
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/class-photo/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });

    const handled = await handleXSocialRoutes(ctx, xSocial as any);

    expect(handled).toBe(true);
    expect(enqueueClassPhotoReveal).toHaveBeenCalledWith("ruby", "/api/apps/ruby-high/assets/class-photo/noor.png", candidates);
    expect(maybePostDailyPhoto).not.toHaveBeenCalled();
    expect(body()).toEqual({
      status: 409,
      body: {
        ok: false,
        error: "Class photo generated, but no eligible student queue accepted it.",
      },
    });
  });

  it("does not generate a class photo when no selected student can accept the queue item", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const candidates: ClassPhotoCandidate[] = [
      {
        sessionId: "student-session",
        name: "Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
        grade: "9",
      },
    ];
    const rubyService = {
      getClassPhotoCandidates: vi.fn(() => candidates),
      hasClassPhotoRevealTarget: vi.fn(() => false),
      enqueueClassPhotoReveal: vi.fn(),
      maybePostDailyPhoto: vi.fn(),
    };
    const xSocial = {
      runtime: {
        getService: (type: string) => type === "ruby-high" ? rubyService : null,
      },
      generateClassPhoto: vi.fn(async () => "/api/apps/ruby-high/assets/class-photo/noor.png"),
    };
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/class-photo/ruby",
      authorizationHeader: "Bearer admin-route-test",
    });

    const handled = await handleXSocialRoutes(ctx, xSocial as any);

    expect(handled).toBe(true);
    expect(rubyService.hasClassPhotoRevealTarget).toHaveBeenCalledWith(candidates);
    expect(xSocial.generateClassPhoto).not.toHaveBeenCalled();
    expect(rubyService.enqueueClassPhotoReveal).not.toHaveBeenCalled();
    expect(rubyService.maybePostDailyPhoto).not.toHaveBeenCalled();
    expect(body()).toEqual({
      status: 409,
      body: {
        ok: false,
        error: "No eligible student queue can accept a class photo.",
      },
    });
  });

  it("finds Telegram chats from a POST body instead of a query token", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({ ok: true, result: [{ message: { chat: { id: -100123 } } }] }),
    } as Response);
    const { ctx, body } = makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/x/telegram/find-chat",
      authorizationHeader: "Bearer admin-route-test",
      body: { token: "123456:secret_token" },
    });

    expect(await handleXSocialRoutes(ctx, {} as any)).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toContain("bot123456%3Asecret_token/getUpdates");
    expect(body()).toEqual({
      status: 200,
      body: { ok: true, result: [{ message: { chat: { id: -100123 } } }] },
    });
  });

  it("does not accept Telegram find-chat tokens in the URL query", async () => {
    process.env.RUBY_HIGH_ADMIN_TOKEN = "admin-route-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ctx, body } = makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/x/telegram/find-chat?token=123456:secret_token",
      authorizationHeader: "Bearer admin-route-test",
    });

    expect(await handleXSocialRoutes(ctx, {} as any)).toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body()).toBeNull();
  });
});
