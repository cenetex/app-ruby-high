import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletionStream } from "../services/openrouter-client.js";

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

function mockSseResponse(body: string): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
}

async function collectStream(body: string) {
  mockSseResponse(body);
  const chunks = [];
  for await (const chunk of chatCompletionStream({
    url: "https://example.test/chat/completions",
    headers: { "Content-Type": "application/json" },
    body: { model: "test/model", messages: [] },
    label: "test-stream",
    timeoutMs: 1_000,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chatCompletionStream", () => {
  it("does not drop the final text frame when the stream ends without a blank-line delimiter", async () => {
    const chunks = await collectStream([
      sseChunk({ choices: [{ delta: { content: "No, Rin, we would " } }] }),
      "",
      sseChunk({ choices: [{ delta: { content: "miss the rule entirely." } }] }),
    ].join("\n"));

    expect(chunks).toEqual([
      { kind: "text", text: "No, Rin, we would " },
      { kind: "text", text: "miss the rule entirely." },
      { kind: "finish", reason: null },
    ]);
  });

  it("parses CRLF-delimited SSE frames", async () => {
    const chunks = await collectStream([
      sseChunk({ choices: [{ delta: { content: "first " } }] }),
      "",
      sseChunk({ choices: [{ delta: { content: "second" }, finish_reason: "stop" }] }),
      "",
    ].join("\r\n"));

    expect(chunks).toEqual([
      { kind: "text", text: "first " },
      { kind: "text", text: "second" },
      { kind: "finish", reason: "stop" },
    ]);
  });
});
