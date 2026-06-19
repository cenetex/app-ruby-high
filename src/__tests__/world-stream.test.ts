import { describe, expect, it } from "vitest";
import {
  applyWorldReplaySelection,
  firstHeaderValue,
  formatSseFrame,
  formatSseRetry,
  initialWorldReplayCursorState,
  parseBoundedWorldMs,
  parseWorldCursorParam,
  parseWorldCursor,
  parseWorldLastCursor,
  parseWorldLastEventId,
  parseWorldLimit,
  parseWorldLive,
  parseWorldSince,
  selectWorldReplayEvents,
  WorldSnapshotPresenter,
  worldSnapshotPayload,
  worldSnapshotSignature,
  worldCursorForEvent,
} from "../routes/world-stream.js";

function url(query = ""): URL {
  return new URL(`http://ruby.test/api/apps/ruby-high/world/events${query}`);
}

const replayEvents = [
  { at: 10, id: "world:event:000000000000000a", label: "old" },
  { at: 20, id: "world:event:000000000000000b", label: "middle-b" },
  { at: 20, id: "world:event:000000000000000c", label: "middle-c" },
  { at: 30, id: "world:event:000000000000000d", label: "new" },
];

function publicWorldSummary() {
  return {
    schoolYear: "2025-2026",
    roomGoalEvents: { total: 0, complete: 0 },
    studySparks: { total: 0, byGrade: {} },
  };
}

describe("world stream cursor helpers", () => {
  it("parses public stream limits and since cursors conservatively", () => {
    expect(parseWorldLimit(url())).toBe(30);
    expect(parseWorldLimit(url("?limit=0"))).toBe(0);
    expect(parseWorldLimit(url("?limit=250"))).toBe(100);
    expect(parseWorldLimit(url("?limit=12.9"))).toBe(12);
    expect(parseWorldLimit(url("?limit=nope"))).toBe(30);

    expect(parseWorldSince(url())).toBeNull();
    expect(parseWorldSince(url("?since=42.9"))).toBe(42);
    expect(parseWorldSince(url("?since=-1"))).toBeNull();
    expect(parseWorldSince(url("?since=nope"))).toBeNull();
  });

  it("round-trips durable world cursors and rejects raw private ids", () => {
    const cursor = worldCursorForEvent({
      at: 42.9,
      id: "world:event:0123abcd4567ef89",
    });

    expect(cursor).toBe("world:cursor:42:world%3Aevent%3A0123abcd4567ef89");
    expect(parseWorldCursor(cursor)).toEqual({
      at: 42,
      id: "world:event:0123abcd4567ef89",
    });
    expect(parseWorldCursorParam(url(`?cursor=${encodeURIComponent(cursor)}`))).toEqual({
      at: 42,
      id: "world:event:0123abcd4567ef89",
    });
    expect(parseWorldCursor("world:cursor:42:school%3Aevent%3Aprivate")).toBeNull();
    expect(parseWorldCursorParam(url("?cursor=school%3Aevent%3Aprivate"))).toBeNull();
    expect(parseWorldCursor("world:cursor:-1:world%3Aevent%3A0123abcd4567ef89")).toBeNull();
    expect(parseWorldCursor("world:cursor:42:%E0%A4%A")).toBeNull();
  });

  it("parses Last-Event-ID forms without accepting arbitrary headers", () => {
    expect(firstHeaderValue(["world:event:aaaabbbbccccdddd", "ignored"])).toBe("world:event:aaaabbbbccccdddd");
    expect(parseWorldLastEventId({ lastEventIdHeader: " world:event:aaaabbbbccccdddd " })).toBe("world:event:aaaabbbbccccdddd");
    expect(parseWorldLastEventId({ lastEventIdHeader: "school:event:private" })).toBeNull();
    expect(parseWorldLastCursor({
      lastEventIdHeader: "world:cursor:99:world%3Aevent%3Aaaaabbbbccccdddd",
    })).toEqual({
      at: 99,
      id: "world:event:aaaabbbbccccdddd",
    });
    expect(parseWorldLastCursor({ lastEventIdHeader: ["bad"] })).toBeNull();
  });

  it("parses live stream switches and bounded timing knobs", () => {
    expect(parseWorldLive(url("?live=1"))).toBe(true);
    expect(parseWorldLive(url("?live=true"))).toBe(true);
    expect(parseWorldLive(url("?live=yes"))).toBe(true);
    expect(parseWorldLive(url("?live=no"))).toBe(false);

    expect(parseBoundedWorldMs(url(), "heartbeatMs", 5000, 1000, 30000)).toBe(5000);
    expect(parseBoundedWorldMs(url("?heartbeatMs=50"), "heartbeatMs", 5000, 1000, 30000)).toBe(1000);
    expect(parseBoundedWorldMs(url("?heartbeatMs=999999"), "heartbeatMs", 5000, 1000, 30000)).toBe(30000);
    expect(parseBoundedWorldMs(url("?heartbeatMs=1750.9"), "heartbeatMs", 5000, 1000, 30000)).toBe(1750);
    expect(parseBoundedWorldMs(url("?heartbeatMs=nope"), "heartbeatMs", 5000, 1000, 30000)).toBe(5000);
  });

  it("formats SSE retry and data frames consistently", () => {
    expect(formatSseRetry(5000.9)).toBe("retry: 5000\n\n");
    expect(formatSseFrame("world-event", { ok: true }, "world:cursor:1:abc")).toBe(
      'id: world:cursor:1:abc\nevent: world-event\ndata: {"ok":true}\n\n',
    );
    expect(formatSseFrame("heartbeat", { eventCount: 0 })).toBe(
      'event: heartbeat\ndata: {"eventCount":0}\n\n',
    );
  });

  it("builds stable snapshot payloads and suppresses unchanged frames", () => {
    const world = {
      generatedAt: 100,
      activeStudents: 1,
      activeRooms: [{
        grade: "10" as const,
        facultyId: "ruby",
        displayName: "Ruby",
        activeStudents: 1,
        goal: {
          kind: "live-class" as const,
          label: "Ruby live class 1/3",
          progress: 1,
          target: 3,
          complete: false,
          updatedAt: 100,
        },
        students: [],
      }],
      cohorts: {},
      recentEvents: [],
      summary: publicWorldSummary(),
      curriculum: { activeCharacterSessions: 1, lowPools: [] },
    };
    const laterSameWorld = { ...world, generatedAt: 200 };
    const changedWorld = { ...world, generatedAt: 300, activeStudents: 2 };
    const changedSummaryWorld = {
      ...world,
      generatedAt: 400,
      summary: {
        ...publicWorldSummary(),
        studySparks: { total: 1, byGrade: { "9": 1 } },
      },
    };
    const presenter = new WorldSnapshotPresenter();

    expect(worldSnapshotPayload(world)).toMatchObject({
      ok: true,
      generatedAt: 100,
      activeStudents: 1,
      summary: {
        studySparks: { total: 0, byGrade: {} },
      },
    });
    expect(worldSnapshotSignature(worldSnapshotPayload(world))).toBe(worldSnapshotSignature(worldSnapshotPayload(laterSameWorld)));
    expect(worldSnapshotSignature(worldSnapshotPayload(world))).not.toBe(worldSnapshotSignature(worldSnapshotPayload(changedSummaryWorld)));

    const first = presenter.snapshotFrame(world, { force: true });
    expect(first.changed).toBe(true);
    expect(first.frame).toContain("event: world-snapshot");
    expect(first.frame).toContain('"generatedAt":100');

    const second = presenter.snapshotFrame(laterSameWorld);
    expect(second.changed).toBe(false);
    expect(second.frame).toBeNull();

    const third = presenter.snapshotFrame(changedWorld);
    expect(third.changed).toBe(true);
    expect(third.frame).toContain('"activeStudents":2');
  });

  it("selects replay events after a standard Last-Event-ID", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: null,
      lastEventId: "world:event:000000000000000b",
      durableCursor: null,
      live: false,
    });

    const selection = selectWorldReplayEvents(replayEvents, state);
    applyWorldReplaySelection(state, selection);

    expect(selection.events.map((event) => event.label)).toEqual(["middle-c", "new"]);
    expect(state.cursor).toBe(30);
    expect(state.cursorEventId).toBeNull();
  });

  it("drops malformed replay events before cursor math", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: 0,
      lastEventId: null,
      durableCursor: null,
      live: true,
    });

    const selection = selectWorldReplayEvents([
      { at: Number.NaN, id: "world:event:000000000000000a", label: "nan" },
      { at: 20, id: "school:event:private", label: "private id" },
      { at: -1, id: "world:event:000000000000000b", label: "negative" },
      { at: 30, id: "world:event:000000000000000c", label: "valid" },
    ], state);
    applyWorldReplaySelection(state, selection);

    expect(selection.events.map((event) => event.label)).toEqual(["valid"]);
    expect(state.cursor).toBe(30);
    expect(Array.from(state.sentEventIds)).toEqual(["world:event:000000000000000c"]);
  });

  it("selects replay events after a durable cursor without dropping same-millisecond edges", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: null,
      lastEventId: null,
      durableCursor: { at: 20, id: "world:event:000000000000000b" },
      live: false,
    });

    const selection = selectWorldReplayEvents(replayEvents, state);
    applyWorldReplaySelection(state, selection);

    expect(selection.events.map((event) => event.label)).toEqual(["middle-c", "new"]);
    expect(state.cursor).toBe(30);
    expect(state.durableCursor).toBeNull();
  });

  it("lets explicit since override reconnect headers", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: 20,
      lastEventId: "world:event:000000000000000d",
      durableCursor: { at: 30, id: "world:event:000000000000000d" },
      live: false,
    });

    const selection = selectWorldReplayEvents(replayEvents, state);

    expect(selection.events.map((event) => event.label)).toEqual(["new"]);
    expect(selection.cursorEventId).toBeNull();
    expect(selection.durableCursor).toBeNull();
  });

  it("keeps same-timestamp live events distinct across polling frames", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: 20,
      lastEventId: null,
      durableCursor: null,
      live: true,
    });
    state.sentEventIds.add("world:event:000000000000000b");

    const selection = selectWorldReplayEvents(replayEvents, state);
    applyWorldReplaySelection(state, selection);

    expect(selection.events.map((event) => event.label)).toEqual(["middle-c", "new"]);
    expect(state.cursor).toBe(30);
    expect(Array.from(state.sentEventIds)).toEqual(["world:event:000000000000000d"]);
  });

  it("bounds live duplicate tracking to the active cursor timestamp", () => {
    const state = initialWorldReplayCursorState({
      explicitSince: 0,
      lastEventId: null,
      durableCursor: null,
      live: true,
    });
    const first = selectWorldReplayEvents([
      { at: 10, id: "world:event:000000000000000a", label: "old-a" },
      { at: 10, id: "world:event:000000000000000b", label: "old-b" },
    ], state);
    applyWorldReplaySelection(state, first);

    expect(Array.from(state.sentEventIds).sort()).toEqual([
      "world:event:000000000000000a",
      "world:event:000000000000000b",
    ]);

    const next = selectWorldReplayEvents([
      { at: 10, id: "world:event:000000000000000a", label: "old-a" },
      { at: 10, id: "world:event:000000000000000b", label: "old-b" },
      { at: 20, id: "world:event:000000000000000c", label: "new-c" },
    ], state);
    applyWorldReplaySelection(state, next);

    expect(next.events.map((event) => event.label)).toEqual(["new-c"]);
    expect(state.cursor).toBe(20);
    expect(Array.from(state.sentEventIds)).toEqual(["world:event:000000000000000c"]);
  });
});
