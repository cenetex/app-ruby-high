/**
 * Content pack registry. The active pack is the single source of truth
 * for which faculty + rooms + question banks the system serves.
 *
 * Today: hardcoded to "ruby-high-original" — there's only one pack. The
 * surface is shaped as if there were many so future work (pack store,
 * Anki imports, paid packs) doesn't have to thread a new abstraction
 * back through every consumer.
 */

import type { ContentPack, PackFaculty, PackRoom } from "./types.js";
import { getRubyHighOriginal } from "./packs/ruby-high-original.js";

/** Stable id of the built-in pack. Used as the fallback / pin / "are we
 *  on the original schedule" signal in places that special-case it. */
export const ORIGINAL_PACK_ID = "ruby-high-original";

/** Pack-id builder for Anki imports. Keeps the `anki:` prefix in one
 *  place — useful for any future "is this a runtime-imported pack?"
 *  check. */
export function ankiPackId(slug: string): string {
  return `anki:${slug}`;
}

/** Registry of every pack the runtime knows about. Keyed by pack id.
 *  Populated lazily — the original pack lands on first getActivePack();
 *  user-imported packs (Anki, etc.) get registered via registerPack.
 *  Soft-capped LRU: when MAX_PACKS is reached, the least-recently
 *  registered/touched pack is evicted to keep memory bounded under
 *  pathological re-import loops. The original pack is pinned. */
const packs = new Map<string, ContentPack>();
const MAX_PACKS = 32;
const PINNED_PACK_IDS = new Set<string>([ORIGINAL_PACK_ID]);

function touch(id: string, pack: ContentPack): void {
  // Map preserves insertion order — re-inserting moves the entry to
  // the end, so the iteration order doubles as LRU.
  packs.delete(id);
  packs.set(id, pack);
  while (packs.size > MAX_PACKS) {
    // Evict the oldest non-pinned pack.
    let evicted = false;
    for (const [k] of packs) {
      if (PINNED_PACK_IDS.has(k)) continue;
      packs.delete(k);
      evicted = true;
      break;
    }
    if (!evicted) break; // every remaining pack is pinned
  }
}
let active: Promise<ContentPack> | null = null;
/** Sync mirror of the resolved pack. Populated when the async getActivePack
 *  promise settles. Sync callers (telemetry derivation, render handlers)
 *  read this; they're called after FacultyService.start has already
 *  awaited getActivePack, so the cache is reliably populated by the time
 *  HTTP requests start landing. */
let loadedPack: ContentPack | null = null;

/** Returns the currently active pack. Cached after first call. */
export function getActivePack(): Promise<ContentPack> {
  if (!active) {
    active = getRubyHighOriginal().then((p) => {
      touch(p.id, p);
      loadedPack = p;
      return p;
    });
  }
  return active;
}

/** Register a pack so it shows up in availablePacks() + can be activated
 *  by id. Runtime imports (Anki, LLM-generated, etc.) call this. Goes
 *  through the LRU touch so re-registers move the pack to the end and
 *  pathological import loops can't blow up the registry size. */
export function registerPack(pack: ContentPack): void {
  touch(pack.id, pack);
}

/** All packs currently known to the runtime (original + any imports). */
export function availablePacks(): ContentPack[] {
  return Array.from(packs.values());
}

export function getPackById(id: string): ContentPack | null {
  return packs.get(id) ?? null;
}

/** Switch the active pack to one already registered. Throws if the pack
 *  id isn't known — register it first. */
export function setActivePackById(id: string): ContentPack {
  const pack = packs.get(id);
  if (!pack) {
    const known = Array.from(packs.keys()).join(", ") || "(none)";
    throw new Error(`Unknown pack id: ${id}. Registered packs: ${known}`);
  }
  loadedPack = pack;
  active = Promise.resolve(pack);
  return pack;
}

/** Sync access to the active pack. Throws if no pack has been loaded yet —
 *  callers that hit this before app startup completes have a boot-order
 *  bug, not a data bug, and should be loud about it. */
export function getLoadedPack(): ContentPack {
  if (!loadedPack) {
    throw new Error("Active pack not loaded — call getActivePack() before any sync pack reads.");
  }
  return loadedPack;
}

/** True when the active pack has finished resolving and is sync-readable. */
export function isPackLoaded(): boolean {
  return loadedPack !== null;
}

/** Override the active pack with an inline pack object. Used by tests
 *  and the runtime import path (Anki adapter). The pack is also
 *  registered so it shows up in availablePacks(). */
export function setActivePack(pack: ContentPack): void {
  touch(pack.id, pack);
  loadedPack = pack;
  active = Promise.resolve(pack);
}

/** Reset the cache so the next getActivePack() reloads fresh. Test-only. */
export function resetActivePack(): void {
  active = null;
  loadedPack = null;
  packs.clear();
}

// ── per-session pack lookup ─────────────────────────────────────────────
// Per-session active pack: each QuizState carries an activePackId. These
// helpers resolve "which pack does THIS session see?" — the global active
// pack is used only as a fallback when the session is null or its
// activePackId points at an unregistered (e.g. evicted) pack.

interface PackSession { activePackId?: string | null }

export function packForSession(session: PackSession | null): ContentPack {
  if (session?.activePackId) {
    const p = packs.get(session.activePackId);
    if (p) return p;
  }
  return getLoadedPack();
}

export function facultyForSession(session: PackSession | null): PackFaculty[] {
  return packForSession(session).faculty;
}

export function facultyByIdForSession(session: PackSession | null, id: string): PackFaculty | null {
  return packForSession(session).faculty.find((f) => f.id === id) ?? null;
}

export function roomsForSession(session: PackSession | null): PackRoom[] {
  return packForSession(session).rooms;
}

export function roomForFacultyForSession(session: PackSession | null, facultyId: string): PackRoom | null {
  return packForSession(session).rooms.find((r) => r.teacherId === facultyId) ?? null;
}

export function roomsWithLoungeForSession(session: PackSession | null): PackRoom[] {
  return [...packForSession(session).rooms, LOUNGE_ROOM];
}

// ── back-compat: global accessors ───────────────────────────────────────
// These look up the GLOBAL active pack (no session). Used by code paths
// that don't have a session in scope (boot, listFaculty diagnostics).
// Per-session callers should use the *ForSession variants above.

export function activeFaculty(): PackFaculty[] {
  return getLoadedPack().faculty;
}

export function activeFacultyById(id: string): PackFaculty | null {
  return getLoadedPack().faculty.find((f) => f.id === id) ?? null;
}

export function activeRooms(): PackRoom[] {
  return getLoadedPack().rooms;
}

/** The teaching room that this faculty teaches in, per the GLOBAL active
 *  pack. Per-session callers should prefer roomForFacultyForSession. */
export function activeRoomForFaculty(facultyId: string): PackRoom | null {
  return getLoadedPack().rooms.find((r) => r.teacherId === facultyId) ?? null;
}

/** The universal lounge entry — every pack ships with the same lounge
 *  channel (the faculty hangout). Lives outside the pack so a pack
 *  author doesn't have to remember to add it. */
export const LOUNGE_ROOM: PackRoom = {
  id: "lounge",
  name: "Teachers' Lounge",
  channelName: "lounge",
  teacherId: null,
  description: "Where the faculty hang out between periods. Eavesdrop only.",
  teaches: false,
};

/** All rooms in the active pack PLUS the universal lounge. The shape
 *  the channels rail + telemetry want. */
export function activeRoomsWithLounge(): PackRoom[] {
  return [...getLoadedPack().rooms, LOUNGE_ROOM];
}
