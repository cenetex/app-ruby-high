import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePackLibraryRoutes, type PackLibraryRouteContext } from "../pack-library-routes.js";
import { ORIGINAL_PACK_ID, getActivePack, getPackByIdForSession, registerPack, resetActivePack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { DEFAULT_COURSE_MODEL, DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import type { BankedQuestion } from "../types.js";
// Mock DNS resolution so material-URL host checks work without network access.
// Every hostname resolves to a safe public IP, allowing tests to proceed past
// DNS checks and exercise the real fetch/redirect/size-validation logic.
const { lookup: _dnsLookup } = vi.hoisted(() => {
  const safeIp = "185.199.108.133";
  return {
    lookup: vi.fn((hostname: string, options?: any): any => {
      // IP addresses pass through without DNS lookup.
      if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
        const family = hostname.includes(":") ? 6 : 4;
        if (options?.all) return Promise.resolve([{ address: hostname, family }]);
        return Promise.resolve({ address: hostname, family });
      }
      // Hostnames resolve to a safe public IP.
      if (options?.all) return Promise.resolve([{ address: safeIp, family: 4 }]);
      return Promise.resolve({ address: safeIp, family: 4 });
    }),
  };
});

vi.mock("node:dns/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns/promises")>();
  return { ...real, lookup: _dnsLookup as any };
});

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
type CapturedResponse = { status: number; body: any; headers: Record<string, string> };
let lastResponse: CapturedResponse | null = null;

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  apiKeyHeader?: string | null;
  clientIp?: string | null;
  contentTypeHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
  callbackOrigin?: string | null;
  body?: Record<string, unknown>;
}): PackLibraryRouteContext {
  lastResponse = null;
  const headers: Record<string, string> = {};
  const url = new URL(opts.path, "https://ruby.example.test");
  return {
    method: opts.method,
    pathname: url.pathname,
    url,
    res: {
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
      writeHead: (status: number, nextHeaders: Record<string, string>) => {
        for (const [name, value] of Object.entries(nextHeaders)) headers[name.toLowerCase()] = value;
        lastResponse = { status, body: null, headers: { ...headers } };
      },
      end: (body: string) => {
        if (lastResponse) {
          lastResponse = { ...lastResponse, body, headers: { ...headers } };
          return;
        }
        lastResponse = { status: 200, body, headers: { ...headers } };
      },
    } as never,
    cookieHeader: opts.cookie ?? null,
    apiKeyHeader: opts.apiKeyHeader ?? null,
    clientIp: opts.clientIp ?? "203.0.113.10",
    contentTypeHeader: opts.contentTypeHeader === undefined ? "application/json" : opts.contentTypeHeader,
    originHeader: opts.originHeader ?? null,
    callbackUrlBuilder: (path) => `${opts.callbackOrigin ?? "https://ruby.example.test"}${path}`,
    error: (_res, message, status = 500) => { lastResponse = { status, body: { error: message }, headers: { ...headers } }; },
    json: (_res, data, status = 200) => { lastResponse = { status, body: data, headers: { ...headers } }; },
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
  expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
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
      defaultModel: DEFAULT_OPENROUTER_MODEL,
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

function fakeQuestionPack(id: string): ContentPack {
  const pack = fakePack(id);
  const faculty = pack.faculty[0]!;
  faculty.questions = [{
    id: `${id}-q1`,
    faculty: faculty.id,
    prompt: "What makes this published pack editable?",
    subject: "creator-tools",
    difficulty: "easy",
    options: {
      A: "An owner edit draft",
      B: "A read-only system pack",
      C: "A hidden lounge room",
      D: "A stale install record",
    },
    correct: "A",
    explanation: "Published creator packs can be opened through an owner edit draft.",
  }];
  return pack;
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
        }),
      },
    }],
  };
  const questionSpec = {
    choices: [{
      message: {
        content: JSON.stringify({
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
  const responses = [courseSpec, questionSpec, teacherPortrait];
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

function stubQuestionGeneratorFetch() {
  const questionSpec = {
    choices: [{
      message: {
        content: JSON.stringify({
          questions: [
            {
              prompt: "What does sampling bias change?",
              subject: "sampling",
              difficulty: "easy",
              options: {
                A: "What the signal can prove",
                B: "The school mascot",
                C: "The color of the classroom",
                D: "The number of lockers",
              },
              correct: "A",
              explanation: "Sampling bias changes what a signal can prove.",
            },
            {
              prompt: "Why use a control group?",
              subject: "controls",
              difficulty: "medium",
              options: {
                A: "To avoid all evidence",
                B: "To compare explanations",
                C: "To skip replication",
                D: "To rename the teacher",
              },
              correct: "B",
              explanation: "A control group keeps noisy explanations from winning too early.",
            },
          ],
        }),
      },
    }],
  };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(questionSpec), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function route(opts: Parameters<typeof makeCtx>[0]): Promise<CapturedResponse> {
  const handled = await handlePackLibraryRoutes(makeCtx(opts), makeDeps());
  expect(handled).toBe(true);
  expect(lastResponse).not.toBeNull();
  return lastResponse!;
}

async function waitForCourseGeneration(
  draftId: string,
  started: CapturedResponse,
  cookie = "rh_session=alice",
): Promise<CapturedResponse> {
  expect(started.status).toBe(202);
  expect(started.body.status).toBe("running");
  expect(started.body.jobId).toEqual(expect.any(String));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate/${started.body.jobId}`,
      cookie,
    });
    if (response.body.status === "complete" || response.body.status === "error") return response;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("course generation job did not finish");
}

function fetchRequestJson(fetchMock: { mock: { calls: unknown[][] } }, index = 0): any {
  const call = fetchMock.mock.calls[index] ?? [];
  const init = call[1] as { body?: unknown } | undefined;
  return JSON.parse(String(init?.body ?? "{}"));
}

async function createDraftTeacher(cookie = "rh_session=alice"): Promise<{ draftId: string; teacherId: string }> {
  let response = await route({
    method: "POST",
    path: "/api/apps/ruby-high/pack-drafts",
    cookie,
    body: { name: "Materials Guard" },
  });
  const draftId = response.body.draft.id as string;

  response = await route({
    method: "POST",
    path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
    cookie,
    body: {
      displayName: "Materials Guard",
      description: "Imports trusted lesson materials.",
    },
  });
  const teacherId = response.body.teacher.id as string;
  return { draftId, teacherId };
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
  vi.unstubAllEnvs();
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

  it("rejects malformed creator route ids without throwing", async () => {
    signInUser("alice");

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-library/%E0%A4%A/install",
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Pack id is malformed.");

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-drafts/%E0%A4%A",
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Draft id is malformed.");

    const { draftId, teacherId } = await createDraftTeacher();
    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/%E0%A4%A`,
      cookie: "rh_session=alice",
      body: { displayName: "Still Safe" },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Teacher id is malformed.");

    response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate/%E0%A4%A`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Job id is malformed.");

    response = await route({
      method: "DELETE",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/%E0%A4%A`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Question id is malformed.");

    const drafts = (await ruby.listDraftPackRecords()).filter((draft) => draft.ownerUserId === "test-alice");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.teachers).toHaveLength(1);
    expect(drafts[0]!.teachers[0]!.displayName).toBe("Materials Guard");
  });

  it("rejects cross-origin creator pack mutations before changing installations", async () => {
    signInUser("alice");
    signInUser("bob");
    const pack = fakeQuestionPack("pack:install-origin-guard");
    pack.name = "Install Origin Guard";
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/install`,
      cookie: "rh_session=bob",
      originHeader: "https://evil.example",
      body: { enabled: true },
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Content pack request origin is not allowed.");

    const bobSessionId = auth.stateKeyForCookie("rh_session=bob");
    expect((await ruby.listPackInstallationRecords()).some((entry) =>
      entry.userId === "test-bob" && entry.packId === pack.id
    )).toBe(false);
    expect(ruby.getOrCreate(bobSessionId).guestPackOverrideId).not.toBe(pack.id);
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
      installed: true,
      enabled: false,
      active: true,
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
      active: true,
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
    expect(ruby.getOrCreate(bobSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "override",
      guestPackOverrideId: pack.id,
    });
    expect(response.body.packs.find((entry: { id: string }) => entry.id === pack.id)).toMatchObject({
      installed: true,
      enabled: true,
      active: true,
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/uninstall`,
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(bobSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "auto",
      guestPackOverrideId: null,
    });
    expect((await ruby.listPackInstallationRecords()).some((entry) =>
      entry.userId === "test-bob" && entry.packId === pack.id
    )).toBe(false);
    expect(response.body.packs.some((entry: { id: string }) => entry.id === pack.id)).toBe(false);

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=coach",
      cookie: "rh_session=bob",
    });
    expect(response.body.packs[0]).toMatchObject({
      id: pack.id,
      installed: true,
      enabled: false,
      active: true,
    });
  });

  it("serves and reviews encoded creator pack share ids", async () => {
    signInUser("alice");
    signInUser("bob");
    const pack = fakeQuestionPack("pack:shared-review-signals");
    pack.name = "Reviewable Signals";
    pack.description = "Creator lessons that can be shared and reviewed.";
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });

    let response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}?format=json`,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      pack: {
        id: pack.id,
        name: "Reviewable Signals",
      },
      reviewCount: 0,
    });
    expect(response.headers["cache-control"]).toBe("no-store");

    response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain(`href="/api/apps/ruby-high/viewer?pack=${encodeURIComponent(pack.id)}"`);
    expect(response.body).toContain("Play this class");

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}/review`,
      cookie: "rh_session=bob",
      body: { rating: 5, comment: "Clean signals, good controls." },
    });
    expect(response.status).toBe(200);
    expect(response.body.review).toMatchObject({
      packId: pack.id,
      userId: "test-bob",
      rating: 5,
      comment: "Clean signals, good controls.",
    });

    response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}?format=json`,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      averageRating: 5,
      reviewCount: 1,
      reviews: [expect.objectContaining({ rating: 5 })],
    });
  });

  it("rate limits repeated public pack reviews per signed-in caller", async () => {
    signInUser("alice");
    signInUser("bob");
    const pack = fakeQuestionPack("pack:review-rate-limited");
    pack.name = "Review Limit Signals";
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });
    const path = `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}/review`;

    for (let i = 0; i < 8; i += 1) {
      const response = await route({
        method: "POST",
        path,
        cookie: "rh_session=bob",
        clientIp: "203.0.113.88",
        body: { rating: 5, comment: `Review ${i}` },
      });
      expect(response.status).toBe(200);
      expect(response.body.review.comment).toBe(`Review ${i}`);
    }

    const limited = await route({
      method: "POST",
      path,
      cookie: "rh_session=bob",
      clientIp: "203.0.113.88",
      body: { rating: 1, comment: "This one should not persist." },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.body.error).toBe("Too many requests - slow down a moment.");

    const response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}?format=json`,
    });
    expect(response.body).toMatchObject({
      averageRating: 5,
      reviews: [expect.objectContaining({ comment: "Review 7" })],
    });
  });

  it("rejects cross-origin and non-json public pack review posts without mutating reviews", async () => {
    signInUser("alice");
    signInUser("bob");
    const pack = fakeQuestionPack("pack:review-origin-guard");
    pack.name = "Review Origin Guard";
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });
    const reviewPath = `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}/review`;

    let response = await route({
      method: "POST",
      path: reviewPath,
      cookie: "rh_session=bob",
      originHeader: "https://evil.example",
      body: { rating: 5, comment: "Cross-site review" },
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Content pack request origin is not allowed.");

    response = await route({
      method: "POST",
      path: reviewPath,
      cookie: "rh_session=bob",
      contentTypeHeader: "text/plain",
      body: { rating: 5, comment: "Plain text review" },
    });
    expect(response.status).toBe(415);
    expect(response.body.error).toBe("Content pack requests must be sent as JSON.");

    response = await route({
      method: "GET",
      path: `/api/apps/ruby-high/pack/${encodeURIComponent(pack.id)}?format=json`,
    });
    expect(response.body).toMatchObject({
      averageRating: null,
      reviewCount: 0,
      reviews: [],
    });

    response = await route({
      method: "POST",
      path: reviewPath,
      cookie: "rh_session=bob",
      originHeader: "https://ruby.example.test",
      body: { rating: 5, comment: "Same-origin review" },
    });
    expect(response.status).toBe(200);
    expect(response.body.review.comment).toBe("Same-origin review");
  });

  it("searches across course content and falls back to available creator packs", async () => {
    signInUser("alice");
    signInUser("bob");
    const chemistryPack = fakePack("pack:chem-lab");
    chemistryPack.name = "Formula Lab";
    chemistryPack.description = "Creator course for careful lab work.";
    chemistryPack.faculty[0]!.displayName = "Dr. Beaker";
    chemistryPack.faculty[0]!.subjects = ["science"];
    chemistryPack.faculty[0]!.questions = [{
      id: "chem-lab-q1",
      faculty: chemistryPack.faculty[0]!.id,
      prompt: "How does titration reveal concentration?",
      subject: "chemistry",
      difficulty: "medium",
      options: {
        A: "By comparing a known reagent volume against the sample",
        B: "By deleting all controls",
        C: "By renaming the teacher",
        D: "By changing the classroom",
      },
      correct: "A",
      explanation: "Molarity follows from the measured reaction ratio.",
    }];
    chemistryPack.faculty[0]!.sourceCards = [{
      id: "chem-lab-card-1",
      kind: "basic",
      front: "Endpoint color change",
      back: "The indicator marks when the analyte is consumed.",
      acceptedAnswers: ["endpoint", "indicator endpoint"],
      deckName: "Wet Lab Cards",
      tags: ["stoichiometry", "molarity"],
      subject: "chemistry",
      difficulty: "medium",
      faculty: chemistryPack.faculty[0]!.id,
    }];
    const civicsPack = fakePack("pack:civic-room");
    civicsPack.name = "Civic Room";
    civicsPack.description = "Creator course on committees and public records.";

    await ruby.persistPublicTeacherPack(chemistryPack, { creatorUserId: "test-alice" });
    await ruby.persistPublicTeacherPack(civicsPack, { creatorUserId: "test-alice" });

    let response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=molarity%3F",
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs[0]).toMatchObject({ id: chemistryPack.id });
    expect(response.body.packs.map((pack: { id: string }) => pack.id)).toContain(civicsPack.id);

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=zzzzquark",
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs.map((pack: { id: string }) => pack.id).sort()).toEqual([
      chemistryPack.id,
      civicsPack.id,
    ].sort());

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library/search?q=",
      cookie: "rh_session=bob",
    });
    expect(response.status).toBe(200);
    expect(response.body.packs.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps account-level hosted AI state when setting a guest pack override", async () => {
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-hosted");
    const aliceSessionId = signInUser("alice");
    ruby.claimWelcomeHallPasses(aliceSessionId);
    ruby.activateHostedAiAccess(aliceSessionId, {
      hallPassCost: 1,
      durationMs: 604_800_000,
      now: Date.now(),
    });
    const expiresAt = ruby.hostedAiAccessExpiresAt(aliceSessionId);
    const pack = fakePack("pack:ai-pass-switch");
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/active`,
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(aliceSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "override",
      guestPackOverrideId: pack.id,
    });
    expect(ruby.hostedAiAccessExpiresAt(aliceSessionId)).toBe(expiresAt);
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(4);
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
    expect(response.body).toMatchObject({
      ok: true,
      deleted: { kind: "draft", id: draftId },
      draftId,
    });
    expect(response.body).not.toHaveProperty("drafts");
    expect((await ruby.listDraftPackRecords()).some((draft) => draft.id === draftId)).toBe(false);
  });

  it("hides abandoned empty default drafts when listing the pack library", async () => {
    signInUser("alice");

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Untitled Content Pack" },
    });
    const draftId = response.body.draft.id as string;
    const draft = (await ruby.listDraftPackRecords()).find((entry) => entry.id === draftId)!;
    const old = Date.now() - 60 * 60 * 1000;
    await ruby.saveDraftPackRecord({ ...draft, createdAt: old, updatedAt: old });

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });

    expect(response.status).toBe(200);
    expect(response.body.drafts.some((entry: { id: string }) => entry.id === draftId)).toBe(false);
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
    response = await waitForCourseGeneration(draftId, response);

    expect(response.status).toBe(200);
    expect(response.body.hallPassCost).toBe(0);
    expect(response.body.hallPasses).toBe(0);
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
      stat: "head",
    });
    expect(response.body.teacher.questions.map((q: { difficulty: string }) => q.difficulty)).toEqual([
      "easy",
      "medium",
      "hard",
      "easy",
    ]);
    expect(response.body.teacher.questions.map((q: { stat: string }) => q.stat)).toEqual([
      "head",
      "heart",
      "hustle",
      "honor",
    ]);
    const metadataPrompt = fetchRequestJson(fetchMock).messages[1].content as string;
    expect(metadataPrompt).toContain("Do not generate questions in this response.");
    const metadataRequest = fetchRequestJson(fetchMock);
    expect(metadataRequest.model).toBe(DEFAULT_COURSE_MODEL);
    const questionRequest = fetchRequestJson(fetchMock, 1);
    expect(questionRequest.model).toBe(DEFAULT_COURSE_MODEL);
    const questionPrompt = questionRequest.messages[1].content as string;
    expect(questionPrompt).toContain("Write exactly 6 multiple-choice study questions");
    expect(questionPrompt).toContain("Balance requirements");
    expect(questionPrompt).toContain("difficulty=easy, stat=head");
    expect(questionPrompt).toContain("difficulty=medium, stat=heart");
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("repairs generated course JSON with raw quoted source titles in question text", async () => {
    signInUser("alice");
    const courseSpec = {
      choices: [{
        message: {
          content: JSON.stringify({
            courseTitle: "Deep RL Seminar",
            courseDescription: "A generated course on experimental rigor.",
            teacher: {
              displayName: "Dr. Henderson",
              subject: "Deep Reinforcement Learning",
              description: "Turns reproducibility concerns into careful class questions.",
              quote: "Deep reinforcement learning needs experiments that matter.",
            },
          }),
        },
      }],
    };
    const questionSpec = {
      choices: [{
        message: {
          content: `{
            "questions":[{
              "prompt":"What does "Deep Reinforcement Learning That Matters" ask researchers to improve?",
              "subject":"reproducibility",
              "difficulty":"easy",
              "options":{
                "A":"Experimental rigor and reporting",
                "B":"The classroom seating chart",
                "C":"The number of hidden variables",
                "D":"The title page typography"
              },
              "correct":"A",
              "explanation":"The paper "Deep Reinforcement Learning That Matters" focuses on making empirical results more reliable."
            }]
          }`,
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
    const responses = [courseSpec, questionSpec, teacherPortrait];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? teacherPortrait), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Deep RL" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      body: {
        requestId: "course-generate-quoted-title",
        materials: "Henderson et al., \"Deep Reinforcement Learning That Matters,\" AAAI 2018.",
      },
    });
    response = await waitForCourseGeneration(draftId, response);

    expect(response.status).toBe(200);
    expect(response.body.teacher.questions).toHaveLength(1);
    expect(response.body.teacher.questions[0]).toMatchObject({
      prompt: "What does \"Deep Reinforcement Learning That Matters\" ask researchers to improve?",
      answer: "The paper \"Deep Reinforcement Learning That Matters\" focuses on making empirical results more reliable.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to deterministic course metadata when the metadata JSON is malformed", async () => {
    signInUser("alice");
    const courseSpec = {
      choices: [{
        message: {
          content: `{"courseTitle":"Broken metadata`,
        },
      }],
    };
    const questionSpec = {
      choices: [{
        message: {
          content: JSON.stringify({
            questions: [
              {
                prompt: "What should ARC-style tasks test?",
                subject: "abstract reasoning",
                difficulty: "easy",
                options: {
                  A: "Generalizable reasoning",
                  B: "Locker location",
                  C: "Hall Pass balances",
                  D: "Wallpaper color",
                },
                correct: "A",
                explanation: "The materials concern abstract reasoning benchmarks.",
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
    const responses = [courseSpec, questionSpec, teacherPortrait];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? teacherPortrait), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "ARC Abstract Reasoning" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
      body: {
        requestId: "course-generate-metadata-fallback",
        materials: "# ARC Prize 2024\n\nTechnical report on abstract reasoning benchmarks.",
      },
    });
    response = await waitForCourseGeneration(draftId, response);

    expect(response.status).toBe(200);
    expect(response.body.draft.name).toBe("ARC Abstract Reasoning");
    expect(response.body.teacher).toMatchObject({
      displayName: "Professor Abstract",
      subject: "arc abstract reasoning",
      profileImageUrl: "data:image/png;base64,VEVBQ0hFUg==",
    });
    expect(response.body.teacher.questions).toHaveLength(1);
    expect(response.body.teacher.questions[0]).toMatchObject({
      prompt: "What should ARC-style tasks test?",
      answer: "The materials concern abstract reasoning benchmarks.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not spend the server OpenRouter key on local-provider course portraits", async () => {
    signInUser("alice");
    vi.stubEnv("RUBY_HIGH_LLM_PROVIDER", "local");
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-server-openrouter");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const created = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Local Course" },
    });
    const draftId = created.body.draft.id as string;

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/course/generate`,
      cookie: "rh_session=alice",
      body: {
        requestId: "course-generate-local-image-guard",
        materials: "Local course materials need a generated portrait before publishing.",
      },
    });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("hosted image generation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private-network material URLs before fetching", async () => {
    signInUser("alice");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "SSRF Guard" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Network Guard",
        description: "Rejects private lesson URLs.",
      },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://127.0.0.1/private.md" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("private or reserved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports GitHub blob material URLs through raw GitHub", async () => {
    signInUser("alice");
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response("# Week 1\n\nControl the variables.", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { draftId, teacherId } = await createDraftTeacher();

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://github.com/acme/course/blob/main/materials/week-1.md" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://raw.githubusercontent.com/acme/course/main/materials/week-1.md");
    expect(response.body.teacher.materialSourceUrl).toBe("https://raw.githubusercontent.com/acme/course/main/materials/week-1.md");
    expect(response.body.teacher.materials).toContain("Control the variables.");
  });

  it("rejects non-allowlisted material URL hosts before fetching", async () => {
    signInUser("alice");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { draftId, teacherId } = await createDraftTeacher();

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://example.com/materials.md" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("host is not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized material URL responses", async () => {
    signInUser("alice");
    const fetchMock = vi.fn(async () => new Response("x".repeat(80_001), {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { draftId, teacherId } = await createDraftTeacher();

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://raw.githubusercontent.com/acme/course/main/too-big.md" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("80000 characters or less");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows allowed material URL redirects and stores the final normalized source", async () => {
    signInUser("alice");
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      if (String(input) === "https://raw.githubusercontent.com/acme/course/main/old.md") {
        return new Response("", {
          status: 302,
          headers: { location: "https://github.com/acme/course/blob/main/new.md" },
        });
      }
      return new Response("# Week 2\n\nReplicate the signal.", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { draftId, teacherId } = await createDraftTeacher();

    const response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://raw.githubusercontent.com/acme/course/main/old.md" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://raw.githubusercontent.com/acme/course/main/old.md",
      "https://raw.githubusercontent.com/acme/course/main/new.md",
    ]);
    expect(response.body.teacher.materialSourceUrl).toBe("https://raw.githubusercontent.com/acme/course/main/new.md");
    expect(response.body.teacher.materials).toContain("Replicate the signal.");
  });

  it("rejects material URL redirects to private-network hosts", async () => {
    signInUser("alice");
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response("", {
      status: 302,
      headers: { location: "https://127.0.0.1/private.md" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Redirect Guard" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Redirect Guard",
        description: "Rejects redirected lesson URLs.",
      },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/materials/from-url`,
      cookie: "rh_session=alice",
      clientIp: "203.0.113.22",
      body: { url: "https://raw.githubusercontent.com/acme/course/main/materials.md" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("private or reserved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
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

    const questionFetch = stubQuestionGeneratorFetch();
    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
    });
    expect(response.status).toBe(200);
    expect(questionFetch).toHaveBeenCalledTimes(1);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(402);
    expect(response.body.error).toContain("Not enough Hall Passes");
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);
  });

  it("charges a fresh course slot spend after a refunded reservation failure", async () => {
    const aliceSessionId = signInUser("alice");
    ruby.claimWelcomeHallPasses(aliceSessionId);

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Retry Course Slot" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Retry Coach",
        description: "Turns retry notes into cards.",
      },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
      body: { materials: "A course needs enough evidence to publish after a failed reservation." },
    });
    expect(response.status).toBe(200);

    stubQuestionGeneratorFetch();
    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
    });
    expect(response.status).toBe(200);

    const saveDraftPackRecord = ruby.saveDraftPackRecord.bind(ruby);
    let failOnce = true;
    vi.spyOn(ruby, "saveDraftPackRecord").mockImplementation(async (record) => {
      if (failOnce && record.courseSlot?.status === "reserved") {
        failOnce = false;
        throw new Error("storage down");
      }
      return saveDraftPackRecord(record);
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(500);
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(5);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.hallPassCost).toBe(3);
    expect(response.body.hallPasses).toBe(2);
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(2);

    const transactions = ruby.getOrCreate(aliceSessionId).wallet.transactions ?? [];
    const courseSlotSpends = transactions.filter((tx) => tx.kind === "hall-pass-spend" && tx.source === "course-slot");
    expect(courseSlotSpends).toHaveLength(2);
    expect(courseSlotSpends.some((tx) => tx.metadata?.status === "failed")).toBe(true);
    expect(courseSlotSpends.some((tx) => tx.metadata?.status === "completed")).toBe(true);
    expect(transactions.some((tx) => tx.kind === "hall-pass-refund" && tx.source === "course-slot")).toBe(true);
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
    expect(response.body).toMatchObject({
      ok: true,
      deleted: { kind: "published", id: pack.id },
      packId: pack.id,
    });
    expect(response.body).not.toHaveProperty("packs");
    expect((await ruby.listPersistedPackRecords()).some((entry) => entry.pack.id === pack.id)).toBe(false);
    expect(getPackByIdForSession(pack.id, aliceSessionId)).toBeNull();
  });

  it("persists draft packs, generates cards manually, publishes, and keeps enable separate from active", async () => {
    const aliceSessionId = signInUser("alice");
    ruby.claimWelcomeHallPasses(aliceSessionId);

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

    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "");
    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Connect AI");

    const questionFetch = stubQuestionGeneratorFetch();
    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      apiKeyHeader: "sk-test",
    });
    expect(response.status).toBe(200);
    expect(response.body.hallPassCost).toBe(0);
    expect(response.body.hallPasses).toBe(5);
    expect(response.body.teacher.generationCount).toBe(1);
    expect(response.body.teacher.questions.length).toBeGreaterThan(1);
    expect(questionFetch).toHaveBeenCalledTimes(1);
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
      active: true,
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
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}`,
      cookie: "rh_session=alice",
      body: { name: "Updated Signals Pack" },
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.pack).toMatchObject({
      id: packId,
      name: "Updated Signals Pack",
      draftId,
      canEdit: true,
      canDelete: true,
    });
    expect(response.body.hallPassCost).toBe(0);
    expect(response.body.hallPasses).toBe(2);
    expect((await ruby.listPersistedPackRecords()).find((entry) => entry.pack.id === packId)?.pack.name).toBe("Updated Signals Pack");

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(packId)}/active`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(ruby.getOrCreate(aliceSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "override",
      guestPackOverrideId: packId,
    });
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
    expect(ruby.getOrCreate(aliceSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "auto",
      guestPackOverrideId: null,
    });
    expect(response.body.packs.find((pack: { id: string }) => pack.id === packId)).toMatchObject({
      enabled: false,
      active: true,
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
    expect(response.body).toMatchObject({
      ok: true,
      deleted: { kind: "published", id: packId },
      packId,
      removedDraftIds: [draftId],
    });
    expect(response.body).not.toHaveProperty("packs");
    expect((await ruby.listPersistedPackRecords()).some((entry) => entry.pack.id === packId)).toBe(false);
    expect((await ruby.listDraftPackRecords()).some((draft) => draft.id === draftId)).toBe(false);
    expect((await ruby.listPackInstallationRecords()).some((entry) => entry.packId === packId)).toBe(false);
    expect(getPackByIdForSession(packId, aliceSessionId)).toBeNull();
    expect(ruby.getOrCreate(aliceSessionId)).toMatchObject({
      activePackId: null,
      guestPackMode: "auto",
      guestPackOverrideId: null,
    });
  });

  it("spends one Hall Pass for hosted generate-more-questions without browser OpenRouter", async () => {
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-hosted");
    const aliceSessionId = signInUser("alice");
    ruby.claimWelcomeHallPasses(aliceSessionId);
    const questionFetch = stubQuestionGeneratorFetch();

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Hosted Questions" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Hosted Coach",
        description: "Generates hosted study cards.",
      },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
      body: {
        materials: [
          "# Sampling",
          "Sampling bias changes what a signal can prove.",
          "# Controls",
          "A control group keeps noisy explanations from winning too early.",
        ].join("\n"),
      },
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      body: { requestId: "hosted-more-questions-1", questionCount: 6 },
    });

    expect(response.status).toBe(200);
    expect(response.body.hallPassCost).toBe(1);
    expect(response.body.hallPasses).toBe(4);
    expect(response.body.entitlements.hallPasses).toBe(4);
    expect(response.body.teacher.generationCount).toBe(1);
    expect(response.body.teacher.questions).toHaveLength(2);
    expect(response.body.teacher.questions.map((q: { difficulty: string }) => q.difficulty)).toEqual(["easy", "medium"]);
    expect(response.body.teacher.questions.map((q: { stat: string }) => q.stat)).toEqual(["head", "heart"]);
    const questionRequest = fetchRequestJson(questionFetch);
    expect(questionRequest.model).toBe(DEFAULT_COURSE_MODEL);
    const questionPrompt = questionRequest.messages[1].content as string;
    expect(questionPrompt).toContain("Current teacher balance: no existing cards.");
    expect(questionPrompt).toContain("difficulty=easy, stat=head");
    expect(questionPrompt).toContain("difficulty=medium, stat=heart");
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(4);
    expect(questionFetch).toHaveBeenCalledTimes(1);
    expect(ruby.walletTransaction(aliceSessionId, `question-generation:${aliceSessionId}:${draftId}:${teacherId}:hosted-more-questions-1`)).toMatchObject({
      hallPasses: -1,
      source: "question-generation",
    });
    ruby.revokeHallPasses(aliceSessionId, {
      amount: 4,
      idempotencyKey: "test:drain-after-hosted-more-questions",
      source: "admin",
    });
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      body: { requestId: "hosted-more-questions-1", questionCount: 6 },
    });

    expect(response.status).toBe(200);
    expect(response.body.replay).toBe(true);
    expect(response.body.hallPasses).toBe(0);
    expect(response.body.teacher.questions).toHaveLength(2);
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);
    expect(questionFetch).toHaveBeenCalledTimes(1);
  });

  it("fills underrepresented difficulty and stat buckets when generating creator-pack questions", async () => {
    vi.stubEnv("RUBY_HIGH_OPENROUTER_API_KEY", "sk-hosted");
    const aliceSessionId = signInUser("alice");
    ruby.claimWelcomeHallPasses(aliceSessionId);
    const questionFetch = stubQuestionGeneratorFetch();

    let response = await route({
      method: "POST",
      path: "/api/apps/ruby-high/pack-drafts",
      cookie: "rh_session=alice",
      body: { name: "Unbalanced Questions" },
    });
    const draftId = response.body.draft.id as string;

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers`,
      cookie: "rh_session=alice",
      body: {
        displayName: "Balance Coach",
        description: "Already has too many easy head cards.",
      },
    });
    const teacherId = response.body.teacher.id as string;

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}`,
      cookie: "rh_session=alice",
      body: {
        materials: "Signals need controls, replication, and careful evidence handling.",
      },
    });
    expect(response.status).toBe(200);

    const draft = (await ruby.listDraftPackRecords()).find((entry) => entry.id === draftId)!;
    const teacher = draft.teachers.find((entry) => entry.id === teacherId)!;
    const existingQuestions: BankedQuestion[] = Array.from({ length: 8 }, (_, index) => ({
      id: `existing-easy-head-${index + 1}`,
      faculty: "draft-balance-coach",
      prompt: `Existing easy fact card ${index + 1}?`,
      subject: "signals",
      difficulty: "easy",
      stat: "head",
      options: { A: "Evidence", B: "Wallpaper", C: "Locker", D: "Bell" },
      correct: "A",
      explanation: "This existing card is intentionally easy/head-heavy.",
    }));
    await ruby.saveDraftPackRecord({
      ...draft,
      teachers: draft.teachers.map((entry) =>
        entry.id === teacherId ? { ...teacher, questions: existingQuestions } : entry
      ),
    });

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/teachers/${teacherId}/questions/generate`,
      cookie: "rh_session=alice",
      body: { requestId: "rebalance-more-questions-1", questionCount: 2 },
    });

    expect(response.status).toBe(200);
    const appended = response.body.teacher.questions.slice(-2);
    expect(appended.map((q: { difficulty: string }) => q.difficulty)).toEqual(["medium", "hard"]);
    expect(appended.map((q: { stat: string }) => q.stat)).toEqual(["heart", "hustle"]);
    const questionRequest = fetchRequestJson(questionFetch);
    expect(questionRequest.model).toBe(DEFAULT_COURSE_MODEL);
    const questionPrompt = questionRequest.messages[1].content as string;
    expect(questionPrompt).toContain("Current teacher balance: 8 existing cards.");
    expect(questionPrompt).toContain("Difficulty counts: easy=8, medium=0, hard=0.");
    expect(questionPrompt).toContain("Stat counts: head=8, heart=0, hustle=0, honor=0.");
    expect(questionPrompt).toContain("difficulty=medium, stat=heart");
    expect(questionPrompt).toContain("difficulty=hard, stat=hustle");
  });

  it("creates an edit draft for owned published packs that no longer have a backing draft", async () => {
    const aliceSessionId = signInUser("alice");
    const pack = fakeQuestionPack("pack:legacy-published-edit");
    await ruby.persistPublicTeacherPack(pack, { creatorUserId: "test-alice" });

    let response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });
    const listed = response.body.packs.find((entry: { id: string }) => entry.id === pack.id);
    expect(listed).toMatchObject({
      id: pack.id,
      owner: true,
      installed: true,
      canEdit: true,
      canDelete: true,
      canUninstall: true,
    });
    expect(listed.draftId).toBeUndefined();

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-library/${encodeURIComponent(pack.id)}/edit-draft`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    const draftId = response.body.draft.id as string;
    expect(response.body.draft).toMatchObject({
      id: draftId,
      name: pack.name,
      derivedFrom: pack.id,
      canEdit: true,
      canDelete: true,
      courseSlot: {
        status: "published",
        packId: pack.id,
      },
    });
    expect(response.body.draft.teachers[0]).toMatchObject({
      displayName: pack.faculty[0]!.displayName,
      questionCount: 1,
    });

    response = await route({
      method: "GET",
      path: "/api/apps/ruby-high/pack-library",
      cookie: "rh_session=alice",
    });
    expect(response.body.packs.find((entry: { id: string }) => entry.id === pack.id)).toMatchObject({
      draftId,
      canEdit: true,
    });
    expect(response.body.drafts.some((draft: { id: string }) => draft.id === draftId)).toBe(false);

    response = await route({
      method: "PATCH",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}`,
      cookie: "rh_session=alice",
      body: { name: "Legacy Published Updated" },
    });
    expect(response.status).toBe(200);

    response = await route({
      method: "POST",
      path: `/api/apps/ruby-high/pack-drafts/${draftId}/publish`,
      cookie: "rh_session=alice",
    });
    expect(response.status).toBe(200);
    expect(response.body.pack).toMatchObject({
      id: pack.id,
      name: "Legacy Published Updated",
      canEdit: true,
      canDelete: true,
    });
    expect(response.body.hallPassCost).toBe(0);
    expect(ruby.hallPassBalance(aliceSessionId)).toBe(0);
    expect((await ruby.listPersistedPackRecords()).find((entry) => entry.pack.id === pack.id)?.pack.name).toBe("Legacy Published Updated");
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
