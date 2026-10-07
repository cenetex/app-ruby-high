import { describe, expect, it } from "vitest";
import { renderViewerHtml } from "../viewer.js";

describe("player text entry boundary", () => {
  it("offers choices and generated displays throughout the public viewer", () => {
    const html = renderViewerHtml({ agentName: "Ruby", sessionId: "rh:choices", apiBase: "/api/apps/ruby-high", role: "human" });
    expect(html).not.toMatch(/<(?:input|textarea)\b/i);
    expect(html).not.toMatch(/contenteditable\s*=/i);
    for (const id of ["bug-report-text", "pack-search-input", "course-materials-input"]) {
      expect(html).toMatch(new RegExp(`<select[^>]*id="${id}"`));
    }
    expect(html).toMatch(/<output[^>]*id="teacher-materials-input"/);
  });
});
