import { describe, expect, it } from "vitest";
import { createYearbookArchiveRenderer } from "../viewer-parts/yearbook-archive.js";

class FakeNode {
  textContent = "";
  parent: FakeElement | null = null;

  constructor(readonly tagName: string) {}
}

class FakeElement extends FakeNode {
  className = "";
  alt = "";
  loading = "";
  src = "";
  children: FakeNode[] = [];
  styleValues: Record<string, string> = {};
  style = {
    setProperty: (name: string, value: string) => {
      this.styleValues[name] = value;
    },
  };

  appendChild(child: FakeNode): FakeNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
    createTextNode(text: string) {
      const node = new FakeNode("#text");
      node.textContent = text;
      return node as unknown as Text;
    },
  };
}

function textTree(node: FakeNode): string[] {
  const own = node.textContent ? [node.textContent] : [];
  return node instanceof FakeElement ? [...own, ...node.children.flatMap((child) => textTree(child))] : own;
}

function renderer() {
  return createYearbookArchiveRenderer({
    document: createDocument(),
    gradeLabels: { "9": "Freshman", "10": "Sophomore" },
    gradeShortLabels: { "9": "Frosh", "10": "Soph" },
    gradeOrder: ["9", "10", "11", "12"],
    formatSealedDate: (value) => "date:" + String(value || "unknown"),
    fmtStat: (value) => "+" + value,
    renderMarkdownInto(el, markdown) {
      el.textContent = "md:" + markdown;
    },
  });
}

describe("yearbook archive renderer", () => {
  it("renders archive summary, sealed entries, collectibles, and portrait", () => {
    const archive = renderer().buildArchive(
      [
        {
          grade: "10",
          completedAt: "2026-06-01",
          playbookId: "heart",
          name: "Noor",
          stats: { head: 1, heart: 2, hustle: 3, honor: 4 },
          summary: { correct: 8, total: 10 },
          flavorQuote: "I found the signal.",
          diplomaImageDataUrl: "data:image/png;base64,diploma",
          diploma: { title: "Ruby High Diploma", imageUrl: "/diploma.png", issuedAt: "2026-06-02" },
          photo: {
            title: "Grade 10 Photo",
            teacher: { name: "Ruby", imageUrl: "/ruby.png" },
            student: { name: "Noor" },
          },
        },
        { grade: "9", completedAt: "2025-06-01", summary: { correct: 6, total: 9 } },
      ],
      { playbookId: "overachiever", stats: { head: 5 } },
      { id: "overachiever", accent: "#111111" },
      [{ id: "heart", accent: "#ff3366" }],
    ) as unknown as FakeElement;

    expect(archive.tagName).toBe("details");
    expect(archive.className).toBe("paper-archive");
    const summary = archive.children[0] as FakeElement;
    expect(summary.tagName).toBe("summary");
    expect(summary.className).toBe("paper-archive-summary");
    expect((summary.children[0] as FakeElement).children).toHaveLength(2);
    expect(textTree(summary)).toEqual(["2 sealed years", "open yearbook"]);

    const list = archive.children[1] as FakeElement;
    expect(list.className).toBe("paper-archive-list");
    expect(list.children).toHaveLength(2);
    const entry = list.children[0] as FakeElement;
    expect(entry.className).toBe("paper-archive-entry");
    expect(entry.styleValues["--paper-accent"]).toBe("#ff3366");
    expect(textTree(entry)).toEqual([
      "\u25c6",
      "\u25c6",
      "Soph",
      "sealed date:2026-06-01 \u00b7 8/10",
      "head",
      " +1",
      "heart",
      " +2",
      "hustle",
      " +3",
      "honor",
      " +4",
      "md:\u201cI found the signal.\u201d",
      "Ruby High Diploma",
      "collectible \u00b7 date:2026-06-02",
      "N",
      "Grade 10 Photo",
      "Ruby \u00b7 Noor",
    ]);
    const diploma = entry.children[3] as FakeElement;
    expect(diploma.className).toBe("paper-archive-diploma");
    expect((diploma.children[0] as FakeElement).src).toBe("/diploma.png");
    const photo = entry.children[4] as FakeElement;
    expect(photo.className).toBe("paper-archive-photo");
    const teacherFace = ((photo.children[0] as FakeElement).children[0] as FakeElement).children[0] as FakeElement;
    expect(teacherFace.src).toBe("/ruby.png");
    const portrait = entry.children[5] as FakeElement;
    expect(portrait.className).toBe("paper-archive-portrait");
    expect((portrait.children[0] as FakeElement).alt).toBe("Noor photo");
  });

  it("renders diploma and graduation photo fallbacks", () => {
    const r = renderer();
    const diploma = r.buildDiploma({}) as unknown as FakeElement;
    const photo = r.buildGraduationPhoto({}) as unknown as FakeElement;

    expect(textTree(diploma)).toEqual(["Ruby High Diploma", "collectible \u00b7 date:unknown"]);
    expect(textTree(photo)).toEqual(["?", "?", "Graduation Photo", "top teacher \u00b7 top classmate"]);
  });

  it("ignores empty archive inputs", () => {
    expect(renderer().buildArchive([], {}, {}, [])).toBeNull();
    expect(renderer().buildArchive(null, {}, {}, [])).toBeNull();
  });
});
