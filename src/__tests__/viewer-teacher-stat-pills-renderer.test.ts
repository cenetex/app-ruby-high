import { describe, expect, it, vi } from "vitest";
import { createTeacherStatPillsRenderer } from "../viewer-parts/teacher-stat-pills.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
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

describe("teacher stat pills renderer", () => {
  it("renders teacher stats in canonical order with injected labels and formatting", () => {
    const statLabel = vi.fn((key: string) => key.toUpperCase());
    const fmtStat = vi.fn((value: number) => (value >= 0 ? "+" : "") + value);
    const renderer = createTeacherStatPillsRenderer({
      document: createDocument(),
      statLabel,
      fmtStat,
    });

    const wrap = renderer.build({
      head: 3,
      heart: -1,
      hustle: 0,
      honor: 2,
    }) as unknown as FakeElement;

    expect(wrap.className).toBe("teacher-stat-pills");
    expect(wrap.children.map((child) => child.className)).toEqual([
      "pill stat head",
      "pill stat heart",
      "pill stat hustle",
      "pill stat honor",
    ]);
    expect(textTree(wrap)).toEqual([
      "HEAD +3",
      "HEART -1",
      "HUSTLE +0",
      "HONOR +2",
    ]);
    expect(statLabel).toHaveBeenNthCalledWith(1, "head");
    expect(statLabel).toHaveBeenNthCalledWith(4, "honor");
    expect(fmtStat).toHaveBeenNthCalledWith(1, 3);
    expect(fmtStat).toHaveBeenNthCalledWith(2, -1);
  });

  it("treats missing and nonnumeric stats as zero", () => {
    const renderer = createTeacherStatPillsRenderer({
      document: createDocument(),
      statLabel: (key) => key,
      fmtStat: (value) => String(value),
    });

    expect(textTree(renderer.build(null) as unknown as FakeElement)).toEqual([
      "head 0",
      "heart 0",
      "hustle 0",
      "honor 0",
    ]);

    expect(textTree(renderer.build({ head: "4", heart: "nope" }) as unknown as FakeElement)).toEqual([
      "head 4",
      "heart NaN",
      "hustle 0",
      "honor 0",
    ]);
  });
});
