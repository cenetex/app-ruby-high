/**
 * /packs/* HTTP surface — content pack management.
 *
 *   GET  /packs                — list packs visible to this session.
 *   POST /packs/active         — switch THIS session's active pack
 *                                (auth required).
 *
 * Auth: every mutation requires a signed-in user. Read (GET /packs) is
 * also auth-required so unauthed callers can't enumerate registered
 * pack ids.
 *
 * Privacy: session-scoped packs are owned by the registering session —
 * only that session sees them in /packs and can activate them. Built-in
 * packs (the original) are visible to everyone.
 */

import { AuthService } from "./services/auth-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { log } from "./services/logger.js";
import {
  availablePacksForSession,
  coursesForPack,
  getPackByIdForSession,
  packOwnerSessionId,
  packForSession,
  registerPack,
} from "./content/registry.js";
import type { ContentPack } from "./content/types.js";
import {
  candidateWithReachableProfileImage,
  connectedTeacherChannelName,
  generateConnectedTeacherQuestionBank,
  connectedTeacherPackId,
  listRatiTeacherCandidates,
  packForConnectedTeacher,
  ratiConfigured,
  type ConnectedTeacherCandidate,
} from "./services/teacher-providers.js";

export interface PackRouteContext {
  method: string;
  pathname: string;
  res: unknown;
  cookieHeader?: string | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

/** Pack switching is per-session — each player's QuizState carries
 *  activePackId. We need RubyHighService to read + mutate that state.
 *  AuthService is required because all pack mutations need a signed-in
 *  user (distractor generation needs the user's OpenRouter key; switch
 *  needs an identifiable session). */
export interface PackRouteDeps {
  auth: AuthService;
  ruby: RubyHighService;
  /** Resolves the per-cookie session id the same way the rest of the
   *  app does, so pack-routes lands on the same QuizState the player
   *  is using. */
  sessionIdFor: (cookieHeader?: string | null) => string;
}

const PACK_PREFIX = "/api/apps/ruby-high/packs";
const CONNECTED_TEACHERS_PATH = "/api/apps/ruby-high/connected-teachers";

function packSummary(pack: ContentPack) {
  const countFacultyCards = (f: ContentPack["faculty"][number]) =>
    (f.sourceCards?.length ?? 0) + f.questions.filter((q) => !q.sourceCardId).length;
  const questionCount = pack.faculty.reduce((s, f) => s + countFacultyCards(f), 0);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    faculty_count: pack.faculty.length,
    question_count: questionCount,
    courses: coursesForPack(pack),
    faculty: pack.faculty.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      ...(f.assetTeacherId ? { assetTeacherId: f.assetTeacherId } : {}),
      ...(f.profileImageUrl ? { profileImageUrl: f.profileImageUrl } : {}),
      subjects: f.subjects,
      questionCount: countFacultyCards(f),
    })),
  };
}

function connectedTeacherSummary(candidate: ConnectedTeacherCandidate, sessionId: string) {
  const packId = connectedTeacherPackId(candidate);
  const ownerSessionId = packOwnerSessionId(packId);
  const ownedByAnotherSession = typeof ownerSessionId === "string" && ownerSessionId !== sessionId;
  return {
    ...candidate,
    packId,
    connected: ownerSessionId === sessionId,
    ownedByAnotherSession,
    defaultChannelName: connectedTeacherChannelName(null, candidate.name || candidate.root || candidate.model),
    ...(ownedByAnotherSession ? { unavailableReason: "already-connected" } : {}),
  };
}

function connectedTeacherOwnedByAnotherSession(candidate: ConnectedTeacherCandidate, sessionId: string): boolean {
  const ownerSessionId = packOwnerSessionId(connectedTeacherPackId(candidate));
  return typeof ownerSessionId === "string" && ownerSessionId !== sessionId;
}

export async function handlePackRoutes(
  ctx: PackRouteContext,
  deps: PackRouteDeps,
): Promise<boolean> {
  const isPackRoute = ctx.pathname.startsWith(PACK_PREFIX);
  const isConnectedTeachersRoute = ctx.pathname === CONNECTED_TEACHERS_PATH;
  if (!isPackRoute && !isConnectedTeachersRoute) return false;
  const sub = isPackRoute ? (ctx.pathname.slice(PACK_PREFIX.length) || "/") : "/";

  // Every endpoint requires a signed-in session — pack management is
  // per-user territory and we don't want unauthed callers enumerating
  // registered pack ids or mutating session state.
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!record || !token) {
    ctx.error(ctx.res, "Sign in to manage connected teachers.", 401);
    return true;
  }
  const sessionId = deps.sessionIdFor(ctx.cookieHeader);
  const state = deps.ruby.getOrCreate(sessionId);

  // GET /connected-teachers — list server-allowlisted live teacher backends.
  if (isConnectedTeachersRoute && ctx.method === "GET") {
    if (!ratiConfigured()) {
      ctx.json(ctx.res, { configured: false, teachers: [] });
      return true;
    }
    try {
      ctx.json(ctx.res, {
        configured: true,
        teachers: (await listRatiTeacherCandidates()).map((candidate) => connectedTeacherSummary(candidate, sessionId)),
      });
    } catch (err) {
      log.error("connected-teachers.list-failed", err, { sessionId });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // GET /packs — list packs visible to this session (built-ins + own
  // session-scoped packs). Other users' packs are filtered out.
  if (ctx.method === "GET" && sub === "/") {
    ctx.json(ctx.res, {
      active_pack_id: packForSession(state).id,
      packs: availablePacksForSession(sessionId).map(packSummary),
    });
    return true;
  }

  // POST /packs/active — switch THIS session's active pack.
  if (ctx.method === "POST" && sub === "/active") {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { packId?: unknown } | null;
    const id = typeof body?.packId === "string" ? body.packId : "";
    if (!id) {
      ctx.error(ctx.res, "packId required", 400);
      return true;
    }
    const target = getPackByIdForSession(id, sessionId);
    if (!target) {
      // Same response for "doesn't exist" and "exists but isn't yours"
      // to avoid id-enumeration via differential responses.
      ctx.error(ctx.res, `Unknown pack id: ${id}`, 404);
      return true;
    }
    try {
      deps.ruby.setActivePackForSession(sessionId, id);
      await deps.ruby.flushSession(sessionId);
      log.event("pack.activated", { sessionId, packId: id, packName: target.name });
      ctx.json(ctx.res, { ok: true, pack: packSummary(target) });
    } catch (err) {
      log.error("pack.activate-failed", err, { sessionId, packId: id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  // POST /packs/connect-agent — materialize an allowlisted RATi/aws-swarm
  // avatar as this session's active teacher pack. The browser submits only a
  // model id; endpoint and credential remain server-side.
  if (ctx.method === "POST" && sub === "/connect-agent") {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as {
      model?: unknown;
      modelId?: unknown;
      agentId?: unknown;
      channelName?: unknown;
    } | null;
    const requested = [body?.model, body?.modelId, body?.agentId].find((value) => typeof value === "string" && value.trim());
    const modelId = typeof requested === "string" ? requested.trim() : "";
    if (!modelId) {
      ctx.error(ctx.res, "modelId required", 400);
      return true;
    }
    if (!ratiConfigured()) {
      ctx.error(ctx.res, "RATi teacher backend is not configured.", 503);
      return true;
    }
    try {
      const candidates = await listRatiTeacherCandidates();
      const candidate = candidates.find((entry) => entry.model === modelId || entry.root === modelId || entry.id === modelId);
      if (!candidate) {
        ctx.error(ctx.res, "Unknown connected teacher.", 404);
        return true;
      }
      if (connectedTeacherOwnedByAnotherSession(candidate, sessionId)) {
        log.event("connected-teacher.connect-denied", {
          sessionId,
          model: candidate.model,
          packId: connectedTeacherPackId(candidate),
          reason: "owned-by-another-session",
        });
        ctx.error(ctx.res, "This connected teacher is already owned by another Ruby High session.", 409);
        return true;
      }
      const importCandidate = await candidateWithReachableProfileImage(candidate);
      const questions = await generateConnectedTeacherQuestionBank(importCandidate);
      const requestedChannelName = typeof body?.channelName === "string" ? body.channelName : null;
      const pack = packForConnectedTeacher(importCandidate, questions, { channelName: requestedChannelName });
      registerPack(pack, sessionId);
      await deps.ruby.persistImportedPack(sessionId, pack);
      deps.ruby.setActivePackForSession(sessionId, pack.id);
      await deps.ruby.flushSession(sessionId);
      log.event("connected-teacher.activated", {
        sessionId,
        packId: pack.id,
        model: candidate.model,
        provider: candidate.provider,
        generatedQuestions: questions.length,
      });
      ctx.json(ctx.res, { ok: true, pack: packSummary(pack), teacher: candidate });
    } catch (err) {
      log.error("connected-teacher.connect-failed", err, { sessionId, modelId });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  return false;
}
