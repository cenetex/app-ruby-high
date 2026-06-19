import type { ViewerSseResponse } from "./sse.js";
import { createViewerWorldActionsController } from "./world-actions.js";
import { createViewerWorldFeedClient } from "./world-feed.js";
import type { ViewerWorldFeedClient, ViewerWorldFeedLoadOptions, ViewerWorldFeedState } from "./world-feed.js";
import { createViewerWorldLifecycleController } from "./world-lifecycle.js";
import { createViewerWorldPanelController } from "./world-panel.js";
import type { ViewerWorldPanelView } from "./world-panel.js";

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface ViewerWorldControllerElements {
  panel?: HTMLElement | null;
  sub?: HTMLElement | null;
  rooms?: HTMLElement | null;
  events?: HTMLElement | null;
  refreshButton?: HTMLElement | null;
}

export interface ViewerWorldControllerDeps {
  document: Pick<Document, "addEventListener" | "createElement" | "visibilityState">;
  window: Pick<Window, "addEventListener">;
  elements: ViewerWorldControllerElements;
  apiBase: string;
  maxEventAgeMs: number;
  authKeys: readonly string[];
  now(): number;
  apiFetch(url: string, init?: { timeoutMs?: number }): Promise<ViewerSseResponse>;
  command(payload: unknown): Promise<unknown>;
  consumeSse(response: ViewerSseResponse, handlers: {
    isCurrent(): boolean;
    onErrorResponse(error: unknown, response?: { status: number; retryAfterMs: number | null }): void;
    onEvent(event: string, data: unknown, id?: string | null): void | Promise<void>;
    watchdogMs?: number;
  }): Promise<void>;
  buildEventsUrl(apiBase: unknown, opts?: { force?: boolean; lastEventAt?: unknown; lastCursor?: unknown }): string;
  pruneEvents(events: unknown, now: unknown, maxAgeMs?: number): { events: Record<string, unknown>[]; lastEventAt: number };
  mergeEvents(events: unknown, event: unknown, now: unknown, maxEvents?: number): { events: Record<string, unknown>[]; lastEventAt: number };
  getRoster(): unknown[];
  isSuppressed(): boolean;
  panelView(state: ViewerWorldFeedState, roster: unknown[], now: number): ViewerWorldPanelView;
  notify(message: string, ok: boolean): void;
  deriveAuth(): void | Promise<void>;
  initializePrivyFromStoredSession(): void;
  postViewerMetricEvent(name: string, payload: Record<string, unknown>): void;
  setTimeout(fn: () => void | Promise<void>, delayMs: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle | null): void;
}

export interface ViewerWorldController {
  feedClient: ViewerWorldFeedClient;
  render(): void;
  load(opts?: ViewerWorldFeedLoadOptions): Promise<void>;
  pausePoll(): void;
  resumePoll(delayMs?: number): void;
  attach(): void;
}

export function createViewerWorldController(deps: ViewerWorldControllerDeps): ViewerWorldController {
  const feedClient = createViewerWorldFeedClient({
    apiBase: deps.apiBase,
    now: deps.now,
    apiFetch: deps.apiFetch,
    consumeSse: deps.consumeSse,
    buildEventsUrl: deps.buildEventsUrl,
    pruneEvents: deps.pruneEvents,
    mergeEvents: deps.mergeEvents,
    onChange() {
      render();
    },
  });

  const panelController = createViewerWorldPanelController({
    document: deps.document,
    elements: {
      panel: deps.elements.panel,
      sub: deps.elements.sub,
      rooms: deps.elements.rooms,
      events: deps.elements.events,
    },
    feedClient,
    maxEventAgeMs: deps.maxEventAgeMs,
    now: deps.now,
    getRoster: deps.getRoster,
    isSuppressed: deps.isSuppressed,
    panelView: deps.panelView,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
  });

  const actionsController = createViewerWorldActionsController({
    root: deps.elements.events,
    command: deps.command,
    removeEvent(eventId) {
      feedClient.state.events = feedClient.state.events.filter((event) => !event || event.id !== eventId);
      render();
    },
    refreshWorld(opts) {
      return load(opts || {});
    },
    notify: deps.notify,
  });

  const lifecycleController = createViewerWorldLifecycleController({
    document: deps.document,
    window: deps.window,
    refreshButton: deps.elements.refreshButton,
    authKeys: deps.authKeys,
    now: deps.now,
    loadWorldFeed: load,
    pauseWorldFeedPoll: pausePoll,
    resumeWorldFeedPoll: resumePoll,
    deriveAuth: deps.deriveAuth,
    initializePrivyFromStoredSession: deps.initializePrivyFromStoredSession,
    postViewerMetricEvent: deps.postViewerMetricEvent,
  });

  function render(): void {
    panelController.render();
  }

  async function load(opts?: ViewerWorldFeedLoadOptions): Promise<void> {
    await panelController.load(opts || {});
  }

  function pausePoll(): void {
    panelController.pausePoll();
  }

  function resumePoll(delayMs?: number): void {
    panelController.resumePoll(delayMs || 0);
  }

  function attach(): void {
    actionsController.attach();
    lifecycleController.attach();
  }

  return {
    feedClient,
    render,
    load,
    pausePoll,
    resumePoll,
    attach,
  };
}
