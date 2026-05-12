/**
 * Content pack — a swappable bundle of teachers + rooms + question banks
 * that drives a single Ruby High experience. The shipped product is one
 * pack at a time (the player picks which one they're playing). Future
 * surfaces (a pack store, connected teachers, paid SAT/MCAT packs,
 * LLM-generated packs) all materialize as ContentPack instances.
 *
 * A pack owns:
 *   - a small set of courses (what is being taught)
 *   - matching faculty instances (who teaches each course + bank inline)
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
 * cache in localStorage, or generate at runtime.
 */

import type { BankedQuestion, Difficulty } from "../types.js";

export interface ContentPack {
  /** Stable identifier — used as a key in the pack registry / per-player
   *  entitlement / persisted in session state when packs become switchable. */
  id: string;
  name: string;
  description: string;
  /** Semver of the pack contents. Bumping a pack version invalidates any
   *  cached question state for it on the client. */
  version: string;
  /** Faculty members. Each has its own chat persona + question bank. */
  faculty: PackFaculty[];
  /** Course layer: separates "what is being taught" from reusable teacher
   *  templates such as Ruby/Sally/Edward. Optional for legacy persisted packs;
   *  registry helpers derive courses from faculty+rooms when absent. */
  courses?: PackCourse[];
  /** Channel rail definitions. Should match faculty IDs (one room per
   *  teaching faculty + one lounge entry per pack). */
  rooms: PackRoom[];
}

export interface PackCourse {
  /** Stable course instance id. For the first refactor slice this usually
   *  matches `facultyId`; keeping it separate lets future packs have
   *  multiple courses taught by the same teacher template. */
  id: string;
  title: string;
  /** The active faculty/course-instance id that owns prompt + bank today. */
  facultyId: string;
  /** Room/channel for this course. */
  roomId: string;
  /** Reusable teacher template: ruby, sally-science, professor-edward, etc. */
  teacherTemplateId?: string;
  /** Question subjects covered by this course. */
  subjects: string[];
}

export interface PackFaculty {
  // ── identity ──────────────────────────────────────────────────────────
  id: string;
  displayName: string;
  shortName: string;
  /** Optional built-in teacher asset id used for portraits when a generated
   *  pack borrows an existing teacher's face/figure but keeps a unique id. */
  assetTeacherId?: string;
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
  /** Raw source cards. Connected/generated packs can keep these cheap by default:
   *  the player can type answers immediately, and MC distractors are
   *  generated/cached later only when explicitly requested. */
  sourceCards?: PackSourceCard[];
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

export interface PackMediaAsset {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface PackSourceCard {
  id: string;
  kind: "basic" | "image-occlusion";
  front: string;
  back: string;
  /** Optional raw field HTML retained for media/image detection. The viewer
   *  still receives sanitized structured media, not this HTML. */
  frontHtml?: string;
  backHtml?: string;
  acceptedAnswers: string[];
  deckName: string;
  tags: string[];
  subject: string;
  difficulty: Difficulty;
  faculty: string;
  media?: PackMediaAsset[];
}
