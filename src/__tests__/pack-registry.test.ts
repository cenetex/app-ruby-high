import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORIGINAL_PACK_ID,
  GUEST_COURSE_ID,
  appendQuestionToPackBank,
  availablePacksForSession,
  coursesForSession,
  getActivePack,
  getPackByIdForSession,
  MAX_PACKS_PER_OWNER,
  packForSession,
  publicCreatorPacks,
  registerPublicPack,
  registerPack,
  resetActivePack,
  guestWeekKey,
  weeklyAutoGuestPack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { ELIZAOS_SYSTEMS_LAB_PACK_ID } from "../content/packs/elizaos-systems-lab.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";

// Multi-pack registry tests. Built-in pack is owned by null and pinned;
// session-scoped packs are owned by sessionId and visible only to that
// session. LRU per-owner caps registered packs.

afterEach(() => {
  vi.unstubAllEnvs();
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
      defaultModel: DEFAULT_OPENROUTER_MODEL,
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

    // Alice sees the built-ins + her own pack, NOT Bob's.
    expect(aliceSees).toEqual(
      ["agent:alice-1", ORIGINAL_PACK_ID, ELIZAOS_SYSTEMS_LAB_PACK_ID].sort(),
    );
    expect(bobSees).toEqual(
      ["agent:bob-1", ORIGINAL_PACK_ID, ELIZAOS_SYSTEMS_LAB_PACK_ID].sort(),
    );
    // Unauthed (no session) sees only built-ins.
    expect(guestSees).toEqual(
      [ORIGINAL_PACK_ID, ELIZAOS_SYSTEMS_LAB_PACK_ID].sort(),
    );
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
    expect(getPackByIdForSession(ELIZAOS_SYSTEMS_LAB_PACK_ID, "session:bob")?.id)
      .toBe(ELIZAOS_SYSTEMS_LAB_PACK_ID);
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
  it("falls back to the global school with its automatic guest on session states", async () => {
    await getActivePack();
    registerPack(fakePack("agent:alice-1"), "session:alice");

    expect(packForSession(null).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: null }).id)
      .toContain(`${ORIGINAL_PACK_ID}+guest`);
    expect(packForSession({ activePackId: "agent:does-not-exist" }).id)
      .toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ sessionId: "session:bob", activePackId: "agent:alice-1" }).id)
      .toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ sessionId: "session:alice", activePackId: "agent:alice-1" }).id).toBe("agent:alice-1");
  });
});

describe("packForSession — weekly guest composition", () => {
  it("honors a configured featured guest only for its scheduled week", async () => {
    await getActivePack();
    registerPublicPack(fakePack("pack:featured-alternative"), 1_000);
    const date = new Date("2026-07-21T12:00:00.000Z");
    const baseline = weeklyAutoGuestPack(date);
    const override = publicCreatorPacks().find((pack) => pack.id !== baseline?.id);
    expect(baseline).not.toBeNull();
    expect(override).toBeDefined();

    vi.stubEnv("RUBY_HIGH_FEATURED_GUEST_PACK_ID", override!.id);
    vi.stubEnv("RUBY_HIGH_FEATURED_GUEST_WEEK_KEY", guestWeekKey(date));
    expect(weeklyAutoGuestPack(date)?.id).toBe(override!.id);

    vi.stubEnv("RUBY_HIGH_FEATURED_GUEST_WEEK_KEY", "2099-W01");
    expect(weeklyAutoGuestPack(date)?.id).toBe(baseline!.id);
  });

  it("keeps Ruby High as the base school and adds one stable guest course", async () => {
    await getActivePack();
    const guestPack = fakePack("pack:guest-signals");
    guestPack.faculty[0]!.questions = [{
      id: "signals-q1",
      prompt: "What is a signal?",
      options: { A: "A measurable pattern", B: "A random guess", C: "A room", D: "A bell" },
      correct: "A",
      faculty: guestPack.faculty[0]!.id,
      subject: "signals",
      difficulty: "easy",
    }];
    registerPublicPack(guestPack, 1_000);

    const composed = packForSession({ activePackId: null, guestPackMode: "auto" });
    expect(composed.id).toContain(`${ORIGINAL_PACK_ID}+guest`);
    expect(composed.faculty.map((f) => f.id)).toContain(GUEST_COURSE_ID);
    expect(composed.faculty.map((f) => f.id)).toContain("ruby");
    expect(coursesForSession({ activePackId: null, guestPackMode: "auto" })).toHaveLength(4);
    expect(composed.faculty.find((f) => f.id === GUEST_COURSE_ID)?.questions[0]).toMatchObject({
      faculty: GUEST_COURSE_ID,
      subject: "signals",
    });
  });
});
