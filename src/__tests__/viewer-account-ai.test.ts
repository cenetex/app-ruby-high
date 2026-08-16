import { describe, expect, it } from "vitest";
import { accountAiPanelView } from "../viewer-parts/client-pure.js";

describe("account AI panel view", () => {
  it("describes sponsored server AI when configured", () => {
    const view = accountAiPanelView({
      configured: true,
      cost: 2,
      durationMs: 86_400_000,
    }, {
      authed: true,
      canUseHallPass: true,
    });

    expect(view).toMatchObject({
      status: "AI is off",
      meta: "Ruby High AI is included when available. Teacher chat still uses Merit Stars.",
      primaryLabel: "Use Ruby High AI",
      primaryTitle: "Hall Passes are used for images, collectible cards, and course tools.",
      primaryDisabled: false,
      secondaryLabel: "Use my AI key",
      secondaryDisabled: false,
    });
  });

  it("explains insufficient Hall Passes and server AI configuration gaps", () => {
    expect(accountAiPanelView({
      configured: true,
      cost: 3,
      durationMs: 604_800_000,
    }, {
      authed: true,
      canUseHallPass: false,
    })).toMatchObject({
      primaryTitle: "Need 3 Hall Passes. Buy Hall Passes or permanently destroy a collectible card first.",
      primaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: false }, { authed: true, canUseHallPass: true })).toMatchObject({
      meta: "Ruby High AI is not available here. Use your own AI key instead.",
      primaryTitle: "Ruby High AI is not available here.",
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
      status: "On-device AI is ready",
      primaryLabel: "On-device AI",
      secondaryLabel: "Use my AI key",
      primaryDisabled: true,
      secondaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: true }, {
      authed: true,
      hasBrowserKey: true,
      aiEnabled: true,
      canUseHallPass: true,
    })).toMatchObject({
      status: "Your AI key is connected",
      secondaryLabel: "Disconnect my AI key",
    });

    expect(accountAiPanelView({ configured: true, active: true, expiresAt: Date.now() + 3600_000 }, {
      authed: true,
      canUseHallPass: true,
    })).toMatchObject({
      status: "Ruby High AI is ready",
      meta: "Ruby High provides the AI. Teacher chat uses Merit Stars.",
      primaryLabel: "Active",
      primaryTitle: "",
      primaryDisabled: true,
    });

    expect(accountAiPanelView({ configured: true }, {
      authed: true,
      canUseHallPass: true,
      teacherServerAi: true,
    })).toMatchObject({
      status: "Teacher AI is ready",
      meta: "Teachers can reply. Use your own AI key for personal AI features.",
    });
  });
});
