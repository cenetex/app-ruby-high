import { describe, expect, it } from "vitest";
import { billingCardBurnChoiceView } from "../viewer-parts/client-pure.js";

describe("billingCardBurnChoiceView", () => {
  it("asks for a wallet before card burning", () => {
    expect(billingCardBurnChoiceView({
      authed: true,
      billingBusy: false,
      hasWallet: false,
      burnableCards: 0,
      hallPassesPerBurnedCard: 5,
    })).toEqual({
      titleText: "Exchange a Collectible Card",
      metaText: "Connect your Solana wallet to permanently destroy a collectible card for 5 Hall Passes.",
      buttonText: "Connect Wallet",
      buttonDisabled: false,
      buttonTitle: "Connect a Solana wallet before exchanging a collectible card.",
    });
  });

  it("shows available on-chain card burn credit", () => {
    expect(billingCardBurnChoiceView({
      authed: true,
      billingBusy: false,
      hasWallet: true,
      burnableCards: 2,
      hallPassesPerBurnedCard: 7,
    })).toEqual({
      titleText: "Exchange a Collectible Card",
      metaText: "2 collectible cards can be permanently destroyed · +7 Hall Passes",
      buttonText: "Choose Collectible Card",
      buttonDisabled: false,
      buttonTitle: "Permanently destroy one collectible card for 7 Hall Passes.",
    });
  });

  it("disables burning when a wallet has no active cards", () => {
    expect(billingCardBurnChoiceView({
      authed: true,
      billingBusy: false,
      hasWallet: true,
      burnableCards: 0,
      hallPassesPerBurnedCard: 5,
    })).toMatchObject({
      metaText: "No collectible cards on Solana can be exchanged from this wallet.",
      buttonText: "Choose Collectible Card",
      buttonDisabled: true,
      buttonTitle: "No collectible cards on Solana are available to exchange.",
    });
  });

  it("disables card burning while signed out or busy", () => {
    expect(billingCardBurnChoiceView({
      authed: false,
      hasWallet: false,
      hallPassesPerBurnedCard: 5,
    })).toMatchObject({
      buttonText: "Connect Wallet",
      buttonDisabled: true,
    });
    expect(billingCardBurnChoiceView({
      authed: true,
      billingBusy: true,
      hasWallet: true,
      burnableCards: 1,
      hallPassesPerBurnedCard: 5,
    })).toMatchObject({
      buttonText: "Exchanging...",
      buttonDisabled: true,
    });
  });
});
