export interface YearbookShareActionsRendererDeps {
  document: Pick<Document, "createElement">;
  absoluteUrl(path: unknown): string;
  copyText(text: string): Promise<void>;
  openUrl(url: string): void;
  postMetric(name: string, payload: Record<string, string>): void;
  setTimeout(callback: () => void, ms: number): unknown;
}

export interface YearbookShareActionsRenderer {
  build(share: unknown): HTMLElement;
}

export function createYearbookShareActionsRenderer(
  deps: YearbookShareActionsRendererDeps,
): YearbookShareActionsRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function sharePayload(share: unknown): { shareId: string; grade: string } {
    return {
      shareId: String(recordValue(share, "shareId") || ""),
      grade: String(recordValue(share, "grade") || ""),
    };
  }

  function stopEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    build(share): HTMLElement {
      const actions = deps.document.createElement("div");
      actions.className = "paper-archive-actions";
      const url = deps.absoluteUrl(recordValue(share, "url"));
      const payload = sharePayload(share);

      const open = deps.document.createElement("button");
      open.type = "button";
      open.className = "paper-archive-action";
      open.textContent = "Open";
      open.title = "Open yearbook card";
      open.addEventListener("click", (event) => {
        stopEvent(event);
        deps.postMetric("yearbook_open", payload);
        deps.openUrl(url);
      });
      actions.appendChild(open);

      const copy = deps.document.createElement("button");
      copy.type = "button";
      copy.className = "paper-archive-action";
      copy.textContent = "Copy";
      copy.title = "Copy yearbook card link";
      copy.addEventListener("click", async (event) => {
        stopEvent(event);
        const original = copy.textContent || "";
        try {
          await deps.copyText(url);
          deps.postMetric("yearbook_copy", payload);
          deps.postMetric("share_initiated", { ...payload, destination: "copy", kind: "yearbook_card" });
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Failed";
        } finally {
          deps.setTimeout(() => { copy.textContent = original; }, 1200);
        }
      });
      actions.appendChild(copy);

      return actions;
    },
  };
}
