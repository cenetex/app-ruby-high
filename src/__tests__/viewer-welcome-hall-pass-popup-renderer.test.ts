import { describe, expect, it, vi } from "vitest";
import { createWelcomeHallPassPopupRenderer } from "../viewer-parts/welcome-hall-pass-popup.js";
import type { WelcomeHallPassPopupView } from "../viewer-parts/client-pure.js";

class FakeClassList {
  values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  alt = "";
  src = "";
  hidden = false;
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
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

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }

  click(target: FakeElement = this): FakeEvent {
    const event = new FakeEvent(target);
    (this.listeners.click || []).forEach((listener) => listener(event));
    return event;
  }

  dispatch(name: string): FakeEvent {
    const event = new FakeEvent(this);
    (this.listeners[name] || []).forEach((listener) => listener(event));
    return event;
  }
}

class FakeEvent {
  constructor(readonly target: FakeElement, readonly key = "") {}
}

function createDocument() {
  const body = new FakeElement("body");
  const listeners: Record<string, Array<(event: FakeEvent) => void>> = {};
  return {
    body,
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
    },
  };
}

function view(overrides?: Partial<WelcomeHallPassPopupView>): WelcomeHallPassPopupView {
  return {
    titleText: "5 Hall Passes added",
    bodyText: "Roll your first student now.",
    showLater: true,
    primaryText: "Create Character",
    ...overrides,
  };
}

function parts(body: FakeElement) {
  const overlay = body.children[0]!;
  const panel = overlay.children[0]!;
  const art = panel.children[0]!;
  const copy = panel.children[1]!;
  const title = copy.children[0]!;
  const text = copy.children[1]!;
  const actions = copy.children[2]!;
  return { overlay, panel, art, copy, title, text, actions };
}

describe("welcome Hall Pass popup renderer", () => {
  it("renders the starter popup, handles art load, and closes with Later", () => {
    const doc = createDocument();
    const grant = { at: 123, amount: 5 };
    const calls = {
      opened: [] as boolean[],
      seen: [] as unknown[],
      account: 0,
      create: 0,
    };
    const renderer = createWelcomeHallPassPopupRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      artUrl: "/welcome.png",
      viewFor(input, opts) {
        expect(input).toBe(grant);
        expect(opts).toEqual({ fromBilling: false, portraitConfigured: true, hasCharacter: false });
        return view();
      },
      portraitConfigured: () => true,
      hasCharacter: () => false,
      markSeen(input) {
        calls.seen.push(input);
      },
      setOpen(open) {
        calls.opened.push(open);
      },
      openAccount() {
        calls.account += 1;
      },
      openCharacterCreation() {
        calls.create += 1;
      },
    });

    renderer.show(grant);
    const { overlay, panel, art, title, text, actions } = parts(doc.body);

    expect(overlay.className).toBe("welcome-hall-pass-popup");
    expect(overlay.attributes).toMatchObject({ role: "dialog", "aria-modal": "true" });
    expect(panel.className).toBe("welcome-hall-pass-panel");
    expect(art.className).toBe("welcome-hall-pass-art");
    expect(art.hidden).toBe(true);
    expect(art.src).toBe("/welcome.png");
    art.dispatch("load");
    expect(art.hidden).toBe(false);
    expect(panel.classList.contains("has-art")).toBe(true);
    expect(title.textContent).toBe("5 Hall Passes added");
    expect(text.textContent).toBe("Roll your first student now.");
    expect(actions.children.map((child) => child.textContent)).toEqual(["Later", "Create Character"]);

    actions.children[0]!.click();
    expect(doc.body.children).toHaveLength(0);
    expect(doc.listeners.keydown).toHaveLength(0);
    expect(calls.opened).toEqual([true, false]);
    expect(calls.seen).toEqual([grant]);
    expect(calls.account).toBe(0);
    expect(calls.create).toBe(0);
  });

  it("routes primary actions and omits Later for billing claims", () => {
    const doc = createDocument();
    let accountCalls = 0;
    let createCalls = 0;
    const renderer = createWelcomeHallPassPopupRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      artUrl: "/welcome.png",
      viewFor: (_grant, opts) => view({
        showLater: !opts.fromBilling,
        primaryText: opts.fromBilling ? "Continue" : opts.hasCharacter ? "Open Account" : "Create Character",
      }),
      portraitConfigured: () => false,
      hasCharacter: () => true,
      markSeen: vi.fn(),
      setOpen: vi.fn(),
      openAccount() {
        accountCalls += 1;
      },
      openCharacterCreation() {
        createCalls += 1;
      },
    });

    renderer.show({ at: 1 });
    parts(doc.body).actions.children[1]!.click();
    expect(accountCalls).toBe(1);
    expect(createCalls).toBe(0);
    expect(doc.body.children).toHaveLength(0);

    renderer.show({ at: 2 }, { source: "billing" });
    const billing = parts(doc.body);
    expect(billing.actions.children.map((child) => child.textContent)).toEqual(["Continue"]);
    billing.actions.children[0]!.click();
    expect(accountCalls).toBe(1);
    expect(createCalls).toBe(0);
    expect(doc.body.children).toHaveLength(0);
  });

  it("closes from Escape and backdrop and removes broken art", () => {
    const doc = createDocument();
    const markSeen = vi.fn();
    const renderer = createWelcomeHallPassPopupRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      artUrl: "/welcome.png",
      viewFor: () => view(),
      portraitConfigured: () => false,
      hasCharacter: () => false,
      markSeen,
      setOpen: vi.fn(),
      openAccount: vi.fn(),
      openCharacterCreation: vi.fn(),
    });

    renderer.show({ at: 1 });
    const first = parts(doc.body);
    first.art.dispatch("error");
    expect(first.panel.children[0]).toBe(first.copy);
    doc.dispatchKey("Escape");
    expect(doc.body.children).toHaveLength(0);
    expect(markSeen).toHaveBeenCalledTimes(1);

    renderer.show({ at: 2 });
    const second = parts(doc.body);
    second.overlay.click(second.overlay);
    expect(doc.body.children).toHaveLength(0);
    expect(markSeen).toHaveBeenCalledTimes(2);
  });
});
