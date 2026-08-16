import { describe, expect, it } from "vitest";
import { billingCardPackPaymentChoiceView } from "../viewer-parts/client-pure.js";

describe("billingCardPackPaymentChoiceView", () => {
  it("renders configured card-pack checkout copy", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "SOL",
      solAmount: 0.025,
    }, {
      name: "Ruby High 2-Pack",
      packCount: 2,
      cardCount: 10,
      symbol: "SOL",
      solAmount: 0.05,
    }, {
      cryptoUnavailable: false,
      canPackCheckout: true,
      billingBusy: false,
    })).toEqual({
      titleText: "Buy Ruby High 2-Pack",
      metaText: "Solana payment: 0.05 SOL · +2 Packs · 10 cards",
      buttonText: "Buy Collectible Pack",
      buttonDisabled: false,
      buttonTitle: "Pay with Solana wallet.",
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
      buttonText: "Wallet checkout unavailable",
      buttonDisabled: true,
      buttonTitle: "Collectible-pack checkout needs wallet support.",
      noteText: "Collectible-pack checkout is not available in this preview.",
      showGetRubyLink: false,
    });
  });

  it("explains when Solana pack checkout is incomplete", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "SOL",
      solAmount: 0.01,
    }, {
      packCount: 1,
      cardCount: 5,
    }, {
      cryptoUnavailable: false,
      canPackCheckout: false,
    })).toMatchObject({
      buttonText: "Buy Collectible Pack",
      buttonDisabled: true,
      buttonTitle: "Collectible-pack checkout is unavailable. Try again later.",
      noteText: "Collectible-pack checkout is unavailable. Try again later.",
      showGetRubyLink: false,
    });
  });

  it("disables the buy button while billing is busy", () => {
    expect(billingCardPackPaymentChoiceView({
      symbol: "SOL",
      solAmount: 0.0125,
    }, {
      packCount: 1,
      cardCount: 5,
    }, {
      canPackCheckout: true,
      billingBusy: true,
    })).toMatchObject({
      metaText: "Solana payment: 0.0125 SOL · +1 Pack · 5 cards",
      buttonText: "Buy Collectible Pack",
      buttonDisabled: true,
      buttonTitle: "Pay with Solana wallet.",
      noteText: "",
    });
  });
});
