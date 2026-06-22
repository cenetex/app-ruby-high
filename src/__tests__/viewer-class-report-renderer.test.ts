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
    letterGradeForScore: (score) => Number(score) >= 90 ? "A" : "C",
    letterGradePasses: (grade) => ["A", "B", "C", "✓"].includes(String(grade || "")),
    todayCorrectSummary: (today) => ({
      value: String((today as { correct?: number }).correct || 0) + "/" + String((today as { total?: number }).total || 0),
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
  it("renders a passed report card with metrics and teacher art", () => {
    const report = renderer({
      knownTeacherAssetId: () => "ruby",
    }).buildCard(
      { displayName: "Ruby" },
      "9",
      {
        displayName: "Ruby",
        today: { status: "complete", score: 93, correct: 9, total: 10 },
      },
    ) as unknown as FakeElement;

    expect(report.className).toBe("class-report-card is-passed");
    expect(textTree(report)).toEqual([
      "A",
      "Teacher Ruby",
      "daily class passed",
      "correct",
      "9/10",
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

  it("renders a needs-work report card and ignores incomplete progress", () => {
    const incomplete = renderer().buildCard({}, "9", { today: { status: "active", score: 20 } });
    const report = renderer().buildCard(
      {},
      "9",
      {
        displayName: "Sally",
        today: { status: "complete", letterGrade: "D", score: 62, correct: 3, total: 7 },
      },
    ) as unknown as FakeElement;

    expect(incomplete).toBeNull();
    expect(report.className).toBe("class-report-card needs-work");
    expect(textTree(report)).toContain("D");
    expect(textTree(report)).toContain("Teacher Sally");
    expect(textTree(report)).toContain("review open");
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
      "Homeroom reflection",
      "One short prompt before the next class.",
    ]);
    expect((practice as unknown as FakeElement).className).toBe("class-report-next is-practice");
    expect(textTree(practice as unknown as FakeElement)).toEqual([
      "Review open",
      "Extra review stays outside today's class record.",
    ]);
    expect((complete as unknown as FakeElement).className).toBe("class-report-next");
    expect(textTree(complete as unknown as FakeElement)).toEqual(["Daily class complete"]);
  });
});
