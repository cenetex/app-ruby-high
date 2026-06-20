import { describe, expect, it } from "vitest";
import { createCreationStatsRenderer } from "../viewer-parts/creation-stats.js";

class FakeElement {
  className = "";
  textContent = "";
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

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("creation stats renderer", () => {
  it("renders creation stat chips in canonical order with signed values", () => {
    const renderer = createCreationStatsRenderer({ document: createDocument() });
    const parent = new FakeElement("div");

    renderer.renderInto(parent as unknown as HTMLElement, {
      head: 2,
      heart: -1,
      hustle: 0,
      honor: 3,
    });

    expect(parent.children.map((child) => child.className)).toEqual([
      "stat",
      "stat",
      "stat",
      "stat",
    ]);
    expect(textTree(parent)).toEqual([
      "head",
      "+2",
      "heart",
      "-1",
      "hustle",
      "+0",
      "honor",
      "+3",
    ]);
    expect(parent.children.map((child) => child.children[1]?.className)).toEqual([
      "v pos",
      "v neg",
      "v",
      "v pos",
    ]);
  });

  it("replaces stale children and treats missing stats as zero", () => {
    const renderer = createCreationStatsRenderer({ document: createDocument() });
    const parent = new FakeElement("div");
    const stale = new FakeElement("span");
    stale.textContent = "stale";
    parent.appendChild(stale);

    renderer.renderInto(parent as unknown as HTMLElement, null);

    expect(textTree(parent)).toEqual([
      "head",
      "+0",
      "heart",
      "+0",
      "hustle",
      "+0",
      "honor",
      "+0",
    ]);
    expect(textTree(parent)).not.toContain("stale");
  });
});
