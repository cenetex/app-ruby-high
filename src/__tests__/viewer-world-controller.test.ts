import { describe, expect, it, vi } from "vitest";
import { createViewerWorldController } from "../viewer-parts/world-controller.js";

class FakeElement {
  className = "";
  textContent = "";
  hidden = false;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners: Record<string, ((event: any) => void)[]> = {};
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

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }

  setAttribute(name: string, value = ""): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }
}

class FakeActionButton extends FakeElement {
  constructor(action: string, eventId: string) {
    super("button");
    this.dataset.worldEventAction = action;
    this.dataset.worldEventId = eventId;
  }

  closest(selector: string): FakeActionButton | null {
    return selector === "[data-world-event-action]" ? this : null;
  }
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function makeHarness() {
  const now = Date.UTC(2026, 5, 19, 12);
  let consumeCalls = 0;
  let queuedPoll: (() => void | Promise<void>) | null = null;
  const documentListeners: Record<string, ((event?: unknown) => void)[]> = {};
  const windowListeners: Record<string, ((event?: unknown) => void)[]> = {};
  const panel = new FakeElement("section");
  const sub = new FakeElement("p");
  const rooms = new FakeElement("div");
  const events = new FakeElement("div");
  const refreshButton = new FakeElement("button");
  const apiFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }));
  const command = vi.fn(async () => ({ message: "Public world event hidden" }));
  const notify = vi.fn();
  const deriveAuth = vi.fn();
  const initializePrivyFromStoredSession = vi.fn();
  const postViewerMetricEvent = vi.fn();
  const clearTimeout = vi.fn();
  const controller = createViewerWorldController({
    document: {
      visibilityState: "visible",
      createElement(tagName: string) {
        return new FakeElement(tagName) as unknown as HTMLElement;
      },
      addEventListener(type: string, listener: (event?: unknown) => void) {
        documentListeners[type] = [...(documentListeners[type] || []), listener];
      },
    } as Pick<Document, "addEventListener" | "createElement" | "visibilityState">,
    window: {
      addEventListener(type: string, listener: (event?: unknown) => void) {
        windowListeners[type] = [...(windowListeners[type] || []), listener];
      },
    } as Pick<Window, "addEventListener">,
    elements: {
      panel: panel as unknown as HTMLElement,
      sub: sub as unknown as HTMLElement,
      rooms: rooms as unknown as HTMLElement,
      events: events as unknown as HTMLElement,
      refreshButton: refreshButton as unknown as HTMLElement,
    },
    apiBase: "/api/apps/ruby-high",
    maxEventAgeMs: 1000,
    authKeys: ["auth-key"],
    now() {
      return now;
    },
    apiFetch,
    command,
    consumeSse: vi.fn(async (_response, handlers) => {
      consumeCalls += 1;
      handlers.onEvent("world-snapshot", {
        generatedAt: now,
        activeStudents: 2,
        activeRooms: [{ grade: "10", facultyId: "ruby", activeStudents: 2 }],
      });
      if (consumeCalls === 1) {
        handlers.onEvent("world-event", { id: "world:event:a", at: now, label: "Ruby started class" }, "world:cursor:a");
      }
    }),
    buildEventsUrl: vi.fn(() => "/api/apps/ruby-high/world/events?limit=8"),
    pruneEvents: vi.fn((events) => ({ events: Array.isArray(events) ? events as Record<string, unknown>[] : [], lastEventAt: now })),
    mergeEvents: vi.fn((events, event) => ({
      events: [...(Array.isArray(events) ? events as Record<string, unknown>[] : []), event as Record<string, unknown>],
      lastEventAt: now,
    })),
    getRoster() {
      return [{ id: "ruby", displayName: "Ruby" }];
    },
    isSuppressed() {
      return false;
    },
    panelView(state) {
      return {
        summary: `${state.activeStudents} students live`,
        rooms: state.activeRooms.map(() => ({ title: "Sophomore · Ruby", meta: "2 students active" })),
        events: state.events.map((event) => ({ id: String(event.id || ""), label: String(event.label || ""), age: "now" })),
      };
    },
    notify,
    deriveAuth,
    initializePrivyFromStoredSession,
    postViewerMetricEvent,
    setTimeout(fn) {
      queuedPoll = fn;
      return 7 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout,
  });
  return {
    controller,
    panel,
    sub,
    rooms,
    events,
    refreshButton,
    apiFetch,
    command,
    notify,
    deriveAuth,
    initializePrivyFromStoredSession,
    postViewerMetricEvent,
    documentListeners,
    windowListeners,
    queuedPoll() {
      return queuedPoll;
    },
  };
}

describe("viewer world controller", () => {
  it("composes feed, panel, action, and lifecycle behavior behind one typed controller", async () => {
    const harness = makeHarness();

    await harness.controller.load({ force: true });

    expect(harness.panel.hidden).toBe(false);
    expect(harness.sub.textContent).toBe("2 students live");
    expect(textTree(harness.rooms)).toContain("Sophomore · Ruby");
    expect(textTree(harness.events)).toContain("Ruby started class");

    harness.controller.attach();
    harness.controller.attach();
    expect(harness.events.listeners.click).toHaveLength(1);
    expect(harness.refreshButton.listeners.click).toHaveLength(1);
    expect(harness.windowListeners.focus).toHaveLength(1);
    expect(harness.documentListeners.visibilitychange).toHaveLength(1);
    expect(harness.queuedPoll()).toBeTruthy();

    const click = {
      target: new FakeActionButton("hide", "world:event:a"),
      preventDefault: vi.fn(),
    };
    harness.events.listeners.click![0](click);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(click.preventDefault).toHaveBeenCalled();
    expect(harness.command).toHaveBeenCalledWith({ type: "hide-public-world-event", eventId: "world:event:a" });
    expect(harness.notify).toHaveBeenCalledWith("Public world event hidden", true);
    expect(harness.apiFetch).toHaveBeenCalledTimes(2);
    expect(harness.controller.feedClient.state.events).toEqual([]);
  });
});
