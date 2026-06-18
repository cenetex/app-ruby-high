import { describe, expect, it, vi } from "vitest";
import { consumeViewerSseStream, parseViewerSseFrames, type ViewerSseResponse } from "../viewer-parts/sse.js";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function frameWithId(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeStreamResponse(chunks: string[]): ViewerSseResponse & { cancel: ReturnType<typeof vi.fn> } {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  const cancel = vi.fn();
  let index = 0;
  return {
    ok: true,
    status: 200,
    cancel,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encoded.length) return { done: true };
            return { value: encoded[index++], done: false };
          },
          cancel,
        };
      },
    },
    async json() {
      return {};
    },
  };
}

function makeDelayedStreamResponse(chunks: string[], delayMs: number): ViewerSseResponse & { cancel: ReturnType<typeof vi.fn> } {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  const cancel = vi.fn();
  let index = 0;
  let cancelled = false;
  cancel.mockImplementation(() => { cancelled = true; });
  return {
    ok: true,
    status: 200,
    cancel,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              setTimeout(() => {
                if (cancelled || index >= encoded.length) {
                  resolve({ done: true });
                  return;
                }
                resolve({ value: encoded[index++], done: false });
              }, delayMs);
            });
          },
          cancel,
        };
      },
    },
    async json() {
      return {};
    },
  };
}

function makeSilentStreamResponse(): ViewerSseResponse & { cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  let resolveRead: ((value: { done: boolean }) => void) | null = null;
  cancel.mockImplementation(() => {
    if (resolveRead) resolveRead({ done: true });
  });
  return {
    ok: true,
    status: 200,
    cancel,
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              resolveRead = resolve;
            });
          },
          cancel,
        };
      },
    },
    async json() {
      return {};
    },
  };
}

describe("viewer SSE helpers", () => {
  it("parses complete frames and preserves an incomplete tail", () => {
    const result = parseViewerSseFrames(
      frame("speaker", { facultyId: "ruby" })
      + "event: delta\ndata: {\"text\":\"hi\"}\n\n"
      + "event: delta\ndata:",
    );

    expect(result.frames).toEqual([
      { event: "speaker", data: { facultyId: "ruby" }, id: null },
      { event: "delta", data: { text: "hi" }, id: null },
    ]);
    expect(result.rest).toBe("event: delta\ndata:");
  });

  it("parses CRLF-delimited frames and multiline data fields", () => {
    const result = parseViewerSseFrames(
      "event: world-event\r\n"
      + "data: {\r\n"
      + "data: \"label\": \"Ruby live\",\r\n"
      + "data: \"count\": 2\r\n"
      + "data: }\r\n"
      + "\r\n"
      + "event: heartbeat\r\n"
      + "data: {\"ok\":true}\r\n"
      + "\r\n"
      + "event: world-event\r\n"
      + "data: {",
    );

    expect(result.frames).toEqual([
      { event: "world-event", data: { label: "Ruby live", count: 2 }, id: null },
      { event: "heartbeat", data: { ok: true }, id: null },
    ]);
    expect(result.rest).toBe("event: world-event\r\ndata: {");
  });

  it("preserves SSE ids for cursor-aware consumers", () => {
    const result = parseViewerSseFrames(
      frameWithId("world:cursor:20:world%3Aevent%3A000000000000000b", "world-event", { label: "Ruby live" })
      + "id: plain-id\r\n"
      + "event: heartbeat\r\n"
      + "data: {\"ok\":true}\r\n\r\n",
    );

    expect(result.frames).toEqual([
      {
        event: "world-event",
        data: { label: "Ruby live" },
        id: "world:cursor:20:world%3Aevent%3A000000000000000b",
      },
      {
        event: "heartbeat",
        data: { ok: true },
        id: "plain-id",
      },
    ]);
  });

  it("streams parsed events in order across chunk boundaries", async () => {
    const response = makeStreamResponse([
      "event: speaker\ndata: {\"facultyId\"",
      ":\"ruby\"}\n\n" + frame("delta", { text: "hello" }),
    ]);
    const events: Array<{ event: string; data: unknown; id: string | null | undefined }> = [];

    await consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent(event, data, id) {
        events.push({ event, data, id });
      },
      watchdogMs: 1000,
    });

    expect(events).toEqual([
      { event: "speaker", data: { facultyId: "ruby" }, id: null },
      { event: "delta", data: { text: "hello" }, id: null },
    ]);
    expect(response.cancel).not.toHaveBeenCalled();
  });

  it("cancels the reader when a newer stream makes the current one stale", async () => {
    const response = makeStreamResponse([
      frame("delta", { text: "first" }) + frame("tool", { tool: "pose_question" }),
    ]);
    const events: string[] = [];
    let current = true;

    await consumeViewerSseStream(response, {
      isCurrent: () => current,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent(event) {
        events.push(event);
        current = false;
      },
      watchdogMs: 1000,
    });

    expect(events).toEqual(["delta"]);
    expect(response.cancel).toHaveBeenCalledTimes(1);
  });

  it("treats the watchdog as an idle timeout, not a maximum stream age", async () => {
    vi.useFakeTimers();
    const response = makeDelayedStreamResponse([
      frame("heartbeat", { n: 1 }),
      frame("heartbeat", { n: 2 }),
      frame("end", { ok: true }),
    ], 900);
    const events: string[] = [];

    const done = consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent(event) {
        events.push(event);
      },
      watchdogMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(events).toEqual(["heartbeat"]);
    await vi.advanceTimersByTimeAsync(900);
    expect(events).toEqual(["heartbeat", "heartbeat"]);
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(900);
    await done;

    expect(events).toEqual(["heartbeat", "heartbeat", "end"]);
    expect(response.cancel).not.toHaveBeenCalled();
  });

  it("still cancels streams that stop producing chunks", async () => {
    vi.useFakeTimers();
    const response = makeSilentStreamResponse();
    const done = consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
      watchdogMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(response.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels streams that exceed the undelimited buffer limit", async () => {
    const response = makeStreamResponse([
      "event: world-event\ndata: " + "x".repeat(2048),
    ]);

    await expect(consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
      maxBufferChars: 1024,
    })).rejects.toThrow("SSE stream exceeded buffer limit.");

    expect(response.cancel).toHaveBeenCalledTimes(1);
  });

  it("routes non-ok responses through the error handler only while current", async () => {
    const errors: Array<{ error: unknown; status: number; retryAfterMs: number | null }> = [];
    const response: ViewerSseResponse = {
      ok: false,
      status: 429,
      headers: {
        get(name: string) {
          return name.toLowerCase() === "retry-after" ? "7" : null;
        },
      },
      body: null,
      async json() {
        return { error: "offline" };
      },
    };

    await consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse(error, meta) {
        errors.push({
          error,
          status: meta?.status ?? 0,
          retryAfterMs: meta?.retryAfterMs ?? null,
        });
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
    });

    expect(errors).toEqual([{ error: "offline", status: 429, retryAfterMs: 7000 }]);

    await consumeViewerSseStream(response, {
      isCurrent: () => false,
      onErrorResponse(error, meta) {
        errors.push({
          error,
          status: meta?.status ?? 0,
          retryAfterMs: meta?.retryAfterMs ?? null,
        });
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
    });

    expect(errors).toEqual([{ error: "offline", status: 429, retryAfterMs: 7000 }]);
  });
});
