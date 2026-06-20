import { describe, expect, it } from "vitest";
import { createComicReaderRenderer } from "../viewer-parts/comic-reader.js";

class FakeNode {
  textContent = "";
  parent: FakeElement | null = null;

  constructor(readonly tagName: string) {}
}

class FakeElement extends FakeNode {
  className = "";
  type = "";
  alt = "";
  src = "";
  focused = false;
  removed = false;
  attributes: Record<string, string> = {};
  children: FakeNode[] = [];
  listeners: Record<string, Array<(event: { target?: FakeElement; key?: string }) => void>> = {};

  appendChild(child: FakeNode): FakeNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: (event: { target?: FakeElement; key?: string }) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  remove(): void {
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }

  focus(): void {
    this.focused = true;
  }

  click(target: FakeElement = this): void {
    (this.listeners.click || []).forEach((listener) => listener({ target }));
  }
}

class FakeDocument {
  body = new FakeElement("body");
  listeners: Record<string, Array<(event: { key?: string }) => void>> = {};

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createTextNode(text: string): FakeNode {
    const node = new FakeNode("#text");
    node.textContent = text;
    return node;
  }

  addEventListener(name: string, listener: (event: { key?: string }) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  removeEventListener(name: string, listener: (event: { key?: string }) => void): void {
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== listener);
  }

  keydown(key: string): void {
    (this.listeners.keydown || []).forEach((listener) => listener({ key }));
  }
}

function textTree(node: FakeNode): string[] {
  const own = node.textContent ? [node.textContent] : [];
  return node instanceof FakeElement ? [...own, ...node.children.flatMap((child) => textTree(child))] : own;
}

describe("comic reader renderer", () => {
  it("shows reward comic unlocks as a modal dialog", () => {
    const document = new FakeDocument();
    const renderer = createComicReaderRenderer({
      document: document as unknown as Document & { body: HTMLElement },
      pageTitle: (pageNumber) => "Page " + pageNumber,
      pageUrl: (pageNumber) => "/comic/page-" + pageNumber + ".jpg",
    });

    renderer.show({ issueId: "first-bell" }, { pageNumber: 3 }, { reward: true });

    expect(document.body.children).toHaveLength(1);
    const overlay = document.body.children[0] as FakeElement;
    expect(overlay.className).toBe("comic-reader is-reward");
    expect(overlay.attributes).toMatchObject({
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Comic page unlocked",
    });
    const panel = overlay.children[0] as FakeElement;
    expect(panel.className).toBe("comic-reader-panel");
    expect(textTree(panel)).toEqual(["Comic Page Unlocked", " ", "Page 3", "X"]);
    const img = panel.children[1] as FakeElement;
    expect(img.tagName).toBe("img");
    expect(img.alt).toBe("Page 3");
    expect(img.src).toBe("/comic/page-3.jpg");
    const close = (panel.children[0] as FakeElement).children[1] as FakeElement;
    expect(close.focused).toBe(true);
  });

  it("closes once from the button and removes the Escape listener", () => {
    const document = new FakeDocument();
    let closed = 0;
    const renderer = createComicReaderRenderer({
      document: document as unknown as Document & { body: HTMLElement },
      pageTitle: (pageNumber) => "Page " + pageNumber,
      pageUrl: (pageNumber) => "/comic/page-" + pageNumber + ".jpg",
    });

    renderer.show({}, { pageNumber: 2 }, { onClose: () => { closed += 1; } });
    const overlay = document.body.children[0] as FakeElement;
    const close = (((overlay.children[0] as FakeElement).children[0] as FakeElement).children[1]) as FakeElement;

    close.click();
    close.click();

    expect(closed).toBe(1);
    expect(overlay.removed).toBe(true);
    expect(document.body.children).toEqual([]);
    expect(document.listeners.keydown).toEqual([]);
  });

  it("closes on backdrop click or Escape without closing panel clicks", () => {
    const document = new FakeDocument();
    let closed = 0;
    const renderer = createComicReaderRenderer({
      document: document as unknown as Document & { body: HTMLElement },
      pageTitle: (pageNumber) => "Page " + pageNumber,
      pageUrl: (pageNumber) => "/comic/page-" + pageNumber + ".jpg",
    });

    renderer.show({}, { pageNumber: 4 }, { onClose: () => { closed += 1; } });
    const overlay = document.body.children[0] as FakeElement;
    const panel = overlay.children[0] as FakeElement;
    overlay.click(panel);
    expect(closed).toBe(0);
    document.keydown("Escape");
    expect(closed).toBe(1);

    renderer.show({}, { pageNumber: 5 }, { onClose: () => { closed += 1; } });
    const secondOverlay = document.body.children[0] as FakeElement;
    secondOverlay.click();
    expect(closed).toBe(2);
  });

  it("ignores missing unlock payloads", () => {
    const document = new FakeDocument();
    const renderer = createComicReaderRenderer({
      document: document as unknown as Document & { body: HTMLElement },
      pageTitle: (pageNumber) => "Page " + pageNumber,
      pageUrl: (pageNumber) => "/comic/page-" + pageNumber + ".jpg",
    });

    renderer.show({}, null);

    expect(document.body.children).toEqual([]);
  });
});
