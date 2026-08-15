import { describe, expect, it } from "vitest";
import { createCreationCandidateCardRenderer } from "../viewer-parts/creation-candidate-card.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  alt = "";
  type = "";
  disabled = false;
  hidden = false;

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

describe("creation candidate card renderer", () => {
  it("builds the candidate character card skeleton and returns stable refs", () => {
    const renderer = createCreationCandidateCardRenderer({ document: createDocument() });

    const refs = renderer.build();
    const card = refs.card as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-character-card is-creation-candidate-card");
    expect(textTree(card)).toEqual([
      "player",
      "Free · no signup · your first class starts immediately.",
      "\u2728 Generate AI portrait",
      "Customize",
      "Take my seat · start class",
    ]);
    expect(refs.role).toBe(card.children[0] as unknown as HTMLElement);
    expect(refs.portraitImg).toBe((card.children[1] as FakeElement).children[0] as unknown as HTMLImageElement);
    expect((refs.portraitImg as unknown as FakeElement).alt).toBe("");

    const body = card.children[2] as FakeElement;
    expect(body.className).toBe("ccg-body");
    expect(refs.name).toBe(body.children[0] as unknown as HTMLElement);
    expect(refs.subtitle).toBe(body.children[1] as unknown as HTMLElement);
    expect(refs.stats).toBe(body.children[4] as unknown as HTMLElement);
    expect(refs.quote).toBe(body.children[5] as unknown as HTMLElement);
    expect(refs.moveTitle).toBe((body.children[6] as FakeElement).children[0] as unknown as HTMLElement);
    expect(refs.moveContent).toBe((body.children[6] as FakeElement).children[1] as unknown as HTMLElement);
    expect(refs.portraitStatus).toBe(body.children[7] as unknown as HTMLElement);
  });

  it("builds portrait and start actions with the expected initial state", () => {
    const renderer = createCreationCandidateCardRenderer({ document: createDocument() });

    const refs = renderer.build();
    const portraitBtn = refs.portraitBtn as unknown as FakeElement;
    const customizeBtn = refs.customizeBtn as unknown as FakeElement;
    const saveBtn = refs.saveBtn as unknown as FakeElement;

    expect(portraitBtn.className).toBe("secondary");
    expect(portraitBtn.type).toBe("button");
    expect(portraitBtn.textContent).toBe("\u2728 Generate AI portrait");
    expect(customizeBtn.className).toBe("secondary creation-customize-btn");
    expect(customizeBtn.type).toBe("button");
    expect(customizeBtn.textContent).toBe("Customize");
    expect(saveBtn.className).toBe("primary");
    expect(saveBtn.type).toBe("button");
    expect(saveBtn.textContent).toBe("Take my seat · start class");
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.hidden).toBe(true);
  });
});
