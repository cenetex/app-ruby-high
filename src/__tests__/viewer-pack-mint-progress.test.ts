import { describe, expect, it, vi } from "vitest";
import { createPackMintProgressController } from "../viewer-parts/pack-mint-progress.js";

class FakeClassList {
  values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  className = "";
  textContent = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  classList = new FakeClassList();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
}

function createDocument() {
  const body = new FakeElement("body");
  return {
    body,
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function overlayParts(body: FakeElement) {
  const overlay = body.children[0]!;
  const panel = overlay.children[0]!;
  const spinner = panel.children[0]!;
  const copy = panel.children[1]!;
  const title = copy.children[0]!;
  const status = copy.children[1]!;
  return { overlay, panel, spinner, copy, title, status };
}

describe("pack mint progress controller", () => {
  it("creates the accessible overlay, opens it, and rotates status lines", () => {
    const doc = createDocument();
    const intervalFns: Array<() => void> = [];
    const controller = createPackMintProgressController({
      document: doc as unknown as Document & { body: HTMLElement & { contains(node: Node): boolean } },
      defaultLines: ["Checking ledger", "Printing wrapper"],
      setInterval(fn) {
        intervalFns.push(fn);
        return { kind: "interval", index: intervalFns.length - 1 };
      },
      clearInterval: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });

    controller.show();
    const { overlay, panel, spinner, copy, title, status } = overlayParts(doc.body);

    expect(overlay.className).toBe("pack-mint-overlay");
    expect(overlay.attributes).toMatchObject({
      role: "dialog",
      "aria-modal": "true",
      "aria-hidden": "false",
    });
    expect(overlay.classList.contains("is-open")).toBe(true);
    expect(panel.className).toBe("pack-mint-panel");
    expect(spinner.className).toBe("pack-mint-spinner");
    expect(spinner.attributes["aria-hidden"]).toBe("true");
    expect(copy.className).toBe("pack-mint-copy");
    expect(title.textContent).toBe("Creating your collectible pack");
    expect(status.className).toBe("pack-mint-status");
    expect(status.attributes["aria-live"]).toBe("polite");
    expect(status.textContent).toBe("Checking ledger");

    intervalFns[0]!();
    expect(status.textContent).toBe("Printing wrapper");
    intervalFns[0]!();
    expect(status.textContent).toBe("Checking ledger");
  });

  it("updates existing overlays, honors custom card copy, and skips rotation when requested", () => {
    const doc = createDocument();
    const setInterval = vi.fn();
    const clearInterval = vi.fn();
    const controller = createPackMintProgressController({
      document: doc as unknown as Document & { body: HTMLElement & { contains(node: Node): boolean } },
      defaultLines: ["Pack line"],
      setInterval,
      clearInterval,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });

    controller.show("Minting card on Solana...", {
      title: "Please wait: minting card",
      rotate: false,
      lines: ["Preparing card", "Submitting card"],
    });
    controller.update("Review the mint transaction in your wallet...");
    const firstOverlay = doc.body.children[0]!;
    const { overlay, title, status } = overlayParts(doc.body);

    expect(overlay).toBe(firstOverlay);
    expect(title.textContent).toBe("Please wait: minting card");
    expect(status.textContent).toBe("Review the mint transaction in your wallet...");
    expect(setInterval).not.toHaveBeenCalled();

    controller.show("Submitting mint to Solana...");
    expect(doc.body.children[0]).toBe(firstOverlay);
    expect(status.textContent).toBe("Submitting mint to Solana...");
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(clearInterval).not.toHaveBeenCalled();
  });

  it("hides immediately, delays closing, and cancels pending delayed closes on reopen", () => {
    const doc = createDocument();
    const timeouts: Array<() => void> = [];
    const clearTimeout = vi.fn();
    const clearInterval = vi.fn();
    const controller = createPackMintProgressController({
      document: doc as unknown as Document & { body: HTMLElement & { contains(node: Node): boolean } },
      defaultLines: ["Pack line"],
      setInterval: vi.fn(() => "interval"),
      clearInterval,
      setTimeout(fn) {
        timeouts.push(fn);
        return "timeout-" + timeouts.length;
      },
      clearTimeout,
    });

    controller.show("Minting...");
    const { overlay } = overlayParts(doc.body);
    controller.hide(900);
    expect(overlay.classList.contains("is-open")).toBe(true);
    expect(clearInterval).not.toHaveBeenCalled();

    controller.show("Still minting...");
    expect(clearTimeout).toHaveBeenCalledWith("timeout-1");
    expect(overlay.classList.contains("is-open")).toBe(true);

    timeouts[0]!();
    expect(overlay.classList.contains("is-open")).toBe(false);
    expect(overlay.attributes["aria-hidden"]).toBe("true");
    expect(clearInterval).toHaveBeenCalledWith("interval");

    controller.show("Done");
    controller.hide();
    expect(overlay.classList.contains("is-open")).toBe(false);
    expect(overlay.attributes["aria-hidden"]).toBe("true");
  });
});
