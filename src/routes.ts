import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  IAgentRuntime,
  PluginAppBridgeLaunchContext,
  PluginAppBridgeRunContext,
  PluginAppLaunchDiagnostic,
  PluginAppSessionState,
} from "@elizaos/core";
import { RubyHighService } from "./services/ruby-high-service.js";
import { FacultyService } from "./services/faculty-service.js";
import {
  ALL_FACULTY,
  CHOICES,
  GRADES,
  ROOMS,
  RUBY_FACULTY,
  TEACHING_ROOMS,
  dailyKey,
  facultyForDay,
  type CharacterStats,
  type Choice,
  type Difficulty,
  type FacultyMember,
  type Grade,
  type NpcStudentState,
  type PlayerCharacter,
  type QuizState,
  type Room,
  type TeachingRoomId,
} from "./types.js";
import { PLAYBOOKS, isValidStatDistribution } from "./characters/playbooks.js";
import { renderViewerHtml, VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "./viewer.js";
import { handleChatRoutes, noteGradedAnswer } from "./chat-routes.js";

const APP_NAME = "@cenetex/app-ruby-high";
const APP_DISPLAY_NAME = "Ruby High";
const APP_ROUTE_PREFIX = "/api/apps/ruby-high";
const VIEWER_PATH = `${APP_ROUTE_PREFIX}/viewer`;
const ASSETS_PREFIX = `${APP_ROUTE_PREFIX}/assets/`;

const ASSET_FILES: Record<string, { file: string; mime: string }> = {
  "logo.png": { file: "ruby-high-logo.png", mime: "image/png" },
  "ruby.png": { file: "ruby-classroom.png", mime: "image/png" },
  "teachers/ruby.png": { file: "teachers/ruby.png", mime: "image/png" },
  "teachers/sally-science.png": { file: "teachers/sally-science.png", mime: "image/png" },
  "teachers/professor-edward.png": { file: "teachers/professor-edward.png", mime: "image/png" },
  "teachers/ruby-face.png": { file: "teachers/ruby-face.png", mime: "image/png" },
  "teachers/ruby-full.png": { file: "teachers/ruby-full.png", mime: "image/png" },
  "teachers/sally-science-face.png": { file: "teachers/sally-science-face.png", mime: "image/png" },
  "teachers/sally-science-full.png": { file: "teachers/sally-science-full.png", mime: "image/png" },
  "teachers/professor-edward-face.png": { file: "teachers/professor-edward-face.png", mime: "image/png" },
  "teachers/professor-edward-full.png": { file: "teachers/professor-edward-full.png", mime: "image/png" },
  "students/lyra-face.png":  { file: "students/lyra-face.png",  mime: "image/png" },
  "students/lyra-full.png":  { file: "students/lyra-full.png",  mime: "image/png" },
  "students/sami-face.png":  { file: "students/sami-face.png",  mime: "image/png" },
  "students/sami-full.png":  { file: "students/sami-full.png",  mime: "image/png" },
  "students/ravi-face.png":  { file: "students/ravi-face.png",  mime: "image/png" },
  "students/ravi-full.png":  { file: "students/ravi-full.png",  mime: "image/png" },
  "students/indra-face.png": { file: "students/indra-face.png", mime: "image/png" },
  "students/indra-full.png": { file: "students/indra-full.png", mime: "image/png" },
  "students/mika-face.png":  { file: "students/mika-face.png",  mime: "image/png" },
  "students/mika-full.png":  { file: "students/mika-full.png",  mime: "image/png" },
  "students/noor-face.png":  { file: "students/noor-face.png",  mime: "image/png" },
  "students/noor-full.png":  { file: "students/noor-full.png",  mime: "image/png" },
};

export interface RouteContext {
  method: string;
  pathname: string;
  url?: URL;
  runtime: unknown | null;
  res: unknown;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
  /** Raw incoming Cookie header. If absent, auth + chat features are unavailable but the rest of the app keeps working. */
  cookieHeader?: string | null;
  /** Builds an absolute callback URL for OAuth redirects. */
  callbackUrlBuilder?: (path: string) => string;
  /** True when the response is being served over HTTPS (controls Secure cookie flag). */
  isSecure?: boolean;
  /** Best-known client IP (x-forwarded-for or socket.remoteAddress). Used for
   *  rate limiting in the chat layer. Optional — when absent, rate limiting
   *  falls back to per-cookie keys only. */
  clientIp?: string | null;
}

interface FacultyTelemetry extends FacultyMember {
  questionCount: number;
  subjects: string[];
}

interface SessionTelemetry extends Record<string, unknown> {
  faculty: string;
  facultyDisplayName: string;
  facultyAccent: string;
  subject: string | null;
  difficulty: Difficulty | null;
  scoreCorrect: number;
  scoreTotal: number;
  status: QuizState["status"];
  /** Authoritative session phase. The single dedupe primitive for client
   *  effects (greetings, answer reactions). Bumps `phaseToken` on every
   *  transition. The legacy `status` field is derived from this. */
  phase: QuizState["phase"];
  phaseToken: number;
  current: {
    id: string;
    prompt: string;
    options: Record<Choice, string>;
    subject: string | null;
    difficulty: Difficulty | null;
  } | null;
  lastReveal: QuizState["lastReveal"];
  faculty_roster: FacultyTelemetry[];
  asked_count: number;
  store_path: string | null;
  current_grade: Grade | null;
  completed_grades: Grade[];
  grade_progress: Record<string, number>;
  has_seen_intro: boolean;
  /** Fixed room schedule — homeroom / science / literature / lounge. */
  rooms: Room[];
  /** Currently-active student ids in each teaching room (max 2). Derived from
   *  npc_roster — students migrate as they pass subjects. */
  room_cohort: Record<string, string[]>;
  /** Full NPC roster for the active grade. */
  npc_roster: NpcStudentState[];
  /** The live race-to-answer state for the active question, if any. */
  active_round: {
    type: "multiple-choice" | "opinion";
    questionId: string;
    startedAt: number;
    durationMs: number;
    expiresAt: number;
    elapsedMs: number;
    remainingMs: number;
    npcs: Array<{
      studentId: string;
      delayMs: number;
      answeredAt: number | null;
      isLocked: boolean;
      pick: string | null;       // exposed only after their delay elapses
      isCorrect: boolean | null; // null until reveal
    }>;
    player: { picked: string | null; answeredAt: number | null; isLocked: boolean };
    resolved: boolean;
    firstCorrect: string | null;
    /** Opinion-mode data (empty for MC). */
    opinionResponses: Array<{ responder: string; text: string; submittedAt: number }>;
    opinionGrades: Array<{ responder: string; score: number; comment: string }>;
    bestResponder: string | null;
    /** Advantage roll status — null until the player taps "Roll for advantage."
     *  Once set, eliminated choices are crossed out in the viewer. */
    advantage: {
      rolled: boolean;
      stat: string;
      dice: [number, number];
      total: number;
      outcome: "hit" | "mixed" | "miss";
      eliminated: string[];
    } | null;
  } | null;
  /** True when the active question expects a written response, surfaced for
   *  the viewer to swap A/B/C/D for a textarea. */
  is_opinion: boolean;
  /** The player's character sheet (null until they create one). */
  character: PlayerCharacter | null;
  /** Playbook catalog for the character creation UI. */
  playbooks: typeof PLAYBOOKS;
  /** "Today's Daily" status — drives the empty-state copy and the
   *  play-daily CTA visibility. */
  daily: {
    available: boolean;
    reason?: "weekend" | "completed" | "no-grade" | "no-character";
    facultyId: string | null;
    dailyKey: string;
  };
}

function getRuntime(value: unknown): IAgentRuntime | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { agentId?: unknown; getService?: unknown };
  if (typeof candidate.getService !== "function") return null;
  return candidate as unknown as IAgentRuntime;
}

function tryGetService<T>(runtime: IAgentRuntime | null, type: string): T | null {
  if (!runtime) return null;
  try {
    return (runtime.getService(type) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

function getCharacterName(runtime: IAgentRuntime | null): string {
  const character = (runtime as { character?: { name?: string } } | null)?.character;
  return character?.name ?? "Ruby";
}

/** Derive a per-user session key from the rh_session cookie. Pre-auth users
 *  share an "anonymous" bucket — fine for the browse-while-signed-out preview.
 *  Each signed-in OpenRouter user gets their own bucket so state, character,
 *  NPC roster, etc. are isolated per user. THIS IS THE MULTI-TENANCY FIX. */
function getSessionId(runtime: IAgentRuntime | null, cookieHeader?: string | null): string {
  const token = parseRhSessionCookie(cookieHeader);
  if (token) return `rh:user:${token}`;
  return "rh:anonymous";
}

function parseRhSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i) === "rh_session") return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

function facultyById(id: string): FacultyMember {
  return ALL_FACULTY.find((f) => f.id === id) ?? RUBY_FACULTY;
}

function deriveActiveRound(state: QuizState) {
  const round = state.activeRound;
  if (!round) return null;
  const now = Date.now();
  const elapsedMs = Math.max(0, now - round.startedAt);
  const remainingMs = Math.max(0, round.expiresAt - now);
  const reveal = round.resolved;
  const isOpinion = round.type === "opinion";
  return {
    type: round.type,
    questionId: round.questionId,
    startedAt: round.startedAt,
    durationMs: round.durationMs,
    expiresAt: round.expiresAt,
    elapsedMs,
    remainingMs,
    npcs: round.npcs.map((n) => {
      const isLocked = n.answeredAt != null;
      // For MC: only expose the pick + correctness AFTER reveal. For opinion:
      // pick is always null; isLocked simply means their written response landed.
      return {
        studentId: n.studentId,
        delayMs: n.delayMs,
        answeredAt: n.answeredAt,
        isLocked,
        pick: !isOpinion && reveal && isLocked ? n.plannedPick : null,
        isCorrect: !isOpinion && reveal && isLocked && state.current ? n.plannedPick === state.current.correct : null,
      };
    }),
    player: {
      picked: !isOpinion && reveal ? round.player.picked : null,
      answeredAt: round.player.answeredAt,
      isLocked: round.player.answeredAt != null,
    },
    resolved: round.resolved,
    firstCorrect: !isOpinion && reveal ? round.firstCorrect : null,
    opinionResponses: round.opinionResponses,
    opinionGrades: round.opinionGrades,
    bestResponder: round.bestResponder,
    advantage: round.advantage
      ? {
          rolled: round.advantage.rolled,
          stat: round.advantage.stat,
          dice: round.advantage.dice,
          total: round.advantage.total,
          outcome: round.advantage.outcome,
          eliminated: round.advantage.eliminated,
        }
      : null,
  };
}

/** Derives "today's Daily" status for the viewer. Mirrors
 *  RubyHighService.dailyStatus() — kept inline here so buildSessionState
 *  doesn't need a service handle. Both implementations use the same
 *  dailyKey / facultyForDay helpers, so they stay in lockstep. */
function deriveDailyStatus(state: QuizState, now: Date = new Date()): {
  available: boolean;
  reason?: "weekend" | "completed" | "no-grade" | "no-character";
  facultyId: string | null;
  dailyKey: string;
} {
  const key = dailyKey(now);
  const fac = facultyForDay(key);
  if (!state.character) return { available: false, reason: "no-character", facultyId: fac, dailyKey: key };
  if (!state.currentGrade) return { available: false, reason: "no-grade", facultyId: fac, dailyKey: key };
  if (!fac) return { available: false, reason: "weekend", facultyId: null, dailyKey: key };
  if (state.character.lastDailyDate === key) {
    return { available: false, reason: "completed", facultyId: fac, dailyKey: key };
  }
  return { available: true, facultyId: fac, dailyKey: key };
}

function deriveRoomCohort(roster: NpcStudentState[]): Record<string, string[]> {
  const out: Record<string, string[]> = { homeroom: [], science: [], literature: [] };
  for (const npc of roster) {
    if (npc.currentRoom && out[npc.currentRoom]) out[npc.currentRoom]!.push(npc.id);
  }
  return out;
}

function buildFacultyRoster(faculty: FacultyService | null): FacultyTelemetry[] {
  return ALL_FACULTY.map((f) => {
    const bank = faculty?.bank(f.id);
    return {
      ...f,
      questionCount: bank?.questions.length ?? 0,
      subjects: bank ? Array.from(new Set(bank.questions.map((q) => q.subject))).sort() : f.subjects,
    };
  });
}

function buildSessionState(args: {
  runtime: IAgentRuntime | null;
  state: QuizState;
  faculty: FacultyService | null;
  cookieHeader?: string | null;
}): PluginAppSessionState {
  const { runtime, state, faculty } = args;
  const sessionId = getSessionId(runtime, args.cookieHeader);
  const fac = facultyById(state.faculty);

  const telemetry: SessionTelemetry = {
    faculty: state.faculty,
    facultyDisplayName: fac.displayName,
    facultyAccent: fac.accent,
    subject: state.subject,
    difficulty: state.current?.difficulty ?? null,
    scoreCorrect: state.score.correct,
    scoreTotal: state.score.total,
    status: state.status,
    phase: state.phase,
    phaseToken: state.phaseToken,
    current: state.current
      ? {
          id: state.current.id,
          prompt: state.current.prompt,
          options: (state.current.options ?? { A: "", B: "", C: "", D: "" }) as Record<Choice, string>,
          subject: state.current.subject ?? null,
          difficulty: state.current.difficulty ?? null,
        }
      : null,
    lastReveal: state.lastReveal,
    faculty_roster: buildFacultyRoster(faculty),
    asked_count: state.askedQuestionIds.length,
    store_path: null,
    current_grade: state.currentGrade,
    completed_grades: state.completedGrades,
    grade_progress: state.gradeProgress,
    has_seen_intro: state.hasSeenIntro,
    rooms: ROOMS,
    npc_roster: state.currentGrade ? (state.npcRosters[state.currentGrade] ?? []) : [],
    room_cohort: state.currentGrade
      ? deriveRoomCohort(state.npcRosters[state.currentGrade] ?? [])
      : {},
    active_round: deriveActiveRound(state),
    is_opinion: state.current?.type === "opinion",
    character: state.character,
    playbooks: PLAYBOOKS,
    daily: deriveDailyStatus(state),
  };

  const summary = state.current
    ? `${fac.displayName} · ${state.current.subject ?? "open"} · ${state.current.difficulty ?? "?"} · awaiting answer`
    : `${fac.displayName} on the floor · ${state.score.correct}/${state.score.total}`;

  const suggested = state.current
    ? [
        "Wait for the student to pick A, B, C, or D.",
        "Riff in character while they think.",
        "If they're stuck, narrow it down without giving the answer.",
      ]
    : [
        "Pick the next question with PICK_QUESTION (filter by subject or difficulty).",
        "Hand off with HANDOFF_FACULTY when the topic shifts.",
        "Stay in character — Ruby is the host, faculty are the experts.",
      ];

  return {
    sessionId,
    appName: APP_NAME,
    mode: "spectate-and-steer",
    status: "running",
    displayName: APP_DISPLAY_NAME,
    agentId: (runtime as { agentId?: string } | null)?.agentId,
    canSendCommands: true,
    controls: ["pause", "resume"],
    summary,
    goalLabel: state.subject ? `Ruby High · ${state.subject}` : "Ruby High",
    suggestedPrompts: suggested,
    telemetry: telemetry as PluginAppSessionState["telemetry"],
  };
}

function sendHtmlResponse(res: unknown, html: string): void {
  const response = res as {
    end: (body?: string | Buffer) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
    removeHeader?: (name: string) => void;
    getHeader?: (name: string) => number | string | string[] | undefined;
  };
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.removeHeader?.("X-Frame-Options");
  const existingCsp = response.getHeader?.("Content-Security-Policy");
  const normalized =
    typeof existingCsp === "string"
      ? existingCsp.trim()
      : Array.isArray(existingCsp)
        ? existingCsp.join("; ").trim()
        : "";
  const nextCsp = /\bframe-ancestors\b/i.test(normalized)
    ? normalized
    : normalized.length > 0
      ? `${normalized}; ${VIEWER_FRAME_ANCESTORS_DIRECTIVE}`
      : VIEWER_FRAME_ANCESTORS_DIRECTIVE;
  response.setHeader("Content-Security-Policy", nextCsp);
  response.end(html);
}

async function sendAsset(res: unknown, name: string): Promise<boolean> {
  const entry = ASSET_FILES[name];
  if (!entry) return false;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, "..", "assets", entry.file),
      resolve(here, "assets", entry.file),
    ];
    let body: Buffer | null = null;
    for (const path of candidates) {
      try {
        body = await readFile(path);
        break;
      } catch {}
    }
    if (!body) return false;
    const response = res as {
      end: (body?: Buffer) => void;
      setHeader: (name: string, value: string) => void;
      statusCode: number;
    };
    response.statusCode = 200;
    response.setHeader("Content-Type", entry.mime);
    response.setHeader("Cache-Control", "public, max-age=300");
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

function parseSessionId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/apps\/ruby-high\/session\/([^/]+)(?:\/.*)?$/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function parseSessionSubroute(pathname: string): "command" | "control" | null {
  if (pathname.endsWith("/command")) return "command";
  if (pathname.endsWith("/control")) return "control";
  return null;
}

export async function resolveLaunchSession(
  ctx: PluginAppBridgeLaunchContext,
): Promise<PluginAppSessionState | null> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  if (!ruby) return null;
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  // Launch context (from the eliza app-bridge) doesn't carry an HTTP cookie,
  // so launch-time state lands in the anonymous bucket. The interactive HTTP
  // routes pick up the per-user state once the browser sends rh_session.
  // Launch context has no HTTP cookie — anonymous bucket is the right default.
  const state = ruby.getOrCreate(getSessionId(runtime));
  return buildSessionState({ runtime, state, faculty });
}

export async function refreshRunSession(
  ctx: PluginAppBridgeRunContext,
): Promise<PluginAppSessionState | null> {
  return resolveLaunchSession(ctx);
}

export async function collectLaunchDiagnostics(
  ctx: PluginAppBridgeRunContext,
): Promise<PluginAppLaunchDiagnostic[]> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  const diagnostics: PluginAppLaunchDiagnostic[] = [];
  if (!ruby) {
    diagnostics.push({
      code: "ruby-high-service-missing",
      severity: "error",
      message:
        "RubyHighService is not registered. Include @cenetex/app-ruby-high in the character's plugins.",
    });
  }
  if (!faculty) {
    diagnostics.push({
      code: "ruby-high-faculty-missing",
      severity: "warning",
      message:
        "FacultyService is not registered — PICK_QUESTION will fail. Make sure the plugin's services are loaded in the order declared.",
    });
  }
  return diagnostics;
}

export async function handleAppRoutes(ctx: RouteContext): Promise<boolean> {
  const runtime = getRuntime(ctx.runtime);

  if (
    ctx.pathname.startsWith("/api/apps/ruby-high/auth") ||
    ctx.pathname.startsWith("/api/apps/ruby-high/chat")
  ) {
    return handleChatRoutes({
      method: ctx.method,
      pathname: ctx.pathname,
      url: ctx.url,
      runtime: ctx.runtime,
      res: ctx.res,
      cookieHeader: ctx.cookieHeader,
      callbackUrlBuilder: ctx.callbackUrlBuilder,
      isSecure: ctx.isSecure,
      clientIp: ctx.clientIp,
      error: ctx.error,
      json: ctx.json,
      readJsonBody: ctx.readJsonBody,
    });
  }

  if (ctx.method === "GET" && ctx.pathname === VIEWER_PATH) {
    const role = ctx.url?.searchParams.get("role") === "agent" ? "agent" : "human";
    sendHtmlResponse(
      ctx.res,
      renderViewerHtml({
        agentName: getCharacterName(runtime),
        sessionId: getSessionId(runtime, ctx.cookieHeader),
        apiBase: APP_ROUTE_PREFIX,
        role,
      }),
    );
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname.startsWith(ASSETS_PREFIX)) {
    const name = ctx.pathname.slice(ASSETS_PREFIX.length);
    const sent = await sendAsset(ctx.res, name);
    if (sent) return true;
    ctx.error(ctx.res, `Asset not found: ${name}`, 404);
    return true;
  }

  const sessionId = parseSessionId(ctx.pathname);
  if (!sessionId) return false;

  const subroute = parseSessionSubroute(ctx.pathname);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  if (!ruby) {
    ctx.error(ctx.res, "RubyHighService unavailable", 503);
    return true;
  }
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  const stateKey = getSessionId(runtime, ctx.cookieHeader);

  if (ctx.method === "GET" && !subroute) {
    const state = ruby.getOrCreate(stateKey);
    ctx.json(ctx.res, buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }));
    return true;
  }

  if (ctx.method === "POST" && subroute === "control") {
    ctx.json(ctx.res, {
      success: true,
      message: "Ruby High has no global pause/resume; the classroom keeps its state until cleared.",
      session: null,
    });
    return true;
  }

  if (ctx.method === "POST" && subroute === "command") {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | {
          type?: string;
          picked?: string;
          role?: string;
          prompt?: string;
          faculty?: string;
          subject?: string;
          difficulty?: string;
        }
      | null;
    const type = body?.type;

    try {
      if (type === "answer") {
        const picked = String(body?.picked ?? "").toUpperCase() as Choice;
        if (!CHOICES.includes(picked)) throw new Error("Pick must be A, B, C, or D");
        const state = ruby.submitAnswer(stateKey, picked);
        if (state.lastReveal) {
          noteGradedAnswer({
            runtime,
            cookieHeader: ctx.cookieHeader,
            faculty: state.faculty,
            picked: state.lastReveal.picked,
            correct: state.lastReveal.correct,
            wasCorrect: state.lastReveal.wasCorrect,
          });
        }
        ctx.json(ctx.res, {
          success: true,
          message: state.lastReveal?.wasCorrect ? "Correct" : "Marked",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "pick") {
        const state = ruby.pickAndPose(stateKey, {
          faculty: body?.faculty,
          subject: body?.subject,
          difficulty: body?.difficulty as Difficulty | undefined,
        });
        ctx.json(ctx.res, {
          success: true,
          message: "Picked",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "play-daily") {
        const state = ruby.playDaily(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Today's Daily is on the board.",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "set-faculty") {
        if (!body?.faculty) throw new Error("Missing faculty id");
        const state = ruby.setFaculty(stateKey, body.faculty);
        ctx.json(ctx.res, {
          success: true,
          message: `Now teaching: ${state.faculty}`,
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "clear") {
        const state = ruby.clearBoard(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Cleared",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "reset") {
        const state = ruby.resetSession(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Session reset",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "force-resolve") {
        const state = ruby.forceResolveRound(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Round resolved",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "roll-advantage") {
        const { state, result } = ruby.rollAdvantage(stateKey);
        const message = result == null
          ? "No active question to roll on."
          : result.outcome === "hit"
            ? `Hit (${result.total}) — eliminated ${result.eliminated.join(" & ")}.`
            : result.outcome === "mixed"
              ? `Mixed (${result.total}) — eliminated ${result.eliminated.join(" & ")}.`
              : `Miss (${result.total}) — nothing's crossed out, but you're no worse off.`;
        ctx.json(ctx.res, {
          success: true,
          message,
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "create-character") {
        const cb = body as { name?: string; playbookId?: string; stats?: CharacterStats; arcAnswer?: string; flavorQuote?: string; personality?: string; portraitDataUrl?: string };
        if (!cb.name || !cb.playbookId || !cb.stats) {
          throw new Error("Missing name, playbookId, or stats.");
        }
        if (!PLAYBOOKS.some((p) => p.id === cb.playbookId)) {
          throw new Error(`Unknown playbookId: ${cb.playbookId}`);
        }
        if (!isValidStatDistribution(cb.stats)) {
          throw new Error("Invalid stat distribution — must be one each of +2, +1, 0, -1.");
        }
        const state = ruby.createCharacter(stateKey, {
          name: cb.name,
          playbookId: cb.playbookId,
          stats: cb.stats,
          arcAnswer: cb.arcAnswer ?? "",
          flavorQuote: cb.flavorQuote,
          personality: cb.personality ?? "",
          portraitDataUrl: cb.portraitDataUrl,
        });
        ctx.json(ctx.res, {
          success: true,
          message: "Character created",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "clear-character") {
        const state = ruby.clearCharacter(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Character cleared",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "set-portrait") {
        const url = String((body as { portraitDataUrl?: string }).portraitDataUrl ?? "");
        if (!url.startsWith("data:image/")) throw new Error("portraitDataUrl must be a data URL");
        const state = ruby.setPortrait(stateKey, url);
        ctx.json(ctx.res, {
          success: true,
          message: "Portrait updated",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "select-grade") {
        const grade = String((body as { grade?: string })?.grade ?? "") as Grade;
        if (!GRADES.includes(grade)) throw new Error(`Grade must be one of ${GRADES.join(", ")}`);
        const state = ruby.selectGrade(stateKey, grade);
        ctx.json(ctx.res, {
          success: true,
          message: `Grade set to ${grade}`,
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "mark-intro-seen") {
        const state = ruby.markIntroSeen(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Intro acknowledged",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      const state = ruby.getOrCreate(stateKey);
      ctx.json(ctx.res, {
        success: true,
        message: `Suggestion noted: ${body?.prompt ?? body?.type ?? "unknown"}`,
        session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error(ctx.res, message, 400);
      return true;
    }
  }

  return false;
}
