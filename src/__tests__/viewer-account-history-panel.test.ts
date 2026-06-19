import { describe, expect, it } from "vitest";
import { createAccountHistoryPanelRenderer } from "../viewer-parts/account-history-panel.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("account history panel renderer", () => {
  it("sorts recent transactions, renders typed rows, and applies the limit", () => {
    const container = new FakeElement("div");
    const renderer = createAccountHistoryPanelRenderer({
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName) as unknown as HTMLElement;
        },
      },
      container: container as unknown as HTMLElement,
      rowView(tx: unknown) {
        const record = tx as { id: string };
        return {
          className: "account-history-row is-" + record.id,
          title: "Title " + record.id,
          meta: "Meta " + record.id,
          delta: "+" + record.id,
        };
      },
    });

    renderer.render([
      { id: "old", at: 10 },
      { id: "new", at: 30 },
      { id: "middle", at: 20 },
    ], { limit: 2 });

    expect(container.children.map((child) => child.className)).toEqual([
      "account-history-row is-new",
      "account-history-row is-middle",
    ]);
    expect(textTree(container)).toEqual([
      "Title new",
      "Meta new",
      "+new",
      "Title middle",
      "Meta middle",
      "+middle",
    ]);
  });

  it("renders the empty wallet activity state", () => {
    const container = new FakeElement("div");
    const renderer = createAccountHistoryPanelRenderer({
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName) as unknown as HTMLElement;
        },
      },
      container: container as unknown as HTMLElement,
      rowView() {
        throw new Error("rowView should not be called for empty history");
      },
    });

    renderer.render([]);

    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.className).toBe("account-empty");
    expect(container.children[0]!.textContent).toBe("No wallet activity yet.");
  });

  it("ignores missing containers", () => {
    const renderer = createAccountHistoryPanelRenderer({
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName) as unknown as HTMLElement;
        },
      },
      container: null,
      rowView() {
        throw new Error("rowView should not be called without a container");
      },
    });

    expect(() => renderer.render([{ id: "tx", at: 1 }])).not.toThrow();
  });
});
