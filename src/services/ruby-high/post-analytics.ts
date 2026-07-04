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
  kind: string;
  text: string;
}

const ANALYTICS_STATE_ID = "ruby-high:post-analytics:v1";
const METRICS_FETCH_DELAY_MS = 15 * 60 * 1000;
const MAX_STORED_RECORDS = 200;

export interface HydratedPostAnalyticsState {
  records: PostMetricsRecord[];
  pendingFetches: Map<string, number>;
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
  if (d.version !== 1) return out;
  if (Array.isArray(d.records)) {
    for (const r of d.records) {
      if (isPostMetricsRecord(r)) out.records.push(r);
    }
  }
  if (d.pendingFetches && typeof d.pendingFetches === "object") {
    const pf = d.pendingFetches as Record<string, unknown>;
    for (const [id, ts] of Object.entries(pf)) {
      if (typeof id === "string" && typeof ts === "number" && Number.isFinite(ts)) {
        out.pendingFetches.set(id, ts);
      }
    }
  }
  return out;
}

export function postAnalyticsStateRecord(input: {
  records: PostMetricsRecord[];
  pendingFetches: ReadonlyMap<string, number>;
}): { id: string; updatedAt: number; data: Record<string, unknown> } {
  const pendingFetchesObj: Record<string, number> = {};
  for (const [id, ts] of input.pendingFetches) {
    pendingFetchesObj[id] = ts;
  }
  return {
    id: ANALYTICS_STATE_ID,
    updatedAt: Date.now(),
    data: {
      version: 1,
      records: input.records,
      pendingFetches: pendingFetchesObj,
    },
  };
}

function isPostMetricsRecord(value: unknown): value is PostMetricsRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
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
  );
}

export class PostAnalytics {
  private records: PostMetricsRecord[] = [];
  private pendingFetches = new Map<string, number>();
  private store: StateStoreLike | null = null;
  private fetchTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.scheduleNextFetch();
    } catch (err) {
      log.error("post-analytics.hydrate-failed", err);
    }
  }

  enqueueFetch(tweetId: string, postedAt: number): void {
    const fetchAfter = postedAt + METRICS_FETCH_DELAY_MS;
    this.pendingFetches.set(tweetId, fetchAfter);
    void this.persist();
    this.scheduleNextFetch();
  }

  getTopPerforming(kind?: string, limit = 10): PostMetricsRecord[] {
    let filtered = this.records;
    if (kind) filtered = filtered.filter((r) => r.kind === kind);
    return [...filtered]
      .sort((a, b) => b.likes + b.retweets - (a.likes + a.retweets))
      .slice(0, limit);
  }

  getEngagementScore(kind: string): number {
    const kindRecords = this.records.filter((r) => r.kind === kind);
    if (kindRecords.length === 0) return 0;
    const total = kindRecords.reduce(
      (sum, r) => sum + r.likes + r.retweets * 2 + r.replies * 3,
      0,
    );
    return Math.round(total / kindRecords.length);
  }

  async fetchPendingMetrics(
    accessToken: string,
  ): Promise<number> {
    const now = Date.now();
    const ready: string[] = [];
    for (const [id, fetchAfter] of this.pendingFetches) {
      if (fetchAfter <= now) ready.push(id);
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
            };
          }>;
        };
        for (const tweet of data.data ?? []) {
          const metrics = tweet.public_metrics;
          if (!metrics) continue;
          const record: PostMetricsRecord = {
            tweetId: tweet.id,
            teacherId: "",
            postedAt: 0,
            fetchedAt: now,
            impressions: metrics.impression_count ?? 0,
            likes: metrics.like_count ?? 0,
            retweets: metrics.retweet_count ?? 0,
            replies: metrics.reply_count ?? 0,
            quotes: metrics.quote_count ?? 0,
            kind: "",
            text: "",
          };
          this.addRecord(record);
          this.pendingFetches.delete(tweet.id);
        }
        fetched += batch.length;
      } catch {
        break;
      }
    }
    if (fetched > 0) {
      void this.persist();
      this.scheduleNextFetch();
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

  private scheduleNextFetch(): void {
    if (this.fetchTimer) clearTimeout(this.fetchTimer);
    const now = Date.now();
    let nextAt = Infinity;
    for (const fetchAfter of this.pendingFetches.values()) {
      if (fetchAfter > now && fetchAfter < nextAt) {
        nextAt = fetchAfter;
      }
    }
    if (Number.isFinite(nextAt)) {
      const delay = Math.max(60_000, nextAt - now);
      this.fetchTimer = setTimeout(() => {
        this.fetchTimer = null;
      }, delay);
      this.fetchTimer.unref?.();
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

