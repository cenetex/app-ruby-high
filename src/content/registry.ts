/**
 * Content pack registry.
 *
 * Two layers of state:
 *
 *  1. The GLOBAL active pack (the original/built-in). Loaded once at
 *     app boot. Sync-readable via getLoadedPack(); drives every code
 *     path that doesn't have a session in scope (boot, listFaculty
 *     diagnostics, telemetry default).
 *
 *  2. The MULTI-PACK REGISTRY — a Map<packId, RegisteredPack>. Holds
 *     the built-in pack PLUS any runtime-registered packs (imported,
 *     generated, paid). Each entry is tagged with an owner so
 *     session-scoped packs only show up for the owner.
 *
 * Per-session resolution: legacy/imported sessions may still carry an
 * activePackId. Normal Ruby High play composes the permanent built-in pack
 * with one creator-pack Guest Faculty slot selected by auto weekly rotation
 * or user override.
 *
 * Built-in packs are pinned (never evicted; can't be overwritten by a
 * runtime registerPack call). Session-scoped packs evict LRU per-owner
 * past MAX_PACKS_PER_OWNER.
 */

import type { BankedQuestion } from "../types.js";
import type { ContentPack, PackCourse, PackFaculty, PackRoom } from "./types.js";
import { getRubyHighOriginal } from "./packs/ruby-high-original.js";

/** Stable id of the built-in pack. */
export const ORIGINAL_PACK_ID = "ruby-high-original";
export const GUEST_COURSE_ID = "guest";
export const GUEST_ROOM_ID = "guest-room";
export const GUEST_CHANNEL_NAME = "guest";

/** Per-owner soft cap on registered packs. When an owner exceeds this,
 *  their oldest pack evicts. Built-in packs (owner=null) are PINNED and
 *  never count toward the cap or get evicted. */
export const MAX_PACKS_PER_OWNER = 16;

interface RegisteredPack {
  pack: ContentPack;
  /** Session id of the user who registered this pack. null = built-in,
   *  visible to everyone, never evicted. */
  ownerSessionId: string | null;
  /** Insertion / re-touch timestamp. Used as the LRU tiebreaker. */
  touchedAt: number;
}

const packs = new Map<string, RegisteredPack>();
let active: Promise<ContentPack> | null = null;
/** Sync mirror of the resolved global pack. Populated when the
 *  getActivePack promise settles. Sync callers (telemetry, render
 *  handlers) read this; they're called after FacultyService.start has
 *  awaited getActivePack, so by the time HTTP requests start landing,
 *  the cache is populated. */
let loadedPack: ContentPack | null = null;

function touch(id: string, pack: ContentPack, ownerSessionId: string | null, touchedAt = Date.now()): void {
  // Map preserves insertion order — re-inserting moves the entry to
  // the end, so iteration order doubles as LRU.
  packs.delete(id);
  packs.set(id, { pack, ownerSessionId, touchedAt });
  if (ownerSessionId !== null) evictExcess(ownerSessionId);
}

function evictExcess(ownerSessionId: string): void {
  // Count this owner's packs; if over the cap, evict their oldest first.
  const owned = Array.from(packs.entries())
    .filter(([, r]) => r.ownerSessionId === ownerSessionId);
  if (owned.length <= MAX_PACKS_PER_OWNER) return;
  // owned is in insertion order; the oldest is owned[0].
  const toEvict = owned.length - MAX_PACKS_PER_OWNER;
  for (let i = 0; i < toEvict; i++) packs.delete(owned[i]![0]);
}

/** Returns the global active pack. Cached after first call. */
export function getActivePack(): Promise<ContentPack> {
  if (!active) {
    active = getRubyHighOriginal().then((p) => {
      // Built-in: owner=null, pinned forever.
      packs.set(p.id, { pack: p, ownerSessionId: null, touchedAt: Date.now() });
      loadedPack = p;
      return p;
    });
  }
  return active;
}

/** Sync access to the global active pack. Throws if no pack has been
 *  loaded yet — callers that hit this before app startup completes have
 *  a boot-order bug, not a data bug. */
export function getLoadedPack(): ContentPack {
  if (!loadedPack) {
    throw new Error("Active pack not loaded — call getActivePack() before any sync pack reads.");
  }
  return loadedPack;
}

/** True when the global active pack has finished resolving. */
export function isPackLoaded(): boolean {
  return loadedPack !== null;
}

/** Override the GLOBAL active pack with an inline pack object. Used by
 *  tests + the runtime built-in swap (rare). The pack is registered as
 *  a built-in (owner=null, pinned). */
export function setActivePack(pack: ContentPack): void {
  packs.set(pack.id, { pack, ownerSessionId: null, touchedAt: Date.now() });
  loadedPack = pack;
  active = Promise.resolve(pack);
}

/** Trusted server-side mutation for extending a pack's inline bank. Runtime
 *  pack creation still goes through registerPack(); this path is for the app itself
 *  promoting teacher-authored Ruby High questions into the reusable bank. */
export function appendQuestionToPackBank(
  packId: string,
  facultyId: string,
  question: BankedQuestion,
  touchedAt = Date.now(),
): ContentPack | null {
  const record = packs.get(packId);
  if (!record) return null;
  const faculty = record.pack.faculty.find((f) => f.id === facultyId);
  if (!faculty) return null;
  if (!faculty.questions.some((q) => q.id === question.id)) {
    faculty.questions.push(question);
  }
  record.touchedAt = touchedAt;
  packs.delete(packId);
  packs.set(packId, record);
  if (record.ownerSessionId !== null) evictExcess(record.ownerSessionId);
  if (loadedPack?.id === packId) loadedPack = record.pack;
  return record.pack;
}

/** Reset the entire registry. Test-only. */
export function resetActivePack(): void {
  active = null;
  loadedPack = null;
  packs.clear();
}

// ── multi-pack registry ─────────────────────────────────────────────────

/** Register a pack so it shows up in availablePacksForSession + can be
 *  activated. Refuses to overwrite a built-in (pinned) pack id —
 *  session-scoped packs can't replace the original. Re-registering a
 *  previously registered pack re-touches it (moves to end of LRU). */
export function registerPack(pack: ContentPack, ownerSessionId: string, touchedAt = Date.now()): void {
  const existing = packs.get(pack.id);
  if (existing && existing.ownerSessionId === null) {
    throw new Error(`Cannot overwrite pinned built-in pack: ${pack.id}`);
  }
  if (existing && existing.ownerSessionId !== ownerSessionId) {
    throw new Error(`Pack ${pack.id} is owned by another session — cannot re-register.`);
  }
  touch(pack.id, pack, ownerSessionId, touchedAt);
}

/** Publish a runtime pack globally. Public teacher packs use owner=null so
 *  they are visible to every session, but they are not the same as the
 *  legacy built-in active pack. Callers may promote their own private draft
 *  pack by passing the expected owner session id. */
export function registerPublicPack(
  pack: ContentPack,
  touchedAt = Date.now(),
  opts: { ownerSessionId?: string | null; allowGlobalOverwrite?: boolean } = {},
): void {
  const existing = packs.get(pack.id);
  if (existing) {
    if (existing.ownerSessionId !== null && existing.ownerSessionId !== opts.ownerSessionId) {
      throw new Error(`Pack ${pack.id} is owned by another session — cannot publish.`);
    }
    if (existing.ownerSessionId === null && pack.id === ORIGINAL_PACK_ID) {
      throw new Error(`Cannot overwrite pinned built-in pack: ${pack.id}`);
    }
    if (existing.ownerSessionId === null && !pack.id.startsWith("teacher:") && !opts.allowGlobalOverwrite) {
      throw new Error(`Cannot overwrite global pack: ${pack.id}`);
    }
  }
  touch(pack.id, pack, null, touchedAt);
}

/** Remove a runtime pack from the in-memory registry. Built-in packs stay
 * pinned and cannot be deleted through this helper. */
export function unregisterPack(packId: string): boolean {
  if (packId === ORIGINAL_PACK_ID) return false;
  return packs.delete(packId);
}

/** All packs the given session can see: built-ins + this session's own
 *  session-scoped packs. Other users' packs are filtered out. */
export function availablePacksForSession(sessionId: string | null): ContentPack[] {
  return Array.from(packs.values())
    .filter((r) => r.ownerSessionId === null || r.ownerSessionId === sessionId)
    .map((r) => r.pack);
}

/** Look up a pack by id with ownership check. Returns null if the pack
 *  exists but isn't visible to this session — same as "not found" from
 *  the caller's perspective, so a malicious id-guess gets the same
 *  response as a bad id. */
export function getPackByIdForSession(packId: string, sessionId: string | null): ContentPack | null {
  const r = packs.get(packId);
  if (!r) return null;
  if (r.ownerSessionId !== null && r.ownerSessionId !== sessionId) return null;
  return r.pack;
}

/** Ownership lookup for trusted route logic. Returns undefined when the pack
 *  is unknown, null for built-ins, or the owning session id for scoped packs. */
export function packOwnerSessionId(packId: string): string | null | undefined {
  return packs.get(packId)?.ownerSessionId;
}

// ── sync accessors over the loaded pack ─────────────────────────────────
// Used by code paths that don't have a session in scope. Per-session
// callers should prefer the *ForSession variants below.

export function activeFaculty(): PackFaculty[] {
  return getLoadedPack().faculty;
}

export function activeFacultyById(id: string): PackFaculty | null {
  return getLoadedPack().faculty.find((f) => f.id === id) ?? null;
}

export function activeRooms(): PackRoom[] {
  return getLoadedPack().rooms;
}

export function activeRoomForFaculty(facultyId: string): PackRoom | null {
  return getLoadedPack().rooms.find((r) => r.teacherId === facultyId) ?? null;
}

/** The universal lounge entry — every pack ships with the same lounge
 *  channel. Lives outside the pack so a pack author doesn't have to
 *  remember to add it. */
export const LOUNGE_ROOM: PackRoom = {
  id: "lounge",
  name: "Teachers' Lounge",
  channelName: "lounge",
  teacherId: null,
  description: "Where the faculty hang out between periods. Eavesdrop only.",
  teaches: false,
};

export function activeRoomsWithLounge(): PackRoom[] {
  return [...getLoadedPack().rooms, LOUNGE_ROOM];
}

// ── per-session pack lookup ─────────────────────────────────────────────
// Each QuizState carries an activePackId. These helpers resolve "which
// pack does THIS session see?" — falls back to the global active pack
// when the session is null or its activePackId points at an unregistered
// pack.

export type GuestPackMode = "auto" | "override";

interface PackSession {
  sessionId?: string | null;
  activePackId?: string | null;
  guestPackMode?: GuestPackMode | null;
  guestPackOverrideId?: string | null;
}

/** Resolve the pack for a given session. Falls back to the global
 *  active pack when the session is null OR its activePackId doesn't
 *  match a registered pack (e.g. evicted) or points at another session's
 *  private pack — so a stranded or malformed id never breaks reads or
 *  crosses pack ownership boundaries. */
export function packForSession(session: PackSession | null): ContentPack {
  if (session?.activePackId && session.activePackId !== ORIGINAL_PACK_ID) {
    const r = packs.get(session.activePackId);
    if (r && (r.ownerSessionId === null || r.ownerSessionId === session.sessionId)) return r.pack;
  }
  const base = getLoadedPack();
  const guest = guestPackForSession(session);
  return guest ? composeGuestPack(base, guest) : base;
}

export function guestWeekKey(date = new Date()): string {
  const time = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(time).getUTCDay() || 7;
  const monday = time - (day - 1) * 24 * 60 * 60 * 1000;
  const d = new Date(monday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.floor((monday - yearStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function publicCreatorPacks(): ContentPack[] {
  return Array.from(packs.values())
    .filter((r) =>
      r.ownerSessionId === null &&
      r.pack.id !== ORIGINAL_PACK_ID &&
      (r.pack.id.startsWith("pack:") || r.pack.id.startsWith("teacher:"))
    )
    .map((r) => r.pack)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function weeklyAutoGuestPack(date = new Date()): ContentPack | null {
  const candidates = publicCreatorPacks().filter((pack) => guestFacultyForPack(pack) !== null);
  if (candidates.length === 0) return null;
  const key = guestWeekKey(date);
  return candidates[hashString(key) % candidates.length] ?? null;
}

export function guestPackForSession(session: PackSession | null, date = new Date()): ContentPack | null {
  if (!session) return null;
  if (session?.activePackId && session.activePackId !== ORIGINAL_PACK_ID) return null;
  if (session?.guestPackMode === "override" && session.guestPackOverrideId) {
    const record = packs.get(session.guestPackOverrideId);
    if (record && record.ownerSessionId === null && record.pack.id !== ORIGINAL_PACK_ID) {
      return guestFacultyForPack(record.pack) ? record.pack : null;
    }
  }
  return weeklyAutoGuestPack(date);
}

export function guestFacultyForPack(pack: ContentPack): PackFaculty | null {
  return pack.faculty.find((f) => f.questions.length > 0 || (f.sourceCards?.length ?? 0) > 0)
    ?? pack.faculty[0]
    ?? null;
}

function composeGuestPack(base: ContentPack, guestPack: ContentPack): ContentPack {
  const sourceFaculty = guestFacultyForPack(guestPack);
  if (!sourceFaculty) return base;
  const sourceCourse = coursesForPack(guestPack).find((c) => c.facultyId === sourceFaculty.id);
  const sourceRoom = guestPack.rooms.find((r) => r.teacherId === sourceFaculty.id);
  const questionPrefix = `guest:${slugForId(guestPack.id)}:`;
  const guestFaculty: PackFaculty = {
    ...sourceFaculty,
    id: GUEST_COURSE_ID,
    questions: sourceFaculty.questions.map((q) => ({
      ...q,
      id: prefixedId(questionPrefix, q.id),
      faculty: GUEST_COURSE_ID,
      sourceCardId: q.sourceCardId ? prefixedId(questionPrefix, q.sourceCardId) : q.sourceCardId,
    })),
    sourceCards: sourceFaculty.sourceCards?.map((card) => ({
      ...card,
      id: prefixedId(questionPrefix, card.id),
      faculty: GUEST_COURSE_ID,
    })),
  };
  const baseCourses = coursesForPack(base);
  return {
    ...base,
    id: `${base.id}+guest:${slugForId(guestPack.id)}`,
    name: base.name,
    description: `${base.description} Guest faculty: ${guestPack.name}.`,
    faculty: [
      ...base.faculty.filter((f) => f.id !== GUEST_COURSE_ID),
      guestFaculty,
    ],
    courses: [
      ...baseCourses.filter((c) => c.id !== GUEST_COURSE_ID && c.facultyId !== GUEST_COURSE_ID),
      {
        id: GUEST_COURSE_ID,
        title: "Guest Faculty",
        facultyId: GUEST_COURSE_ID,
        roomId: GUEST_ROOM_ID,
        teacherTemplateId: sourceCourse?.teacherTemplateId ?? sourceFaculty.assetTeacherId,
        subjects: sourceCourse?.subjects?.length ? sourceCourse.subjects : sourceFaculty.subjects,
      },
    ],
    rooms: [
      ...base.rooms.filter((r) => r.id !== GUEST_ROOM_ID && r.teacherId !== GUEST_COURSE_ID),
      {
        id: GUEST_ROOM_ID,
        name: sourceRoom?.name ?? sourceFaculty.displayName,
        channelName: GUEST_CHANNEL_NAME,
        teacherId: GUEST_COURSE_ID,
        description: sourceRoom?.description ?? sourceFaculty.bio,
        teaches: true,
      },
    ],
  };
}

function prefixedId(prefix: string, id: string): string {
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function slugForId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "pack";
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function coursesForPack(pack: ContentPack): PackCourse[] {
  if (pack.courses && pack.courses.length > 0) return pack.courses;
  return pack.faculty.map((f) => {
    const room = pack.rooms.find((r) => r.teacherId === f.id);
    return {
      id: f.id,
      title: room?.name ?? f.displayName,
      facultyId: f.id,
      roomId: room?.id ?? f.id,
      teacherTemplateId: f.assetTeacherId ?? builtinTeacherTemplateId(f.id),
      subjects: f.subjects,
    };
  });
}

function builtinTeacherTemplateId(id: string): string | undefined {
  return id === "ruby" || id === "sally-science" || id === "professor-edward"
    ? id
    : undefined;
}

export function coursesForSession(session: PackSession | null): PackCourse[] {
  return coursesForPack(packForSession(session));
}

export function courseByIdForSession(session: PackSession | null, id: string): PackCourse | null {
  return coursesForSession(session).find((c) => c.id === id) ?? null;
}

export function courseForFacultyForSession(session: PackSession | null, facultyId: string): PackCourse | null {
  return coursesForSession(session).find((c) => c.facultyId === facultyId) ?? null;
}

export function resolveFacultyIdForSession(session: PackSession | null, requestedId: string): string | null {
  const pack = packForSession(session);
  if (pack.faculty.some((f) => f.id === requestedId)) return requestedId;

  const byCourse = coursesForPack(pack).filter((c) =>
    c.id === requestedId ||
    c.facultyId === requestedId ||
    c.teacherTemplateId === requestedId
  );
  const byFacultyAsset = pack.faculty.filter((f) => f.assetTeacherId === requestedId);
  const candidates = new Set<string>([
    ...byCourse.map((c) => c.facultyId),
    ...byFacultyAsset.map((f) => f.id),
  ]);
  return candidates.size === 1 ? Array.from(candidates)[0]! : null;
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
