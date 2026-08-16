import type {
  AccountHallPassCardsPanelView,
  AccountHallPassCardTileView,
  AccountHallPassPackTileView,
} from "./client-pure.js";

type LooseRecord = Record<string, unknown>;

export interface AccountHallPassCardsPanelRendererDeps {
  document: Pick<Document, "createElement">;
  container?: HTMLElement | null;
  summary?: HTMLElement | null;
  buyButton?: HTMLButtonElement | null;
  mintButton?: HTMLButtonElement | null;
  panelView(
    packs: unknown,
    cards: unknown,
    pendingMints: unknown,
    opts: {
      authed: boolean;
      billingBusy: boolean;
      billingMode: string;
      checkout: unknown;
      hasSolanaWallet: boolean;
    },
  ): AccountHallPassCardsPanelView;
  packTileView(
    pack: unknown,
    opts: { authed: boolean; billingBusy: boolean; walletReady: boolean },
  ): AccountHallPassPackTileView;
  cardTileView(card: unknown): AccountHallPassCardTileView;
  packArtUrl(kind: "active" | "opened"): string;
  cardArtUrl(card: unknown, faceDown: boolean): string;
  appendSolanaProofLink(parent: HTMLElement, address: unknown, label: string): void;
  ensureSolanaWallet(): void | Promise<void>;
  openPack(packId: unknown): void | Promise<void>;
  openCard(card: unknown): void;
}

export interface AccountHallPassCardsPanelRenderOptions {
  authed: boolean;
  billingBusy: boolean;
  billingMode: string;
  checkout: unknown;
  cards: unknown[];
  packs: unknown[];
  pendingMints: unknown[];
  hasSolanaWallet: boolean;
}

export interface AccountHallPassCardsPanelRenderer {
  render(opts: AccountHallPassCardsPanelRenderOptions): void;
  reset(): void;
}

export function createAccountHallPassCardsPanelRenderer(
  deps: AccountHallPassCardsPanelRendererDeps,
): AccountHallPassCardsPanelRenderer {
  let previousRenderSignature = "";

  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as LooseRecord)[key] : undefined;
  }

  function sortWalletItems(items: unknown[], limit: number): unknown[] {
    return items
      .filter((item) => item && typeof item === "object")
      .slice()
      .sort((a, b) => {
        const activeDelta = (recordValue(b, "status") === "active" ? 1 : 0) - (recordValue(a, "status") === "active" ? 1 : 0);
        if (activeDelta) return activeDelta;
        return Number(recordValue(b, "updatedAt") || recordValue(b, "issuedAt") || 0)
          - Number(recordValue(a, "updatedAt") || recordValue(a, "issuedAt") || 0);
      })
      .slice(0, limit);
  }

  function renderSignature(opts: AccountHallPassCardsPanelRenderOptions, shownPacks: unknown[], shownCards: unknown[]): string {
    return JSON.stringify({
      authed: !!opts.authed,
      billingBusy: !!opts.billingBusy,
      billingMode: opts.billingMode,
      hasSolanaWallet: !!opts.hasSolanaWallet,
      packs: shownPacks.map((pack) => [
        recordValue(pack, "id"),
        recordValue(pack, "assetAddress"),
        recordValue(pack, "mintSignature"),
        recordValue(pack, "status"),
        recordValue(pack, "packCount"),
        recordValue(pack, "cardCount"),
        recordValue(pack, "serial"),
        recordValue(pack, "issuedAt"),
        recordValue(pack, "updatedAt"),
      ]),
      cards: shownCards.map((card) => [
        recordValue(card, "id"),
        recordValue(card, "characterId"),
        recordValue(card, "characterName"),
        recordValue(card, "role"),
        recordValue(card, "rarity"),
        recordValue(card, "status"),
        recordValue(card, "serial"),
        recordValue(card, "mintAddress"),
        recordValue(card, "mintSignature"),
        recordValue(card, "issuedAt"),
        recordValue(card, "updatedAt"),
      ]),
    });
  }

  function appendEmpty(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "account-empty";
    empty.textContent = "No collectible packs or cards in this wallet yet.";
    parent.appendChild(empty);
  }

  function buildPack(pack: unknown, opts: AccountHallPassCardsPanelRenderOptions): HTMLElement {
    const view = deps.packTileView(pack, {
      authed: opts.authed,
      billingBusy: opts.billingBusy,
      walletReady: opts.hasSolanaWallet,
    });
    const item = deps.document.createElement("article");
    item.className = view.className;
    const img = deps.document.createElement("img");
    img.className = "account-pack-tile-art";
    img.alt = view.imageAlt;
    img.loading = "lazy";
    img.src = deps.packArtUrl(view.imageKind);
    item.appendChild(img);
    const meta = deps.document.createElement("div");
    meta.className = "account-pack-tile-meta";
    const copy = deps.document.createElement("div");
    copy.className = "account-pack-tile-copy";
    const title = deps.document.createElement("div");
    title.className = "account-pack-tile-title";
    title.textContent = view.title;
    const detail = deps.document.createElement("div");
    detail.className = "account-pack-tile-detail";
    detail.textContent = view.detail;
    copy.appendChild(title);
    copy.appendChild(detail);
    deps.appendSolanaProofLink(copy, recordValue(pack, "assetAddress"), view.proofLabel);
    meta.appendChild(copy);
    if (view.openVisible) {
      const open = deps.document.createElement("button");
      open.type = "button";
      open.className = "account-pack-tile-open";
      open.textContent = view.openText;
      open.disabled = view.openDisabled;
      open.title = view.openTitle;
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!view.walletReady) {
          void deps.ensureSolanaWallet();
          return;
        }
        void deps.openPack(recordValue(pack, "id"));
      });
      meta.appendChild(open);
    }
    item.appendChild(meta);
    return item;
  }

  function buildCard(card: unknown): HTMLElement {
    const view = deps.cardTileView(card);
    const item = deps.document.createElement("button");
    item.type = "button";
    item.className = view.className;
    item.setAttribute("aria-label", view.ariaLabel);
    const artUrl = deps.cardArtUrl(card, view.faceDown);
    if (artUrl) {
      const img = deps.document.createElement("img");
      img.className = "account-card-tile-art";
      img.alt = view.imageAlt;
      img.loading = "lazy";
      img.src = artUrl;
      item.appendChild(img);
    } else {
      const fallback = deps.document.createElement("div");
      fallback.className = "account-card-tile-fallback";
      fallback.textContent = view.fallbackInitial;
      item.appendChild(fallback);
    }
    const meta = deps.document.createElement("div");
    meta.className = "account-card-tile-meta";
    const title = deps.document.createElement("div");
    title.className = "account-card-tile-title";
    title.textContent = view.title;
    const detail = deps.document.createElement("div");
    detail.className = "account-card-tile-detail";
    detail.textContent = view.detail;
    meta.appendChild(title);
    meta.appendChild(detail);
    item.appendChild(meta);
    item.addEventListener("click", () => deps.openCard(card));
    return item;
  }

  return {
    render(opts: AccountHallPassCardsPanelRenderOptions): void {
      const container = deps.container;
      if (!container) return;
      const cards = Array.isArray(opts.cards) ? opts.cards : [];
      const packs = Array.isArray(opts.packs) ? opts.packs : [];
      const pendingMints = Array.isArray(opts.pendingMints) ? opts.pendingMints : [];
      const shownCards = sortWalletItems(cards, 24);
      const shownPacks = sortWalletItems(packs, 12);
      const view = deps.panelView(packs, cards, pendingMints, {
        authed: opts.authed,
        billingBusy: opts.billingBusy,
        billingMode: opts.billingMode,
        checkout: opts.checkout,
        hasSolanaWallet: opts.hasSolanaWallet,
      });
      if (deps.summary) {
        deps.summary.textContent = view.summaryText;
      }
      if (deps.buyButton) {
        deps.buyButton.disabled = view.buyDisabled;
        deps.buyButton.textContent = view.buyText;
        deps.buyButton.title = view.buyTitle;
      }
      if (deps.mintButton) {
        deps.mintButton.hidden = view.mintHidden;
        deps.mintButton.disabled = view.mintDisabled;
        deps.mintButton.textContent = view.mintText;
        deps.mintButton.title = view.mintTitle;
      }
      const nextSignature = renderSignature(opts, shownPacks, shownCards);
      if (nextSignature === previousRenderSignature && container.childElementCount > 0) return;
      previousRenderSignature = nextSignature;
      container.replaceChildren();
      if (shownPacks.length === 0 && shownCards.length === 0) {
        appendEmpty(container);
        return;
      }
      shownPacks.forEach((pack) => {
        container.appendChild(buildPack(pack, opts));
      });
      shownCards.forEach((card) => {
        container.appendChild(buildCard(card));
      });
    },
    reset(): void {
      previousRenderSignature = "";
    },
  };
}
