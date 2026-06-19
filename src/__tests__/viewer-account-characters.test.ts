import { describe, expect, it } from "vitest";
import {
  accountCharacterCardView,
  accountEmptyCharacterSlotView,
} from "../viewer-parts/client-pure.js";

describe("account character card views", () => {
  it("renders active character slot labels and portrait fallback", () => {
    const view = accountCharacterCardView({
      kind: "active",
      character: {
        name: "Noor",
        playbookId: "overachiever",
      },
    }, 1, [
      { id: "overachiever", accent: "#d22a2a" },
    ], "10", "/portraits/overachiever.png");

    expect(view).toEqual({
      className: "account-character-card is-active",
      accent: "#d22a2a",
      name: "Noor",
      meta: "Slot 1 · active · Sophomore",
      portraitUrl: "/portraits/overachiever.png",
      portraitInitial: "N",
      isActive: true,
    });
  });

  it("renders graduated character progress and prefers character portraits", () => {
    const view = accountCharacterCardView({
      kind: "graduated",
      character: {
        name: "Mina",
        playbookId: "spark",
        portraitDataUrl: "data:image/png;base64,portrait",
        diplomaImageDataUrl: "data:image/png;base64,diploma",
        yearbook: [{}, {}, {}],
      },
    }, 2, [], "12", "/fallback.png");

    expect(view).toMatchObject({
      className: "account-character-card is-graduated",
      accent: "var(--accent)",
      name: "Mina",
      meta: "Slot 2 · graduated · 3/4 years",
      portraitUrl: "data:image/png;base64,diploma",
      portraitInitial: "M",
      isActive: false,
    });
  });

  it("renders create and locked empty slots", () => {
    expect(accountEmptyCharacterSlotView(3, true)).toEqual({
      tagName: "button",
      type: "button",
      className: "account-character-card is-empty is-create",
      name: "Create Character",
      meta: "Slot 3 · start today's class",
      canCreate: true,
    });
    expect(accountEmptyCharacterSlotView(4, false)).toEqual({
      tagName: "div",
      type: "",
      className: "account-character-card is-empty",
      name: "Empty Slot",
      meta: "Slot 4 · ready for a future student",
      canCreate: false,
    });
  });
});
