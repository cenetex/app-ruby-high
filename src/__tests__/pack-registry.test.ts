import { afterEach, describe, expect, it } from "vitest";
import {
  ORIGINAL_PACK_ID,
  connectedPackId,
  appendQuestionToPackBank,
  availablePacksForSession,
  getActivePack,
  getPackByIdForSession,
  MAX_PACKS_PER_OWNER,
  packForSession,
  registerPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

// Multi-pack registry tests. Built-in pack is owned by null and pinned;
// session-scoped packs are owned by sessionId and visible only to that
// session. LRU per-owner caps registered packs.

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
  it("a session-scoped pack is visible only to its owning session", async () => {
    await getActivePack();
    registerPack(fakePack("agent:alice-1"), "session:alice");
    registerPack(fakePack("agent:bob-1"), "session:bob");

    const aliceSees = availablePacksForSession("session:alice").map((p) => p.id).sort();
    const bobSees = availablePacksForSession("session:bob").map((p) => p.id).sort();
    const guestSees = availablePacksForSession(null).map((p) => p.id).sort();

    // Alice sees the built-in + her own pack, NOT Bob's.
    expect(aliceSees).toEqual(["agent:alice-1", ORIGINAL_PACK_ID].sort());
    expect(bobSees).toEqual(["agent:bob-1", ORIGINAL_PACK_ID].sort());
    // Unauthed (no session) sees only built-ins.
    expect(guestSees).toEqual([ORIGINAL_PACK_ID]);
  });

  it("getPackByIdForSession enforces ownership — same response for unknown and not-yours", async () => {
    await getActivePack();
    registerPack(fakePack("agent:alice-1"), "session:alice");

    // Alice can fetch her own pack.
    expect(getPackByIdForSession("agent:alice-1", "session:alice")?.id).toBe("agent:alice-1");
    // Bob can't fetch Alice's pack — same `null` as a totally unknown id.
    expect(getPackByIdForSession("agent:alice-1", "session:bob")).toBeNull();
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
    registerPack(fakePack("agent:contested"), "session:alice");
    expect(() => registerPack(fakePack("agent:contested"), "session:bob"))
      .toThrow(/owned by another session/i);
  });

  it("re-registering own pack moves it to the end of LRU (no error)", async () => {
    await getActivePack();
    registerPack(fakePack("agent:mine-1"), "session:alice");
    // Re-register should not throw — same owner.
    expect(() => registerPack(fakePack("agent:mine-1"), "session:alice")).not.toThrow();
    expect(getPackByIdForSession("agent:mine-1", "session:alice")?.id).toBe("agent:mine-1");
  });
});

describe("registerPack — LRU eviction per owner", () => {
  it("evicts the oldest pack of an owner past the cap, leaves built-ins + other owners alone", async () => {
    await getActivePack();
    // Bob has one pack — should not be evicted by Alice's churn.
    registerPack(fakePack("agent:bob-keep"), "session:bob");
    // Alice registers 20 packs (cap is 16). The first 4 should evict.
    for (let i = 0; i < 20; i++) {
      registerPack(fakePack(`agent:alice-${i}`), "session:alice");
    }
    const aliceIds = availablePacksForSession("session:alice").map((p) => p.id);
    // Built-in survives.
    expect(aliceIds).toContain(ORIGINAL_PACK_ID);
    // Alice's first 4 packs evicted.
    expect(aliceIds).not.toContain("agent:alice-0");
    expect(aliceIds).not.toContain("agent:alice-3");
    // Alice's last 16 packs survive.
    expect(aliceIds).toContain("agent:alice-4");
    expect(aliceIds).toContain("agent:alice-19");
    // Bob's pack untouched.
    expect(availablePacksForSession("session:bob")).toContainEqual(
      expect.objectContaining({ id: "agent:bob-keep" }),
    );
  });

  it("treats appended bank questions as an LRU touch", async () => {
    await getActivePack();
    for (let i = 0; i < MAX_PACKS_PER_OWNER; i++) {
      registerPack(fakePack(`agent:alice-${i}`), "session:alice", 1_000 + i);
    }
    appendQuestionToPackBank("agent:alice-0", "agent:alice-0-teacher", {
      id: "touch-q",
      prompt: "Touched?",
      options: { A: "yes", B: "no", C: "maybe", D: "later" },
      correct: "A",
      faculty: "agent:alice-0-teacher",
      subject: "x",
      difficulty: "easy",
    }, 2_000);

    registerPack(fakePack("agent:alice-new"), "session:alice", 2_001);

    const aliceIds = availablePacksForSession("session:alice").map((p) => p.id);
    expect(aliceIds).toContain("agent:alice-0");
    expect(aliceIds).not.toContain("agent:alice-1");
    expect(aliceIds).toContain("agent:alice-new");
  });
});

describe("packForSession — fallback semantics", () => {
  it("falls back to the global active pack on null / unknown / cross-owner activePackId", async () => {
    await getActivePack();
    registerPack(fakePack("agent:alice-1"), "session:alice");

    expect(packForSession(null).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: null }).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: "agent:does-not-exist" }).id).toBe(ORIGINAL_PACK_ID);
    // packForSession does NOT enforce ownership — the route layer
    // already validated when the session activated. So if Bob's
    // session somehow has activePackId=agent:alice-1, packForSession
    // resolves it. (Documented edge case in the registry.)
    expect(packForSession({ activePackId: "agent:alice-1" }).id).toBe("agent:alice-1");
  });
});

describe("connectedPackId helper", () => {
  it("prefixes a slug with the agent: namespace", () => {
    expect(connectedPackId("sally-remote")).toBe("agent:sally-remote");
  });
});
