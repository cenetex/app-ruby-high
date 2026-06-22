import { describe, expect, it } from "vitest";
import { arcIndicatorView } from "../viewer-parts/client-pure.js";

describe("viewer arc indicator pure helpers", () => {
  it("hides the arc indicator before a character and grade exist", () => {
    expect(arcIndicatorView({}, { met: 0, total: 3 })).toEqual({
      hidden: true,
      graduated: false,
      yearText: "",
      streakText: "",
      streakMet: false,
      subjectText: "",
      subjectMet: false,
    });
  });

  it("builds active grade arc labels and met flags", () => {
    expect(arcIndicatorView({
      current_grade: "10",
      character: { streak: { grade: "10", count: 2 }, yearbook: [{ grade: "9" }] },
    }, { met: 3, total: 3 })).toEqual({
      hidden: false,
      graduated: false,
      yearText: "Sophomore",
      streakText: "📚 2/2",
      streakMet: true,
      subjectText: "✅ 3/3",
      subjectMet: true,
    });
  });

  it("resets the streak display when the streak belongs to another grade", () => {
    expect(arcIndicatorView({
      current_grade: "11",
      character: { streak: { grade: "10", count: 2 }, yearbook: [{ grade: "9" }, { grade: "10" }] },
    }, { met: 1, total: 3 })).toMatchObject({
      yearText: "Junior",
      streakText: "📚 0/3",
      streakMet: false,
      subjectText: "✅ 1/3",
      subjectMet: false,
    });
  });

  it("builds graduated arc labels", () => {
    expect(arcIndicatorView({
      current_grade: "12",
      character: { yearbook: [{}, {}, {}, {}] },
    }, { met: 0, total: 3 })).toEqual({
      hidden: false,
      graduated: true,
      yearText: "Graduated",
      streakText: "🎓",
      streakMet: false,
      subjectText: "✅",
      subjectMet: false,
    });
  });
});
