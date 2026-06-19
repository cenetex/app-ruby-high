import { describe, expect, it } from "vitest";
import { boardSubjectGradesTitleView, subjectGradeChipView } from "../viewer-parts/client-pure.js";

describe("boardSubjectGradesTitleView", () => {
  it("formats known, unknown, and missing grade summaries", () => {
    expect(boardSubjectGradesTitleView("9", { met: 2, total: 3 })).toBe("Freshman · 2/3 subjects cleared");
    expect(boardSubjectGradesTitleView("13", { met: 1, total: 4 })).toBe("Grade 13 · 1/4 subjects cleared");
    expect(boardSubjectGradesTitleView("", {})).toBe("Current year · 0/0 subjects cleared");
  });
});

describe("subjectGradeChipView", () => {
  it("marks passing grades as cleared", () => {
    expect(subjectGradeChipView({
      label: "Science",
      icon: "⚗",
      grade: "B",
    })).toEqual({
      className: "subject-grade-chip is-met",
      title: "Science: B subject cleared",
      ariaLabel: "Science: B subject cleared",
      iconText: "⚗",
      gradeText: "B",
    });
  });

  it("marks incomplete progress as pending", () => {
    expect(subjectGradeChipView({
      label: "Literature",
      icon: "✎",
      grade: "📚 1/3",
      pending: true,
    })).toMatchObject({
      className: "subject-grade-chip is-pending",
      title: "Literature: 📚 1/3 daily classes toward course grade",
      gradeText: "📚 1/3",
    });
  });

  it("keeps failing or missing grades actionable", () => {
    expect(subjectGradeChipView({
      label: "Homeroom",
      icon: "⌂",
      grade: "D",
    })).toMatchObject({
      className: "subject-grade-chip",
      title: "Homeroom: D needs C and daily classes",
    });

    expect(subjectGradeChipView({ label: "Guest" })).toMatchObject({
      className: "subject-grade-chip",
      title: "Guest: no subject grade yet",
      iconText: "□",
      gradeText: "—",
    });
  });
});
