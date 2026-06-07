import type { IAgentRuntime } from "../runtime.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { AuthService, type AuthRecord } from "../services/auth-service.js";
import {
  guestAccessStateForSession,
  guestTargetFacultyForCommand,
  guestAccessViolation,
} from "../services/guest-access.js";
import { TokenBucket } from "../services/rate-limit.js";
import { log } from "../services/logger.js";
import { noteGradedAnswer } from "../chat-routes.js";
import {
  openRouterGenerationRequiredMessage,
  resolveTextLlmCredential,
} from "../openrouter-generation-access.js";
import { PLAYBOOKS, isValidStatDistribution } from "../characters/playbooks.js";
import {
  CHOICES,
  GRADES,
  type CharacterStats,
  type Choice,
  type Difficulty,
  type Grade,
  type GraduationReward,
  type QuizState,
} from "../types.js";
import type { RouteContext } from "./context.js";
import { buildSessionState } from "./session-state.js";

/** Rate limiter for the game-state mutation surface (POST /command).
 *
 *  Generous because legitimate UI flows are bursty - a single round can
 *  fire pose -> advantage-roll -> answer -> reveal in well under a second.
 *  120 burst / 2 per second sustained accommodates that without flapping
 *  for any honest player while still capping a hostile floor at ~120 req/min.
 *
 *  Keyed by `${clientIp}:${stateKey|"anon"}` so a signed-in user on a
 *  shared NAT doesn't get throttled by their neighbour and a bot rotating
 *  cookies still has its IP-share counted. */
const COMMAND_LIMITER = new TokenBucket(120, 2);

function commandRateKey(clientIp: string | null | undefined, stateKey: string): string {
  return `${clientIp || "no-ip"}:${stateKey || "anon"}`;
}

type CommandBody = {
  type?: string;
  picked?: string;
  answerText?: string;
  role?: string;
  prompt?: string;
  faculty?: string;
  subject?: string;
  difficulty?: string;
  mode?: "class" | "practice";
  reward?: GraduationReward;
  name?: string;
  playbookId?: string;
  stats?: CharacterStats;
  arcAnswer?: string;
  flavorQuote?: string;
  personality?: string;
  portraitDataUrl?: string;
  mentorAccepted?: boolean;
  grade?: string;
  requestId?: string;
  socialConsent?: boolean;
  item?: string;
} | null;

async function sendPersistedCommandState(
  ctx: RouteContext,
  args: {
    ruby: RubyHighService;
    sessionId: string;
    state: QuizState;
    runtime: IAgentRuntime | null;
    faculty: FacultyService | null;
    cookieHeader?: string | null;
    command: string | undefined;
    message: string;
  },
): Promise<true> {
  try {
    await args.ruby.flushSession(args.sessionId);
  } catch (err) {
    log.error("command.persist-failed", err, { command: args.command ?? "?" });
    ctx.error(
      ctx.res,
      "State changed in memory but could not be persisted. It may be lost on restart; try again shortly.",
      503,
    );
    return true;
  }
  ctx.json(ctx.res, {
    success: true,
    message: args.message,
    session: buildSessionState({
      runtime: args.runtime,
      state: args.state,
      faculty: args.faculty,
      cookieHeader: args.cookieHeader,
    }),
  });
  return true;
}

function isNoScheduledQuestionDue(message: string): boolean {
  return /no scheduled (question|deck card) is due/i.test(message);
}

function isLiveBoardMutationBlocked(message: string): boolean {
  return /Question already (on|posted by).*board|wait for the student answer|Cannot (post another question|clear the board) while a question is live/i.test(message);
}

export async function handleCommandRoute(args: {
  ctx: RouteContext;
  ruby: RubyHighService;
  faculty: FacultyService | null;
  runtime: IAgentRuntime | null;
  stateKey: string;
  auth: AuthService | null;
  authRecord?: AuthRecord | null;
  cookieHeader?: string | null;
  rateLimitStateKey?: string;
}): Promise<true> {
  const { ctx, ruby, faculty, runtime, stateKey, auth } = args;
  const cookieHeader = args.cookieHeader ?? ctx.cookieHeader;
  const rlKey = commandRateKey(ctx.clientIp, args.rateLimitStateKey ?? stateKey);
  if (!COMMAND_LIMITER.take(rlKey)) {
    const retryAfter = COMMAND_LIMITER.retryAfterSeconds(rlKey);
    const res = ctx.res as { setHeader?: (name: string, value: string) => void };
    res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
    ctx.error(ctx.res, "Too many requests — slow down a moment.", 429);
    return true;
  }
  const body = (await ctx.readJsonBody().catch(() => ({}))) as CommandBody;
  const type = body?.type;
  const guestAccess = (() => {
    if (!auth) return null;
    const record = args.authRecord ?? auth.resolve(auth.parseSessionToken(cookieHeader));
    return guestAccessStateForSession({ record, ruby, sessionId: stateKey });
  })();
  const commandFaculty = (commandType: string | undefined): string | null => {
    if (!commandType) return null;
    const state = ruby.getOrCreate(stateKey);
    return guestTargetFacultyForCommand({
      state,
      commandType,
      requestedFacultyId: typeof body?.faculty === "string" ? body.faculty : null,
      guestAccess,
    });
  };
  const rejectGuestAccess = (commandType: string | undefined): boolean => {
    const facultyId = commandFaculty(commandType);
    const violation = guestAccessViolation({ guestAccess, facultyId });
    if (!violation) return false;
    ctx.error(ctx.res, violation.message, violation.status);
    return true;
  };

  const persist = (state: QuizState, message: string, command = String(type ?? "unknown")) =>
    sendPersistedCommandState(ctx, {
      ruby,
      sessionId: stateKey,
      state,
      runtime,
      faculty,
      cookieHeader,
      command,
      message,
    });
  const noteReveal = (state: QuizState) => {
    if (!state.lastReveal) return;
    noteGradedAnswer({
      runtime,
      cookieHeader,
      faculty: state.faculty,
      picked: state.lastReveal.picked,
      correct: state.lastReveal.correct,
      wasCorrect: state.lastReveal.wasCorrect,
    });
  };
  const playBonusCommand = async () => {
    // Renamed from play-daily; old clients still send the legacy name during the rolling window.
    const state = ruby.playBonus(stateKey);
    return await persist(state, "Today's class question is on the board.");
  };
  const commandHandlers: Record<string, () => Promise<boolean>> = {
    answer: async () => {
      const picked = String(body?.picked ?? "").toUpperCase() as Choice;
      if (!CHOICES.includes(picked)) throw new Error("Pick must be A, B, C, or D");
      const state = ruby.submitAnswer(stateKey, picked);
      noteReveal(state);
      return await persist(state, state.lastReveal?.wasCorrect ? "Correct" : "Marked");
    },
    "answer-text": async () => {
      const answerText = String(body?.answerText ?? "");
      const state = ruby.submitTextAnswer(stateKey, answerText);
      noteReveal(state);
      return await persist(state, state.lastReveal?.wasCorrect ? "Correct" : "Marked");
    },
    "generate-mc": async () => {
      const credential = resolveTextLlmCredential({
        apiKeyHeader: ctx.apiKeyHeader,
        ruby,
        sessionId: stateKey,
      });
      if (!credential.apiKey) {
        throw new Error(openRouterGenerationRequiredMessage("generating multiple-choice distractors"));
      }
      const state = await ruby.generateCurrentMcQuestion(stateKey, credential.apiKey);
      return await persist(state, "Multiple choice generated");
    },
    pick: async () => {
      const state = ruby.pickAndPose(stateKey, {
        faculty: body?.faculty,
        subject: body?.subject,
        difficulty: body?.difficulty as Difficulty | undefined,
        mode: body?.mode,
      });
      return await persist(state, "Picked");
    },
    "play-bonus": playBonusCommand,
    "play-daily": playBonusCommand,
    "start-first-bell": async () => {
      const state = ruby.startFirstBell(stateKey);
      return await persist(state, "First Bell is on the board.");
    },
    "set-faculty": async () => {
      const facultyId = typeof body?.faculty === "string" ? body.faculty.trim() : "";
      if (!facultyId) throw new Error("Missing faculty id");
      const state = ruby.setFaculty(stateKey, facultyId);
      return await persist(state, `Now teaching: ${state.faculty}`);
    },
    clear: async () => {
      const state = ruby.clearBoard(stateKey);
      return await persist(state, "Cleared");
    },
    reset: async () => {
      const state = ruby.resetSession(stateKey);
      return await persist(state, "Session reset");
    },
    "force-resolve": async () => {
      const state = ruby.forceResolveRound(stateKey);
      return await persist(state, "Round resolved");
    },
    "roll-advantage": async () => {
      const { state, result, reason } = ruby.rollAdvantage(stateKey);
      const message = result == null
        ? reason === "exhausted"
          ? "Out of advantage rolls for this grade — pass your year to refill."
          : reason === "answered"
            ? "You already locked in your answer — too late to roll."
            : "No active question to roll on."
        : result.outcome === "hit"
          ? `Hit (${result.total}) — eliminated ${result.eliminated.join(" & ")}.`
          : result.outcome === "mixed"
            ? `Mixed (${result.total}) — eliminated ${result.eliminated.join(" & ")}.`
            : `Miss (${result.total}) — nothing's crossed out, but you're no worse off.`;
      return await persist(state, message);
    },
    "complete-graduation": async () => {
      const reward = body?.reward;
      if (!reward || typeof reward !== "object" || !("kind" in reward)) {
        throw new Error("Pick a graduation reward.");
      }
      const state = ruby.completeGraduation(stateKey, reward);
      const message = state.character && (state.character.yearbook ?? []).length >= 4 ? "Graduated" : "Advanced";
      return await persist(state, message);
    },
    "create-character": async () => {
      if (!body?.name || !body.playbookId || !body.stats) {
        throw new Error("Missing name, playbookId, or stats.");
      }
      if (!PLAYBOOKS.some((p) => p.id === body.playbookId)) {
        throw new Error(`Unknown playbookId: ${body.playbookId}`);
      }
      if (!isValidStatDistribution(body.stats)) {
        throw new Error("Invalid stat distribution — must be one each of +2, +1, 0, -1.");
      }
      const state = ruby.createCharacter(stateKey, {
        name: body.name,
        playbookId: body.playbookId,
        stats: body.stats,
        arcAnswer: body.arcAnswer ?? "",
        flavorQuote: body.flavorQuote,
        personality: body.personality ?? "",
        portraitDataUrl: body.portraitDataUrl,
        mentorAccepted: !!body.mentorAccepted,
      });
      return await persist(state, "Character created");
    },
    "clear-character": async () => {
      const state = ruby.clearCharacter(stateKey);
      return await persist(state, "Active character slot cleared");
    },
    "unlock-character-slot": async () => {
      const result = ruby.unlockCharacterSlot(stateKey, {
        requestId: typeof body?.requestId === "string" ? body.requestId : undefined,
      });
      return await persist(result.state, result.applied ? "Character slot unlocked" : "Character slot already unlocked");
    },
    "set-portrait": async () => {
      const url = typeof body?.portraitDataUrl === "string" ? body.portraitDataUrl.trim() : "";
      if (url && !/^(data:image\/|https?:\/\/|\/api\/apps\/ruby-high\/assets\/)/.test(url)) {
        throw new Error("portraitDataUrl must be a data URL, http(s) URL, or Ruby High asset URL");
      }
      const state = ruby.setPortrait(stateKey, url);
      return await persist(state, "Portrait updated");
    },
    "select-grade": async () => {
      const grade = String(body?.grade ?? "") as Grade;
      if (!GRADES.includes(grade)) throw new Error(`Grade must be one of ${GRADES.join(", ")}`);
      const state = ruby.selectGrade(stateKey, grade);
      return await persist(state, `Grade set to ${grade}`);
    },
    "mark-intro-seen": async () => {
      const state = ruby.markIntroSeen(stateKey);
      return await persist(state, "Intro acknowledged");
    },
    "claim-item": async () => {
      const itemId = typeof body?.item === "string" ? body.item.trim() : "";
      if (!itemId) throw new Error("Missing item id.");
      const state = ruby.claimItem(stateKey, itemId);
      return await persist(state, `Claimed ${itemId}`);
    },
    "equip-item": async () => {
      const itemId = typeof body?.item === "string" && body.item.trim() ? body.item.trim() : null;
      const state = ruby.equipItem(stateKey, itemId);
      return await persist(state, itemId ? `Equipped ${itemId}` : "Unequipped item");
    },
    "set-social-consent": async () => {
      const consent = body?.socialConsent ?? true;
      const state = ruby.getOrCreate(stateKey);
      if (!state.character) throw new Error("No character to update.");
      state.character.socialConsent = !!consent;
      state.updatedAt = Date.now();
      void ruby.flushSession(stateKey);
      return await persist(state, consent ? "Social posting enabled" : "Social posting disabled");
    },
  };


  try {
    const commandType = typeof type === "string" ? type : undefined;
    if (rejectGuestAccess(commandType)) return true;
    const handler = commandType ? commandHandlers[commandType] : undefined;
    if (handler) return await handler() as true;
    ctx.error(
      ctx.res,
      commandType ? `Unknown command type: ${commandType}` : "Command type is required.",
      400,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (type === "pick" && isNoScheduledQuestionDue(message)) {
      const state = ruby.getOrCreate(stateKey);
      const status = ruby.questionBankStatus(stateKey, typeof body?.faculty === "string" ? body.faculty : state.faculty);
      ctx.json(ctx.res, {
        success: true,
        noQuestionDue: true,
        message: status.mode === "srs"
          ? "No scheduled deck card is ready right now."
          : "No scheduled question is ready right now.",
        session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
      });
      return true;
    }
    if (type === "pick" && isLiveBoardMutationBlocked(message)) {
      const state = ruby.getOrCreate(stateKey);
      ctx.json(ctx.res, {
        success: true,
        questionAlreadyLive: true,
        message: "Question already live.",
        session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
      });
      return true;
    }
    log.error("command.failed", err, { command: typeof body?.type === "string" ? body.type : "?" });
    const status = /persist|save|dynamodb|storage|unavailable/i.test(message) ? 503 : 400;
    ctx.error(ctx.res, message, status);
    return true;
  }
}
