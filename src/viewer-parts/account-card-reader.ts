import type {
  AccountHallPassCardProfile,
  AccountHallPassCardReaderView,
} from "./client-pure.js";

export interface AccountCardReaderRendererDeps {
  document: Pick<Document, "createElement" | "addEventListener" | "removeEventListener"> & {
    body: HTMLElement;
  };
  cardBackArtUrl: string;
  cardProfile(card: unknown): AccountHallPassCardProfile | null;
  cardReaderView(
    card: unknown,
    opts: {
      authed: boolean;
      billingBusy: boolean;
      flip?: boolean;
      profile?: AccountHallPassCardProfile | null;
      revealed?: boolean;
    },
  ): AccountHallPassCardReaderView;
  cardArtUrl(card: unknown): string;
  appendSolanaProofLink(parent: HTMLElement, address: unknown, label: string): void;
  mintCard(cardId: unknown): Promise<unknown> | unknown;
  isAuthed(): boolean;
  isBillingBusy(): boolean;
}

export interface AccountCardReaderRenderer {
  show(card: unknown): void;
}

export function createAccountCardReaderRenderer(deps: AccountCardReaderRendererDeps): AccountCardReaderRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function appendStats(parent: HTMLElement, stats: AccountHallPassCardProfile["stats"]): void {
    if (!stats) return;
    const row = deps.document.createElement("div");
    row.className = "account-hall-pass-card-stats";
    [
      ["HEAD", stats.head],
      ["HEART", stats.heart],
      ["HONOR", stats.honor],
      ["HUSTLE", stats.hustle],
    ].forEach(([label, raw]) => {
      const value = Number(raw || 0);
      const stat = deps.document.createElement("div");
      stat.className = "account-hall-pass-card-stat" + (value < 0 ? " is-neg" : " is-pos");
      const text = deps.document.createElement("span");
      text.className = "account-hall-pass-card-stat-label";
      text.textContent = String(label) + " " + (value >= 0 ? "+" : "") + value;
      const dots = deps.document.createElement("span");
      dots.className = "account-hall-pass-card-dots";
      const filled = Math.max(0, Math.min(5, Math.round(value) + 2));
      for (let i = 0; i < 5; i += 1) {
        const dot = deps.document.createElement("i");
        if (i < filled) dot.className = "is-filled";
        dots.appendChild(dot);
      }
      stat.appendChild(text);
      stat.appendChild(dots);
      row.appendChild(stat);
    });
    parent.appendChild(row);
  }

  return {
    show(card: unknown): void {
      if (!card) return;
      let currentCard = card;
      const overlay = deps.document.createElement("div");
      overlay.className = "account-card-reader";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      const panel = deps.document.createElement("div");
      let closeButton: HTMLButtonElement | null = null;
      overlay.appendChild(panel);

      const remove = (): void => {
        deps.document.removeEventListener("keydown", onKey);
        overlay.remove();
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") remove();
      };
      const render = (nextCard?: unknown, opts?: { flip?: boolean; revealed?: boolean }): void => {
        currentCard = nextCard || currentCard;
        const options = opts || {};
        const profile = deps.cardProfile(currentCard);
        const view = deps.cardReaderView(currentCard, {
          authed: deps.isAuthed(),
          billingBusy: deps.isBillingBusy(),
          flip: options.flip,
          profile,
          revealed: options.revealed,
        });
        panel.className = view.panelClassName;
        panel.replaceChildren();

        const top = deps.document.createElement("div");
        top.className = "account-card-reader-top";
        const title = deps.document.createElement("div");
        title.className = "account-card-reader-title";
        title.textContent = view.title;
        const close = deps.document.createElement("button") as HTMLButtonElement;
        close.type = "button";
        close.className = "account-card-reader-close";
        close.setAttribute("aria-label", "Close card");
        close.textContent = "X";
        close.addEventListener("click", remove);
        closeButton = close;
        top.appendChild(title);
        top.appendChild(close);
        panel.appendChild(top);

        const main = deps.document.createElement("div");
        main.className = "account-card-reader-main";
        const artWrap = deps.document.createElement("div");
        artWrap.className = view.artClassName;
        const artUrl = view.faceDown ? deps.cardBackArtUrl : deps.cardArtUrl(currentCard);
        if (artUrl) {
          const img = deps.document.createElement("img");
          img.alt = view.artAlt;
          img.src = artUrl;
          artWrap.appendChild(img);
        } else {
          const fallback = deps.document.createElement("div");
          fallback.className = "account-card-reader-fallback";
          fallback.textContent = view.fallbackInitial;
          artWrap.appendChild(fallback);
        }
        main.appendChild(artWrap);

        const body = deps.document.createElement("div");
        body.className = "account-card-reader-body";
        const detail = deps.document.createElement("div");
        detail.className = "account-card-reader-detail";
        detail.textContent = view.detail;
        body.appendChild(detail);
        if (view.proofAddress) {
          deps.appendSolanaProofLink(body, view.proofAddress, "View Collectible on Solscan");
        }
        if (view.teachesVisible) {
          const teaches = deps.document.createElement("div");
          teaches.className = "account-hall-pass-card-teaches";
          const detailLabel = deps.document.createElement("span");
          detailLabel.textContent = view.teachesLabel;
          const detailText = deps.document.createElement("strong");
          detailText.textContent = view.teachesText;
          teaches.appendChild(detailLabel);
          teaches.appendChild(detailText);
          body.appendChild(teaches);
          appendStats(body, profile?.stats);
          if (view.quoteText) {
            const quote = deps.document.createElement("div");
            quote.className = "account-hall-pass-card-quote";
            quote.textContent = view.quoteText;
            body.appendChild(quote);
          }
        } else if (view.noteText) {
          const note = deps.document.createElement("div");
          note.className = "account-card-reader-note";
          note.textContent = view.noteText;
          body.appendChild(note);
        }

        const actions = deps.document.createElement("div");
        actions.className = "account-card-reader-actions";
        if (view.revealVisible) {
          const reveal = deps.document.createElement("button") as HTMLButtonElement;
          reveal.type = "button";
          reveal.className = "account-card-tile-reveal";
          reveal.textContent = view.revealText;
          reveal.disabled = view.revealDisabled;
          reveal.title = view.revealTitle;
          reveal.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            reveal.disabled = true;
            reveal.textContent = "Creating collectible...";
            panel.classList.add("is-minting");
            const revealedCard = await deps.mintCard(recordValue(currentCard, "id"));
            if (revealedCard) {
              render(revealedCard, { flip: true, revealed: true });
              return;
            }
            render(currentCard);
          });
          actions.appendChild(reveal);
        }
        if (actions.childElementCount > 0) body.appendChild(actions);
        main.appendChild(body);
        panel.appendChild(main);
      };
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) remove();
      });
      deps.document.addEventListener("keydown", onKey);
      deps.document.body.appendChild(overlay);
      render(currentCard);
      const focusTarget = closeButton as HTMLButtonElement | null;
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    },
  };
}
