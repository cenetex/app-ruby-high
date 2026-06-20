import { describe, expect, it } from "vitest";
import { createAccountHallPassCardsPanelRenderer } from "../viewer-parts/account-hall-pass-cards-panel.js";
import type {
  AccountHallPassCardsPanelView,
  AccountHallPassCardTileView,
  AccountHallPassPackTileView,
} from "../viewer-parts/client-pure.js";

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  hidden = false;
  disabled = false;
  title = "";
  alt = "";
  loading = "";
  src = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners: Record<string, Array<(event: FakeEvent) => void>> = {};

  constructor(readonly tagName: string) {}

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): FakeEvent {
    const event = new FakeEvent();
    (this.listeners.click || []).forEach((listener) => listener(event));
    return event;
  }
}

class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function panelView(overrides?: Partial<AccountHallPassCardsPanelView>): AccountHallPassCardsPanelView {
  return {
    summaryText: "1 active pack · 1 active card",
    buyText: "Buy Card Packs",
    buyTitle: "Buy Ruby High card packs.",
    buyDisabled: false,
    mintHidden: false,
    mintDisabled: false,
    mintText: "Reveal Card",
    mintTitle: "Mint the next face-down Ruby High Card to reveal it.",
    needsWalletConnection: false,
    ...overrides,
  };
}

function packView(pack: unknown, overrides?: Partial<AccountHallPassPackTileView>): AccountHallPassPackTileView {
  const record = pack as { status?: string; id?: string };
  const active = record.status !== "opened";
  return {
    className: "account-pack-tile is-" + (record.status || "active"),
    status: record.status || "active",
    packCount: 1,
    cardCount: 5,
    imageAlt: active ? "Ruby High Pack" : "Opened Ruby High Pack",
    imageKind: active ? "active" : "opened",
    title: active ? "Pack " + record.id : "Opened " + record.id,
    detail: "5 cards",
    proofLabel: active ? "View Solana pack" : "Pack proof",
    openVisible: active,
    openText: "Open Pack",
    openDisabled: false,
    openTitle: "Open this Ruby High pack and create its Cards.",
    walletReady: true,
    ...overrides,
  };
}

function cardView(card: unknown, overrides?: Partial<AccountHallPassCardTileView>): AccountHallPassCardTileView {
  const record = card as { characterName?: string; faceDown?: boolean };
  const faceDown = !!record.faceDown;
  return {
    className: "account-card-tile is-active" + (faceDown ? " is-face-down" : ""),
    faceDown,
    title: faceDown ? "Mystery Card" : record.characterName || "Ruby",
    detail: faceDown ? "Face-down Card" : "In-app Card",
    ariaLabel: "Open " + (faceDown ? "Mystery Card" : record.characterName || "Ruby"),
    imageAlt: faceDown ? "Face-down Ruby High card" : (record.characterName || "Ruby") + " Ruby High card",
    fallbackInitial: String(record.characterName || "R").slice(0, 1),
    ...overrides,
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("account Hall Pass cards panel renderer", () => {
  it("renders controls, sorted pack/card tiles, and delegates tile actions", () => {
    const container = new FakeElement("div");
    const summary = new FakeElement("div");
    const buyButton = new FakeElement("button");
    const mintButton = new FakeElement("button");
    const calls = {
      proof: [] as unknown[][],
      wallet: 0,
      openPack: [] as unknown[],
      openCard: [] as unknown[],
    };
    const activePack = { id: "active-pack", status: "active", assetAddress: "asset-active", updatedAt: 30 };
    const openedPack = { id: "opened-pack", status: "opened", assetAddress: "asset-opened", updatedAt: 40 };
    const shownCard = { id: "card-new", characterName: "Ruby", status: "active", updatedAt: 20 };
    const olderCard = { id: "card-old", characterName: "Sally", status: "burned", updatedAt: 90 };
    const renderer = createAccountHallPassCardsPanelRenderer({
      document: createDocument(),
      container: container as unknown as HTMLElement,
      summary: summary as unknown as HTMLElement,
      buyButton: buyButton as unknown as HTMLButtonElement,
      mintButton: mintButton as unknown as HTMLButtonElement,
      panelView(packs, cards, pendingMints, opts) {
        expect(packs).toEqual([openedPack, activePack]);
        expect(cards).toEqual([olderCard, shownCard]);
        expect(pendingMints).toEqual([{ id: "pending" }]);
        expect(opts).toEqual({
          authed: true,
          billingBusy: false,
          billingMode: "card-packs",
          checkout: { ready: true },
          hasSolanaWallet: true,
        });
        return panelView();
      },
      packTileView(pack, opts) {
        expect(opts).toMatchObject({ authed: true, billingBusy: false, walletReady: true });
        return packView(pack);
      },
      cardTileView: cardView,
      packArtUrl(kind) {
        return "/assets/" + kind + "-pack.png";
      },
      cardArtUrl(card, faceDown) {
        return faceDown ? "/assets/card-back.png" : "/assets/" + String((card as { id: string }).id) + ".png";
      },
      appendSolanaProofLink(parent, address, label) {
        calls.proof.push([parent.className, address, label]);
      },
      ensureSolanaWallet() {
        calls.wallet += 1;
      },
      openPack(packId) {
        calls.openPack.push(packId);
      },
      openCard(card) {
        calls.openCard.push(card);
      },
    });

    renderer.render({
      authed: true,
      billingBusy: false,
      billingMode: "card-packs",
      checkout: { ready: true },
      cards: [olderCard, shownCard],
      packs: [openedPack, activePack],
      pendingMints: [{ id: "pending" }],
      hasSolanaWallet: true,
    });

    expect(summary.textContent).toBe("1 active pack · 1 active card");
    expect(buyButton.textContent).toBe("Buy Card Packs");
    expect(buyButton.disabled).toBe(false);
    expect(buyButton.title).toBe("Buy Ruby High card packs.");
    expect(mintButton.hidden).toBe(false);
    expect(mintButton.textContent).toBe("Reveal Card");
    expect(container.children.map((child) => child.className)).toEqual([
      "account-pack-tile is-active",
      "account-pack-tile is-opened",
      "account-card-tile is-active",
      "account-card-tile is-active",
    ]);
    expect(textTree(container)).toEqual([
      "Pack active-pack",
      "5 cards",
      "Open Pack",
      "Opened opened-pack",
      "5 cards",
      "Ruby",
      "In-app Card",
      "Sally",
      "In-app Card",
    ]);
    expect(calls.proof).toEqual([
      ["account-pack-tile-copy", "asset-active", "View Solana pack"],
      ["account-pack-tile-copy", "asset-opened", "Pack proof"],
    ]);
    expect(container.children[0]!.children[1]!.children[1]!.click()).toMatchObject({
      defaultPrevented: true,
      propagationStopped: true,
    });
    expect(calls.openPack).toEqual(["active-pack"]);
    container.children[2]!.click();
    expect(calls.openCard).toEqual([shownCard]);
  });

  it("connects a wallet before opening active packs when the wallet is missing", () => {
    const container = new FakeElement("div");
    let walletCalls = 0;
    let opened = 0;
    const renderer = createAccountHallPassCardsPanelRenderer({
      document: createDocument(),
      container: container as unknown as HTMLElement,
      panelView: () => panelView(),
      packTileView: (pack, opts) => packView(pack, { walletReady: opts.walletReady }),
      cardTileView: cardView,
      packArtUrl: (kind) => "/assets/" + kind + "-pack.png",
      cardArtUrl: () => "",
      appendSolanaProofLink() {},
      ensureSolanaWallet() {
        walletCalls += 1;
      },
      openPack() {
        opened += 1;
      },
      openCard() {},
    });

    renderer.render({
      authed: true,
      billingBusy: false,
      billingMode: "card-packs",
      checkout: {},
      cards: [],
      packs: [{ id: "pack", status: "active", updatedAt: 1 }],
      pendingMints: [],
      hasSolanaWallet: false,
    });

    container.children[0]!.children[1]!.children[1]!.click();
    expect(walletCalls).toBe(1);
    expect(opened).toBe(0);
  });

  it("renders fallback art, empty state, and skips identical rerenders until reset", () => {
    const container = new FakeElement("div");
    let panelCalls = 0;
    const renderer = createAccountHallPassCardsPanelRenderer({
      document: createDocument(),
      container: container as unknown as HTMLElement,
      panelView: () => {
        panelCalls += 1;
        return panelView({ summaryText: "No packs or Cards in this wallet yet." });
      },
      packTileView: packView,
      cardTileView: (card) => cardView(card, { faceDown: false }),
      packArtUrl: (kind) => "/assets/" + kind + "-pack.png",
      cardArtUrl: () => "",
      appendSolanaProofLink() {},
      ensureSolanaWallet() {},
      openPack() {},
      openCard() {},
    });
    const opts = {
      authed: true,
      billingBusy: false,
      billingMode: "card-packs",
      checkout: {},
      cards: [{ id: "card", characterName: "Noor", status: "active", updatedAt: 1 }],
      packs: [] as unknown[],
      pendingMints: [] as unknown[],
      hasSolanaWallet: true,
    };

    renderer.render(opts);
    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.children[0]!.className).toBe("account-card-tile-fallback");
    expect(container.children[0]!.children[0]!.textContent).toBe("N");
    renderer.render(opts);
    expect(panelCalls).toBe(2);
    expect(container.children).toHaveLength(1);
    renderer.reset();
    renderer.render({ ...opts, cards: [] });
    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.className).toBe("account-empty");
    expect(container.children[0]!.textContent).toBe("No packs or Cards in this wallet yet.");
  });

  it("ignores missing containers", () => {
    const renderer = createAccountHallPassCardsPanelRenderer({
      document: createDocument(),
      container: null,
      panelView() {
        throw new Error("panelView should not be called without a container");
      },
      packTileView: packView,
      cardTileView: cardView,
      packArtUrl: () => "",
      cardArtUrl: () => "",
      appendSolanaProofLink() {},
      ensureSolanaWallet() {},
      openPack() {},
      openCard() {},
    });

    expect(() => renderer.render({
      authed: true,
      billingBusy: false,
      billingMode: "card-packs",
      checkout: {},
      cards: [],
      packs: [],
      pendingMints: [],
      hasSolanaWallet: true,
    })).not.toThrow();
  });
});
