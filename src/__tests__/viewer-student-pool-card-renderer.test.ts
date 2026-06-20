import { describe, expect, it } from "vitest";
import { createStudentPoolCardRenderer } from "../viewer-parts/student-pool-card.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  alt = "";
  src = "";
  style = {
    values: new Map<string, string>(),
    setProperty: (key: string, value: string) => {
      this.style.values.set(key, value);
    },
  };

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

function createRenderer() {
  return createStudentPoolCardRenderer({
    document: createDocument(),
    defaultPortraitFor(playbookId) {
      return "/default/" + (playbookId || "unknown") + ".png";
    },
    formatSealedDate(ts) {
      return "sealed:" + String(ts || "missing");
    },
    clipEssayText(text, max) {
      const value = String(text || "");
      return value.length > max ? value.slice(0, max - 1) + "…" : value;
    },
  });
}

describe("student pool card renderer", () => {
  it("renders completed students with playbook metadata, portraits, and quotes", () => {
    const renderer = createRenderer();

    const card = renderer.build(
      [
        {
          name: "Lyra",
          playbookId: "lifer",
          diplomaImageDataUrl: "data:image/png;base64,diploma",
          completedAt: "2026-06-01",
          yearbook: [{ grade: "9" }, { grade: "10" }],
          flavorQuote: "I remember everything.",
        },
        {
          name: "Noor",
          playbookId: "outsider",
          portraitDataUrl: "data:image/png;base64,portrait",
          completedAt: "2026-06-02",
          yearbook: [],
          arcAnswer: "The hallway was a map.",
        },
      ],
      [
        { id: "lifer", name: "Lifer", accent: "#aa0000" },
        { id: "outsider", name: "Outsider", accent: "#0055aa" },
      ],
    ) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-student-pool-card");
    expect(textTree(card)).toEqual([
      "pool",
      "Student Pool",
      "2 completed students",
      "Lyra",
      "Lifer · 2/4 years · sealed:2026-06-01",
      "“I remember everything.”",
      "Noor",
      "Outsider · 0/4 years · sealed:2026-06-02",
      "“The hallway was a map.”",
    ]);

    const list = (card.children[1] as FakeElement).children[2] as FakeElement;
    const firstEntry = list.children[0] as FakeElement;
    expect(firstEntry.style.values.get("--pool-accent")).toBe("#aa0000");
    const firstPortrait = firstEntry.children[0] as FakeElement;
    expect(firstPortrait.children[0]?.src).toBe("data:image/png;base64,diploma");
    const secondPortrait = (list.children[1] as FakeElement).children[0] as FakeElement;
    expect(secondPortrait.children[0]?.src).toBe("data:image/png;base64,portrait");
  });

  it("caps visible entries at eight and shows the remaining count", () => {
    const renderer = createRenderer();
    const pool = Array.from({ length: 10 }, (_, index) => ({
      name: "Student " + index,
      playbookId: "unknown",
      completedAt: index,
    }));

    const card = renderer.build(pool, []) as unknown as FakeElement;
    const body = card.children[1] as FakeElement;
    const list = body.children[2] as FakeElement;

    expect(list.children).toHaveLength(8);
    expect(body.children[3]?.className).toBe("student-pool-more");
    expect(body.children[3]?.textContent).toBe("+2 more");
    expect(textTree(card)).toContain("10 completed students");
    expect(textTree(card)).toContain("Student 7");
    expect(textTree(card)).not.toContain("Student 8");
  });

  it("uses fallback labels and default portraits when playbook data is missing", () => {
    const renderer = createRenderer();

    const card = renderer.build(
      [{ playbookId: "slacker", completedAt: null }],
      [],
    ) as unknown as FakeElement;
    const list = (card.children[1] as FakeElement).children[2] as FakeElement;
    const entry = list.children[0] as FakeElement;
    const portrait = entry.children[0] as FakeElement;

    expect(textTree(card)).toEqual([
      "pool",
      "Student Pool",
      "1 completed student",
      "Student",
      "slacker · 0/4 years · sealed:missing",
    ]);
    expect(portrait.children[0]?.src).toBe("/default/slacker.png");
    expect(entry.style.values.get("--pool-accent")).toBe("var(--accent)");
  });
});
