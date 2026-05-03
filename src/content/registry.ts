/**
 * Content pack registry. The active pack is the source of truth for
 * which faculty + rooms + question banks a session sees.
 *
 * Two access patterns:
 *  - global: getActivePack / activeFaculty / activeRoomForFaculty —
 *    returns whatever the GLOBAL active pack is. Used by code paths
 *    that don't have a session in scope (boot, listFaculty diagnostics).
 *  - per-session: packForSession / facultyForSession /
 *    roomForFacultyForSession — resolves against state.activePackId
 *    with a fallback to the global active pack. This is what hot paths
 *    use so a future runtime pack switch (Anki / paid packs) flips
 *    only the relevant session's view.
 *
 * Today there's only one pack ("ruby-high-original"), so the per-session
 * helpers always resolve to it. The abstraction exists ahead of the
 * runtime pack adapters so they can land cleanly.
 */

import type { ContentPack, PackFaculty, PackRoom } from "./types.js";
import { getRubyHighOriginal } from "./packs/ruby-high-original.js";

/** Stable id of the built-in pack. Used as the fallback / pin / "are we
 *  on the original schedule" signal in places that special-case it. */
export const ORIGINAL_PACK_ID = "ruby-high-original";

let active: Promise<ContentPack> | null = null;
/** Sync mirror of the resolved pack. Populated when the async getActivePack
 *  promise settles. Sync callers (telemetry derivation, render handlers)
 *  read this; they're called after FacultyService.start has already
 *  awaited getActivePack, so the cache is reliably populated by the time
 *  HTTP requests start landing. */
let loadedPack: ContentPack | null = null;

/** Returns the currently active pack. Cached after first call. */
export function getActivePack(): Promise<ContentPack> {
  if (!active) active = getRubyHighOriginal().then((p) => { loadedPack = p; return p; });
  return active;
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

/** Override the active pack. For tests + future runtime pack switching. */
export function setActivePack(pack: ContentPack): void {
  loadedPack = pack;
  active = Promise.resolve(pack);
}

/** Reset the cache so the next getActivePack() reloads fresh. Test-only. */
export function resetActivePack(): void {
  active = null;
  loadedPack = null;
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

// ── per-session pack lookup ─────────────────────────────────────────────
// Per-session active pack: each QuizState carries an activePackId. These
// helpers resolve "which pack does THIS session see?" — the global active
// pack is used only as a fallback when the session is null or its
// activePackId points at an unregistered pack.

interface PackSession { activePackId?: string | null }

/** Resolve the pack for a given session. Falls back to the global active
 *  pack when the session is null OR its activePackId doesn't match a
 *  registered pack — so an evicted/stale id never breaks reads. */
export function packForSession(session: PackSession | null): ContentPack {
  // Today only one pack is registered, so the fallback always lands on
  // the original. Once Phase C lands the multi-pack registry, this
  // method becomes the actual per-session resolver.
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
