import { describe, expect, it } from "vitest";
import { createProfileCardView } from "../viewer-parts/profile-card-view.js";

const view = createProfileCardView({
  gradeLabels: {
    "9": "Freshman",
    "10": "Sophomore",
    "11": "Junior",
    "12": "Senior",
  },
  streakRequired: {
    "9": 1,
    "10": 2,
    "11": 3,
    "12": 4,
  },
  teachingFacultyLabels: {
    ruby: "Ruby",
    "sally-science": "Sally Science",
    "professor-edward": "Professor Edward",
  },
});

describe("profile card view models", () => {
  it("builds teacher profile and career cards from curated faculty metadata", () => {
    expect(view.teacherProfileCard({
      id: "sally-science",
      displayName: "Sally Science",
      accent: "#4ba3ff",
      bio: "Lab teacher",
      questionCount: 200,
    }, "/sally.png")).toEqual({
      role: "teacher",
      name: "Sally Science",
      subtitle: "Science Lab · physics, chemistry, biology, and Earth science",
      portraitUrl: "/sally.png",
      accent: "#4ba3ff",
      stats: { head: 3, heart: 0, hustle: 1, honor: 1 },
      quote: "I'd rather you be wrong with reasons than right by accident.",
      footer: {
        title: "Teaches",
        content: "Science Lab · physics, chemistry, biology, and Earth science",
      },
    });

    expect(view.teacherCareerCard({
      id: "sally-science",
      subjects: ["physics"],
      questionCount: 200,
    })).toEqual({
      badgeLabel: "teacher",
      name: "Teacher Card",
      subtitle: "Science Lab · physics, chemistry, biology, and Earth science",
      metrics: [
        { label: "role", value: "Teacher", detail: "teacher", met: true },
        { label: "subject", value: "Sally Science", detail: "classroom", met: true },
        { label: "questions", value: "200", detail: "available", met: false },
      ],
    });
  });

  it("builds active student profile and career cards with current arc progress", () => {
    const npc = {
      id: "ravi",
      grade: "9",
      currentRoom: "science",
      stats: { head: 2, heart: 1, hustle: 3, honor: 0 },
    };
    const arc = {
      grade: "10",
      completedGrades: ["9"],
      streak: { grade: "10", count: 1 },
    };

    expect(view.studentProfileCard({
      npc,
      student: { name: "Ravi", color: "#f90" },
      arc,
      portraitUrl: "/ravi.png",
    })).toEqual({
      role: "student",
      name: "Ravi",
      subtitle: "Sophomore · 1 daily classes · #science",
      portraitUrl: "/ravi.png",
      accent: "#f90",
      stats: { head: 2, heart: 1, hustle: 3, honor: 0 },
      quote: "OK so technically — wait, sorry, am i shouting again",
    });

    expect(view.studentCareerCard({ npc, arc })).toEqual({
      badgeLabel: "Sophomore",
      subtitle: "Sophomore · classmate",
      metrics: [
        { label: "year", value: "Sophomore", detail: "active grade", met: false },
        { label: "daily", value: "1/2", detail: "classes passed", met: false },
        { label: "room", value: "science", detail: "current room", met: false },
      ],
      progression: {
        graduated: false,
        rungs: [
          { grade: "9", label: "Freshman", streakReq: 1, state: "completed", streakProgress: undefined },
          { grade: "10", label: "Sophomore", streakReq: 2, state: "current", streakProgress: { have: 1, need: 2 } },
          { grade: "11", label: "Junior", streakReq: 3, state: "future", streakProgress: undefined },
          { grade: "12", label: "Senior", streakReq: 4, state: "future", streakProgress: undefined },
        ],
      },
    });
  });

  it("builds graduated student career cards with completed progression", () => {
    expect(view.studentCareerCard({
      npc: { id: "noor", currentRoom: "lounge" },
      arc: { graduated: true, completedGrades: ["9", "10", "11", "12"] },
    })).toEqual({
      badgeLabel: "graduated",
      subtitle: "Graduated · classmate",
      metrics: [
        { label: "status", value: "graduated", detail: "all four years complete", met: true },
        { label: "yearbook", value: "4/4", detail: "years saved", met: true },
        { label: "room", value: "lounge", detail: "last seen", met: false },
      ],
      progression: {
        graduated: true,
        rungs: [
          { grade: "9", label: "Freshman", streakReq: 1, state: "completed" },
          { grade: "10", label: "Sophomore", streakReq: 2, state: "completed" },
          { grade: "11", label: "Junior", streakReq: 3, state: "completed" },
          { grade: "12", label: "Senior", streakReq: 4, state: "completed" },
        ],
      },
    });
  });
});
