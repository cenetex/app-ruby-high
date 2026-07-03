import { describe, expect, it, vi } from "vitest";
import { createRoomChannelRowsController } from "../viewer-parts/room-channel-rows.js";
import type { RoomChannelRowView } from "../viewer-parts/client-pure.js";

class FakeStyle {
  values: Record<string, string> = {};

  setProperty(name: string, value: string): void {
    this.values[name] = value;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  alt = "";
  src = "";
  dataset: Record<string, string> = {};
  style = new FakeStyle();
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, ((event: Event) => void)[]> = {};
  onerror: (() => void) | null = null;
  parentNode: FakeElement | null = null;

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

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener({
      stopPropagation: vi.fn(),
    } as unknown as Event));
  }
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function makeHarness() {
  const setFaculty = vi.fn();
  const openTeacherProfile = vi.fn();
  const controller = createRoomChannelRowsController({
    document: {
      createElement(tagName: string) {
        return new FakeElement(tagName) as unknown as HTMLElement;
      },
    },
    teacherSmallAvatarUrl(faculty) {
      return faculty.id === "ruby" ? "/ruby.png" : "";
    },
    teacherInitial(faculty) {
      return String(faculty.displayName || faculty.id || "?").slice(0, 1).toUpperCase();
    },
    buildStudentFaceChip(student, className) {
      const chip = new FakeElement("span");
      chip.className = className;
      chip.dataset.studentId = student.id;
      chip.dataset.portraitUrl = student.portraitUrl || "";
      chip.textContent = student.name.slice(0, 1).toUpperCase();
      return chip as unknown as HTMLElement;
    },
    openTeacherProfile,
    setFaculty,
  });
  const parent = new FakeElement("div");
  return { controller, parent, setFaculty, openTeacherProfile };
}

describe("room channel rows controller", () => {
  it("renders room rows with teacher thumbs, completion meter, and visible student chips", () => {
    const harness = makeHarness();
    const rows: RoomChannelRowView[] = [{
      roomId: "homeroom",
      facultyId: "ruby",
      channelName: "homeroom",
      isActive: true,
      completionProgress: { value: 2, total: 3 },
      completionLabel: "Ruby daily classes 2 of 3",
      students: [
        { id: "noor", name: "Noor" },
        { id: "lyra", name: "Lyra" },
      ],
    }];

    harness.controller.appendRows(harness.parent as unknown as HTMLElement, rows, [{ id: "ruby", displayName: "Ruby", accent: "#c00" }]);

    expect(harness.parent.children).toHaveLength(1);
    const row = harness.parent.children[0]!;
    expect(row.className).toBe("channel-row room-row is-active");
    expect(row.dataset.faculty).toBe("ruby");
    expect(textTree(row)).toEqual(["#", "homeroom", "N", "L"]);

    const thumb = row.children[0]!;
    expect(thumb.className).toBe("teacher-thumb");
    expect(thumb.title).toBe("Open Ruby's card");
    expect(thumb.children[0]?.tagName).toBe("img");
    expect(thumb.children[0]?.src).toBe("/ruby.png");

    const meter = row.children[2]?.children[1];
    expect(meter?.className).toBe("student-year-meter room-completion-meter");
    expect(meter?.attributes["aria-label"]).toBe("Ruby daily classes 2 of 3");
    expect(meter?.children.map((child) => child.className)).toEqual([
      "student-year-segment is-filled",
      "student-year-segment is-filled",
      "student-year-segment",
    ]);

    const stack = row.children[3]!;
    expect(stack.className).toBe("room-student-stack");
    expect(stack.attributes["aria-label"]).toBe("Students here: Noor, Lyra");
    expect(stack.children.map((child) => child.dataset.studentId)).toEqual(["noor", "lyra"]);
  });

  it("routes room clicks to faculty changes and teacher thumb clicks to profile cards", () => {
    const harness = makeHarness();
    harness.controller.appendRows(harness.parent as unknown as HTMLElement, [{
      roomId: "science",
      facultyId: "sally-science",
      channelName: "science",
      isActive: false,
      completionProgress: null,
      completionLabel: "",
      students: [],
    }], [{ id: "sally-science", displayName: "Sally Science", accent: "#0af" }]);

    const row = harness.parent.children[0]!;
    const thumb = row.children[0]!;

    row.click();
    expect(harness.setFaculty).toHaveBeenCalledWith("sally-science");

    const stopPropagation = vi.fn();
    (thumb.listeners.click || [])[0]?.({ stopPropagation } as unknown as Event);
    expect(stopPropagation).toHaveBeenCalled();
    expect(harness.openTeacherProfile).toHaveBeenCalledWith("sally-science");
  });

  it("renders human room chips with custom portrait metadata", () => {
    const harness = makeHarness();
    harness.controller.appendRows(harness.parent as unknown as HTMLElement, [{
      roomId: "homeroom",
      facultyId: "ruby",
      channelName: "homeroom",
      isActive: true,
      completionProgress: null,
      completionLabel: "",
      students: [
        { id: "lyra", name: "Lyra", kind: "npc" },
        {
          id: "world:session:abc123abc123abcd",
          name: "Sloan",
          kind: "human",
          portraitUrl: "/api/apps/ruby-high/assets/portrait/sloan.png",
        },
      ],
    }], [{ id: "ruby", displayName: "Ruby", accent: "#c00" }]);

    const stack = harness.parent.children[0]!.children[3]!;
    expect(stack.attributes["aria-label"]).toBe("Students here: Lyra, Sloan");
    expect(stack.children.map((child) => child.dataset.studentId)).toEqual(["lyra", "world:session:abc123abc123abcd"]);
    expect(stack.children[1]!.dataset.portraitUrl).toBe("/api/apps/ruby-high/assets/portrait/sloan.png");
    expect(textTree(stack)).toEqual(["L", "S"]);
  });
});
