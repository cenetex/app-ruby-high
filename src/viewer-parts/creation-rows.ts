export interface CreationRowRefs {
  val: HTMLElement;
  reroll: HTMLButtonElement;
}

export interface CreationRowsRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface CreationRowsRenderer {
  buildRow(parent: HTMLElement, label: string, key: string): CreationRowRefs;
}

export function createCreationRowsRenderer(deps: CreationRowsRendererDeps): CreationRowsRenderer {
  return {
    buildRow(parent, label, key): CreationRowRefs {
      const row = deps.document.createElement("div");
      row.className = "creation-row";
      const lab = deps.document.createElement("div");
      lab.className = "creation-row-label";
      lab.textContent = label;
      const val = deps.document.createElement("div");
      val.className = "creation-row-value";
      val.dataset.key = key;
      const reroll = deps.document.createElement("button");
      reroll.type = "button";
      reroll.className = "creation-reroll";
      reroll.title = "Reroll " + label.toLowerCase();
      reroll.textContent = "\u21bb";
      reroll.dataset.key = key;
      row.appendChild(lab);
      row.appendChild(val);
      row.appendChild(reroll);
      parent.appendChild(row);
      return { val, reroll };
    },
  };
}
