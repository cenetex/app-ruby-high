import { describe, expect, it } from "vitest";
import { createReportCardRenderer, type ReportMetric } from "../viewer-parts/report-card.js";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];

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
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function createRenderer() {
  const metricCalls: ReportMetric[][] = [];
  const renderer = createReportCardRenderer({
    document: createDocument(),
    essayLetter(score) {
      return Number(score) >= 8 ? "A" : Number(score) >= 7 ? "B" : "C";
    },
    clipEssayText(text, max) {
      const value = String(text || "");
      return value.length > max ? value.slice(0, max - 1) + "…" : value;
    },
    facultyLabel(faculty) {
      return "Teacher " + String(faculty || "Unknown");
    },
    essayScoreText(score) {
      return score == null ? "—" : Number(score).toFixed(1) + "/10";
    },
    formatSealedDate(ts) {
      return "sealed:" + String(ts || "missing");
    },
    essayResponderName(id) {
      return id === "player" ? "You" : "Student " + String(id || "unknown");
    },
    essayRivalryText(recent) {
      return "rivalry:" + recent.length;
    },
    buildCareerMetrics(rows) {
      metricCalls.push(rows);
      const wrap = new FakeElement("div");
      wrap.className = "career-metrics";
      rows.forEach((row) => {
        const item = new FakeElement("div");
        item.className = "career-metric" + (row.met ? " is-met" : "");
        item.textContent = [row.label, row.value, row.detail].filter(Boolean).join("=");
        wrap.appendChild(item);
      });
      return wrap as unknown as HTMLElement;
    },
  });
  return { renderer, metricCalls };
}

describe("report card renderer", () => {
  it("renders an empty report card with empty-state copy and defensive metrics", () => {
    const { renderer, metricCalls } = createRenderer();

    const card = renderer.buildCard([]) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-report-card");
    expect(textTree(card)).toEqual([
      "report",
      "Report Card",
      "No graded essays yet",
      "essays=0=graded",
      "average=—=teacher score",
      "top=—=0 class wins",
      "Your first graded essay will land here.",
    ]);
    expect(metricCalls).toEqual([
      [
        { label: "essays", value: "0", detail: "graded", met: false },
        { label: "average", value: "—", detail: "teacher score", met: false },
        { label: "top", value: "—", detail: "0 class wins", met: false },
      ],
    ]);
  });

  it("renders report summaries, rivalry copy, and the three latest entries", () => {
    const { renderer, metricCalls } = createRenderer();
    const reports = Array.from({ length: 5 }, (_, index) => ({
      score: 6 + index,
      passed: index >= 1,
      prompt: "Prompt " + index,
      subject: "Math",
      faculty: "Ruby",
      gradedAt: "day-" + index,
      comment: "Comment " + index,
      bestResponder: index % 2 === 0 ? "player" : "noor",
      bestResponderScore: 7 + index,
      response: "Response " + index,
    }));

    const card = renderer.buildCard(reports) as unknown as FakeElement;
    const texts = textTree(card);

    expect(texts).toContain("5 essays · average 8.0/10");
    expect(texts).toContain("rivalry:5");
    expect(texts).toContain("Prompt 4");
    expect(texts).toContain("Prompt 3");
    expect(texts).toContain("Prompt 2");
    expect(texts).not.toContain("Prompt 1");
    expect(metricCalls[0]).toEqual([
      { label: "essays", value: "5", detail: "graded", met: true },
      { label: "average", value: "8.0/10", detail: "teacher score", met: true },
      { label: "top", value: "10.0/10", detail: "3 class wins", met: true },
    ]);
  });

  it("renders report entry details with optional footer fields", () => {
    const { renderer } = createRenderer();

    const entry = renderer.buildEntry({
      score: 8,
      passed: true,
      prompt: "Explain the classroom proof",
      subject: "Logic",
      faculty: "Sally",
      gradedAt: "today",
      comment: "Strong argument.",
      bestResponder: "player",
      bestResponderScore: 9,
      response: "My proof",
    }) as unknown as FakeElement;

    expect(entry.className).toBe("report-entry is-passed");
    expect(textTree(entry)).toEqual([
      "A",
      "Explain the classroom proof",
      "Teacher Sally · Logic · 8.0/10 · sealed:today",
      "Strong argument.",
      "Best: You 9.0/10",
      "You: My proof",
    ]);
  });
});
