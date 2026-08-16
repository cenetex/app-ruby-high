import { describe, expect, it } from "vitest";
import { billingHallPassPaymentChoiceView } from "../viewer-parts/client-pure.js";

describe("billingHallPassPaymentChoiceView", () => {
  it("renders configured Stripe checkout copy", () => {
    expect(billingHallPassPaymentChoiceView({
      configured: true,
    }, {
      hallPasses: 25,
      unitAmount: 999,
      currency: "usd",
    }, {
      billingBusy: false,
    })).toEqual({
      titleText: "Buy 25 Hall Passes",
      metaText: "$9.99",
      buttonText: "Checkout",
      buttonDisabled: false,
      buttonTitle: "Pay by card.",
    });
  });

  it("disables checkout when Stripe is not configured", () => {
    expect(billingHallPassPaymentChoiceView({
      configured: false,
    }, {
      hallPasses: 10,
      unitAmount: 500,
      currency: "usd",
    })).toMatchObject({
      titleText: "Buy 10 Hall Passes",
      buttonDisabled: true,
      buttonTitle: "Card payment is not available.",
    });
  });

  it("disables checkout while billing is busy", () => {
    expect(billingHallPassPaymentChoiceView({
      configured: true,
    }, {
      hallPasses: 1,
      unitAmount: 100,
      currency: "usd",
    }, {
      billingBusy: true,
    })).toMatchObject({
      titleText: "Buy 1 Hall Pass",
      buttonText: "Checkout",
      buttonDisabled: true,
      buttonTitle: "Pay by card.",
    });
  });

  it("falls back to one Hall Pass for malformed products", () => {
    expect(billingHallPassPaymentChoiceView({
      configured: true,
    }, {
      hallPasses: -3,
      unitAmount: "bad",
      currency: "xxx",
    })).toMatchObject({
      titleText: "Buy 1 Hall Pass",
      buttonDisabled: false,
    });
  });
});
