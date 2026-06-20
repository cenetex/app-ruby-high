import { describe, expect, it } from "vitest";
import { welcomeHallPassPopupView } from "../viewer-parts/client-pure.js";

describe("welcomeHallPassPopupView", () => {
  it("shows the default starter-pass prompt before a character exists", () => {
    expect(welcomeHallPassPopupView({ amount: 5 }, {
      fromBilling: false,
      portraitConfigured: false,
      hasCharacter: false,
    })).toEqual({
      titleText: "5 Hall Passes added",
      bodyText: "Roll your first student now, or save your Hall Passes for images, cards, and extra character slots.",
      showLater: true,
      primaryText: "Create Character",
    });
  });

  it("mentions custom portraits when portrait generation is configured", () => {
    expect(welcomeHallPassPopupView({ amount: 12 }, {
      portraitConfigured: true,
      hasCharacter: false,
    })).toEqual({
      titleText: "12 Hall Passes added",
      bodyText: "Roll your first student and try a custom portrait, or save your Hall Passes for extra character slots.",
      showLater: true,
      primaryText: "Create Character",
    });
  });

  it("uses account and billing copy for existing characters and billing claims", () => {
    expect(welcomeHallPassPopupView({ amount: 1 }, {
      hasCharacter: true,
    })).toMatchObject({
      titleText: "1 Hall Passes added",
      showLater: true,
      primaryText: "Open Account",
    });
    expect(welcomeHallPassPopupView({ amount: 5 }, {
      fromBilling: true,
      hasCharacter: true,
      portraitConfigured: true,
    })).toEqual({
      titleText: "5 Hall Passes added",
      bodyText: "The front office stamped your starter passes. Spend them on images, slots, and cards, or keep playing classes free.",
      showLater: false,
      primaryText: "Continue",
    });
  });

  it("normalizes missing grant amounts to the starter amount and clamps negatives", () => {
    expect(welcomeHallPassPopupView({ amount: -20 }).titleText).toBe("1 Hall Passes added");
    expect(welcomeHallPassPopupView(null).titleText).toBe("5 Hall Passes added");
  });
});
