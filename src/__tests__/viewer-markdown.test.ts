import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markdownInlineHtml,
  normalizeScientificNotationForDisplay,
} from "../viewer-parts/client-pure.js";

describe("viewer markdown rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores stashed inline code and safe markdown links", () => {
    vi.stubGlobal("window", { location: { href: "https://ruby-high.test/viewer" } });

    const html = markdownInlineHtml("Read [the notes](https://example.com/path) and type `x < y`.");

    expect(html).toBe(
      'Read <a href="https://example.com/path" target="_blank" rel="noopener noreferrer">the notes</a> and type <code>x &lt; y</code>.',
    );
    expect(html).not.toContain(String.fromCharCode(0xe000));
    expect(html).not.toContain(String.fromCharCode(0xe001));
  });

  it("turns generated TeX scientific notation into readable Unicode", () => {
    const source = String.raw`Tariq, at \(25^\circ\text{C}\), pure water is neutral at pH 7 because \([H^+]=[OH^-]=1.0\times10^{-7}\,\text{M}\); neutral is temperature-dependent.`;

    expect(normalizeScientificNotationForDisplay(source)).toBe(
      "Tariq, at 25°C, pure water is neutral at pH 7 because [H⁺] = [OH⁻] = 1.0 × 10⁻⁷ M; neutral is temperature-dependent.",
    );
  });

  it("preserves TeX examples in Markdown code while formatting prose", () => {
    const html = markdownInlineHtml("Show `\\(10^{-7}\\)` then \\(10^{-7}\\).");

    expect(html).toBe(String.raw`Show <code>\(10^{-7}\)</code> then 10⁻⁷.`);
  });
});
