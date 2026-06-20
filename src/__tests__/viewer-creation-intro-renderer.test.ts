import { describe, expect, it } from "vitest";
import { createCreationIntroRenderer } from "../viewer-parts/creation-intro.js";

class FakeElement {
  className = "";
  innerHTML = "";
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

describe("creation intro renderer", () => {
  it("appends explanation and loading panels in the expected order", () => {
    const renderer = createCreationIntroRenderer({ document: createDocument() });
    const parent = new FakeElement("section");

    const refs = renderer.renderInto(parent as unknown as HTMLElement);

    expect(parent.children).toEqual([
      refs.explanation as unknown as FakeElement,
      refs.loading as unknown as FakeElement,
    ]);
    expect((refs.explanation as unknown as FakeElement).className).toBe("creation-explanation");
    expect((refs.loading as unknown as FakeElement).className).toBe("creation-loading");
  });

  it("renders the enrollment explanation and loading copy", () => {
    const renderer = createCreationIntroRenderer({ document: createDocument() });
    const parent = new FakeElement("section");

    const refs = renderer.renderInto(parent as unknown as HTMLElement);
    const explanation = refs.explanation as unknown as FakeElement;
    const loading = refs.loading as unknown as FakeElement;

    expect(explanation.innerHTML).toContain("You are about to enroll at Ruby High as a student.");
    expect(explanation.innerHTML).toContain("<strong>playbook</strong>");
    expect(explanation.innerHTML).toContain("Your character sticks with you for all four years.");
    expect(loading.innerHTML).toContain("creation-loading-spinner");
    expect(loading.innerHTML).toContain("Rolling your student");
    expect(loading.innerHTML).toContain("Ruby is looking up your file. One moment.");
  });
});
