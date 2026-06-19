import { describe, expect, it } from "vitest";
import { createAccountComicPanelRenderer } from "../viewer-parts/account-comic-panel.js";
import type { AccountComicPanelView } from "../viewer-parts/client-pure.js";

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  disabled = false;
  loading = "";
  alt = "";
  src = "";
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners: Record<string, Array<() => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener());
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function comicView(): AccountComicPanelView {
  return {
    issueId: "first-bell",
    title: "Ruby High: Book One - First Bell",
    pageCount: 3,
    unlockedCount: 1,
    summaryText: "1/3 pages found",
    progressText: "1/3 pages",
    tiles: [
      {
        pageNumber: 1,
        title: "Ruby High: Book One - First Bell",
        unlocked: false,
        ariaLabel: "Comic page 1 locked",
        unlock: null,
      },
      {
        pageNumber: 2,
        title: "First-Day Survival Kit",
        unlocked: true,
        ariaLabel: "Open First-Day Survival Kit",
        unlock: { pageNumber: 2, pageId: "first-bell-page-02" },
      },
      {
        pageNumber: 3,
        title: "Smoke Test",
        unlocked: false,
        ariaLabel: "Comic page 3 locked",
        unlock: null,
      },
    ],
  };
}

describe("account comic panel renderer", () => {
  it("renders the account comic locker and opens unlocked pages", () => {
    const container = new FakeElement("div");
    const summary = new FakeElement("div");
    const collection = { issueId: "first-bell" };
    const opened: unknown[] = [];
    const renderer = createAccountComicPanelRenderer({
      document: createDocument(),
      container: container as unknown as HTMLElement,
      summary: summary as unknown as HTMLElement,
      viewFor(input) {
        expect(input).toBe(collection);
        return comicView();
      },
      comicPageUrl(pageNumber) {
        return "/assets/comics/first-bell/page-" + pageNumber + ".jpg";
      },
      openReader(input, unlock) {
        opened.push(input, unlock);
      },
    });

    renderer.render(collection);

    expect(summary.textContent).toBe("1/3 pages found");
    expect(container.children).toHaveLength(1);
    const locker = container.children[0]!;
    expect(locker.className).toBe("comic-locker");
    expect(textTree(locker)).toEqual([
      "First Bell Comic",
      "1/3 pages",
      "?",
      "?",
    ]);
    const grid = locker.children[1]!;
    expect(grid.className).toBe("comic-page-grid");
    expect(grid.children.map((tile) => [tile.className, tile.disabled, tile.attributes["aria-label"]])).toEqual([
      ["comic-page-tile is-locked", true, "Comic page 1 locked"],
      ["comic-page-tile is-unlocked", false, "Open First-Day Survival Kit"],
      ["comic-page-tile is-locked", true, "Comic page 3 locked"],
    ]);
    const image = grid.children[1]!.children[0]!;
    expect(image.tagName).toBe("img");
    expect(image.loading).toBe("lazy");
    expect(image.alt).toBe("First-Day Survival Kit");
    expect(image.src).toBe("/assets/comics/first-bell/page-2.jpg");

    grid.children[0]!.click();
    expect(opened).toEqual([]);
    grid.children[1]!.click();
    expect(opened).toEqual([
      collection,
      { pageNumber: 2, pageId: "first-bell-page-02" },
    ]);
  });

  it("replaces prior locker content on rerender", () => {
    const container = new FakeElement("div");
    container.appendChild(new FakeElement("old"));
    const renderer = createAccountComicPanelRenderer({
      document: createDocument(),
      container: container as unknown as HTMLElement,
      viewFor: comicView,
      comicPageUrl: (pageNumber) => "/page-" + pageNumber + ".jpg",
      openReader() {},
    });

    renderer.render({});

    expect(container.children).toHaveLength(1);
    expect(container.children[0]!.className).toBe("comic-locker");
  });

  it("ignores missing containers", () => {
    const renderer = createAccountComicPanelRenderer({
      document: createDocument(),
      container: null,
      viewFor() {
        throw new Error("viewFor should not be called without a container");
      },
      comicPageUrl: (pageNumber) => "/page-" + pageNumber + ".jpg",
      openReader() {},
    });

    expect(() => renderer.render({})).not.toThrow();
  });
});
