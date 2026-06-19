/**
 * In-process token-bucket rate limiter.
 *
 * Keyed by an arbitrary string (we use "${clientIp}:${sessionToken|"anon"}").
 * Each key has a refilling bucket; `take()` returns false when there aren't
 * enough tokens left, true when the bucket had room and was decremented.
 *
 * Time is injected as `now` (defaults to Date.now) so tests can advance it
 * deterministically without timer tricks. There's no setInterval anywhere —
 * tokens are refilled lazily on each `take()` based on elapsed wall-clock.
 *
 * `gc()` drops idle keys (those that have refilled back to capacity) so the
 * map doesn't grow unbounded for one-off IP visitors.
 *
 * ## Where this is wired
 *
 * One bucket per concern. Capacities sized to honest UI bursts; refill
 * rates sized to keep a hostile floor low.
 *
 * | Bucket             | File           | Capacity | Refill | Endpoints |
 * |--------------------|----------------|---------:|-------:|-----------|
 * | CHAT_LIMITER       | chat-routes.ts |       60 |  1/sec | POST /chat, /chat/event, /chat/student-chime, /chat/opinion-submit, /chat/character/generate, /chat/reset |
 * | PORTRAIT_LIMITER   | chat-routes.ts |        8 | 1/30s  | POST /chat/character/portrait, /chat/character/diploma |
 * | COMMAND_LIMITER    | routes.ts      |      120 |  2/sec | POST /command (game-state mutation surface) |
 * | PUBLIC_WORLD_ACTION_LIMITER | routes/commands.ts | 6 | 1/min | POST /command hide/report public world event |
 * | PUBLIC_READ_LIMITER | routes.ts      |      120 |  2/sec | GET /world, /world/events, /cohort/:grade |
 * | PACK_REVIEW_LIMITER | pack-library-routes.ts | 8 | 1/min | POST /pack/:id/review |
 * | NFT_MUTATION_LIMITER | routes/nft.ts |       30 | 1/10s | POST /nft/sync-packs, /nft/open-pack, card mint/burn endpoints |
 * | METRICS_EVENT_LIMITER | metrics-events.ts | 60 | 1/sec | POST /metrics/event |
 *
 * Endpoints intentionally NOT gated:
 *
 * - Most GET routes (auth/me, auth/start, chat/history, viewer, assets, packs,
 *   the default session GET) — read-only, cheap, not worth false 429s on a
 *   refresh storm.
 * - POST /control — no-op stub.
 * - POST /auth/logout — single delete, cheap.
 * - GET /auth/callback — cost is one outbound OpenRouter token-exchange.
 *   Acceptable today; revisit if we ever see hostile callback floods.
 * - POST /packs/active — pack switch is a small per-session write.
 */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly refillPerMs: number;

  constructor(
    /** Maximum tokens a single key can hold. Burst size. */
    public readonly capacity: number,
    /** How many tokens a key earns back per second when idle. */
    public readonly refillPerSecond: number,
  ) {
    if (capacity <= 0) throw new Error("capacity must be > 0");
    if (refillPerSecond <= 0) throw new Error("refillPerSecond must be > 0");
    this.refillPerMs = refillPerSecond / 1000;
  }

  /** Try to consume `n` tokens for `key`. Returns true on success.
   *  When false, the caller should reject the request (e.g. 429). */
  take(key: string, n = 1, now: number = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = now - b.lastRefill;
      if (elapsed > 0) {
        b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
        b.lastRefill = now;
      }
    }
    if (b.tokens < n) return false;
    b.tokens -= n;
    return true;
  }

  /** Seconds until `key` would have at least 1 token. 0 if it already does.
   *  Useful for the Retry-After header on a 429. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const elapsed = now - b.lastRefill;
    const projected = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
    if (projected >= 1) return 0;
    return Math.ceil((1 - projected) / this.refillPerMs / 1000);
  }

  /** Drop entries that have refilled to capacity. Saves memory when the IP
   *  pool is large and most visitors are one-offs. */
  gc(now: number = Date.now()): void {
    for (const [k, b] of this.buckets) {
      const elapsed = now - b.lastRefill;
      const projected = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
      if (projected >= this.capacity) this.buckets.delete(k);
    }
  }

  /** Test hook — current bucket state. Don't depend on this in production code. */
  inspect(key: string): { tokens: number; lastRefill: number } | undefined {
    const b = this.buckets.get(key);
    return b ? { ...b } : undefined;
  }

  /** Test hook — count of currently-tracked keys. */
  size(): number {
    return this.buckets.size;
  }
}
