import type { AccountHistoryRowView } from "./client-pure.js";

export interface AccountHistoryPanelRendererDeps {
  document: Pick<Document, "createElement">;
  container?: HTMLElement | null;
  rowView(tx: unknown): AccountHistoryRowView;
}

export interface AccountHistoryPanelRenderOptions {
  limit?: number;
}

export interface AccountHistoryPanelRenderer {
  render(transactions: unknown, opts?: AccountHistoryPanelRenderOptions): void;
}

export function createAccountHistoryPanelRenderer(deps: AccountHistoryPanelRendererDeps): AccountHistoryPanelRenderer {
  function appendEmpty(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "account-empty";
    empty.textContent = "No wallet activity yet.";
    parent.appendChild(empty);
  }

  function appendRow(parent: HTMLElement, tx: unknown): void {
    const view = deps.rowView(tx);
    const row = deps.document.createElement("div");
    row.className = view.className;
    const main = deps.document.createElement("div");
    main.className = "account-history-main";
    const title = deps.document.createElement("div");
    title.className = "account-history-title";
    title.textContent = view.title;
    const meta = deps.document.createElement("div");
    meta.className = "account-history-meta";
    meta.textContent = view.meta;
    main.appendChild(title);
    main.appendChild(meta);
    const delta = deps.document.createElement("div");
    delta.className = "account-history-delta";
    delta.textContent = view.delta;
    row.appendChild(main);
    row.appendChild(delta);
    parent.appendChild(row);
  }

  return {
    render(transactions: unknown, opts?: AccountHistoryPanelRenderOptions): void {
      const container = deps.container;
      if (!container) return;
      const limit = Math.max(1, Math.floor(Number(opts?.limit || 18)));
      const rows = (Array.isArray(transactions) ? transactions.slice() : [])
        .sort((a, b) => Number((b && typeof b === "object" ? (b as { at?: unknown }).at : 0) || 0)
          - Number((a && typeof a === "object" ? (a as { at?: unknown }).at : 0) || 0))
        .slice(0, limit);
      container.replaceChildren();
      if (rows.length === 0) {
        appendEmpty(container);
        return;
      }
      rows.forEach((tx) => appendRow(container, tx));
    },
  };
}
