import { describe, expect, it } from "vitest";
import { isPreflightUnsupportedError, solanaErrorMessages } from "../services/solana-errors.js";

describe("Solana error helpers", () => {
  it("detects preflight-unsupported messages hidden in Solana Kit decode hints", () => {
    const encoded = Buffer.from(
      "__code=-32602&__serverMessage=Invalid%20Request%3A%20running%20preflight%20check%20is%20not%20supported",
    ).toString("base64");
    const err = new Error(
      `Solana error #-32602; Decode this error by running \`npx @solana/errors decode -- -32602 '${encoded}'\``,
    );

    expect(isPreflightUnsupportedError(err)).toBe(true);
    expect(solanaErrorMessages(err)).toContain("Invalid Request: running preflight check is not supported");
  });

  it("detects preflight-unsupported messages from structured error context", () => {
    const err = Object.assign(new Error("Solana error #-32602"), {
      context: {
        __serverMessage: "Invalid Request: running preflight check is not supported",
      },
    });

    expect(isPreflightUnsupportedError(err)).toBe(true);
  });

  it("does not treat unrelated Solana errors as preflight unsupported", () => {
    const encoded = Buffer.from(
      "__code=-32602&__serverMessage=Invalid%20Request%3A%20invalid%20transaction%20encoding",
    ).toString("base64");
    const err = new Error(
      `Solana error #-32602; Decode this error by running \`npx @solana/errors decode -- -32602 '${encoded}'\``,
    );

    expect(isPreflightUnsupportedError(err)).toBe(false);
  });
});
