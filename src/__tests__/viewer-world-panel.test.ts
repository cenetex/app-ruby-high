import { describe, expect, it, vi } from "vitest";
import { createViewerWorldPanelController } from "../viewer-parts/world-panel.js";
import type { ViewerWorldFeedClient } from "../viewer-parts/world-feed.js";

class FakeElement {
  className = "";
  textContent = "";
  hidden = false;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  title = "";
  type = "";
  attributes: Record<string, string> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function makeHarness(overrides: {
  visibilityState?: DocumentVisibilityState;
  loaded?: boolean;
  suppressed?: boolean;
  backoffMs?: number;
} = {}) {
  let now = Date.UTC(2026, 5, 18, 12);
  let queued: (() => void | Promise<void>) | null = null;
  const load = vi.fn(async () => {});
  const prune = vi.fn();
  const feedClient: ViewerWorldFeedClient = {
    state: {
      loaded: overrides.loaded ?? true,
      loading: false,
      error: null,
      generatedAt: now,
      activeStudents: 2,
      activeRooms: [{ grade: "9", facultyId: "ruby", activeStudents: 2 }],
      cohorts: {},
      curriculum: null,
      summary: null,
      events: [{ id: "world:event:a", at: now - 60_000, label: "Ruby started class" }],
    },
    load,
    backoffMs() {
      return overrides.backoffMs ?? 0;
    },
    prune,
    reset: vi.fn(),
  };
  const panel = new FakeElement("section");
  const sub = new FakeElement("p");
  const rooms = new FakeElement("div");
  const events = new FakeElement("div");
  const clearTimeout = vi.fn();
  const controller = createViewerWorldPanelController({
    document: {
      visibilityState: overrides.visibilityState ?? "visible",
      createElement(tagName: string) {
        return new FakeElement(tagName) as unknown as HTMLElement;
      },
    } as Pick<Document, "createElement" | "visibilityState">,
    elements: {
      panel: panel as unknown as HTMLElement,
      sub: sub as unknown as HTMLElement,
      rooms: rooms as unknown as HTMLElement,
      events: events as unknown as HTMLElement,
    },
    feedClient,
    maxEventAgeMs: 1000,
    minPollMs: 20,
    now() {
      return now;
    },
    getRoster() {
      return [{ id: "ruby", displayName: "Ruby" }];
    },
    isSuppressed() {
      return overrides.suppressed ?? false;
    },
    panelView() {
      return {
        summary: "2 students live · 1 room",
        rooms: [{ title: "Freshman · Ruby", meta: "2 students active" }],
        events: [{ id: "world:event:a", label: "Ruby started class", age: "1m" }],
      };
    },
    setTimeout(fn) {
      queued = fn;
      return 7 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout,
  });
  return {
    controller,
    feedClient,
    load,
    prune,
    panel,
    sub,
    rooms,
    events,
    clearTimeout,
    runQueued: async () => {
      if (!queued) throw new Error("no queued poll");
      await queued();
    },
    queued() {
      return queued;
    },
    setNow(value: number) {
      now = value;
    },
  };
}

describe("viewer world panel controller", () => {
  it("renders the world summary, room chips, and public event rows", () => {
    const harness = makeHarness();

    harness.controller.render();

    expect(harness.prune).toHaveBeenCalledWith(Date.UTC(2026, 5, 18, 12), 1000);
    expect(harness.panel.hidden).toBe(false);
    expect(harness.sub.textContent).toBe("2 students live · 1 room");
    expect(harness.rooms.children).toHaveLength(1);
    expect(harness.rooms.children[0]?.className).toBe("world-room-chip");
    expect(textTree(harness.rooms)).toEqual(["Freshman · Ruby", "2 students active"]);
    expect(harness.events.children).toHaveLength(1);
    expect(harness.events.children[0]?.className).toBe("world-event-row");
    expect(harness.events.children[0]?.dataset.worldEventId).toBe("world:event:a");
    expect(textTree(harness.events)).toEqual(["Ruby started class", "1m", "×", "!"]);
    const actions = harness.events.children[0]?.children[3];
    expect(actions?.className).toBe("world-event-actions");
    expect(actions?.children[0]?.dataset).toEqual({ worldEventAction: "hide", worldEventId: "world:event:a" });
    expect(actions?.children[1]?.dataset).toEqual({ worldEventAction: "report", worldEventId: "world:event:a" });
  });

  it("hides the panel until loaded or when the caller suppresses it", () => {
    const unloaded = makeHarness({ loaded: false });
    unloaded.controller.render();
    expect(unloaded.panel.hidden).toBe(true);

    const suppressed = makeHarness({ suppressed: true });
    suppressed.controller.render();
    expect(suppressed.panel.hidden).toBe(true);
  });

  it("owns world-feed polling, visibility gating, and backoff-aware rescheduling", async () => {
    const hidden = makeHarness({ visibilityState: "hidden" });
    hidden.controller.resumePoll(0);
    expect(hidden.queued()).toBeNull();

    const visible = makeHarness({ backoffMs: 50 });
    visible.controller.resumePoll(5);
    expect(visible.queued()).toBeTypeOf("function");
    await visible.runQueued();

    expect(visible.load).toHaveBeenCalledWith({ silent: true });
    expect(visible.queued()).toBeTypeOf("function");
    visible.controller.pausePoll();
    expect(visible.clearTimeout).toHaveBeenCalled();
  });
});
