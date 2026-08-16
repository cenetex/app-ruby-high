import { describe, expect, it } from "vitest";
import { createCreationControlCardRenderer } from "../viewer-parts/creation-control-card.js";

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

describe("creation control card renderer", () => {
  it("builds the character roll control card with fields and status refs", () => {
    const renderer = createCreationControlCardRenderer({ document: createDocument() });

    const refs = renderer.build({
      subtitle: "Reroll any field. AI can refresh the voice and portrait.",
    });
    const card = refs.card as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-career-card is-creation-control-card");
    expect(textTree(card)).toEqual([
      "setup",
      "Create a Student",
      "Reroll any field. AI can refresh the voice and portrait.",
      "Done editing",
      "Make a student",
    ]);
    const body = card.children[1] as FakeElement;
    expect(body.className).toBe("ccg-body");
    expect(refs.fields).toBe(body.children[2] as unknown as HTMLElement);
    expect((refs.fields as unknown as FakeElement).className).toBe("creation-fields");
    expect(refs.doneBtn).toBe((body.children[3] as FakeElement).children[0] as unknown as HTMLButtonElement);
    expect(refs.rollBtn).toBe((body.children[3] as FakeElement).children[1] as unknown as HTMLButtonElement);
    expect(refs.status).toBe(body.children[4] as unknown as HTMLElement);
    expect((refs.status as unknown as FakeElement).className).toBe("stat-budget");
  });

  it("renders an empty subtitle defensively", () => {
    const renderer = createCreationControlCardRenderer({ document: createDocument() });

    const card = renderer.build({}).card as unknown as FakeElement;

    expect(textTree(card)).toEqual(["setup", "Create a Student", "Done editing", "Make a student"]);
  });
});
