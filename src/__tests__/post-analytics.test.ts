import { afterEach, describe, it, expect, vi } from "vitest";
import {
  hydratePostAnalyticsState,
  postAnalyticsStateRecord,
  PostAnalytics,
  type PostMetricsRecord,
} from "../services/ruby-high/post-analytics.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hydratePostAnalyticsState", () => {
  it("returns empty state for null", () => {
    const state = hydratePostAnalyticsState(null);
    expect(state.records).toEqual([]);
    expect(state.pendingFetches.size).toBe(0);
  });

  it("hydrates valid records", () => {
    const record: PostMetricsRecord = {
      tweetId: "tweet-1",
      teacherId: "ruby",
      postedAt: 1000,
      fetchedAt: 2000,
      impressions: 100,
      likes: 5,
      retweets: 2,
      replies: 1,
      quotes: 0,
      bookmarks: 1,
      kind: "class-passed",
      text: "test tweet",
    };

    const stored = postAnalyticsStateRecord({
      records: [record],
      pendingFetches: new Map([["tweet-2", {
        teacherId: "ruby",
        postedAt: 2000,
        fetchAfter: 3000,
        kind: "school-update",
        text: "A claim met its receipt.",
      }]]),
    });

    const hydrated = hydratePostAnalyticsState(stored);
    expect(hydrated.records).toHaveLength(1);
    expect(hydrated.records[0]!.tweetId).toBe("tweet-1");
    expect(hydrated.pendingFetches.get("tweet-2")).toMatchObject({
      teacherId: "ruby",
      fetchAfter: 3000,
      kind: "school-update",
    });
  });

  it("drops malformed records", () => {
    const stored = {
      id: "ruby-high:post-analytics:v1",
      updatedAt: 1,
      data: {
        version: 1,
        records: [{ notARealRecord: true }],
        pendingFetches: {},
      },
    };
    const hydrated = hydratePostAnalyticsState(stored);
    expect(hydrated.records).toHaveLength(0);
  });
});

describe("PostAnalytics", () => {
  it("starts with empty state", () => {
    const analytics = new PostAnalytics(null);
    expect(analytics.getTopPerforming()).toEqual([]);
    expect(analytics.getEngagementScore("class-passed")).toBe(0);
  });

  it("tracks top performing posts", () => {
    const analytics = new PostAnalytics(null);
    analytics.addRecord({
      tweetId: "t1",
      teacherId: "ruby",
      postedAt: 0,
      fetchedAt: 0,
      impressions: 10,
      likes: 1,
      retweets: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
      kind: "class-passed",
      text: "a",
    });
    analytics.addRecord({
      tweetId: "t2",
      teacherId: "ruby",
      postedAt: 0,
      fetchedAt: 0,
      impressions: 1000,
      likes: 50,
      retweets: 20,
      replies: 5,
      quotes: 2,
      bookmarks: 3,
      kind: "graduated",
      text: "b",
    });

    const top = analytics.getTopPerforming();
    expect(top[0]!.tweetId).toBe("t2");
    expect(top[0]!.likes).toBe(50);
  });

  it("computes engagement score per kind", () => {
    const analytics = new PostAnalytics(null);
    analytics.addRecord({
      tweetId: "t1",
      teacherId: "ruby",
      postedAt: 0,
      fetchedAt: 0,
      impressions: 10,
      likes: 10,
      retweets: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
      kind: "class-passed",
      text: "a",
    });
    analytics.addRecord({
      tweetId: "t2",
      teacherId: "ruby",
      postedAt: 0,
      fetchedAt: 0,
      impressions: 10,
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
      kind: "class-passed",
      text: "b",
    });

    expect(analytics.getEngagementScore("class-passed")).toBe(34);
    expect(analytics.getEngagementScore("unknown")).toBe(0);
  });

  it("keeps post context when it fetches X metrics", async () => {
    const analytics = new PostAnalytics(null);
    analytics.enqueueFetch({
      tweetId: "tweet-context",
      teacherId: "sally-science",
      postedAt: Date.now() - 20 * 60 * 1000,
      kind: "school-update",
      text: "Three trials agreed. The fourth brought a lawyer.",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "tweet-context",
          public_metrics: {
            impression_count: 400,
            like_count: 20,
            retweet_count: 4,
            reply_count: 3,
            quote_count: 2,
            bookmark_count: 5,
          },
        }],
      }),
    }));

    await expect(analytics.fetchPendingMetrics("token")).resolves.toBe(1);
    expect(analytics.getTopPerforming()[0]).toMatchObject({
      tweetId: "tweet-context",
      teacherId: "sally-science",
      kind: "school-update",
      text: "Three trials agreed. The fourth brought a lawyer.",
      bookmarks: 5,
    });
  });
});
