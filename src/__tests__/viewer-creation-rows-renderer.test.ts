import { describe, expect, it } from "vitest";
import { createCreationRowsRenderer } from "../viewer-parts/creation-rows.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  title = "";
  type = "";

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

describe("creation rows renderer", () => {
  it("builds reroll rows with stable label/value/button refs", () => {
    const renderer = createCreationRowsRenderer({ document: createDocument() });
    const parent = new FakeElement("div");

    const refs = renderer.buildRow(parent as unknown as HTMLElement, "Playbook", "playbook");

    expect(parent.children).toHaveLength(1);
    const row = parent.children[0]!;
    expect(row.className).toBe("creation-row");
    expect(refs.row).toBe(row as unknown as HTMLElement);
    expect(textTree(parent)).toEqual(["Playbook", "\u21bb"]);
    expect(row.children.map((child) => child.className)).toEqual([
      "creation-row-label",
      "creation-row-value",
      "creation-reroll",
    ]);
    expect(refs.val).toBe(row.children[1] as unknown as HTMLElement);
    expect(refs.reroll).toBe(row.children[2] as unknown as HTMLButtonElement);
    expect((refs.val as unknown as FakeElement).dataset.key).toBe("playbook");
    expect((refs.reroll as unknown as FakeElement).dataset.key).toBe("playbook");
    expect((refs.reroll as unknown as FakeElement).type).toBe("button");
    expect((refs.reroll as unknown as FakeElement).title).toBe("Try another playbook");
    expect((refs.reroll as unknown as FakeElement).attributes["aria-label"]).toBe("Try another playbook");
  });

  it("appends multiple rows without replacing existing controls", () => {
    const renderer = createCreationRowsRenderer({ document: createDocument() });
    const parent = new FakeElement("div");

    renderer.buildRow(parent as unknown as HTMLElement, "Name", "name");
    renderer.buildRow(parent as unknown as HTMLElement, "Voice", "personality");

    expect(parent.children).toHaveLength(2);
    expect(textTree(parent)).toEqual(["Name", "\u21bb", "Voice", "\u21bb"]);
    expect(parent.children[0]?.children[1]?.dataset.key).toBe("name");
    expect(parent.children[1]?.children[1]?.dataset.key).toBe("personality");
  });
});
