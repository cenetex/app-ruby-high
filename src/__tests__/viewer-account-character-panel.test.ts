import { describe, expect, it } from "vitest";
import { createAccountCharacterPanelRenderer } from "../viewer-parts/account-character-panel.js";
import type {
  AccountCharacterCardView,
  AccountCharacterPanelView,
  AccountEmptyCharacterSlotView,
} from "../viewer-parts/client-pure.js";

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  hidden = false;
  disabled = false;
  title = "";
  alt = "";
  src = "";
  children: FakeElement[] = [];
  listeners: Record<string, Array<() => void>> = {};
  style = {
    values: {} as Record<string, string>,
    setProperty: (name: string, value: string) => {
      this.style.values[name] = value;
    },
  };

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener());
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function panelView(overrides?: Partial<AccountCharacterPanelView>): AccountCharacterPanelView {
  return {
    displaySlots: 2,
    emptySlots: 1,
    canCreateCharacter: true,
    summaryText: "2 unlocked slots · 1 Photo Day credit",
    createHidden: false,
    createDisabled: false,
    unlockText: "Unlock Slot (1 Card)",
    unlockDisabled: false,
    unlockTitle: "Adds one student slot and 1 Photo Day credit",
    ...overrides,
  };
}

function cardView(overrides?: Partial<AccountCharacterCardView>): AccountCharacterCardView {
  return {
    className: "account-character-card is-active",
    accent: "#d22a2a",
    name: "Noor",
    meta: "Slot 1 · active · Sophomore",
    portraitUrl: "/portraits/noor.png",
    portraitInitial: "N",
    isActive: true,
    ...overrides,
  };
}

function emptySlotView(overrides?: Partial<AccountEmptyCharacterSlotView>): AccountEmptyCharacterSlotView {
  return {
    tagName: "button",
    type: "button",
    className: "account-character-card is-empty is-create",
    name: "Create Student",
    meta: "Slot 2 · start today's class",
    canCreate: true,
    ...overrides,
  };
}

describe("account character panel renderer", () => {
  it("renders account character controls, cards, empty slots, and active-card actions", () => {
    const grid = new FakeElement("div");
    const summary = new FakeElement("div");
    const createButton = new FakeElement("button");
    const unlockButton = new FakeElement("button");
    const calls = { active: 0, create: 0 };
    const renderer = createAccountCharacterPanelRenderer({
      document: createDocument(),
      grid: grid as unknown as HTMLElement,
      summary: summary as unknown as HTMLElement,
      createButton: createButton as unknown as HTMLButtonElement,
      unlockButton: unlockButton as unknown as HTMLButtonElement,
      panelView(slots, wallet, opts) {
        expect(slots).toEqual({ unlockedSlots: 2 });
        expect(wallet).toEqual({ hallPasses: 3 });
        expect(opts).toEqual({
          authed: true,
          billingBusy: false,
          entryCount: 1,
          hasActiveCharacter: true,
        });
        return panelView();
      },
      cardView(entry, slotNumber, playbooks, currentGrade, fallbackPortraitUrl) {
        expect(entry).toEqual({ character: { playbookId: "spark" } });
        expect(slotNumber).toBe(1);
        expect(playbooks).toEqual([{ id: "spark" }]);
        expect(currentGrade).toBe("10");
        expect(fallbackPortraitUrl).toBe("/portraits/spark.png");
        return cardView();
      },
      emptySlotView(slotNumber, canCreateCharacter) {
        expect(slotNumber).toBe(2);
        expect(canCreateCharacter).toBe(true);
        return emptySlotView();
      },
      fallbackPortraitFor(playbookId) {
        return "/portraits/" + playbookId + ".png";
      },
      openActiveCharacter() {
        calls.active += 1;
      },
      openCharacterCreation() {
        calls.create += 1;
      },
    });

    renderer.render({
      authed: true,
      billingBusy: false,
      slots: { unlockedSlots: 2 },
      wallet: { hallPasses: 3 },
      entries: [{ character: { playbookId: "spark" } }],
      hasActiveCharacter: true,
      playbooks: [{ id: "spark" }],
      currentGrade: "10",
    });

    expect(summary.textContent).toBe("2 unlocked slots · 1 Photo Day credit");
    expect(createButton.hidden).toBe(false);
    expect(createButton.disabled).toBe(false);
    expect(unlockButton.textContent).toBe("Unlock Slot (1 Card)");
    expect(unlockButton.disabled).toBe(false);
    expect(unlockButton.title).toBe("Adds one student slot and 1 Photo Day credit");
    expect(grid.children.map((child) => child.className)).toEqual([
      "account-character-card is-active",
      "account-character-card is-empty is-create",
    ]);
    expect(grid.children[0]!.style.values["--account-character-accent"]).toBe("#d22a2a");
    expect(grid.children[0]!.children[0]!.children[0]!.tagName).toBe("img");
    expect(textTree(grid)).toEqual([
      "Noor",
      "Slot 1 · active · Sophomore",
      "+",
      "Create Student",
      "Slot 2 · start today's class",
    ]);

    grid.children[0]!.click();
    grid.children[1]!.click();
    expect(calls).toEqual({ active: 1, create: 1 });
  });

  it("does not open inactive character cards and renders initials when portraits are missing", () => {
    const grid = new FakeElement("div");
    let activeClicks = 0;
    const renderer = createAccountCharacterPanelRenderer({
      document: createDocument(),
      grid: grid as unknown as HTMLElement,
      panelView: () => panelView({ emptySlots: 0, canCreateCharacter: false }),
      cardView: () => cardView({
        className: "account-character-card is-graduated",
        portraitUrl: "",
        portraitInitial: "M",
        isActive: false,
      }),
      emptySlotView: () => emptySlotView(),
      fallbackPortraitFor: () => "",
      openActiveCharacter() {
        activeClicks += 1;
      },
      openCharacterCreation() {
        throw new Error("create should not be wired without an empty slot");
      },
    });

    renderer.render({
      authed: true,
      billingBusy: false,
      slots: {},
      wallet: {},
      entries: [{ character: { playbookId: "spark" } }],
      hasActiveCharacter: false,
      playbooks: [],
      currentGrade: "12",
    });

    expect(grid.children).toHaveLength(1);
    expect(grid.children[0]!.children[0]!.textContent).toBe("M");
    grid.children[0]!.click();
    expect(activeClicks).toBe(0);
  });

  it("renders the empty account state when no entries or slots are visible", () => {
    const grid = new FakeElement("div");
    const renderer = createAccountCharacterPanelRenderer({
      document: createDocument(),
      grid: grid as unknown as HTMLElement,
      panelView: () => panelView({ emptySlots: 0, canCreateCharacter: false }),
      cardView() {
        throw new Error("cardView should not be called for an empty account");
      },
      emptySlotView() {
        throw new Error("emptySlotView should not be called when no slots are visible");
      },
      fallbackPortraitFor: () => "",
      openActiveCharacter() {},
      openCharacterCreation() {},
    });

    renderer.render({
      authed: false,
      billingBusy: false,
      slots: {},
      wallet: {},
      entries: [],
      hasActiveCharacter: false,
      playbooks: [],
      currentGrade: null,
    });

    expect(grid.children).toHaveLength(1);
    expect(grid.children[0]!.className).toBe("account-empty");
    expect(grid.children[0]!.textContent).toBe("Create your first student to start class.");
  });

  it("ignores missing grids", () => {
    const renderer = createAccountCharacterPanelRenderer({
      document: createDocument(),
      grid: null,
      panelView() {
        throw new Error("panelView should not be called without a grid");
      },
      cardView() {
        throw new Error("cardView should not be called without a grid");
      },
      emptySlotView: () => emptySlotView(),
      fallbackPortraitFor: () => "",
      openActiveCharacter() {},
      openCharacterCreation() {},
    });

    expect(() => renderer.render({
      authed: true,
      billingBusy: false,
      slots: {},
      wallet: {},
      entries: [{ character: {} }],
      hasActiveCharacter: true,
      playbooks: [],
      currentGrade: null,
    })).not.toThrow();
  });
});
