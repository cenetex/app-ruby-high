import { describe, expect, it } from "vitest";
import { constantTimeSecretEqual } from "../services/secret-comparison.js";

describe("constantTimeSecretEqual", () => {
  it("accepts only an exact non-empty secret", () => {
    expect(constantTimeSecretEqual("correct horse", "correct horse")).toBe(true);
    expect(constantTimeSecretEqual("correct", "correct horse")).toBe(false);
    expect(constantTimeSecretEqual("correct horse ", "correct horse")).toBe(false);
    expect(constantTimeSecretEqual("", "")).toBe(false);
  });
});
