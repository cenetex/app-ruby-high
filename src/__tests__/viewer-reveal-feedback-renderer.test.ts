import { describe, expect, it } from "vitest";
import { createRevealFeedbackRenderer } from "../viewer-parts/reveal-feedback.js";

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  children: FakeElement[] = [];
  style = {
    background: "",
  };

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
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
      const node = new FakeElement("#text");
      node.textContent = text;
      return node as unknown as Text;
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
  return createRevealFeedbackRenderer({
    document: createDocument(),
    statLabel(stat) {
      return String(stat || "stat");
    },
    scoreAwardLabel(award) {
      return `award:${String(award)}`;
    },
    mashTickLabel(event) {
      return `tick:${String(event.studentId)}:${String(event.delta || 0)}`;
    },
    mashTickStory(event) {
      return `story:${String(event.studentId)}:${String(event.reason || "")}`;
    },
    studentNameById(studentId) {
      return String(studentId || "student").toUpperCase();
    },
    studentColorById(studentId) {
      return studentId === "noor" ? "#0cf" : "#f90";
    },
  });
}

describe("reveal feedback renderer", () => {
  it("renders social summary rows with story, color, and signed deltas", () => {
    const node = renderer().buildSocialSummary([
      { studentId: "noor", delta: 2, reason: "best-responder" },
      { studentId: "ravi", delta: -1, reason: "rub" },
    ]) as unknown as FakeElement;

    expect(node.className).toBe("msg social-summary");
    expect(textTree(node)).toEqual([
      "S",
      "Social Shift",
      expect.any(String),
      "story:noor:best-responder",
      "+2",
      "story:ravi:rub",
      "-1",
    ]);
    const rows = node.children[2]!.children[0]!.children;
    expect(rows.map((row) => row.className)).toEqual([
      "social-summary-row is-up",
      "social-summary-row is-down",
    ]);
    expect(rows[0]!.children[0]!.style.background).toBe("#0cf");
    expect(renderer().buildSocialSummary([])).toBeNull();
  });

  it("renders choice result chips with rolls, awards, and relationship ticks", () => {
    const node = renderer().buildResult({
      questionId: "q1",
      wasCorrect: false,
      picked: "A",
      correct: "C",
      playerRoll: { outcome: "miss", dice: [2, 3], total: 7, stat: "head" },
      scoreAward: "daily",
    }, 4, [
      { studentId: "noor", delta: 1, circled: true },
      { studentId: "ravi", delta: -1, scratched: true },
    ]) as unknown as FakeElement;

    expect(node.className).toBe("msg result");
    expect(textTree(node)).toEqual([
      "✗ A · C",
      "Q4 — missed",
      "🎲 2+3+2 head = 7",
      "award:daily",
      "tick:noor:1",
      "tick:ravi:-1",
    ]);
    const body = node.children[0]!;
    expect(body.children.map((child) => child.className)).toEqual([
      "badge-mini bad",
      "",
      "roll-chip miss",
      "score-multiplier-chip",
      "mash-tick-chip up",
      "mash-tick-chip down",
    ]);
    expect(body.children[4]!.title).toBe("NOOR is circled on your Social card.");
    expect(body.children[5]!.title).toBe("RAVI is scratched on your Social card.");
  });

  it("renders typed and timeout result labels defensively", () => {
    const typed = renderer().buildResult({
      wasCorrect: true,
      answerText: "hydrogen",
      scoreMultiplier: 5,
    }, 1, []) as unknown as FakeElement;
    expect(textTree(typed)).toEqual([
      "✓ typed",
      "Q1 — correct",
      "◆ Daily Class ×5",
    ]);

    const timeout = renderer().buildResult({
      wasCorrect: false,
      forfeit: true,
      expectedAnswer: "oxygen",
    }, 2, []) as unknown as FakeElement;
    expect(textTree(timeout)).toEqual([
      "⏱ timeout",
      "Q2 — timed out",
    ]);
  });
});
