import { describe, expect, it } from "vitest";
import {
  mergeWorldFeedEventList,
  normalizedWorldFeedEventAt,
  pruneWorldFeedEventList,
  worldFeedEventAgeLabel,
  worldFeedEventDisplayLabel,
  worldFeedEventsUrl,
  worldFeedEventViews,
  worldFeedFacultyLabel,
  worldFeedGradeLabel,
  worldFeedPanelView,
  worldFeedRoomTitle,
  worldFeedRoomViews,
  worldFeedSummaryLabel,
} from "../viewer-parts/client-pure.js";

describe("viewer world feed pure helpers", () => {
  it("normalizes, dedupes, sorts, and bounds public world events", () => {
    const now = Date.UTC(2026, 5, 18, 12);
    const result = mergeWorldFeedEventList([
      { id: "world:event:old", at: now - 1000, label: "old value" },
      { id: "world:event:a", at: now - 500, label: "a" },
    ], { id: "world:event:old", at: now, label: "new value" }, now, 8);

    expect(result.lastEventAt).toBe(now);
    expect(result.events).toEqual([
      { id: "world:event:old", at: now, label: "new value" },
      { id: "world:event:a", at: now - 500, label: "a" },
    ]);
  });

  it("prunes stale or malformed public world events and recomputes the cursor timestamp", () => {
    const now = Date.UTC(2026, 5, 18, 12);
    const result = pruneWorldFeedEventList([
      { id: "world:event:old", at: now - 10_000 },
      { id: "world:event:new", at: now - 100 },
      { id: "world:event:bad", at: "not-a-date" },
      null,
    ], now, 1000);

    expect(result.events).toEqual([{ id: "world:event:new", at: now - 100 }]);
    expect(result.lastEventAt).toBe(now - 100);
    expect(normalizedWorldFeedEventAt("not-a-date")).toBe(0);
  });

  it("builds replay URLs from durable cursors before falling back to timestamp replay", () => {
    expect(worldFeedEventsUrl("/api/apps/ruby-high", {
      force: false,
      lastEventAt: 42,
      lastCursor: "world:cursor:42:world%3Aevent%3Aabc",
    })).toBe("/api/apps/ruby-high/world/events?limit=8&cursor=world%3Acursor%3A42%3Aworld%253Aevent%253Aabc&live=1&streamMs=25000&heartbeatMs=5000");

    expect(worldFeedEventsUrl("/api/apps/ruby-high", {
      force: false,
      lastEventAt: 42,
      lastCursor: "",
    })).toBe("/api/apps/ruby-high/world/events?limit=8&since=41&live=1&streamMs=25000&heartbeatMs=5000");

    expect(worldFeedEventsUrl("/api/apps/ruby-high", { force: true, lastEventAt: 42 })).toBe(
      "/api/apps/ruby-high/world/events?limit=8",
    );
  });

  it("formats public world event labels from authored labels before kind fallbacks", () => {
    expect(worldFeedEventDisplayLabel(null)).toBe("World event");
    expect(worldFeedEventDisplayLabel({ label: "Ruby started a class" })).toBe("Ruby started a class");
    expect(worldFeedEventDisplayLabel({
      kind: "room.goal-progress",
      complete: true,
      label: "Ruby filled a live class goal",
      rewardLabel: "Ruby earned a class-wide Study Spark",
    })).toBe("Ruby earned a class-wide Study Spark");
    expect(worldFeedEventDisplayLabel({ kind: "room.goal-progress" })).toBe("Live class progress");
    expect(worldFeedEventDisplayLabel({ kind: "comic.page-unlocked" })).toBe("Comic page unlocked");
    expect(worldFeedEventDisplayLabel({ kind: "relationship.ticked" })).toBe("Classmate bond shifted");
    expect(worldFeedEventDisplayLabel({ kind: "mash.axis-resolved" })).toBe("Classmate profile sharpened");
    expect(worldFeedEventDisplayLabel({ kind: "unknown.kind" })).toBe("School world changed");
  });

  it("formats public world event ages relative to an explicit clock", () => {
    const now = Date.UTC(2026, 5, 18, 12);
    expect(worldFeedEventAgeLabel(now, now)).toBe("now");
    expect(worldFeedEventAgeLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(worldFeedEventAgeLabel(now - 2 * 60 * 60_000, now)).toBe("2h");
    expect(worldFeedEventAgeLabel(now - 3 * 24 * 60 * 60_000, now)).toBe("3d");
    expect(worldFeedEventAgeLabel(now + 1000, now)).toBe("now");
  });

  it("formats public room summaries from roster and activity state", () => {
    const roster = [
      { id: "ruby", displayName: "Ruby" },
      { id: "professor-edward", name: "Professor Edward" },
    ];

    expect(worldFeedGradeLabel("9")).toBe("Freshman");
    expect(worldFeedGradeLabel("7")).toBe("Grade 7");
    expect(worldFeedGradeLabel("")).toBe("Grade");
    expect(worldFeedFacultyLabel("ruby", roster)).toBe("Ruby");
    expect(worldFeedFacultyLabel("professor-edward", roster)).toBe("Professor Edward");
    expect(worldFeedFacultyLabel("sally-science", roster)).toBe("sally-science");
    expect(worldFeedFacultyLabel("", roster)).toBe("Class");
    expect(worldFeedRoomTitle({ grade: "9", facultyId: "ruby" }, roster)).toBe("Freshman · Ruby");
    expect(worldFeedSummaryLabel(1, [{}])).toBe("1 student live · 1 room");
    expect(worldFeedSummaryLabel(3, [{}, {}])).toBe("3 students live · 2 rooms");
    expect(worldFeedSummaryLabel(3, [{}, {}], null, { studySparks: { total: 1 } })).toBe("3 students live · 2 rooms · 1 Study Spark");
    expect(worldFeedSummaryLabel(3, [{}, {}], null, { studySparks: { total: 2 } })).toBe("3 students live · 2 rooms · 2 Study Sparks");
    expect(worldFeedSummaryLabel(3, [{}, {}], null, {
      studySparks: { total: 1 },
      termProgress: { label: "Term Spark 1/3" },
    })).toBe("3 students live · 2 rooms · 1 Study Spark · Term Spark 1/3");
    expect(worldFeedSummaryLabel(3, [{}, {}], null, {
      studySparks: { total: 3 },
      termProgress: { label: "Term Level 1" },
    })).toBe("3 students live · 2 rooms · 3 Study Sparks · Term Level 1");
    expect(worldFeedSummaryLabel(3, 2)).toBe("3 students live · 2 rooms");
    expect(worldFeedSummaryLabel(3, 2, "offline")).toBe("World feed paused");
  });

  it("builds compact world panel view models for the DOM renderer", () => {
    const now = Date.UTC(2026, 5, 18, 12);
    const roster = [
      { id: "ruby", displayName: "Ruby" },
      { id: "sally-science", displayName: "Sally Science" },
    ];
    const state = {
      activeStudents: 3,
      activeRooms: [
        { grade: "9", facultyId: "ruby", activeStudents: 1 },
        { grade: "10", facultyId: "sally-science", activeStudents: 2, goal: { label: "Sally Science live class 2/3" } },
      ],
      events: [
        { id: "world:event:a", at: now - 60_000, label: "Ruby started class" },
        { id: "world:event:b", at: now - 2 * 60_000, kind: "comic.page-unlocked" },
      ],
      summary: { studySparks: { total: 1 } },
    };

    expect(worldFeedRoomViews(state.activeRooms, roster)).toEqual([
      { title: "Freshman · Ruby", meta: "1 student active" },
      { title: "Sophomore · Sally Science", meta: "Sally Science live class 2/3" },
    ]);
    expect(worldFeedEventViews(state.events, now)).toEqual([
      { id: "world:event:a", label: "Ruby started class", age: "1m" },
      { id: "world:event:b", label: "Comic page unlocked", age: "2m" },
    ]);
    expect(worldFeedPanelView(state, roster, now)).toEqual({
      summary: "3 students live · 2 rooms · 1 Study Spark",
      rooms: [
        { title: "Freshman · Ruby", meta: "1 student active" },
        { title: "Sophomore · Sally Science", meta: "Sally Science live class 2/3" },
      ],
      events: [
        { id: "world:event:a", label: "Ruby started class", age: "1m" },
        { id: "world:event:b", label: "Comic page unlocked", age: "2m" },
      ],
    });
  });

  it("limits world panel room and event view models for compact rendering", () => {
    const now = Date.UTC(2026, 5, 18, 12);
    const rooms = Array.from({ length: 7 }, (_v, i) => ({ grade: String(9 + i), facultyId: "ruby", activeStudents: i }));
    const events = Array.from({ length: 5 }, (_v, i) => ({ id: "world:event:" + i, at: now - i * 60_000, label: "Event " + i }));

    expect(worldFeedRoomViews(rooms, [], 2)).toHaveLength(2);
    expect(worldFeedEventViews(events, now, 2)).toEqual([
      { id: "world:event:0", label: "Event 0", age: "now" },
      { id: "world:event:1", label: "Event 1", age: "1m" },
    ]);
    expect(worldFeedPanelView({ activeStudents: 0, activeRooms: [], events: [], error: "offline" }, [], now)).toEqual({
      summary: "World feed paused",
      rooms: [],
      events: [],
    });
  });
});
