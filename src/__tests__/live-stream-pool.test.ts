import { describe, expect, it } from "vitest";
import { LiveStreamPool } from "../routes/live-stream-pool.js";

describe("live stream pool", () => {
  it("caps per-client streams and exposes saturation metrics", () => {
    const pool = new LiveStreamPool(2);
    const releaseA = pool.reserve("client-a");
    const releaseB = pool.reserve("client-a");

    expect(releaseA).toBeTypeOf("function");
    expect(releaseB).toBeTypeOf("function");
    expect(pool.reserve("client-a")).toBeNull();
    expect(pool.snapshot()).toEqual({
      active: 2,
      clients: 1,
      limitPerClient: 2,
      saturatedClients: 1,
      maxClientStreams: 2,
    });
  });

  it("tracks clients independently and releases reservations idempotently", () => {
    const pool = new LiveStreamPool(2);
    const releaseA1 = pool.reserve("client-a")!;
    const releaseA2 = pool.reserve("client-a")!;
    const releaseB1 = pool.reserve("client-b")!;

    expect(pool.snapshot()).toMatchObject({
      active: 3,
      clients: 2,
      saturatedClients: 1,
      maxClientStreams: 2,
    });

    releaseA1();
    releaseA1();
    expect(pool.snapshot()).toMatchObject({
      active: 2,
      clients: 2,
      saturatedClients: 0,
      maxClientStreams: 1,
    });

    releaseA2();
    releaseB1();
    expect(pool.snapshot()).toEqual({
      active: 0,
      clients: 0,
      limitPerClient: 2,
      saturatedClients: 0,
      maxClientStreams: 0,
    });
  });

  it("normalizes empty client keys to the shared anonymous bucket", () => {
    const pool = new LiveStreamPool(1);
    const release = pool.reserve("");

    expect(release).toBeTypeOf("function");
    expect(pool.reserve("no-ip")).toBeNull();
    release?.();
    expect(pool.reserve("no-ip")).toBeTypeOf("function");
  });

  it("bounds malformed client keys before accounting streams", () => {
    const pool = new LiveStreamPool(1);
    const longKey = ` client\n\t${"x".repeat(220)} `;
    const equivalentBoundedKey = `client ${"x".repeat(220)}`.slice(0, 160);
    const release = pool.reserve(longKey);

    expect(release).toBeTypeOf("function");
    expect(pool.reserve(equivalentBoundedKey)).toBeNull();
    expect(pool.snapshot()).toMatchObject({
      active: 1,
      clients: 1,
      saturatedClients: 1,
      maxClientStreams: 1,
    });

    release?.();
    expect(pool.snapshot()).toMatchObject({ active: 0, clients: 0 });
  });

  it("normalizes invalid limits to one stream per client", () => {
    const pool = new LiveStreamPool(0);
    const release = pool.reserve("client-a");

    expect(release).toBeTypeOf("function");
    expect(pool.reserve("client-a")).toBeNull();
    expect(pool.snapshot()).toMatchObject({
      active: 1,
      clients: 1,
      limitPerClient: 1,
      saturatedClients: 1,
    });
  });
});
