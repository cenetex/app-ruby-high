import { describe, expect, it } from "vitest";
import { accountPublicWorldView } from "../viewer-parts/client-pure.js";

describe("accountPublicWorldView", () => {
  it("shows a disabled setup state before a student exists", () => {
    const view = accountPublicWorldView(null, { authed: true });

    expect(view).toMatchObject({
      hasCharacter: false,
      hasPublicName: false,
      visible: false,
      summaryText: "Create a student before joining the shared school map.",
      statusText: "Hidden from the public world",
      toggleText: "Show",
      toggleDisabled: true,
      toggleTitle: "Create a student first",
      nextVisible: true,
    });
  });

  it("lets an authed named student publish or hide their public-world presence", () => {
    const visible = accountPublicWorldView({
      name: "Noor",
      publicWorldVisible: true,
      socialConsent: true,
    }, { authed: true });
    const hidden = accountPublicWorldView({
      name: "Noor",
      publicWorldVisible: false,
      socialConsent: true,
    }, { authed: true });

    expect(visible).toMatchObject({
      hasCharacter: true,
      hasPublicName: true,
      visible: true,
      summaryText: "Your active student can appear in public rooms and activity.",
      statusClass: "is-visible",
      toggleText: "Hide",
      toggleDisabled: false,
      nextVisible: false,
    });
    expect(hidden).toMatchObject({
      visible: false,
      summaryText: "Your active student is hidden from public rooms and activity.",
      statusClass: "",
      toggleText: "Show",
      toggleDisabled: false,
      nextVisible: true,
    });
  });

  it("does not offer a misleading show action when legacy social sharing hides the student", () => {
    const view = accountPublicWorldView({
      name: "Vince",
      publicWorldVisible: true,
      socialConsent: false,
    }, { authed: true });

    expect(view).toMatchObject({
      blockedBySocialConsent: true,
      visible: false,
      summaryText: "A legacy privacy setting is hiding this student from public rooms and activity.",
      toggleText: "Show",
      toggleDisabled: true,
      toggleTitle: "Legacy social sharing is off, so public world stays hidden",
      nextVisible: true,
    });
  });

  it("disables the toggle while busy or unauthenticated", () => {
    const character = { name: "Ruby", socialConsent: true };

    expect(accountPublicWorldView(character, { authed: false }).toggleDisabled).toBe(true);
    expect(accountPublicWorldView(character, { authed: true, busy: true }).toggleDisabled).toBe(true);
    expect(accountPublicWorldView(character, { authed: true, busy: false }).toggleDisabled).toBe(false);
  });
});
