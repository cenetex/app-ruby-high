import { describe, expect, it } from "vitest";
import {
  guestSpotlightStartOutcome,
  guestSpotlightView,
} from "../viewer-parts/client-pure.js";

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
      actionText: "Start guest class",
      actionDisabled: false,
    });
  });

  it("keeps the start action enabled when the weekly pack is mounted", () => {
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
      actionText: "Start guest class",
      actionDisabled: false,
    });
  });

  it("keeps command failures separate from an empty guest schedule", () => {
    expect(guestSpotlightStartOutcome(null, { kind: "network" })).toBe("handled-error");
    expect(guestSpotlightStartOutcome({ noQuestionDue: true }, null)).toBe("not-ready");
    expect(guestSpotlightStartOutcome({ questionAlreadyLive: true }, null)).toBe("handled-error");
    expect(guestSpotlightStartOutcome({
      session: { telemetry: { faculty: "guest", current: { id: "guest-1" } } },
    }, null)).toBe("started");
    expect(guestSpotlightStartOutcome({
      session: { telemetry: { faculty: "ruby", current: { id: "ruby-1" } } },
    }, null)).toBe("not-ready");
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
