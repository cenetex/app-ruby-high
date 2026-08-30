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
    mashTickStory(event) {
      return `story:${String(event.studentId)}:${String(event.reason || "")}`;
    },
    studentColorById(studentId) {
      return studentId === "noor" ? "#0cf" : "#f90";
    },
  });
}

describe("reveal feedback renderer", () => {
  it("renders one classmate note with story, color, and signed delta", () => {
    const node = renderer().buildSocialSummary([
      { studentId: "noor", delta: 2, reason: "best-responder" },
      { studentId: "ravi", delta: -1, reason: "rub" },
    ]) as unknown as FakeElement;

    expect(node.className).toBe("msg social-summary");
    expect(textTree(node)).toEqual([
      "S",
      "Classmate Note",
      expect.any(String),
      "story:noor:best-responder",
      "+2",
    ]);
    const rows = node.children[2]!.children[0]!.children;
    expect(rows.map((row) => row.className)).toEqual([
      "social-summary-row is-up is-primary",
    ]);
    expect(rows[0]!.children[0]!.style.background).toBe("#0cf");
    expect(renderer().buildSocialSummary([])).toBeNull();
  });

  it("renders choice class notes with rolls and award receipts", () => {
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

    expect(node.className).toBe("msg result class-note-result");
    expect(textTree(node)).toEqual([
      "✗ A · C",
      "Class note Q4 · missed",
      "roll 2+3+2 head = 7",
      "award:daily",
    ]);
    const body = node.children[0]!;
    expect(body.children.map((child) => child.className)).toEqual([
      "class-note-main",
      "class-note-receipts",
    ]);
    expect(body.children[0]!.children.map((child) => child.className)).toEqual([
      "badge-mini bad",
      "class-note-title",
    ]);
    expect(body.children[1]!.children.map((child) => child.className)).toEqual([
      "roll-chip miss",
      "score-multiplier-chip",
    ]);
  });

  it("renders typed and timeout result labels defensively", () => {
    const typed = renderer().buildResult({
      wasCorrect: true,
      answerText: "hydrogen",
      scoreMultiplier: 5,
    }, 1, []) as unknown as FakeElement;
    expect(textTree(typed)).toEqual([
      "✓ typed",
      "Class note Q1 · correct",
      "◆ Daily Class ×5",
    ]);

    const timeout = renderer().buildResult({
      wasCorrect: false,
      forfeit: true,
      expectedAnswer: "oxygen",
    }, 2, []) as unknown as FakeElement;
    expect(textTree(timeout)).toEqual([
      "⏱ timeout",
      "Class note Q2 · timed out",
    ]);
  });

  it("renders a story choice without a correctness signal", () => {
    const node = renderer().buildResult({
      questionType: "story-choice",
      wasCorrect: true,
      picked: "B",
      correct: "B",
      caseChoice: { choiceLabel: "Publish a bounded summary" },
    }, 2, []) as unknown as FakeElement;

    expect(textTree(node)).toEqual([
      "◆ choice",
      "Story note Q2 · consequence pending",
    ]);
    expect(node.children[0]!.children[0]!.children[0]!.className).toBe("badge-mini neutral");
  });
});
