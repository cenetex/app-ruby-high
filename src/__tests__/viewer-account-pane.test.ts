import { describe, expect, it } from "vitest";
import { accountPaneItemView, normalizeAccountPane } from "../viewer-parts/client-pure.js";

describe("account pane view", () => {
  it("normalizes account pane ids", () => {
    expect(normalizeAccountPane("account")).toBe("account");
    expect(normalizeAccountPane("wallet")).toBe("wallet");
    expect(normalizeAccountPane("cards")).toBe("cards");
    expect(normalizeAccountPane("library")).toBe("library");
    expect(normalizeAccountPane("receipts")).toBe("receipts");
    expect(normalizeAccountPane("trust")).toBe("trust");
    expect(normalizeAccountPane("unknown")).toBe("account");
    expect(normalizeAccountPane(null)).toBe("account");
  });

  it("builds selected tab and panel state", () => {
    expect(accountPaneItemView("wallet", "wallet")).toEqual({
      id: "wallet",
      selected: true,
      classActive: true,
      ariaSelected: "true",
      tabIndex: 0,
      hidden: false,
    });
    expect(accountPaneItemView("cards", "wallet")).toEqual({
      id: "cards",
      selected: false,
      classActive: false,
      ariaSelected: "false",
      tabIndex: -1,
      hidden: true,
    });
  });

  it("falls back unknown active panes to account", () => {
    expect(accountPaneItemView("account", "mystery")).toMatchObject({
      id: "account",
      selected: true,
      hidden: false,
    });
    expect(accountPaneItemView("trust", "mystery")).toMatchObject({
      id: "trust",
      selected: false,
      hidden: true,
    });
  });
});
