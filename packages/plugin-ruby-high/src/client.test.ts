import { describe, expect, it, vi } from "vitest";
import { RubyHighClient } from "./client.js";

describe("RubyHighClient", () => {
  it("keeps credentials off device endpoints and sends them to scoped endpoints", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/device/code")) {
        return jsonResponse({
          deviceCode: "device-secret",
          userCode: "RUBY-123",
          verificationUri: "http://localhost:8787/connect",
          verificationUriComplete: "http://localhost:8787/connect?code=RUBY-123",
          expiresIn: 600,
          interval: 3,
          scopes: ["school:read", "student:play"],
        });
      }
      return jsonResponse({
        ok: true,
        state: {
          version: 1,
          phase: "loop",
          status: "IDLE",
          student: null,
          faculty: "guest",
          subject: null,
          question: null,
          reveal: null,
          activeGuest: null,
          autonomy: {},
        },
      });
    });
    const client = new RubyHighClient({
      baseUrl: "http://localhost:8787/path-is-ignored",
      accessToken: "test-token",
      fetch: fetcher as typeof fetch,
    });

    await client.beginDeviceAuthorization("Test Agent");
    await client.state();

    expect(requests[0]?.url).toBe(
      "http://localhost:8787/api/apps/ruby-high/agent/v1/device/code",
    );
    expect(header(requests[0]?.init, "authorization")).toBeUndefined();
    expect(header(requests[1]?.init, "authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("maps API failures to a stable typed error", async () => {
    const client = new RubyHighClient({
      baseUrl: "https://ruby-high.example",
      accessToken: "test-token",
      fetch: vi.fn(async () =>
        jsonResponse(
          { error: "version_conflict", message: "State changed." },
          409,
        )) as typeof fetch,
    });

    await expect(client.state()).rejects.toMatchObject({
      name: "RubyHighApiError",
      status: 409,
      code: "version_conflict",
      message: "State changed.",
    });
  });

  it("requires HTTPS away from local development", () => {
    expect(
      () => new RubyHighClient({ baseUrl: "http://ruby-high.example" }),
    ).toThrow("must use HTTPS");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = new Headers(init?.headers);
  return headers.get(name) ?? undefined;
}
