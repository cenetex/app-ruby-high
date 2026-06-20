import { describe, expect, it } from "vitest";
import { createCcgCardRenderer } from "../viewer-parts/ccg-card.js";

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  src = "";
  alt = "";
  innerHTML = "";
  onerror: (() => void) | null = null;
  children: FakeElement[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  styleValues: Record<string, string> = {};
  style = {
    set borderColor(value: string) {
      this.values.borderColor = value;
    },
    get borderColor() {
      return this.values.borderColor || "";
    },
    set background(value: string) {
      this.values.background = value;
    },
    get background() {
      return this.values.background || "";
    },
    set display(value: string) {
      this.values.display = value;
    },
    get display() {
      return this.values.display || "";
    },
    set placeItems(value: string) {
      this.values.placeItems = value;
    },
    get placeItems() {
      return this.values.placeItems || "";
    },
    set fontSize(value: string) {
      this.values.fontSize = value;
    },
    get fontSize() {
      return this.values.fontSize || "";
    },
    set color(value: string) {
      this.values.color = value;
    },
    get color() {
      return this.values.color || "";
    },
    values: this.styleValues,
  };

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener({ type: "click" }));
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

describe("ccg card renderer", () => {
  it("renders the full character card with stats, markdown sections, progression, and actions", () => {
    const markdown: Array<{ className: string; markdown: string }> = [];
    const progressions: unknown[] = [];
    const clicks: string[] = [];
    const renderer = createCcgCardRenderer({
      document: createDocument(),
      renderMarkdownInto(el, value) {
        markdown.push({ className: (el as unknown as FakeElement).className, markdown: value });
        el.textContent = "md:" + value;
      },
      appendProgression(parent, progression) {
        progressions.push(progression);
        const marker = createDocument().createElement("div") as unknown as FakeElement;
        marker.className = "progression-marker";
        marker.textContent = "progress";
        (parent as unknown as FakeElement).appendChild(marker);
      },
    });

    const card = renderer.buildCharacterCard({
      role: "teacher",
      name: "Ruby",
      subtitle: "Homeroom",
      portraitUrl: "/ruby.png",
      accent: "#d33",
      stats: { head: 1, heart: 0, hustle: -1, honor: 2 },
      quote: "Door first.",
      nextStepHint: "Next class soon.",
      progression: { rungs: [] },
      footer: { title: "Teaches", content: "school lore" },
      actions: [
        { label: "Close", secondary: true, onClick: () => clicks.push("close") },
      ],
    }) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card");
    expect(card.styleValues.borderColor).toBe("#d33");
    expect((card.children[0] as FakeElement).className).toBe("ccg-role teacher");
    expect((card.children[0] as FakeElement).styleValues.background).toBe("#d33");
    const art = card.children[1] as FakeElement;
    expect(art.className).toBe("ccg-art");
    expect((art.children[0] as FakeElement).src).toBe("/ruby.png");
    expect(textTree(card)).toEqual([
      "teacher",
      "Ruby",
      "Homeroom",
      "head",
      "+1",
      "heart",
      "+0",
      "hustle",
      "-1",
      "honor",
      "+2",
      "md:\u201cDoor first.\u201d",
      "Next class soon.",
      "progress",
      "Teaches",
      "md:school lore",
      "Close",
    ]);
    expect(markdown).toEqual([
      { className: "ccg-quote", markdown: "\u201cDoor first.\u201d" },
      { className: "ccg-footer-content", markdown: "school lore" },
    ]);
    expect(progressions).toEqual([{ rungs: [] }]);
    const action = (((card.children[2] as FakeElement).children.at(-1) as FakeElement).children[0]) as FakeElement;
    expect(action.type).toBe("button");
    expect(action.className).toBe("secondary");
    action.click();
    expect(clicks).toEqual(["close"]);
  });

  it("uses initials for missing portraits and failed image loads", () => {
    const renderer = createCcgCardRenderer({
      document: createDocument(),
      renderMarkdownInto() {},
      appendProgression() {},
    });

    const missing = renderer.buildCharacterCard({ role: "player", name: "Noor" }) as unknown as FakeElement;
    const failed = renderer.buildCharacterCard({ role: "student", name: "Sami", portraitUrl: "/missing.png" }) as unknown as FakeElement;

    const missingArt = missing.children[1] as FakeElement;
    expect(missingArt.textContent).toBe("N");
    expect(missingArt.styleValues.display).toBe("grid");
    expect(missingArt.styleValues.fontSize).toBe("72px");

    const failedArt = failed.children[1] as FakeElement;
    const img = failedArt.children[0] as FakeElement;
    img.onerror?.();
    expect(failedArt.textContent).toBe("S");
    expect(failedArt.styleValues.display).toBe("grid");
    expect(failedArt.styleValues.placeItems).toBe("center");
  });
});
