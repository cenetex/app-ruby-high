import { describe, expect, it, vi } from "vitest";
import { createTeacherImageStatusView } from "../viewer-parts/teacher-image-status.js";

function createView() {
  return createTeacherImageStatusView({
    openRouterGenerationMessage: (action) => "Connect AI before " + action + ".",
  });
}

describe("teacher image status view", () => {
  it("requires sign-in before teacher image generation", () => {
    const view = createView();
    const input = {
      authed: false,
      hasApiKey: false,
      entitlement: { configured: true, cost: 1 },
      canSpendHallPasses: true,
    };

    expect(view.reason(input)).toBe("Sign in before generating teacher images.");
    expect(view.creditHint(input)).toBe("Sign in before generating teacher images.");
  });

  it("allows browser-key generation without spending cards", () => {
    const view = createView();
    const input = {
      authed: true,
      hasApiKey: true,
      entitlement: null,
      canSpendHallPasses: false,
    };

    expect(view.reason(input)).toBe("");
    expect(view.creditHint(input)).toBe("Uses your AI key. It does not use Hall Passes.");
  });

  it("describes hosted Hall Pass spending when hosted images are configured", () => {
    const view = createView();

    expect(view.reason({
      authed: true,
      hasApiKey: false,
      entitlement: { configured: true, cost: 2 },
      canSpendHallPasses: true,
    })).toBe("");
    expect(view.creditHint({
      authed: true,
      hasApiKey: false,
      entitlement: { configured: true, cost: 2 },
      canSpendHallPasses: true,
    })).toBe("Ruby High image creation uses a Hall Pass when the image is ready.");
    expect(view.creditHint({
      authed: true,
      hasApiKey: false,
      entitlement: { configured: true, cost: 2 },
      canSpendHallPasses: false,
    })).toBe("No Hall Passes yet. Buy Hall Passes or permanently destroy a collectible card first.");
  });

  it("uses the injected OpenRouter message when neither key nor hosted image generation is available", () => {
    const openRouterGenerationMessage = vi.fn((action: string) => "Missing " + action);
    const view = createTeacherImageStatusView({ openRouterGenerationMessage });
    const input = {
      authed: true,
      hasApiKey: false,
      entitlement: { configured: false, cost: 1 },
      canSpendHallPasses: true,
    };

    expect(view.reason(input)).toBe("Missing generating teacher images");
    expect(view.creditHint(input)).toBe("Missing generating teacher images");
    expect(openRouterGenerationMessage).toHaveBeenCalledWith("generating teacher images");
  });
});
