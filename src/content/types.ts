/**
 * Content pack — a swappable bundle of teachers + rooms + question banks
 * that drives a single Ruby High experience. The shipped product is one
 * pack at a time (the player picks which one they're playing). Future
 * surfaces (a pack store, Anki imports, paid SAT/MCAT packs, LLM-
 * generated packs) all materialize as ContentPack instances.
 *
 * A pack owns:
 *   - 1-3 faculty members (chat persona + question bank inline)
 *   - matching rooms (the channels rail)
 *
 * A pack does NOT own:
 *   - the lounge (universal — all packs share the lounge)
 *   - the AI student cohort (universal — Lyra/Sami/Ravi/Indra/Mika/Noor
 *     ride along regardless of which pack the player is in)
 *   - the dice/streak/XP mechanics (the structural game is constant)
 *
 * The shape is intentionally inline — bank questions live IN the
 * faculty entry, not in a separate file. This keeps a pack a single
 * portable object: trivial to ship from a CDN, embed at build time,
 * cache in localStorage, or generate at runtime (Anki adapter).
 */

import type { BankedQuestion } from "../types.js";

export interface ContentPack {
  /** Stable identifier — used as a key in the pack registry / per-player
   *  entitlement / persisted in session state when packs become switchable. */
  id: string;
  name: string;
  description: string;
  /** Semver of the pack contents. Bumping a pack version invalidates any
   *  cached question state for it on the client. */
  version: string;
  /** 1-3 faculty members. Each has its own chat persona + question bank. */
  faculty: PackFaculty[];
  /** Channel rail definitions. Should match faculty IDs (one room per
   *  teaching faculty + one lounge entry per pack). */
  rooms: PackRoom[];
}

export interface PackFaculty {
  // ── identity ──────────────────────────────────────────────────────────
  id: string;
  displayName: string;
  shortName: string;
  // ── metadata ──────────────────────────────────────────────────────────
  /** Subjects this teacher covers — surfaced in the UI as filter pills and
   *  fed to the chat layer for routing decisions. */
  subjects: string[];
  bio: string;
  /** Hex color for the channel pill, race-strip avatar, and accent
   *  highlights. */
  accent: string;
  // ── chat persona ──────────────────────────────────────────────────────
  /** The teacher's system prompt. The chat layer prepends shared rules
   *  (group-chat framing, tool surface) to this. */
  systemPrompt: string;
  /** OpenRouter model id. Cheap fast models work fine — chat is short
   *  and high-volume. */
  defaultModel: string;
  // ── question bank (inline) ────────────────────────────────────────────
  /** Inline question bank. Matches the existing BankedQuestion shape so
   *  pickQuestion / pickDaily logic doesn't change. */
  questions: BankedQuestion[];
}

export interface PackRoom {
  id: string;
  name: string;
  /** "#channelName" in the channels rail. */
  channelName: string;
  /** Matches a PackFaculty.id; null only for non-teaching rooms (lounge). */
  teacherId: string | null;
  description: string;
  /** Whether questions can be drawn here. False for the lounge. */
  teaches: boolean;
}
