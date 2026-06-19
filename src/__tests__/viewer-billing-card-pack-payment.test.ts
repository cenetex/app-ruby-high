import { describe, expect, it } from "vitest";
import { billingCardPackPaymentChoiceView } from "../viewer-parts/client-pure.js";

describe("billingCardPackPaymentChoiceView", () => {
  it("renders configured card-pack checkout copy", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "RUBY",
      tokenAmount: 2500,
    }, {
      name: "Ruby High 2-Pack",
      packCount: 2,
      cardCount: 10,
      tokenSymbol: "RUBY",
      tokenAmount: 5000,
    }, {
      cryptoUnavailable: false,
      canPackCheckout: true,
      billingBusy: false,
    })).toEqual({
      titleText: "Buy Ruby High 2-Pack",
      metaText: "-5,000 RUBY · +2 Packs NFT · 10 cards",
      buttonText: "Buy Pack",
      buttonDisabled: false,
      buttonTitle: "Pay with RUBY and mint a pack NFT.",
      noteText: "",
      showGetRubyLink: false,
    });
  });

  it("disables checkout when Privy wallet checkout is unavailable", () => {
    expect(billingCardPackPaymentChoiceView({}, {
      packCount: 1,
    }, {
      cryptoUnavailable: true,
      canPackCheckout: true,
    })).toMatchObject({
      titleText: "Buy 1 Pack",
      buttonText: "Crypto unavailable",
      buttonDisabled: true,
      buttonTitle: "Card pack checkout needs Privy wallet configuration.",
      noteText: "Card pack checkout is not configured in this preview.",
      showGetRubyLink: false,
    });
  });

  it("points players to RUBY setup when token checkout is incomplete", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "RUBY",
      tokenAmount: 100,
    }, {
      packCount: 1,
      cardCount: 5,
    }, {
      cryptoUnavailable: false,
      canPackCheckout: false,
    })).toMatchObject({
      buttonText: "Buy Pack",
      buttonDisabled: true,
      buttonTitle: "RUBY token setup is incomplete. Get $RUBY, then try again.",
      noteText: "RUBY token setup is incomplete. Get $RUBY, then choose a pack.",
      showGetRubyLink: true,
    });
  });

  it("disables the buy button while billing is busy", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "DUST",
      tokenAmount: 12.5,
    }, {
      packCount: 1,
      cardCount: 5,
    }, {
      canPackCheckout: true,
      billingBusy: true,
    })).toMatchObject({
      metaText: "-12.5 DUST · +1 Pack NFT · 5 cards",
      buttonText: "Buy Pack",
      buttonDisabled: true,
      buttonTitle: "Pay with DUST and mint a pack NFT.",
      noteText: "",
    });
  });
});
