import { describe, expect, it } from "vitest";
import { billingProductsPanelView } from "../viewer-parts/client-pure.js";

describe("billingProductsPanelView", () => {
  it("describes Hall Pass checkout and Stripe configuration status", () => {
    expect(billingProductsPanelView("hall-passes", { configured: false })).toEqual({
      titleText: "Buy Hall Passes",
      subtitleText: "Buy Hall Passes or burn one Card for 5.",
      cardPackCostLabels: [],
      showGetRubyCostLink: false,
      emptyStatusText: "No Hall Passes are available.",
      checkoutStatusText: "Stripe checkout is not configured on this server.",
      checkoutStatusError: true,
    });

    expect(billingProductsPanelView("hall-passes", { configured: true })).toMatchObject({
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });

  it("describes card-pack checkout, burn rate, and RUBY readiness", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: true }, {
      hallPassesPerBurnedCard: 7,
      hasRubyToken: true,
    })).toEqual({
      titleText: "Buy Card Packs",
      subtitleText: "Card packs are Solana NFTs. Open a pack to create five face-down Ruby High cards.",
      cardPackCostLabels: [
        "Pack NFT: 5 cards",
        "Burn rate: 1 Card = 7 Hall Passes",
      ],
      showGetRubyCostLink: true,
      emptyStatusText: "No card packs are available.",
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });

  it("keeps card-pack configuration failures distinct from missing RUBY mint failures", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: false }, {
      hasRubyToken: true,
    })).toMatchObject({
      checkoutStatusText: "Card pack checkout is not configured on this server.",
      checkoutStatusError: true,
    });

    expect(billingProductsPanelView("card-packs", {}, { configured: true }, {
      hasRubyToken: false,
    })).toMatchObject({
      checkoutStatusText: "RUBY mint configuration is missing for card packs.",
      checkoutStatusError: true,
    });
  });
});
