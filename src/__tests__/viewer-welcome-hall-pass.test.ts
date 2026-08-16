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
      bodyText: "Create your first student now, or save your Hall Passes for images, collectible cards, and extra student slots.",
      showLater: true,
      primaryText: "Create Student",
    });
  });

  it("mentions custom portraits when portrait generation is configured", () => {
    expect(welcomeHallPassPopupView({ amount: 12 }, {
      portraitConfigured: true,
      hasCharacter: false,
    })).toEqual({
      titleText: "12 Hall Passes added",
      bodyText: "Create your first student and try a custom portrait, or save your Hall Passes for an extra student slot.",
      showLater: true,
      primaryText: "Create Student",
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
      bodyText: "Your starter Hall Passes are ready. Use them for images, extra students, and collectible cards, or keep playing classes for free.",
      showLater: false,
      primaryText: "Continue",
    });
  });

  it("normalizes missing grant amounts to the starter amount and clamps negatives", () => {
    expect(welcomeHallPassPopupView({ amount: -20 }).titleText).toBe("1 Hall Passes added");
    expect(welcomeHallPassPopupView(null).titleText).toBe("5 Hall Passes added");
  });
});
