export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly refillPerMs: number;
  private readonly gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Maximum tokens a single key can hold. Burst size. */
    public readonly capacity: number,
    /** How many tokens a key earns back per second when idle. */
    public readonly refillPerSecond: number,
    /** Milliseconds between GC sweeps. 0 or negative disables. Defaults to 5 minutes. */
    gcIntervalMs: number = 300_000,
  ) {
    if (capacity <= 0) throw new Error("capacity must be > 0");
    if (refillPerSecond <= 0) throw new Error("refillPerSecond must be > 0");
    this.refillPerMs = refillPerSecond / 1000;
    if (gcIntervalMs > 0) {
      this.gcTimer = setInterval(() => this.gc(), gcIntervalMs);
      if (typeof this.gcTimer.unref === "function") this.gcTimer.unref();
    }
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

  /** Stop the periodic GC timer. Call during service shutdown. */
  close(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
    }
  }
}
