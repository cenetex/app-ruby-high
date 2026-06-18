import type { RouteContext } from "./context.js";
import type { RubyHighService } from "../services/ruby-high-service.js";

export type WorldSnapshotSource = Awaited<ReturnType<RubyHighService["getFreshSchoolWorldSnapshot"]>>;

export interface WorldSnapshotPayload {
  ok: true;
  generatedAt: number;
  activeStudents: number;
  activeRooms: WorldSnapshotSource["activeRooms"];
  cohorts: WorldSnapshotSource["cohorts"];
  curriculum: WorldSnapshotSource["curriculum"];
}

export interface WorldEventCursor {
  at: number;
  id: string;
}

export interface WorldStreamEventLike {
  at: number;
  id: string;
}

export interface WorldEventReplayCursorState {
  cursor: number;
  cursorEventId: string | null;
  durableCursor: WorldEventCursor | null;
  live: boolean;
  sentEventIds: Set<string>;
}

export interface WorldEventReplaySelection<T extends WorldStreamEventLike> {
  ordered: T[];
  events: T[];
  cursor: number;
  cursorEventId: string | null;
  durableCursor: WorldEventCursor | null;
}

export function firstHeaderValue(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export function parseWorldLimit(url: URL | undefined): number {
  const raw = url?.searchParams.get("limit");
  if (!raw) return 30;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(0, Math.min(100, parsed));
}

export function parseWorldSince(url: URL | undefined): number | null {
  const raw = url?.searchParams.get("since");
  if (!raw) return null;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseWorldLastEventId(ctx: Pick<RouteContext, "lastEventIdHeader">): string | null {
  const value = firstHeaderValue(ctx.lastEventIdHeader).trim();
  return /^world:event:[a-f0-9]{16}$/i.test(value) ? value : null;
}

export function worldCursorForEvent(event: { at: number; id: string }): string {
  const at = Math.max(0, Math.floor(Number(event.at) || 0));
  return `world:cursor:${at}:${encodeURIComponent(event.id)}`;
}

export function parseWorldCursor(value: string | null | undefined): WorldEventCursor | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^world:cursor:(\d+):(.+)$/);
  if (!match) return null;
  const at = Math.floor(Number(match[1]));
  if (!Number.isFinite(at) || at < 0) return null;
  try {
    const id = decodeURIComponent(match[2] ?? "");
    if (!/^world:event:[a-f0-9]{16}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function parseWorldLastCursor(ctx: Pick<RouteContext, "lastEventIdHeader">): WorldEventCursor | null {
  return parseWorldCursor(firstHeaderValue(ctx.lastEventIdHeader));
}

export function parseWorldCursorParam(url: URL | undefined): WorldEventCursor | null {
  return parseWorldCursor(url?.searchParams.get("cursor"));
}

export function parseWorldLive(url: URL | undefined): boolean {
  const raw = String(url?.searchParams.get("live") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function parseBoundedWorldMs(url: URL | undefined, key: string, fallback: number, min: number, max: number): number {
  const raw = url?.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function initialWorldReplayCursorState(args: {
  explicitSince: number | null;
  lastEventId: string | null;
  durableCursor: WorldEventCursor | null;
  live: boolean;
}): WorldEventReplayCursorState {
  return {
    cursor: args.explicitSince ?? 0,
    cursorEventId: args.explicitSince === null ? args.lastEventId : null,
    durableCursor: args.explicitSince === null ? args.durableCursor : null,
    live: args.live,
    sentEventIds: new Set(),
  };
}

export function selectWorldReplayEvents<T extends WorldStreamEventLike>(
  events: readonly T[],
  state: WorldEventReplayCursorState,
): WorldEventReplaySelection<T> {
  const ordered = events
    .filter(isReplayableWorldStreamEvent)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  let selected = ordered.filter((event) => {
    if (state.durableCursor) {
      return event.at > state.durableCursor.at || (event.at === state.durableCursor.at && event.id > state.durableCursor.id);
    }
    if (state.cursorEventId) return true;
    if (event.at > state.cursor) return true;
    return state.live && event.at === state.cursor && !state.sentEventIds.has(event.id);
  });
  let cursor = state.cursor;
  let cursorEventId = state.cursorEventId;
  let durableCursor = state.durableCursor;
  if (durableCursor) {
    cursor = durableCursor.at;
    durableCursor = null;
  } else if (cursorEventId) {
    const cursorIndex = ordered.findIndex((event) => event.id === cursorEventId);
    if (cursorIndex >= 0) {
      cursor = ordered[cursorIndex]?.at ?? cursor;
      selected = ordered.slice(cursorIndex + 1);
    }
    cursorEventId = null;
  }
  return {
    ordered,
    events: selected,
    cursor,
    cursorEventId,
    durableCursor,
  };
}

function isReplayableWorldStreamEvent<T extends WorldStreamEventLike>(event: T): event is T {
  return (
    Number.isFinite(event.at) &&
    event.at >= 0 &&
    /^world:event:[a-f0-9]{16}$/i.test(event.id)
  );
}

export function applyWorldReplaySelection<T extends WorldStreamEventLike>(
  state: WorldEventReplayCursorState,
  selection: WorldEventReplaySelection<T>,
): void {
  const previousCursor = state.cursor;
  state.cursor = selection.cursor;
  state.cursorEventId = selection.cursorEventId;
  state.durableCursor = selection.durableCursor;
  for (const event of selection.events) {
    state.sentEventIds.add(event.id);
    state.cursor = Math.max(state.cursor, event.at);
  }
  if (state.cursor > previousCursor) {
    const currentCursorEventIds = new Set(
      selection.ordered
        .filter((event) => event.at === state.cursor && state.sentEventIds.has(event.id))
        .map((event) => event.id),
    );
    state.sentEventIds = currentCursorEventIds;
  }
}

export function formatSseRetry(ms: number): string {
  const retryMs = Math.max(0, Math.floor(Number(ms) || 0));
  return `retry: ${retryMs}\n\n`;
}

export function formatSseFrame(event: string, data: unknown, id?: string): string {
  const idLine = id ? `id: ${id}\n` : "";
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function worldSnapshotPayload(world: WorldSnapshotSource): WorldSnapshotPayload {
  return {
    ok: true,
    generatedAt: world.generatedAt,
    activeStudents: world.activeStudents,
    activeRooms: world.activeRooms,
    cohorts: world.cohorts,
    curriculum: world.curriculum,
  };
}

export function worldSnapshotSignature(payload: WorldSnapshotPayload): string {
  return JSON.stringify({
    activeStudents: payload.activeStudents,
    activeRooms: payload.activeRooms,
    cohorts: payload.cohorts,
    curriculum: payload.curriculum,
  });
}

export class WorldSnapshotPresenter {
  private lastSnapshotSig: string | null = null;

  snapshotFrame(world: WorldSnapshotSource, opts: { force?: boolean } = {}): { frame: string | null; payload: WorldSnapshotPayload; changed: boolean } {
    const payload = worldSnapshotPayload(world);
    const signature = worldSnapshotSignature(payload);
    const changed = !!opts.force || signature !== this.lastSnapshotSig;
    if (changed) this.lastSnapshotSig = signature;
    return {
      frame: changed ? formatSseFrame("world-snapshot", payload) : null,
      payload,
      changed,
    };
  }
}
