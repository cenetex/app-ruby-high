export interface ComicReaderOptions {
  reward?: boolean;
  onClose?: () => void;
}

export interface ComicReaderDeps {
  document: Pick<Document, "createElement" | "createTextNode" | "addEventListener" | "removeEventListener"> & { body: HTMLElement };
  pageTitle(pageNumber: unknown): string;
  pageUrl(pageNumber: number): string;
}

export interface ComicReaderRenderer {
  show(collection: unknown, unlock: unknown, options?: ComicReaderOptions): void;
}

export function createComicReaderRenderer(deps: ComicReaderDeps): ComicReaderRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  return {
    show(_collection, unlock, options): void {
      if (!unlock) return;
      const opts = options || {};
      const pageNumber = Math.max(1, Math.floor(Number(recordValue(unlock, "pageNumber") || 1)));
      const pageTitle = deps.pageTitle(pageNumber);
      const overlay = deps.document.createElement("div");
      overlay.className = "comic-reader" + (opts.reward ? " is-reward" : "");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", opts.reward ? "Comic page unlocked" : pageTitle);

      const panel = deps.document.createElement("div");
      panel.className = "comic-reader-panel";
      const top = deps.document.createElement("div");
      top.className = "comic-reader-top";
      const title = deps.document.createElement("div");
      title.className = "comic-reader-title";
      title.textContent = opts.reward ? "Comic Page Unlocked" : pageTitle;
      if (opts.reward) {
        const detail = deps.document.createElement("div");
        detail.className = "comic-reader-detail";
        detail.textContent = pageTitle;
        title.appendChild(deps.document.createTextNode(" "));
        title.appendChild(detail);
      }
      const close = deps.document.createElement("button");
      close.type = "button";
      close.className = "comic-reader-close";
      close.setAttribute("aria-label", "Close comic page");
      close.textContent = "X";
      top.appendChild(title);
      top.appendChild(close);
      panel.appendChild(top);

      const img = deps.document.createElement("img");
      img.alt = pageTitle;
      img.src = deps.pageUrl(pageNumber);
      panel.appendChild(img);
      overlay.appendChild(panel);

      let closed = false;
      const remove = () => {
        if (closed) return;
        closed = true;
        deps.document.removeEventListener("keydown", onKey);
        overlay.remove();
        if (typeof opts.onClose === "function") opts.onClose();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") remove();
      };
      close.addEventListener("click", remove);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) remove();
      });
      deps.document.addEventListener("keydown", onKey);
      deps.document.body.appendChild(overlay);
      close.focus({ preventScroll: true });
    },
  };
}
