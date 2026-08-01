import { describe, expect, it } from "vitest";
import {
  classmateArcProgress,
  classmateArcProgressLabel,
  classmateArcStanding,
  classmateArcSubtitle,
  roomChannelRowViews,
  roomCompletionProgressLabel,
  roomCompletionProgressView,
} from "../viewer-parts/client-pure.js";

describe("viewer classmate arc pure helpers", () => {
  it("describes classmate standing relative to the current grade", () => {
    expect(classmateArcStanding({ rosterGrade: "10", npc: { currentRoom: "ruby" } }, "9", "Ruby")).toBe("ahead of you");
    expect(classmateArcStanding({ rosterGrade: "9", npc: { currentRoom: "ruby" } }, "10", "Ruby")).toBe("behind you");
    expect(classmateArcStanding({ rosterGrade: "10", npc: { currentRoom: "ruby" } }, "10", "Ruby")).toBe("#Ruby");
    expect(classmateArcStanding({ rosterGrade: "10" }, "10")).toBe("in your year");
    expect(classmateArcStanding({ arc: { graduated: true }, rosterGrade: "12" }, "10")).toBe("alumni");
    expect(classmateArcStanding({ rosterGrade: "unknown" }, "10")).toBe("");
  });

  it("builds classmate subtitles with graduated year counts", () => {
    expect(classmateArcSubtitle({ rosterGrade: "10", npc: { currentRoom: "ruby" } }, "10", "Ruby")).toBe("#Ruby");
    expect(classmateArcSubtitle({
      rosterGrade: "12",
      arc: { graduated: true, completedGrades: ["9", "10", "11", "12"] },
    }, "10")).toBe("alumni · 4 years");
  });

  it("builds and labels classmate year progress", () => {
    const progress = classmateArcProgress({
      rosterGrade: "11",
      arc: { streak: { count: 10 } },
    });
    expect(progress).toEqual({ value: 3, total: 3 });
    expect(classmateArcProgressLabel(progress)).toBe("Year progress 3 of 3");
    expect(classmateArcProgress({
      rosterGrade: "11",
      arc: { graduated: true, streak: { count: 3 } },
    })).toBeNull();
    expect(classmateArcProgressLabel(null)).toBe("");
  });

  it("builds and labels room completion progress", () => {
    const progress = roomCompletionProgressView({
      shortName: "Ruby",
      requiredClasses: 3,
      completedClasses: 8,
    });

    expect(progress).toEqual({ value: 3, total: 3 });
    expect(roomCompletionProgressLabel({ shortName: "Ruby" }, progress)).toBe("Ruby daily classes 3 of 3");
    expect(roomCompletionProgressLabel({ displayName: "Sally Science" }, { value: 1, total: 2 })).toBe("Sally Science daily classes 1 of 2");
    expect(roomCompletionProgressView({ requiredClasses: 0, completedClasses: 2 })).toBeNull();
    expect(roomCompletionProgressView(null)).toBeNull();
  });

  it("builds live-room channel row view models with visible cohort chips", () => {
    const views = roomChannelRowViews(
      [
        { id: "homeroom", channelName: "homeroom", teacherId: "ruby", teaches: true },
        { id: "lounge", channelName: "lounge", teacherId: "lounge", teaches: false },
        { id: "science", channelName: "science", teacherId: "sally-science", teaches: true },
      ],
      [
        { id: "ruby", shortName: "Ruby", completedClasses: 2, requiredClasses: 3 },
        { id: "sally-science", displayName: "Sally Science", completedClasses: 1, requiredClasses: 2 },
      ],
      {
        homeroom: ["noor", "lyra", "hidden"],
        science: ["mika"],
      },
      "ruby",
      [
        { id: "noor", name: "Noor" },
        { id: "lyra", name: "Lyra" },
        { id: "mika", name: "Mika" },
        { id: "hidden", name: "Hidden Kid" },
      ],
      ["noor", "lyra", "mika"],
      [{
        id: "world:session:abc123abc123abcd",
        name: "Sloan",
        facultyId: "ruby",
        portraitUrl: "/api/apps/ruby-high/assets/portrait/sloan.png",
      }],
    );

    expect(views).toEqual([
      {
        roomId: "homeroom",
        facultyId: "ruby",
        channelName: "homeroom",
        isActive: true,
        completionProgress: { value: 2, total: 3 },
        completionLabel: "Ruby daily classes 2 of 3",
        students: [
          { id: "noor", name: "Noor" },
          { id: "lyra", name: "Lyra" },
          {
            id: "world:session:abc123abc123abcd",
            name: "Sloan",
            facultyId: "ruby",
            portraitUrl: "/api/apps/ruby-high/assets/portrait/sloan.png",
            kind: "human",
          },
        ],
      },
      {
        roomId: "science",
        facultyId: "sally-science",
        channelName: "science",
        isActive: false,
        completionProgress: { value: 1, total: 2 },
        completionLabel: "Sally Science daily classes 1 of 2",
        students: [{ id: "mika", name: "Mika" }],
      },
    ]);
  });
});
