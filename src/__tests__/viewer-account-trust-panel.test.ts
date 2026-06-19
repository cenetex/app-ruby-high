import { describe, expect, it } from "vitest";
import { createAccountTrustPanelRenderer } from "../viewer-parts/account-trust-panel.js";
import type { AccountTrustPanelView } from "../viewer-parts/client-pure.js";

class FakeElement {
  className = "";
  textContent = "";
  href = "";
  target = "";
  rel = "";
  children: FakeElement[] = [];

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("account trust panel renderer", () => {
  it("renders typed trust rows, external links, fallback values, and the safety note", () => {
    const container = new FakeElement("div");
    const renderer = createAccountTrustPanelRenderer({
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName) as unknown as HTMLElement;
        },
      },
      container: container as unknown as HTMLElement,
    });
    const view: AccountTrustPanelView = {
      rows: [
        { label: "Official website", value: "https://ruby-high.ai/", href: "https://ruby-high.ai/" },
        { label: "Treasury", value: "", href: "" },
      ],
      note: "Ruby High never asks for a seed phrase.",
    };

    renderer.render(view);

    expect(container.children).toHaveLength(3);
    expect(textTree(container)).toEqual([
      "Official website",
      "https://ruby-high.ai/",
      "Treasury",
      "Unavailable",
      "Ruby High never asks for a seed phrase.",
    ]);
    const linkedValue = container.children[0]!.children[1]!;
    expect(linkedValue.tagName).toBe("a");
    expect(linkedValue.href).toBe("https://ruby-high.ai/");
    expect(linkedValue.target).toBe("_blank");
    expect(linkedValue.rel).toBe("noopener noreferrer");
    expect(container.children[2]!.className).toBe("account-trust-note");
  });

  it("ignores missing containers", () => {
    const renderer = createAccountTrustPanelRenderer({
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName) as unknown as HTMLElement;
        },
      },
      container: null,
    });

    expect(() => renderer.render({ rows: [], note: "No-op" })).not.toThrow();
  });
});
