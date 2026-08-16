import { describe, expect, it } from "vitest";
import { createCareerCardRenderer } from "../viewer-parts/career-card.js";

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

describe("career card renderer", () => {
  it("renders profile career cards with metrics and injected progression", () => {
    const progressions: unknown[] = [];
    const renderer = createCareerCardRenderer({
      document: createDocument(),
      appendProgression(parent, progression) {
        progressions.push(progression);
        const marker = createDocument().createElement("div") as unknown as FakeElement;
        marker.className = "career-progression-marker";
        marker.textContent = "progression";
        (parent as unknown as FakeElement).appendChild(marker);
      },
    });

    const card = renderer.buildProfileCard({
      badgeLabel: "faculty",
      name: "Faculty Card",
      subtitle: "Science Lab",
      metrics: [
        { label: "role", value: "Teacher", detail: "faculty", met: true },
        { label: "questions", value: "200", detail: "question bank", met: false },
      ],
      progression: { rungs: ["9"] },
    }) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-career-card");
    expect(textTree(card)).toEqual([
      "faculty",
      "Faculty Card",
      "Science Lab",
      "role",
      "Teacher",
      "faculty",
      "questions",
      "200",
      "question bank",
      "progression",
    ]);
    const metrics = (card.children[1] as FakeElement).children[2] as FakeElement;
    expect(metrics.className).toBe("career-metrics");
    expect(metrics.children.map((row) => row.className)).toEqual([
      "career-metric is-met",
      "career-metric",
    ]);
    expect(progressions).toEqual([{ rungs: ["9"] }]);
  });

  it("renders default profile copy and empty metric values defensively", () => {
    const renderer = createCareerCardRenderer({
      document: createDocument(),
      appendProgression() {},
    });

    const card = renderer.buildProfileCard({ metrics: [{}] }) as unknown as FakeElement;

    expect(textTree(card)).toEqual(["career", "School Career"]);
    const metric = ((card.children[1] as FakeElement).children[2] as FakeElement).children[0] as FakeElement;
    expect(metric.className).toBe("career-metric");
    expect(metric.children.map((child) => child.textContent)).toEqual(["", "", ""]);
  });

  it("builds metric rows directly for reused report-card surfaces", () => {
    const renderer = createCareerCardRenderer({
      document: createDocument(),
      appendProgression() {},
    });

    const metrics = renderer.buildMetrics([
      { label: "daily", value: "2/3", detail: "classes passed", met: true },
    ]) as unknown as FakeElement;

    expect(metrics.className).toBe("career-metrics");
    expect(textTree(metrics)).toEqual(["daily", "2/3", "classes passed"]);
    expect(metrics.children[0]!.className).toBe("career-metric is-met");
  });

  it("renders live school career cards with tokens, next steps, progression, and mash", () => {
    const progressions: unknown[] = [];
    const renderer = createCareerCardRenderer({
      document: createDocument(),
      appendProgression(parent, progression) {
        progressions.push(progression);
        const marker = createDocument().createElement("div") as unknown as FakeElement;
        marker.className = "career-progression-marker";
        marker.textContent = "progression";
        (parent as unknown as FakeElement).appendChild(marker);
      },
    });
    const tokens = createDocument().createElement("div") as unknown as FakeElement;
    tokens.className = "career-token-strip";
    tokens.textContent = "tokens";
    const mash = createDocument().createElement("div") as unknown as FakeElement;
    mash.className = "mash-grid-wrap";
    mash.textContent = "mash";

    const card = renderer.buildSchoolCard({
      roleLabel: "Freshman",
      subtitle: "Freshman · C B A",
      metrics: [
        { label: "today", value: "2/3", detail: "Ruby · one more", met: false },
      ],
      tokens: tokens as unknown as HTMLElement,
      nextStep: "Pass today's daily class.",
      progression: { rungs: ["9", "10"] },
      mash: mash as unknown as HTMLElement,
    }) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-career-card");
    expect(textTree(card)).toEqual([
      "Freshman",
      "School Career",
      "Freshman · C B A",
      "today",
      "2/3",
      "Ruby · one more",
      "tokens",
      "Pass today's daily class.",
      "progression",
      "mash",
    ]);
    expect(progressions).toEqual([{ rungs: ["9", "10"] }]);
  });

  it("renders graduated school career cards with ceremony instead of tokens or next-step copy", () => {
    const renderer = createCareerCardRenderer({
      document: createDocument(),
      appendProgression() {},
    });
    const tokens = createDocument().createElement("div") as unknown as FakeElement;
    tokens.textContent = "tokens";
    const ceremony = createDocument().createElement("div") as unknown as FakeElement;
    ceremony.className = "graduation-ceremony";
    ceremony.textContent = "ceremony";

    const card = renderer.buildSchoolCard({
      graduated: true,
      roleLabel: "graduated",
      subtitle: "Arc complete",
      metrics: [
        { label: "status", value: "graduated", detail: "all four years complete", met: true },
      ],
      tokens: tokens as unknown as HTMLElement,
      ceremony: ceremony as unknown as HTMLElement,
      nextStep: "Should not render",
    }) as unknown as FakeElement;

    expect(card.className).toBe("ccg-card is-career-card is-graduated");
    expect(textTree(card)).toEqual([
      "graduated",
      "School Career",
      "Arc complete",
      "status",
      "graduated",
      "all four years complete",
      "ceremony",
    ]);
  });
});
