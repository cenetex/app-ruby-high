import { describe, expect, it } from "vitest";
import { createGuestSpotlightRenderer } from "../viewer-parts/guest-spotlight.js";
import type { GuestSpotlightView } from "../viewer-parts/client-pure.js";

class FakeEvent {
  prevented = false;
  stopped = false;

  preventDefault(): void {
    this.prevented = true;
  }

  stopPropagation(): void {
    this.stopped = true;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  disabled = false;
  children: FakeElement[] = [];
  listeners: Record<string, Array<(event: FakeEvent) => void>> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(name: string, listener: (event: FakeEvent) => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): FakeEvent {
    const event = new FakeEvent();
    (this.listeners.click || []).forEach((listener) => listener(event));
    return event;
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function view(overrides?: Partial<GuestSpotlightView>): GuestSpotlightView {
  return {
    visible: true,
    packId: "pack-week-1",
    titleText: "This week's guest teacher",
    metaText: "Null Signals · Captain Null · space ethics · 12 questions",
    actionText: "Try Guest Faculty",
    actionDisabled: false,
    ...overrides,
  };
}

describe("guest spotlight renderer", () => {
  it("renders the spotlight card, records seen once per week/pack, and starts the pack on click", () => {
    const seen: string[] = [];
    const starts: unknown[] = [];
    const renderer = createGuestSpotlightRenderer({
      document: createDocument(),
      viewFor: () => view(),
      isUnlocked: () => true,
      markSeen(packId) {
        seen.push(packId);
      },
      startPack(pack) {
        starts.push(pack);
      },
    });
    const telemetry = {
      guest_pack: {
        weekKey: "2026-W25",
        auto: { id: "pack-week-1", name: "Null Signals" },
      },
    };

    const card = renderer.build(telemetry) as unknown as FakeElement;
    const cardAgain = renderer.build(telemetry) as unknown as FakeElement;

    expect(seen).toEqual(["pack-week-1"]);
    expect(card.className).toBe("guest-spotlight");
    expect(card.children[0]!.className).toBe("guest-spotlight-copy");
    expect(card.children[0]!.children[0]!.className).toBe("guest-spotlight-title");
    expect(card.children[0]!.children[0]!.textContent).toBe("This week's guest teacher");
    expect(card.children[0]!.children[1]!.className).toBe("guest-spotlight-meta");
    expect(card.children[0]!.children[1]!.textContent).toBe("Null Signals · Captain Null · space ethics · 12 questions");
    const action = card.children[1]!;
    expect(action.tagName).toBe("button");
    expect(action.type).toBe("button");
    expect(action.className).toBe("guest-spotlight-action");
    expect(action.textContent).toBe("Try Guest Faculty");
    expect(action.disabled).toBe(false);
    const event = action.click();
    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(starts).toEqual([{ id: "pack-week-1", name: "Null Signals" }]);
    expect(cardAgain).not.toBeNull();
  });

  it("does not render or mark seen when locked or hidden by the pure view", () => {
    const seen: string[] = [];
    const locked = createGuestSpotlightRenderer({
      document: createDocument(),
      viewFor: () => view(),
      isUnlocked: () => false,
      markSeen: (packId) => seen.push(packId),
      startPack: () => {},
    });
    const hidden = createGuestSpotlightRenderer({
      document: createDocument(),
      viewFor: () => view({ visible: false, packId: "" }),
      isUnlocked: () => true,
      markSeen: (packId) => seen.push(packId),
      startPack: () => {},
    });

    expect(locked.build({ guest_pack: { auto: { id: "pack-week-1" } } })).toBeNull();
    expect(hidden.build({ guest_pack: { auto: { id: "pack-week-1" } } })).toBeNull();
    expect(seen).toEqual([]);
  });

  it("disables the action when the pure view says the guest pack is active", () => {
    const starts: unknown[] = [];
    const renderer = createGuestSpotlightRenderer({
      document: createDocument(),
      viewFor: () => view({ actionText: "Guest Faculty active", actionDisabled: true }),
      isUnlocked: () => true,
      markSeen: () => {},
      startPack(pack) {
        starts.push(pack);
      },
    });

    const card = renderer.build({ guest_pack: { auto: { id: "pack-week-1" } } }) as unknown as FakeElement;

    expect(card.children[1]!.textContent).toBe("Guest Faculty active");
    expect(card.children[1]!.disabled).toBe(true);
  });
});
