import { describe, expect, it } from "vitest";
import { createCareerTokensRenderer } from "../viewer-parts/career-tokens.js";

class FakeClassList {
  constructor(private owner: FakeElement) {}

  add(className: string): void {
    this.owner.className = [this.owner.className, className].filter(Boolean).join(" ");
  }
}

class FakeElement {
  className = "";
  textContent = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  classList = new FakeClassList(this);

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
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

describe("career tokens renderer", () => {
  it("renders normal daily diamonds and available advantage dice", () => {
    const renderer = createCareerTokensRenderer({
      document: createDocument(),
      streakScoreMultiplier: () => 1,
    });

    const tokens = renderer.build({ streakReq: 5, streakHere: 2, advantageCap: 3, advantageRemaining: 2 }) as unknown as FakeElement;

    expect(tokens.className).toBe("career-token-strip");
    expect(textTree(tokens)).toEqual(["Daily classes", "2/3", "Advantage", "2/3"]);
    const streakTrack = (tokens.children[0]!.children[1]) as FakeElement;
    const diamonds = streakTrack.children[0]!;
    expect(diamonds.className).toBe("career-diamonds");
    expect(diamonds.children.map((diamond) => [diamond.className, diamond.attributes["aria-label"]])).toEqual([
      ["career-diamond is-filled", "Daily class passed"],
      ["career-diamond is-filled", "Daily class passed"],
      ["career-diamond", "Daily class needed"],
    ]);
    const dice = tokens.children[1]!.children[1]!;
    expect(dice.children.map((die) => [die.className, die.attributes["aria-label"], die.children.length])).toEqual([
      ["career-die is-live", "Advantage die available", 5],
      ["career-die is-live", "Advantage die available", 5],
      ["career-die", "Advantage die spent", 5],
    ]);
  });

  it("renders bonus-only streak state using yesterday's scoring streak", () => {
    const seenStreaks: number[] = [];
    const renderer = createCareerTokensRenderer({
      document: createDocument(),
      streakScoreMultiplier(streak) {
        seenStreaks.push(streak);
        return 2;
      },
    });

    const tokens = renderer.build({
      streakReq: 3,
      streakHere: 3,
      streakLastDate: "2026-06-19",
      todayKey: "2026-06-19",
      advantageCap: 0,
      advantageRemaining: 0,
    }) as unknown as FakeElement;

    const streakTrack = tokens.children[0]!.children[1]!;
    expect(seenStreaks).toEqual([2]);
    expect(streakTrack.className).toBe("career-streak-track is-bonus-only");
    const chip = streakTrack.children[0]!;
    expect(chip.className).toBe("career-multiplier is-live is-bonus");
    expect(chip.textContent).toBe("\u00d72 Bonus!");
    expect(chip.attributes["aria-label"]).toBe("\u00d72 score bonus active");
    expect(textTree(tokens)).toEqual(["Daily classes", "\u00d72 Bonus!", "Advantage", "\u2014"]);
  });

  it("renders spent advantage copy and clamps invalid values", () => {
    const renderer = createCareerTokensRenderer({
      document: createDocument(),
      streakScoreMultiplier: () => 1,
    });

    const tokens = renderer.build({ streakReq: -1, streakHere: 9, advantageCap: 2, advantageRemaining: -2 }) as unknown as FakeElement;

    expect(textTree(tokens)).toEqual(["Daily classes", "0/0", "Advantage", "Spent"]);
    const dice = tokens.children[1]!.children[1]!;
    expect(dice.children.map((die) => die.className)).toEqual(["career-die", "career-die"]);
  });
});
