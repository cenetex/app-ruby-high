/**
 * Content pack — a portable bundle of teachers + rooms + question banks.
 * Ruby High Original is the permanent base school. Creator packs now fill
 * the weekly Guest Faculty slot, while legacy/imported pack flows can still
 * resolve a single full-pack experience through activePackId.
 *
 * A pack owns:
 *   - a small set of courses (what is being taught)
 *   - matching faculty instances (who teaches each course + bank inline)
 *   - matching rooms (the channels rail)
 *
 * A pack does NOT own:
 *   - the lounge (universal — all packs share the lounge)
 *   - the AI student cohort (universal — Lyra/Sami/Ravi/Indra/Mika/Noor
 *     ride along regardless of which guest pack is active)
 *   - the dice/streak/XP mechanics (the structural game is constant)
 *
 * The shape is intentionally inline — bank questions live IN the
 * faculty entry, not in a separate file. This keeps a pack a single
 * portable object: trivial to ship from a CDN, embed at build time,
 * cache in localStorage, or generate at runtime.
 */

import type { BankedQuestion, CharacterStats, Difficulty } from "../types.js";

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
   *  templates such as Ruby/Sally/Edward/Roko. Optional for legacy persisted packs;
   *  registry helpers derive courses from faculty+rooms when absent. */
  courses?: PackCourse[];
  /** Channel rail definitions. Should match faculty IDs (one room per
   *  teaching faculty + one lounge entry per pack). */
  rooms: PackRoom[];
  /** Optional editorial provenance for a hand-curated curriculum. This is
   *  public metadata only; it must never contain credentials or private
   *  author notes. */
  curriculum?: PackCurriculumMetadata;
}

export interface PackCurriculumMetadata {
  framework?: string;
  reviewedAt: string;
  guidingQuestion?: string;
  modules: string[];
  sources: string[];
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
  /** Optional external profile image URL for custom or published teachers. */
  profileImageUrl?: string;
  /** Optional public X identity for weekly guest-teacher welcome and
   *  source-grounded insight posts. Store the handle only, without @. */
  xHandle?: string;
  /** Optional card stats for custom pack teachers. */
  stats?: CharacterStats;
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
  /** Optional tool-free persona for the shared teachers' lounge. */
  loungePrompt?: string;
  /** OpenRouter model id. Cheap fast models work fine — chat is short
   *  and high-volume. */
  defaultModel: string;
  /** Optional teacher LLM capability metadata. Omitted means the default
   *  OpenRouter/local LLM credential path. Do not store secrets here. */
  provider?: PackFacultyProvider;
  // ── question bank (inline) ────────────────────────────────────────────
  /** Inline question bank. Matches the existing BankedQuestion shape so
   *  pickQuestion / pickDaily logic doesn't change. */
  questions: BankedQuestion[];
  /** Raw source cards. Generated/imported packs can keep these cheap by default:
   *  the player can type answers immediately, and MC distractors are
   *  generated/cached later only when explicitly requested. */
  sourceCards?: PackSourceCard[];
}

export type PackFacultyProvider =
  {
    kind: "openrouter";
    /** Whether this provider can accept OpenAI-style Ruby High board tools. */
    supportsTools?: boolean;
  };

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
  /** Optional school-year gate for built-in corpora. Omitted means the
   *  card is available at any grade, preserving imported pack behavior. */
  minGrade?: string;
  faculty: string;
  media?: PackMediaAsset[];
}
