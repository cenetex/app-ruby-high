import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PostRotationScheduler,
  MIN_POST_INTERVAL_MS,
  defaultSchedulerState,
} from "../services/ruby-high/post-scheduler.js";

describe("PostRotationScheduler", () => {
  let scheduler: PostRotationScheduler;

  beforeEach(() => {
    scheduler = new PostRotationScheduler();
  });

  it("starts with null state", () => {
    const snap = scheduler.getSnapshot();
    expect(snap.lastPostKind).toBeNull();
    expect(snap.lastPostAt).toBeNull();
  });

  it("can post initially", () => {
    expect(scheduler.canPostNow("reflection")).toBe(true);
  });

  it("blocks posts within minimum interval", () => {
    const now = 100000;
    scheduler.recordPost("reflection", now);
    expect(scheduler.canPostNow("reflection", now + 10)).toBe(false);
    // After min interval but still within per-kind cooldown for reflection (14400 sec).
    expect(scheduler.canPostNow("reflection", now + MIN_POST_INTERVAL_MS + 1)).toBe(false);
    // After full reflection cooldown expires.
    expect(scheduler.canPostNow("reflection", now + 15 * 3600 * 1000)).toBe(true);
  });

  it("blocks posts within per-kind cooldown for reflections", () => {
    const now = 100000;
    scheduler.recordPost("reflection", now);
    // Reflection cooldown is 14400 sec (4h). After 1 hour it should still be blocked.
    expect(scheduler.canPostNow("reflection", now + 3600 * 1000)).toBe(false);
    // After 5 hours it should be allowed.
    expect(scheduler.canPostNow("reflection", now + 5 * 3600 * 1000)).toBe(true);
  });

  it("allows different post kinds while one is on cooldown", () => {
    const now = 100000;
    scheduler.recordPost("question", now);
    // Question is on cooldown (28800 sec), but reflection should be fine after min interval.
    expect(scheduler.canPostNow("question", now + 100)).toBe(false);
    expect(scheduler.canPostNow("reflection", now + MIN_POST_INTERVAL_MS + 1000)).toBe(true);
  });

  it("pickNextKind returns null when all are on cooldown", () => {
    const now = 100000;
    // Record one post — now minimum interval blocks everything
    scheduler.recordPost("reflection", now);
    expect(scheduler.pickNextKind(now + 100)).toBeNull();
  });

  it("defaultSchedulerState has expected shape", () => {
    const state = defaultSchedulerState();
    expect(state.lastPostKind).toBeNull();
    expect(state.lastPostAt).toBeNull();
    expect(state.lastReflectionAt).toBeNull();
    expect(state.lastQuestionAt).toBeNull();
    expect(state.lastEngagementAt).toBeNull();
  });
});
