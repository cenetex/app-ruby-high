import { describe, expect, it } from "vitest";
import { createGraduationCeremonyRenderer, type GraduationChoiceControls } from "../viewer-parts/graduation-ceremony.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  disabled = false;
  type = "";
  listeners: Record<string, Array<() => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type]!.push(listener);
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

describe("graduation ceremony renderer", () => {
  it("renders the board ceremony shell and choices", () => {
    const renderer = createGraduationCeremonyRenderer({ document: createDocument() });

    const card = renderer.build({
      onBoard: true,
      completedGradeLabel: "Freshman",
      finalGradeLetter: "A",
      scoreText: "Final grade A · 92%",
      targetLabel: "Sophomore",
      hasNextGrade: true,
      choices: [
        { label: "Photo", detail: "Snap with your top teacher.", reward: { kind: "photo" } },
        { label: "Extra Advantage", detail: "for Sophomore year", reward: { kind: "advantage" } },
      ],
    }) as unknown as FakeElement;

    expect(card.tagName).toBe("section");
    expect(card.className).toBe("graduation-board-card");
    expect(textTree(card)).toEqual([
      "A",
      "Freshman complete",
      "Final grade A · 92% · next: Sophomore",
      "Choose one reward for your yearbook.",
      "Photo",
      "Snap with your top teacher.",
      "Extra Advantage",
      "for Sophomore year",
    ]);
    const row = card.children[2] as FakeElement;
    expect(row.className).toBe("graduation-choice-row");
    expect(row.children.map((child) => child.className)).toEqual([
      "graduation-choice",
      "graduation-choice",
    ]);
  });

  it("renders the sheet ceremony shell for final graduation", () => {
    const renderer = createGraduationCeremonyRenderer({ document: createDocument() });

    const card = renderer.build({
      targetLabel: "graduate",
      scoreText: "Final grade ready",
      choices: [{ label: "Photo", detail: "Snap.", reward: { kind: "photo" } }],
    }) as unknown as FakeElement;

    expect(card.tagName).toBe("div");
    expect(card.className).toBe("graduation-ceremony");
    expect(textTree(card)).toEqual([
      "Graduation Ceremony",
      "Pick one keepsake or reward to save this year in your yearbook.",
      "Photo",
      "Snap.",
    ]);
    expect(card.children[2]?.className).toBe("graduation-status");
    expect(card.children[3]?.className).toBe("graduation-choice-row");
  });

  it("passes reward, button, and ceremony controls to choice callbacks", () => {
    const renderer = createGraduationCeremonyRenderer({ document: createDocument() });
    const calls: Array<{ reward: unknown; button: FakeElement; controls: GraduationChoiceControls }> = [];

    const card = renderer.build({
      choices: [
        { label: "Photo", detail: "Snap.", reward: { kind: "photo" } },
      ],
      onChoice(reward, button, controls) {
        calls.push({ reward, button: button as unknown as FakeElement, controls });
      },
    }) as unknown as FakeElement;
    const row = card.children[3] as FakeElement;
    const button = row.children[0] as FakeElement;

    button.click();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.reward).toEqual({ kind: "photo" });
    expect(calls[0]?.button).toBe(button);
    expect((calls[0]?.controls.status as unknown as FakeElement).className).toBe("graduation-status");
    expect(calls[0]?.controls.buttons).toEqual([button as unknown as HTMLButtonElement]);
  });
});
