import { describe, expect, it } from "vitest";
import { createBoardStatusRenderer } from "../viewer-parts/board-status.js";

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  children: FakeElement[] = [];
  attributes = new Map<string, string>();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
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

function renderer() {
  return createBoardStatusRenderer({
    document: createDocument(),
    titleView(currentGrade, summary) {
      return `Grade ${currentGrade || "?"} · ${summary.met || 0}/${summary.total || 0} subjects cleared`;
    },
    subjectGateMetaFor(facultyId) {
      return {
        label: String(facultyId || "class"),
        icon: String(facultyId || "?").slice(0, 1).toUpperCase(),
      };
    },
    subjectProgressShortLabel(progress) {
      const p = progress as { completedClasses?: number; requiredClasses?: number };
      return `${p.completedClasses || 0}/${p.requiredClasses || 0}`;
    },
    letterGradePasses(grade) {
      return grade !== "F";
    },
    buildSubjectGradeChip(spec) {
      const chip = createDocument().createElement("span") as unknown as FakeElement;
      chip.className = "subject-grade-chip" + (spec.met ? " is-met" : spec.pending ? " is-pending" : "");
      chip.textContent = `${spec.icon}:${spec.grade}`;
      chip.title = spec.label;
      return chip as unknown as HTMLElement;
    },
  });
}

describe("board status renderer", () => {
  it("renders subject grades with met and pending chips", () => {
    const node = renderer().buildSubjectGrades("9", {
      met: 1,
      total: 2,
      grades: [
        { facultyId: "ruby", grade: "B", progress: { completedClasses: 1, requiredClasses: 1 } },
        { facultyId: "science", grade: "A", progress: { completedClasses: 0, requiredClasses: 2 } },
      ],
    }) as unknown as FakeElement;

    expect(node.className).toBe("board-subject-grades");
    expect(textTree(node)).toEqual([
      "Grade 9 · 1/2 subjects cleared",
      "R:B",
      "S:0/2",
    ]);
    const row = node.children[1]!;
    expect(row.className).toBe("board-subject-grades-row");
    expect(row.children.map((child) => child.className)).toEqual([
      "subject-grade-chip is-met",
      "subject-grade-chip is-pending",
    ]);
  });

  it("collapses class detail copy into an info popover", () => {
    const header = renderer().buildClassStartHeader("10", {
      met: 0,
      total: 1,
      grades: [
        { facultyId: "ruby", grade: "F", progress: { completedClasses: 1, requiredClasses: 1 } },
      ],
    }, "", "Pass any Ruby class to unlock the report.") as unknown as FakeElement;

    expect(header.className).toBe("board-empty-header");
    expect(textTree(header)).toEqual([
      "Grade 10 · 0/1 subjects cleared",
      "i",
      "Pass any Ruby class to unlock the report.",
      "Today's class ready",
      "R:1/1",
    ]);
    const info = header.children[0]!.children[1]!;
    expect(info.tagName).toBe("button");
    expect(info.type).toBe("button");
    expect(info.className).toBe("board-info-button");
    expect(info.title).toBe("Pass any Ruby class to unlock the report.");
    expect(info.attributes.get("aria-label")).toBe("Class details");
    expect(info.children[0]!.className).toBe("board-info-popover");
    expect(info.children[0]!.attributes.get("aria-hidden")).toBe("true");
  });

  it("omits empty optional surfaces defensively", () => {
    const r = renderer();
    expect(r.buildSubjectGrades("9", { grades: [] })).toBeNull();
    expect(r.buildInfoButton("   ")).toBeNull();

    const header = r.buildClassStartHeader("11", { grades: [] }, "Ready now") as unknown as FakeElement;
    expect(textTree(header)).toEqual([
      "Grade 11 · 0/0 subjects cleared",
      "Ready now",
    ]);
  });
});
