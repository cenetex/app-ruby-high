import type { StateStoreLike } from "../state-store.js";
import { log } from "../logger.js";

// ── Post analytics ───────────────────────────────────────────────────────────
// After posting to X, the system fetches tweet metrics (impressions, likes,
// retweets) after a delay and stores them. These metrics feed back into
// content choices so the pipeline can learn what resonates.

export interface PostMetricsRecord {
  tweetId: string;
  teacherId: string;
  postedAt: number;
  fetchedAt: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  kind: string;
  text: string;
}

export interface PendingPostMetrics {
  teacherId: string;
  postedAt: number;
  fetchAfter: number;
  kind: string;
  text: string;
}

const ANALYTICS_STATE_ID = "ruby-high:post-analytics:v1";
const METRICS_FETCH_DELAY_MS = 15 * 60 * 1000;
const MAX_STORED_RECORDS = 200;

export interface HydratedPostAnalyticsState {
  records: PostMetricsRecord[];
  pendingFetches: Map<string, PendingPostMetrics>;
}

export function hydratePostAnalyticsState(
  record: unknown,
): HydratedPostAnalyticsState {
  const out: HydratedPostAnalyticsState = {
    records: [],
    pendingFetches: new Map(),
  };
  if (!record || typeof record !== "object") return out;
  const data = (record as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return out;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 && d.version !== 2) return out;
  if (Array.isArray(d.records)) {
    for (const r of d.records) {
      const normalized = normalizePostMetricsRecord(r);
      if (normalized) out.records.push(normalized);
    }
  }
  if (d.pendingFetches && typeof d.pendingFetches === "object") {
    const pf = d.pendingFetches as Record<string, unknown>;
    for (const [id, value] of Object.entries(pf)) {
      const pending = normalizePendingPostMetrics(value);
      if (typeof id === "string" && pending) out.pendingFetches.set(id, pending);
    }
  }
  return out;
}

export function postAnalyticsStateRecord(input: {
  records: PostMetricsRecord[];
  pendingFetches: ReadonlyMap<string, PendingPostMetrics>;
}): { id: string; updatedAt: number; data: Record<string, unknown> } {
  const pendingFetchesObj: Record<string, PendingPostMetrics> = {};
  for (const [id, pending] of input.pendingFetches) {
    pendingFetchesObj[id] = pending;
  }
  return {
    id: ANALYTICS_STATE_ID,
    updatedAt: Date.now(),
    data: {
      version: 2,
      records: input.records,
      pendingFetches: pendingFetchesObj,
    },
  };
}

function normalizePostMetricsRecord(value: unknown): PostMetricsRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (!(
    typeof r.tweetId === "string" &&
    typeof r.teacherId === "string" &&
    typeof r.postedAt === "number" &&
    typeof r.fetchedAt === "number" &&
    typeof r.impressions === "number" &&
    typeof r.likes === "number" &&
    typeof r.retweets === "number" &&
    typeof r.replies === "number" &&
    typeof r.quotes === "number" &&
    typeof r.kind === "string" &&
    typeof r.text === "string"
  )) return null;
  return {
    tweetId: r.tweetId,
    teacherId: r.teacherId,
    postedAt: r.postedAt,
    fetchedAt: r.fetchedAt,
    impressions: r.impressions,
    likes: r.likes,
    retweets: r.retweets,
    replies: r.replies,
    quotes: r.quotes,
    bookmarks: typeof r.bookmarks === "number" ? r.bookmarks : 0,
    kind: r.kind,
    text: r.text,
  };
}

function normalizePendingPostMetrics(value: unknown): PendingPostMetrics | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      teacherId: "",
      postedAt: Math.max(0, value - METRICS_FETCH_DELAY_MS),
      fetchAfter: value,
      kind: "",
      text: "",
    };
  }
  if (!value || typeof value !== "object") return null;
  const pending = value as Record<string, unknown>;
  if (
    typeof pending.teacherId !== "string" ||
    typeof pending.postedAt !== "number" ||
    typeof pending.fetchAfter !== "number" ||
    typeof pending.kind !== "string" ||
    typeof pending.text !== "string"
  ) return null;
  return {
    teacherId: pending.teacherId,
    postedAt: pending.postedAt,
    fetchAfter: pending.fetchAfter,
    kind: pending.kind,
    text: pending.text,
  };
}

export class PostAnalytics {
  private records: PostMetricsRecord[] = [];
  private pendingFetches = new Map<string, PendingPostMetrics>();
  private store: StateStoreLike | null = null;

  constructor(store: StateStoreLike | null) {
    this.store = store;
  }

  async hydrate(): Promise<void> {
    if (!this.store?.loadServiceState) return;
    try {
      const record = await this.store.loadServiceState(ANALYTICS_STATE_ID);
      const hydrated = hydratePostAnalyticsState(record);
      this.records = hydrated.records;
      this.pendingFetches = hydrated.pendingFetches;
    } catch (err) {
      log.error("post-analytics.hydrate-failed", err);
    }
  }

  enqueueFetch(input: {
    tweetId: string;
    teacherId: string;
    postedAt: number;
    kind: string;
    text: string;
  }): void {
    this.pendingFetches.set(input.tweetId, {
      teacherId: input.teacherId,
      postedAt: input.postedAt,
      fetchAfter: input.postedAt + METRICS_FETCH_DELAY_MS,
      kind: input.kind,
      text: input.text,
    });
    void this.persist();
  }

  getTopPerforming(kind?: string, limit = 10): PostMetricsRecord[] {
    let filtered = this.records;
    if (kind) filtered = filtered.filter((r) => r.kind === kind);
    return [...filtered]
      .sort((a, b) => postBangerScore(b) - postBangerScore(a))
      .slice(0, limit);
  }

  getEngagementScore(kind: string): number {
    const kindRecords = this.records.filter((r) => r.kind === kind);
    if (kindRecords.length === 0) return 0;
    const total = kindRecords.reduce(
      (sum, r) => sum + postBangerScore(r),
      0,
    );
    return Math.round(total / kindRecords.length);
  }

  async fetchPendingMetrics(
    accessToken: string,
  ): Promise<number> {
    const now = Date.now();
    const ready: string[] = [];
    for (const [id, pending] of this.pendingFetches) {
      if (pending.fetchAfter <= now) ready.push(id);
    }
    if (ready.length === 0) return 0;

    let fetched = 0;
    for (let i = 0; i < ready.length; i += 10) {
      const batch = ready.slice(i, i + 10);
      try {
        const ids = batch.join(",");
        const res = await fetch(
          `https://api.x.com/2/tweets?ids=${ids}&tweet.fields=public_metrics`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!res.ok) {
          if (res.status === 401) break;
          continue;
        }
        const data = await res.json() as {
          data?: Array<{
            id: string;
            public_metrics?: {
              impression_count: number;
              like_count: number;
              retweet_count: number;
              reply_count: number;
              quote_count: number;
              bookmark_count?: number;
            };
          }>;
        };
        for (const tweet of data.data ?? []) {
          const metrics = tweet.public_metrics;
          const pending = this.pendingFetches.get(tweet.id);
          if (!metrics || !pending) continue;
          const record: PostMetricsRecord = {
            tweetId: tweet.id,
            teacherId: pending.teacherId,
            postedAt: pending.postedAt,
            fetchedAt: now,
            impressions: metrics.impression_count ?? 0,
            likes: metrics.like_count ?? 0,
            retweets: metrics.retweet_count ?? 0,
            replies: metrics.reply_count ?? 0,
            quotes: metrics.quote_count ?? 0,
            bookmarks: metrics.bookmark_count ?? 0,
            kind: pending.kind,
            text: pending.text,
          };
          this.addRecord(record);
          this.pendingFetches.delete(tweet.id);
          fetched += 1;
        }
      } catch {
        break;
      }
    }
    if (fetched > 0) {
      void this.persist();
    }
    return fetched;
  }

  addRecord(record: PostMetricsRecord): void {
    const idx = this.records.findIndex((r) => r.tweetId === record.tweetId);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    if (this.records.length > MAX_STORED_RECORDS) {
      this.records = this.records.slice(-MAX_STORED_RECORDS);
    }
  }

  private async persist(): Promise<void> {
    if (!this.store?.saveServiceState) return;
    try {
      await this.store.saveServiceState(
        postAnalyticsStateRecord({
          records: this.records,
          pendingFetches: this.pendingFetches,
        }),
      );
    } catch (err) {
      log.error("post-analytics.persist-failed", err);
    }
  }
}

export function postBangerScore(record: PostMetricsRecord): number {
  const weighted = record.likes
    + record.retweets * 2
    + record.replies * 3
    + record.quotes * 3
    + record.bookmarks * 2;
  if (record.impressions <= 0) return weighted;
  return Math.round(((weighted + 2) / (record.impressions + 200)) * 1000);
}
