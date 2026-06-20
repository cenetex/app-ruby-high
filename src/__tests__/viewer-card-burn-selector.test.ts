import { describe, expect, it, vi } from "vitest";
import { createCardBurnSelector } from "../viewer-parts/card-burn-selector.js";

class FakeClassList {
  values = new Set<string>();

  toggle(name: string, force?: boolean): void {
    if (force === false) this.values.delete(name);
    else if (force === true || !this.values.has(name)) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  disabled = false;
  alt = "";
  src = "";
  hidden = false;
  isConnected = true;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  focused = false;
  classList = new FakeClassList();
  listeners: Record<string, Array<(event: FakeEvent) => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  removeEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== listener);
  }

  remove(): void {
    this.isConnected = false;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }

  focus(): void {
    this.focused = true;
  }

  click(target: FakeElement = this): FakeEvent {
    const event = new FakeEvent(target);
    (this.listeners.click || []).forEach((listener) => listener(event));
    return event;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "button") {
      if (this.tagName === "button") return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

class FakeEvent {
  defaultPrevented = false;

  constructor(readonly target: FakeElement, readonly key = "") {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

function createDocument(activeElement?: FakeElement | null) {
  const body = new FakeElement("body");
  const listeners: Record<string, Array<(event: FakeEvent) => void>> = {};
  return {
    body,
    activeElement: activeElement || null,
    listeners,
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
    addEventListener(name: string, listener: (event: FakeEvent) => void) {
      listeners[name] = [...(listeners[name] || []), listener];
    },
    removeEventListener(name: string, listener: (event: FakeEvent) => void) {
      listeners[name] = (listeners[name] || []).filter((item) => item !== listener);
    },
    dispatchKey(key: string) {
      const event = new FakeEvent(body, key);
      (listeners.keydown || []).forEach((listener) => listener(event));
      return event;
    },
  };
}

function makeSelector(doc: ReturnType<typeof createDocument>) {
  return createCardBurnSelector({
    document: doc as unknown as Document & { body: HTMLElement },
    setTimeout(fn) {
      fn();
      return 1;
    },
    cardArtUrl(card) {
      return "/cards/" + String((card as { id: string }).id) + ".png";
    },
    cardTitle(card) {
      return String((card as { characterName?: string; title?: string }).characterName || "Ruby High Card");
    },
    cardMeta(card) {
      return String((card as { title?: string }).title || "Collectible Card");
    },
  });
}

function parts(body: FakeElement) {
  const overlay = body.children[0]!;
  const panel = overlay.children[0]!;
  const grid = panel.children[3]!;
  const actions = panel.children[4]!;
  const cancel = actions.children[0]!;
  const confirm = actions.children[1]!;
  return { overlay, panel, grid, actions, cancel, confirm };
}

describe("card burn selector", () => {
  it("renders selectable card thumbnails and resolves the selected cards", async () => {
    const previousFocus = new FakeElement("button");
    const doc = createDocument(previousFocus);
    const selector = makeSelector(doc);
    const cards = [
      { id: "card-a", characterName: "Ruby", title: "Teacher Card" },
      { id: "card-b", characterName: "Noor", title: "Student Card" },
    ];

    const promise = selector.select(cards, 1);
    const { overlay, panel, grid, cancel, confirm } = parts(doc.body);

    expect(overlay.className).toBe("card-burn-overlay");
    expect(overlay.attributes).toMatchObject({ role: "dialog", "aria-modal": "true" });
    expect(panel.children[0]!.textContent).toBe("Choose card burn");
    expect(panel.children[1]!.textContent).toBe("Pick a card to burn");
    expect(panel.children[2]!.textContent).toBe("Each selected card leaves your wallet and credits 5 Hall Passes.");
    expect(grid.children.map((button) => button.dataset.cardId)).toEqual(["card-a", "card-b"]);
    expect(grid.children[0]!.children[0]!.children[0]!.src).toBe("/cards/card-a.png");
    expect(grid.children[0]!.children[1]!.children.map((child) => child.textContent)).toEqual(["Ruby", "Teacher Card"]);
    expect(cancel.textContent).toBe("Cancel");
    expect(confirm.textContent).toBe("Burn Card");
    expect(confirm.disabled).toBe(true);
    expect(grid.children[0]!.focused).toBe(true);

    grid.children[1]!.click();
    expect(grid.children[1]!.classList.contains("is-selected")).toBe(true);
    expect(grid.children[1]!.attributes["aria-pressed"]).toBe("true");
    expect(confirm.disabled).toBe(false);
    confirm.click();

    await expect(promise).resolves.toEqual([cards[1]]);
    expect(doc.body.children).toHaveLength(0);
    expect(doc.listeners.keydown).toHaveLength(0);
    expect(previousFocus.focused).toBe(true);
  });

  it("replaces the earliest selected card when the limit is reached", async () => {
    const doc = createDocument();
    const selector = makeSelector(doc);
    const cards = [
      { id: "card-a", characterName: "Ruby" },
      { id: "card-b", characterName: "Noor" },
      { id: "card-c", characterName: "Lyra" },
    ];

    const promise = selector.select(cards, 2);
    const { grid, confirm } = parts(doc.body);

    expect(confirm.textContent).toBe("Burn 2 Cards");
    grid.children[0]!.click();
    grid.children[1]!.click();
    expect(confirm.disabled).toBe(false);
    grid.children[2]!.click();

    expect(grid.children[0]!.classList.contains("is-selected")).toBe(false);
    expect(grid.children[0]!.attributes["aria-pressed"]).toBe("false");
    expect(grid.children[1]!.classList.contains("is-selected")).toBe(true);
    expect(grid.children[2]!.classList.contains("is-selected")).toBe(true);
    confirm.click();

    await expect(promise).resolves.toEqual([cards[1], cards[2]]);
  });

  it("resolves null for cancel, backdrop, Escape, and insufficient cards", async () => {
    const doc = createDocument();
    const selector = makeSelector(doc);

    await expect(selector.select([], 1)).resolves.toBeNull();

    const cancelPromise = selector.select([{ id: "card-a" }], 1);
    parts(doc.body).cancel.click();
    await expect(cancelPromise).resolves.toBeNull();

    const backdropPromise = selector.select([{ id: "card-b" }], 1);
    const backdrop = parts(doc.body).overlay;
    backdrop.click(backdrop);
    await expect(backdropPromise).resolves.toBeNull();

    const escapePromise = selector.select([{ id: "card-c" }], 1);
    const event = doc.dispatchKey("Escape");
    expect(event.defaultPrevented).toBe(true);
    await expect(escapePromise).resolves.toBeNull();
  });
});
