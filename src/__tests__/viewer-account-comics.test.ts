import { describe, expect, it } from "vitest";
import { accountComicPanelView, comicPageTitle } from "../viewer-parts/client-pure.js";

describe("account comic panel view", () => {
  it("renders the default locked First Bell locker", () => {
    const view = accountComicPanelView(null);

    expect(view).toMatchObject({
      issueId: "first-bell",
      title: "Ruby High: Book One - First Bell",
      pageCount: 12,
      unlockedCount: 0,
      summaryText: "0/12 pages found",
      progressText: "0/12 pages",
    });
    expect(view.tiles).toHaveLength(12);
    expect(view.tiles[0]).toMatchObject({
      pageNumber: 1,
      title: "Ruby High: Book One - First Bell",
      unlocked: false,
      ariaLabel: "Comic page 1 locked",
      unlock: null,
    });
  });

  it("renders unlocked page tiles with titles and open labels", () => {
    const view = accountComicPanelView({
      issueId: "first-bell",
      title: "First Bell",
      pageCount: 4,
      unlockedPages: [
        { pageNumber: 2, pageId: "first-bell-page-02", reason: "daily-class" },
        { pageNumber: 4, pageId: "first-bell-page-04", reason: "boss" },
      ],
    });

    expect(view).toMatchObject({
      pageCount: 4,
      unlockedCount: 2,
      summaryText: "2/4 pages found",
      progressText: "2/4 pages",
    });
    expect(view.tiles.map((tile) => [tile.pageNumber, tile.unlocked, tile.ariaLabel])).toEqual([
      [1, false, "Comic page 1 locked"],
      [2, true, "Open First-Day Survival Kit"],
      [3, false, "Comic page 3 locked"],
      [4, true, "Open A Normal First Day"],
    ]);
    expect(view.tiles[1].unlock).toMatchObject({ pageNumber: 2, pageId: "first-bell-page-02" });
  });

  it("deduplicates valid unlocked pages and ignores out-of-range pages", () => {
    const view = accountComicPanelView({
      pageCount: 3,
      unlockedPages: [
        { pageNumber: 2, pageId: "older" },
        { pageNumber: "2", pageId: "newer" },
        { pageNumber: 99, pageId: "future" },
        { pageNumber: "bad", pageId: "bad" },
      ],
    });

    expect(view.unlockedCount).toBe(1);
    expect(view.tiles[1]).toMatchObject({
      unlocked: true,
      unlock: { pageNumber: 2, pageId: "newer" },
    });
  });

  it("caps page count to the built-in issue and falls back unknown titles", () => {
    const view = accountComicPanelView({ pageCount: 999, unlockedPages: [] });

    expect(view.pageCount).toBe(12);
    expect(comicPageTitle(10)).toBe("Captain Null: The Star That Cast a Shadow");
    expect(comicPageTitle(999)).toBe("First Bell");
  });
});
