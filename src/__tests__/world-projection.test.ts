import { describe, expect, it } from "vitest";
import {
  buildPublicWorldCohorts,
  buildPublicWorldRooms,
  publicSchoolWorldActorId,
  publicSchoolWorldEvent,
  publicWorldDisplayName,
  publicWorldEventLabel,
  publicWorldEventFaculty,
  publicWorldGrade,
  publicWorldNameReview,
  publicWorldPlaybookId,
  publicWorldPortraitUrl,
  publicWorldRoomGoalEvents,
  publicWorldRoomDisplayName,
  publicWorldRoomId,
  publicWorldSessionId,
  type PublicWorldPresenceEntry,
} from "../services/ruby-high/world-projection.js";

function entry(input: Partial<PublicWorldPresenceEntry> & {
  sessionId: string;
  grade: PublicWorldPresenceEntry["grade"];
  facultyId: string;
}): PublicWorldPresenceEntry {
  return {
    displayName: input.facultyId,
    name: input.sessionId,
    playbookId: "lifer",
    stats: { head: 1, heart: 2, hustle: 3, honor: 4 },
    classGrades: {},
    yearbookCount: 0,
    lastActive: 1,
    ...input,
  };
}

describe("public world projection", () => {
  it("sanitizes portrait urls to same-origin paths only", () => {
    expect(publicWorldPortraitUrl("/api/apps/ruby-high/assets/portrait/noor.png")).toBe("/api/apps/ruby-high/assets/portrait/noor.png");
    expect(publicWorldPortraitUrl("data:image/png;base64,INLINE")).toBeUndefined();
    expect(publicWorldPortraitUrl("https://example.test/noor.png")).toBeUndefined();
    expect(publicWorldPortraitUrl("//example.test/noor.png")).toBeUndefined();
    expect(publicWorldPortraitUrl("/api/apps/ruby-high/assets/portrait/noor.png\nx")).toBeUndefined();
    expect(publicWorldPortraitUrl("")).toBeUndefined();
  });

  it("normalizes public event labels for compact world feed display", () => {
    expect(publicWorldEventLabel("  Ruby\n\taced\u0000the room  ")).toBe("Ruby aced the room");
    expect(publicWorldEventLabel("", "Comic page unlocked")).toBe("Comic page unlocked");
    expect(publicWorldEventLabel("x".repeat(120))).toBe(`${"x".repeat(93)}...`);
  });

  it("normalizes public student display names for rooms and cohorts", () => {
    expect(publicWorldDisplayName("  Noor\n\tSol\u0000  ")).toBe("Noor Sol");
    expect(publicWorldDisplayName("", "Student")).toBe("Student");
    expect(publicWorldDisplayName("x".repeat(80))).toBe(`${"x".repeat(45)}...`);
    expect(publicWorldPlaybookId("  overachiever\n\u0000  ")).toBe("overachiever");
    expect(publicWorldPlaybookId("")).toBe("student");

    const result = buildPublicWorldRooms([
      entry({
        sessionId: "s1",
        grade: "10",
        facultyId: "ruby",
        displayName: "Ruby",
        name: "  Noor\n\tSol\u0000  ",
        playbookId: "  overachiever\n\u0000  ",
      }),
    ]);
    expect(result.activeRooms[0]?.students[0]?.name).toBe("Noor Sol");
    expect(result.activeRooms[0]?.students[0]?.playbookId).toBe("overachiever");
    expect(buildPublicWorldCohorts([
      entry({ sessionId: "s1", grade: "10", facultyId: "ruby", name: "", playbookId: "" }),
    ])["10"]?.[0]).toMatchObject({ name: "Student", playbookId: "student" });
  });

  it("reviews public student names before projection", () => {
    expect(publicWorldNameReview("Noor Sol")).toMatchObject({ ok: true, displayName: "Noor Sol", reason: null });
    expect(publicWorldNameReview(" ")).toMatchObject({ ok: false, reason: "empty" });
    expect(publicWorldNameReview("Admin")).toMatchObject({ ok: false, reason: "reserved" });
    expect(publicWorldNameReview("noor@example.test")).toMatchObject({ ok: false, reason: "contact" });
    expect(publicWorldNameReview("www.noor.test")).toMatchObject({ ok: false, reason: "contact" });
    expect(publicWorldNameReview("shit name")).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("normalizes malformed public grades before grouping", () => {
    expect(publicWorldGrade("10")).toBe("10");
    expect(publicWorldGrade("13")).toBe("9");
    expect(publicWorldGrade(null, null)).toBeNull();

    const result = buildPublicWorldRooms([
      entry({ sessionId: "s1", grade: "13" as never, facultyId: "ruby", displayName: "Ruby", name: "Noor" }),
      entry({ sessionId: "s2", grade: "9", facultyId: "ruby", displayName: "Ruby", name: "Mina" }),
    ]);

    expect(result.activeRooms).toHaveLength(1);
    expect(result.activeRooms[0]).toMatchObject({
      grade: "9",
      activeStudents: 2,
    });
    expect(result.activeRooms[0]?.students.map((student) => student.grade)).toEqual(["9", "9"]);
    expect(buildPublicWorldCohorts([
      entry({ sessionId: "s1", grade: "13" as never, facultyId: "ruby", name: "Noor" }),
    ])).toHaveProperty("9");
  });

  it("keeps public student numeric and grade fields JSON-safe", () => {
    const result = buildPublicWorldRooms([
      entry({
        sessionId: "s1",
        grade: "10",
        facultyId: "ruby",
        displayName: "Ruby",
        stats: { head: Number.NaN, heart: Number.POSITIVE_INFINITY, hustle: -4.8, honor: 3.9 },
        classGrades: {
          "ruby\nlab": " A+\nwith honors forever ",
          "": "B",
          noisy: "\u0000",
        },
        yearbookCount: Number.POSITIVE_INFINITY,
        lastActive: Number.NaN,
      }),
    ]);

    expect(result.activeRooms[0]?.students[0]).toMatchObject({
      stats: { head: 0, heart: 0, hustle: 0, honor: 3 },
      classGrades: { "ruby lab": "A+ wi..." },
      yearbookCount: 0,
      lastActive: 0,
    });
    expect(JSON.stringify(result)).not.toContain("null");
    expect(JSON.stringify(result)).not.toContain("Infinity");
    expect(JSON.stringify(result)).not.toContain("NaN");
    expect(JSON.stringify(result)).not.toContain("\n");
    expect(JSON.stringify(result)).not.toContain("\u0000");
  });

  it("keeps malformed student stat and class-grade containers from breaking public projection", () => {
    const result = buildPublicWorldRooms([
      entry({
        sessionId: "s1",
        grade: "10",
        facultyId: "ruby",
        displayName: "Ruby",
        name: "Noor",
        stats: null as never,
        classGrades: null as never,
      }),
      entry({
        sessionId: "s2",
        grade: "10",
        facultyId: "ruby",
        displayName: "Ruby",
        name: "Mina",
        stats: "not-stats" as never,
        classGrades: ["A"] as never,
      }),
    ]);

    expect(result.activeRooms[0]?.students.map((student) => ({
      name: student.name,
      stats: student.stats,
      classGrades: student.classGrades,
    }))).toEqual([
      {
        name: "Mina",
        stats: { head: 0, heart: 0, hustle: 0, honor: 0 },
        classGrades: {},
      },
      {
        name: "Noor",
        stats: { head: 0, heart: 0, hustle: 0, honor: 0 },
        classGrades: {},
      },
    ]);

    expect(buildPublicWorldCohorts([
      entry({
        sessionId: "s1",
        grade: "10",
        facultyId: "ruby",
        name: "Noor",
        stats: null as never,
        classGrades: null as never,
      }),
    ])["10"]?.[0]).toMatchObject({
      stats: { head: 0, heart: 0, hustle: 0, honor: 0 },
      classGrades: {},
    });
  });

  it("normalizes public room ids and display names before grouping", () => {
    expect(publicWorldRoomId("  ruby\nlab\u0000  ")).toBe("ruby lab");
    expect(publicWorldRoomId("")).toBe("class");
    expect(publicWorldRoomDisplayName("  Ruby\nLab\u0000  ")).toBe("Ruby Lab");
    expect(publicWorldRoomDisplayName("", "ruby")).toBe("ruby");

    const result = buildPublicWorldRooms([
      entry({ sessionId: "s1", grade: "10", facultyId: "  ruby\nlab\u0000  ", displayName: "  Ruby\nLab\u0000  ", name: "Noor" }),
      entry({ sessionId: "s2", grade: "10", facultyId: "ruby lab", displayName: "Ruby Lab", name: "Mina" }),
    ]);

    expect(result.activeRooms).toHaveLength(1);
    expect(result.activeRooms[0]).toMatchObject({
      facultyId: "ruby lab",
      displayName: "Ruby Lab",
      activeStudents: 2,
    });
    expect(JSON.stringify(result)).not.toContain("\n");
    expect(JSON.stringify(result)).not.toContain("\u0000");
  });

  it("admits only usable session ids into public world presence", () => {
    expect(publicWorldSessionId("  session:abc  ")).toBe("session:abc");
    expect(publicWorldSessionId("")).toBeUndefined();
    expect(publicWorldSessionId("session:\u0000abc")).toBeUndefined();

    const result = buildPublicWorldRooms([
      entry({ sessionId: "session:valid", grade: "10", facultyId: "ruby", name: "Noor" }),
      entry({ sessionId: "   ", grade: "10", facultyId: "ruby", name: "Blank" }),
      entry({ sessionId: "session:\u0000bad", grade: "10", facultyId: "ruby", name: "Bad" }),
    ]);

    expect(result.activeStudents).toBe(1);
    expect(result.activeRooms[0]?.students.map((student) => student.name)).toEqual(["Noor"]);
    expect(Array.from(result.publicSessionIds)).toEqual(["session:valid"]);
    expect(buildPublicWorldCohorts([
      entry({ sessionId: "session:valid", grade: "10", facultyId: "ruby", name: "Noor" }),
      entry({ sessionId: "session:\u0000bad", grade: "10", facultyId: "ruby", name: "Bad" }),
    ])["10"]?.map((student) => student.name)).toEqual(["Noor"]);
  });

  it("normalizes public event faculty ids", () => {
    expect(publicWorldEventFaculty("  ruby\nlab\u0000  ")).toBe("ruby lab");
    expect(publicWorldEventFaculty("")).toBeUndefined();

    expect(publicSchoolWorldEvent({
      id: "school:event:faculty-clean",
      kind: "comic.page-unlocked",
      at: 1,
      faculty: "  ruby\nlab\u0000  ",
      grade: "9",
      issueId: "first-bell",
      pageId: "first-bell-page-01",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:9",
      label: "Page",
    })).toMatchObject({
      kind: "comic.page-unlocked",
      faculty: "ruby lab",
    });
  });

  it("builds sorted room aggregates with capped public student samples", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "s1", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Noor", lastActive: 300, portraitUrl: "/p/noor.png" }),
      entry({ sessionId: "s2", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Mina", lastActive: 200, portraitUrl: "data:image/png;base64,PRIVATE" }),
      entry({ sessionId: "s3", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Sol", lastActive: 100 }),
      entry({ sessionId: "s4", grade: "9", facultyId: "sally", displayName: "Sally", name: "Ari" }),
      entry({ sessionId: "s5", grade: "10", facultyId: "edward", displayName: "Edward", name: "June" }),
    ], 2);

    expect(result.activeStudents).toBe(5);
    expect(Array.from(result.publicSessionIds).sort()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(result.activeRooms.map((room) => `${room.grade}:${room.displayName}:${room.activeStudents}`)).toEqual([
      "9:Sally:1",
      "10:Ruby:3",
      "10:Edward:1",
    ]);
    expect(result.activeRooms[1]?.students.map((student) => student.name)).toEqual(["Noor", "Mina"]);
    expect(result.activeRooms[1]?.students[0]).toMatchObject({
      name: "Noor",
      portraitUrl: "/p/noor.png",
    });
    expect(result.activeRooms[1]?.students[1]).not.toHaveProperty("portraitUrl");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("adds shared live-class goals to public room aggregates", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "private-session-1", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Noor", lastActive: 300 }),
      entry({ sessionId: "private-session-2", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Mina", lastActive: 500 }),
    ]);

    expect(result.activeRooms[0]?.goal).toEqual({
      kind: "live-class",
      label: "Ruby live class 2/3",
      progress: 2,
      target: 3,
      complete: false,
      updatedAt: 500,
    });
  });

  it("uses explicit room-goal contributions when present", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "private-session-1", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Noor", lastActive: 300 }),
      entry({ sessionId: "private-session-2", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Mina", lastActive: 500 }),
      entry({ sessionId: "private-session-3", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Sol", lastActive: 600 }),
    ], 5, 24, [{
      grade: "10",
      facultyId: "ruby",
      amount: 2,
      updatedAt: 700,
    }]);

    expect(result.activeRooms[0]).toMatchObject({
      activeStudents: 3,
      goal: {
        kind: "live-class",
        label: "Ruby live class 2/3",
        progress: 2,
        target: 3,
        complete: false,
        updatedAt: 700,
      },
    });
  });

  it("renders term momentum room-goal rules from explicit contributions", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "private-session-1", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Noor", lastActive: 300 }),
      entry({ sessionId: "private-session-2", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Mina", lastActive: 500 }),
    ], 5, 24, [{
      grade: "10",
      facultyId: "ruby",
      amount: 2,
      target: 2,
      updatedAt: 700,
      ruleLabel: "Term Momentum",
    }]);

    expect(result.activeRooms[0]).toMatchObject({
      activeStudents: 2,
      goal: {
        kind: "live-class",
        label: "Ruby live class 2/2 · Term Momentum",
        progress: 2,
        target: 2,
        complete: true,
        updatedAt: 700,
        ruleLabel: "Term Momentum",
      },
    });
    expect(publicWorldRoomGoalEvents(result.activeRooms)).toEqual([
      expect.objectContaining({
        kind: "room.goal-progress",
        progress: 2,
        target: 2,
        complete: true,
        ruleLabel: "Term Momentum",
        rewardLabel: "Ruby earned a class-wide Study Spark",
      }),
    ]);
  });

  it("builds sanitized room-goal progress events without private student ids", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "private-session-1", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Noor", lastActive: 300 }),
      entry({ sessionId: "private-session-2", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Mina", lastActive: 500 }),
      entry({ sessionId: "private-session-3", grade: "10", facultyId: "ruby", displayName: "Ruby", name: "Sol", lastActive: 400 }),
    ]);

    const events = publicWorldRoomGoalEvents(result.activeRooms);

    expect(events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^world:event:[a-f0-9]{16}$/),
        kind: "room.goal-progress",
        at: 500,
        faculty: "ruby",
        grade: "10",
        roomTitle: "Ruby room",
        goalKind: "live-class",
        progress: 3,
        target: 3,
        complete: true,
        label: "Ruby filled a live class goal",
        rewardLabel: "Ruby earned a class-wide Study Spark",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private-session");
    expect(JSON.stringify(events)).not.toContain("Noor");
    expect(JSON.stringify(events)).not.toContain("Mina");
    expect(JSON.stringify(events)).not.toContain("Sol");
  });

  it("samples each room by recent activity instead of insertion order", () => {
    const result = buildPublicWorldRooms([
      entry({ sessionId: "s1", grade: "10", facultyId: "ruby", name: "Old Noor", lastActive: 1000, yearbookCount: 10 }),
      entry({ sessionId: "s2", grade: "10", facultyId: "ruby", name: "Newest Mina", lastActive: 3000 }),
      entry({ sessionId: "s3", grade: "10", facultyId: "ruby", name: "Middle Sol", lastActive: 2000 }),
      entry({ sessionId: "s4", grade: "10", facultyId: "ruby", name: "Alpha Tie", lastActive: 2000, yearbookCount: 2 }),
      entry({ sessionId: "s5", grade: "10", facultyId: "ruby", name: "Beta Tie", lastActive: 2000, yearbookCount: 2 }),
    ], 3);

    expect(result.activeRooms[0]?.activeStudents).toBe(5);
    expect(result.activeRooms[0]?.students.map((student) => student.name)).toEqual([
      "Newest Mina",
      "Alpha Tie",
      "Beta Tie",
    ]);
  });

  it("caps public room samples without losing total activity or event visibility ids", () => {
    const rows = Array.from({ length: 30 }, (_, i) => entry({
      sessionId: `s${i}`,
      grade: "10" as const,
      facultyId: `faculty-${String(i).padStart(2, "0")}`,
      displayName: `Faculty ${String(i).padStart(2, "0")}`,
      name: `Student ${i}`,
      lastActive: 1000 + i,
    }));

    const result = buildPublicWorldRooms(rows, 1, 8);

    expect(result.activeStudents).toBe(30);
    expect(result.activeRooms).toHaveLength(8);
    expect(result.activeRooms.map((room) => room.facultyId)).toEqual([
      "faculty-00",
      "faculty-01",
      "faculty-02",
      "faculty-03",
      "faculty-04",
      "faculty-05",
      "faculty-06",
      "faculty-07",
    ]);
    expect(Array.from(result.publicSessionIds)).toHaveLength(30);
    expect(result.publicSessionIds.has("s29")).toBe(true);
  });

  it("builds grade cohorts from already-public presence entries", () => {
    expect(buildPublicWorldCohorts([
      entry({ sessionId: "s1", grade: "12", facultyId: "edward", name: "Noor" }),
      entry({ sessionId: "s2", grade: "9", facultyId: "ruby", name: "Mina" }),
      entry({ sessionId: "s3", grade: "12", facultyId: "ruby", name: "Sol" }),
    ])).toMatchObject({
      "9": [{ name: "Mina" }],
      "12": [{ name: "Noor" }, { name: "Sol" }],
    });
  });

  it("uses stable non-raw actor ids for public events", () => {
    const actorId = publicSchoolWorldActorId("session:private-student-id");

    expect(actorId).toMatch(/^world:actor:[a-f0-9]{12}$/);
    expect(actorId).toBe(publicSchoolWorldActorId("session:private-student-id"));
    expect(actorId).not.toContain("private-student-id");
  });

  it("keeps relationship event numerics JSON-safe", () => {
    const projected = publicSchoolWorldEvent({
      id: "school:event:bad-relationship",
      kind: "relationship.ticked",
      at: Number.NaN,
      grade: "13",
      questionId: "question:private-id",
      studentId: "student:raw-private-id",
      delta: 99,
      reason: "private-future-reason",
      affinity: Number.POSITIVE_INFINITY,
      circled: "yes",
      scratched: 1,
    } as never);

    expect(projected).toMatchObject({
      kind: "relationship.ticked",
      at: 0,
      grade: null,
      delta: 0,
      reason: "pep-talk",
      affinity: 0,
      circled: false,
      scratched: false,
    });
    expect(JSON.stringify(projected)).not.toContain("raw-private-id");
    expect(JSON.stringify(projected)).not.toContain("question:private-id");
    expect(JSON.stringify(projected)).not.toContain("Infinity");
    expect(JSON.stringify(projected)).not.toContain("NaN");
  });

  it("keeps comic unlock labels public-feed safe", () => {
    expect(publicSchoolWorldEvent({
      id: "school:event:comic-label",
      kind: "comic.page-unlocked",
      at: 1,
      grade: "9",
      issueId: "first-bell",
      pageId: "first-bell-page-01",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:9",
      label: "  First\nBell\u0000Page  ",
    })).toMatchObject({
      kind: "comic.page-unlocked",
      label: "First Bell Page",
    });

    const projected = publicSchoolWorldEvent({
      id: "school:event:comic-metadata",
      kind: "comic.page-unlocked",
      at: 1,
      grade: "9",
      issueId: `  ${"private-issue ".repeat(8)}\nsecret\u0000  `,
      pageId: "  page\nsecret\u0000  ",
      pageNumber: Number.POSITIVE_INFINITY,
      reason: "raw-future-reason",
      sourceId: "teacher:ruby:grade:9",
      label: "Page",
    } as never);
    expect(projected).toMatchObject({
      kind: "comic.page-unlocked",
      pageId: "page secret",
      pageNumber: 0,
      reason: "legacy",
    });
    expect(projected.kind).toBe("comic.page-unlocked");
    if (projected.kind !== "comic.page-unlocked") throw new Error("expected comic event");
    expect(projected.issueId).toHaveLength(64);
    expect(projected.issueId.endsWith("...")).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("\n");
    expect(JSON.stringify(projected)).not.toContain("\u0000");
    expect(JSON.stringify(projected)).not.toContain("Infinity");
  });

  it("keeps MASH axis values public-feed safe", () => {
    const projected = publicSchoolWorldEvent({
      id: "school:event:mash-value",
      kind: "mash.axis-resolved",
      at: 1,
      grade: "9",
      axis: "private-future-axis",
      studentId: "student:raw-private-id",
      value: `  ${"School cartographer ".repeat(8)}\nsecret\u0000  `,
    } as never);

    expect(projected.kind).toBe("mash.axis-resolved");
    if (projected.kind !== "mash.axis-resolved") throw new Error("expected MASH event");
    expect(projected.axis).toBe("lucky");
    expect(projected.value).toHaveLength(96);
    expect(projected.value.endsWith("...")).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("raw-private-id");
    expect(JSON.stringify(projected)).not.toContain("\n");
    expect(JSON.stringify(projected)).not.toContain("\u0000");
  });
});
