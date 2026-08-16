import { describe, expect, it, vi } from "vitest";
import { createTeacherCreationDeckRenderer } from "../viewer-parts/teacher-creation-deck.js";

class FakeClassList {
  readonly values = new Set<string>();

  add(name: string): void {
    this.values.add(name);
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  disabled = false;
  children: FakeElement[] = [];
  listeners: Record<string, Array<() => void>> = {};
  classList = new FakeClassList();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }

  dispatch(type: string): void {
    (this.listeners[type] || []).forEach((listener) => listener());
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".ccg-body") {
      return this.children.find((child) => child.className === "ccg-body") || null;
    }
    return null;
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

describe("teacher creation deck renderer", () => {
  it("builds the teacher candidate deck around the injected character card and controls", () => {
    const specs: unknown[] = [];
    const controls = new FakeElement("controls");
    controls.textContent = "controls";
    const renderer = createTeacherCreationDeckRenderer({
      document: createDocument(),
      buildCharacterCard(spec) {
        specs.push(spec);
        const card = new FakeElement("card");
        card.className = "ccg-card";
        const body = new FakeElement("div");
        body.className = "ccg-body";
        card.appendChild(body);
        return card as unknown as HTMLElement;
      },
    });
    const onSave = vi.fn();

    const deck = renderer.build({
      roll: {
        displayName: "Ruby",
        subject: "Homeroom",
        stats: { head: 1 },
        quote: "Begin.",
        description: "Warm and direct.",
      },
      portraitUrl: "/teacher.png",
      accent: "#d22a2a",
      importBusy: false,
      imageBusy: false,
      questionGenerationBusy: false,
      controls: controls as unknown as HTMLElement,
      onSave,
    }) as unknown as FakeElement;

    expect(specs).toEqual([{
      role: "teacher",
      name: "Ruby",
      subtitle: "Homeroom · teacher preview",
      portraitUrl: "/teacher.png",
      accent: "#d22a2a",
      stats: { head: 1 },
      quote: "Begin.",
      nextStepHint: "Add this teacher to the pack, then paste materials or generate questions.",
      footer: { title: "Teaching Style", content: "Warm and direct." },
    }]);
    expect(deck.className).toBe("pack-teacher-roll-deck");
    expect(deck.children[0]?.className).toBe("ccg-card");
    expect([...deck.children[0]!.classList.values]).toEqual(["is-creation-candidate-card"]);
    expect(deck.children[1]).toBe(controls);
    expect(textTree(deck)).toEqual(["Save", "controls"]);

    const save = deck.children[0]!.children[0]!.children[0]!.children[0] as FakeElement;
    expect(save.className).toBe("primary teacher-save-button");
    expect(save.disabled).toBe(false);
    save.dispatch("click");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables save with a helpful title while image generation is busy", () => {
    const renderer = createTeacherCreationDeckRenderer({
      document: createDocument(),
      buildCharacterCard() {
        const card = new FakeElement("card");
        const body = new FakeElement("div");
        body.className = "ccg-body";
        card.appendChild(body);
        return card as unknown as HTMLElement;
      },
    });

    const deck = renderer.build({
      roll: {},
      portraitUrl: "",
      accent: "",
      importBusy: false,
      imageBusy: true,
      questionGenerationBusy: false,
      controls: new FakeElement("controls") as unknown as HTMLElement,
      onSave: vi.fn(),
    }) as unknown as FakeElement;

    const save = deck.children[0]!.children[0]!.children[0]!.children[0] as FakeElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Cancel teacher image generation before saving.");
  });

  it("disables save while imports or question generation are busy", () => {
    const makeRenderer = () => createTeacherCreationDeckRenderer({
      document: createDocument(),
      buildCharacterCard() {
        const card = new FakeElement("card");
        const body = new FakeElement("div");
        body.className = "ccg-body";
        card.appendChild(body);
        return card as unknown as HTMLElement;
      },
    });

    for (const flags of [
      { importBusy: true, imageBusy: false, questionGenerationBusy: false },
      { importBusy: false, imageBusy: false, questionGenerationBusy: true },
    ]) {
      const deck = makeRenderer().build({
        roll: {},
        portraitUrl: "",
        accent: "",
        controls: new FakeElement("controls") as unknown as HTMLElement,
        onSave: vi.fn(),
        ...flags,
      }) as unknown as FakeElement;
      const save = deck.children[0]!.children[0]!.children[0]!.children[0] as FakeElement;
      expect(save.disabled).toBe(true);
    }
  });
});
