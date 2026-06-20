import { describe, expect, it } from "vitest";
import { createPaperCardRenderer, type PaperCardCharacterCardSpec } from "../viewer-parts/paper-card.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  classList = {
    values: [] as string[],
    add: (value: string) => {
      this.classList.values.push(value);
      this.className = [this.className, value].filter(Boolean).join(" ");
    },
  };

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

function createRenderer() {
  const specs: PaperCardCharacterCardSpec[] = [];
  const cards: FakeElement[] = [];
  const renderer = createPaperCardRenderer({
    gradeLabels: { "9": "Freshman", "10": "Sophomore" },
    buildCharacterCard(spec) {
      specs.push(spec);
      const card = new FakeElement("article");
      card.className = "ccg-card";
      cards.push(card);
      return card as unknown as HTMLElement;
    },
    defaultPortraitFor(playbookId) {
      return "/default/" + (playbookId || "unknown") + ".png";
    },
    formatSealedDate(ts) {
      return "sealed:" + String(ts || "missing");
    },
  });
  return { renderer, specs, cards };
}

describe("paper card renderer", () => {
  it("renders a sealed yearbook snapshot instead of live character identity", () => {
    const { renderer, specs, cards } = createRenderer();

    const card = renderer.build(
      {
        grade: "10",
        playbookId: "outsider",
        name: "Snapshot Noor",
        stats: { nerve: 9 },
        portraitDataUrl: "data:image/png;base64,snapshot",
        flavorQuote: "I was here.",
        completedAt: "2026-06-01T00:00:00.000Z",
        summary: { correct: 7, total: 8 },
      },
      {
        playbookId: "heart",
        name: "Live Noor",
        stats: { nerve: 2 },
        portraitDataUrl: "data:image/png;base64,live",
      },
      { id: "heart", accent: "#ff00ff" },
      [
        { id: "outsider", accent: "#123456" },
        { id: "heart", accent: "#ff00ff" },
      ],
    ) as unknown as FakeElement;

    expect(card).toBe(cards[0]);
    expect(card.className).toBe("ccg-card is-paper-card");
    expect(specs).toEqual([
      {
        role: "player",
        name: "Snapshot Noor",
        subtitle: "\u2713 Sophomore \u00b7 sealed sealed:2026-06-01T00:00:00.000Z \u00b7 7/8 correct",
        portraitUrl: "data:image/png;base64,snapshot",
        accent: "#123456",
        stats: { nerve: 9 },
        quote: "I was here.",
      },
    ]);
  });

  it("falls back to live data, default portraits, and grade labels defensively", () => {
    const { renderer, specs } = createRenderer();

    renderer.build(
      {
        grade: 12,
        completedAt: null,
      },
      {
        playbookId: "slacker",
        name: "Live Sami",
        stats: { chill: 10 },
      },
      { id: "slacker", accent: "#00aa88" },
      [],
    );

    expect(specs[0]).toEqual({
      role: "player",
      name: "Live Sami",
      subtitle: "\u2713 Grade 12 \u00b7 sealed sealed:missing \u00b7 0/0 correct",
      portraitUrl: "/default/slacker.png",
      accent: "#00aa88",
      stats: { chill: 10 },
      quote: "",
    });
  });

  it("uses arc answers when a saved flavor quote is absent", () => {
    const { renderer, specs } = createRenderer();

    renderer.build(
      {
        grade: "9",
        playbookId: "overachiever",
        arcAnswer: "The proof matters.",
      },
      { playbookId: "overachiever", name: "Indra" },
      { id: "overachiever", accent: "#dd3344" },
      [{ id: "overachiever", accent: "#3344dd" }],
    );

    expect(specs[0]?.quote).toBe("The proof matters.");
    expect(specs[0]?.accent).toBe("#3344dd");
  });
});
