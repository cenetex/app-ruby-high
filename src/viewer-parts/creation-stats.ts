export interface CreationStatsRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface CreationStatsRenderer {
  renderInto(parent: HTMLElement, stats: unknown): void;
}

export function createCreationStatsRenderer(deps: CreationStatsRendererDeps): CreationStatsRenderer {
  function statValue(stats: unknown, key: string): number {
    const raw = stats && typeof stats === "object" ? (stats as Record<string, unknown>)[key] : 0;
    return Number(raw || 0);
  }

  function formatStat(n: number): string {
    return (n >= 0 ? "+" : "") + n;
  }

  return {
    renderInto(parent, stats): void {
      parent.replaceChildren();
      ["head", "heart", "hustle", "honor"].forEach((key) => {
        const wrap = deps.document.createElement("span");
        wrap.className = "stat";
        const label = deps.document.createElement("span");
        label.className = "k";
        label.textContent = key;
        const value = deps.document.createElement("span");
        const n = statValue(stats, key);
        value.className = "v" + (n > 0 ? " pos" : n < 0 ? " neg" : "");
        value.textContent = formatStat(n);
        wrap.appendChild(label);
        wrap.appendChild(value);
        parent.appendChild(wrap);
      });
    },
  };
}
