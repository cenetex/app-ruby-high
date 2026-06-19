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
      titleText: "Burn Card",
      metaText: "Connect your Solana wallet to burn a Card for 5 Hall Passes.",
      buttonText: "Connect Wallet",
      buttonDisabled: false,
      buttonTitle: "Connect a Solana wallet before burning a Card.",
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
      titleText: "Burn Card",
      metaText: "2 burnable Cards · +7 Hall Passes",
      buttonText: "Burn Card",
      buttonDisabled: false,
      buttonTitle: "Burn one Card for 7 Hall Passes.",
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
      metaText: "No active on-chain Cards in this wallet.",
      buttonText: "Burn Card",
      buttonDisabled: true,
      buttonTitle: "No active on-chain Cards are available to burn.",
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
      buttonText: "Burning...",
      buttonDisabled: true,
    });
  });
});
