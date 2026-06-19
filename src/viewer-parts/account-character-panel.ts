import type {
  AccountCharacterCardView,
  AccountCharacterPanelView,
  AccountEmptyCharacterSlotView,
} from "./client-pure.js";

export interface AccountCharacterPanelRendererDeps {
  document: Pick<Document, "createElement">;
  grid?: HTMLElement | null;
  summary?: HTMLElement | null;
  createButton?: HTMLButtonElement | null;
  unlockButton?: HTMLButtonElement | null;
  panelView(
    slots: unknown,
    wallet: unknown,
    opts: {
      authed: boolean;
      billingBusy: boolean;
      entryCount: number;
      hasActiveCharacter: boolean;
    },
  ): AccountCharacterPanelView;
  cardView(
    entry: unknown,
    slotNumber: number,
    playbooks: unknown,
    currentGrade: unknown,
    fallbackPortraitUrl: unknown,
  ): AccountCharacterCardView;
  emptySlotView(slotNumber: number, canCreateCharacter: boolean): AccountEmptyCharacterSlotView;
  fallbackPortraitFor(playbookId: string): string;
  openActiveCharacter(): void;
  openCharacterCreation(): void;
}

export interface AccountCharacterPanelRenderOptions {
  authed: boolean;
  billingBusy: boolean;
  slots: unknown;
  wallet: unknown;
  entries: unknown[];
  hasActiveCharacter: boolean;
  playbooks: unknown;
  currentGrade: unknown;
}

export interface AccountCharacterPanelRenderer {
  render(opts: AccountCharacterPanelRenderOptions): void;
}

export function createAccountCharacterPanelRenderer(
  deps: AccountCharacterPanelRendererDeps,
): AccountCharacterPanelRenderer {
  function characterForEntry(entry: unknown): { playbookId?: unknown } {
    if (!entry || typeof entry !== "object") return {};
    const character = (entry as { character?: unknown }).character;
    return character && typeof character === "object" ? character as { playbookId?: unknown } : {};
  }

  function appendCardCopy(card: HTMLElement, view: Pick<AccountCharacterCardView, "name" | "meta">): void {
    const copy = deps.document.createElement("span");
    copy.className = "account-character-copy";
    const name = deps.document.createElement("span");
    name.className = "account-character-name";
    name.textContent = view.name;
    const meta = deps.document.createElement("span");
    meta.className = "account-character-meta";
    meta.textContent = view.meta;
    copy.appendChild(name);
    copy.appendChild(meta);
    card.appendChild(copy);
  }

  function buildCharacterCard(entry: unknown, slotNumber: number, opts: AccountCharacterPanelRenderOptions): HTMLElement {
    const character = characterForEntry(entry);
    const view = deps.cardView(
      entry,
      slotNumber,
      opts.playbooks,
      opts.currentGrade,
      deps.fallbackPortraitFor(String(character.playbookId || "")),
    );
    const card = deps.document.createElement("button");
    card.type = "button";
    card.className = view.className;
    card.style.setProperty("--account-character-accent", view.accent);
    const portrait = deps.document.createElement("span");
    portrait.className = "account-character-portrait";
    if (view.portraitUrl) {
      const img = deps.document.createElement("img");
      img.alt = "";
      img.src = view.portraitUrl;
      portrait.appendChild(img);
    } else {
      portrait.textContent = view.portraitInitial;
    }
    card.appendChild(portrait);
    appendCardCopy(card, view);
    card.addEventListener("click", () => {
      if (view.isActive) deps.openActiveCharacter();
    });
    return card;
  }

  function buildEmptySlot(slotNumber: number, canCreateCharacter: boolean): HTMLElement {
    const view = deps.emptySlotView(slotNumber, canCreateCharacter);
    const card = deps.document.createElement(view.tagName);
    if (view.type) (card as HTMLButtonElement).type = view.type;
    card.className = view.className;
    const portrait = deps.document.createElement("span");
    portrait.className = "account-character-portrait";
    portrait.textContent = "+";
    card.appendChild(portrait);
    appendCardCopy(card, view);
    if (view.canCreate) card.addEventListener("click", deps.openCharacterCreation);
    return card;
  }

  function appendEmptyState(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "account-empty";
    empty.textContent = "Roll your first student to start filling your account.";
    parent.appendChild(empty);
  }

  return {
    render(opts: AccountCharacterPanelRenderOptions): void {
      const grid = deps.grid;
      if (!grid) return;
      const entries = Array.isArray(opts.entries) ? opts.entries : [];
      const view = deps.panelView(opts.slots, opts.wallet, {
        authed: opts.authed,
        billingBusy: opts.billingBusy,
        entryCount: entries.length,
        hasActiveCharacter: opts.hasActiveCharacter,
      });
      if (deps.summary) {
        deps.summary.textContent = view.summaryText;
      }
      if (deps.createButton) {
        deps.createButton.hidden = view.createHidden;
        deps.createButton.disabled = view.createDisabled;
      }
      if (deps.unlockButton) {
        deps.unlockButton.textContent = view.unlockText;
        deps.unlockButton.disabled = view.unlockDisabled;
        deps.unlockButton.title = view.unlockTitle;
      }
      grid.replaceChildren();
      entries.forEach((entry, idx) => {
        grid.appendChild(buildCharacterCard(entry, idx + 1, opts));
      });
      for (let i = 0; i < view.emptySlots; i++) {
        grid.appendChild(buildEmptySlot(entries.length + i + 1, view.canCreateCharacter));
      }
      if (entries.length === 0 && view.emptySlots === 0) {
        appendEmptyState(grid);
      }
    },
  };
}
