import { describe, expect, it } from "vitest";
import { createMashGridRenderer } from "../viewer-parts/mash-grid.js";

class FakeClassList {
  readonly values = new Set<string>();

  add(name: string): void {
    this.values.add(name);
  }
}

class FakeStyle {
  readonly values: Record<string, string> = {};

  setProperty(name: string, value: string): void {
    this.values[name] = value;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  classList = new FakeClassList();
  style = new FakeStyle();
  disabled = false;
  isConnected = true;
  type = "";
  listeners: Record<string, Array<() => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener());
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

function createRenderer(events: unknown[] = [], setFocus: (studentId: string | null) => unknown = () => undefined) {
  return createMashGridRenderer({
    document: createDocument(),
    students: [
      { id: "noor", name: "Noor", color: "#d22a2a" },
      { id: "vince", name: "Vince", color: "#39a0ed" },
      { id: "mika", name: "Mika", color: "#f3b33d" },
      { id: "jules", name: "Jules", color: "#31a879" },
    ],
    recentRelationshipEvents: () => events,
    mashTickStory: (event) => "tick:" + String(event),
    setFocus,
  });
}

describe("mash grid renderer", () => {
  it("renders affinity cells with state classes, meters, and accents", () => {
    const renderer = createRenderer();

    const card = renderer.build({
      mashCard: {
        cells: {
          noor: { affinity: 2, circled: true },
          vince: { affinity: -3, scratched: true },
          mika: { affinity: 1 },
          jules: { affinity: -1 },
        },
      },
    }, false) as unknown as FakeElement;

    expect(card.className).toBe("mash-grid-wrap");
    expect(textTree(card)).toEqual([
      "Social Card",
      "Pick a classmate. Your next essay affects that relationship.",
      "Noor",
      "○",
      "Vince",
      "✗",
      "Mika",
      "+1",
      "Jules",
      "-1",
    ]);

    const grid = card.children[2] as FakeElement;
    expect(grid.className).toBe("mash-grid");
    expect(grid.children.map((child) => [...child.classList.values].sort())).toEqual([
      ["is-circled"],
      ["is-scratched"],
      ["is-warm"],
      ["is-cool"],
    ]);
    expect(grid.children.map((child) => child.style.values["--mash-accent"])).toEqual([
      "#d22a2a",
      "#39a0ed",
      "#f3b33d",
      "#31a879",
    ]);
    const noorMeter = grid.children[0]!.children[2] as FakeElement;
    expect(noorMeter.attributes["aria-label"]).toBe("affinity 2");
  });

  it("renders sealed state, recent ticks, and resolved fortune axes", () => {
    const renderer = createRenderer(["old", "one", "two", "three"]);

    const card = renderer.build({
      mashCard: {
        cells: {
          noor: { affinity: 0 },
          vince: { affinity: 0 },
          mika: { affinity: 0 },
          jules: { affinity: 0 },
        },
        resolved: {
          lucky: { studentId: "stranger", value: "red locker" },
          crush: { studentId: "vince", value: "quiet hallway" },
        },
      },
    }, true) as unknown as FakeElement;

    expect(textTree(card)).toEqual([
      "Social Card · completed",
      "Your final classmate connections.",
      "Noor",
      "·",
      "Vince",
      "·",
      "Mika",
      "·",
      "Jules",
      "·",
      "tick:one",
      "tick:two",
      "tick:three",
      "crush",
      "Vince — quiet hallway",
      "lucky",
      "stranger — red locker",
    ]);
    expect(card.children[3]?.className).toBe("mash-recent");
    expect(card.children[4]?.className).toBe("mash-resolved");
  });

  it("shows and changes the player-selected focus", () => {
    const calls: Array<string | null> = [];
    const renderer = createRenderer([], (studentId) => calls.push(studentId));
    const card = renderer.build({
      mashCard: {
        focusStudentId: "mika",
        cells: {
          noor: { affinity: 0 },
          vince: { affinity: 0 },
          mika: { affinity: 1 },
          jules: { affinity: -3, scratched: true },
        },
      },
    }, false) as unknown as FakeElement;

    expect(textTree(card)).toContain("Focused on Mika. Pick again to clear.");
    const grid = card.children[2] as FakeElement;
    expect(grid.children[2]!.classList.values.has("is-focused")).toBe(true);
    expect(grid.children[2]!.attributes["aria-pressed"]).toBe("true");
    expect(grid.children[3]!.disabled).toBe(true);
    grid.children[2]!.click();
    grid.children[0]!.click();
    expect(calls).toEqual([null, "noor"]);
  });

  it("returns null when no social card cells are available", () => {
    const renderer = createRenderer();

    expect(renderer.build(null, false)).toBeNull();
    expect(renderer.build({ mashCard: {} }, false)).toBeNull();
  });
});
