import type { ViewerSseResponse } from "./sse.js";

type LooseRecord = Record<string, any>;

export interface ViewerWorldFeedState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  generatedAt: number;
  activeStudents: number;
  activeRooms: unknown[];
  cohorts: LooseRecord;
  curriculum: unknown;
  summary: unknown;
  events: LooseRecord[];
}

export interface ViewerWorldFeedLoadOptions {
  force?: boolean;
  initial?: boolean;
  silent?: boolean;
}

export interface ViewerWorldFeedClientDeps {
  apiBase: string;
  now(): number;
  apiFetch(url: string, init?: { timeoutMs?: number }): Promise<ViewerSseResponse>;
  consumeSse(response: ViewerSseResponse, handlers: {
    isCurrent(): boolean;
    onErrorResponse(error: unknown, response?: { status: number; retryAfterMs: number | null }): void;
    onEvent(event: string, data: unknown, id?: string | null): void | Promise<void>;
    watchdogMs?: number;
  }): Promise<void>;
  buildEventsUrl(apiBase: unknown, opts?: { force?: boolean; lastEventAt?: unknown; lastCursor?: unknown }): string;
  pruneEvents(events: unknown, now: unknown, maxAgeMs?: number): { events: LooseRecord[]; lastEventAt: number };
  mergeEvents(events: unknown, event: unknown, now: unknown, maxEvents?: number): { events: LooseRecord[]; lastEventAt: number };
  onChange(): void;
}

export interface ViewerWorldFeedClient {
  state: ViewerWorldFeedState;
  load(opts?: ViewerWorldFeedLoadOptions): Promise<void>;
  backoffMs(): number;
  prune(now: unknown, maxAgeMs?: number): void;
  reset(): void;
}

export function createViewerWorldFeedClient(deps: ViewerWorldFeedClientDeps): ViewerWorldFeedClient {
  const state: ViewerWorldFeedState = {
    loaded: false,
    loading: false,
    error: null,
    generatedAt: 0,
    activeStudents: 0,
    activeRooms: [],
    cohorts: {},
    curriculum: null,
    summary: null,
    events: [],
  };
  let lastEventAt = 0;
  let lastCursor = "";
  let backoffUntil = 0;
  let requestSeq = 0;

  function currentBackoffMs(): number {
    return Math.max(0, Number(backoffUntil || 0) - deps.now());
  }

  function reset(): void {
    state.events = [];
    lastEventAt = 0;
    lastCursor = "";
  }

  function mergeEvent(event: unknown): void {
    const merged = deps.mergeEvents(state.events, event, deps.now(), 8);
    state.events = merged.events;
    lastEventAt = merged.lastEventAt;
  }

  function prune(now: unknown, maxAgeMs?: number): void {
    const pruned = deps.pruneEvents(state.events, now, maxAgeMs);
    state.events = pruned.events;
    lastEventAt = pruned.lastEventAt;
  }

  function applySnapshot(data: unknown): void {
    const record = data && typeof data === "object" ? data as LooseRecord : {};
    state.loaded = true;
    state.generatedAt = Number(record.generatedAt || deps.now());
    state.activeStudents = Number(record.activeStudents || 0);
    state.activeRooms = Array.isArray(record.activeRooms) ? record.activeRooms : [];
    state.cohorts = record.cohorts && typeof record.cohorts === "object" ? record.cohorts : {};
    state.curriculum = record.curriculum || null;
    state.summary = record.summary && typeof record.summary === "object" ? record.summary : null;
  }

  async function load(opts?: ViewerWorldFeedLoadOptions): Promise<void> {
    const options = opts || {};
    if (state.loading && !options.force) return;
    const blockedMs = currentBackoffMs();
    if (blockedMs > 0 && !options.force) {
      state.error = "World feed catching up.";
      deps.onChange();
      return;
    }
    state.loading = true;
    state.error = null;
    if (options.force) reset();
    const requestId = ++requestSeq;
    try {
      const url = deps.buildEventsUrl(deps.apiBase, {
        force: options.force,
        lastEventAt,
        lastCursor,
      });
      const response = await deps.apiFetch(url, { timeoutMs: options.force ? 8000 : 32000 });
      await deps.consumeSse(response, {
        isCurrent() {
          return requestId === requestSeq;
        },
        onErrorResponse(error, response) {
          const status = Number(response && response.status || 0);
          if (status === 429) {
            const retryAfterMs = Number(response && response.retryAfterMs || 0);
            backoffUntil = deps.now() + Math.max(5000, Math.min(60000, retryAfterMs || 20000));
            state.error = "World feed catching up.";
            return;
          }
          state.error = String(error || "world unavailable");
        },
        onEvent(event, data, id) {
          backoffUntil = 0;
          if (event === "world-snapshot") {
            applySnapshot(data);
          } else if (event === "world-event") {
            if (typeof id === "string" && id.indexOf("world:cursor:") === 0) {
              lastCursor = id;
            }
            mergeEvent(data);
          } else if (event === "end" && data && typeof data === "object" && (data as LooseRecord).ok === false) {
            state.loaded = true;
            state.error = String((data as LooseRecord).error || "world unavailable");
            backoffUntil = deps.now() + 20000;
          }
          deps.onChange();
        },
        watchdogMs: options.force ? 8000 : 32000,
      });
    } catch (err) {
      if (requestId === requestSeq) {
        state.error = err instanceof Error ? err.message : "world unavailable";
      }
    } finally {
      if (requestId === requestSeq) {
        state.loading = false;
        deps.onChange();
      }
    }
  }

  return {
    state,
    load,
    backoffMs: currentBackoffMs,
    prune,
    reset,
  };
}
