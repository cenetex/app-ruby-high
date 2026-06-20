import { describe, expect, it, vi } from "vitest";
import { createClassmateChannelRowsRenderer, type ClassmateChannelGroupView } from "../viewer-parts/classmate-channel-rows.js";

class FakeStyle {
  values: Record<string, string> = {};
  background = "";

  setProperty(name: string, value: string): void {
    this.values[name] = value;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  alt = "";
  src = "";
  disabled = false;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  style = new FakeStyle();
  parentNode: FakeElement | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener());
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

function groups(): ClassmateChannelGroupView[] {
  return [{
    key: "10",
    label: "Sophomore class",
    rows: [{
      npc: { id: "noor", currentRoom: "ruby" },
      student: { id: "noor", name: "Noor" },
      studentId: "noor",
      name: "Noor",
      color: "#d22a2a",
      gradeTitle: "Sophomore",
      ariaLabel: "Noor, Sophomore, Year progress 2 of 3",
      subtitle: "#homeroom",
      progress: { value: 2, total: 3 },
      progressLabel: "Year progress 2 of 3",
      social: {
        className: "student-social-mark is-warm",
        title: "Social Card: +2 affinity",
        text: "+2",
      },
    }],
  }, {
    key: "graduated",
    label: "Alumni",
    rows: [{
      npc: { id: "mika" },
      student: { id: "mika", name: "Mika" },
      studentId: "mika",
      name: "Mika",
      color: "#4080ff",
      gradeTitle: "Graduated",
      ariaLabel: "Mika, Graduated",
      subtitle: "alumni · 4 years",
      progress: null,
      progressLabel: "",
      social: null,
    }],
  }];
}

describe("classmate channel rows renderer", () => {
  it("renders classmate groups, meters, social marks, face fallback, and row actions", () => {
    const parent = new FakeElement("div");
    const openStudentProfile = vi.fn();
    const renderer = createClassmateChannelRowsRenderer({
      document: createDocument(),
      faceUrl(studentId) {
        return "/students/" + studentId + "-face.png";
      },
      openStudentProfile,
    });

    renderer.appendSection(parent as unknown as HTMLElement, groups());

    expect(parent.children[0]!.className).toBe("channel-section-title");
    expect(parent.children[0]!.textContent).toBe("Students");
    expect(parent.children[1]!.className).toBe("student-cohort-group");
    expect(textTree(parent.children[1]!)).toEqual([
      "Sophomore class",
      "1",
      "Noor",
      "#homeroom",
      "+2",
    ]);
    const row = parent.children[1]!.children[1]!;
    expect(row.className).toBe("channel-row student-row");
    expect(row.type).toBe("button");
    expect(row.attributes["aria-label"]).toBe("Noor, Sophomore, Year progress 2 of 3");
    const thumb = row.children[0]!;
    expect(thumb.className).toBe("teacher-thumb student-thumb");
    expect(thumb.style.values["--student-accent"]).toBe("#d22a2a");
    expect(thumb.children[0]!.src).toBe("/students/noor-face.png");
    thumb.children[0]!.onerror?.();
    expect(thumb.style.background).toBe("#d22a2a");
    expect(thumb.children).toEqual([]);
    const meter = row.children[1]!.children[1]!.children[1]!;
    expect(meter.className).toBe("student-year-meter");
    expect(meter.attributes["aria-label"]).toBe("Year progress 2 of 3");
    expect(meter.children.map((child) => child.className)).toEqual([
      "student-year-segment is-filled",
      "student-year-segment is-filled",
      "student-year-segment",
    ]);
    const social = row.children[2]!;
    expect(social.className).toBe("student-social-mark is-warm");
    expect(social.attributes["aria-label"]).toBe("Social Card: +2 affinity");
    row.click();
    expect(openStudentProfile).toHaveBeenCalledWith({ id: "noor", currentRoom: "ruby" }, { id: "noor", name: "Noor" });

    expect(parent.children[2]!.children[0]!.children[0]!.textContent).toBe("Alumni");
    expect(parent.children[2]!.children[1]!.attributes["aria-label"]).toBe("Mika, Graduated");
  });
});
