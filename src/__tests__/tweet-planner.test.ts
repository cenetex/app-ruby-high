import { describe, expect, it } from "vitest";
import type { ScheduledSchoolUpdateContext } from "../services/ruby-high/post-types.js";
import {
  duePlannedTweetSlot,
  normalizeGeneratedTweetPlan,
  shouldRefreshScheduledTweetPlan,
} from "../services/ruby-high/tweet-planner.js";

const CONTEXT: ScheduledSchoolUpdateContext = {
  date: "2026-08-17",
  updatedSessionsLast24h: 6,
  activeStudents: 3,
  activeRooms: [{ area: "classroom", grade: "10", activeStudents: 3, goalProgress: 2, goalTarget: 4 }],
  highlights: { newStudents: 1, classesPassed: 2, gradesAdvanced: 0, graduations: 0 },
  recentEvents: { roomGoalProgress: 2, relationshipMoments: 1, futuresResolved: 0, comicPagesUnlocked: 0 },
};

const VALID_ITEMS = [
  ["2026-08-17", "school-pulse", "A room working toward a shared goal", "Use the live room progress without listing dashboard numbers.", "none"],
  ["2026-08-18", "student-question", "What makes an answer worth defending", "Ask a pointed question rooted in Ruby's standard for real takes.", "reply"],
  ["2026-08-19", "teacher-take", "Specificity is a form of respect", "State Ruby's view without inventing a classroom event.", "take-class"],
  ["2026-08-20", "progress-story", "Several passes as evidence of persistence", "Turn aggregate passing activity into one natural observation.", "none"],
  ["2026-08-21", "school-pulse", "The room goal is collective rather than competitive", "Use whatever live room signal remains true at publish time.", "take-class"],
  ["2026-08-22", "student-question", "Which assumption would you risk revising", "Invite followers to answer one sharp, accessible question.", "reply"],
  ["2026-08-23", "teacher-take", "Questions reveal more than polished certainty", "Finish the week with Ruby's point of view and no generic praise.", "none"],
].map(([publishDate, pillar, angle, brief, callToAction]) => ({
  publishDate,
  pillar,
  angle,
  brief,
  callToAction,
}));

describe("scheduled tweet planning", () => {
  it("accepts a varied seven-day editorial calendar", () => {
    const plan = normalizeGeneratedTweetPlan(
      JSON.stringify({ items: VALID_ITEMS }),
      "ruby",
      CONTEXT,
      123,
    );

    expect(plan).toMatchObject({
      teacherId: "ruby",
      startsOn: "2026-08-17",
      endsOn: "2026-08-23",
      guestWeekKey: null,
      createdAt: 123,
    });
    expect(plan?.slots).toHaveLength(7);
    expect(new Set(plan?.slots.map((slot) => slot.pillar)).size).toBeGreaterThanOrEqual(4);
  });

  it("rejects repetitive or CTA-heavy calendars", () => {
    const repetitive = VALID_ITEMS.map((item) => ({
      ...item,
      pillar: "school-pulse",
      callToAction: "take-class",
    }));
    expect(normalizeGeneratedTweetPlan(
      JSON.stringify({ items: repetitive }),
      "ruby",
      CONTEXT,
    )).toBeNull();
  });

  it("refreshes when the guest week changes and otherwise keeps the advance plan", () => {
    const plan = normalizeGeneratedTweetPlan(JSON.stringify({ items: VALID_ITEMS }), "ruby", CONTEXT)!;
    expect(shouldRefreshScheduledTweetPlan(plan, "ruby", CONTEXT)).toBe(false);
    expect(shouldRefreshScheduledTweetPlan(plan, "ruby", {
      ...CONTEXT,
      featuredGuest: {
        weekKey: "2026-W34",
        packId: "teacher:guest",
        facultyId: "guest",
        displayName: "Guest",
        courseTitle: "Guest Course",
        bio: "Guest teacher.",
      },
    })).toBe(true);
  });

  it("uses only unpublished slots and lets forced runs consume the next planned slot", () => {
    const plan = normalizeGeneratedTweetPlan(JSON.stringify({ items: VALID_ITEMS }), "ruby", CONTEXT)!;
    const today = duePlannedTweetSlot(plan, CONTEXT.date);
    expect(today?.publishDate).toBe(CONTEXT.date);
    today!.publishedAt = 100;
    expect(duePlannedTweetSlot(plan, CONTEXT.date)).toBeNull();
    expect(duePlannedTweetSlot(plan, CONTEXT.date, true)?.publishDate).toBe("2026-08-18");
  });
});
