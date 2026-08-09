import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let store: StateStore;
let ruby: RubyHighService;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-share-loop-"));
  store = new StateStore(join(tmpDir, "state.json"));
  ruby = new RubyHighService({} as never, store);
  await ruby["hydrate"]();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("share loop instrumentation", () => {
  it("records each loop stage and aggregates referral metrics", async () => {
    await ruby.recordShareArtifactCreatedDurably("rh:s1", {
      shareId: "abc123",
      grade: "freshman",
      kind: "yearbook_card",
    });
    await ruby.recordShareInitiatedDurably("rh:s1", {
      shareId: "abc123",
      destination: "copy",
      kind: "yearbook_card",
      visitorHash: "v1",
    });
    // Two inbound clicks from the same referred visitor -> linkVisits counts
    // both, uniqueReferredVisitors counts once.
    await ruby.recordShareLinkVisitedDurably("rh:s2", { ref: "yb_abc123", landing: "/viewer", visitorHash: "v2" });
    await ruby.recordShareLinkVisitedDurably("rh:s3", { ref: "yb_abc123", visitorHash: "v2" });

    const events = ruby.analyticsSnapshot().events;
    expect(events.referral).toEqual({
      artifactsCreated: 1,
      sharesInitiated: 1,
      linkVisits: 2,
      uniqueReferredVisitors: 1,
      shareClickThroughRate: 2,
      uniqueShareClickThroughRate: 1,
      byRef: {
        yb_abc123: { visits: 2, uniqueVisitors: 1 },
      },
    });
    expect(events.byName.share_artifact_created).toBe(1);
    expect(events.byName.share_initiated).toBe(1);
    expect(events.byName.share_link_visited).toBe(2);
  });

  it("persists loop events with attribution metadata", async () => {
    await ruby.recordShareInitiatedDurably("rh:s1", { shareId: "abc123", destination: "copy", kind: "yearbook_card" });
    await ruby.recordShareLinkVisitedDurably("rh:s2", { ref: "yb_abc123", landing: "/viewer", visitorHash: "v2" });

    const persisted = await store.loadMetricEvents();
    const initiated = persisted.find((e) => e.name === "share_initiated");
    const visited = persisted.find((e) => e.name === "share_link_visited");

    expect(initiated?.feature).toBe("referral");
    expect(initiated?.metadata).toMatchObject({ shareId: "abc123", destination: "copy", kind: "yearbook_card" });
    expect(visited?.feature).toBe("referral");
    expect(visited?.metadata).toMatchObject({ ref: "yb_abc123", landing: "/viewer" });
    expect(visited?.visitorHash).toBe("v2");
  });

  it("tags a referred app_open with the ref so the session is attributable", async () => {
    await ruby.recordAppOpenDurably("rh:s4", { visitorHash: "v3", path: "/viewer", ref: "yb_abc123" });

    const appOpen = (await store.loadMetricEvents()).find((e) => e.name === "app_open");
    expect(appOpen?.metadata).toMatchObject({ path: "/viewer", ref: "yb_abc123" });
  });
});
