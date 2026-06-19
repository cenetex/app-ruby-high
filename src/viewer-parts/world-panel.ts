import type { ViewerWorldFeedClient, ViewerWorldFeedLoadOptions, ViewerWorldFeedState } from "./world-feed.js";

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface ViewerWorldPanelRoomView {
  title: string;
  meta: string;
}

export interface ViewerWorldPanelEventView {
  label: string;
  age: string;
}

export interface ViewerWorldPanelView {
  summary: string;
  rooms: ViewerWorldPanelRoomView[];
  events: ViewerWorldPanelEventView[];
}

export interface ViewerWorldPanelElements {
  panel?: HTMLElement | null;
  sub?: HTMLElement | null;
  rooms?: HTMLElement | null;
  events?: HTMLElement | null;
}

export interface ViewerWorldPanelControllerDeps {
  document: Pick<Document, "createElement" | "visibilityState">;
  elements: ViewerWorldPanelElements;
  feedClient: ViewerWorldFeedClient;
  maxEventAgeMs: number;
  minPollMs?: number;
  now(): number;
  getRoster(): unknown[];
  isSuppressed(): boolean;
  panelView(state: ViewerWorldFeedState, roster: unknown[], now: number): ViewerWorldPanelView;
  setTimeout(fn: () => void | Promise<void>, delayMs: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle | null): void;
}

export interface ViewerWorldPanelController {
  render(): void;
  load(opts?: ViewerWorldFeedLoadOptions): Promise<void>;
  schedulePoll(delayMs?: number): void;
  pausePoll(): void;
  resumePoll(delayMs?: number): void;
}

export function createViewerWorldPanelController(deps: ViewerWorldPanelControllerDeps): ViewerWorldPanelController {
  let pollHandle: TimeoutHandle | null = null;
  const minPollMs = Math.max(1, Math.floor(Number(deps.minPollMs || 20000)));

  function appendRoomChip(parent: HTMLElement, room: ViewerWorldPanelRoomView): void {
    const chip = deps.document.createElement("div");
    chip.className = "world-room-chip";
    const title = deps.document.createElement("strong");
    title.textContent = room.title;
    const meta = deps.document.createElement("span");
    meta.textContent = room.meta;
    chip.appendChild(title);
    chip.appendChild(meta);
    parent.appendChild(chip);
  }

  function appendQuietRoomChip(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "world-room-chip";
    const title = deps.document.createElement("strong");
    title.textContent = "Halls quiet";
    const meta = deps.document.createElement("span");
    meta.textContent = "Waiting for class";
    empty.appendChild(title);
    empty.appendChild(meta);
    parent.appendChild(empty);
  }

  function appendEventRow(parent: HTMLElement, event: ViewerWorldPanelEventView): void {
    const row = deps.document.createElement("div");
    row.className = "world-event-row";
    const dot = deps.document.createElement("span");
    dot.className = "world-event-dot";
    const label = deps.document.createElement("span");
    label.className = "world-event-label";
    label.textContent = event.label;
    const time = deps.document.createElement("span");
    time.className = "world-event-time";
    time.textContent = event.age;
    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(time);
    parent.appendChild(row);
  }

  function appendEmptyEvents(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "world-panel-empty";
    empty.textContent = "No public beats yet.";
    parent.appendChild(empty);
  }

  function render(): void {
    const panel = deps.elements.panel;
    if (!panel) return;
    const state = deps.feedClient.state;
    deps.feedClient.prune(deps.now(), deps.maxEventAgeMs);
    if (deps.isSuppressed() || !state.loaded) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const view = deps.panelView(state, deps.getRoster(), deps.now());
    if (deps.elements.sub) {
      deps.elements.sub.textContent = view.summary;
    }
    if (deps.elements.rooms) {
      deps.elements.rooms.replaceChildren();
      if (view.rooms.length === 0) {
        appendQuietRoomChip(deps.elements.rooms);
      } else {
        view.rooms.forEach((room) => appendRoomChip(deps.elements.rooms as HTMLElement, room));
      }
    }
    if (deps.elements.events) {
      deps.elements.events.replaceChildren();
      if (view.events.length === 0) {
        appendEmptyEvents(deps.elements.events);
      } else {
        view.events.forEach((event) => appendEventRow(deps.elements.events as HTMLElement, event));
      }
    }
  }

  async function load(opts?: ViewerWorldFeedLoadOptions): Promise<void> {
    if (!deps.elements.panel) return;
    await deps.feedClient.load(opts || {});
  }

  function schedulePoll(delayMs?: number): void {
    deps.clearTimeout(pollHandle);
    if (deps.document.visibilityState === "hidden") {
      pollHandle = null;
      return;
    }
    pollHandle = deps.setTimeout(async () => {
      pollHandle = null;
      await load({ silent: true });
      const backoffMs = deps.feedClient.backoffMs();
      schedulePoll(Math.max(minPollMs, backoffMs));
    }, delayMs || minPollMs);
  }

  function pausePoll(): void {
    deps.clearTimeout(pollHandle);
    pollHandle = null;
  }

  function resumePoll(delayMs?: number): void {
    if (deps.document.visibilityState === "hidden") return;
    schedulePoll(delayMs || 0);
  }

  return {
    render,
    load,
    schedulePoll,
    pausePoll,
    resumePoll,
  };
}
