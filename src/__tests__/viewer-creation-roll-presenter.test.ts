import { describe, expect, it } from "vitest";
import { createCreationRollPresenter } from "../viewer-parts/creation-roll-presenter.js";

class FakeElement {
  textContent = "";
  src = "";
  style = {
    values: new Map<string, string>(),
    set borderColor(value: string) {
      this.values.set("borderColor", value);
    },
    get borderColor(): string {
      return this.values.get("borderColor") || "";
    },
    set background(value: string) {
      this.values.set("background", value);
    },
    get background(): string {
      return this.values.get("background") || "";
    },
  };
}

function refs() {
  return {
    card: new FakeElement() as unknown as HTMLElement,
    role: new FakeElement() as unknown as HTMLElement,
    portraitImg: new FakeElement() as unknown as HTMLImageElement,
    name: new FakeElement() as unknown as HTMLElement,
    subtitle: new FakeElement() as unknown as HTMLElement,
    stats: new FakeElement() as unknown as HTMLElement,
    quote: new FakeElement() as unknown as HTMLElement,
    moveTitle: new FakeElement() as unknown as HTMLElement,
    moveContent: new FakeElement() as unknown as HTMLElement,
  };
}

function rows() {
  return {
    nameRow: { val: new FakeElement() as unknown as HTMLElement },
    playbookRow: { val: new FakeElement() as unknown as HTMLElement },
    statsRow: { val: new FakeElement() as unknown as HTMLElement },
    personalityRow: { val: new FakeElement() as unknown as HTMLElement },
    quoteRow: { val: new FakeElement() as unknown as HTMLElement },
  };
}

describe("creation roll presenter", () => {
  it("fills candidate card refs and reroll rows from a rolled character", () => {
    const markdownCalls: Array<{ parent: HTMLElement; markdown: string; opts?: unknown }> = [];
    const statCalls: Array<{ parent: HTMLElement; stats: unknown }> = [];
    const presenter = createCreationRollPresenter({
      renderMarkdownInto(parent, markdown, opts) {
        markdownCalls.push({ parent, markdown, opts });
        (parent as unknown as FakeElement).textContent = markdown;
      },
      renderCreationStatsInto(parent, stats) {
        statCalls.push({ parent, stats });
      },
      defaultPortraitFor(playbookId) {
        return "/portrait/" + playbookId + ".png";
      },
    });
    const candidate = refs();
    const rowRefs = rows();

    presenter.renderRolled(
      {
        name: "Noor",
        playbookId: "outsider",
        stats: { head: 2, heart: -1, hustle: 0, honor: 3 },
        personality: "Observant.",
        flavorQuote: "the halls are watching",
      },
      [
        {
          id: "outsider",
          name: "Outsider",
          accent: "#123456",
          startingMove: { name: "Read the Room", description: "Notice what others miss." },
        },
      ],
      candidate,
      rowRefs,
      false,
    );

    expect((candidate.name as unknown as FakeElement).textContent).toBe("Noor");
    expect((candidate.subtitle as unknown as FakeElement).textContent).toBe("Outsider · Freshman candidate");
    expect((candidate.card as unknown as FakeElement).style.borderColor).toBe("#123456");
    expect((candidate.role as unknown as FakeElement).style.background).toBe("#123456");
    expect((candidate.moveTitle as unknown as FakeElement).textContent).toBe("Read the Room");
    expect((candidate.portraitImg as unknown as FakeElement).src).toBe("/portrait/outsider.png");
    expect((rowRefs.nameRow.val as unknown as FakeElement).textContent).toBe("Noor");
    expect((rowRefs.playbookRow.val as unknown as FakeElement).textContent).toBe("Outsider");
    expect((rowRefs.statsRow.val as unknown as FakeElement).textContent).toBe("HEAD +2 · HEART -1 · HUSTLE +0 · HONOR +3");
    expect((rowRefs.personalityRow.val as unknown as FakeElement).textContent).toBe("Observant.");
    expect(markdownCalls.map((call) => call.markdown)).toEqual([
      "“the halls are watching”",
      "Notice what others miss.",
      "“the halls are watching”",
    ]);
    expect(markdownCalls.map((call) => call.opts)).toEqual([
      { inline: true },
      { inline: true },
      { inline: true },
    ]);
    expect(statCalls).toEqual([{ parent: candidate.stats, stats: { head: 2, heart: -1, hustle: 0, honor: 3 } }]);
  });

  it("falls back defensively and preserves existing AI portraits", () => {
    const presenter = createCreationRollPresenter({
      renderMarkdownInto(parent, markdown) {
        (parent as unknown as FakeElement).textContent = markdown;
      },
      renderCreationStatsInto() {},
      defaultPortraitFor(playbookId) {
        return "/portrait/" + (playbookId || "unknown") + ".png";
      },
    });
    const candidate = refs();
    (candidate.portraitImg as unknown as FakeElement).src = "data:image/png;base64,ai";
    const rowRefs = rows();

    presenter.renderRolled(
      { playbookId: "mystery", arcAnswer: "I need a map." },
      [],
      candidate,
      rowRefs,
      true,
    );

    expect((candidate.name as unknown as FakeElement).textContent).toBe("—");
    expect((candidate.subtitle as unknown as FakeElement).textContent).toBe("mystery · Freshman candidate");
    expect((candidate.moveTitle as unknown as FakeElement).textContent).toBe("—");
    expect((candidate.moveContent as unknown as FakeElement).textContent).toBe("No move text yet.");
    expect((candidate.quote as unknown as FakeElement).textContent).toBe("“I need a map.”");
    expect((rowRefs.statsRow.val as unknown as FakeElement).textContent).toBe("HEAD +0 · HEART +0 · HUSTLE +0 · HONOR +0");
    expect((candidate.portraitImg as unknown as FakeElement).src).toBe("data:image/png;base64,ai");
  });
});
