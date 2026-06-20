import { describe, expect, it } from "vitest";
import { createYearbookShareActionsRenderer } from "../viewer-parts/yearbook-share-actions.js";

class FakeEvent {
  prevented = false;
  stopped = false;

  preventDefault(): void {
    this.prevented = true;
  }

  stopPropagation(): void {
    this.stopped = true;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  children: FakeElement[] = [];
  listeners: Record<string, Array<(event: FakeEvent) => void | Promise<void>>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void | Promise<void>): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  async click(): Promise<FakeEvent> {
    const event = new FakeEvent();
    for (const listener of this.listeners.click || []) {
      await listener(event);
    }
    return event;
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

describe("yearbook share actions renderer", () => {
  it("renders open/copy actions and opens the absolute yearbook URL", async () => {
    const opened: string[] = [];
    const metrics: Array<{ name: string; payload: Record<string, string> }> = [];
    const renderer = createYearbookShareActionsRenderer({
      document: createDocument(),
      absoluteUrl: (path) => "https://ruby.test" + String(path),
      copyText: async () => {},
      openUrl: (url) => opened.push(url),
      postMetric: (name, payload) => metrics.push({ name, payload }),
      setTimeout: () => 0,
    });

    const actions = renderer.build({ url: "/yearbook/share-1/9", shareId: "share-1", grade: "9" }) as unknown as FakeElement;

    expect(actions.className).toBe("paper-archive-actions");
    expect(actions.children.map((child) => [child.tagName, child.type, child.className, child.textContent, child.title])).toEqual([
      ["button", "button", "paper-archive-action", "Open", "Open yearbook card"],
      ["button", "button", "paper-archive-action", "Copy", "Copy yearbook card link"],
    ]);
    const event = await actions.children[0]!.click();

    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(opened).toEqual(["https://ruby.test/yearbook/share-1/9"]);
    expect(metrics).toEqual([
      { name: "yearbook_open", payload: { shareId: "share-1", grade: "9" } },
    ]);
  });

  it("copies the URL, records share metrics, and restores the button label", async () => {
    const copied: string[] = [];
    const metrics: Array<{ name: string; payload: Record<string, string> }> = [];
    const timeouts: Array<() => void> = [];
    const renderer = createYearbookShareActionsRenderer({
      document: createDocument(),
      absoluteUrl: (path) => String(path),
      copyText: async (url) => { copied.push(url); },
      openUrl: () => {},
      postMetric: (name, payload) => metrics.push({ name, payload }),
      setTimeout: (callback) => {
        timeouts.push(callback);
        return 1;
      },
    });
    const actions = renderer.build({ url: "/yb/abc/12", shareId: "abc", grade: "12" }) as unknown as FakeElement;
    const copy = actions.children[1]!;

    const event = await copy.click();

    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(copied).toEqual(["/yb/abc/12"]);
    expect(copy.textContent).toBe("Copied");
    expect(metrics).toEqual([
      { name: "yearbook_copy", payload: { shareId: "abc", grade: "12" } },
      { name: "share_initiated", payload: { shareId: "abc", grade: "12", destination: "copy", kind: "yearbook_card" } },
    ]);
    expect(timeouts).toHaveLength(1);
    timeouts[0]!();
    expect(copy.textContent).toBe("Copy");
  });

  it("shows copy failure without recording copy metrics", async () => {
    const metrics: string[] = [];
    const renderer = createYearbookShareActionsRenderer({
      document: createDocument(),
      absoluteUrl: (path) => String(path || ""),
      copyText: async () => {
        throw new Error("copy failed");
      },
      openUrl: () => {},
      postMetric: (name) => metrics.push(name),
      setTimeout: () => 0,
    });
    const actions = renderer.build({}) as unknown as FakeElement;
    const copy = actions.children[1]!;

    await copy.click();

    expect(copy.textContent).toBe("Failed");
    expect(metrics).toEqual([]);
  });
});
