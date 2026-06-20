import { describe, expect, it, vi } from "vitest";
import { createTeacherRollControlsRenderer } from "../viewer-parts/teacher-roll-controls.js";

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  value = "";
  placeholder = "";
  maxLength = 0;
  rows = 0;
  disabled = false;
  nodeType = 1;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }

  dispatch(type: string): void {
    (this.listeners[type] || []).forEach((listener) => listener());
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

function createRenderer() {
  return createTeacherRollControlsRenderer({
    document: createDocument(),
    assets: [
      { id: "ruby", name: "Ruby" },
      { id: "sally-science", name: "Sally" },
    ],
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    roll: {
      displayName: "Ruby",
      subject: "Homeroom",
      description: "Warm but exacting.",
      quote: "Bell rings.",
      assetTeacherId: "ruby",
    },
    importBusy: false,
    imageBusy: false,
    imageStatus: "",
    imageInvalid: false,
    imageReason: "",
    imageCreditHint: "1 Hall Pass",
    statsNode: new FakeElement("stats") as unknown as HTMLElement,
    onFieldInput: vi.fn(),
    onReroll: vi.fn(),
    onChooseImage: vi.fn(),
    onGenerateImage: vi.fn(),
    onCancelImage: vi.fn(),
    ...overrides,
  };
}

describe("teacher roll controls renderer", () => {
  it("renders teacher roll fields, presets, stats, and reroll controls", () => {
    const renderer = createRenderer();
    const input = baseInput();

    const card = renderer.build(input) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-career-card is-creation-control-card");
    expect(textTree(card)).toEqual([
      "roll",
      "Teacher Roll",
      "Start with a pregenerated Ruby High teacher, then reroll the parts that should change.",
      "Name",
      "↻",
      "Class",
      "↻",
      "Image",
      "Ruby",
      "Sally",
      "Custom",
      "Stats",
      "↻",
      "Style",
      "Quote",
      "↻",
    ]);

    const fields = (card.children[1] as FakeElement).children[2] as FakeElement;
    const nameInput = fields.children[0]!.children[1]!.children[0] as FakeElement;
    expect(nameInput.tagName).toBe("input");
    expect(nameInput.value).toBe("Ruby");
    expect(nameInput.maxLength).toBe(64);
    nameInput.value = "Professor Ruby";
    nameInput.dispatch("input");
    expect(input.onFieldInput).toHaveBeenCalledWith("displayName", "Professor Ruby");

    const classReroll = fields.children[1]!.children[2] as FakeElement;
    classReroll.dispatch("click");
    expect(input.onReroll).toHaveBeenCalledWith("style");

    const imageChoices = fields.children[2]!.children[1]!.children[0] as FakeElement;
    expect(imageChoices.children.map((child) => child.className)).toEqual([
      "teacher-image-preset is-selected",
      "teacher-image-preset",
      "teacher-image-preset",
    ]);
    imageChoices.children[1]!.dispatch("click");
    expect(input.onChooseImage).toHaveBeenCalledWith("sally-science");
  });

  it("renders custom image generation state and cancel action", () => {
    const renderer = createRenderer();
    const input = baseInput({
      roll: {
        displayName: "Custom",
        subject: "Dream Studies",
        imageChoice: "custom",
        profileImageUrl: "data:image/png;base64,teacher",
      },
      imageBusy: true,
      imageStatus: "Teacher image ready.",
    });

    const card = renderer.build(input) as unknown as FakeElement;
    const fields = (card.children[1] as FakeElement).children[2] as FakeElement;
    const custom = fields.children[2]!.children[1]!.children[1] as FakeElement;
    const generate = custom.children[0] as FakeElement;
    const cancel = custom.children[1] as FakeElement;

    expect(generate.className).toBe("secondary teacher-custom-generate is-loading");
    expect(generate.dataset.requiresOpenrouter).toBe("teacher-image");
    expect(generate.attributes["aria-busy"]).toBe("true");
    expect(generate.disabled).toBe(true);
    expect(textTree(custom)).toEqual([
      "Generating",
      "Cancel generation",
      "Keep editing while the image generates. Save and Close unlock after it finishes or you cancel.",
    ]);

    cancel.dispatch("click");
    expect(input.onCancelImage).toHaveBeenCalledTimes(1);
  });

  it("shows custom image validation reasons and disables all controls while importing", () => {
    const renderer = createRenderer();
    const input = baseInput({
      importBusy: true,
      imageReason: "Unlock OpenRouter first.",
      imageStatus: "Bad URL",
      imageInvalid: true,
      roll: { imageChoice: "custom" },
    });

    const card = renderer.build(input) as unknown as FakeElement;
    const fields = (card.children[1] as FakeElement).children[2] as FakeElement;
    const nameInput = fields.children[0]!.children[1]!.children[0] as FakeElement;
    const nameReroll = fields.children[0]!.children[2] as FakeElement;
    const custom = fields.children[2]!.children[1]!.children[1] as FakeElement;
    const generate = custom.children[0] as FakeElement;
    const status = custom.children[2] as FakeElement;

    expect(nameInput.disabled).toBe(true);
    expect(nameReroll.disabled).toBe(true);
    expect(generate.disabled).toBe(true);
    expect(generate.title).toBe("Unlock OpenRouter first.");
    expect(status.className).toBe("creation-portrait-status is-invalid");
    expect(status.textContent).toBe("Bad URL");
  });
});
