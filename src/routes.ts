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
import { RubyHighService, type CourseProgress } from "./services/ruby-high-service.js";
import { FacultyService, toFacultyMember } from "./services/faculty-service.js";
import {
  ADVANTAGE_ROLLS_PER_GRADE,
  CHOICES,
  GRADES,
  TEACHING_ROOMS,
  dailyKey,
  facultyForDay,
  type CharacterStats,
  type Choice,
  type Difficulty,
  type FacultyMember,
  type Grade,
  type GraduationReward,
  type NpcStudentState,
  type PlayerCharacter,
  type QuizState,
  type TeachingRoomId,
} from "./types.js";
import { PLAYBOOKS, isValidStatDistribution } from "./characters/playbooks.js";
import { renderViewerHtml, VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "./viewer.js";
import { handleChatRoutes, noteGradedAnswer } from "./chat-routes.js";
import { handlePackRoutes } from "./pack-routes.js";
import { AuthService } from "./services/auth-service.js";
import { log } from "./services/logger.js";
import { TokenBucket } from "./services/rate-limit.js";
import {
  availablePacksForSession,
  courseForFacultyForSession,
  coursesForSession,
  facultyForSession,
  packForSession,
  roomsForSession,
  roomsWithLoungeForSession,
} from "./content/registry.js";
import type { PackCourse, PackRoom } from "./content/types.js";

const APP_NAME = "@cenetex/app-ruby-high";
const APP_DISPLAY_NAME = "Ruby High";

/** Rate limiter for the game-state mutation surface (POST /command).
 *
 *  Generous because legitimate UI flows are bursty — a single round can
 *  fire pose → advantage-roll → answer → reveal in well under a second.
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
  "fonts/caveat-regular.ttf": { file: "fonts/caveat-regular.ttf", mime: "font/ttf" },
  "fonts/crafty-girls-regular.ttf": { file: "fonts/crafty-girls-regular.ttf", mime: "font/ttf" },
  "fonts/give-you-glory-regular.ttf": { file: "fonts/give-you-glory-regular.ttf", mime: "font/ttf" },
  "fonts/schoolbell-regular.ttf": { file: "fonts/schoolbell-regular.ttf", mime: "font/ttf" },
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
  /** Raw value of the `X-Openrouter-Key` header, if the client sent one.
   *  This is the OpenRouter API key — clients keep it in localStorage and
   *  attach it to every LLM-touching request. The server never persists it. */
  apiKeyHeader?: string | null;
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
  assetTeacherId?: string;
  courseGrade?: string;
  completedClasses?: number;
  requiredClasses?: number;
  averageScore?: number;
  todayClass?: CourseProgress["today"];
  readyCount?: number;
  masteredCount?: number;
  learningCount?: number;
  shakyCount?: number;
  newCount?: number;
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
    stat: keyof CharacterStats | null;
    difficulty: Difficulty | null;
  } | null;
  lastReveal: QuizState["lastReveal"];
  faculty_roster: FacultyTelemetry[];
  asked_count: number;
  store_path: string | null;
  current_grade: Grade | null;
  completed_grades: Grade[];
  has_seen_intro: boolean;
  /** Active content pack (per-session) + the packs THIS session can see
   *  (built-ins + own imports). The viewer renders these as a pack-store
   *  switcher + the active-pack indicator. Other users' imports are not
   *  exposed (privacy: Anki decks are often private study material). */
  active_pack: { id: string; name: string; description: string };
  active_course: PackCourse | null;
  active_course_progress: CourseProgress | null;
  courses: PackCourse[];
  available_packs: Array<{
    id: string;
    name: string;
    description: string;
    faculty_count: number;
    question_count: number;
  }>;
  /** Channel rail entries for the active pack — typically 3 teaching
   *  rooms (one per faculty) plus the universal lounge. */
  rooms: PackRoom[];
  /** Currently-seated student ids in each teaching room (max 2). Static
   *  for the year — set by the initial seating chart in INITIAL_STUDENT_LAYOUT. */
  room_cohort: Record<string, string[]>;
  /** Full NPC roster for the active grade. */
  npc_roster: NpcStudentState[];
  /** The live race-to-answer state for the active question, if any. */
  active_round: {
    type: "multiple-choice" | "opinion";
    questionId: string;
    /** Legacy rarity, present only for older persisted rounds. */
    rarity?: "common" | "rare" | "legendary";
    /** Question stat that modifies player/NPC rolls. */
    stat?: keyof CharacterStats;
    /** True when this round came from the once-per-day bonus endpoint. */
    isBonus: boolean;
    classSession?: {
      mode: "class" | "practice";
      facultyId: string;
      grade?: Grade;
      date?: string;
      index?: number;
      total?: number;
    };
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
  /** Cohort of 6 NPCs running their own arcs. Each has independent
   *  grade + streak. The viewer renders them as a leaderboard / "who's
   *  ahead of you" surface. */
  npc_cohort: Array<{
    id: string;
    grade: Grade;
    streak: { grade: Grade; count: number };
    completedGrades: Grade[];
    graduated: boolean;
  }>;
  /** Mentor offer from a previous graduated character. Null when none
   *  available. The viewer's character-creation flow checks this and
   *  shows an "inherit / fresh" choice. */
  mentor_offer: PlayerCharacter["inheritedFrom"] | null;
  /** Today's bonus status — drives the empty-state copy and the bonus CTA
   *  visibility. */
  daily: {
    available: boolean;
    reason?: "completed" | "no-grade" | "no-character";
    facultyId: string;
    dailyKey: string;
  };
  /** Per-grade advantage-roll budget. Lets the viewer label the button
   *  with "n left" and disable when the pool is exhausted. */
  advantage_rolls: { used: number; cap: number; remaining: number };
  graduation_ready: PlayerCharacter["pendingGraduation"] | null;
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

/** Derive a per-user state key from the app-owned auth session. Pre-auth users
 *  share an "anonymous" bucket; signed-in OpenRouter accounts resolve to a
 *  stable Ruby High user id, so state, character, NPC roster, etc. survive
 *  cookie rotation and server restarts. */
function getSessionId(runtime: IAgentRuntime | null, cookieHeader?: string | null): string {
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
  return auth?.stateKeyForCookie(cookieHeader) ?? "rh:anonymous";
}

function facultyForState(state: QuizState, id: string): FacultyMember {
  // Resolve faculty against the SESSION's pack — fresh sessions inherit
  // the global default; per-session pack switching reads from their
  // chosen pack. Falls back to the pack's first faculty if the
  // requested id isn't there (e.g. state.faculty stale right after a
  // swap).
  const pack = facultyForSession(state);
  const hit = pack.find((f) => f.id === id) ?? pack[0];
  if (!hit) throw new Error("Active pack has no faculty — cannot resolve facultyForState.");
  return toFacultyMember(hit);
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
    rarity: round.rarity ?? state.current?.rarity,
    stat: round.stat ?? state.current?.stat,
    isBonus: !!round.isBonus,
    classSession: round.classSession,
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

/** Per-grade advantage-roll budget — mirrors RubyHighService.advantageRollsRemaining
 *  but stays inline so buildSessionState doesn't need a service handle. */
function deriveAdvantageRolls(state: QuizState): { used: number; cap: number; remaining: number } {
  const grade = state.currentGrade;
  const used = (grade && state.character?.advantageRollsUsed?.[grade]) ?? 0;
  const bonus = (grade && state.character?.advantageRollBonuses?.[grade]) ?? 0;
  const cap = ADVANTAGE_ROLLS_PER_GRADE + Math.max(0, bonus);
  return { used, cap, remaining: Math.max(0, cap - used) };
}

/** Derives today's bonus status for the viewer. Mirrors
 *  RubyHighService.dailyStatus() — kept inline here so buildSessionState
 *  doesn't need a service handle. Both implementations use the same
 *  dailyKey / facultyForDay helpers, so they stay in lockstep. */
function deriveDailyStatus(state: QuizState, now: Date = new Date()): {
  available: boolean;
  reason?: "completed" | "no-grade" | "no-character";
  facultyId: string;
  dailyKey: string;
} {
  const key = dailyKey(now);
  const fac = facultyForDay(key);
  if (!state.character) return { available: false, reason: "no-character", facultyId: fac, dailyKey: key };
  if (!state.currentGrade) return { available: false, reason: "no-grade", facultyId: fac, dailyKey: key };
  if (state.character.lastBonusDate === key) {
    return { available: false, reason: "completed", facultyId: fac, dailyKey: key };
  }
  return { available: true, facultyId: fac, dailyKey: key };
}

function deriveRoomCohort(roster: NpcStudentState[], state: QuizState): Record<string, string[]> {
  // Build the per-room cohort map keyed off THIS session's pack's rooms so
  // a session that switched to a different pack sees the right room layout.
  const out: Record<string, string[]> = {};
  for (const room of roomsForSession(state)) {
    if (room.teaches) out[room.id] = [];
  }
  for (const npc of roster) {
    if (npc.currentRoom && out[npc.currentRoom]) out[npc.currentRoom]!.push(npc.id);
  }
  return out;
}

function buildFacultyRoster(
  faculty: FacultyService | null,
  state: QuizState,
  ruby: RubyHighService | null,
  sessionId: string,
): FacultyTelemetry[] {
  const pack = packForSession(state);
  return facultyForSession(state).map((f) => {
    const bank = faculty?.bank(f.id, pack);
    const progress = ruby?.courseProgress(sessionId, f.id) ?? null;
    const subjects = bank ? Array.from(new Set(bank.questions.map((q) => q.subject))).sort() : f.subjects;
    return {
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      bio: f.bio,
      available: true,
      accent: f.accent,
      ...(f.assetTeacherId ? { assetTeacherId: f.assetTeacherId } : {}),
      questionCount: bank?.questions.length ?? 0,
      ...(progress?.grade ? { courseGrade: progress.grade } : {}),
      ...(progress ? {
        completedClasses: progress.completedClasses,
        requiredClasses: progress.requiredClasses,
        ...(progress.averageScore != null ? { averageScore: progress.averageScore } : {}),
        todayClass: progress.today,
        readyCount: progress.ready,
        masteredCount: progress.mastered,
        learningCount: progress.learning,
        shakyCount: progress.shaky,
        newCount: progress.new,
      } : {}),
      subjects,
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
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const fac = facultyForState(state, state.faculty);

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
          stat: state.current.stat ?? null,
          difficulty: state.current.difficulty ?? null,
        }
      : null,
    lastReveal: state.lastReveal,
    faculty_roster: buildFacultyRoster(faculty, state, ruby, sessionId),
    asked_count: state.askedQuestionIds.length,
    store_path: null,
    current_grade: state.currentGrade,
    completed_grades: state.completedGrades,
    has_seen_intro: state.hasSeenIntro,
    active_pack: (() => {
      const p = packForSession(state);
      return { id: p.id, name: p.name, description: p.description };
    })(),
    active_course: courseForFacultyForSession(state, state.faculty),
    active_course_progress: ruby?.courseProgress(sessionId, state.faculty) ?? null,
    courses: coursesForSession(state),
    available_packs: availablePacksForSession(sessionId).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      faculty_count: p.faculty.length,
      question_count: p.faculty.reduce((s, f) => s + f.questions.length, 0),
    })),
    rooms: roomsWithLoungeForSession(state),
    npc_roster: state.currentGrade ? (state.npcRosters[state.currentGrade] ?? []) : [],
    room_cohort: state.currentGrade
      ? deriveRoomCohort(state.npcRosters[state.currentGrade] ?? [], state)
      : {},
    active_round: deriveActiveRound(state),
    is_opinion: state.current?.type === "opinion",
    character: state.character,
    playbooks: PLAYBOOKS,
    daily: deriveDailyStatus(state),
    npc_cohort: state.npcCohort ?? [],
    mentor_offer: state.mentorOffer ?? null,
    advantage_rolls: deriveAdvantageRolls(state),
    graduation_ready: state.character?.pendingGraduation ?? null,
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
      apiKeyHeader: ctx.apiKeyHeader,
      callbackUrlBuilder: ctx.callbackUrlBuilder,
      isSecure: ctx.isSecure,
      clientIp: ctx.clientIp,
      error: ctx.error,
      json: ctx.json,
      readJsonBody: ctx.readJsonBody,
    });
  }

  // Pack-store endpoints: per-session ownership, auth required.
  if (ctx.pathname.startsWith("/api/apps/ruby-high/packs")) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handlePackRoutes(
      {
        method: ctx.method,
        pathname: ctx.pathname,
        res: ctx.res,
        cookieHeader: ctx.cookieHeader,
        apiKeyHeader: ctx.apiKeyHeader,
        clientIp: ctx.clientIp,
        error: ctx.error,
        json: ctx.json,
        readJsonBody: ctx.readJsonBody,
      },
      {
        auth,
        ruby,
        sessionIdFor: (cookieHeader) => getSessionId(runtime, cookieHeader),
      },
    );
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
    const rlKey = commandRateKey(ctx.clientIp, stateKey);
    if (!COMMAND_LIMITER.take(rlKey)) {
      const retryAfter = COMMAND_LIMITER.retryAfterSeconds(rlKey);
      const res = ctx.res as { setHeader?: (name: string, value: string) => void };
      res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
      ctx.error(ctx.res, "Too many requests — slow down a moment.", 429);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | {
          type?: string;
          picked?: string;
          role?: string;
          prompt?: string;
          faculty?: string;
          subject?: string;
          difficulty?: string;
          mode?: "class" | "practice";
          reward?: GraduationReward;
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
          mode: body?.mode,
        });
        ctx.json(ctx.res, {
          success: true,
          message: "Picked",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "play-bonus" || type === "play-daily") {
        // Renamed from play-daily; old clients still send the legacy
        // name during the rolling window.
        const state = ruby.playBonus(stateKey);
        ctx.json(ctx.res, {
          success: true,
          message: "Today's bonus question is on the board.",
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
        ctx.json(ctx.res, {
          success: true,
          message,
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "complete-graduation") {
        const reward = body?.reward;
        if (!reward || typeof reward !== "object" || !("kind" in reward)) {
          throw new Error("Pick a graduation reward.");
        }
        const state = ruby.completeGraduation(stateKey, reward);
        ctx.json(ctx.res, {
          success: true,
          message: state.character && (state.character.yearbook ?? []).length >= 4
            ? "Graduated"
            : "Advanced",
          session: buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }),
        });
        return true;
      }

      if (type === "create-character") {
        const cb = body as { name?: string; playbookId?: string; stats?: CharacterStats; arcAnswer?: string; flavorQuote?: string; personality?: string; portraitDataUrl?: string; mentorAccepted?: boolean };
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
          mentorAccepted: !!cb.mentorAccepted,
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
      log.error("command.failed", err, { command: typeof body?.type === "string" ? body.type : "?" });
      ctx.error(ctx.res, message, 400);
      return true;
    }
  }

  return false;
}
