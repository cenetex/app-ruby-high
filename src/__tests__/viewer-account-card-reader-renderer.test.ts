import { describe, expect, it, vi } from "vitest";
import { createAccountCardReaderRenderer } from "../viewer-parts/account-card-reader.js";
import type {
  AccountHallPassCardProfile,
  AccountHallPassCardReaderView,
} from "../viewer-parts/client-pure.js";

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
  disabled = false;
  title = "";
  alt = "";
  src = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  focused = false;
  removed = false;
  classList = new FakeClassList();
  listeners: Record<string, Array<(event: FakeEvent) => void | Promise<void>>> = {};

  constructor(readonly tagName: string) {}

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void | Promise<void>): void {
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

  async click(target: FakeElement = this): Promise<FakeEvent> {
    const event = new FakeEvent(target);
    for (const listener of this.listeners.click || []) {
      await listener(event);
    }
    return event;
  }
}

class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;

  constructor(readonly target: FakeElement, readonly key = "") {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
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

function readerView(overrides?: Partial<AccountHallPassCardReaderView>): AccountHallPassCardReaderView {
  return {
    panelClassName: "account-card-reader-panel",
    artClassName: "account-card-reader-art",
    faceDown: false,
    title: "Ruby",
    detail: "On-chain Card",
    artAlt: "Ruby",
    fallbackInitial: "R",
    proofAddress: "mint-abc",
    teachesVisible: true,
    teachesLabel: "TEACHES",
    teachesText: "Homeroom",
    quoteText: "\"Let's learn.\"",
    noteText: "",
    revealVisible: false,
    revealText: "Mint to Reveal",
    revealDisabled: false,
    revealTitle: "Mint this Card with your Solana wallet to reveal it.",
    ...overrides,
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("account card reader renderer", () => {
  it("renders revealed profile cards and closes from button, backdrop, and Escape", async () => {
    const doc = createDocument();
    const proofCalls: unknown[][] = [];
    const renderer = createAccountCardReaderRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      cardBackArtUrl: "/card-back.png",
      cardProfile: () => ({
        subtitle: "Homeroom Teacher",
        teaches: "Homeroom",
        stats: { head: 1, heart: 3, honor: 2, hustle: -1 },
        quote: "Let's learn.",
      }),
      cardReaderView: () => readerView(),
      cardArtUrl: () => "/ruby.png",
      appendSolanaProofLink(parent, address, label) {
        proofCalls.push([parent.className, address, label]);
      },
      mintCard: vi.fn(),
      isAuthed: () => true,
      isBillingBusy: () => false,
    });

    renderer.show({ id: "card-1", characterId: "ruby" });
    const overlay = doc.body.children[0]!;
    const panel = overlay.children[0]!;
    const close = panel.children[0]!.children[1]!;

    expect(overlay.className).toBe("account-card-reader");
    expect(overlay.attributes).toMatchObject({ role: "dialog", "aria-modal": "true" });
    expect(panel.className).toBe("account-card-reader-panel");
    expect(close.focused).toBe(true);
    expect(textTree(panel)).toContain("Ruby");
    expect(textTree(panel)).toContain("HEAD +1");
    expect(textTree(panel)).toContain("HUSTLE -1");
    expect(proofCalls).toEqual([["account-card-reader-body", "mint-abc", "View Collectible on Solscan"]]);

    await close.click();
    expect(doc.body.children).toHaveLength(0);
    expect(doc.listeners.keydown).toHaveLength(0);

    renderer.show({ id: "card-2" });
    await doc.body.children[0]!.click(doc.body.children[0]!);
    expect(doc.body.children).toHaveLength(0);

    renderer.show({ id: "card-3" });
    doc.dispatchKey("Escape");
    expect(doc.body.children).toHaveLength(0);
  });

  it("renders face-down cards and re-renders after mint", async () => {
    const doc = createDocument();
    const views: AccountHallPassCardReaderView[] = [
      readerView({
        faceDown: true,
        title: "Mystery Card",
        detail: "Face-down Card",
        artAlt: "Face-down Ruby High card",
        proofAddress: "",
        teachesVisible: false,
        noteText: "Mint this Card to reveal the character.",
        revealVisible: true,
      }),
      readerView({
        panelClassName: "account-card-reader-panel is-revealed",
        artClassName: "account-card-reader-art is-flipped",
        title: "Noor",
        detail: "In-app Card",
        proofAddress: "",
        teachesVisible: true,
      }),
    ];
    let viewIndex = 0;
    const cardReaderView = vi.fn((_card: unknown, opts: { profile?: AccountHallPassCardProfile | null }) => {
      expect(opts.profile).toMatchObject({ teaches: "Classmate" });
      const view = views[Math.min(viewIndex, views.length - 1)]!;
      viewIndex += 1;
      return view;
    });
    const mintCard = vi.fn(async () => ({ id: "revealed-card", characterId: "noor", characterName: "Noor" }));
    const renderer = createAccountCardReaderRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      cardBackArtUrl: "/card-back.png",
      cardProfile: () => ({ subtitle: "Sophomore", teaches: "Classmate" }),
      cardReaderView,
      cardArtUrl: () => "",
      appendSolanaProofLink: vi.fn(),
      mintCard,
      isAuthed: () => true,
      isBillingBusy: () => false,
    });

    renderer.show({ id: "face-down-card", characterId: "card-back" });
    const panel = doc.body.children[0]!.children[0]!;
    const art = panel.children[1]!.children[0]!;
    const reveal = panel.children[1]!.children[1]!.children[2]!.children[0]!;

    expect(art.children[0]!.tagName).toBe("img");
    expect(art.children[0]!.src).toBe("/card-back.png");
    expect(textTree(panel)).toContain("Mint this Card to reveal the character.");

    const event = await reveal.click();
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(mintCard).toHaveBeenCalledWith("face-down-card");
    expect(panel.classList.contains("is-minting")).toBe(true);
    expect(panel.className).toBe("account-card-reader-panel is-revealed");
    expect(textTree(panel)).toContain("Noor");
    expect(panel.children[1]!.children[0]!.className).toBe("account-card-reader-art is-flipped");
  });

  it("uses fallback art for revealed cards without an art URL", () => {
    const doc = createDocument();
    const renderer = createAccountCardReaderRenderer({
      document: doc as unknown as Document & { body: HTMLElement },
      cardBackArtUrl: "/card-back.png",
      cardProfile: () => null,
      cardReaderView: () => readerView({
        proofAddress: "",
        teachesVisible: false,
        quoteText: "",
        fallbackInitial: "L",
      }),
      cardArtUrl: () => "",
      appendSolanaProofLink: vi.fn(),
      mintCard: vi.fn(),
      isAuthed: () => true,
      isBillingBusy: () => false,
    });

    renderer.show({ id: "card", characterName: "Library Card" });
    const fallback = doc.body.children[0]!.children[0]!.children[1]!.children[0]!.children[0]!;
    expect(fallback.className).toBe("account-card-reader-fallback");
    expect(fallback.textContent).toBe("L");
  });
});
