import { describe, expect, it } from "vitest";
import { guestSpotlightView } from "../viewer-parts/client-pure.js";

describe("guestSpotlightView", () => {
  it("builds weekly guest pack copy and action state", () => {
    expect(guestSpotlightView({
      auto: {
        id: "pack-week-1",
        name: "Null Signals",
        teacher_name: "Captain Null",
        subject: "space ethics",
        question_count: 1200,
      },
    })).toEqual({
      visible: true,
      packId: "pack-week-1",
      titleText: "This week's guest teacher",
      metaText: "Null Signals · Captain Null · space ethics · 1,200 questions",
      actionText: "Try this guest",
      actionDisabled: false,
    });
  });

  it("disables the action when the guest pack is already active", () => {
    expect(guestSpotlightView({
      mode: "auto",
      active: { id: "pack-week-2" },
      auto: {
        id: "pack-week-2",
        name: "Library Drift",
        question_count: 4,
      },
    })).toMatchObject({
      visible: true,
      metaText: "Library Drift · Guest teacher · guest class · 4 questions",
      actionText: "Current guest",
      actionDisabled: true,
    });
  });

  it("hides malformed or unavailable packs", () => {
    expect(guestSpotlightView(null)).toMatchObject({
      visible: false,
      actionDisabled: true,
    });
    expect(guestSpotlightView({ auto: { name: "No id" } })).toMatchObject({
      visible: false,
      packId: "",
    });
  });
});
