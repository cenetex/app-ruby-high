/**
 * /packs/* HTTP surface — content pack management.
 *
 *   GET  /packs                — list packs visible to this session.
 *   POST /packs/active         — switch THIS session's active pack
 *                                (auth required).
 *   POST /packs/import-anki    — upload an Anki .apkg (base64 in JSON
 *                                body), server parses + generates
 *                                distractors, registers as the
 *                                IMPORTING SESSION'S pack, activates
 *                                it. Auth required.
 *
 * Auth: every mutation requires a signed-in user. Read (GET /packs) is
 * also auth-required so unauthed callers can't enumerate registered
 * pack ids.
 *
 * Privacy: imported packs are owned by the importing session — only
 * that session sees them in /packs and can activate them. Built-in
 * packs (the original) are visible to everyone.
 *
 * Rate limit: import is gated by a slow bucket (8 burst, 1 per 30s) —
 * distractor generation is multi-LLM-call and a runaway script could
 * melt an OpenRouter quota fast. Body cap of 16 MB prevents
 * 1 GB JSON DoS attempts.
 */

import { AuthService } from "./services/auth-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { TokenBucket } from "./services/rate-limit.js";
import { log } from "./services/logger.js";
import { parseApkg } from "./content/anki/parse.js";
import { buildAnkiPack } from "./content/anki/pack.js";
import { TEACHERS } from "./characters/teachers.js";
import {
  availablePacksForSession,
  coursesForPack,
  getPackByIdForSession,
  packForSession,
  registerPack,
} from "./content/registry.js";
import type { ContentPack } from "./content/types.js";

export interface PackRouteContext {
  method: string;
  pathname: string;
  res: unknown;
  cookieHeader?: string | null;
  /** Caller-provided OpenRouter key — passed as a header on each
   *  request, not stored server-side. Same pattern the chat layer uses. */
  apiKeyHeader?: string | null;
  clientIp?: string | null;
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
const IMPORT_LIMITER = new TokenBucket(8, 1 / 30); // 8 burst, ~1 every 30s

/** Hard cap on the JSON body size for /packs/import-anki. An Anki .apkg
 *  base64-inflates by ~33%, so this gives headroom for ~12 MB on-disk
 *  decks — bigger than any sensible single-deck import. The point isn't
 *  to size for typical use but to stop a 1 GB JSON DoS. */
const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;

// Drop idle limiter keys hourly so one-off imports from different IPs
// don't accumulate forever.
const importLimiterGcTimer = setInterval(() => {
  IMPORT_LIMITER.gc(Date.now());
}, 60 * 60 * 1000);
if (typeof importLimiterGcTimer === "object" && importLimiterGcTimer && "unref" in importLimiterGcTimer) {
  (importLimiterGcTimer as { unref: () => void }).unref();
}

function rateLimitKey(ctx: PackRouteContext, token: string | null): string {
  return `${ctx.clientIp ?? "unknown"}:${token ?? "anon"}`;
}

function packSummary(pack: ContentPack) {
  const questionCount = pack.faculty.reduce((s, f) => s + f.questions.length, 0);
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
      subjects: f.subjects,
      questionCount: f.questions.length,
    })),
  };
}

export async function handlePackRoutes(
  ctx: PackRouteContext,
  deps: PackRouteDeps,
): Promise<boolean> {
  if (!ctx.pathname.startsWith(PACK_PREFIX)) return false;
  const sub = ctx.pathname.slice(PACK_PREFIX.length) || "/";

  // Every endpoint requires a signed-in session — pack management is
  // per-user territory and we don't want unauthed callers enumerating
  // registered pack ids or mutating session state.
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  const record = deps.auth.resolve(token);
  if (!record || !token) {
    ctx.error(ctx.res, "Sign in to manage content packs.", 401);
    return true;
  }
  const sessionId = deps.sessionIdFor(ctx.cookieHeader);
  const state = deps.ruby.getOrCreate(sessionId);

  // GET /packs — list packs visible to this session (built-ins + own
  // imports). Other users' imports are filtered out.
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

  // POST /packs/import-anki — base64 .apkg → distractors → register +
  // set as THIS session's active pack.
  if (ctx.method === "POST" && sub === "/import-anki") {
    // Distractor generation calls OpenRouter on the user's behalf —
    // they need to send their key as a header (same pattern as chat).
    const apiKey = (ctx.apiKeyHeader ?? "").trim();
    if (!apiKey) {
      ctx.error(ctx.res, "OpenRouter API key required (send as Authorization or x-api-key header).", 400);
      return true;
    }
    const rlKey = rateLimitKey(ctx, token);
    if (!IMPORT_LIMITER.take(rlKey)) {
      const retryAfter = IMPORT_LIMITER.retryAfterSeconds(rlKey);
      ctx.error(ctx.res, `Too many imports — wait ${retryAfter}s and try again.`, 429);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as {
      filename?: unknown;
      data?: unknown;
      maxCards?: unknown;
      packName?: unknown;
      teacherId?: unknown;
    } | null;
    const filename = typeof body?.filename === "string" ? body.filename : "deck.apkg";
    const dataB64 = typeof body?.data === "string" ? body.data : "";
    if (!dataB64) {
      ctx.error(ctx.res, "data (base64-encoded .apkg) required", 400);
      return true;
    }
    // Fast-path body cap: reject before allocating the Buffer if the
    // base64 string is already over budget.
    if (dataB64.length > MAX_IMPORT_BODY_BYTES) {
      ctx.error(ctx.res, `Deck too large — base64 payload exceeds ${Math.round(MAX_IMPORT_BODY_BYTES / 1024 / 1024)} MB.`, 413);
      return true;
    }
    const maxCards = typeof body?.maxCards === "number" ? body.maxCards : 50;
    const packName = typeof body?.packName === "string" ? body.packName : undefined;
    const teacherId = typeof body?.teacherId === "string" ? body.teacherId : undefined;
    if (teacherId && !TEACHERS[teacherId]) {
      ctx.error(ctx.res, `Unknown teacher id: ${teacherId}`, 400);
      return true;
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(dataB64);
    } catch {
      ctx.error(ctx.res, "data must be valid base64", 400);
      return true;
    }
    if (bytes.length > MAX_IMPORT_BODY_BYTES) {
      ctx.error(ctx.res, `Deck too large — decoded payload exceeds ${Math.round(MAX_IMPORT_BODY_BYTES / 1024 / 1024)} MB.`, 413);
      return true;
    }

    try {
      log.event("pack.import-anki.start", { sessionId, filename, sizeKb: Math.round(bytes.length / 1024) });
      const deck = await parseApkg(bytes);
      if (deck.cards.length === 0) {
        ctx.error(ctx.res, "Deck has no cards — nothing to import.", 400);
        return true;
      }
      const { pack, skipped } = await buildAnkiPack(deck, {
        apiKey,
        packName,
        maxCards,
        teacherId,
      });
      const importedQuestionCount = pack.faculty.reduce((sum, f) => sum + f.questions.length, 0);
      if (importedQuestionCount === 0) {
        ctx.error(ctx.res, "Distractor generation produced no usable questions. Check that your OpenRouter key has credit, then try again.", 502);
        return true;
      }
      registerPack(pack, sessionId);
      await deps.ruby.persistImportedPack(sessionId, pack);
      deps.ruby.setActivePackForSession(sessionId, pack.id);
      await deps.ruby.flushSession(sessionId);
      log.event("pack.import-anki.done", {
        sessionId, packId: pack.id, deckName: deck.name,
        cardsImported: importedQuestionCount, classCount: pack.faculty.length, skipped, teacherId,
      });
      ctx.json(ctx.res, {
        ok: true,
        pack: packSummary(pack),
        skipped,
        deck_name: deck.name,
      });
    } catch (err) {
      log.error("pack.import-anki.failed", err, { sessionId, filename });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  return false;
}

function base64ToBytes(b64: string): Uint8Array {
  // Strip data: prefix if present (data:application/octet-stream;base64,...).
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const buf = Buffer.from(cleaned, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
