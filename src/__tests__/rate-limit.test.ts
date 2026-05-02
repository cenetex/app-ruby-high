import { describe, expect, it } from "vitest";
import { TokenBucket } from "../services/rate-limit.js";

describe("TokenBucket", () => {
  it("starts full and decrements on take()", () => {
    const b = new TokenBucket(5, 1);
    let now = 1_000_000;
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.inspect("k")?.tokens).toBeCloseTo(3, 6);
  });

  it("returns false when the bucket is exhausted, true again after refill", () => {
    const b = new TokenBucket(3, 1); // 1 token/sec
    let now = 5_000_000;
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.take("k", 1, now)).toBe(false);
    // Advance 1.5 seconds — should regain 1 full token.
    now += 1500;
    expect(b.take("k", 1, now)).toBe(true);
    // ...and we should be back below 1 token.
    expect(b.take("k", 1, now)).toBe(false);
  });

  it("never exceeds capacity even after long idle", () => {
    const b = new TokenBucket(4, 1);
    let now = 0;
    expect(b.take("k", 1, now)).toBe(true);
    // Idle for an hour — tokens should cap at capacity, not balloon.
    now += 60 * 60 * 1000;
    expect(b.take("k", 4, now)).toBe(true);
    expect(b.take("k", 1, now)).toBe(false);
  });

  it("isolates buckets per key", () => {
    const b = new TokenBucket(2, 1);
    const now = 1000;
    expect(b.take("alice", 1, now)).toBe(true);
    expect(b.take("alice", 1, now)).toBe(true);
    expect(b.take("alice", 1, now)).toBe(false);
    // Bob's bucket is untouched.
    expect(b.take("bob", 2, now)).toBe(true);
  });

  it("retryAfterSeconds is 0 when tokens are available", () => {
    const b = new TokenBucket(5, 1);
    expect(b.retryAfterSeconds("k", 0)).toBe(0);
    b.take("k", 1, 0);
    expect(b.retryAfterSeconds("k", 0)).toBe(0); // still 4 tokens
  });

  it("retryAfterSeconds returns a positive integer when exhausted", () => {
    const b = new TokenBucket(2, 1); // 1 tok/sec
    let now = 0;
    b.take("k", 2, now);
    expect(b.take("k", 1, now)).toBe(false);
    const wait = b.retryAfterSeconds("k", now);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(2);
  });

  it("rejects requests for more tokens than capacity", () => {
    const b = new TokenBucket(3, 1);
    expect(b.take("k", 4, 0)).toBe(false);
    // The reject did NOT decrement — we still have a full bucket.
    expect(b.take("k", 3, 0)).toBe(true);
  });

  it("gc() drops idle (full) keys", () => {
    // Capacity 10 with a 1/sec refill — full refill takes 10 seconds. We
    // pick a window where idle has refilled to capacity but busy hasn't.
    const b = new TokenBucket(10, 1);
    let now = 0;
    b.take("idle", 1, now); // 9 tokens left
    b.take("busy", 10, now); // 0 tokens left
    expect(b.size()).toBe(2);
    now += 2000; // idle refills to 10 (cap); busy refills to 2 (not full)
    b.gc(now);
    expect(b.size()).toBe(1);
    // The dropped key starts fresh next time.
    expect(b.take("idle", 10, now)).toBe(true);
    expect(b.take("idle", 1, now)).toBe(false);
  });

  it("rejects nonsense constructor inputs", () => {
    expect(() => new TokenBucket(0, 1)).toThrow();
    expect(() => new TokenBucket(-1, 1)).toThrow();
    expect(() => new TokenBucket(1, 0)).toThrow();
    expect(() => new TokenBucket(1, -1)).toThrow();
  });

  it("handles fractional refill cleanly", () => {
    // 0.5 tokens/sec — takes 2 seconds to earn 1 token back.
    const b = new TokenBucket(1, 0.5);
    let now = 0;
    expect(b.take("k", 1, now)).toBe(true);
    expect(b.take("k", 1, now + 1000)).toBe(false); // only 0.5 tokens earned
    expect(b.take("k", 1, now + 2000)).toBe(true);
  });
});
