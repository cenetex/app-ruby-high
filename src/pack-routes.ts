/**
 * /packs/* HTTP surface — content pack management.
 *
 *   POST /packs/import-anki   — upload an Anki .apkg (base64 in JSON body),
 *                               server parses it, calls OpenRouter for
 *                               distractors, registers the result as a
 *                               ContentPack, and activates it.
 *   POST /packs/active        — switch the active pack to one already
 *                               registered (by id).
 *   GET  /packs                — list registered packs + the active id.
 *
 * Auth: import requires a signed-in user (we use their OpenRouter key
 * for distractor generation). Switch + list don't require auth.
 *
 * Rate limit: import is gated by a separate slow-bucket (8 burst, 1 per
 * 30s) — distractor generation is a multi-call LLM job and a runaway
 * script could melt an OpenRouter quota fast.
 */

import { AuthService } from "./services/auth-service.js";
import { TokenBucket } from "./services/rate-limit.js";
import { log } from "./services/logger.js";
import { parseApkg } from "./content/anki/parse.js";
import { buildAnkiPack } from "./content/anki/pack.js";
import {
  availablePacks,
  getPackById,
  registerPack,
  setActivePackById,
  getLoadedPack,
} from "./content/registry.js";
import type { ContentPack } from "./content/types.js";

export interface PackRouteContext {
  method: string;
  pathname: string;
  res: unknown;
  cookieHeader?: string | null;
  clientIp?: string | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

const PACK_PREFIX = "/api/apps/ruby-high/packs";
const IMPORT_LIMITER = new TokenBucket(8, 1 / 30); // 8 burst, ~1 every 30s

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
    faculty: pack.faculty.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      shortName: f.shortName,
      subjects: f.subjects,
      questionCount: f.questions.length,
    })),
  };
}

/** Reload-on-pack-swap callback. The faculty service caches the active
 *  pack's banks at start; when the active pack changes the service has
 *  to re-load. Routes pass in this callback so we don't import the
 *  service directly (decouples this module). */
export interface PackRouteDeps {
  auth: AuthService;
  /** Called after a pack switch so dependent services rebuild caches. */
  onPackSwapped?: () => Promise<void> | void;
}

export async function handlePackRoutes(
  ctx: PackRouteContext,
  deps: PackRouteDeps,
): Promise<boolean> {
  if (!ctx.pathname.startsWith(PACK_PREFIX)) return false;
  const sub = ctx.pathname.slice(PACK_PREFIX.length) || "/";

  // GET /packs — list registered packs + active id.
  if (ctx.method === "GET" && sub === "/") {
    const active = getLoadedPack();
    ctx.json(ctx.res, {
      active_pack_id: active.id,
      packs: availablePacks().map(packSummary),
    });
    return true;
  }

  // POST /packs/active — switch active pack.
  if (ctx.method === "POST" && sub === "/active") {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { packId?: unknown } | null;
    const id = typeof body?.packId === "string" ? body.packId : "";
    if (!id) {
      ctx.error(ctx.res, "packId required", 400);
      return true;
    }
    const target = getPackById(id);
    if (!target) {
      ctx.error(ctx.res, `Unknown pack id: ${id}`, 404);
      return true;
    }
    try {
      const pack = setActivePackById(id);
      if (deps.onPackSwapped) await deps.onPackSwapped();
      log.event("pack.activated", { packId: pack.id, name: pack.name });
      ctx.json(ctx.res, { ok: true, pack: packSummary(pack) });
    } catch (err) {
      log.error("pack.activate-failed", err, { packId: id });
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  // POST /packs/import-anki — base64 .apkg → distractors → register + activate.
  if (ctx.method === "POST" && sub === "/import-anki") {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Sign in to import an Anki deck — distractor generation needs your OpenRouter key.", 401);
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
    } | null;
    const filename = typeof body?.filename === "string" ? body.filename : "deck.apkg";
    const dataB64 = typeof body?.data === "string" ? body.data : "";
    if (!dataB64) {
      ctx.error(ctx.res, "data (base64-encoded .apkg) required", 400);
      return true;
    }
    const maxCards = typeof body?.maxCards === "number" ? body.maxCards : 50;
    const packName = typeof body?.packName === "string" ? body.packName : undefined;

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(dataB64);
    } catch (err) {
      ctx.error(ctx.res, "data must be valid base64", 400);
      return true;
    }

    try {
      log.event("pack.import-anki.start", { filename, sizeKb: Math.round(bytes.length / 1024) });
      const deck = await parseApkg(bytes);
      if (deck.cards.length === 0) {
        ctx.error(ctx.res, "Deck has no cards — nothing to import.", 400);
        return true;
      }
      const { pack, skipped } = await buildAnkiPack(deck, {
        apiKey: record.apiKey,
        packName,
        maxCards,
      });
      if (pack.faculty[0]!.questions.length === 0) {
        ctx.error(ctx.res, "Distractor generation produced no usable questions. Check that your OpenRouter key has credit, then try again.", 502);
        return true;
      }
      registerPack(pack);
      setActivePackById(pack.id);
      if (deps.onPackSwapped) await deps.onPackSwapped();
      log.event("pack.import-anki.done", {
        packId: pack.id, deckName: deck.name, cardsImported: pack.faculty[0]!.questions.length, skipped,
      });
      ctx.json(ctx.res, {
        ok: true,
        pack: packSummary(pack),
        skipped,
        deck_name: deck.name,
      });
    } catch (err) {
      log.error("pack.import-anki.failed", err, { filename });
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
