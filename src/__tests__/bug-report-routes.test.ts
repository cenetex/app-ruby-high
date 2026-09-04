import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAppRoutes, type RouteContext } from "../routes.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeHarness(body: unknown, opts: {
  clientIp?: string;
  contentType?: string | null;
  callbackOrigin?: string;
  origin?: string | null;
  urlOrigin?: string;
} = {}) {
  let response: { status: number; body: any; headers: Record<string, string> } | null = null;
  const headers: Record<string, string> = {};
  const ctx: RouteContext = {
    method: "POST",
    pathname: "/api/apps/ruby-high/bug-report",
    url: new URL(`${opts.urlOrigin ?? "https://ruby-high.ai"}/api/apps/ruby-high/bug-report`),
    runtime: null,
    res: {
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
    } as never,
    cookieHeader: "rh_session=test-cookie",
    clientIp: opts.clientIp ?? "203.0.113.10",
    contentTypeHeader: opts.contentType === undefined ? "application/json" : opts.contentType,
    originHeader: opts.origin === undefined ? "https://ruby-high.ai" : opts.origin,
    callbackUrlBuilder: (path: string) => `${opts.callbackOrigin ?? "https://ruby-high.ai"}${path}`,
    error: (_res, message, status = 500) => {
      response = { status, body: { error: message }, headers };
    },
    json: (_res, data, status = 200) => {
      response = { status, body: data, headers };
    },
    readJsonBody: async () => body,
  };
  return { ctx, get response() { return response; } };
}

describe("bug report route", () => {
  it("fails closed when GitHub issue creation is not configured", async () => {
    delete process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const harness = makeHarness({ description: "board froze" }, { clientIp: "203.0.113.11" });

    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(501);
    expect(harness.response?.body.error).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a private GitHub issue with redacted report context", async () => {
    process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN = "ghp_test_token";
    process.env.RUBY_HIGH_GITHUB_ISSUES_REPO = "cenetex/app-ruby-high";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ number: 42 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const harness = makeHarness({
      description: "Teacher leaked sk-openrouter-test123456789 in chat.",
      context: {
        url: "https://ruby-high.ai/api/apps/ruby-high/viewer?code=oauth-secret",
        userAgent: "Vitest",
        timestamp: "2026-05-14T00:00:00.000Z",
        session: true,
        aiEnabled: true,
        character: "Vince (outsider)",
        grade: "10",
        faculty: "ruby",
        viewport: "1280x720",
        recentErrors: ["Authorization: Bearer sk-openrouter-abc123456789"],
      },
    }, { clientIp: "203.0.113.12" });

    const handled = await handleAppRoutes(harness.ctx);

    expect(handled).toBe(true);
    expect(harness.response?.status).toBe(200);
    expect(harness.response?.body).toEqual({ success: true, issueNumber: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, { headers: Record<string, string>; body: string }]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.github.com/repos/cenetex/app-ruby-high/issues");
    expect(init.headers.Authorization).toBe("Bearer ghp_test_token");
    const payload = JSON.parse(init.body);
    expect(payload.title).toContain("[bug] Teacher leaked");
    expect(payload.labels).toEqual(["bug", "user-report"]);
    expect(payload.body).toContain("Vince (outsider)");
    expect(payload.body).toContain("code=[redacted]");
    expect(payload.body).not.toContain("sk-openrouter-test123456789");
    expect(payload.body).not.toContain("sk-openrouter-abc123456789");
  });

  it("rejects non-JSON and cross-origin browser posts before calling GitHub", async () => {
    process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN = "ghp_test_token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const nonJson = makeHarness({ description: "x" }, {
      clientIp: "203.0.113.13",
      contentType: "text/plain",
    });
    await handleAppRoutes(nonJson.ctx);
    expect(nonJson.response?.status).toBe(415);

    const badOrigin = makeHarness({ description: "x" }, {
      clientIp: "203.0.113.14",
      origin: "https://evil.example",
    });
    await handleAppRoutes(badOrigin.ctx);
    expect(badOrigin.response?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized JSON before calling GitHub", async () => {
    process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN = "ghp_test_token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const malformed = makeHarness({ description: "x" }, { clientIp: "203.0.113.16" });
    malformed.ctx.readJsonBody = async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    };
    await handleAppRoutes(malformed.ctx);
    expect(malformed.response?.status).toBe(400);

    const oversized = makeHarness({ description: "x" }, { clientIp: "203.0.113.17" });
    oversized.ctx.readJsonBody = async () => {
      const err = new Error("Request body too large") as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    };
    await handleAppRoutes(oversized.ctx);
    expect(oversized.response?.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits malformed reports before parsing the body", async () => {
    process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN = "ghp_test_token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let parseCalls = 0;
    const statuses: Array<number | undefined> = [];

    for (let i = 0; i < 4; i += 1) {
      const harness = makeHarness({ description: "x" }, { clientIp: "203.0.113.66" });
      harness.ctx.readJsonBody = async () => {
        parseCalls += 1;
        throw new SyntaxError("Unexpected end of JSON input");
      };
      await handleAppRoutes(harness.ctx);
      statuses.push(harness.response?.status);
    }

    expect(statuses).toEqual([400, 400, 400, 429]);
    expect(parseCalls).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows custom-domain origins when the proxy callback origin differs", async () => {
    process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN = "ghp_test_token";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ number: 43 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const harness = makeHarness({ description: "custom domain" }, {
      clientIp: "203.0.113.15",
      callbackOrigin: "https://ruby-high.internal.example",
      origin: "https://ruby-high.ai",
      urlOrigin: "http://ruby-high.ai",
    });

    await handleAppRoutes(harness.ctx);

    expect(harness.response?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
