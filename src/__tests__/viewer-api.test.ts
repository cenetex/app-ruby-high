import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createViewerApiClient,
  type ViewerApiClientDeps,
  type ViewerApiResponse,
  withViewerTimeoutSignal,
} from "../viewer-parts/api.js";

function jsonResponse(status: number, body: unknown): ViewerApiResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function pendingResponse() {
  let resolve!: (response: ViewerApiResponse) => void;
  const promise = new Promise<ViewerApiResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function baseDeps(overrides: Partial<ViewerApiClientDeps> = {}): ViewerApiClientDeps {
  return {
    sessionUrl: "/session/test",
    commandUrl: "/session/test/command",
    commandTimeoutMs: 15000,
    sessionRefreshTimeoutMs: 8000,
    fetchImpl: async () => jsonResponse(200, {}),
    getApiKey: () => null,
    clearAuth: vi.fn(),
    onAuthCleared: vi.fn(),
    onCommandSession: vi.fn(),
    onCommandError: vi.fn(),
    onCommandFailed: vi.fn(),
    onNoScheduledQuestion: vi.fn(),
    isActiveBoardCommandError: () => false,
    onActiveBoardRace: vi.fn(),
    onSessionData: vi.fn(),
    onSessionUnavailable: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("viewer API client", () => {
  it("adds the local OpenRouter key to same-origin API calls and clears stale auth on 401", async () => {
    let key: string | null = "sk-test";
    const clearAuth = vi.fn(() => {
      key = null;
    });
    const onAuthCleared = vi.fn();
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(401, { error: "unauthorized" }));
    const client = createViewerApiClient(baseDeps({
      fetchImpl,
      getApiKey: () => key,
      clearAuth,
      onAuthCleared,
    }));

    await client.apiFetch("/api/apps/ruby-high/example");

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get("X-Openrouter-Key")).toBe("sk-test");
    expect(clearAuth).toHaveBeenCalledTimes(1);
    expect(onAuthCleared).toHaveBeenCalledTimes(1);
  });

  it("does not attach the local OpenRouter key to cross-origin API calls", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    const client = createViewerApiClient(baseDeps({
      fetchImpl,
      getApiKey: () => "sk-test",
    }));

    await client.apiFetch("https://example.com/api/apps/ruby-high/example");

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get("X-Openrouter-Key")).toBeNull();
  });

  it("renders command sessions and tracks command settlement", async () => {
    const onCommandSession = vi.fn();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ type: "pick" });
      return jsonResponse(200, { ok: true, session: { id: "fresh-session" } });
    });
    const client = createViewerApiClient(baseDeps({ fetchImpl, onCommandSession }));

    await expect(client.command({ type: "pick" })).resolves.toEqual({
      ok: true,
      session: { id: "fresh-session" },
    });

    expect(onCommandSession).toHaveBeenCalledWith({ id: "fresh-session" });
    expect(client.commandState()).toEqual({ commandSeq: 1, lastSettledCommandSeq: 1 });
    expect(client.lastCommandError()).toBeNull();
  });

  it("exposes a bounded HTTP failure for command-specific recovery", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: "storage unavailable" }));
    const client = createViewerApiClient(baseDeps({ fetchImpl }));

    await expect(client.command({ type: "create-character" })).resolves.toBeNull();

    expect(client.lastCommandError()).toEqual({
      kind: "http",
      message: "storage unavailable",
      status: 503,
    });
  });

  it("classifies aborted commands as timeouts and clears the failure on the next command", async () => {
    const timeout = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = createViewerApiClient(baseDeps({ fetchImpl }));

    await client.command({ type: "create-character" });
    expect(client.lastCommandError()).toEqual({
      kind: "timeout",
      message: "This operation was aborted",
    });

    await client.command({ type: "pick" });
    expect(client.lastCommandError()).toBeNull();
  });

  it("swallows expected scheduler race errors without surfacing generic command errors", async () => {
    const onNoScheduledQuestion = vi.fn();
    const onCommandError = vi.fn();
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: "No scheduled question is due" }));
    const client = createViewerApiClient(baseDeps({
      fetchImpl,
      onNoScheduledQuestion,
      onCommandError,
    }));

    await expect(client.command({ type: "pick" })).resolves.toBeNull();

    expect(onNoScheduledQuestion).toHaveBeenCalledTimes(1);
    expect(onCommandError).not.toHaveBeenCalled();
  });

  it("refreshes after live-board pick races instead of showing the raw service error", async () => {
    const onActiveBoardRace = vi.fn();
    const onCommandError = vi.fn();
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: "Question already on board" }));
    const client = createViewerApiClient(baseDeps({
      fetchImpl,
      isActiveBoardCommandError: (_payload, message) => /already on board/.test(message),
      onActiveBoardRace,
      onCommandError,
    }));

    await expect(client.command({ type: "pick" })).resolves.toBeNull();

    expect(onActiveBoardRace).toHaveBeenCalledTimes(1);
    expect(onCommandError).not.toHaveBeenCalled();
  });

  it("drops stale session polls when a command starts and settles while the poll is in flight", async () => {
    const sessionRequest = pendingResponse();
    const onCommandSession = vi.fn();
    const onSessionData = vi.fn();
    const fetchImpl = vi.fn((url: string) => {
      if (url === "/session/test") return sessionRequest.promise;
      if (url === "/session/test/command") {
        return Promise.resolve(jsonResponse(200, { session: { id: "command-session" } }));
      }
      return Promise.reject(new Error("unexpected url " + url));
    });
    const client = createViewerApiClient(baseDeps({
      fetchImpl,
      onCommandSession,
      onSessionData,
    }));

    const sessionPoll = client.fetchSession();
    await client.command({ type: "answer" });
    sessionRequest.resolve(jsonResponse(200, { id: "stale-session" }));
    await sessionPoll;

    expect(onCommandSession).toHaveBeenCalledWith({ id: "command-session" });
    expect(onSessionData).not.toHaveBeenCalled();
  });

  it("bounds request lifetimes and cleans up timeout timers", () => {
    vi.useFakeTimers();
    const clearedOpts: RequestInit = {};
    const clear = withViewerTimeoutSignal(clearedOpts, 1000);
    const clearedSignal = clearedOpts.signal as AbortSignal;

    clear();
    vi.advanceTimersByTime(1000);
    expect(clearedSignal.aborted).toBe(false);

    const abortingOpts: RequestInit = {};
    withViewerTimeoutSignal(abortingOpts, 1000);
    vi.advanceTimersByTime(1000);
    expect((abortingOpts.signal as AbortSignal).aborted).toBe(true);
  });
});
