import { describe, expect, it, vi } from "vitest";
import { createViewerWorldFeedClient, type ViewerWorldFeedClientDeps } from "../viewer-parts/world-feed.js";
import { mergeWorldFeedEventList, pruneWorldFeedEventList, worldFeedEventsUrl } from "../viewer-parts/client-pure.js";

function makeClient(overrides: Partial<ViewerWorldFeedClientDeps> = {}) {
  let now = Date.UTC(2026, 5, 18, 12);
  const urls: string[] = [];
  const changes: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, _init?: { timeoutMs?: number }) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({}) };
  });
  const consumeSse: ViewerWorldFeedClientDeps["consumeSse"] = vi.fn(async (_response, handlers) => {
    await handlers.onEvent("world-snapshot", {
      generatedAt: now,
      activeStudents: 2,
      activeRooms: [{ grade: "9", facultyId: "ruby", activeStudents: 2 }],
      cohorts: { "9": { activeStudents: 2 } },
      curriculum: { weakPools: [] },
      summary: { schoolYear: "2025-2026", studySparks: { total: 1, byGrade: { "9": 1 } } },
    }, null);
    await handlers.onEvent("world-event", { id: "world:event:a", at: now, label: "Ruby started class" }, "world:cursor:1:world%3Aevent%3Aa");
  });
  const deps: ViewerWorldFeedClientDeps = {
    apiBase: "/api/apps/ruby-high",
    now: () => now,
    apiFetch: fetchMock,
    consumeSse,
    buildEventsUrl: worldFeedEventsUrl,
    pruneEvents: pruneWorldFeedEventList,
    mergeEvents: mergeWorldFeedEventList,
    onChange: () => changes.push(true),
    ...overrides,
  };
  const client = createViewerWorldFeedClient(deps);
  return {
    client,
    urls,
    changes,
    fetchMock,
    consumeSse,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("viewer world feed client", () => {
  it("loads snapshots and events while replaying from a durable cursor", async () => {
    const harness = makeClient();

    await harness.client.load();

    expect(harness.client.state.loaded).toBe(true);
    expect(harness.client.state.loading).toBe(false);
    expect(harness.client.state.activeStudents).toBe(2);
    expect(harness.client.state.activeRooms).toEqual([{ grade: "9", facultyId: "ruby", activeStudents: 2 }]);
    expect(harness.client.state.summary).toEqual({ schoolYear: "2025-2026", studySparks: { total: 1, byGrade: { "9": 1 } } });
    expect(harness.client.state.events).toEqual([
      { id: "world:event:a", at: Date.UTC(2026, 5, 18, 12), label: "Ruby started class" },
    ]);
    expect(harness.urls[0]).toBe("/api/apps/ruby-high/world/events?limit=8&live=1&streamMs=25000&heartbeatMs=5000");

    await harness.client.load();

    expect(harness.urls[1]).toBe("/api/apps/ruby-high/world/events?limit=8&cursor=world%3Acursor%3A1%3Aworld%253Aevent%253Aa&live=1&streamMs=25000&heartbeatMs=5000");
    expect(harness.changes.length).toBeGreaterThanOrEqual(4);
  });

  it("resets replay cursors on force refresh", async () => {
    const harness = makeClient();
    await harness.client.load();

    await harness.client.load({ force: true });

    expect(harness.urls.at(-1)).toBe("/api/apps/ruby-high/world/events?limit=8");
    expect(harness.fetchMock.mock.calls.at(-1)?.[1]).toEqual({ timeoutMs: 8000 });
  });

  it("backs off after rate-limited responses without issuing another request", async () => {
    const consumeSse: ViewerWorldFeedClientDeps["consumeSse"] = vi.fn(async (_response, handlers) => {
      handlers.onErrorResponse("too many streams", { status: 429, retryAfterMs: 12000 });
    });
    const harness = makeClient({ consumeSse });

    await harness.client.load();
    expect(harness.client.state.error).toBe("World feed catching up.");
    expect(harness.client.backoffMs()).toBe(12000);

    await harness.client.load();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.client.state.error).toBe("World feed catching up.");
  });

  it("prunes stale events and keeps timestamp replay cursor aligned", async () => {
    const now = Date.UTC(2026, 5, 18, 12);
    let streamCount = 0;
    const harness = makeClient({
      consumeSse: vi.fn(async (_response, handlers) => {
        streamCount += 1;
        if (streamCount === 1) {
          await handlers.onEvent("world-event", { id: "world:event:old", at: now - 10_000 }, null);
          await handlers.onEvent("world-event", { id: "world:event:new", at: now }, null);
        }
      }),
    });

    await harness.client.load();
    harness.client.prune(now, 1000);
    await harness.client.load();

    expect(harness.client.state.events).toEqual([{ id: "world:event:new", at: now }]);
    expect(harness.urls.at(-1)).toBe("/api/apps/ruby-high/world/events?limit=8&since=1781783999999&live=1&streamMs=25000&heartbeatMs=5000");
  });
});
