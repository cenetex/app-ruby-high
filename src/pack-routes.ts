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
  packForSession,
} from "./content/registry.js";
import type { ContentPack } from "./content/types.js";

export interface PackRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  res: unknown;
  cookieHeader?: string | null;
  contentTypeHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
  callbackUrlBuilder?: (path: string) => string;
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

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function packOriginAllowed(ctx: PackRouteContext): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidates = [
      ctx.callbackUrlBuilder ? ctx.callbackUrlBuilder("/") : null,
      ctx.url?.origin ?? null,
    ].filter(Boolean) as string[];
    if (candidates.length === 0) return true;
    return candidates.some((candidate) => {
      const candidateUrl = new URL(candidate);
      return candidateUrl.origin === originUrl.origin
        || (originUrl.protocol === "https:" && candidateUrl.host === originUrl.host);
    });
  } catch {
    return false;
  }
}

function packRequestLooksLikeJson(ctx: PackRouteContext): boolean {
  const contentType = firstHeader(ctx.contentTypeHeader).toLowerCase();
  return !contentType || contentType.startsWith("application/json");
}

function rejectBadPackMutationRequest(ctx: PackRouteContext): boolean {
  if (ctx.method === "GET" || ctx.method === "HEAD") return false;
  if (!packRequestLooksLikeJson(ctx)) {
    ctx.error(ctx.res, "Pack requests must be sent as JSON.", 415);
    return true;
  }
  if (!packOriginAllowed(ctx)) {
    ctx.error(ctx.res, "Pack request origin is not allowed.", 403);
    return true;
  }
  return false;
}

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
      ...(f.xHandle ? { xHandle: f.xHandle } : {}),
      ...(f.stats ? { stats: f.stats } : {}),
      subjects: f.subjects,
      questionCount: countFacultyCards(f),
    })),
  };
}

export async function handlePackRoutes(
  ctx: PackRouteContext,
  deps: PackRouteDeps,
): Promise<boolean> {
  const isPackRoute = ctx.pathname.startsWith(PACK_PREFIX);
  if (!isPackRoute) return false;
  if (rejectBadPackMutationRequest(ctx)) return true;
  const sub = ctx.pathname.slice(PACK_PREFIX.length) || "/";

  // Every endpoint requires a signed-in session — pack management is
  // per-user territory and we don't want unauthed callers enumerating
  // registered pack ids or mutating session state.
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!record || !token) {
    ctx.error(ctx.res, "Sign in to manage packs.", 401);
    return true;
  }
  const sessionId = deps.sessionIdFor(ctx.cookieHeader);
  const state = deps.ruby.getOrCreate(sessionId);

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

  return false;
}
