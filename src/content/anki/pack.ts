/**
 * Anki deck → ContentPack. Wires the parser into a single ContentPack
 * the rest of the system already knows how to play. Imports keep raw
 * source cards so typed-answer play is free; multiple-choice distractors
 * are generated later only when the player asks for them. The generated
 * pack can contain multiple classes:
 * subdecks split first, strong note tags split next, and flat decks stay
 * as one classroom.
 *
 * The pack-store import route calls buildAnkiPack after parseApkg().
 * Tests verify the end-to-end deck → pack assembly.
 */

import type { ContentPack, PackCourse, PackFaculty, PackRoom, PackSourceCard } from "../types.js";
import type { AnkiDeck, AnkiCard } from "./parse.js";
import { TEACHERS, type TeacherCharacter } from "../../characters/teachers.js";
import {
  slug, shortenName, defaultIdSuffix, hashedAccent, teacherAccent,
  importedModulePrompt, anchoredTeacherPrompt,
} from "../pack-utils.js";

export interface BuildAnkiPackOpts {
  /** Legacy no-op; JIT MC generation reads the current browser key later. */
  apiKey?: string;
  /** Override the auto-derived pack id (default: `anki:<slug>-<suffix>`). */
  packId?: string;
  /** Override the auto-derived pack name. Defaults to the deck name. */
  packName?: string;
  /** Faculty display name. Defaults to the deck name. */
  facultyName?: string;
  /** Built-in teacher whose voice should run this imported module. */
  teacherId?: string;
  /** Faculty hex accent color. Defaults to a hash of the deck name so
   *  multiple Anki packs in the channels rail don't all read as the
   *  same blue. */
  accent?: string;
  /** Cap on imported source cards. Default 100. */
  maxCards?: number;
  /** Legacy no-op; distractors are generated JIT from the viewer. */
  concurrency?: number;
  /** Legacy no-op; import is local after the .apkg is parsed. */
  onProgress?: (done: number, total: number) => void;
  /** Suffix appended to the auto-derived pack id to disambiguate
   *  re-imports of the same deck name. Tests pass a fixed value;
   *  production passes a short timestamp+random tail. */
  idSuffix?: string;
}

export interface BuildAnkiPackResult {
  pack: ContentPack;
  /** Source cards skipped during import. JIT distractors are generated later. */
  skipped: number;
}

export interface AnkiCoursePlan {
  key: string;
  title: string;
  source: "deck" | "subdeck" | "tag";
  cards: AnkiCard[];
}

const MIN_CARDS_PER_COURSE = 2;
const MAX_COURSES_PER_IMPORT = 6;

export async function buildAnkiPack(
  deck: AnkiDeck,
  opts: BuildAnkiPackOpts,
): Promise<BuildAnkiPackResult> {
  const cap = Math.max(1, Math.min(500, opts.maxCards ?? 100));
  const cards = deck.cards.slice(0, cap);
  const suffix = opts.idSuffix ?? defaultIdSuffix();
  const baseSlug = slug(opts.packId ?? deck.name);
  const selectedTeacher = opts.teacherId ? TEACHERS[opts.teacherId] ?? null : null;
  const plans = planAnkiCourses(deck, cards);
  const usedCourseSlugs = new Map<string, number>();
  const faculty: PackFaculty[] = [];
  const courses: PackCourse[] = [];
  const rooms: PackRoom[] = [];

  for (const plan of plans) {
    const courseSlug = uniqueSlug(slug(plan.title) || baseSlug, usedCourseSlugs);
    const facultyId = plans.length === 1
      ? `${baseSlug}-${suffix}`
      : `${baseSlug}-${courseSlug}-${suffix}`;
    const subjectPill = slug(plan.title) || "anki";
    const className = (plans.length === 1 ? opts.facultyName : undefined) || plan.title;
    const teacherDisplay = selectedTeacher
      ? selectedTeacher.displayName
      : (opts.facultyName && plans.length === 1 ? opts.facultyName : `${plan.title} Tutor`);
    const accent = opts.accent ?? (selectedTeacher ? teacherAccent(selectedTeacher.id) : hashedAccent(`${deck.name}:${plan.key}`));
    const sourceCards: PackSourceCard[] = plan.cards.map((card) => sourceCardFromAnki(card, {
      facultyId,
      subject: subjectPill,
      difficulty: "medium",
    }));
    const room: PackRoom = {
      id: `${facultyId}-room`,
      name: className,
      channelName: courseSlug,
      teacherId: facultyId,
      description: `Anki: ${deck.name} / ${plan.title}.`,
      teaches: true,
    };
    const course: PackCourse = {
      id: facultyId,
      title: className,
      facultyId,
      roomId: room.id,
      ...(selectedTeacher ? { teacherTemplateId: selectedTeacher.id } : {}),
      subjects: [subjectPill],
    };
    const member: PackFaculty = {
      id: facultyId,
      displayName: teacherDisplay,
      shortName: selectedTeacher?.shortName ?? shortenName(teacherDisplay),
      ...(selectedTeacher ? { assetTeacherId: selectedTeacher.id } : {}),
      subjects: [subjectPill],
      bio: selectedTeacher
        ? `${selectedTeacher.displayName} teaching "${plan.title}" from Anki deck "${deck.name}".`
        : `Anki-imported class from "${deck.name}": ${plan.title}.`,
      accent,
      systemPrompt: selectedTeacher
        ? importedModulePrompt(selectedTeacher, deck.name, plan.title)
        : anchoredTeacherPrompt(plan.title),
      defaultModel: selectedTeacher?.defaultModel ?? "anthropic/claude-haiku-4.5",
      questions: [],
      sourceCards,
    };
    faculty.push(member);
    courses.push(course);
    rooms.push(room);
  }

  const questionCount = faculty.reduce((s, f) => s + (f.sourceCards?.length ?? 0) + f.questions.length, 0);
  const pack: ContentPack = {
    id: opts.packId ?? `anki:${baseSlug}-${suffix}`,
    name: opts.packName ?? deck.name,
    description: describeImport(deck.name, courses.length, questionCount),
    version: "1.0.0",
    faculty,
    courses,
    rooms,
  };
  return { pack, skipped: 0 };
}

export function planAnkiCourses(deck: AnkiDeck, cards: AnkiCard[]): AnkiCoursePlan[] {
  if (cards.length === 0) {
    return [{ key: "deck", title: deck.name || "Imported Deck", source: "deck", cards: [] }];
  }
  const subdeckGroups = groupBySubdeck(deck, cards);
  if (subdeckGroups.length > 1) {
    const planned = finalizeCoursePlans(subdeckGroups, deck.name);
    if (planned.length > 1) return planned;
  }
  const tagGroups = groupByStrongTags(cards);
  if (tagGroups.length > 1) {
    const planned = finalizeCoursePlans(tagGroups, deck.name);
    if (planned.length > 1) return planned;
  }
  return [{ key: "deck", title: deck.name || "Imported Deck", source: "deck", cards }];
}

function sourceCardFromAnki(
  card: AnkiCard,
  opts: { facultyId: string; subject: string; difficulty: "medium" },
): PackSourceCard {
  const acceptedAnswers = acceptedAnswersFor(card.back);
  const hasImage = (card.media?.length ?? 0) > 0 || /<img\b/i.test(card.frontHtml ?? "") || /<img\b/i.test(card.backHtml ?? "");
  const hasOcclusionHint = [...(card.tags ?? []), card.deckName, card.frontHtml ?? "", card.backHtml ?? ""]
    .some((value) => /image[-_\s]?occlusion|occlusion/i.test(value));
  return {
    id: `anki-${card.noteId}`,
    kind: hasImage && hasOcclusionHint ? "image-occlusion" : "basic",
    front: card.front || (hasImage ? "Identify the hidden part of the image." : "Untitled Anki prompt"),
    back: card.back,
    ...(card.frontHtml ? { frontHtml: card.frontHtml } : {}),
    ...(card.backHtml ? { backHtml: card.backHtml } : {}),
    acceptedAnswers,
    deckName: card.deckName,
    tags: card.tags ?? [],
    subject: opts.subject,
    difficulty: opts.difficulty,
    faculty: opts.facultyId,
    ...(card.media && card.media.length > 0 ? { media: card.media } : {}),
  };
}

function acceptedAnswersFor(back: string): string[] {
  const raw = stripAnswerMarkup(back);
  const parts = raw
    .split(/\s*(?:\||;|\/|,|\bor\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 120);
  return Array.from(new Set([raw, ...parts]));
}

function stripAnswerMarkup(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface RawCourseGroup {
  key: string;
  title: string;
  source: AnkiCoursePlan["source"];
  cards: AnkiCard[];
  firstIndex: number;
}

function groupBySubdeck(deck: AnkiDeck, cards: AnkiCard[]): RawCourseGroup[] {
  const groups = new Map<string, RawCourseGroup>();
  cards.forEach((card, index) => {
    const title = subdeckCourseTitle(deck.name, card.deckName);
    const key = `subdeck:${slug(title)}`;
    const group = groups.get(key);
    if (group) {
      group.cards.push(card);
    } else {
      groups.set(key, { key, title, source: "subdeck", cards: [card], firstIndex: index });
    }
  });
  return Array.from(groups.values());
}

function groupByStrongTags(cards: AnkiCard[]): RawCourseGroup[] {
  const tagStats = new Map<string, { label: string; count: number; firstIndex: number }>();
  cards.forEach((card, index) => {
    for (const raw of card.tags ?? []) {
      const label = tagLabel(raw);
      if (!isMeaningfulTag(label)) continue;
      const key = slug(label);
      const stat = tagStats.get(key);
      if (stat) {
        stat.count += 1;
        stat.firstIndex = Math.min(stat.firstIndex, index);
      } else {
        tagStats.set(key, { label, count: 1, firstIndex: index });
      }
    }
  });
  const eligible = new Map(
    Array.from(tagStats.entries())
      .filter(([, stat]) => stat.count >= MIN_CARDS_PER_COURSE && stat.count < cards.length)
      .sort((a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex),
  );
  if (eligible.size < 2) return [];

  const groups = new Map<string, RawCourseGroup>();
  cards.forEach((card, index) => {
    const tag = (card.tags ?? [])
      .map((raw) => {
        const label = tagLabel(raw);
        const key = slug(label);
        const stat = eligible.get(key);
        return stat ? { key, label: stat.label, count: stat.count, firstIndex: stat.firstIndex } : null;
      })
      .filter((entry): entry is { key: string; label: string; count: number; firstIndex: number } => Boolean(entry))
      .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)[0];
    const key = tag ? `tag:${tag.key}` : "tag:general-review";
    const title = tag ? titleCase(tag.label) : "General Review";
    const group = groups.get(key);
    if (group) {
      group.cards.push(card);
    } else {
      groups.set(key, { key, title, source: tag ? "tag" : "deck", cards: [card], firstIndex: index });
    }
  });
  return Array.from(groups.values());
}

function finalizeCoursePlans(groups: RawCourseGroup[], fallbackTitle: string): AnkiCoursePlan[] {
  const sorted = groups
    .filter((g) => g.cards.length > 0)
    .sort((a, b) => a.firstIndex - b.firstIndex);
  if (sorted.length <= 1) return sorted.map(toCoursePlan);

  const large = sorted.filter((g) => g.cards.length >= MIN_CARDS_PER_COURSE);
  const small = sorted.filter((g) => g.cards.length < MIN_CARDS_PER_COURSE);
  if (large.length === 0) {
    return [{
      key: "deck",
      title: fallbackTitle || "Imported Deck",
      source: "deck",
      cards: sorted.flatMap((g) => g.cards),
    }];
  }

  const merged: RawCourseGroup[] = large.slice();
  if (small.length > 0) {
    const smallCards = small.flatMap((g) => g.cards);
    const firstSmallIndex = Math.min(...small.map((g) => g.firstIndex));
    if (smallCards.length >= MIN_CARDS_PER_COURSE) {
      merged.push({
        key: "deck:general-review",
        title: "General Review",
        source: "deck",
        cards: smallCards,
        firstIndex: firstSmallIndex,
      });
    } else {
      const nearest = merged
        .slice()
        .sort((a, b) => Math.abs(a.firstIndex - firstSmallIndex) - Math.abs(b.firstIndex - firstSmallIndex))[0];
      nearest?.cards.push(...smallCards);
    }
  }

  if (merged.length <= MAX_COURSES_PER_IMPORT) {
    return merged.sort((a, b) => a.firstIndex - b.firstIndex).map(toCoursePlan);
  }

  const kept = merged
    .slice()
    .sort((a, b) => b.cards.length - a.cards.length || a.firstIndex - b.firstIndex)
    .slice(0, MAX_COURSES_PER_IMPORT - 1);
  const keptKeys = new Set(kept.map((g) => g.key));
  const overflow = merged.filter((g) => !keptKeys.has(g.key));
  kept.push({
    key: "deck:general-review",
    title: "General Review",
    source: "deck",
    cards: overflow.flatMap((g) => g.cards),
    firstIndex: Math.min(...overflow.map((g) => g.firstIndex)),
  });
  return kept.sort((a, b) => a.firstIndex - b.firstIndex).map(toCoursePlan);
}

function toCoursePlan(group: RawCourseGroup): AnkiCoursePlan {
  return {
    key: group.key,
    title: group.title,
    source: group.source,
    cards: group.cards,
  };
}

function subdeckCourseTitle(deckName: string, cardDeckName: string): string {
  const deckParts = splitDeckName(deckName);
  const cardParts = splitDeckName(cardDeckName);
  if (cardParts.length <= 1) return cardDeckName || deckName || "Imported Deck";
  let tail = cardParts.slice();
  if (deckParts.length > 0 && cardParts.slice(0, deckParts.length).join("::") === deckParts.join("::")) {
    tail = cardParts.slice(deckParts.length);
  } else if (deckParts[0] && cardParts[0] === deckParts[0]) {
    tail = cardParts.slice(1);
  }
  return titleCase((tail.length > 0 ? tail : cardParts).join(" / "));
}

function splitDeckName(name: string): string[] {
  return name.split("::").map((part) => part.trim()).filter(Boolean);
}

function tagLabel(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMeaningfulTag(label: string): boolean {
  if (!label || label.length < 2) return false;
  return !new Set([
    "marked",
    "leech",
    "suspended",
    "buried",
    "todo",
    "review",
    "anki",
  ]).has(label);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const root = base || "course";
  const count = used.get(root) ?? 0;
  used.set(root, count + 1);
  return count === 0 ? root : `${root}-${count + 1}`;
}

function describeImport(deckName: string, classCount: number, questionCount: number): string {
  const classes = classCount === 1 ? "1 class" : `${classCount} classes`;
  const cards = questionCount === 1 ? "1 card" : `${questionCount} cards`;
  return `Imported from Anki: ${deckName}. ${cards} across ${classes}.`;
}

