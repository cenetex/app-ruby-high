import { describe, it, expect } from "vitest";
import {
  hydratePostAnalyticsState,
  postAnalyticsStateRecord,
  PostAnalytics,
  type PostMetricsRecord,
} from "../services/ruby-high/post-analytics.js";

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
      kind: "class-passed",
      text: "test tweet",
    };

    const stored = postAnalyticsStateRecord({
      records: [record],
      pendingFetches: new Map([["tweet-2", 3000]]),
    });

    const hydrated = hydratePostAnalyticsState(stored);
    expect(hydrated.records).toHaveLength(1);
    expect(hydrated.records[0]!.tweetId).toBe("tweet-1");
    expect(hydrated.pendingFetches.get("tweet-2")).toBe(3000);
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
      kind: "class-passed",
      text: "b",
    });

    expect(analytics.getEngagementScore("class-passed")).toBe(5);
    expect(analytics.getEngagementScore("unknown")).toBe(0);
  });
});
