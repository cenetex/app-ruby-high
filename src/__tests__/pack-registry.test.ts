import { afterEach, describe, expect, it } from "vitest";
import {
  ORIGINAL_PACK_ID,
  ankiPackId,
  availablePacksForSession,
  getActivePack,
  getPackByIdForSession,
  packForSession,
  registerPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

// Multi-pack registry tests. Built-in pack is owned by null and pinned;
// user-imported packs are owned by sessionId and visible only to the
// importing session. LRU per-owner caps registered imports.

afterEach(() => {
  resetActivePack();
});

function fakePack(id: string): ContentPack {
  return {
    id,
    name: id,
    description: "—",
    version: "0.0.1",
    faculty: [{
      id: `${id}-teacher`,
      displayName: id,
      shortName: id,
      subjects: ["x"],
      bio: "—",
      accent: "#000",
      systemPrompt: "—",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
    }],
    rooms: [{
      id: `${id}-room`,
      name: id,
      channelName: id,
      teacherId: `${id}-teacher`,
      description: "—",
      teaches: true,
    }],
  };
}

describe("registerPack — ownership + visibility", () => {
  it("a user-imported pack is visible only to the importing session", async () => {
    await getActivePack();
    registerPack(fakePack("anki:alice-1"), "session:alice");
    registerPack(fakePack("anki:bob-1"), "session:bob");

    const aliceSees = availablePacksForSession("session:alice").map((p) => p.id).sort();
    const bobSees = availablePacksForSession("session:bob").map((p) => p.id).sort();
    const guestSees = availablePacksForSession(null).map((p) => p.id).sort();

    // Alice sees the built-in + her own pack, NOT Bob's.
    expect(aliceSees).toEqual(["anki:alice-1", ORIGINAL_PACK_ID].sort());
    expect(bobSees).toEqual(["anki:bob-1", ORIGINAL_PACK_ID].sort());
    // Unauthed (no session) sees only built-ins.
    expect(guestSees).toEqual([ORIGINAL_PACK_ID]);
  });

  it("getPackByIdForSession enforces ownership — same response for unknown and not-yours", async () => {
    await getActivePack();
    registerPack(fakePack("anki:alice-1"), "session:alice");

    // Alice can fetch her own pack.
    expect(getPackByIdForSession("anki:alice-1", "session:alice")?.id).toBe("anki:alice-1");
    // Bob can't fetch Alice's pack — same `null` as a totally unknown id.
    expect(getPackByIdForSession("anki:alice-1", "session:bob")).toBeNull();
    expect(getPackByIdForSession("does-not-exist", "session:bob")).toBeNull();
    // Built-ins are visible to everyone.
    expect(getPackByIdForSession(ORIGINAL_PACK_ID, "session:bob")?.id).toBe(ORIGINAL_PACK_ID);
  });

  it("registerPack refuses to overwrite a pinned built-in pack id", async () => {
    await getActivePack();
    expect(() => registerPack(fakePack(ORIGINAL_PACK_ID), "session:malicious"))
      .toThrow(/pinned built-in/i);
  });

  it("registerPack refuses to register a pack id another session already owns", async () => {
    await getActivePack();
    registerPack(fakePack("anki:contested"), "session:alice");
    expect(() => registerPack(fakePack("anki:contested"), "session:bob"))
      .toThrow(/owned by another session/i);
  });

  it("re-registering own pack moves it to the end of LRU (no error)", async () => {
    await getActivePack();
    registerPack(fakePack("anki:mine-1"), "session:alice");
    // Re-register should not throw — same owner.
    expect(() => registerPack(fakePack("anki:mine-1"), "session:alice")).not.toThrow();
    expect(getPackByIdForSession("anki:mine-1", "session:alice")?.id).toBe("anki:mine-1");
  });
});

describe("registerPack — LRU eviction per owner", () => {
  it("evicts the oldest pack of an owner past the cap, leaves built-ins + other owners alone", async () => {
    await getActivePack();
    // Bob has one pack — should not be evicted by Alice's churn.
    registerPack(fakePack("anki:bob-keep"), "session:bob");
    // Alice imports 20 packs (cap is 16). The first 4 should evict.
    for (let i = 0; i < 20; i++) {
      registerPack(fakePack(`anki:alice-${i}`), "session:alice");
    }
    const aliceIds = availablePacksForSession("session:alice").map((p) => p.id);
    // Built-in survives.
    expect(aliceIds).toContain(ORIGINAL_PACK_ID);
    // Alice's first 4 imports evicted.
    expect(aliceIds).not.toContain("anki:alice-0");
    expect(aliceIds).not.toContain("anki:alice-3");
    // Alice's last 16 imports survive.
    expect(aliceIds).toContain("anki:alice-4");
    expect(aliceIds).toContain("anki:alice-19");
    // Bob's pack untouched.
    expect(availablePacksForSession("session:bob")).toContainEqual(
      expect.objectContaining({ id: "anki:bob-keep" }),
    );
  });
});

describe("packForSession — fallback semantics", () => {
  it("falls back to the global active pack on null / unknown / cross-owner activePackId", async () => {
    await getActivePack();
    registerPack(fakePack("anki:alice-1"), "session:alice");

    expect(packForSession(null).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: null }).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: "anki:does-not-exist" }).id).toBe(ORIGINAL_PACK_ID);
    // packForSession does NOT enforce ownership — the route layer
    // already validated when the session activated. So if Bob's
    // session somehow has activePackId=anki:alice-1, packForSession
    // resolves it. (Documented edge case in the registry.)
    expect(packForSession({ activePackId: "anki:alice-1" }).id).toBe("anki:alice-1");
  });
});

describe("ankiPackId helper", () => {
  it("prefixes a slug with the anki: namespace", () => {
    expect(ankiPackId("spanish-101")).toBe("anki:spanish-101");
  });
});
