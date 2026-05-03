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

/** Registry of every pack the runtime knows about. Keyed by pack id.
 *  Populated lazily — the original pack lands on first getActivePack();
 *  user-imported packs (Anki, etc.) get registered via registerPack. */
const packs = new Map<string, ContentPack>();
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
      packs.set(p.id, p);
      loadedPack = p;
      return p;
    });
  }
  return active;
}

/** Register a pack so it shows up in availablePacks() + can be activated
 *  by id. Runtime imports (Anki, LLM-generated, etc.) call this. */
export function registerPack(pack: ContentPack): void {
  packs.set(pack.id, pack);
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
  packs.set(pack.id, pack);
  loadedPack = pack;
  active = Promise.resolve(pack);
}

/** Reset the cache so the next getActivePack() reloads fresh. Test-only. */
export function resetActivePack(): void {
  active = null;
  loadedPack = null;
  packs.clear();
}

// ── sync accessors over the loaded pack ─────────────────────────────────
// These are the API callers reach for instead of touching ALL_FACULTY /
// ROOMS / RUBY_FACULTY constants directly. They go through getLoadedPack
// so a future pack swap is observed everywhere consistently.

export function activeFaculty(): PackFaculty[] {
  return getLoadedPack().faculty;
}

export function activeFacultyById(id: string): PackFaculty | null {
  return getLoadedPack().faculty.find((f) => f.id === id) ?? null;
}

export function activeRooms(): PackRoom[] {
  return getLoadedPack().rooms;
}

/** The teaching room that this faculty teaches in, per the active pack.
 *  Pack-aware replacement for the static `roomForFaculty` in types.ts;
 *  callers should prefer this. Returns null for the lounge or any
 *  faculty without a teaching room. */
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
