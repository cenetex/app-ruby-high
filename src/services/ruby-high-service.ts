import { Service, type IAgentRuntime } from "@elizaos/core";
import {
  ALL_FACULTY,
  CHOICES,
  DEFAULT_GRADE,
  DEFAULT_ROUND_DURATION_MS,
  GRADES,
  GRADE_COMPLETION_THRESHOLD,
  LOUNGE_FACULTY,
  OPINION_ROUND_DURATION_MS,
  RUBY_FACULTY,
  ROOMS,
  difficultyForGrade,
  initialNpcRoster,
  npcsInRoom,
  pickNextRoomForStudent,
  roomForFaculty,
  classifyTotal,
  nextGradeAfter,
  pickEliminatedChoices,
  roll2d6,
  rollNpcAnswer,
  rollOpinionDelay,
  statusForPhase,
  type ActiveRound,
  type AdvantageRoll,
  type AnswerRecord,
  type CharacterStats,
  type Choice,
  type Difficulty,
  type FacultyMember,
  type Grade,
  type NpcRoundEntry,
  type NpcStudentState,
  type OpinionGrade,
  type OpinionResponse,
  type Phase,
  type Question,
  type QuestionType,
  type QuizState,
  type RoundOutcome,
  type TeachingRoomId,
} from "../types.js";
import { FacultyService, type PickFilter } from "./faculty-service.js";
import { StateStore, type StateStoreLike } from "./state-store.js";

export interface PoseInput {
  prompt: string;
  options: Record<Choice, string>;
  correct: Choice;
  explanation?: string;
  subject?: string;
  difficulty?: Difficulty;
  faculty?: string;
  questionId?: string;
}

export interface PoseOpinionInput {
  prompt: string;
  rubric?: string;
  subject?: string;
  faculty?: string;
  questionId?: string;
}

export interface PickAndPoseInput {
  faculty?: string;
  subject?: string;
  difficulty?: Difficulty;
}

export class RubyHighService extends Service {
  static override readonly serviceType = "ruby-high";

  override readonly capabilityDescription =
    "Ruby High classroom state: tracks the active question, the student's answer, score, and which faculty member is on the floor.";

  private readonly sessions = new Map<string, QuizState>();
  private readonly store: StateStoreLike;
  private faculty: FacultyService | null = null;
  private loaded = false;

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? new StateStore();
  }

  static async start(runtime: IAgentRuntime): Promise<RubyHighService> {
    const svc = new RubyHighService(runtime);
    await svc.hydrate();
    return svc;
  }

  async stop(): Promise<void> {
    await this.persistAll();
    this.sessions.clear();
  }

  /** Wait for any in-flight persistence writes to flush. Useful in tests. */
  flush(): Promise<void> {
    return this.persistAll();
  }

  /** Player taps "Roll for advantage" once per round. The roll is consumed
   *  whether it lands hit / mixed / miss. Eliminated choices are recorded on
   *  the active round so the UI can cross them out and submitAnswer can
   *  reject picks against them.
   *
   *  Returns the updated state and the roll result. If the player already
   *  rolled this round, the existing roll is returned unchanged (idempotent).
   *  If there's no active MC round, returns a null result. */
  rollAdvantage(sessionId: string): { state: QuizState; result: AdvantageRoll | null } {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.resolved || round.type !== "multiple-choice") {
      return { state, result: null };
    }
    if (round.advantage?.rolled) {
      return { state, result: round.advantage };
    }
    if (round.player.answeredAt != null) {
      // Already locked in their answer — too late to roll for advantage.
      return { state, result: null };
    }
    const stat: keyof CharacterStats = "head";
    const r = roll2d6();
    const mod = state.character?.stats[stat] ?? 0;
    const total = r.total + mod;
    const outcome = classifyTotal(total);
    const correct = (state.current?.correct ?? "A") as Choice;
    const eliminated = pickEliminatedChoices(correct, outcome);
    const advantage: AdvantageRoll = {
      rolled: true,
      stat,
      dice: r.dice,
      total,
      outcome,
      eliminated,
      rolledAt: Date.now(),
    };
    round.advantage = advantage;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return { state, result: advantage };
  }

  /** DM tool — teacher asks the player to roll a stat against a DC. Stored
   *  on state until the player resolves it via /command resolve-roll. */
  requestRoll(sessionId: string, input: { stat: keyof CharacterStats; dc?: number; reason?: string; faculty?: string }): QuizState {
    const state = this.getOrCreate(sessionId);
    state.pendingRoll = {
      stat: input.stat,
      dc: typeof input.dc === "number" ? input.dc : 7,
      reason: (input.reason ?? "").trim(),
      requestedBy: input.faculty ?? state.faculty,
      requestedAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Resolve the player's pending DM-roll. Bonus-only: a hit/mixed awards
   *  XP, a miss is a no-op (no Condition, no XP loss). The roll exists to
   *  reward, not to punish. */
  resolvePendingRoll(sessionId: string): { state: QuizState; result: { stat: keyof CharacterStats; dice: [number, number]; total: number; outcome: RoundOutcome; xpAwarded: number; reason: string } | null } {
    const state = this.getOrCreate(sessionId);
    const pr = state.pendingRoll;
    if (!pr || !state.character) return { state, result: null };
    const r = roll2d6();
    const total = r.total + state.character.stats[pr.stat];
    const outcome: RoundOutcome = total >= pr.dc + 3 ? "hit" : total >= pr.dc ? "mixed" : "miss";
    const xpAwarded = outcome === "hit" ? 2 : outcome === "mixed" ? 1 : 0;
    state.character.xp = (state.character.xp ?? 0) + xpAwarded;
    state.pendingRoll = null;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return {
      state,
      result: { stat: pr.stat, dice: r.dice, total, outcome, xpAwarded, reason: pr.reason },
    };
  }

  /** DM tool — teacher hands out XP directly. */
  awardXp(sessionId: string, amount: number, _reason: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) return state;
    const a = Math.max(0, Math.min(10, Math.floor(amount)));
    state.character.xp = (state.character.xp ?? 0) + a;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /**
   * Bind the FacultyService once both services are registered. Called by the
   * plugin index after both `Service.start()` calls return. Lets RubyHighService
   * delegate question-bank picks without a circular dependency at construction.
   */
  setFacultyService(faculty: FacultyService): void {
    this.faculty = faculty;
  }

  hasFaculty(): boolean {
    return this.faculty !== null;
  }

  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    const loaded = await this.store.load();
    for (const [k, v] of loaded) this.sessions.set(k, normalizeLoaded(v));
    this.loaded = true;
  }

  /** Persist exactly one session — the preferred mutation path. With the
   *  DynamoDB backend this is a single PutItem; with the JSON-file backend
   *  it falls back to rewriting the full snapshot (the file has no other
   *  representation). Either way, only one session's worth of work is in
   *  the caller's mental model. */
  private persistSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return Promise.resolve();
    return this.store.saveSession(state);
  }

  /** Persist all sessions at once. Used by stop() and flush() for safety;
   *  individual mutations should use persistSession(). */
  private persistAll(): Promise<void> {
    return this.store.save(this.sessions.values());
  }

  listFaculty(): FacultyMember[] {
    return [...ALL_FACULTY, LOUNGE_FACULTY];
  }

  getOrCreate(sessionId: string): QuizState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        faculty: RUBY_FACULTY.id,
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: null,
        completedGrades: [],
        gradeProgress: {},
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        pendingRoll: null,
        phase: "intro",
        phaseToken: 0,
        updatedAt: Date.now(),
      };
      this.sessions.set(sessionId, state);
    }
    // Tick any in-flight round so callers always see fresh elapsed state.
    this.tickRound(state);
    return state;
  }

  // ── phase transitions ────────────────────────────────────────────────────
  //
  // The state machine. Every mutator calls transition() at the end of its
  // work — no mutator sets state.phase or state.status directly. This is
  // the single home for:
  //   1. Phase preconditions (who can move where)
  //   2. Reset rules (which fields the destination phase requires nulled)
  //   3. The phaseToken bump (the dedupe primitive for downstream consumers)
  //
  // `state.status` is kept in sync as a derived field — exists only for
  // back-compat with consumers that haven't migrated to `phase` yet
  // (viewer + telemetry shape). Internal code reads phase, not status.
  private transition(state: QuizState, action: TransitionAction): void {
    const next: Phase = nextPhaseFor(action);
    // Reset rules. The "destination phase requires these fields to look
    // a certain way." Mutators may have already pre-populated; this just
    // enforces invariants regardless.
    if (next === "in-room" || next === "lounge") {
      // Walking into a room (or the lounge) wipes any previous question.
      // The board is the room's, not yours.
      state.current = null;
      state.lastReveal = null;
      state.activeRound = null;
    } else if (next === "asking") {
      // A new question replaces any prior reveal. The caller is expected
      // to have set state.current + state.activeRound already.
      state.lastReveal = null;
    }
    // "revealed" leaves all fields as the resolveRound caller arranged them.
    // "intro" is only entered fresh in getOrCreate; resetSession handles full wipe.
    state.phase = next;
    state.status = statusForPhase(next);
    // Bump on every call. Two transitions to the same phase are still two
    // distinct moments in the session timeline (e.g. Sally → Edward → Sally
    // is three transitions, three tokens, three "channel-enter" events the
    // viewer should fire on).
    state.phaseToken = (state.phaseToken ?? 0) + 1;
  }

  /** Advance the active round based on wall-clock time:
   *  - Mark NPC entries whose delay has elapsed as "answered" (timestamp).
   *  - If all NPCs + the player have locked, resolve.
   *  - If the round timer expires, force-resolve (player forfeits if
   *    they didn't pick). */
  private tickRound(state: QuizState): void {
    const round = state.activeRound;
    if (!round || round.resolved) return;
    // Opinion rounds resolve only when the chat layer calls recordGrades
    // (after generating + grading written responses). The MC dice timing
    // doesn't apply.
    if (round.type === "opinion") return;
    const now = Date.now();
    let mutated = false;
    for (const entry of round.npcs) {
      if (entry.answeredAt == null && now - round.startedAt >= entry.delayMs) {
        entry.answeredAt = round.startedAt + entry.delayMs;
        mutated = true;
      }
    }
    const allNpcsLocked = round.npcs.every((n) => n.answeredAt != null);
    const playerLocked = round.player.answeredAt != null;
    const expired = now >= round.expiresAt;
    if ((allNpcsLocked && playerLocked) || expired) {
      this.resolveRound(state, expired && !playerLocked);
      mutated = true;
    }
    if (mutated) state.updatedAt = now;
  }

  /** Finalize the round: compute correctness, determine first-correct,
   *  award NPC subject progress (deterministic — no extra coin flip), set
   *  state.lastReveal, write subject completion + redistribution events. */
  private resolveRound(state: QuizState, forfeit: boolean): void {
    const round = state.activeRound;
    if (!round || round.resolved) return;
    const q = state.current;
    if (!q) {
      round.resolved = true;
      round.resolvedAt = Date.now();
      return;
    }
    // Force-pin any unanswered NPCs to their planned commit time. This keeps
    // the race honest when the player commits early — an NPC whose delay
    // would have fired at T=7s is recorded as T=7s, not at the timer expiry.
    for (const entry of round.npcs) {
      if (entry.answeredAt == null) {
        entry.answeredAt = Math.min(round.startedAt + entry.delayMs, round.expiresAt);
      }
    }

    // Determine first-correct across the whole field.
    const corrects: Array<{ id: string; at: number }> = [];
    if (round.player.answeredAt != null && round.player.picked === q.correct) {
      corrects.push({ id: "player", at: round.player.answeredAt });
    }
    for (const entry of round.npcs) {
      if (entry.plannedPick === q.correct && entry.answeredAt != null) {
        corrects.push({ id: entry.studentId, at: entry.answeredAt });
      }
    }
    corrects.sort((a, b) => a.at - b.at);
    round.firstCorrect = corrects[0]?.id ?? null;

    // Player scoring. Forfeits (timer expired with no pick) count toward
    // total but don't fake a letter — history records null picked.
    const picked = round.player.picked ?? null;
    const wasCorrect = !forfeit && picked != null && picked === q.correct;
    if (picked != null) {
      const record: AnswerRecord = {
        questionId: q.id,
        picked,
        correct: (q.correct ?? "A") as Choice,
        wasCorrect,
        at: round.player.answeredAt ?? round.expiresAt,
      };
      state.history.push(record);
    }
    state.score.total += 1;
    if (wasCorrect) state.score.correct += 1;

    // 2d6 + HEAD roll for the player — bonus layer on top of their literal
    // pick. A correct answer earns XP scaled by the roll (10+ = +2, 7-9 = +1,
    // 6- = +1). A wrong answer earns 0 XP and never imposes a Condition: the
    // dice can only ever upgrade the outcome, never punish it. NPC rolls (in
    // activeRound.npcs) carry the actual race stakes.
    let playerRoll: NonNullable<NonNullable<QuizState["lastReveal"]>["playerRoll"]> | null = null;
    if (state.character && picked != null) {
      const stat: keyof CharacterStats = "head";
      const r = roll2d6();
      const total = r.total + state.character.stats[stat];
      const outcome = classifyTotal(total);
      const xpAwarded = wasCorrect
        ? (outcome === "hit" ? 2 : 1)
        : 0;
      state.character.xp = (state.character.xp ?? 0) + xpAwarded;
      playerRoll = { stat, dice: r.dice, total, outcome, xpAwarded };
    }

    // Player grade progress + auto-advance + graduation.
    if (wasCorrect) this.applyPlayerGradeProgress(state);

    // NPC subject progress + redistribution (deterministic from the round).
    const npcEvents = this.applyRoundToNpcs(state, round);

    state.lastReveal = {
      questionId: q.id,
      picked: (picked ?? "A") as Choice, // UI-only; audit lives in history
      correct: (q.correct ?? "A") as Choice,
      wasCorrect,
      explanation: q.explanation ?? null,
      encouragement: forfeit ? "Time's up. Take a breath." : pickEncouragement(wasCorrect),
      playerRoll,
      ...(npcEvents.length ? { npcEvents } : {}),
    };
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    // resolveRound is a private helper that operates on `state` directly;
    // there's no sessionId param, so pull it off the state.
    void this.persistSession(state.sessionId);
  }

  /** Tick the player's progress in their current grade. Auto-advances to
   *  the next year on threshold completion. On Senior completion, writes
   *  the yearbook entry that closes the run.
   *
   *  Spec ref: DESIGN.md commits to "the Daily IS the arc — pass enough
   *  Dailies in your year to advance to the next; Senior completion =
   *  graduation." Today this fires per correct answer (the playtest
   *  product is still free-play, not the Daily). When The Daily lands
   *  this same hook is what each Daily completion calls. */
  private applyPlayerGradeProgress(state: QuizState): void {
    const key = state.currentGrade;
    if (!key) return;
    const next = (state.gradeProgress[key] ?? 0) + 1;
    state.gradeProgress[key] = next;
    if (next < GRADE_COMPLETION_THRESHOLD || state.completedGrades.includes(key)) return;
    // Threshold hit — record the milestone, write the yearbook entry,
    // and advance / graduate.
    state.completedGrades.push(key);
    if (state.character) {
      state.character.yearbook = state.character.yearbook ?? [];
      state.character.yearbook.push({
        grade: key,
        completedAt: Date.now(),
        // No per-grade total tracking yet — a future PR can add a counter.
        // For now: correct == threshold, total == threshold (the player
        // demonstrably hit the bar; the run-wide score lives on state.score).
        summary: { correct: next, total: next },
      });
    }
    const advance = nextGradeAfter(key);
    if (advance) {
      // Move into the next year. Seed the gradeProgress + NPC roster so
      // the new grade is ready to accept progress without a special case.
      state.currentGrade = advance;
      if (state.gradeProgress[advance] === undefined) state.gradeProgress[advance] = 0;
      this.ensureRoster(state, advance);
    } else {
      // Senior complete = graduation. We mark the year done and write the
      // yearbook entry above; explicit "graduated" UX comes in the
      // graduation-flow PR. The session continues at grade 12 — the player
      // stays in the building for now, but no further yearbook entries.
    }
  }

  private applyRoundToNpcs(state: QuizState, round: ActiveRound): Array<{
    studentId: string;
    gotIt: boolean;
    completed?: TeachingRoomId;
    movedTo?: TeachingRoomId | null;
  }> {
    const events: Array<{ studentId: string; gotIt: boolean; completed?: TeachingRoomId; movedTo?: TeachingRoomId | null }> = [];
    if (!state.currentGrade || !state.current) return events;
    const room = roomForFaculty(state.faculty);
    if (!room || !room.teaches) return events;
    const teachingRoom = room.id as TeachingRoomId;
    const roster = this.ensureRoster(state, state.currentGrade);
    const correct = state.current.correct;
    for (const entry of round.npcs) {
      const npc = roster.find((n) => n.id === entry.studentId);
      if (!npc) continue;
      const gotIt = entry.plannedPick === correct;
      if (!gotIt) {
        events.push({ studentId: npc.id, gotIt: false });
        continue;
      }
      const subj = npc.subjects[teachingRoom];
      subj.correct += 1;
      const ev: { studentId: string; gotIt: boolean; completed?: TeachingRoomId; movedTo?: TeachingRoomId | null } = {
        studentId: npc.id,
        gotIt: true,
      };
      if (!subj.completed && subj.correct >= GRADE_COMPLETION_THRESHOLD) {
        subj.completed = true;
        ev.completed = teachingRoom;
        const next = pickNextRoomForStudent(roster, npc);
        npc.currentRoom = next;
        ev.movedTo = next;
      }
      events.push(ev);
    }
    return events;
  }

  /** Ensure an NPC roster exists for the given grade. */
  private ensureRoster(state: QuizState, grade: Grade): NpcStudentState[] {
    let roster = state.npcRosters[grade];
    if (!roster) {
      roster = initialNpcRoster(grade);
      state.npcRosters[grade] = roster;
    }
    return roster;
  }

  // Note: the previous coin-flip advanceNpcsForAnswer was replaced by
  // applyRoundToNpcs, which uses the deterministic dice-rolled picks from
  // the active round. NPCs no longer "auto-answer" at flat probability —
  // their picks are pre-rolled at pose time and revealed as their delays
  // elapse during tickRound.

  pose(sessionId: string, input: PoseInput): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!CHOICES.includes(input.correct)) {
      throw new Error(`'correct' must be one of ${CHOICES.join(", ")}`);
    }
    for (const c of CHOICES) {
      const v = input.options[c];
      if (typeof v !== "string" || v.trim().length === 0) {
        throw new Error(`Option ${c} is missing or empty`);
      }
    }
    const id = input.questionId ?? `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const question: Question = {
      id,
      prompt: input.prompt.trim(),
      type: "multiple-choice",
      options: { ...input.options },
      correct: input.correct,
      explanation: input.explanation?.trim() || undefined,
      subject: input.subject?.trim() || state.subject || undefined,
      difficulty: input.difficulty,
      faculty: input.faculty?.trim() || state.faculty,
    };
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    if (!state.askedQuestionIds.includes(id)) state.askedQuestionIds.push(id);

    // Open a new round and pre-roll the NPCs in the active classroom. The
    // student-side LLM never touches the question — picks come from dice +
    // their HEAD/HUSTLE stats, so they can't cheat by reading the answer.
    state.activeRound = this.openRound(state, question);
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  private openRound(state: QuizState, question: Question): ActiveRound {
    const startedAt = Date.now();
    const isOpinion = question.type === "opinion";
    const durationMs = isOpinion ? OPINION_ROUND_DURATION_MS : DEFAULT_ROUND_DURATION_MS;
    const room = roomForFaculty(state.faculty);
    let entries: NpcRoundEntry[] = [];
    if (room && room.teaches && state.currentGrade) {
      const teachingRoom = room.id as TeachingRoomId;
      const roster = this.ensureRoster(state, state.currentGrade);
      const inRoom = npcsInRoom(roster, teachingRoom);
      entries = inRoom.map((npc) => {
        if (isOpinion) {
          // Opinion round — accuracy doesn't apply, only commit timing matters.
          // The actual response text is generated externally and stored via
          // recordOpinion(); the dice fields are placeholders.
          return {
            studentId: npc.id,
            delayMs: rollOpinionDelay(npc.stats),
            plannedPick: "A" as Choice,
            rolledTotal: 0,
            rolledDice: [0, 0] as [number, number],
            outcome: "hit" as const,
            answeredAt: null,
          };
        }
        const r = rollNpcAnswer(npc.stats, question.correct ?? "A");
        return {
          studentId: npc.id,
          delayMs: r.delayMs,
          plannedPick: r.pick,
          rolledTotal: r.total,
          rolledDice: r.dice,
          outcome: r.outcome,
          answeredAt: null,
        };
      });
    }
    return {
      questionId: question.id,
      type: question.type ?? "multiple-choice",
      startedAt,
      durationMs,
      expiresAt: startedAt + durationMs,
      npcs: entries,
      player: { picked: null, answeredAt: null },
      resolved: false,
      resolvedAt: null,
      firstCorrect: null,
      opinionResponses: [],
      opinionGrades: [],
      bestResponder: null,
    };
  }

  /** Pose an opinion question. Same shape as pose() but skips A/B/C/D — the
   *  caller is responsible for actually generating + recording opinion
   *  responses and grading via the chat layer. */
  poseOpinion(sessionId: string, input: PoseOpinionInput): QuizState {
    const state = this.getOrCreate(sessionId);
    const id = input.questionId ?? `qo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const question: Question = {
      id,
      prompt: input.prompt.trim(),
      type: "opinion",
      rubric: input.rubric?.trim() || undefined,
      subject: input.subject?.trim() || state.subject || undefined,
      faculty: input.faculty?.trim() || state.faculty,
    };
    state.current = question;
    state.subject = question.subject ?? state.subject;
    state.faculty = question.faculty ?? state.faculty;
    if (!state.askedQuestionIds.includes(id)) state.askedQuestionIds.push(id);
    state.activeRound = this.openRound(state, question);
    this.transition(state, { kind: "pose-question" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Append an opinion response to the active round (player or NPC). Marks
   *  the responder as locked (for NPCs, sets answeredAt). */
  recordOpinion(sessionId: string, responder: string, text: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return state;
    if (round.opinionResponses.find((r) => r.responder === responder)) return state;
    const now = Date.now();
    // Defensive cap: an opinion response is meant to be 2-3 sentences. The
    // HTTP layer caps the body at 1 MB, but we trim further here so the
    // grading prompt and the persisted state don't bloat. 4 KB ≈ 750 words
    // — far more than any legitimate response.
    const RESPONSE_MAX = 4096;
    const trimmed = text.trim();
    const bounded = trimmed.length > RESPONSE_MAX
      ? trimmed.slice(0, RESPONSE_MAX) + "…"
      : trimmed;
    round.opinionResponses.push({ responder, text: bounded, submittedAt: now });
    if (responder === "player") {
      round.player.answeredAt = now;
    } else {
      const npc = round.npcs.find((n) => n.studentId === responder);
      if (npc) npc.answeredAt = now;
    }
    state.updatedAt = now;
    void this.persistSession(sessionId);
    return state;
  }

  /** Has every required responder submitted an opinion? */
  isOpinionRoundReadyToGrade(sessionId: string): boolean {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return false;
    const requiredIds = ["player", ...round.npcs.map((n) => n.studentId)];
    return requiredIds.every((id) => round.opinionResponses.some((r) => r.responder === id));
  }

  /** Apply the teacher's grading to the round and finalize it. Awards the
   *  player score based on their grade (≥7 = "correct", which advances grade
   *  progress). */
  recordGrades(sessionId: string, grades: OpinionGrade[], bestResponder: string | null): QuizState {
    const state = this.getOrCreate(sessionId);
    const round = state.activeRound;
    if (!round || round.type !== "opinion" || round.resolved) return state;
    round.opinionGrades = grades;
    round.bestResponder = bestResponder;
    const playerGrade = grades.find((g) => g.responder === "player");
    const passed = !!playerGrade && playerGrade.score >= 7;
    const q = state.current;
    if (q) {
      const record: AnswerRecord = {
        questionId: q.id,
        picked: "A" as Choice, // sentinel — opinion answers don't have a letter
        correct: "A" as Choice,
        wasCorrect: passed,
        at: Date.now(),
      };
      state.history.push(record);
      state.score.total += 1;
      if (passed) state.score.correct += 1;
      // Player grade progress + auto-advance + graduation. Same shape as MC.
      if (passed) this.applyPlayerGradeProgress(state);
      // NPC progress: each NPC scoring ≥7 advances their subject. Same
      // redistribution rules as the MC path.
      const npcEvents: Array<{ studentId: string; gotIt: boolean; completed?: TeachingRoomId; movedTo?: TeachingRoomId | null }> = [];
      const room = roomForFaculty(state.faculty);
      if (room && room.teaches && state.currentGrade) {
        const teachingRoom = room.id as TeachingRoomId;
        const roster = this.ensureRoster(state, state.currentGrade);
        for (const g of grades) {
          if (g.responder === "player") continue;
          const npc = roster.find((n) => n.id === g.responder);
          if (!npc) continue;
          const passedNpc = g.score >= 7;
          if (!passedNpc) {
            npcEvents.push({ studentId: npc.id, gotIt: false });
            continue;
          }
          const subj = npc.subjects[teachingRoom];
          subj.correct += 1;
          const ev: { studentId: string; gotIt: boolean; completed?: TeachingRoomId; movedTo?: TeachingRoomId | null } = {
            studentId: npc.id, gotIt: true,
          };
          if (!subj.completed && subj.correct >= GRADE_COMPLETION_THRESHOLD) {
            subj.completed = true;
            ev.completed = teachingRoom;
            const next = pickNextRoomForStudent(roster, npc);
            npc.currentRoom = next;
            ev.movedTo = next;
          }
          npcEvents.push(ev);
        }
      }
      state.lastReveal = {
        questionId: q.id,
        picked: "A" as Choice,
        correct: "A" as Choice,
        wasCorrect: passed,
        explanation: q.rubric ?? null,
        encouragement: passed ? "Nice essay." : "Take another swing at it tomorrow.",
        ...(npcEvents.length ? { npcEvents } : {}),
      };
    }
    round.resolved = true;
    round.resolvedAt = Date.now();
    this.transition(state, { kind: "resolve-round" });
    state.updatedAt = round.resolvedAt;
    void this.persistSession(sessionId);
    return state;
  }

  pickAndPose(sessionId: string, filter: PickAndPoseInput = {}): QuizState {
    if (!this.faculty) {
      throw new Error("FacultyService is not bound. Call setFacultyService() first.");
    }
    const state = this.getOrCreate(sessionId);
    let difficulty = filter.difficulty;
    if (!difficulty && state.currentGrade) {
      // Without grade-tagged questions yet, lean on difficulty as a proxy.
      difficulty = difficultyForGrade(state.currentGrade);
    }
    const pickFilter: PickFilter = {
      faculty: filter.faculty ?? state.faculty,
      subject: filter.subject,
      difficulty,
      exclude: state.askedQuestionIds,
    };
    const q = this.faculty.pick(pickFilter);
    if (!q) {
      throw new Error(
        `No questions left matching {faculty=${pickFilter.faculty ?? "any"}, subject=${pickFilter.subject ?? "any"}, difficulty=${pickFilter.difficulty ?? "any"}}.`,
      );
    }
    return this.pose(sessionId, {
      prompt: q.prompt,
      options: q.options as Record<Choice, string>,
      correct: q.correct as Choice,
      explanation: q.explanation,
      subject: q.subject,
      difficulty: q.difficulty,
      faculty: q.faculty,
      questionId: q.id,
    });
  }

  submitAnswer(sessionId: string, picked: Choice): QuizState {
    const state = this.getOrCreate(sessionId);
    const q = state.current;
    if (!q) throw new Error("No question is currently on the board.");
    if (!CHOICES.includes(picked)) throw new Error(`Pick must be one of ${CHOICES.join(", ")}`);

    // If we don't have an active round (e.g. legacy state, or a manually
    // posed question), open one on the fly so the rest of the pipeline works.
    if (!state.activeRound || state.activeRound.questionId !== q.id) {
      state.activeRound = this.openRound(state, q);
    }
    const round = state.activeRound;
    if (round.resolved) return state;
    if (round.player.answeredAt != null) {
      // Already locked in. Tick + return.
      this.tickRound(state);
      return state;
    }
    if (round.advantage?.eliminated.includes(picked)) {
      throw new Error(`${picked} was crossed out by your advantage roll — pick a different choice.`);
    }
    round.player.picked = picked;
    round.player.answeredAt = Date.now();
    // Tick first so any NPCs whose delay HAS already elapsed lock in honestly.
    this.tickRound(state);
    // Once the player has committed, the race is decided — any NPC still
    // pending committed AFTER the player by definition. Resolve immediately
    // so the teacher reacts in real time instead of stalling for up to 22s
    // waiting on slow NPC delays. resolveRound pins unanswered NPCs to their
    // planned commit time (startedAt + delayMs), preserving the honest race.
    if (!round.resolved) this.resolveRound(state, false);
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Force the current round to resolve right now (e.g. user taps a "skip
   *  the wait" button). NPCs whose delay hasn't elapsed get pinned to now. */
  forceResolveRound(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (state.activeRound && !state.activeRound.resolved) {
      this.resolveRound(state, state.activeRound.player.answeredAt == null);
      void this.persistSession(sessionId);
    }
    return state;
  }

  /** Create the player's character sheet. Throws if one already exists. */
  createCharacter(
    sessionId: string,
    input: { name: string; playbookId: string; stats: CharacterStats; arcAnswer: string; flavorQuote?: string; personality: string; portraitDataUrl?: string },
  ): QuizState {
    const state = this.getOrCreate(sessionId);
    if (state.character) throw new Error("Character already exists for this session.");
    const name = input.name.trim();
    if (!name) throw new Error("Name is required.");
    const flavorQuote = input.flavorQuote?.trim();
    state.character = {
      name,
      playbookId: input.playbookId,
      stats: { ...input.stats },
      arcAnswer: input.arcAnswer.trim(),
      ...(flavorQuote ? { flavorQuote } : {}),
      personality: input.personality.trim(),
      portraitDataUrl: input.portraitDataUrl,
      xp: 0,
      strings: {},
      conditions: [],
      yearbook: [],
      createdAt: Date.now(),
    };
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Update only the portrait on the existing character. Used when portrait
   *  generation completes after createCharacter (which is fire-and-go). */
  setPortrait(sessionId: string, portraitDataUrl: string): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!state.character) throw new Error("No character to attach portrait to.");
    state.character.portraitDataUrl = portraitDataUrl;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  /** Reset only the character, keeping grade/score state. Used when the
   *  player rerolls after creation. (Allowed during alpha — graduation
   *  flow will lock this later.) */
  clearCharacter(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    state.character = null;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  selectGrade(sessionId: string, grade: Grade): QuizState {
    const state = this.getOrCreate(sessionId);
    if (!GRADES.includes(grade)) throw new Error(`Unknown grade: ${grade}`);
    state.currentGrade = grade;
    if (state.gradeProgress[grade] === undefined) state.gradeProgress[grade] = 0;
    state.hasSeenIntro = true;
    // Seed the NPC roster for this grade if it doesn't exist yet.
    this.ensureRoster(state, grade);
    // Selecting a grade for the first time leaves the player in their
    // teaching room (whatever faculty was last set, defaulting to Ruby).
    // Subsequent re-selections of the same grade are still transitions —
    // any active question on the board belongs to the previous grade and
    // gets cleared.
    this.transition(state, { kind: "select-grade" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  markIntroSeen(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    state.hasSeenIntro = true;
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  clearBoard(sessionId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    this.transition(state, { kind: "clear-board" });
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }

  resetSession(sessionId: string): QuizState {
    this.sessions.delete(sessionId);
    void this.persistSession(sessionId);
    return this.getOrCreate(sessionId);
  }

  setFaculty(sessionId: string, facultyId: string): QuizState {
    const state = this.getOrCreate(sessionId);
    const faculty = facultyId === LOUNGE_FACULTY.id
      ? LOUNGE_FACULTY
      : ALL_FACULTY.find((f) => f.id === facultyId);
    if (!faculty) throw new Error(`Unknown faculty: ${facultyId}`);
    if (!faculty.available) {
      throw new Error(
        `${faculty.displayName} hasn't started teaching at Ruby High yet — only available faculty are: ${[...ALL_FACULTY, LOUNGE_FACULTY].filter((f) => f.available).map((f) => f.id).join(", ")}.`,
      );
    }
    const previousFacultyId = state.faculty;
    state.faculty = faculty.id;
    // Walking into a different classroom (or the lounge) leaves the previous
    // room's chalkboard behind. The transition() reset rules wipe current /
    // lastReveal / activeRound. Re-select of the same faculty is a no-op.
    if (previousFacultyId !== faculty.id) {
      this.transition(state, {
        kind: faculty.id === LOUNGE_FACULTY.id ? "enter-lounge" : "enter-room",
      });
    }
    state.updatedAt = Date.now();
    void this.persistSession(sessionId);
    return state;
  }
}

// ── transition action space ─────────────────────────────────────────────────
// The state machine is action-driven, not phase-driven. Mutators name what
// the player just did ("clear the board", "pose a question") rather than
// which phase to land in — the phase mapping is internal. Adding new
// product features (The Daily, Yearbook) means adding actions here, not
// fiddling with module flags scattered across viewer + server.
type TransitionAction =
  | { kind: "select-grade" }
  | { kind: "enter-room" }
  | { kind: "enter-lounge" }
  | { kind: "pose-question" }
  | { kind: "resolve-round" }
  | { kind: "clear-board" }
  | { kind: "reset" };

function nextPhaseFor(action: TransitionAction): Phase {
  switch (action.kind) {
    case "select-grade": return "in-room";
    case "enter-room":   return "in-room";
    case "enter-lounge": return "lounge";
    case "pose-question": return "asking";
    case "resolve-round": return "revealed";
    case "clear-board":  return "in-room";
    case "reset":        return "intro";
  }
}

/** Derive a phase for legacy state files that predate the field. The
 *  mapping mirrors what each scenario would have transitioned to today.
 *  Conservative — when in doubt, lands on "intro" so getOrCreate's first
 *  read can transition forward correctly. */
function derivePhaseForLegacy(s: QuizState): Phase {
  if (s.faculty === LOUNGE_FACULTY.id) return "lounge";
  if (s.activeRound && !s.activeRound.resolved) return "asking";
  if (s.lastReveal) return "revealed";
  if (s.currentGrade) return "in-room";
  return "intro";
}

function normalizeLoaded(s: QuizState): QuizState {
  // Migrate stale K-8 grades from previous schema versions to a high-school
  // grade so the player isn't stranded on a grade that no longer exists.
  const validGrade = (g: unknown): Grade | null =>
    typeof g === "string" && (GRADES as string[]).includes(g) ? (g as Grade) : null;
  const migratedGrade = validGrade(s.currentGrade) ?? (s.currentGrade ? DEFAULT_GRADE : null);
  const migratedCompleted = Array.isArray(s.completedGrades)
    ? (s.completedGrades.map(validGrade).filter((g): g is Grade => !!g))
    : [];
  const phase: Phase = (s.phase as Phase | undefined) ?? derivePhaseForLegacy(s);
  return {
    ...s,
    askedQuestionIds: Array.isArray(s.askedQuestionIds) ? s.askedQuestionIds : [],
    history: Array.isArray(s.history) ? s.history : [],
    score: s.score ?? { correct: 0, total: 0 },
    status: statusForPhase(phase),
    phase,
    phaseToken: typeof s.phaseToken === "number" && s.phaseToken >= 0 ? s.phaseToken : 0,
    lastReveal: s.lastReveal ?? null,
    currentGrade: migratedGrade,
    completedGrades: migratedCompleted,
    gradeProgress: s.gradeProgress && typeof s.gradeProgress === "object" ? s.gradeProgress : {},
    hasSeenIntro: !!s.hasSeenIntro,
    npcRosters: s.npcRosters && typeof s.npcRosters === "object" ? s.npcRosters : {},
    activeRound: s.activeRound && typeof s.activeRound === "object" ? s.activeRound : null,
    // pendingRoll was added in v0.5.1; older state files don't have it, and
    // the spread above leaves it `undefined` (type says `null`). Coerce so
    // downstream `if (!state.pendingRoll)` checks behave consistently.
    pendingRoll: s.pendingRoll ?? null,
    character: s.character ?? null,
  };
}

const ENCOURAGEMENTS_RIGHT = [
  "Great job!",
  "Nice work!",
  "Atta kid.",
  "Smart cookie.",
  "Boom — got it.",
  "Are you cheating?",
  "Hmm. Sure you're not cheating?",
  "Yeah, that's the one.",
  "I knew you could.",
  "OK, star student.",
  "Easy.",
  "Knocked it out of the park.",
  "Sharp.",
  "That tracks.",
  "You're cooking.",
];

const ENCOURAGEMENTS_WRONG = [
  "Close, but no.",
  "Not quite.",
  "Common trap — easy to fall into.",
  "We'll come back to that one.",
  "Don't sweat it.",
  "Trickier than it looks.",
  "Take a breath, try the next one.",
];

function pickEncouragement(wasCorrect: boolean): string {
  const pool = wasCorrect ? ENCOURAGEMENTS_RIGHT : ENCOURAGEMENTS_WRONG;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}
