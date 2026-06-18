import { describe, expect, it } from "vitest";
import {
  PHOTO_POST_SCHEDULER_STATE_ID,
  hydratePhotoPostSchedulerState,
  normalizeDailyPhotoPostResult,
  photoPostSchedulerSnapshot,
  photoPostSchedulerStateRecord,
} from "../services/ruby-high/photo-post-scheduler.js";
import type { StoredServiceStateRecord } from "../services/state-store.js";

describe("photo post scheduler state", () => {
  it("hydrates only valid deferred retries and normalizes timestamps", () => {
    const record: StoredServiceStateRecord = {
      id: PHOTO_POST_SCHEDULER_STATE_ID,
      updatedAt: 123,
      data: {
        version: 1,
        deferredPosts: {
          "photo:ready": 42.9,
          "photo:negative": -10,
          "photo:nan": Number.NaN,
          "photo:string": "soon",
        },
        lastAttemptAt: 98.7,
        lastResult: {
          photoId: "photo:ready",
          sessionId: "session:1",
          kind: "class-photo",
          teacherFacultyId: "ruby",
          posted: false,
          revealed: false,
          deferredUntil: 123.9,
          fallback: false,
        },
      },
    };

    const hydrated = hydratePhotoPostSchedulerState(record);

    expect(Array.from(hydrated.deferredPhotoPosts.entries())).toEqual([
      ["photo:ready", 42],
      ["photo:negative", 0],
    ]);
    expect(hydrated.lastAttemptAt).toBe(98);
    expect(hydrated.lastResult).toMatchObject({
      photoId: "photo:ready",
      kind: "class-photo",
      deferredUntil: 123,
    });
  });

  it("drops malformed persisted state instead of reviving broken posts", () => {
    expect(hydratePhotoPostSchedulerState(null)).toMatchObject({
      lastAttemptAt: null,
      lastResult: null,
    });
    expect(hydratePhotoPostSchedulerState({
      id: PHOTO_POST_SCHEDULER_STATE_ID,
      updatedAt: 1,
      data: { version: 2, deferredPosts: { "photo:old": 10 } },
    }).deferredPhotoPosts.size).toBe(0);
    expect(normalizeDailyPhotoPostResult({
      photoId: "photo:bad",
      sessionId: "session:1",
      kind: "unknown",
      teacherFacultyId: "ruby",
      posted: false,
      revealed: false,
    })).toBeNull();
  });

  it("reports the earliest finite retry and serializes durable state", () => {
    const deferredPhotoPosts = new Map<string, number>([
      ["photo:later", 300],
      ["photo:first", 100],
      ["photo:invalid", Number.POSITIVE_INFINITY],
    ]);

    expect(photoPostSchedulerSnapshot({
      schedulerActive: true,
      schedulerRunning: false,
      schedulerIntervalMs: 60_000,
      pendingPhotos: 4,
      inFlightPosts: 1,
      deferredPhotoPosts,
      lastAttemptAt: 50,
      lastResult: null,
    })).toMatchObject({
      deferredPosts: 3,
      nextRetryAt: 100,
    });

    expect(photoPostSchedulerStateRecord({
      deferredPhotoPosts,
      lastAttemptAt: 50,
      lastResult: {
        photoId: "photo:first",
        sessionId: "session:1",
        kind: "portrait",
        teacherFacultyId: "ruby",
        posted: true,
        revealed: true,
        tweetId: "tweet:1",
      },
      now: 999,
    })).toEqual({
      id: PHOTO_POST_SCHEDULER_STATE_ID,
      updatedAt: 999,
      data: {
        version: 1,
        deferredPosts: {
          "photo:later": 300,
          "photo:first": 100,
        },
        lastAttemptAt: 50,
        lastResult: {
          photoId: "photo:first",
          sessionId: "session:1",
          kind: "portrait",
          teacherFacultyId: "ruby",
          posted: true,
          revealed: true,
          tweetId: "tweet:1",
        },
      },
    });
  });
});
