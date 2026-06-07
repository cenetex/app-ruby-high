import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownInlineHtml } from "../viewer-parts/client-pure.js";

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
});
