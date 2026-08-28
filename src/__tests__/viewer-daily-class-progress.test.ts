import { describe, expect, it } from "vitest";
import { dailyClassProgressView } from "../viewer-parts/client-pure.js";

function telemetry(questionCount: number, status: "active" | "complete" = "active") {
  return {
    character: { name: "Iris" },
    active_course_progress: {
      requiredClasses: 1,
      today: { status, questionCount },
    },
    active_round: status === "active"
      ? { classSession: { mode: "class" } }
      : null,
  };
}

describe("daily class progress view", () => {
  it("shows the four-card sequence and advances its deterministic CTA", () => {
    expect(dailyClassProgressView(telemetry(0))).toMatchObject({
      visible: true,
      continuationLabel: "Start Question 1",
      steps: [
        { key: "evidence-1", state: "current" },
        { key: "evidence-2", state: "upcoming" },
        { key: "take", state: "upcoming" },
        { key: "result", state: "upcoming" },
      ],
    });
    const evidence2 = dailyClassProgressView(telemetry(1));
    expect(evidence2.continuationLabel).toBe("Next: Question 2");
    expect(evidence2.steps.map((step) => step.state)).toEqual(["complete", "current", "upcoming", "upcoming"]);

    const take = dailyClassProgressView(telemetry(2));
    expect(take.continuationLabel).toBe("Next: Your View");
    expect(take.steps.map((step) => step.state)).toEqual(["complete", "complete", "current", "upcoming"]);

    const result = dailyClassProgressView(telemetry(3, "complete"));
    expect(result.continuationLabel).toBe("View Result");
    expect(result.steps.map((step) => step.state)).toEqual(["complete", "complete", "complete", "current"]);
  });

  it("labels the static offline third card as evidence instead of a written take", () => {
    const view = dailyClassProgressView({
      ...telemetry(2),
      store_path: "localStorage",
    });

    expect(view.steps[2]).toMatchObject({ label: "Question 3", state: "current" });
    expect(view.continuationLabel).toBe("Next: Question 3");
  });

  it("labels Roko's hosted case as investigate, decide, explain, and outcome", () => {
    const view = dailyClassProgressView({
      ...telemetry(1),
      faculty: "roko",
      current: { caseStudy: { stage: "decide" } },
    });

    expect(view.steps.map((step) => step.label)).toEqual(["Investigate", "Decide", "Explain", "Outcome"]);
    expect(view.continuationLabel).toBe("Next: Decide");
  });

  it("stays hidden without a character-backed class context", () => {
    expect(dailyClassProgressView({})).toMatchObject({ visible: false });
  });

  it("hides stale class progress in practice-only rooms and during the grade essay", () => {
    expect(dailyClassProgressView({
      ...telemetry(0),
      active_course_progress: {
        requiredClasses: 0,
        today: { status: "active", questionCount: 0 },
      },
    })).toMatchObject({ visible: false });

    expect(dailyClassProgressView({
      ...telemetry(3, "complete"),
      current: { opinionPurpose: "grade-essay" },
    })).toMatchObject({ visible: false });
  });

  it("hides the whole bar when an active or completed class moves into practice", () => {
    for (const classTelemetry of [telemetry(1), telemetry(3, "complete")]) {
      expect(dailyClassProgressView({
        ...classTelemetry,
        current: { id: "practice-question" },
        active_round: {
          cardRole: "practice",
          classSession: { mode: "practice" },
        },
      })).toMatchObject({ visible: false });
    }
  });

  it("keeps the bar for a graded take and for the class report", () => {
    expect(dailyClassProgressView({
      ...telemetry(2),
      active_round: {
        cardRole: "social",
        classSession: { mode: "class" },
      },
    })).toMatchObject({ visible: true });

    expect(dailyClassProgressView(telemetry(3, "complete"))).toMatchObject({
      visible: true,
      steps: [{}, {}, {}, { key: "result", state: "current" }],
    });
  });
});
