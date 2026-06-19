import { describe, expect, it, vi } from "vitest";
import { createViewerWorldLifecycleController } from "../viewer-parts/world-lifecycle.js";

type Handler = (event?: any) => void;

class FakeTarget {
  readonly handlers = new Map<string, Handler[]>();

  addEventListener(type: string, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  dispatch(type: string, event: any = {}): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

class FakeDocument extends FakeTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

function makeHarness() {
  let now = 1_000;
  const doc = new FakeDocument();
  const win = new FakeTarget();
  const refresh = new FakeTarget();
  const loadWorldFeed = vi.fn();
  const pauseWorldFeedPoll = vi.fn();
  const resumeWorldFeedPoll = vi.fn();
  const deriveAuth = vi.fn();
  const initializePrivyFromStoredSession = vi.fn();
  const postViewerMetricEvent = vi.fn();
  const controller = createViewerWorldLifecycleController({
    document: doc as unknown as Pick<Document, "visibilityState" | "addEventListener">,
    window: win as unknown as Pick<Window, "addEventListener">,
    refreshButton: refresh as unknown as HTMLElement,
    authKeys: ["auth:key", "auth:label"],
    now: () => now,
    loadWorldFeed,
    pauseWorldFeedPoll,
    resumeWorldFeedPoll,
    deriveAuth,
    initializePrivyFromStoredSession,
    postViewerMetricEvent,
  });
  return {
    controller,
    doc,
    win,
    refresh,
    loadWorldFeed,
    pauseWorldFeedPoll,
    resumeWorldFeedPoll,
    deriveAuth,
    initializePrivyFromStoredSession,
    postViewerMetricEvent,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("viewer world lifecycle controller", () => {
  it("wires refresh clicks and starts polling exactly once", () => {
    const harness = makeHarness();

    harness.controller.attach();
    harness.controller.attach();
    harness.refresh.dispatch("click");

    expect(harness.resumeWorldFeedPoll).toHaveBeenCalledTimes(1);
    expect(harness.resumeWorldFeedPoll).toHaveBeenCalledWith(20000);
    expect(harness.loadWorldFeed).toHaveBeenCalledWith({ force: true });
  });

  it("refreshes auth on watched storage keys", () => {
    const harness = makeHarness();
    harness.controller.attach();

    harness.win.dispatch("storage", { key: "ignored" });
    harness.win.dispatch("storage", { key: "auth:key" });
    harness.win.dispatch("storage", { key: null });

    expect(harness.deriveAuth).toHaveBeenCalledTimes(2);
  });

  it("pauses world polling while hidden and resumes with a metric after a long absence", () => {
    const harness = makeHarness();
    harness.controller.attach();

    harness.setNow(2_000);
    harness.doc.visibilityState = "hidden";
    harness.doc.dispatch("visibilitychange");

    harness.setNow(5 * 60 * 1000 + 3_000);
    harness.doc.visibilityState = "visible";
    harness.doc.dispatch("visibilitychange");

    expect(harness.pauseWorldFeedPoll).toHaveBeenCalledTimes(1);
    expect(harness.deriveAuth).toHaveBeenCalledTimes(1);
    expect(harness.initializePrivyFromStoredSession).toHaveBeenCalledTimes(1);
    expect(harness.loadWorldFeed).toHaveBeenCalledWith({ silent: true });
    expect(harness.resumeWorldFeedPoll).toHaveBeenLastCalledWith(20000);
    expect(harness.postViewerMetricEvent).toHaveBeenCalledWith("session_resume", {
      inactiveMs: 5 * 60 * 1000 + 1_000,
      reason: "visibilitychange",
    });
  });

  it("does not emit duplicate resume metrics within the throttle window", () => {
    const harness = makeHarness();
    harness.controller.attach();

    harness.setNow(10_000);
    harness.doc.visibilityState = "hidden";
    harness.doc.dispatch("visibilitychange");
    harness.setNow(10_000 + 6 * 60 * 1000);
    harness.win.dispatch("focus");
    harness.doc.visibilityState = "hidden";
    harness.doc.dispatch("visibilitychange");
    harness.setNow(10_000 + 7 * 60 * 1000);
    harness.win.dispatch("pageshow");

    expect(harness.postViewerMetricEvent).toHaveBeenCalledTimes(1);
  });
});
