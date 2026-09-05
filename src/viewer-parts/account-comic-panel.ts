import type { AccountComicPanelView } from "./client-pure.js";

export interface AccountComicPanelRendererDeps {
  document: Pick<Document, "createElement">;
  container?: HTMLElement | null;
  summary?: HTMLElement | null;
  viewFor(collection: unknown): AccountComicPanelView;
  comicPageUrl(pageNumber: number): string;
  openReader(collection: unknown, unlock: unknown): void;
}

export interface AccountComicPanelRenderer {
  render(collection: unknown): void;
}

export function createAccountComicPanelRenderer(deps: AccountComicPanelRendererDeps): AccountComicPanelRenderer {
  let previousSignature = "";
  let currentCollection: unknown;

  function buildLocker(view: AccountComicPanelView): HTMLElement {
    const wrap = deps.document.createElement("div");
    wrap.className = "comic-locker";

    const head = deps.document.createElement("div");
    head.className = "comic-locker-head";
    const title = deps.document.createElement("div");
    title.className = "comic-locker-title";
    title.textContent = "First Bell Comic";
    const progress = deps.document.createElement("div");
    progress.className = "comic-locker-progress";
    progress.textContent = view.progressText;
    head.appendChild(title);
    head.appendChild(progress);
    wrap.appendChild(head);

    const grid = deps.document.createElement("div");
    grid.className = "comic-page-grid";
    view.tiles.forEach((tileView) => {
      const tile = deps.document.createElement("button");
      tile.type = "button";
      tile.className = "comic-page-tile" + (tileView.unlocked ? " is-unlocked" : " is-locked");
      tile.setAttribute("aria-label", tileView.ariaLabel);
      if (!tileView.unlocked) tile.disabled = true;

      if (tileView.unlocked) {
        const img = deps.document.createElement("img");
        img.loading = "lazy";
        img.alt = tileView.title;
        img.src = deps.comicPageUrl(tileView.pageNumber);
        tile.appendChild(img);
        tile.addEventListener("click", () => deps.openReader(currentCollection, tileView.unlock));
      } else {
        const mark = deps.document.createElement("span");
        mark.className = "comic-page-locked-mark";
        mark.textContent = "?";
        tile.appendChild(mark);
      }
      grid.appendChild(tile);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  return {
    render(collection: unknown): void {
      const container = deps.container;
      if (!container) return;
      currentCollection = collection;
      const view = deps.viewFor(collection);
      if (deps.summary) {
        deps.summary.textContent = view.summaryText;
      }
      const signature = JSON.stringify(view);
      if (signature === previousSignature && container.children.length > 0) return;
      previousSignature = signature;
      container.replaceChildren();
      container.appendChild(buildLocker(view));
    },
  };
}
