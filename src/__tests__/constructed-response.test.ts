import { describe, expect, it } from "vitest";
import {
  constructedResponseText,
  parseConstructedResponseSelection,
} from "../services/constructed-response.js";

describe("constructed response cards", () => {
  it("accepts one known card from every row and builds fixed grading text", () => {
    const selection = parseConstructedResponseSelection({
      stance: "conditional",
      evidence: "source",
      impact: "systems",
    });

    expect(selection).toEqual({
      stance: "conditional",
      evidence: "source",
      impact: "systems",
    });
    expect(constructedResponseText(selection!)).toBe(
      "The answer depends on the context and who is affected. "
      + "I would check the source and look for missing evidence. "
      + "The wider system and its rules should carry the most weight.",
    );
  });

  it("rejects missing, unknown, or extra-shaped player values", () => {
    expect(parseConstructedResponseSelection(null)).toBeNull();
    expect(parseConstructedResponseSelection({ stance: "support", evidence: "source" })).toBeNull();
    expect(parseConstructedResponseSelection({
      stance: "my private prose",
      evidence: "source",
      impact: "people",
    })).toBeNull();
  });
});
