export interface PackMintProgressControllerDeps {
  document: Pick<Document, "createElement"> & {
    body: HTMLElement & { contains(node: Node): boolean };
  };
  defaultLines: string[];
  setInterval(fn: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PackMintProgressShowOptions {
  title?: string;
  rotate?: boolean;
  lines?: string[];
}

export interface PackMintProgressController {
  show(message?: string, options?: PackMintProgressShowOptions): void;
  update(message?: string): void;
  hide(delayMs?: number): void;
}

export function createPackMintProgressController(deps: PackMintProgressControllerDeps): PackMintProgressController {
  let overlayEl: HTMLElement | null = null;
  let titleEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let rotateTimer: unknown = null;
  let closeTimer: unknown = null;
  let lineIndex = 0;

  function defaultStatusLines(): string[] {
    return deps.defaultLines.length > 0 ? deps.defaultLines : ["Preparing your collectible pack..."];
  }

  function ensureOverlay(): HTMLElement {
    if (overlayEl && deps.document.body.contains(overlayEl)) return overlayEl;
    const overlay = deps.document.createElement("div");
    overlay.className = "pack-mint-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-hidden", "true");

    const panel = deps.document.createElement("div");
    panel.className = "pack-mint-panel";
    const spinner = deps.document.createElement("div");
    spinner.className = "pack-mint-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const copy = deps.document.createElement("div");
    copy.className = "pack-mint-copy";
    const title = deps.document.createElement("div");
    title.className = "pack-mint-title";
    title.textContent = "Creating your collectible pack";
    const status = deps.document.createElement("div");
    status.className = "pack-mint-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = defaultStatusLines()[0] || "";
    copy.appendChild(title);
    copy.appendChild(status);
    panel.appendChild(spinner);
    panel.appendChild(copy);
    overlay.appendChild(panel);
    deps.document.body.appendChild(overlay);
    overlayEl = overlay;
    titleEl = title;
    statusEl = status;
    return overlay;
  }

  function clearRotateTimer(): void {
    if (rotateTimer) {
      deps.clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  function clearCloseTimer(): void {
    if (closeTimer) {
      deps.clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function update(message?: string): void {
    if (!statusEl) return;
    const text = String(message || "").trim();
    if (text) statusEl.textContent = text;
  }

  function close(): void {
    clearRotateTimer();
    if (!overlayEl) return;
    overlayEl.classList.remove("is-open");
    overlayEl.setAttribute("aria-hidden", "true");
  }

  return {
    show(message?: string, options?: PackMintProgressShowOptions): void {
      const overlay = ensureOverlay();
      clearCloseTimer();
      const title = options?.title ? String(options.title) : "Creating your collectible pack";
      const rotate = !options || options.rotate !== false;
      const lines = Array.isArray(options?.lines) && options.lines.length > 0
        ? options.lines
        : defaultStatusLines();
      if (titleEl) titleEl.textContent = title;
      lineIndex = 0;
      update(message || lines[0]);
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      clearRotateTimer();
      if (rotate) {
        rotateTimer = deps.setInterval(() => {
          lineIndex = (lineIndex + 1) % lines.length;
          update(lines[lineIndex]);
        }, 1600);
      }
    },
    update,
    hide(delayMs?: number): void {
      clearCloseTimer();
      const delay = Math.max(0, Math.floor(Number(delayMs || 0)));
      if (delay > 0) {
        closeTimer = deps.setTimeout(() => {
          closeTimer = null;
          close();
        }, delay);
        return;
      }
      closeTimer = null;
      close();
    },
  };
}
