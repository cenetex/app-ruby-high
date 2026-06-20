import { describe, expect, it, vi } from "vitest";
import { createAccountPublicWorldController } from "../viewer-parts/account-public-world.js";
import { accountPublicWorldView } from "../viewer-parts/client-pure.js";
import type { AccountPublicWorldView } from "../viewer-parts/client-pure.js";

class FakeClassList {
  readonly values = new Set<string>();

  toggle(name: string, force?: boolean): boolean {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return enabled;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  textContent = "";
  classList = new FakeClassList();
}

class FakeButton extends FakeElement {
  disabled = false;
  title = "";
}

describe("accountPublicWorldView", () => {
  it("shows a disabled setup state before a student exists", () => {
    const view = accountPublicWorldView(null, { authed: true });

    expect(view).toMatchObject({
      hasCharacter: false,
      hasPublicName: false,
      visible: false,
      summaryText: "Create a student before joining shared school activity.",
      statusText: "Not in school activity",
      toggleText: "Join",
      toggleDisabled: true,
      toggleTitle: "Create a student first",
      nextVisible: true,
    });
  });

  it("lets an authed named student join or leave school presence", () => {
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
      publicNameReviewOk: true,
      visible: true,
      summaryText: "Your active student can appear in school rooms and activity.",
      statusClass: "is-visible",
      toggleText: "Leave",
      toggleDisabled: false,
      nextVisible: false,
    });
    expect(hidden).toMatchObject({
      visible: false,
      summaryText: "Your active student is not appearing in school rooms and activity.",
      statusClass: "",
      toggleText: "Join",
      toggleDisabled: false,
      nextVisible: true,
    });
  });

  it("blocks public presence for names that need review", () => {
    const reserved = accountPublicWorldView({
      name: "Admin",
      publicWorldVisible: true,
      socialConsent: true,
    }, { authed: true });
    const contact = accountPublicWorldView({
      name: "noor@example.test",
      publicWorldVisible: true,
      socialConsent: true,
    }, { authed: true });
    const unsafe = accountPublicWorldView({
      name: "shit name",
      publicWorldVisible: true,
      socialConsent: true,
    }, { authed: true });

    expect(reserved).toMatchObject({
      publicNameReviewOk: false,
      publicNameReviewReason: "reserved",
      visible: false,
      summaryText: "Choose a student name that is not a staff or system name before joining school rooms.",
      toggleDisabled: true,
      toggleTitle: "Review this student name before joining school rooms",
    });
    expect(contact).toMatchObject({
      publicNameReviewReason: "contact",
      summaryText: "Remove contact info, handles, or links from this student name before joining school rooms.",
      toggleDisabled: true,
    });
    expect(unsafe).toMatchObject({
      publicNameReviewReason: "unsafe",
      summaryText: "Choose a school-appropriate student name before joining school rooms.",
      toggleDisabled: true,
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
      summaryText: "A legacy privacy setting is keeping this student out of shared school activity.",
      toggleText: "Join",
      toggleDisabled: true,
      toggleTitle: "Legacy social sharing is off for this student",
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

describe("account public-world controller", () => {
  function makeHarness(overrides: {
    initialBusy?: boolean;
    character?: unknown;
    commandResult?: { session?: unknown } | null;
    viewFor?: (character: unknown, opts: { authed: boolean; busy: boolean }) => AccountPublicWorldView;
  } = {}) {
    let busy = !!overrides.initialBusy;
    let character: unknown = overrides.character ?? { name: "Noor", publicWorldVisible: false, socialConsent: true };
    const summary = new FakeElement();
    const status = new FakeElement();
    const toggle = new FakeButton();
    const command = vi.fn(async () => Object.prototype.hasOwnProperty.call(overrides, "commandResult")
      ? overrides.commandResult
      : { session: { ok: true } });
    const notify = vi.fn();
    const setStatus = vi.fn();
    const onUpdated = vi.fn();
    const controller = createAccountPublicWorldController({
      elements: {
        summary: summary as unknown as HTMLElement,
        status: status as unknown as HTMLElement,
        toggle: toggle as unknown as HTMLButtonElement,
      },
      getCharacter() {
        return character;
      },
      isAuthed() {
        return true;
      },
      isBusy() {
        return busy;
      },
      setBusy(nextBusy) {
        busy = nextBusy;
      },
      viewFor: overrides.viewFor || accountPublicWorldView,
      command,
      notify,
      setStatus,
      onUpdated,
    });
    return {
      controller,
      summary,
      status,
      toggle,
      command,
      notify,
      setStatus,
      onUpdated,
      isBusy: () => busy,
      setCharacter: (next: unknown) => {
        character = next;
      },
    };
  }

  it("renders account public-world labels into the account surface", () => {
    const harness = makeHarness();

    harness.controller.render();

    expect(harness.summary.textContent).toBe("Your active student is not appearing in school rooms and activity.");
    expect(harness.status.textContent).toBe("Not in school activity");
    expect(harness.status.classList.has("is-visible")).toBe(false);
    expect(harness.toggle.textContent).toBe("Join");
    expect(harness.toggle.disabled).toBe(false);
    expect(harness.toggle.title).toBe("Allow this student to appear in school rooms and activity");

    harness.setCharacter({ name: "Noor", publicWorldVisible: true, socialConsent: true });
    harness.controller.render();

    expect(harness.status.textContent).toBe("Visible in school activity");
    expect(harness.status.classList.has("is-visible")).toBe(true);
    expect(harness.toggle.textContent).toBe("Leave");
  });

  it("toggles presence through the command route and restores busy state", async () => {
    const harness = makeHarness();

    await harness.controller.toggle();

    expect(harness.command).toHaveBeenCalledWith({
      type: "set-public-presence",
      publicWorldVisible: true,
    });
    expect(harness.notify).toHaveBeenCalledWith("School presence enabled", true);
    expect(harness.onUpdated).toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.isBusy()).toBe(false);
  });

  it("does not command when the current view disables the toggle", async () => {
    const harness = makeHarness({ initialBusy: true });

    await harness.controller.toggle();

    expect(harness.command).not.toHaveBeenCalled();
  });

  it("reports a failed command without claiming the account changed", async () => {
    const harness = makeHarness({ commandResult: null });

    await harness.controller.toggle();

    expect(harness.setStatus).toHaveBeenCalledWith("Could not update school presence.", true);
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.onUpdated).not.toHaveBeenCalled();
    expect(harness.isBusy()).toBe(false);
  });
});
