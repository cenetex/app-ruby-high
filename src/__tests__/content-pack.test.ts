import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import {
  activeFaculty,
  activeFacultyById,
  activeRoomForFaculty,
  activeRooms,
  activeRoomsWithLounge,
  coursesForSession,
  facultyByIdForSession,
  facultyForSession,
  getActivePack,
  getPackByIdForSession,
  ORIGINAL_PACK_ID,
  packForSession,
  resolveFacultyIdForSession,
  resetActivePack,
  roomForFacultyForSession,
  roomsForSession,
  roomsWithLoungeForSession,
  setActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { ELIZAOS_SYSTEMS_LAB_PACK_ID } from "../content/packs/elizaos-systems-lab.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";

// The pack abstraction's contract: swapping the active pack swaps the
// faculty list, the question banks, and the room layout — the rest of
// the system reads from the pack instead of hardcoded constants. These
// tests are the harness future packs (Anki imports, paid SAT pack,
// LLM-generated packs) plug into.

afterEach(() => {
  resetActivePack();
  vi.unstubAllEnvs();
});

describe("ContentPack registry", () => {
  it("defaults to Ruby High Original — four faculty + matching rooms", async () => {
    const pack = await getActivePack();
    expect(pack.id).toBe("ruby-high-original");
    expect(pack.faculty.map((f) => f.id).sort()).toEqual(
      ["professor-edward", "roko", "ruby", "sally-science"],
    );
    expect(pack.courses?.map((c) => c.id).sort()).toEqual(
      ["professor-edward", "roko", "ruby", "sally-science"],
    );
    // Each teaching faculty has a corresponding room.
    for (const f of pack.faculty) {
      const room = pack.rooms.find((r) => r.teacherId === f.id);
      expect(room, `room missing for faculty ${f.id}`).toBeTruthy();
      expect(room?.teaches).toBe(true);
    }
  });

  it("each faculty in the original pack has a non-empty question bank", async () => {
    const pack = await getActivePack();
    for (const f of pack.faculty) {
      expect(f.questions.length, `faculty ${f.id} has no questions`).toBeGreaterThan(0);
      // Every question carries the canonical fields the rest of the system relies on.
      for (const q of f.questions) {
        expect(q.id).toBeTruthy();
        expect(q.prompt).toBeTruthy();
        expect(q.correct).toBeTruthy();
        expect(q.decoys?.length).toBeGreaterThanOrEqual(3);
        expect(new Set([q.correct, ...(q.decoys ?? [])]).size).toBeGreaterThanOrEqual(4);
        expect(["head", "heart", "hustle", "honor"]).toContain(q.stat);
      }
    }
  });

  it("ships hundreds of playable built-in curriculum cards with teacher corpora", async () => {
    const pack = await getActivePack();
    const questionCounts = Object.fromEntries(pack.faculty.map((f) => [f.id, f.questions.length]));
    const totalCounts = Object.fromEntries(pack.faculty.map((f) => [
      f.id,
      f.questions.length + (f.sourceCards?.length ?? 0),
    ]));
    expect(questionCounts.ruby).toBeGreaterThanOrEqual(200);
    expect(questionCounts["sally-science"]).toBeGreaterThanOrEqual(200);
    expect(questionCounts["professor-edward"]).toBeGreaterThanOrEqual(200);
    expect(questionCounts.roko).toBeGreaterThanOrEqual(200);
    expect(Object.values(totalCounts).reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(800);
  });

  it("keeps built-in teacher corpora gated behind upper-grade progression", async () => {
    const pack = await getActivePack();
    for (const faculty of pack.faculty) {
      const sourceCards = faculty.sourceCards ?? [];
      expect(sourceCards.length, `faculty ${faculty.id} should ship a research corpus`).toBeGreaterThan(0);
      expect(sourceCards.every((card) => card.minGrade && ["10", "11", "12"].includes(card.minGrade))).toBe(true);
      expect(sourceCards.some((card) => card.minGrade === "10")).toBe(true);
      expect(sourceCards.some((card) => card.minGrade === "11")).toBe(true);
      expect(sourceCards.some((card) => card.minGrade === "12")).toBe(true);
    }
  });
});

describe("FacultyService — pack-driven", () => {
  it("loads faculty + banks from the active pack", async () => {
    const svc = await FacultyService.start({} as never);
    expect(svc.isReady()).toBe(true);
    const ids = svc.faculty().map((f) => f.id);
    expect(ids).toContain("ruby");
    expect(ids).toContain("sally-science");
    expect(ids).toContain("professor-edward");
    expect(svc.bank("ruby")?.questions.length).toBeGreaterThan(0);
  });

  it("reloads from a swapped pack — proves the abstraction is real", async () => {
    const fakePack: ContentPack = {
      id: "test:fake",
      name: "Fake Pack",
      description: "A minimal pack for the swap test.",
      version: "0.0.1",
      faculty: [
        {
          id: "fake-teacher",
          displayName: "Fake Teacher",
          shortName: "Fake",
          subjects: ["fake-subject"],
          bio: "A fake teacher.",
          accent: "#000000",
          systemPrompt: "You are a fake teacher.",
          defaultModel: DEFAULT_OPENROUTER_MODEL,
          questions: [
            {
              id: "fake-1",
              prompt: "What is 2+2?",
              options: { A: "3", B: "4", C: "5", D: "6" },
              correct: "B",
              explanation: "Two plus two is four.",
              subject: "fake-subject",
              difficulty: "easy",
              faculty: "fake-teacher",
            },
          ],
        },
      ],
      rooms: [
        {
          id: "fake-room",
          name: "Fake Room",
          channelName: "fake",
          teacherId: "fake-teacher",
          description: "A fake room.",
          teaches: true,
        },
      ],
    };
    setActivePack(fakePack);
    const svc = await FacultyService.start({} as never);
    expect(svc.faculty().map((f) => f.id)).toEqual(["fake-teacher"]);
    expect(svc.bank("fake-teacher")?.questions.length).toBe(1);
    expect(svc.bank("ruby")).toBeNull();
    const picked = svc.pick({ faculty: "fake-teacher" });
    expect(picked?.id).toBe("fake-1");
  });
});

describe("registry sync accessors — pack-swap propagates everywhere", () => {
  it("activeFaculty / activeRoomForFaculty / activeRoomsWithLounge follow the active pack", async () => {
    const fakePack: ContentPack = {
      id: "test:swap-accessors",
      name: "Swap Accessors Pack",
      description: "A pack that proves the sync accessors actually swap.",
      version: "0.0.1",
      faculty: [
        {
          id: "math-tutor",
          displayName: "Math Tutor",
          shortName: "Math",
          subjects: ["algebra"],
          bio: "—",
          accent: "#000",
          systemPrompt: "—",
          defaultModel: DEFAULT_OPENROUTER_MODEL,
          questions: [],
        },
      ],
      rooms: [
        {
          id: "math-lab",
          name: "Math Lab",
          channelName: "math",
          teacherId: "math-tutor",
          description: "—",
          teaches: true,
        },
      ],
    };
    setActivePack(fakePack);
    // Sanity: getActivePack resolves to the fake pack so loadedPack is populated.
    await getActivePack();

    expect(activeFaculty().map((f) => f.id)).toEqual(["math-tutor"]);
    expect(activeFacultyById("math-tutor")?.displayName).toBe("Math Tutor");
    expect(activeFacultyById("ruby")).toBeNull();

    expect(activeRooms().map((r) => r.id)).toEqual(["math-lab"]);
    expect(activeRoomForFaculty("math-tutor")?.id).toBe("math-lab");
    expect(activeRoomForFaculty("ruby")).toBeNull();

    // The lounge always lands at the end of the with-lounge list.
    const withLounge = activeRoomsWithLounge();
    expect(withLounge.map((r) => r.id)).toEqual(["math-lab", "lounge"]);
    expect(withLounge[withLounge.length - 1]?.teaches).toBe(false);
  });
});

describe("per-session pack helpers — abstraction in place", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-persession-"));
    storePath = join(tmpDir, "state.json");
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ORIGINAL_PACK_ID matches the built-in pack's id", async () => {
    const pack = await getActivePack();
    expect(pack.id).toBe(ORIGINAL_PACK_ID);
  });

  it("packForSession resolves session state with the automatic Eliza guest course", async () => {
    await getActivePack();
    expect(packForSession(null).id).toBe(ORIGINAL_PACK_ID);
    expect(packForSession({ activePackId: null }).id)
      .toContain(`${ORIGINAL_PACK_ID}+guest`);
    // Unknown explicit pack ids fall back to the global school — never throw
    // or strand a session.
    expect(packForSession({ activePackId: "test:gone" }).id)
      .toBe(ORIGINAL_PACK_ID);
    expect(getPackByIdForSession(ELIZAOS_SYSTEMS_LAB_PACK_ID, null)?.id)
      .toBe(ELIZAOS_SYSTEMS_LAB_PACK_ID);
  });

  it("the *ForSession sync helpers all read through packForSession", async () => {
    await getActivePack();
    vi.stubEnv("RUBY_HIGH_FEATURED_GUEST_PACK_ID", ELIZAOS_SYSTEMS_LAB_PACK_ID);
    const session = { activePackId: null };
    expect(facultyForSession(session).map((f) => f.id).sort()).toEqual(
      ["guest", "professor-edward", "roko", "ruby", "sally-science"],
    );
    expect(facultyByIdForSession(session, "ruby")?.id).toBe("ruby");
    expect(coursesForSession(session).map((c) => c.teacherTemplateId).sort()).toEqual(
      ["eliza", "professor-edward", "roko", "ruby", "sally-science"],
    );
    expect(resolveFacultyIdForSession(session, "sally-science")).toBe("sally-science");
    expect(facultyByIdForSession(session, "no-such")).toBeNull();
    expect(roomForFacultyForSession(session, "ruby")?.teacherId).toBe("ruby");
    expect(roomForFacultyForSession(session, "no-such")).toBeNull();
    const rooms = roomsForSession(session);
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.every((r) => r.teaches)).toBe(true); // lounge excluded
    const withLounge = roomsWithLoungeForSession(session);
    expect(withLounge.at(-1)?.id).toBe("lounge");
    expect(withLounge.at(-1)?.teaches).toBe(false);
  });

  it("a fresh QuizState has activePackId: null (uses the global pack)", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    const state = ruby.getOrCreate("session:fresh");
    expect(state.activePackId).toBeNull();
    expect(packForSession(state).id).toContain(`${ORIGINAL_PACK_ID}+guest`);
    await ruby.flush();
  });

  it("setActivePackForSession writes the id + wipes board/roster", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    const sid = "session:swap";
    // Seed a roster + manufacture an in-flight round so we can prove the
    // wipe semantics. Use far-future expiresAt so tickRound doesn't
    // auto-resolve before our setActivePackForSession lands.
    ruby.selectGrade(sid, "9");
    const before = ruby.getOrCreate(sid);
    before.current = { id: "stale-q", prompt: "?", type: "multiple-choice",
      options: { A: "1", B: "2", C: "3", D: "4" }, correct: "A" } as any;
    before.activeRound = {
      questionId: "stale-q",
      type: "multiple-choice",
      startedAt: Date.now(),
      durationMs: 60000,
      expiresAt: Date.now() + 60000,
      npcs: [],
      player: { picked: null, answeredAt: null },
      resolved: false,
      resolvedAt: null,
      firstCorrect: null,
      opinionResponses: [],
      opinionGrades: [],
      bestResponder: null,
    } as any;
    before.lastReveal = { questionId: "stale-q" } as any;
    expect(before.npcRosters["9"]).toBeDefined();

    // Today only the original pack is registered, so passing its id is the
    // only valid swap target — but the wipe semantics are what we're
    // exercising (this is the load-bearing primitive for Phase C).
    const after = ruby.setActivePackForSession(sid, ORIGINAL_PACK_ID);
    expect(after.activePackId).toBe(ORIGINAL_PACK_ID);
    expect(after.current).toBeNull();
    expect(after.activeRound).toBeNull();
    expect(after.lastReveal).toBeNull();
    // Roster re-seeded for the current grade after the wipe.
    expect(after.npcRosters["9"]).toBeDefined();
    await ruby.flush();
  });

  it("two sessions on the same RubyHighService have isolated activePackId", async () => {
    await getActivePack();
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    const a = ruby.setActivePackForSession("session:a", ORIGINAL_PACK_ID);
    const b = ruby.getOrCreate("session:b");
    expect(a.activePackId).toBe(ORIGINAL_PACK_ID);
    expect(b.activePackId).toBeNull(); // session B was never switched
    expect(packForSession(a).id).toBe(packForSession(b).id); // same pack today
    await ruby.flush();
  });
});
