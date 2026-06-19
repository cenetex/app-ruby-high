import { describe, expect, it } from "vitest";
import { billingProductRowView } from "../viewer-parts/client-pure.js";

describe("billingProductRowView", () => {
  it("renders Hall Pass products with price and pass count", () => {
    expect(billingProductRowView("hall-passes", {
      hallPasses: 10,
      unitAmount: 500,
      currency: "usd",
    })).toEqual({
      titleText: "10 Hall Passes",
      metaText: "$5.00 · 10 Hall Passes",
      buttonText: "Choose",
      buttonDisabled: false,
      selected: false,
    });
  });

  it("uses custom Hall Pass product names and selected state", () => {
    expect(billingProductRowView("hall-passes", {
      name: "Starter Stack",
      hallPasses: 25,
      unitAmount: 999,
      currency: "usd",
    }, null, {
      selected: true,
      billingBusy: true,
    })).toMatchObject({
      titleText: "Starter Stack",
      metaText: "$9.99 · 25 Hall Passes",
      buttonText: "Selected",
      buttonDisabled: true,
      selected: true,
    });
  });

  it("renders card-pack products with token payment metadata", () => {
    expect(billingProductRowView("card-packs", {
      packCount: 2,
      cardCount: 10,
      tokenAmount: 5000,
      tokenSymbol: "RUBY",
    }, {
      symbol: "RUBY",
      tokenAmount: 2500,
    })).toEqual({
      titleText: "2 Packs",
      metaText: "-5,000 RUBY · +2 Packs NFT · 10 cards",
      buttonText: "Choose",
      buttonDisabled: false,
      selected: false,
    });
  });

  it("normalizes malformed product rows to safe fallbacks", () => {
    expect(billingProductRowView("hall-passes", {
      hallPasses: -10,
      unitAmount: "bad",
      currency: "xxx",
    })).toMatchObject({
      titleText: "1 Hall Pass",
      metaText: expect.stringContaining("1 Hall Pass"),
    });
    expect(billingProductRowView("card-packs", {}, {})).toMatchObject({
      titleText: "1 Pack",
      buttonText: "Choose",
    });
  });
});
