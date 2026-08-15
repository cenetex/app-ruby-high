import { describe, expect, it, vi } from "vitest";
import type { TeacherCharacter } from "../characters/teachers.js";
import {
  FAILED_POST_RETRY_INTERVAL_MS,
  MIN_POST_INTERVAL_MS,
  TweetPlanningScheduler,
  defaultSchedulerState,
  hydrateScheduledPostSchedulerState,
  scheduledPostSchedulerStateRecord,
} from "../services/ruby-high/post-scheduler.js";
import type { ScheduledSchoolUpdateContext } from "../services/ruby-high/post-types.js";
import type { PlannedTweetPillar, ScheduledTweetPlan } from "../services/ruby-high/tweet-planner.js";
import type { XSocialService } from "../services/x-social-service.js";

const TEACHER: TeacherCharacter = {
  id: "ruby",
  displayName: "Ruby",
  shortName: "Ruby",
  defaultModel: "test",
  systemPrompt: "You are Ruby, a warm and mischievous teacher.",
};

const CONTEXT: ScheduledSchoolUpdateContext = {
  date: "2026-07-22",
  updatedSessionsLast24h: 12,
  activeStudents: 3,
  activeRooms: [{
    area: "classroom",
    grade: "9",
    activeStudents: 3,
    goalProgress: 2,
    goalTarget: 3,
  }],
  highlights: { newStudents: 2, classesPassed: 1, gradesAdvanced: 0, graduations: 0 },
  recentEvents: { roomGoalProgress: 2, relationshipMoments: 3, futuresResolved: 0, comicPagesUnlocked: 0 },
};

const GUEST_CONTEXT: ScheduledSchoolUpdateContext = {
  ...CONTEXT,
  updatedSessionsLast24h: 0,
  activeStudents: 0,
  activeRooms: [],
  highlights: { newStudents: 0, classesPassed: 0, gradesAdvanced: 0, graduations: 0 },
  recentEvents: { roomGoalProgress: 0, relationshipMoments: 0, futuresResolved: 0, comicPagesUnlocked: 0 },
  featuredGuest: {
    weekKey: "2026-W30",
    packId: "teacher:eliza-elizaos-systems-lab",
    facultyId: "eliza",
    displayName: "Eliza",
    courseTitle: "elizaOS Systems Lab",
    bio: "Guest systems teacher.",
    xHandle: "elizaOS",
  },
};

function plannedWeek(
  context: ScheduledSchoolUpdateContext,
  firstPillar: PlannedTweetPillar = "school-pulse",
): ScheduledTweetPlan {
  const pillars: PlannedTweetPillar[] = [
    firstPillar,
    "student-question",
    "teacher-take",
    "progress-story",
    "school-pulse",
    "student-question",
    "teacher-take",
  ];
  return {
    id: `plan:${context.date}:${context.featuredGuest?.weekKey ?? "school"}`,
    teacherId: "ruby",
    createdAt: 1,
    startsOn: context.date,
    endsOn: "2026-07-28",
    guestWeekKey: context.featuredGuest?.weekKey ?? null,
    slots: pillars.map((pillar, index) => ({
      id: `slot-${index}`,
      publishDate: `2026-07-${String(22 + index).padStart(2, "0")}`,
      pillar,
      angle: `Distinct angle ${index}`,
      brief: `Write the distinct planned post for day ${index}.`,
      callToAction: index % 3 === 0 ? "take-class" : index % 3 === 1 ? "reply" : "none",
      ...(pillar === "guest-spotlight" && context.featuredGuest
        ? { guestWeekKey: context.featuredGuest.weekKey }
        : {}),
    })),
  };
}

function xSocial(
  result: { tweetId: string; teacherId: string; text: string } | null,
  plan: ScheduledTweetPlan | null = plannedWeek(CONTEXT),
) {
  return {
    planScheduledSchoolUpdates: vi.fn(async () => plan),
    postScheduledSchoolUpdateWithFallback: vi.fn(async () => result),
  } as unknown as XSocialService;
}

describe("TweetPlanningScheduler", () => {
  it("starts with empty durable state and exposes the daily cadence", () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    expect(scheduler.getSnapshot()).toMatchObject({
      enabled: true,
      lastAttemptAt: null,
      lastPostAt: null,
      postIntervalMs: MIN_POST_INTERVAL_MS,
      retryIntervalMs: FAILED_POST_RETRY_INTERVAL_MS,
    });
  });

  it("is opt-in and allows the agent to plan an evergreen day without activity", () => {
    const disabled = new TweetPlanningScheduler({ enabled: false });
    expect(disabled.canPostNow(CONTEXT)).toBe(false);
    expect(disabled.getSnapshot().lastSkipReason).toBe("disabled");

    const empty = new TweetPlanningScheduler({ enabled: true });
    expect(empty.canPostNow({
      ...CONTEXT,
      updatedSessionsLast24h: 0,
      activeStudents: 0,
      activeRooms: [],
      highlights: { newStudents: 0, classesPassed: 0, gradesAdvanced: 0, graduations: 0 },
      recentEvents: { roomGoalProgress: 0, relationshipMoments: 0, futuresResolved: 0, comicPagesUnlocked: 0 },
    })).toBe(true);
  });

  it("posts the exact aggregate context and records success", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const social = xSocial({ tweetId: "tweet-1", teacherId: "ruby", text: "A specific school pulse. #RubyHigh" });
    const now = Date.UTC(2026, 6, 22, 17);

    await expect(scheduler.tick(social, TEACHER, CONTEXT, now)).resolves.toMatchObject({
      tweetId: "tweet-1",
      teacherId: "ruby",
    });
    expect(social.planScheduledSchoolUpdates).toHaveBeenCalledWith(TEACHER, CONTEXT, [], now);
    expect(social.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(
      TEACHER,
      CONTEXT,
      expect.objectContaining({
        editorialMode: "school-update",
        plannedSlot: expect.objectContaining({ id: "slot-0", pillar: "school-pulse" }),
        recentPosts: [],
      }),
    );
    expect(scheduler.getSnapshot()).toMatchObject({
      lastAttemptAt: now,
      lastPostAt: now,
      lastTweetId: "tweet-1",
      lastTeacherId: "ruby",
      recentPosts: [expect.objectContaining({ text: "A specific school pulse. #RubyHigh" })],
    });
  });

  it("blocks the same context and enforces one successful post per day", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const social = xSocial({ tweetId: "tweet-1", teacherId: "ruby", text: "First. #RubyHigh" });
    const now = Date.UTC(2026, 6, 22, 17);
    await scheduler.tick(social, TEACHER, CONTEXT, now);

    expect(scheduler.canPostNow(CONTEXT, now + MIN_POST_INTERVAL_MS + 1)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("duplicate-context");
    expect(scheduler.canPostNow({ ...CONTEXT, date: "2026-07-23" }, now + 60_000)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("daily-cooldown");
    expect(scheduler.canPostNow({ ...CONTEXT, date: "2026-07-23" }, now + MIN_POST_INTERVAL_MS + 1)).toBe(true);
  });

  it("builds the advance plan even while today's posting cooldown is active", async () => {
    const now = Date.UTC(2026, 6, 22, 17);
    const scheduler = new TweetPlanningScheduler({
      enabled: true,
      state: { ...defaultSchedulerState(), lastPostAt: now },
    });
    const social = xSocial({ tweetId: "unused", teacherId: "ruby", text: "unused" });

    await expect(scheduler.tick(social, TEACHER, CONTEXT, now + 60_000)).resolves.toBeNull();

    expect(social.planScheduledSchoolUpdates).toHaveBeenCalledOnce();
    expect(social.postScheduledSchoolUpdateWithFallback).not.toHaveBeenCalled();
    expect(scheduler.getSnapshot()).toMatchObject({
      lastPlanAttemptAt: now + 60_000,
      lastSkipReason: "daily-cooldown",
      tweetPlan: expect.objectContaining({ id: expect.any(String) }),
    });
  });

  it("allows an operator-forced post through the normal generation path during cooldown", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const now = Date.UTC(2026, 6, 22, 17);
    await scheduler.tick(xSocial({ tweetId: "tweet-1", teacherId: "ruby", text: "First. #RubyHigh" }), TEACHER, CONTEXT, now);

    const forcedSocial = xSocial({ tweetId: "tweet-2", teacherId: "ruby", text: "Second. #RubyHigh" });
    await expect(scheduler.tick(
      forcedSocial,
      TEACHER,
      CONTEXT,
      now + 60_000,
      { force: true },
    )).resolves.toMatchObject({
      tweetId: "tweet-2",
      teacherId: "ruby",
    });
    expect(forcedSocial.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(
      TEACHER,
      CONTEXT,
      expect.objectContaining({
        plannedSlot: expect.objectContaining({ id: "slot-1", pillar: "student-question" }),
        recentPosts: [expect.objectContaining({ text: "First. #RubyHigh" })],
      }),
    );
    expect(scheduler.getSnapshot()).toMatchObject({
      lastAttemptAt: now + 60_000,
      lastPostAt: now + 60_000,
      lastTweetId: "tweet-2",
      lastSkipReason: null,
    });
  });

  it("replans immediately when the featured guest changes", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const schoolSocial = xSocial({ tweetId: "tweet-school", teacherId: "ruby", text: "School pulse. #RubyHigh" });
    const now = Date.UTC(2026, 6, 22, 17);

    await scheduler.tick(schoolSocial, TEACHER, CONTEXT, now);

    const guestPlan = plannedWeek(GUEST_CONTEXT, "guest-spotlight");
    const insightSocial = xSocial(
      { tweetId: "tweet-insights", teacherId: "ruby", text: "A sourced guest idea. #RubyHigh" },
      guestPlan,
    );
    await expect(scheduler.tick(
      insightSocial,
      { ...TEACHER },
      GUEST_CONTEXT,
      now + 60_000,
      { force: true },
    )).resolves.toMatchObject({ tweetId: "tweet-insights" });
    expect(insightSocial.planScheduledSchoolUpdates).toHaveBeenCalledWith(
      TEACHER,
      GUEST_CONTEXT,
      [expect.objectContaining({ text: "School pulse. #RubyHigh" })],
      now + 60_000,
    );
    expect(insightSocial.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(
      TEACHER,
      GUEST_CONTEXT,
      expect.objectContaining({
        editorialMode: "guest-insights",
        plannedSlot: expect.objectContaining({ pillar: "guest-spotlight" }),
      }),
    );
  });

  it("backs off for six hours after a failed attempt", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const now = Date.UTC(2026, 6, 22, 17);
    await expect(scheduler.tick(xSocial(null), TEACHER, CONTEXT, now)).resolves.toBeNull();
    expect(scheduler.getSnapshot().lastSkipReason).toBe("post-failed");
    expect(scheduler.canPostNow(CONTEXT, now + FAILED_POST_RETRY_INTERVAL_MS - 1)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("failure-cooldown");
    expect(scheduler.canPostNow(CONTEXT, now + FAILED_POST_RETRY_INTERVAL_MS + 1)).toBe(true);
  });

  it("backs off a failed plan without suppressing a materially different guest plan", async () => {
    const scheduler = new TweetPlanningScheduler({ enabled: true });
    const now = Date.UTC(2026, 6, 22, 17);
    const failedPlanner = xSocial(null, null);

    await expect(scheduler.tick(failedPlanner, TEACHER, CONTEXT, now)).resolves.toBeNull();
    await expect(scheduler.tick(failedPlanner, TEACHER, CONTEXT, now + 60_000)).resolves.toBeNull();
    expect(failedPlanner.planScheduledSchoolUpdates).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("failure-cooldown");

    const guestPlanner = xSocial(
      { tweetId: "guest", teacherId: "ruby", text: "Guest post. #RubyHigh" },
      plannedWeek(GUEST_CONTEXT, "guest-spotlight"),
    );
    await expect(scheduler.tick(
      guestPlanner,
      TEACHER,
      GUEST_CONTEXT,
      now + 120_000,
    )).resolves.toMatchObject({ tweetId: "guest" });
    expect(guestPlanner.planScheduledSchoolUpdates).toHaveBeenCalledOnce();
  });

  it("round-trips scheduler state and ignores malformed fields", () => {
    const state = {
      ...defaultSchedulerState(),
      lastAttemptAt: 100,
      lastPostAt: 90,
      lastTweetId: "tweet-1",
      lastTeacherId: "ruby",
      lastContextFingerprint: "abc",
    };
    expect(hydrateScheduledPostSchedulerState(scheduledPostSchedulerStateRecord(state, 200))).toEqual(state);
    expect(hydrateScheduledPostSchedulerState({
      id: "bad",
      updatedAt: 0,
      data: { version: 1, lastAttemptAt: "bad", lastSkipReason: "unknown" },
    })).toEqual(defaultSchedulerState());
  });
});
