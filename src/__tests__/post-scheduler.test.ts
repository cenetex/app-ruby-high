import { describe, expect, it, vi } from "vitest";
import type { TeacherCharacter } from "../characters/teachers.js";
import {
  FAILED_POST_RETRY_INTERVAL_MS,
  MIN_POST_INTERVAL_MS,
  PostRotationScheduler,
  defaultSchedulerState,
  hydrateScheduledPostSchedulerState,
  scheduledPostSchedulerStateRecord,
} from "../services/ruby-high/post-scheduler.js";
import type { ScheduledSchoolUpdateContext } from "../services/ruby-high/post-types.js";
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

function xSocial(result: { tweetId: string; teacherId: string } | null) {
  return {
    postScheduledSchoolUpdateWithFallback: vi.fn(async () => result),
  } as unknown as XSocialService;
}

describe("PostRotationScheduler", () => {
  it("starts with empty durable state and exposes the daily cadence", () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    expect(scheduler.getSnapshot()).toMatchObject({
      enabled: true,
      lastAttemptAt: null,
      lastPostAt: null,
      postIntervalMs: MIN_POST_INTERVAL_MS,
      retryIntervalMs: FAILED_POST_RETRY_INTERVAL_MS,
    });
  });

  it("is opt-in and skips empty activity", () => {
    const disabled = new PostRotationScheduler({ enabled: false });
    expect(disabled.canPostNow(CONTEXT)).toBe(false);
    expect(disabled.getSnapshot().lastSkipReason).toBe("disabled");

    const empty = new PostRotationScheduler({ enabled: true });
    expect(empty.canPostNow({
      ...CONTEXT,
      updatedSessionsLast24h: 0,
      activeStudents: 0,
      activeRooms: [],
      highlights: { newStudents: 0, classesPassed: 0, gradesAdvanced: 0, graduations: 0 },
      recentEvents: { roomGoalProgress: 0, relationshipMoments: 0, futuresResolved: 0, comicPagesUnlocked: 0 },
    })).toBe(false);
    expect(empty.getSnapshot().lastSkipReason).toBe("no-activity");
  });

  it("posts the exact aggregate context and records success", async () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    const social = xSocial({ tweetId: "tweet-1", teacherId: "ruby" });
    const now = Date.UTC(2026, 6, 22, 17);

    await expect(scheduler.tick(social, TEACHER, CONTEXT, now)).resolves.toMatchObject({
      tweetId: "tweet-1",
      teacherId: "ruby",
    });
    expect(social.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(TEACHER, CONTEXT);
    expect(scheduler.getSnapshot()).toMatchObject({
      lastAttemptAt: now,
      lastPostAt: now,
      lastTweetId: "tweet-1",
      lastTeacherId: "ruby",
    });
  });

  it("blocks the same context and enforces one successful post per day", async () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    const social = xSocial({ tweetId: "tweet-1", teacherId: "ruby" });
    const now = Date.UTC(2026, 6, 22, 17);
    await scheduler.tick(social, TEACHER, CONTEXT, now);

    expect(scheduler.canPostNow(CONTEXT, now + MIN_POST_INTERVAL_MS + 1)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("duplicate-context");
    expect(scheduler.canPostNow({ ...CONTEXT, date: "2026-07-23" }, now + 60_000)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("daily-cooldown");
    expect(scheduler.canPostNow({ ...CONTEXT, date: "2026-07-23" }, now + MIN_POST_INTERVAL_MS + 1)).toBe(true);
  });

  it("allows an operator-forced post through the normal generation path during cooldown", async () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    const now = Date.UTC(2026, 6, 22, 17);
    await scheduler.tick(xSocial({ tweetId: "tweet-1", teacherId: "ruby" }), TEACHER, CONTEXT, now);

    const forcedSocial = xSocial({ tweetId: "tweet-2", teacherId: "ruby" });
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
    expect(forcedSocial.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(TEACHER, CONTEXT);
    expect(scheduler.getSnapshot()).toMatchObject({
      lastAttemptAt: now + 60_000,
      lastPostAt: now + 60_000,
      lastTweetId: "tweet-2",
      lastSkipReason: null,
    });
  });

  it("welcomes a new weekly guest, then rotates to source-grounded guest insights", async () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    const welcomeSocial = xSocial({ tweetId: "tweet-welcome", teacherId: "ruby" });
    const now = Date.UTC(2026, 6, 22, 17);

    await expect(scheduler.tick(welcomeSocial, TEACHER, GUEST_CONTEXT, now)).resolves.toMatchObject({
      tweetId: "tweet-welcome",
    });
    expect(welcomeSocial.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(
      TEACHER,
      GUEST_CONTEXT,
      { editorialMode: "guest-welcome" },
    );
    expect(scheduler.getSnapshot().lastWelcomedGuestKey).toBe("2026-W30");

    const insightSocial = xSocial({ tweetId: "tweet-insights", teacherId: "ruby" });
    await expect(scheduler.tick(
      insightSocial,
      { ...TEACHER },
      GUEST_CONTEXT,
      now + 60_000,
      { force: true },
    )).resolves.toMatchObject({ tweetId: "tweet-insights" });
    expect(insightSocial.postScheduledSchoolUpdateWithFallback).toHaveBeenCalledWith(
      TEACHER,
      GUEST_CONTEXT,
      { editorialMode: "guest-insights" },
    );
  });

  it("backs off for six hours after a failed attempt", async () => {
    const scheduler = new PostRotationScheduler({ enabled: true });
    const now = Date.UTC(2026, 6, 22, 17);
    await expect(scheduler.tick(xSocial(null), TEACHER, CONTEXT, now)).resolves.toBeNull();
    expect(scheduler.getSnapshot().lastSkipReason).toBe("post-failed");
    expect(scheduler.canPostNow(CONTEXT, now + FAILED_POST_RETRY_INTERVAL_MS - 1)).toBe(false);
    expect(scheduler.getSnapshot().lastSkipReason).toBe("failure-cooldown");
    expect(scheduler.canPostNow(CONTEXT, now + FAILED_POST_RETRY_INTERVAL_MS + 1)).toBe(true);
  });

  it("round-trips scheduler state and ignores malformed fields", () => {
    const state = {
      ...defaultSchedulerState(),
      lastAttemptAt: 100,
      lastPostAt: 90,
      lastTweetId: "tweet-1",
      lastTeacherId: "ruby",
      lastContextFingerprint: "abc",
      lastWelcomedGuestKey: "2026-W30",
    };
    expect(hydrateScheduledPostSchedulerState(scheduledPostSchedulerStateRecord(state, 200))).toEqual(state);
    expect(hydrateScheduledPostSchedulerState({
      id: "bad",
      updatedAt: 0,
      data: { version: 1, lastAttemptAt: "bad", lastSkipReason: "unknown" },
    })).toEqual(defaultSchedulerState());
  });
});
