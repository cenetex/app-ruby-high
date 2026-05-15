import { describe, expect, it, vi } from "vitest";
import { consumeViewerSseStream, parseViewerSseFrames, type ViewerSseResponse } from "../viewer-parts/sse.js";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

describe("viewer SSE helpers", () => {
  it("parses complete frames and preserves an incomplete tail", () => {
    const result = parseViewerSseFrames(
      frame("speaker", { facultyId: "ruby" })
      + "event: delta\ndata: {\"text\":\"hi\"}\n\n"
      + "event: delta\ndata:",
    );

    expect(result.frames).toEqual([
      { event: "speaker", data: { facultyId: "ruby" } },
      { event: "delta", data: { text: "hi" } },
    ]);
    expect(result.rest).toBe("event: delta\ndata:");
  });

  it("streams parsed events in order across chunk boundaries", async () => {
    const response = makeStreamResponse([
      "event: speaker\ndata: {\"facultyId\"",
      ":\"ruby\"}\n\n" + frame("delta", { text: "hello" }),
    ]);
    const events: Array<{ event: string; data: unknown }> = [];

    await consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse: () => {
        throw new Error("unexpected error response");
      },
      onEvent(event, data) {
        events.push({ event, data });
      },
      watchdogMs: 1000,
    });

    expect(events).toEqual([
      { event: "speaker", data: { facultyId: "ruby" } },
      { event: "delta", data: { text: "hello" } },
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

  it("routes non-ok responses through the error handler only while current", async () => {
    const errors: unknown[] = [];
    const response: ViewerSseResponse = {
      ok: false,
      status: 503,
      body: null,
      async json() {
        return { error: "offline" };
      },
    };

    await consumeViewerSseStream(response, {
      isCurrent: () => true,
      onErrorResponse(error) {
        errors.push(error);
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
    });

    expect(errors).toEqual(["offline"]);

    await consumeViewerSseStream(response, {
      isCurrent: () => false,
      onErrorResponse(error) {
        errors.push(error);
      },
      onEvent: () => {
        throw new Error("unexpected event");
      },
    });

    expect(errors).toEqual(["offline"]);
  });
});
