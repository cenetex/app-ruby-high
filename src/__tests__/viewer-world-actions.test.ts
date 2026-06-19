import { describe, expect, it, vi } from "vitest";
import { createViewerWorldActionsController } from "../viewer-parts/world-actions.js";

class FakeButton {
  dataset: Record<string, string> = {};
  attributes = new Set<string>();

  constructor(action: string, eventId: string) {
    this.dataset.worldEventAction = action;
    this.dataset.worldEventId = eventId;
  }

  closest(selector: string): FakeButton | null {
    return selector === "[data-world-event-action]" ? this : null;
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class FakeRoot {
  listeners: Record<string, ((event: Event) => void)[]> = {};

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }
}

function clickEvent(target: unknown) {
  return {
    target,
    preventDefault: vi.fn(),
  } as unknown as Event & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("viewer world actions controller", () => {
  it("hides public world events through the command route and refreshes the feed", async () => {
    const root = new FakeRoot();
    const command = vi.fn(async () => ({ message: "Public world event hidden" }));
    const removeEvent = vi.fn();
    const refreshWorld = vi.fn(async () => {});
    const notify = vi.fn();
    const controller = createViewerWorldActionsController({
      root: root as unknown as HTMLElement,
      command,
      removeEvent,
      refreshWorld,
      notify,
    });
    const button = new FakeButton("hide", "world:event:a");
    const event = clickEvent(button);

    controller.attach();
    controller.attach();
    expect(root.listeners.click).toHaveLength(1);
    await controller.handleClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(command).toHaveBeenCalledWith({ type: "hide-public-world-event", eventId: "world:event:a" });
    expect(removeEvent).toHaveBeenCalledWith("world:event:a");
    expect(refreshWorld).toHaveBeenCalledWith({ force: true, silent: true });
    expect(notify).toHaveBeenCalledWith("Public world event hidden", true);
  });

  it("reports public world events with a stable reason", async () => {
    const command = vi.fn(async () => ({ message: "Public world event reported" }));
    const controller = createViewerWorldActionsController({
      root: null,
      command,
      removeEvent: vi.fn(),
      refreshWorld: vi.fn(),
      notify: vi.fn(),
    });

    await controller.handleClick(clickEvent(new FakeButton("report", "world:event:b")));

    expect(command).toHaveBeenCalledWith({
      type: "report-public-world-event",
      eventId: "world:event:b",
      reason: "player-report",
    });
  });

  it("re-enables the clicked action when the command fails closed", async () => {
    const button = new FakeButton("hide", "world:event:c");
    const controller = createViewerWorldActionsController({
      root: null,
      command: vi.fn(async () => null),
      removeEvent: vi.fn(),
      refreshWorld: vi.fn(),
      notify: vi.fn(),
    });

    await controller.handleClick(clickEvent(button));

    expect(button.attributes.has("disabled")).toBe(false);
  });
});
