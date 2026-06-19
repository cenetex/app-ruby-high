import type { AccountTrustPanelView } from "./client-pure.js";

export interface AccountTrustPanelRendererDeps {
  document: Pick<Document, "createElement">;
  container?: HTMLElement | null;
}

export interface AccountTrustPanelRenderer {
  render(view: AccountTrustPanelView): void;
}

export function createAccountTrustPanelRenderer(deps: AccountTrustPanelRendererDeps): AccountTrustPanelRenderer {
  function appendRow(parent: HTMLElement, rowView: AccountTrustPanelView["rows"][number]): void {
    const row = deps.document.createElement("div");
    row.className = "account-trust-row";
    const key = deps.document.createElement("div");
    key.className = "account-trust-key";
    key.textContent = rowView.label;
    let value: HTMLElement;
    if (rowView.href) {
      const link = deps.document.createElement("a");
      link.href = rowView.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      value = link;
    } else {
      value = deps.document.createElement("div");
    }
    value.className = "account-trust-value";
    value.textContent = rowView.value || "Unavailable";
    row.appendChild(key);
    row.appendChild(value);
    parent.appendChild(row);
  }

  function appendNote(parent: HTMLElement, text: string): void {
    const note = deps.document.createElement("div");
    note.className = "account-trust-note";
    note.textContent = text;
    parent.appendChild(note);
  }

  return {
    render(view: AccountTrustPanelView): void {
      const container = deps.container;
      if (!container) return;
      container.replaceChildren();
      view.rows.forEach((row) => appendRow(container, row));
      appendNote(container, view.note);
    },
  };
}
