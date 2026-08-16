import { describe, expect, it } from "vitest";
import {
  accountCharacterCardView,
  accountCharacterPanelView,
  accountEmptyCharacterSlotView,
} from "../viewer-parts/client-pure.js";

describe("account character card views", () => {
  it("renders the empty account panel with create and unlock state", () => {
    expect(accountCharacterPanelView({
      unlockedSlots: 1,
      photoDayCredits: 0,
      costHallPasses: 2,
      photoDayCreditsPerSlot: 1,
    }, {
      hallPasses: 1,
    }, {
      authed: true,
      entryCount: 0,
      hasActiveCharacter: false,
    })).toEqual({
      displaySlots: 1,
      emptySlots: 1,
      canCreateCharacter: true,
      summaryText: "Create your first student to start class.",
      createHidden: false,
      createDisabled: false,
      unlockText: "Add Student Slot (2 Hall Passes)",
      unlockDisabled: true,
      unlockTitle: "Need 2 Hall Passes",
    });
  });

  it("renders occupied account slot summaries and unlock affordance", () => {
    expect(accountCharacterPanelView({
      unlockedSlots: 3,
      photoDayCredits: 1,
      costHallPasses: 1,
      photoDayCreditsPerSlot: 2,
    }, {
      hallPasses: 4,
    }, {
      authed: true,
      billingBusy: false,
      entryCount: 2,
      hasActiveCharacter: true,
    })).toEqual({
      displaySlots: 3,
      emptySlots: 1,
      canCreateCharacter: false,
      summaryText: "3 unlocked slots · 1 Photo Day credit",
      createHidden: true,
      createDisabled: true,
      unlockText: "Add Student Slot (1 Hall Pass)",
      unlockDisabled: false,
      unlockTitle: "Adds one student slot and 2 Photo Day credit",
    });
  });

  it("expands display slots to fit graduated records", () => {
    expect(accountCharacterPanelView({
      unlockedSlots: 1,
      photoDayCredits: 2,
      costHallPasses: 3,
    }, {
      hallPasses: 5,
    }, {
      authed: false,
      entryCount: 4,
      hasActiveCharacter: false,
    })).toMatchObject({
      displaySlots: 4,
      emptySlots: 0,
      canCreateCharacter: false,
      summaryText: "4 unlocked slots · 2 Photo Day credits",
      unlockDisabled: true,
    });
  });

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
      name: "Create Student",
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
