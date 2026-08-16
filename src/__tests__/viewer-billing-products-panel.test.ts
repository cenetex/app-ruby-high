import { describe, expect, it } from "vitest";
import { billingProductsPanelView } from "../viewer-parts/client-pure.js";

describe("billingProductsPanelView", () => {
  it("describes Hall Pass checkout and Stripe configuration status", () => {
    expect(billingProductsPanelView("hall-passes", { configured: false })).toEqual({
      titleText: "Buy Hall Passes",
      subtitleText: "Buy Hall Passes or permanently destroy one collectible card to get 5.",
      cardPackCostLabels: [],
      showGetRubyCostLink: false,
      emptyStatusText: "No Hall Passes are available.",
      checkoutStatusText: "Card payment is not available here.",
      checkoutStatusError: true,
    });

    expect(billingProductsPanelView("hall-passes", { configured: true })).toMatchObject({
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });

  it("describes Solana card-pack checkout and burn rate", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: true }, {
      hallPassesPerBurnedCard: 7,
    })).toEqual({
      titleText: "Buy Collectible Packs",
      subtitleText: "These collectible packs are stored on Solana. Open one to get five face-down Ruby High cards.",
      cardPackCostLabels: [
        "Each collectible pack: 5 cards",
        "Permanently destroy 1 collectible card: get 7 Hall Passes",
      ],
      showGetRubyCostLink: false,
      emptyStatusText: "No collectible packs are available.",
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });

  it("reports card-pack configuration failures", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: false })).toMatchObject({
      checkoutStatusText: "Collectible-pack checkout is not available here.",
      checkoutStatusError: true,
    });

    expect(billingProductsPanelView("card-packs", {}, { configured: true })).toMatchObject({
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });
});
