import { describe, expect, it } from "vitest";
import {
  billingProductsPanelView,
  billingRubyMigrationChoiceView,
} from "../viewer-parts/client-pure.js";

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

  it("describes Solana card-pack checkout and burn rate", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: true }, {
      hallPassesPerBurnedCard: 7,
    })).toEqual({
      titleText: "Buy Card Packs",
      subtitleText: "Card packs are Solana collectibles. Open a pack to create five face-down Ruby High cards.",
      cardPackCostLabels: [
        "Solana pack: 5 cards",
        "Burn rate: 1 Card = 7 Hall Passes",
      ],
      showGetRubyCostLink: false,
      emptyStatusText: "No card packs are available.",
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });

  it("reports card-pack configuration failures", () => {
    expect(billingProductsPanelView("card-packs", {}, { configured: false })).toMatchObject({
      checkoutStatusText: "Card pack checkout is not configured on this server.",
      checkoutStatusError: true,
    });

    expect(billingProductsPanelView("card-packs", {}, { configured: true })).toMatchObject({
      checkoutStatusText: "",
      checkoutStatusError: false,
    });
  });
});

describe("billingRubyMigrationChoiceView", () => {
  it("renders a wallet-ready Ruby migration action", () => {
    expect(billingRubyMigrationChoiceView({
      configured: true,
      enabled: true,
      sourceSymbol: "RUBY",
      destinationSymbol: "Ruby",
    }, {
      hasWallet: true,
      authed: true,
      billingBusy: false,
      cryptoUnavailable: false,
    })).toEqual({
      titleText: "Migrate RUBY to Ruby",
      metaText: "Burn old RUBY · mint Ruby",
      buttonText: "Migrate",
      buttonDisabled: false,
      buttonTitle: "Burn old RUBY for Ruby.",
      noteText: "",
    });
  });

  it("keeps disabled migration visibly unavailable", () => {
    expect(billingRubyMigrationChoiceView({
      configured: false,
      enabled: false,
      reason: "Ruby token migration is disabled.",
    }, {
      hasWallet: false,
      authed: true,
    })).toMatchObject({
      titleText: "Migrate RUBY to Ruby",
      metaText: "Ruby token migration is disabled.",
      buttonText: "Not Live",
      buttonDisabled: true,
      noteText: "Ruby token migration is disabled.",
    });
  });
});
