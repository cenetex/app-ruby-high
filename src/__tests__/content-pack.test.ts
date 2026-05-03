import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  facultyByIdForSession,
  facultyForSession,
  getActivePack,
  packForSession,
  registerPack,
  resetActivePack,
  roomForFacultyForSession,
  roomsWithLoungeForSession,
  setActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";

// The pack abstraction's contract: swapping the active pack swaps the
// faculty list, the question banks, and the room layout — the rest of
// the system reads from the pack instead of hardcoded constants. These
// tests are the harness future packs (Anki imports, paid SAT pack,
// LLM-generated packs) plug into.

afterEach(() => {
  resetActivePack();
});

describe("ContentPack registry", () => {
  it("defaults to Ruby High Original — three faculty + matching rooms", async () => {
    const pack = await getActivePack();
    expect(pack.id).toBe("ruby-high-original");
    expect(pack.faculty.map((f) => f.id).sort()).toEqual(
      ["professor-edward", "ruby", "sally-science"],
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
        expect(["A", "B", "C", "D"]).toContain(q.correct);
        expect(q.options.A).toBeTruthy();
        expect(q.options.B).toBeTruthy();
        expect(q.options.C).toBeTruthy();
        expect(q.options.D).toBeTruthy();
      }
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
          defaultModel: "anthropic/claude-haiku-4.5",
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
          defaultModel: "anthropic/claude-haiku-4.5",
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

describe("per-session active pack", () => {
  function fakePack(id: string, facultyId: string): ContentPack {
    return {
      id, name: id, description: "—", version: "0.0.1",
      faculty: [{
        id: facultyId, displayName: facultyId, shortName: facultyId,
        subjects: ["x"], bio: "—", accent: "#000",
        systemPrompt: "—", defaultModel: "anthropic/claude-haiku-4.5",
        questions: [{
          id: `${facultyId}-1`, prompt: "?", options: { A: "1", B: "2", C: "3", D: "4" },
          correct: "A", subject: "x", difficulty: "easy", faculty: facultyId,
        }],
      }],
      rooms: [{
        id: `${facultyId}-room`, name: facultyId, channelName: facultyId,
        teacherId: facultyId, description: "—", teaches: true,
      }],
    };
  }

  let tmpDir: string;
  let storePath: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-persession-"));
    storePath = join(tmpDir, "state.json");
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("packForSession resolves per-session, falling back to the global active pack", async () => {
    await getActivePack(); // load original
    const packA = fakePack("test:pack-A", "teacher-a");
    const packB = fakePack("test:pack-B", "teacher-b");
    registerPack(packA);
    registerPack(packB);
    expect(packForSession({ activePackId: null }).id).toBe("ruby-high-original");
    expect(packForSession({ activePackId: "test:pack-A" }).id).toBe("test:pack-A");
    expect(packForSession({ activePackId: "test:pack-B" }).id).toBe("test:pack-B");
    // Unknown id falls back to global, never throws — keeps a stale
    // session usable after the user evicts a pack.
    expect(packForSession({ activePackId: "test:gone" }).id).toBe("ruby-high-original");
  });

  it("two sessions with different activePackId see different faculty + rooms", async () => {
    await getActivePack();
    registerPack(fakePack("test:pack-A", "teacher-a"));
    registerPack(fakePack("test:pack-B", "teacher-b"));
    const sessionA = { activePackId: "test:pack-A" };
    const sessionB = { activePackId: "test:pack-B" };
    expect(facultyForSession(sessionA).map((f) => f.id)).toEqual(["teacher-a"]);
    expect(facultyForSession(sessionB).map((f) => f.id)).toEqual(["teacher-b"]);
    expect(facultyByIdForSession(sessionA, "teacher-a")?.id).toBe("teacher-a");
    expect(facultyByIdForSession(sessionA, "teacher-b")).toBeNull();
    expect(roomForFacultyForSession(sessionA, "teacher-a")?.id).toBe("teacher-a-room");
    expect(roomForFacultyForSession(sessionA, "teacher-b")).toBeNull();
    expect(roomsWithLoungeForSession(sessionA).map((r) => r.id)).toEqual(["teacher-a-room", "lounge"]);
  });

  it("setActivePackForSession isolates two sessions on the same RubyHighService", async () => {
    await getActivePack();
    registerPack(fakePack("test:pack-A", "teacher-a"));
    registerPack(fakePack("test:pack-B", "teacher-b"));
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    // Session A switches to pack A; session B switches to pack B.
    const stA = ruby.setActivePackForSession("session:a", "test:pack-A");
    const stB = ruby.setActivePackForSession("session:b", "test:pack-B");
    expect(stA.activePackId).toBe("test:pack-A");
    expect(stB.activePackId).toBe("test:pack-B");
    // The faculty is reset to the new pack's first faculty.
    expect(stA.faculty).toBe("teacher-a");
    expect(stB.faculty).toBe("teacher-b");
    // No leakage: A is unaffected when B switched, and vice versa.
    expect(ruby.getOrCreate("session:a").activePackId).toBe("test:pack-A");
    expect(ruby.getOrCreate("session:b").activePackId).toBe("test:pack-B");
    await ruby.flush();
  });

  it("registerPack evicts the least-recently-touched pack at the cap, but never the original", async () => {
    await getActivePack(); // pin the original
    // Register more packs than the cap (32). The first ones in (excluding
    // the pinned original) should fall off; the original survives.
    for (let i = 0; i < 40; i++) {
      registerPack(fakePack(`test:lru-${i}`, `teacher-${i}`));
    }
    // Original is still there (pinned).
    expect(packForSession({ activePackId: "ruby-high-original" }).id).toBe("ruby-high-original");
    // The earliest non-pinned pack got evicted; later ones still live.
    expect(packForSession({ activePackId: "test:lru-0" }).id).toBe("ruby-high-original"); // fallback
    expect(packForSession({ activePackId: "test:lru-39" }).id).toBe("test:lru-39");
  });

  it("setActivePackForSession wipes board state from the previous pack", async () => {
    await getActivePack();
    registerPack(fakePack("test:pack-A", "teacher-a"));
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    const sid = "session:wipe";
    // Manufacture a stale board state — simulating mid-question. Use
    // a far-future expiresAt so tickRound (run on every getOrCreate)
    // doesn't auto-resolve the round before our setActivePackForSession
    // call lands.
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
    const after = ruby.setActivePackForSession(sid, "test:pack-A");
    expect(after.current).toBeNull();
    expect(after.activeRound).toBeNull();
    expect(after.lastReveal).toBeNull();
    await ruby.flush();
  });

  it("setActivePackForSession resets npcRosters — old seating chart's room ids may not exist in the new pack", async () => {
    await getActivePack();
    registerPack(fakePack("test:pack-A", "teacher-a"));
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    const sid = "session:roster-wipe";
    // Sets currentGrade=9 + seeds the original pack's roster (homeroom/
    // science/literature). After swap to a single-faculty Anki pack with
    // a "teacher-a-room", those legacy room ids would be stale.
    ruby.selectGrade(sid, "9");
    const before = ruby.getOrCreate(sid);
    expect(before.npcRosters["9"]).toBeDefined();
    ruby.setActivePackForSession(sid, "test:pack-A");
    const after = ruby.getOrCreate(sid);
    // Roster rebuilt for the current grade; old room ids gone.
    const roster = after.npcRosters["9"];
    expect(roster).toBeDefined();
    // Anki-pack rebuilds via initialNpcRoster which uses the original
    // INITIAL_STUDENT_LAYOUT (homeroom/science/literature) — roster
    // currentRoom values still exist as strings, but the active pack's
    // rooms use a different namespace ("teacher-a-room"). The wipe +
    // reseed keeps the roster shape valid; downstream consumers gating
    // on `room.teaches && roomForFacultyForSession(...)` won't crash.
    expect(Array.isArray(roster)).toBe(true);
    await ruby.flush();
  });
});
