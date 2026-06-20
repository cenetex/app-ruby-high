import { describe, expect, it, vi } from "vitest";
import { createTeacherPreviewUpdater } from "../viewer-parts/teacher-preview-updater.js";

class FakeElement {
  textContent = "";
  children: Record<string, FakeElement> = {};

  constructor(readonly selector: string) {}

  querySelector(selector: string): FakeElement | null {
    return this.children[selector] || null;
  }
}

function createCard() {
  const root = new FakeElement("root");
  const card = new FakeElement(".is-creation-candidate-card");
  root.children[".is-creation-candidate-card"] = card;
  card.children[".ccg-name"] = new FakeElement(".ccg-name");
  card.children[".ccg-subtitle"] = new FakeElement(".ccg-subtitle");
  card.children[".ccg-quote"] = new FakeElement(".ccg-quote");
  card.children[".ccg-footer-content"] = new FakeElement(".ccg-footer-content");
  return { root, card };
}

describe("teacher preview updater", () => {
  it("refreshes teacher candidate text and markdown fields", () => {
    const markdown = vi.fn((target: Element, source: string) => {
      (target as unknown as FakeElement).textContent = "md:" + source;
    });
    const updater = createTeacherPreviewUpdater({ renderMarkdownInto: markdown });
    const { root, card } = createCard();

    updater.refresh(root as unknown as ParentNode, {
      displayName: "Professor Quill",
      subject: "Research Seminar",
      quote: "Show your work.",
      description: "Skeptical but kind.",
    });

    expect(card.children[".ccg-name"]?.textContent).toBe("Professor Quill");
    expect(card.children[".ccg-subtitle"]?.textContent).toBe("Research Seminar · teacher candidate");
    expect(card.children[".ccg-quote"]?.textContent).toBe("md:“Show your work.”");
    expect(card.children[".ccg-footer-content"]?.textContent).toBe("md:Skeptical but kind.");
    expect(markdown).toHaveBeenCalledWith(card.children[".ccg-quote"], "“Show your work.”", { inline: true });
    expect(markdown).toHaveBeenCalledWith(card.children[".ccg-footer-content"], "Skeptical but kind.", { inline: true });
  });

  it("uses fallback labels and clears empty markdown fields", () => {
    const markdown = vi.fn((target: Element, source: string) => {
      (target as unknown as FakeElement).textContent = source;
    });
    const updater = createTeacherPreviewUpdater({ renderMarkdownInto: markdown });
    const { root, card } = createCard();

    updater.refresh(root as unknown as ParentNode, {});

    expect(card.children[".ccg-name"]?.textContent).toBe("New Teacher");
    expect(card.children[".ccg-subtitle"]?.textContent).toBe("Custom class · teacher candidate");
    expect(card.children[".ccg-quote"]?.textContent).toBe("");
    expect(card.children[".ccg-footer-content"]?.textContent).toBe("");
  });

  it("is a no-op without a root, roll, or candidate card", () => {
    const markdown = vi.fn();
    const updater = createTeacherPreviewUpdater({ renderMarkdownInto: markdown });

    expect(() => updater.refresh(null, { displayName: "Ruby" })).not.toThrow();
    expect(() => updater.refresh(new FakeElement("root") as unknown as ParentNode, null)).not.toThrow();
    expect(() => updater.refresh(new FakeElement("root") as unknown as ParentNode, { displayName: "Ruby" })).not.toThrow();
    expect(markdown).not.toHaveBeenCalled();
  });
});
