export interface CardBurnSelectorDeps {
  document: Pick<Document, "createElement" | "addEventListener" | "removeEventListener"> & {
    activeElement?: Element | null;
    body: HTMLElement;
  };
  setTimeout(fn: () => void, delayMs: number): unknown;
  cardArtUrl(card: unknown): string;
  cardTitle(card: unknown): string;
  cardMeta(card: unknown): string;
}

export interface CardBurnSelector {
  select(cards: unknown[], needed: number): Promise<unknown[] | null>;
}

export function createCardBurnSelector(deps: CardBurnSelectorDeps): CardBurnSelector {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function positiveCount(value: unknown): number {
    const count = Math.floor(Number(value || 1));
    return Number.isFinite(count) && count > 0 ? count : 1;
  }

  function cardId(card: unknown): string {
    return String(recordValue(card, "id") || "");
  }

  function isProtectedCard(card: unknown): boolean {
    const rarity = String(recordValue(card, "rarity") || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    return rarity === "rare" || rarity === "super-rare" || rarity === "ultra-rare";
  }

  function restoreFocus(previousFocus: Element | null): void {
    if (!previousFocus || !(previousFocus as Element & { isConnected?: boolean }).isConnected) return;
    const focusable = previousFocus as Element & { focus?: (opts?: { preventScroll?: boolean }) => void };
    if (typeof focusable.focus !== "function") return;
    try {
      focusable.focus({ preventScroll: true });
    } catch (_err) {
      try { focusable.focus(); } catch (_focusErr) {}
    }
  }

  return {
    select(cards: unknown[], needed: number): Promise<unknown[] | null> {
      const choices = Array.isArray(cards) ? cards.slice() : [];
      const count = positiveCount(needed);
      if (choices.length < count) return Promise.resolve(null);
      return new Promise((resolve) => {
        const previousFocus = deps.document.activeElement && typeof (deps.document.activeElement as HTMLElement).focus === "function"
          ? deps.document.activeElement
          : null;
        const selectedIds = new Set<string>();
        const buttonsById = new Map<string, HTMLElement>();
        const overlay = deps.document.createElement("div");
        overlay.className = "card-burn-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        const panel = deps.document.createElement("div");
        panel.className = "card-burn-panel";
        const kicker = deps.document.createElement("div");
        kicker.className = "card-burn-kicker";
        kicker.textContent = "Permanent action";
        const title = deps.document.createElement("h2");
        title.textContent = count === 1 ? "Choose a collectible card" : "Choose " + count + " collectible cards";
        const copy = deps.document.createElement("p");
        copy.textContent = "Each selected collectible card will be permanently destroyed. You will get 5 Hall Passes for each card.";
        const warning = deps.document.createElement("p");
        warning.className = "card-burn-warning";
        warning.textContent = "Warning: this selection includes a Rare, Super Rare, or Ultra Rare card. Every rarity gives the same 5 Hall Passes.";
        warning.hidden = true;
        const grid = deps.document.createElement("div");
        grid.className = "card-burn-grid";
        const actions = deps.document.createElement("div");
        actions.className = "card-burn-actions";
        const cancel = deps.document.createElement("button") as HTMLButtonElement;
        cancel.type = "button";
        cancel.className = "secondary";
        cancel.textContent = "Cancel";
        const confirm = deps.document.createElement("button") as HTMLButtonElement;
        confirm.type = "button";
        confirm.className = "primary";
        confirm.disabled = true;
        const normalConfirmText = count === 1 ? "Permanently Destroy Card" : "Permanently Destroy " + count + " Cards";
        confirm.textContent = normalConfirmText;
        let protectedConfirmArmed = false;

        function cleanup(result: unknown[] | null): void {
          deps.document.removeEventListener("keydown", onKeyDown);
          overlay.removeEventListener("click", onOverlayClick);
          overlay.remove();
          restoreFocus(previousFocus);
          resolve(result);
        }
        function updateConfirm(): void {
          confirm.disabled = selectedIds.size !== count;
          const hasProtectedCard = choices.some((card) => selectedIds.has(cardId(card)) && isProtectedCard(card));
          warning.hidden = !hasProtectedCard;
          confirm.classList.toggle("is-danger", hasProtectedCard);
          confirm.textContent = hasProtectedCard
            ? protectedConfirmArmed ? "Confirm Rare Card Destruction" : "Review Rare Card Destruction"
            : normalConfirmText;
        }
        function setButtonSelected(button: HTMLElement, selected: boolean): void {
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        function toggleCard(card: unknown, button: HTMLElement): void {
          protectedConfirmArmed = false;
          const id = cardId(card);
          if (selectedIds.has(id)) {
            selectedIds.delete(id);
            setButtonSelected(button, false);
          } else {
            if (selectedIds.size >= count) {
              const first = selectedIds.values().next().value;
              if (first) {
                selectedIds.delete(first);
                const firstButton = buttonsById.get(first);
                if (firstButton) setButtonSelected(firstButton, false);
              }
            }
            selectedIds.add(id);
            setButtonSelected(button, true);
          }
          updateConfirm();
        }
        function onOverlayClick(event: MouseEvent): void {
          if (event.target === overlay) cleanup(null);
        }
        function onKeyDown(event: KeyboardEvent): void {
          if (event.key === "Escape") {
            event.preventDefault();
            cleanup(null);
          }
        }

        choices.forEach((card) => {
          const id = cardId(card);
          const button = deps.document.createElement("button");
          button.type = "button";
          button.className = "card-burn-choice";
          button.dataset.cardId = id;
          button.setAttribute("aria-pressed", "false");
          buttonsById.set(id, button);
          const thumb = deps.document.createElement("span");
          thumb.className = "card-burn-thumb";
          const img = deps.document.createElement("img");
          img.alt = "";
          img.src = deps.cardArtUrl(card);
          thumb.appendChild(img);
          const text = deps.document.createElement("span");
          text.className = "card-burn-choice-text";
          const name = deps.document.createElement("strong");
          name.textContent = deps.cardTitle(card);
          const meta = deps.document.createElement("span");
          meta.textContent = deps.cardMeta(card);
          text.appendChild(name);
          text.appendChild(meta);
          button.appendChild(thumb);
          button.appendChild(text);
          button.addEventListener("click", () => toggleCard(card, button));
          grid.appendChild(button);
        });
        cancel.addEventListener("click", () => cleanup(null));
        confirm.addEventListener("click", () => {
          const hasProtectedCard = choices.some((card) => selectedIds.has(cardId(card)) && isProtectedCard(card));
          if (hasProtectedCard && !protectedConfirmArmed) {
            protectedConfirmArmed = true;
            updateConfirm();
            return;
          }
          const selected = choices.filter((card) => selectedIds.has(cardId(card))).slice(0, count);
          cleanup(selected.length === count ? selected : null);
        });
        actions.appendChild(cancel);
        actions.appendChild(confirm);
        panel.appendChild(kicker);
        panel.appendChild(title);
        panel.appendChild(copy);
        panel.appendChild(warning);
        panel.appendChild(grid);
        panel.appendChild(actions);
        overlay.appendChild(panel);
        deps.document.body.appendChild(overlay);
        overlay.addEventListener("click", onOverlayClick);
        deps.document.addEventListener("keydown", onKeyDown);
        deps.setTimeout(() => {
          const first = grid.querySelector("button") as HTMLElement | null;
          try {
            (first || cancel).focus({ preventScroll: true });
          } catch (_err) {
            (first || cancel).focus();
          }
        }, 0);
      });
    },
  };
}
