import { describe, expect, it } from "vitest";
import { accountWalletPanelView } from "../viewer-parts/client-pure.js";

describe("account wallet panel view", () => {
  it("renders account balance and default wallet guidance", () => {
    expect(accountWalletPanelView({
      meritStars: 1234,
      hallPasses: 7,
    }, {}, {
      authed: true,
      billingBusy: false,
    })).toEqual({
      balanceText: "⭐ 1,234 · 🎫 7",
      metaText: "Use Hall Passes for images, course tools, collectible cards, and extra student slots. Buy more or permanently destroy a collectible card on the Buy Hall Passes page.",
      buyPassesText: "Buy Hall Passes",
      buyPassesTitle: "Buy Hall Passes for images, course tools, collectible cards, and extra student slots.",
      buyPassesDisabled: false,
    });
  });

  it("shows Photo Day credits when character slots carry them", () => {
    expect(accountWalletPanelView({ meritStars: 0, hallPasses: 1 }, { photoDayCredits: 1 }, { authed: true })).toMatchObject({
      metaText: "1 Photo Day credit",
    });
    expect(accountWalletPanelView({ meritStars: 0, hallPasses: 1 }, { photoDayCredits: 3 }, { authed: true })).toMatchObject({
      metaText: "3 Photo Day credits",
    });
  });

  it("disables and labels the Hall Pass action from account state", () => {
    expect(accountWalletPanelView({ hallPasses: 0 }, {}, { authed: false })).toMatchObject({
      buyPassesText: "Buy Hall Passes",
      buyPassesDisabled: true,
    });
    expect(accountWalletPanelView({ hallPasses: 0 }, {}, {
      authed: true,
      billingBusy: true,
      billingMode: "hall-passes",
    })).toMatchObject({
      buyPassesText: "Loading...",
      buyPassesDisabled: true,
    });
  });
});
