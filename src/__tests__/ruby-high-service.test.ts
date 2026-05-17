import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService, WELCOME_HALL_PASS_GRANT, WELCOME_HALL_PASS_GRANT_ID } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { MAX_PACKS_PER_OWNER, registerPack, resetActivePack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { dailyKey } from "../types.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  resetActivePack();
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-test-"));
  storePath = join(tmpDir, "state.json");
  activeRuby = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (activeRuby) await activeRuby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  activeRuby = ruby;
  return { ruby, faculty };
}

function attachTestCharacter(ruby: RubyHighService, sid: string, streakCount = 0) {
  ruby.selectGrade(sid, "9");
  const state = ruby.getOrCreate(sid);
  state.character = {
    name: "Test",
    playbookId: "overachiever",
    stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
    arcAnswer: "—",
    personality: "—",
    yearbook: [],
    createdAt: Date.now(),
    ...(streakCount > 0 ? { streak: { grade: "9" as const, count: streakCount, lastDate: "2026-05-04" } } : {}),
  };
  return state;
}

function completedClassRecord(
  grade: "9" | "10" | "11" | "12",
  facultyId: string,
  date: string,
  letterGrade: string,
  scoreTotal: number,
) {
  return {
    grade,
    facultyId,
    date,
    status: "complete" as const,
    questionCount: 3,
    correctCount: letterGrade === "F" ? 0 : 3,
    scoreTotal,
    scoreMax: 300,
    letterGrade,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("Hall Pass wallet", () => {
  it("grants every account five welcome Hall Passes once", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:welcome";

    const state = ruby.getOrCreate(sid);
    expect(state.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);
    expect(state.wallet.welcomeHallPassesGrantedAt).toEqual(expect.any(Number));
    expect(state.wallet.transactions).toContainEqual(expect.objectContaining({
      id: WELCOME_HALL_PASS_GRANT_ID,
      kind: "hall-pass-grant",
      hallPasses: WELCOME_HALL_PASS_GRANT,
      source: "system",
      description: "Welcome Hall Passes",
    }));

    const repeat = ruby.getOrCreate(sid);
    expect(repeat.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);
    expect((repeat.wallet.transactions ?? []).filter((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID)).toHaveLength(1);
  });

  it("applies grants and spends idempotently", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:wallet";

    const grant = ruby.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:cs_test_1",
      source: "stripe",
    });
    expect(grant.applied).toBe(true);
    expect(grant.state.wallet.hallPasses).toBe(25);

    const repeatGrant = ruby.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:cs_test_1",
      source: "stripe",
    });
    expect(repeatGrant.applied).toBe(false);
    expect(repeatGrant.state.wallet.hallPasses).toBe(25);

    const spend = ruby.spendHallPasses(sid, {
      amount: 3,
      idempotencyKey: "hosted-image:diploma:test",
      source: "hosted-image",
    });
    expect(spend.applied).toBe(true);
    expect(spend.state.wallet.hallPasses).toBe(22);

    const repeatSpend = ruby.spendHallPasses(sid, {
      amount: 3,
      idempotencyKey: "hosted-image:diploma:test",
      source: "hosted-image",
    });
    expect(repeatSpend.applied).toBe(false);
    expect(repeatSpend.state.wallet.hallPasses).toBe(22);
    expect(() => ruby.spendHallPasses(sid, {
      amount: 23,
      idempotencyKey: "hosted-image:portrait:too-many",
      source: "hosted-image",
    })).toThrow(/Not enough Hall Passes/);
  });

  it("unlocks character slots for one Hall Pass and grants a Photo Day credit", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:slots";

    const unlock = ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    expect(unlock.applied).toBe(true);
    expect(unlock.state.wallet.hallPasses).toBe(4);
    expect(unlock.slots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });
    expect(unlock.transaction).toMatchObject({
      kind: "hall-pass-spend",
      hallPasses: -1,
      source: "character-slot",
      description: "Character slot 2",
    });

    const repeat = ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    expect(repeat.applied).toBe(false);
    expect(repeat.state.wallet.hallPasses).toBe(4);
    expect(repeat.slots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });

    ruby.resetSession(sid);
    const afterReset = ruby.getOrCreate(sid);
    expect(afterReset.wallet.hallPasses).toBe(4);
    expect((afterReset.wallet.transactions ?? []).filter((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID)).toHaveLength(1);
    expect(afterReset.characterSlots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });
  });

  it("spends and refunds Photo Day credits idempotently", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:photo-day";

    ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    const spend = ruby.consumePhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1",
      source: "photo-day",
      description: "Photo Day character portrait",
    });
    expect(spend.applied).toBe(true);
    expect(spend.slots.photoDayCredits).toBe(0);
    expect(spend.state.wallet.hallPasses).toBe(4);
    expect(spend.transaction).toMatchObject({
      kind: "photo-day-spend",
      photoDayCredits: -1,
      source: "photo-day",
    });

    const repeatSpend = ruby.consumePhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1",
      source: "photo-day",
    });
    expect(repeatSpend.applied).toBe(false);
    expect(repeatSpend.slots.photoDayCredits).toBe(0);

    const refund = ruby.refundPhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1:refund",
      source: "photo-day",
    });
    expect(refund.applied).toBe(true);
    expect(refund.slots.photoDayCredits).toBe(1);
    expect(refund.transaction).toMatchObject({
      kind: "photo-day-refund",
      photoDayCredits: 1,
      source: "photo-day",
    });
  });
});

function fakeAnkiPackWithSally(id = "anki:vocab-test", questionId = "vocab-q1"): ContentPack {
  return {
    id,
    name: "VOCAB",
    description: "Imported vocabulary deck",
    version: "1.0.0",
    faculty: [{
      id: "vocab-test-course",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["vocab"],
      bio: "Sally teaching an imported deck.",
      accent: "#3aa3e0",
      systemPrompt: "You are Sally Science teaching the imported VOCAB deck.",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [{
        id: questionId,
        prompt: "What does ephemeral mean?",
        options: { A: "short-lived", B: "loud", C: "ancient", D: "careful" },
        correct: "A",
        explanation: "Ephemeral means short-lived.",
        subject: "vocab",
        difficulty: "medium",
        faculty: "vocab-test-course",
      }],
    }],
    courses: [{
      id: "vocab-test-course",
      title: "VOCAB",
      facultyId: "vocab-test-course",
      roomId: "vocab-test-room",
      teacherTemplateId: "sally-science",
      subjects: ["vocab"],
    }],
    rooms: [{
      id: "vocab-test-room",
      name: "VOCAB",
      channelName: "vocab",
      teacherId: "vocab-test-course",
      description: "Imported vocabulary deck",
      teaches: true,
    }],
  };
}

describe("imported pack persistence", () => {
  it("prunes persisted imported packs to the same per-owner cap as the registry", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:packs";
    const now = vi.spyOn(Date, "now");

    for (let i = 0; i < MAX_PACKS_PER_OWNER + 2; i++) {
      const touchedAt = 10_000 + i;
      const pack = fakeAnkiPackWithSally(`anki:lru-${i}`, `lru-q-${i}`);
      now.mockReturnValue(touchedAt);
      registerPack(pack, sid, touchedAt);
      await ruby.persistImportedPack(sid, pack);
    }

    const persisted = (await new StateStore(storePath).loadPacks())
      .filter((record) => record.ownerSessionId === sid)
      .map((record) => record.pack.id)
      .sort();
    expect(persisted).toHaveLength(MAX_PACKS_PER_OWNER);
    expect(persisted).not.toContain("anki:lru-0");
    expect(persisted).not.toContain("anki:lru-1");
    expect(persisted).toContain(`anki:lru-${MAX_PACKS_PER_OWNER + 1}`);
  });
});

function fakeAnkiSourcePack(id = "anki:vocab-source", cardId = "anki-vocab-card-1"): ContentPack {
  return {
    id,
    name: "VOCAB Source",
    description: "Imported vocabulary source-card deck",
    version: "1.0.0",
    faculty: [{
      id: "vocab-source-course",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["vocab"],
      bio: "Sally teaching imported source cards.",
      accent: "#3aa3e0",
      systemPrompt: "You are Sally Science teaching imported source cards.",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
      sourceCards: [{
        id: cardId,
        kind: "basic",
        front: "What does ephemeral mean?",
        back: "short-lived",
        acceptedAnswers: ["short-lived", "brief"],
        deckName: "VOCAB Source",
        tags: ["vocab"],
        subject: "vocab",
        difficulty: "medium",
        faculty: "vocab-source-course",
      }],
    }],
    courses: [{
      id: "vocab-source-course",
      title: "VOCAB Source",
      facultyId: "vocab-source-course",
      roomId: "vocab-source-room",
      teacherTemplateId: "sally-science",
      subjects: ["vocab"],
    }],
    rooms: [{
      id: "vocab-source-room",
      name: "VOCAB Source",
      channelName: "vocab-source",
      teacherId: "vocab-source-course",
      description: "Imported vocabulary source-card deck",
      teaches: true,
    }],
  };
}

function fakeGeneratedAnkiPack(id = "anki:generated-vocab", questionId = "generated-vocab-q1"): ContentPack {
  const pack = fakeAnkiPackWithSally(id, questionId);
  pack.faculty[0] = {
    ...pack.faculty[0]!,
    id: "generated-vocab-course",
    displayName: "Dr. Vocab",
    shortName: "Vocab",
    systemPrompt: "You are Dr. Vocab teaching an imported deck.",
    questions: [{
      ...pack.faculty[0]!.questions[0]!,
      id: questionId,
      faculty: "generated-vocab-course",
    }],
  };
  delete pack.faculty[0]!.assetTeacherId;
  pack.courses![0] = {
    id: "generated-vocab-course",
    title: "Generated Vocab",
    facultyId: "generated-vocab-course",
    roomId: "generated-vocab-room",
    subjects: ["vocab"],
  };
  pack.rooms[0] = {
    id: "generated-vocab-room",
    name: "Generated Vocab",
    channelName: "generated-vocab",
    teacherId: "generated-vocab-course",
    description: "Generated imported vocabulary deck",
    teaches: true,
  };
  return pack;
}

function fakeLeveledPack(id = "pack:level-test"): ContentPack {
  return {
    id,
    name: "Leveled Test",
    description: "Small built-in-style pack with easy/medium/hard questions",
    version: "1.0.0",
    faculty: [{
      id: "level-test-course",
      displayName: "Ruby",
      shortName: "Ruby",
      assetTeacherId: "ruby",
      subjects: ["leveling"],
      bio: "A tiny level-gated bank.",
      accent: "#d22a2a",
      systemPrompt: "You are Ruby testing level-gated picks.",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [
        {
          id: "level-easy",
          prompt: "Easy?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "easy",
          faculty: "level-test-course",
        },
        {
          id: "level-medium",
          prompt: "Medium?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "medium",
          faculty: "level-test-course",
        },
        {
          id: "level-hard",
          prompt: "Hard?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "hard",
          faculty: "level-test-course",
        },
      ],
    }],
    courses: [{
      id: "level-test-course",
      title: "Leveled Test",
      facultyId: "level-test-course",
      roomId: "level-test-room",
      teacherTemplateId: "ruby",
      subjects: ["leveling"],
    }],
    rooms: [{
      id: "level-test-room",
      name: "Leveled Test",
      channelName: "level-test",
      teacherId: "level-test-course",
      description: "Test room",
      teaches: true,
    }],
  };
}

describe("RubyHighService Phase 1", () => {
  it("pickAndPose draws from the current faculty's bank", async () => {
    const { ruby } = await makeServices();
    const sid = "test:1";
    const state = ruby.pickAndPose(sid, { faculty: "sally-science", subject: "physics" });
    expect(state.current).not.toBeNull();
    expect(state.current?.faculty).toBe("sally-science");
    expect(state.current?.subject).toBe("physics");
    expect(state.askedQuestionIds).toHaveLength(1);
  });

  it("draws review cards from the current faculty's bank", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:2";
    ruby.selectGrade(sid, "12");
    const total = faculty.bank("ruby")!.questions.length;
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(5, total); i++) {
      const s = ruby.pickAndPose(sid, { faculty: "ruby" });
      const id = s.current!.id;
      seen.add(id);
      ruby.submitAnswer(sid, s.current!.correct!);
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(ruby.questionBankStatus(sid, "ruby").total).toBe(total);
  });

  it("does not replace or clear a live unresolved board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:live-board-lock";
    const first = ruby.pickAndPose(sid, { faculty: "ruby" });
    const firstId = first.current!.id;

    expect(() => ruby.pickAndPose(sid, { faculty: "ruby" })).toThrow(/Cannot post another question while a question is live/);
    expect(() => ruby.clearBoard(sid)).toThrow(/Cannot clear the board while a question is live/);

    ruby.submitAnswer(sid, first.current!.correct!);
    const second = ruby.pickAndPose(sid, { faculty: "ruby" });
    expect(second.current!.id).not.toBe(firstId);
  });

  it("scores correct vs incorrect picks", async () => {
    const { ruby } = await makeServices();
    const sid = "test:3";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    let s = ruby.getOrCreate(sid);
    const correct = s.current!.correct!;
    s = ruby.submitAnswer(sid, correct);
    expect(s.score).toMatchObject({ correct: 1, total: 1, points: 80, possible: 100 });
    expect(s.wallet).toMatchObject({ meritStars: 80, hallPasses: 5 });
    expect(s.lastReveal?.scoreAward).toMatchObject({ base: 80, multiplier: 1, points: 80, possible: 100 });
    expect(s.lastReveal?.wasCorrect).toBe(true);

    ruby.pickAndPose(sid, { faculty: "ruby" });
    s = ruby.getOrCreate(sid);
    const wrong = s.current!.correct! === "A" ? "B" : "A";
    s = ruby.submitAnswer(sid, wrong);
    // Wrong answers earn no points (the dice can't pile on a miss).
    // session.points stays at the previous correct's value; possible still ticks.
    expect(s.score).toMatchObject({ correct: 1, total: 2, points: 80, possible: 200 });
    expect(s.wallet).toMatchObject({ meritStars: 80, hallPasses: 5 });
    expect(s.lastReveal?.scoreAward).toMatchObject({ base: 0, multiplier: 1, points: 0, possible: 100 });
    expect(s.lastReveal?.wasCorrect).toBe(false);
  });

  it("marks expired unanswered rounds as idleTriggered, not hard-forfeited", async () => {
    const { ruby } = await makeServices();
    const sid = "test:timeout-forfeit";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    let s = ruby.getOrCreate(sid);
    s.activeRound!.expiresAt = Date.now() - 1;

    s = ruby.getOrCreate(sid);

    // Clock expired: tickRound sets idleTriggered so the AI teacher can
    // intervene instead of hard-forfeiting immediately.
    expect(s.activeRound?.resolved).toBeFalsy();
    expect(s.activeRound?.idleTriggered).toBe(true);
    expect(s.activeRound?.player.picked).toBeNull();
    // No hard forfeit — lastReveal is untouched
    expect(s.lastReveal).toBeNull();
    expect(s.history).toHaveLength(0);
  });

  it("setFaculty accepts active faculty and rejects unknown ids", async () => {
    const { ruby } = await makeServices();
    const sid = "test:4";
    expect(ruby.setFaculty(sid, "sally-science").faculty).toBe("sally-science");
    expect(ruby.setFaculty(sid, "professor-edward").faculty).toBe("professor-edward");
    expect(() => ruby.setFaculty(sid, "no-such-teacher")).toThrow(/Unknown faculty/);
  });

  it("validates stored character image references on every write path", async () => {
    const { ruby } = await makeServices();
    const sid = "test:image-ref-guard";
    ruby.createCharacter(sid, {
      name: "Test",
      playbookId: "overachiever",
      stats: { head: 1, heart: 0, hustle: 0, honor: 0 },
      arcAnswer: "keeps receipts",
      personality: "careful",
      portraitDataUrl: "https://cdn.example.test/portrait.png",
    });

    expect(ruby.getOrCreate(sid).character?.portraitDataUrl).toBe("https://cdn.example.test/portrait.png");
    expect(() => ruby.setPortrait(sid, "not-an-image")).toThrow(/portraitDataUrl must be an image data URL/i);
    expect(() => ruby.setPortrait(sid, `data:image/png;base64,${"a".repeat(280_000)}`)).toThrow(/portraitDataUrl too large/i);

    const state = ruby.setPortrait(sid, "/api/apps/ruby-high/assets/portrait/test.png");
    expect(state.character?.portraitDataUrl).toBe("/api/apps/ruby-high/assets/portrait/test.png");
    expect(() => ruby.setDiplomaImage(sid, `data:image/png;base64,${"a".repeat(280_000)}`)).toThrow(/diplomaImageDataUrl too large/i);
    expect(ruby.setDiplomaImage(sid, "https://cdn.example.test/diploma.png").character?.diplomaImageDataUrl)
      .toBe("https://cdn.example.test/diploma.png");
  });

  it("persists session state across a 'restart'", async () => {
    const { ruby } = await makeServices();
    const sid = "test:5";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const correct = ruby.getOrCreate(sid).current!.correct!;
    ruby.submitAnswer(sid, correct);
    await ruby.flush();

    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    const restored = rubyB.getOrCreate(sid);
    expect(restored.score.correct).toBe(1);
    expect(restored.score.total).toBe(1);
    expect(restored.wallet.meritStars).toBe(restored.score.points);
    expect(restored.wallet.hallPasses).toBe(5);
    expect(restored.askedQuestionIds.length).toBe(1);
    expect(restored.faculty).toBe("sally-science");
    await rubyB.flush();
  });

  it("clears a persisted activePackId when the imported pack body is gone", async () => {
    const { ruby } = await makeServices();
    const sid = "test:stranded-pack";
    const state = ruby.getOrCreate(sid);
    state.activePackId = "anki:missing";
    state.faculty = "missing-teacher";
    await ruby.flush();

    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    const restored = rubyB.getOrCreate(sid);
    expect(restored.activePackId).toBeNull();
    expect(restored.faculty).toBe("ruby");
  });

  it("treats a selected preset teacher as a course template, not the built-in bank", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-teacher-template";
    const pack = fakeAnkiPackWithSally();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    let state = ruby.setFaculty(sid, "sally-science");
    expect(state.faculty).toBe("vocab-test-course");

    state = ruby.pickAndPose(sid, { faculty: "sally-science" });
    expect(state.current?.id).toBe("vocab-q1");
    expect(state.current?.faculty).toBe("vocab-test-course");
    expect(state.current?.subject).toBe("vocab");

    const bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.facultyId).toBe("vocab-test-course");
    expect(bank.mode).toBe("srs");
    expect(bank.total).toBe(1);
  });

  it("routes daily bonus to a generated imported course when no built-in teacher template matches", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-generated-daily";
    const pack = fakeGeneratedAnkiPack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    const day = new Date("2026-05-04T18:00:00Z");
    expect(ruby.dailyStatus(sid, day).facultyId).toBe("generated-vocab-course");

    const posed = ruby.playBonus(sid, day);
    expect(posed.faculty).toBe("generated-vocab-course");
    expect(posed.current?.id).toBe("generated-vocab-q1");
  });

  it("draws bank questions at the current year level or lower", async () => {
    const { ruby } = await makeServices();
    const sid = "test:level-gate";
    const pack = fakeLeveledPack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.selectGrade(sid, "10");

    const state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["level-medium"];
    const picked = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(["level-easy", "level-medium"]).toContain(picked.current?.id);
    ruby.submitAnswer(sid, picked.current!.correct!);

    const review = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(["level-easy", "level-medium"]).toContain(review.current?.id);
    const status = ruby.questionBankStatus(sid, "level-test-course");
    expect(status.total).toBe(2);
    expect(status.remainingByDifficulty.hard).toBeUndefined();
  });

  it("unlocks hard bank questions for Senior year", async () => {
    const { ruby } = await makeServices();
    const sid = "test:level-gate-senior";
    const pack = fakeLeveledPack("pack:level-test-senior");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.selectGrade(sid, "12");

    const state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["level-easy", "level-medium"];
    state.cardMemory = {
      "level-test-course::level-easy": {
        courseId: "level-test-course",
        questionId: "level-easy",
        phase: "mastered",
        dueAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        stability: 14,
        difficulty: 0.1,
        consecutiveCorrect: 3,
        correctCount: 3,
        wrongCount: 0,
        delayedCorrectCount: 1,
        lapses: 0,
      },
      "level-test-course::level-medium": {
        courseId: "level-test-course",
        questionId: "level-medium",
        phase: "mastered",
        dueAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        stability: 14,
        difficulty: 0.1,
        consecutiveCorrect: 3,
        correctCount: 3,
        wrongCount: 0,
        delayedCorrectCount: 1,
        lapses: 0,
      },
    };
    const picked = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(picked.current?.id).toBe("level-hard");
  });

  it("uses due-card review for imported Anki packs instead of one-use exhaustion", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-srs-due";
    const pack = fakeAnkiPackWithSally("anki:vocab-srs-due", "vocab-due-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    let state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["vocab-due-q1"];

    let bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.mode).toBe("srs");
    expect(bank.remaining).toBe(1);
    expect(bank.readyCount).toBe(1);

    state = ruby.pickAndPose(sid, { faculty: "sally-science", subject: "science" });
    expect(state.current?.id).toBe("vocab-due-q1");
    ruby.submitAnswer(sid, "B");

    bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.remaining).toBe(0);
    expect(bank.shakyCount).toBe(1);

    const memory = ruby.getOrCreate(sid).cardMemory!;
    const key = Object.keys(memory)[0]!;
    memory[key]!.dueAt = Date.now() - 1;
    bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.remaining).toBe(1);
    expect(ruby.pickAndPose(sid, { faculty: "sally-science" }).current?.id).toBe("vocab-due-q1");
  });

  it("withholds an imported deck course grade before the three-class streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-srs-grade";
    const pack = fakeAnkiPackWithSally("anki:vocab-srs-grade", "vocab-grade-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    for (let i = 0; i < 3; i++) {
      const state = ruby.pickAndPose(sid, { faculty: "sally-science" });
      ruby.submitAnswer(sid, state.current!.correct!);
      const memory = ruby.getOrCreate(sid).cardMemory!;
      const key = Object.keys(memory)[0]!;
      memory[key]!.dueAt = Date.now() - 1;
    }

    const bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(1);
    expect(bank.requiredClasses).toBe(3);
    expect(bank.masteredCount).toBe(1);
    expect(bank.remaining).toBe(1);
  });

  it("reports a course grade only after three C-or-better classes in a row", async () => {
    const { ruby } = await makeServices();
    const sid = "test:course-grade-streak";
    const state = attachTestCharacter(ruby, sid);
    const facultyId = "sally-science";
    state.character!.dailyClasses = {
      "9:sally-science:2026-05-01": completedClassRecord("9", facultyId, "2026-05-01", "A", 270),
      "9:sally-science:2026-05-02": completedClassRecord("9", facultyId, "2026-05-02", "B", 240),
    };

    let bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(2);
    expect(bank.requiredClasses).toBe(3);

    state.character!.dailyClasses["9:sally-science:2026-05-03"] =
      completedClassRecord("9", facultyId, "2026-05-03", "F", 0);
    bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(0);

    state.character!.dailyClasses["9:sally-science:2026-05-04"] =
      completedClassRecord("9", facultyId, "2026-05-04", "A", 270);
    state.character!.dailyClasses["9:sally-science:2026-05-05"] =
      completedClassRecord("9", facultyId, "2026-05-05", "B", 240);
    state.character!.dailyClasses["9:sally-science:2026-05-06"] =
      completedClassRecord("9", facultyId, "2026-05-06", "C", 210);
    bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBe("B");
    expect(bank.courseGrade).toBe("B");
    expect(bank.completedClasses).toBe(3);
    expect(bank.requiredClasses).toBe(3);
    expect(bank.averageScore).toBe(80);
  });

  it("keeps successful class mastery credit normal while carrying a one-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-multiplier";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-score", "vocab-streak-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 1);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correct!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-q1"]!;
    expect(after.score).toMatchObject({ correct: 3, total: 3, points: 300, possible: 300 });
    expect(after.character!.streak).toEqual({ grade: "9", count: 2, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(1);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(3);
    expect(memory.consecutiveCorrect).toBe(3);
    expect(memory.lastScoreMultiplier).toBe(1);
  });

  it("awards multiplied visible score for practice without advancing the daily class", async () => {
    const { ruby } = await makeServices();
    const sid = "test:practice-score-multiplier";
    const pack = fakeAnkiPackWithSally("anki:vocab-practice-score", "vocab-practice-score-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 3);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course", mode: "practice" });
      ruby.submitAnswer(sid, posed.current!.correct!);
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    expect(after.lastReveal?.classProgress?.mode).toBe("practice");
    expect(after.lastReveal?.scoreMultiplier).toBe(3);
    expect(after.lastReveal?.scoreAward).toMatchObject({ base: 100, multiplier: 3, points: 300, possible: 300 });
    expect(after.score).toMatchObject({ correct: 1, total: 1, points: 300, possible: 300 });
    expect(after.character!.dailyClasses ?? {}).toEqual({});
    expect(after.character!.streak).toEqual({ grade: "9", count: 3, lastDate: "2026-05-04" });
  });

  it("lets explicit practice review a completed class even when no card is due", async () => {
    const { ruby } = await makeServices();
    const sid = "test:post-class-practice-force";
    const pack = fakeLeveledPack("pack:post-class-practice-force");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");

    const answeredIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      answeredIds.push(posed.current!.id);
      ruby.submitAnswer(sid, posed.current!.correct!);
      ruby.clearBoard(sid);
    }

    expect(ruby.courseProgress(sid, "level-test-course").today.status).toBe("complete");
    expect(ruby.questionBankStatus(sid, "level-test-course").canPick).toBe(false);

    const practice = ruby.pickAndPose(sid, { faculty: "level-test-course", mode: "practice" });
    expect(practice.current).not.toBeNull();
    expect(answeredIds).toContain(practice.current!.id);
    expect(practice.activeRound?.classSession?.mode).toBe("practice");
  });

  it("reports today's correct answer count in course progress", async () => {
    const { ruby } = await makeServices();
    const sid = "test:today-correct-count";
    const pack = fakeLeveledPack("pack:today-correct-count");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");

    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      const correct = posed.current!.correct!;
      const wrong = correct === "A" ? "B" : "A";
      ruby.submitAnswer(sid, i === 2 ? wrong : correct);
      ruby.clearBoard(sid);
    }

    const progress = ruby.courseProgress(sid, "level-test-course");
    expect(progress.today).toMatchObject({
      status: "complete",
      questionCount: 3,
      correctCount: 2,
      totalQuestions: 3,
      letterGrade: "D",
      score: 67,
    });
  });

  it("applies 2x class mastery credit when carrying a two-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-two-day";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-two-day", "vocab-streak-two-day-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 2);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correct!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-two-day-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-two-day-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 3, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(2);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(6);
    expect(memory.consecutiveCorrect).toBe(6);
    expect(memory.lastScoreMultiplier).toBe(2);
  });

  it("applies 3x class mastery credit when carrying a three-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-three-day";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-three-day", "vocab-streak-three-day-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 3);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correct!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-three-day-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-three-day-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 4, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(3);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(9);
    expect(memory.consecutiveCorrect).toBe(9);
    expect(memory.lastScoreMultiplier).toBe(3);
  });

  it("caps the daily-class counter with a 5x Daily Class Bonus", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-cap";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-cap", "vocab-streak-cap-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 5);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correct!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-cap-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-cap-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 5, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(5);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(15);
    expect(memory.consecutiveCorrect).toBe(15);
    expect(memory.lastScoreMultiplier).toBe(5);
  });

  it("uses the same in-progress course-grade model for Ruby High packs", async () => {
    const { ruby } = await makeServices();
    const sid = "test:ruby-bank-mastery-grade";
    const pack = fakeLeveledPack("pack:ruby-bank-mastery-grade");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    for (let i = 0; i < 3; i++) {
      const state = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      expect(state.current?.id).toBe("level-easy");
      ruby.submitAnswer(sid, state.current!.correct!);
      const memory = ruby.getOrCreate(sid).cardMemory!;
      memory["level-test-course::level-easy"]!.dueAt = Date.now() - 1;
    }

    const bank = ruby.questionBankStatus(sid, "level-test-course");
    expect(bank.mode).toBe("bank");
    expect(bank.grade).toBeUndefined();
    expect(bank.completedClasses).toBe(1);
    expect(bank.requiredClasses).toBe(3);
    expect(bank.masteredCount).toBe(1);
  });

  it("poses imported source cards as typed-answer questions and grades exact text", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-typed-answer";
    const pack = fakeAnkiSourcePack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    let state = ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    expect(state.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "typed-answer",
      prompt: "What does ephemeral mean?",
      expectedAnswer: "short-lived",
      canGenerateMc: true,
    });
    expect(state.current?.options).toBeUndefined();
    expect(state.activeRound?.type).toBe("typed-answer");
    expect(state.activeRound?.npcs).toEqual([]);

    state = ruby.submitTextAnswer(sid, "short-lived");
    expect(state.lastReveal).toMatchObject({
      questionId: "anki-vocab-card-1",
      wasCorrect: true,
      answerText: "short-lived",
      expectedAnswer: "short-lived",
      answerJudge: { mode: "exact", score: 1 },
    });
    expect(state.history.at(-1)).toMatchObject({
      questionId: "anki-vocab-card-1",
      answerText: "short-lived",
      expectedAnswer: "short-lived",
      wasCorrect: true,
    });
  });

  it("does not seat classmates who have drifted out of the player's grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:cohort-drift-seating";
    const state = attachTestCharacter(ruby, sid);
    state.npcCohort = [
      {
        id: "lyra",
        grade: "10",
        streak: { grade: "10", count: 0 },
        completedGrades: ["9"],
        graduated: false,
      },
      {
        id: "mika",
        grade: "12",
        streak: { grade: "12", count: 4 },
        completedGrades: ["9", "10", "11", "12"],
        graduated: true,
      },
    ];

    const posed = ruby.pickAndPose(sid, { faculty: "ruby" });

    expect(posed.activeRound?.npcs.map((n) => n.studentId)).toEqual([]);
  });

  it("generates imported-card MC distractors only when explicitly requested", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-jit-mc";
    const pack = fakeAnkiSourcePack("anki:vocab-source-jit");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
      }), { status: 200 }),
    );

    let state = ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    expect(state.current?.type).toBe("typed-answer");
    expect(fetchMock).not.toHaveBeenCalled();

    state = await ruby.generateCurrentMcQuestion(sid, "sk-test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "multiple-choice",
      sourceCardId: "anki-vocab-card-1",
      canGenerateMc: false,
      faculty: "vocab-source-course",
    });
    expect(state.current?.options).toBeTruthy();
    expect(state.current?.correct).toBeTruthy();
    expect(pack.faculty[0]!.questions).toHaveLength(1);
    expect(pack.faculty[0]!.questions[0]).toMatchObject({
      id: "anki-vocab-card-1",
      type: "multiple-choice",
      sourceCardId: "anki-vocab-card-1",
    });
  });

  it("does not overwrite the board if MC generation finishes after the source card changed", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-jit-mc-stale";
    const pack = fakeAnkiSourcePack("anki:vocab-source-jit-stale");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.pickAndPose(sid, { faculty: "vocab-source-course" });

    let release: ((value: Response) => void) | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );

    const generating = ruby.generateCurrentMcQuestion(sid, "sk-test");
    expect(release).toBeTypeOf("function");
    ruby.submitTextAnswer(sid, "short-lived");
    release!(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
    }), { status: 200 }));

    await expect(generating).rejects.toThrow(/source card changed/i);
    const after = ruby.getOrCreate(sid);
    expect(after.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "typed-answer",
      canGenerateMc: true,
    });
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.answerText).toBe("short-lived");
  });

  it("keeps custom questions in the imported course when a teacher template id appears in tool args", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-custom-question-template";
    const pack = fakeAnkiPackWithSally();
    pack.id = "anki:vocab-custom-template";
    registerPack(pack, sid);
    let state = ruby.getOrCreate(sid);
    state.subject = "general-knowledge";
    state = ruby.setActivePackForSession(sid, pack.id);
    expect(state.subject).toBeNull();

    state = ruby.pose(sid, {
      prompt: "What does lucid mean?",
      options: { A: "clear", B: "sticky", C: "ancient", D: "noisy" },
      correct: "A",
      subject: "science",
      faculty: "sally-science",
    });

    expect(state.activePackId).toBe(pack.id);
    expect(state.faculty).toBe("vocab-test-course");
    expect(state.current?.faculty).toBe("vocab-test-course");
    expect(state.current?.subject).toBe("vocab");
  });

  it("promotes teacher-authored Ruby High questions into the global bank", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:global-custom-bank";
    const before = faculty.bank("ruby")!.questions.length;

    const state = ruby.pose(sid, {
      prompt: "Which classroom rule keeps Ruby High agents from pretending old context is new?",
      options: {
        A: "Use fresh room events",
        B: "Ignore the board",
        C: "Delete the teacher",
        D: "Shuffle the class list",
      },
      correct: "A",
      explanation: "Room events are rebuilt per turn instead of accumulating as stale instructions.",
      subject: "agent-culture",
      faculty: "ruby",
      persistToBank: true,
    });

    expect(state.current?.id).toMatch(/^q_/);
    expect(faculty.bank("ruby")!.questions.length).toBe(before + 1);
    expect(faculty.bank("ruby")!.questions.at(-1)).toMatchObject({
      id: state.current?.id,
      prompt: state.current?.prompt,
      faculty: "ruby",
      subject: "agent-culture",
    });

    await ruby.flush();
    resetActivePack();
    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    expect(facultyB.bank("ruby")!.questions.some((q) => q.id === state.current?.id)).toBe(true);
  });

  it("paces Ruby homeroom as a daily Social deck instead of three class cards up front", async () => {
    const { ruby } = await makeServices();
    const sid = "test:ruby-social-deck";
    ruby.selectGrade(sid, "10");
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Test",
      playbookId: "heart",
      stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
      arcAnswer: "—",
      personality: "—",
      yearbook: [],
      createdAt: Date.now(),
    };

    const roles: string[] = [];
    for (let i = 0; i < 10; i++) {
      const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
      roles.push(posed.activeRound?.cardRole ?? "missing");
      if (posed.activeRound?.type === "opinion") {
        ruby.recordOpinion(sid, "player", "I trust specific evidence and check claims that skip the source.");
        ruby.recordGrades(sid, [{ responder: "player", score: 8, comment: "Specific and grounded." }], "player");
      } else {
        ruby.submitAnswer(sid, posed.current!.correct!);
      }
      if (i < 9) ruby.clearBoard(sid);
    }

    expect(roles).toEqual(["practice", "practice", "class", "social", "practice", "practice", "class", "practice", "practice", "class"]);
    const record = ruby.getOrCreate(sid).character!.dailyClasses![`10:ruby:${dailyKey()}`]!;
    expect(record).toMatchObject({
      status: "complete",
      questionCount: 3,
      practiceCount: 6,
      socialCount: 1,
    });
  });

  it("persists an essay report when an opinion round is graded", async () => {
    const { ruby } = await makeServices();
    const sid = "test:essay-report";
    attachTestCharacter(ruby, sid);

    ruby.poseOpinion(sid, {
      faculty: "ruby",
      subject: "agent-culture",
      questionId: "essay-report-q1",
      prompt: "What makes an AI answer worth trusting?",
      rubric: "Names a concrete source signal and a verification step.",
    });
    ruby.recordOpinion(sid, "player", "I trust answers that cite concrete evidence and I verify claims against the source.");
    ruby.recordOpinion(sid, "lyra", "I check the source first and compare it with what the answer claims.");

    const after = ruby.recordGrades(sid, [
      { responder: "player", score: 8.5, comment: "Grounded and specific." },
      { responder: "lyra", score: 9, comment: "Sharper verification step." },
    ], "lyra");

    expect(after.essayReports).toHaveLength(1);
    expect(after.essayReports[0]).toMatchObject({
      questionId: "essay-report-q1",
      faculty: "ruby",
      grade: "9",
      subject: "agent-culture",
      prompt: "What makes an AI answer worth trusting?",
      response: "I trust answers that cite concrete evidence and I verify claims against the source.",
      score: 8.5,
      passed: true,
      comment: "Grounded and specific.",
      bestResponder: "lyra",
      bestResponderScore: 9,
      bestResponderComment: "Sharper verification step.",
      classSession: {
        mode: "practice",
        cardRole: "social",
        facultyId: "ruby",
        grade: "9",
      },
    });
  });

  it("forceAdvanceRound resolves an idle-triggered open round as a forfeit", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-forfeit";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const before = ruby.getOrCreate(sid);
    expect(before.activeRound).not.toBeNull();
    expect(before.activeRound?.resolved).toBeFalsy();

    ruby.forceAdvanceRound(sid);
    const after = ruby.getOrCreate(sid);
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.forfeit).toBe(true);
  });

  it("forceAdvanceRound is idempotent: calling twice on an already-resolved round is a no-op", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-idempotent";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.forceAdvanceRound(sid);
    const afterFirst = ruby.getOrCreate(sid);
    const firstReveal = afterFirst.lastReveal;

    ruby.forceAdvanceRound(sid);
    const afterSecond = ruby.getOrCreate(sid);
    expect(afterSecond.lastReveal).toStrictEqual(firstReveal);
  });

  it("forceAdvanceRound on a no-round session does nothing", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-no-round";
    const before = ruby.getOrCreate(sid);
    expect(before.activeRound).toBeNull();
    expect(() => ruby.forceAdvanceRound(sid)).not.toThrow();
    const after = ruby.getOrCreate(sid);
    expect(after.lastReveal).toBeNull();
  });

  it("forceAdvanceRound marks forfeit=false when the player answered before the advance", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-answered";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const state = ruby.getOrCreate(sid);
    // Simulate player answering — set answeredAt without resolving the round
    state.activeRound!.player.answeredAt = Date.now();
    state.activeRound!.player.picked = state.current!.correct as "A" | "B" | "C" | "D";
    ruby.forceAdvanceRound(sid);
    const after = ruby.getOrCreate(sid);
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.forfeit).toBeFalsy();
  });

  it("resetSession wipes everything for that sessionId", async () => {
    const { ruby } = await makeServices();
    const sid = "test:6";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.submitAnswer(sid, ruby.getOrCreate(sid).current!.correct!);
    expect(ruby.getOrCreate(sid).score.correct).toBe(1);

    ruby.resetSession(sid);
    const fresh = ruby.getOrCreate(sid);
    expect(fresh.score).toMatchObject({ correct: 0, total: 0, points: 0, possible: 0 });
    expect(fresh.wallet).toMatchObject({ meritStars: 0, hallPasses: 5 });
    expect(fresh.askedQuestionIds).toEqual([]);
    expect(fresh.history).toEqual([]);
  });

  it("setFaculty switches to each room's own board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:swap-room";
    // Start in Sally's room, draw a question.
    ruby.setFaculty(sid, "sally-science");
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    let state = ruby.getOrCreate(sid);
    const sallyQuestion = state.current?.id;
    expect(state.current).not.toBeNull();
    expect(state.activeRound).not.toBeNull();
    // Walk into Edward's room — Sally's question must not follow.
    state = ruby.setFaculty(sid, "professor-edward");
    expect(state.faculty).toBe("professor-edward");
    expect(state.current).toBeNull();
    expect(state.lastReveal).toBeNull();
    expect(state.activeRound).toBeNull();
    expect(state.status).toBe("idle");
    // Returning to Sally restores Sally's board.
    state = ruby.setFaculty(sid, "sally-science");
    expect(state.faculty).toBe("sally-science");
    expect(state.current?.id).toBe(sallyQuestion);
    expect(state.activeRound?.questionId).toBe(sallyQuestion);
    expect(state.status).toBe("awaiting-answer");
  });

  it("setFaculty preserves the board when re-selecting the same faculty (no-op)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reselect";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const before = ruby.getOrCreate(sid).current?.id;
    expect(before).toBeDefined();
    const state = ruby.setFaculty(sid, "ruby");
    expect(state.current?.id).toBe(before);
    expect(state.activeRound).not.toBeNull();
  });

  it("setFaculty hides the classroom board in the lounge and restores it when returning", async () => {
    const { ruby } = await makeServices();
    const sid = "test:to-lounge";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const sallyQuestion = ruby.getOrCreate(sid).current?.id;
    let state = ruby.setFaculty(sid, "lounge");
    expect(state.faculty).toBe("lounge");
    expect(state.current).toBeNull();
    expect(state.activeRound).toBeNull();
    state = ruby.setFaculty(sid, "sally-science");
    expect(state.current?.id).toBe(sallyQuestion);
    expect(state.activeRound?.questionId).toBe(sallyQuestion);
  });

  it("clearBoard deletes the active room board instead of letting it resurrect on return", async () => {
    const { ruby } = await makeServices();
    const sid = "test:clear-room-board";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    ruby.setFaculty(sid, "professor-edward");
    expect(ruby.setFaculty(sid, "sally-science").current).not.toBeNull();
    ruby.forceResolveRound(sid);
    ruby.clearBoard(sid);
    ruby.setFaculty(sid, "professor-edward");
    const state = ruby.setFaculty(sid, "sally-science");
    expect(state.current).toBeNull();
    expect(state.activeRound).toBeNull();
  });

  it("normalizes legacy state files: missing pendingRoll loads as null, not undefined", async () => {
    // Hand-write a state.json the way pre-v0.5.1 saves looked: no
    // pendingRoll field at all. The migration in normalizeLoaded must coerce
    // it to null so downstream `if (!state.pendingRoll)` checks behave
    // consistently and the type contract holds.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:1",
        faculty: "ruby",
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: null,
        completedGrades: [],
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        // pendingRoll intentionally omitted — this is the bug we fixed.
        updatedAt: Date.now(),
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const loaded = ruby.getOrCreate("legacy:1");
    expect(loaded.pendingRoll).toBeNull();
    expect(loaded.pendingRoll).not.toBeUndefined();
    activeRuby = ruby; // ensure flush in afterEach
  });
});
