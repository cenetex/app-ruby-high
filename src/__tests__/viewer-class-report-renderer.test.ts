import { describe, expect, it } from "vitest";
import { createClassReportRenderer } from "../viewer-parts/class-report.js";

class FakeElement {
  className = "";
  textContent = "";
  alt = "";
  decoding = "";
  loading = "";
  src = "";
  onerror: (() => void) | null = null;
  removed = false;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function renderer(overrides?: Partial<Parameters<typeof createClassReportRenderer>[0]>) {
  return createClassReportRenderer({
    document: createDocument(),
    teacherShortName: (_faculty, fallback) => fallback || "Ruby",
    gradeLabel: (grade) => String(grade) === "9" ? "Freshman" : "Grade " + String(grade),
    letterGradeForScore: (score) => Number(score) >= 90 ? "A" : "C",
    letterGradePasses: (grade) => ["A", "B", "C", "✓"].includes(String(grade || "")),
    todayCorrectSummary: (today) => ({
      value: String((today as { correctCount?: number }).correctCount || 0) + "/" + String((today as { totalQuestions?: number }).totalQuestions || 0),
      detail: "questions answered",
    }),
    formatClassScore: (score) => String(score) + "%",
    postClassState: () => ({}),
    guestSignupRequired: () => false,
    knownTeacherAssetId: () => null,
    teacherAssetUrl: (id, variant) => "/assets/teachers/" + id + "-" + variant + ".png",
    ...overrides,
  });
}

describe("class report renderer", () => {
  it("renders the durable class-result hierarchy with teacher art", () => {
    const report = renderer({
      knownTeacherAssetId: () => "ruby",
    }).buildCard(
      { displayName: "Ruby" },
      "9",
      {
        displayName: "Ruby",
        completedClasses: 1,
        requiredClasses: 3,
        today: {
          status: "complete",
          score: 93,
          correctCount: 3,
          totalQuestions: 3,
          result: {
            prompt: "Which source best supports the claim?",
            wasCorrect: true,
            forfeit: false,
            teacherObservation: "Ruby noticed that “The primary source” matched what the final research prompt asked for.",
            consequenceLabel: "Passing class recorded",
            consequenceDetail: "Freshman with Ruby: A, 3 of 3 graded cards correct.",
            completedClasses: 1,
            requiredClasses: 3,
          },
        },
      },
    ) as unknown as FakeElement;

    expect(report.className).toBe("class-report-card is-passed");
    expect(textTree(report)).toEqual([
      "A",
      "Ruby class result",
      "Class passed · final response met · Freshman · 3/3",
      "Final prompt: Which source best supports the claim?",
      "What Ruby noticed",
      "Ruby noticed that “The primary source” matched what the final research prompt asked for.",
      "Passing class recorded",
      "Freshman with Ruby: A, 3 of 3 graded cards correct.",
      "Course progress",
      "1 of 3 passing Ruby class days are recorded for Freshman. 2 more days to clear the course.",
      "correct",
      "3/3",
      "questions answered",
      "score",
      "93%",
      "grade score",
    ]);
    const art = (report.children[0] as FakeElement).children[2] as FakeElement;
    expect(art.className).toBe("class-report-teacher-art");
    const img = art.children[0]!;
    expect(img.tagName).toBe("img");
    expect(img.decoding).toBe("async");
    expect(img.loading).toBe("lazy");
    expect(img.src).toBe("/assets/teachers/ruby-full-sticker.png");

    img.onerror?.();
    expect(art.removed).toBe(true);
  });

  it("renders a deterministic legacy fallback and ignores incomplete progress", () => {
    const incomplete = renderer().buildCard({}, "9", { today: { status: "active", score: 20 } });
    const report = renderer().buildCard(
      {},
      "9",
      {
        displayName: "Sally",
        completedClasses: 0,
        requiredClasses: 3,
        today: { status: "complete", letterGrade: "D", score: 62, correctCount: 1, totalQuestions: 3 },
      },
    ) as unknown as FakeElement;

    expect(incomplete).toBeNull();
    expect(report.className).toBe("class-report-card needs-work");
    expect(textTree(report)).toContain("D");
    expect(textTree(report)).toContain("Sally class result");
    expect(textTree(report)).toContain("Class needs review · Freshman · 1/3");
    expect(textTree(report)).toContain("Sally recorded 1/3 on today’s graded cards.");
    expect(textTree(report)).toContain("0 of 3 passing Sally class days are recorded for Freshman. 3 more days to clear the course.");
  });

  it("renders next-step copy for signup, social, practice, and complete states", () => {
    const signup = renderer({ guestSignupRequired: () => true }).buildNextStep({});
    const social = renderer({ postClassState: () => ({ socialReady: true }) }).buildNextStep({});
    const practice = renderer({ postClassState: () => ({ practiceReady: true }) }).buildNextStep({});
    const complete = renderer().buildNextStep({});

    expect((signup as unknown as FakeElement).className).toBe("class-report-next is-signup");
    expect(textTree(signup as unknown as FakeElement)).toEqual([
      "Sign up to continue",
      "Your guest lesson is complete. Keep your student and unlock the rest of Ruby High.",
    ]);
    expect((social as unknown as FakeElement).className).toBe("class-report-next is-social");
    expect(textTree(social as unknown as FakeElement)).toEqual([
      "Finish today’s reflection",
      "Then practice stays open; return tomorrow for the next graded class.",
    ]);
    expect((practice as unknown as FakeElement).className).toBe("class-report-next is-practice");
    expect(textTree(practice as unknown as FakeElement)).toEqual([
      "Practice is open now",
      "It will not change today’s class record. Return tomorrow for the next graded class.",
    ]);
    expect((complete as unknown as FakeElement).className).toBe("class-report-next");
    expect(textTree(complete as unknown as FakeElement)).toEqual([
      "Today’s graded class is recorded",
      "Return tomorrow for the next graded class.",
    ]);
  });
});
