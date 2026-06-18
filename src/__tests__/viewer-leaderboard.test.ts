import { describe, expect, it } from "vitest";
import {
  leaderboardFacultyLabel,
  leaderboardGradeChips,
  leaderboardPlaybookName,
  leaderboardRowView,
  leaderboardView,
} from "../viewer-parts/client-pure.js";

describe("viewer leaderboard pure helpers", () => {
  const playbooks = [
    { id: "captain", name: "Captain" },
    { id: "scholar", name: "Scholar" },
  ];

  it("builds compact leaderboard view rows", () => {
    expect(leaderboardView({
      grade: "10",
      students: [
        {
          name: "Mina Park",
          portraitUrl: "https://example.com/mina.png",
          playbookId: "captain",
          classGrades: { ruby: "A", "sally-science": "B", "professor-edward": "C", extra: "D" },
        },
        {
          name: "Noor",
          playbookId: "custom-playbook",
        },
      ],
    }, playbooks)).toEqual({
      empty: false,
      gradeLabel: "Sophomore",
      count: 2,
      rows: [
        {
          rank: "1",
          rankClass: "leaderboard-rank rank-1",
          name: "Mina Park",
          portraitUrl: "https://example.com/mina.png",
          avatarText: "M",
          playbookName: "Captain",
          gradeChips: [
            { className: "leaderboard-grade-chip is-A", text: "Ruby A" },
            { className: "leaderboard-grade-chip is-B", text: "Sally B" },
            { className: "leaderboard-grade-chip is-C", text: "Edward C" },
          ],
        },
        {
          rank: "2",
          rankClass: "leaderboard-rank rank-2",
          name: "Noor",
          portraitUrl: "",
          avatarText: "N",
          playbookName: "custom-playbook",
          gradeChips: [],
        },
      ],
    });
  });

  it("builds empty and fallback leaderboard values", () => {
    expect(leaderboardView(null, playbooks)).toEqual({
      empty: true,
      gradeLabel: "Freshman",
      count: 0,
      rows: [],
    });
    expect(leaderboardRowView({ name: "", classGrades: null }, 4, [])).toEqual({
      rank: "5",
      rankClass: "leaderboard-rank rank-n",
      name: "—",
      portraitUrl: "",
      avatarText: "—",
      playbookName: "—",
      gradeChips: [],
    });
  });

  it("formats leaderboard playbooks, faculty labels, and grade chips", () => {
    expect(leaderboardPlaybookName("scholar", playbooks)).toBe("Scholar");
    expect(leaderboardPlaybookName("solo", playbooks)).toBe("solo");
    expect(leaderboardPlaybookName("", playbooks)).toBe("—");
    expect(leaderboardFacultyLabel("sally-science")).toBe("Sally");
    expect(leaderboardFacultyLabel("guest")).toBe("guest");
    expect(leaderboardGradeChips({ ruby: "A+", guest: "Pass" })).toEqual([
      { className: "leaderboard-grade-chip is-A", text: "Ruby A+" },
      { className: "leaderboard-grade-chip is-P", text: "guest Pass" },
    ]);
  });
});
