import { describe, expect, it } from "vitest";
import { accountAiPanelView } from "../viewer-parts/client-pure.js";

describe("account AI panel view", () => {
  it("offers hosted AI when configured and affordable", () => {
    const view = accountAiPanelView({
      configured: true,
      cost: 2,
      durationMs: 86_400_000,
    }, {
      authed: true,
      canUseHallPass: true,
    });

    expect(view).toMatchObject({
      status: "Offline mode",
      meta: "Spend 2 Hall Passes for 1 day of hosted AI, or connect your own AI key.",
      primaryLabel: "Use Hall Pass",
      primaryTitle: "Spend 2 Hall Passes for 1 day of AI access.",
      primaryDisabled: false,
      secondaryLabel: "Connect AI key",
      secondaryDisabled: false,
    });
  });

  it("explains insufficient Hall Passes and hosted AI configuration gaps", () => {
    expect(accountAiPanelView({
      configured: true,
      cost: 3,
      durationMs: 604_800_000,
    }, {
      authed: true,
      canUseHallPass: false,
    })).toMatchObject({
      primaryTitle: "Need 3 Hall Passes. Buy Hall Passes or burn a Card first.",
      primaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: false }, { authed: true, canUseHallPass: true })).toMatchObject({
      meta: "Hosted AI is not configured on this server. Connect your own AI key.",
      primaryTitle: "Hosted AI is not configured on this server.",
      primaryDisabled: true,
    });
  });

  it("prioritizes local, browser-key, hosted, and teacher-server states", () => {
    expect(accountAiPanelView({ configured: true }, {
      authed: true,
      localAiEnabled: true,
      hasBrowserKey: true,
      aiEnabled: true,
      canUseHallPass: true,
    })).toMatchObject({
      status: "Local AI active",
      primaryLabel: "Local AI",
      secondaryLabel: "Connect AI key",
      primaryDisabled: true,
      secondaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: true }, {
      authed: true,
      hasBrowserKey: true,
      aiEnabled: true,
      canUseHallPass: true,
    })).toMatchObject({
      status: "AI key connected",
      secondaryLabel: "Disconnect",
    });

    expect(accountAiPanelView({ configured: true, active: true, expiresAt: Date.now() + 3600_000 }, {
      authed: true,
      canUseHallPass: true,
    })).toMatchObject({
      status: "AI Access active",
      primaryLabel: "Active",
      primaryTitle: "",
      primaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: true }, {
      authed: true,
      canUseHallPass: true,
      teacherServerAi: true,
    })).toMatchObject({
      status: "Teacher AI connected",
      meta: "This server can speak for teachers. Use a Hall Pass or connect your own AI key for browser-owned AI features.",
    });
  });
});
