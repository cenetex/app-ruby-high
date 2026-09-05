import { describe, expect, it } from "vitest";
import { studentRemixFallbackMessage, viewerRequestError } from "../viewer-parts/player-feedback.js";

describe("player request feedback", () => {
  it.each([undefined, null, 502, "502", { error: { upstream: "private details" } }, new Error("provider request failed: secret")])(
    "gives a useful retry message for an unknown failure: %j",
    (error) => {
      expect(viewerRequestError("Portrait generation", error)).toBe(
        "Portrait generation is unavailable right now. Try again in a moment.",
      );
    },
  );

  it.each([401, 402, 403, 429])("gives an action for HTTP %i", (status) => {
    const message = viewerRequestError("Teacher chat", null, status);
    expect(message).toMatch(status === 429 ? /Wait a moment and try again/ : /Open Account|Sign in again from Account/);
    expect(message).not.toContain(String(status));
  });

  it.each([{ name: "AbortError" }, { name: "TimeoutError" }, { kind: "timeout" }, { status: 408 }, { status: 504 }])(
    "explains a measured timeout: %j",
    (error) => {
      expect(viewerRequestError("Teacher chat", error)).toContain("took too long");
      expect(studentRemixFallbackMessage(error)).toBe(
        "The AI remix took too long. Ruby created your student on this device. You can start class.",
      );
    },
  );

  it.each([new TypeError("Failed to fetch"), new TypeError("Load failed"), { kind: "network" }])(
    "explains connection failure: %j",
    (error) => {
      expect(viewerRequestError("Teacher chat", error)).toContain("Check your connection and try again");
      expect(studentRemixFallbackMessage(error)).toContain("lost its connection");
    },
  );

  it.each([{ status: 500 }, { status: 502 }, { status: 503 }, new SyntaxError("Unexpected token"), new Error("timeout in unrelated provider text")])(
    "keeps other failures separate from measured timeouts: %j",
    (error) => {
      expect(studentRemixFallbackMessage(error)).toBe(
        "The AI remix is unavailable right now. Ruby created your student on this device. You can start class.",
      );
    },
  );
});
