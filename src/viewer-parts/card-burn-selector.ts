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
        kicker.textContent = "Choose card burn";
        const title = deps.document.createElement("h2");
        title.textContent = count === 1 ? "Pick a card to burn" : "Pick " + count + " cards to burn";
        const copy = deps.document.createElement("p");
        copy.textContent = "Each selected card leaves your wallet and credits 5 Hall Passes.";
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
        confirm.textContent = count === 1 ? "Burn Card" : "Burn " + count + " Cards";

        function cleanup(result: unknown[] | null): void {
          deps.document.removeEventListener("keydown", onKeyDown);
          overlay.removeEventListener("click", onOverlayClick);
          overlay.remove();
          restoreFocus(previousFocus);
          resolve(result);
        }
        function updateConfirm(): void {
          confirm.disabled = selectedIds.size !== count;
        }
        function setButtonSelected(button: HTMLElement, selected: boolean): void {
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        function toggleCard(card: unknown, button: HTMLElement): void {
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
          const selected = choices.filter((card) => selectedIds.has(cardId(card))).slice(0, count);
          cleanup(selected.length === count ? selected : null);
        });
        actions.appendChild(cancel);
        actions.appendChild(confirm);
        panel.appendChild(kicker);
        panel.appendChild(title);
        panel.appendChild(copy);
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
