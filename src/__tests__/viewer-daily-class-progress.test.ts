import { describe, expect, it } from "vitest";
import { dailyClassProgressView } from "../viewer-parts/client-pure.js";

function telemetry(questionCount: number, status: "active" | "complete" = "active") {
  return {
    character: { name: "Iris" },
    active_course_progress: {
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
      continuationLabel: "Start Evidence 1",
      steps: [
        { key: "evidence-1", state: "current" },
        { key: "evidence-2", state: "upcoming" },
        { key: "take", state: "upcoming" },
        { key: "result", state: "upcoming" },
      ],
    });
    const evidence2 = dailyClassProgressView(telemetry(1));
    expect(evidence2.continuationLabel).toBe("Next: Evidence 2");
    expect(evidence2.steps.map((step) => step.state)).toEqual(["complete", "current", "upcoming", "upcoming"]);

    const take = dailyClassProgressView(telemetry(2));
    expect(take.continuationLabel).toBe("Next: Your Take");
    expect(take.steps.map((step) => step.state)).toEqual(["complete", "complete", "current", "upcoming"]);

    const result = dailyClassProgressView(telemetry(3, "complete"));
    expect(result.continuationLabel).toBe("View Result");
    expect(result.steps.map((step) => step.state)).toEqual(["complete", "complete", "complete", "current"]);
  });

  it("stays hidden without a character-backed class context", () => {
    expect(dailyClassProgressView({})).toMatchObject({ visible: false });
  });
});
