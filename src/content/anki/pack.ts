/**
 * Anki deck → ContentPack. Wires the parser + the LLM distractor
 * generator into a single ContentPack the rest of the system already
 * knows how to play. The generated pack can contain multiple classes:
 * subdecks split first, strong note tags split next, and flat decks stay
 * as one classroom.
 *
 * The pack-store import route calls buildAnkiPack after parseApkg().
 * Tests mock OpenRouter and verify the end-to-end deck → pack assembly.
 */

import type { ContentPack, PackCourse, PackFaculty, PackRoom } from "../types.js";
import { generateBankFromCards, type DistractorOpts } from "./distractors.js";
import type { AnkiDeck, AnkiCard } from "./parse.js";
import { generateAnkiPersona, type PersonaResult } from "./persona.js";
import { log } from "../../services/logger.js";
import { TEACHERS, type TeacherCharacter } from "../../characters/teachers.js";
import { classifyQuestionStat } from "../../question-stats.js";

export interface BuildAnkiPackOpts {
  apiKey: string;
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
  /** Cap on cards processed (cost cap for the LLM call). Default 100. */
  maxCards?: number;
  /** Forwarded to the distractor generator. */
  concurrency?: number;
  /** Forwarded — fires once per card so the import UI can show progress. */
  onProgress?: (done: number, total: number) => void;
  /** Suffix appended to the auto-derived pack id to disambiguate
   *  re-imports of the same deck name. Tests pass a fixed value;
   *  production passes a short timestamp+random tail. */
  idSuffix?: string;
}

export interface BuildAnkiPackResult {
  pack: ContentPack;
  /** Cards we couldn't generate distractors for. */
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
  let skipped = 0;
  let progressBase = 0;

  for (const plan of plans) {
    const courseSlug = uniqueSlug(slug(plan.title) || baseSlug, usedCourseSlugs);
    const facultyId = plans.length === 1
      ? `${baseSlug}-${suffix}`
      : `${baseSlug}-${courseSlug}-${suffix}`;
    const subjectSeed = slug(plan.title) || "anki";
    const personaPromise = selectedTeacher || (opts.facultyName && plans.length === 1)
      ? Promise.resolve(null as PersonaResult | null)
      : generateAnkiPersona({
          apiKey: opts.apiKey,
          deckName: plan.title === deck.name ? deck.name : `${deck.name} / ${plan.title}`,
          sampleCards: pickSampleCards(plan.cards),
        }).catch((err) => {
          log.error("anki.persona-failed", err, { deckName: deck.name, courseTitle: plan.title });
          return null as PersonaResult | null;
        });
    const progressStart = progressBase;
    const distractorOpts: DistractorOpts = {
      apiKey: opts.apiKey,
      facultyId,
      // Subject pill on the chalkboard. If persona generation succeeds
      // below, we re-stamp this to the persona's better class slug.
      subject: subjectSeed,
      difficulty: "medium",
      concurrency: opts.concurrency,
      onProgress: opts.onProgress
        ? (done) => opts.onProgress?.(progressStart + done, cards.length)
        : undefined,
    };
    const [persona, bank] = await Promise.all([
      personaPromise,
      generateBankFromCards(plan.cards, distractorOpts),
    ]);
    progressBase += plan.cards.length;
    skipped += bank.skipped;
    if (bank.questions.length === 0) continue;

    const className = persona?.className || (plans.length === 1 ? opts.facultyName : undefined) || plan.title;
    const teacherDisplay = selectedTeacher
      ? selectedTeacher.displayName
      : persona
        ? (persona.teacherTitle ? `${persona.teacherTitle} ${persona.teacherName}` : persona.teacherName)
        : (opts.facultyName && plans.length === 1 ? opts.facultyName : `${plan.title} Tutor`);
    const subjectPill = slug(persona?.className || plan.title) || "anki";
    if (subjectPill !== subjectSeed) {
      for (const q of bank.questions) {
        q.subject = subjectPill;
        q.stat = classifyQuestionStat({
          prompt: q.prompt,
          subject: q.subject,
          explanation: q.explanation,
          correctAnswer: q.correct && q.options ? q.options[q.correct] : undefined,
        });
      }
    }

    const accent = opts.accent ?? (selectedTeacher ? teacherAccent(selectedTeacher.id) : hashedAccent(`${deck.name}:${plan.key}`));
    const room: PackRoom = {
      id: `${facultyId}-room`,
      name: className,
      channelName: courseSlug,
      teacherId: facultyId,
      description: persona?.signature ? `“${persona.signature}”` : `Anki: ${deck.name} / ${plan.title}.`,
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
        : persona?.bio || `Anki-imported class from "${deck.name}": ${plan.title}.`,
      accent,
      systemPrompt: selectedTeacher
        ? importedModulePrompt(selectedTeacher, deck.name, plan.title)
        : persona?.systemPrompt || anchoredTeacherPrompt(plan.title, deck.name),
      defaultModel: selectedTeacher?.defaultModel ?? "anthropic/claude-haiku-4.5",
      questions: bank.questions,
    };
    faculty.push(member);
    courses.push(course);
    rooms.push(room);
  }

  const questionCount = faculty.reduce((s, f) => s + f.questions.length, 0);
  const pack: ContentPack = {
    id: opts.packId ?? `anki:${baseSlug}-${suffix}`,
    name: opts.packName ?? deck.name,
    description: describeImport(deck.name, courses.length, questionCount),
    version: "1.0.0",
    faculty,
    courses,
    rooms,
  };
  return { pack, skipped };
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
  const questions = questionCount === 1 ? "1 question" : `${questionCount} questions`;
  return `Imported from Anki: ${deckName}. ${questions} across ${classes}.`;
}

/** Pick a representative slice of the deck for the persona LLM. The
 *  goal is "give the model a feel for the material" — so we sample
 *  evenly across the deck rather than taking the first N (Anki decks
 *  often start with table-of-contents-style cards that don't represent
 *  the body). */
function pickSampleCards(cards: AnkiCard[]): AnkiCard[] {
  if (cards.length <= 6) return cards.slice();
  const out: AnkiCard[] = [];
  const stride = cards.length / 6;
  for (let i = 0; i < 6; i++) {
    const idx = Math.min(cards.length - 1, Math.floor(i * stride));
    out.push(cards[idx]!);
  }
  return out;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "deck";
}

function shortenName(name: string): string {
  // Take the first comma/colon/dash-separated chunk; cap at 16 chars.
  const head = name.split(/[,:\-–—]/)[0]?.trim() ?? name;
  return head.length > 16 ? head.slice(0, 14) + "…" : head;
}

function defaultIdSuffix(): string {
  // 6-char base36 timestamp+random tail. Collision-resistant within a
  // session without dragging in a UUID dep. Two imports in the same
  // millisecond still differ via Math.random.
  const t = Date.now().toString(36).slice(-4);
  const r = Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, "0");
  return `${t}${r}`;
}

function hashedAccent(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 60, 52);
}

function teacherAccent(id: string): string {
  switch (id) {
    case "ruby": return "#d22a2a";
    case "sally-science": return "#3aa3e0";
    case "professor-edward": return "#7a4f2a";
    default: return hashedAccent(id);
  }
}

function importedModulePrompt(teacher: TeacherCharacter, deckName: string, className: string): string {
  return [
    teacher.systemPrompt,
    "",
    `Imported Anki module: "${deckName}" / "${className}". This class is assigned to your classroom for this user.`,
    "Teach it in your normal voice. Treat the class topic as in-range for this module, even if it would normally belong to another teacher.",
    "Use pick_from_bank for due deck cards when available. The deck uses spaced review, so cards are never exhausted; when no deck card is due, do not keep trying filters. Write one custom question with pose_question or talk briefly with the class.",
  ].join("\n");
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)        { r = c; g = x; }
  else if (h < 120)  { r = x; g = c; }
  else if (h < 180)  { g = c; b = x; }
  else if (h < 240)  { g = x; b = c; }
  else if (h < 300)  { r = x; b = c; }
  else               { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function anchoredTeacherPrompt(className: string, deckName: string): string {
  return [
    `You are the teacher for an Anki class called "${className}", imported from the deck "${deckName}". You run a small classroom drilling this material.`,
    `Your job: pose questions from the bank, react crisply to the student's answers, and keep the class moving.`,
    `Stay in voice as a focused, encouraging tutor specific to the deck topic. No fake biographical detail —`,
    `the class title is what defines you. If the topic is biology you sound like a bio teacher; if it's law you sound like a law professor.`,
    `Tools: pick_from_bank for the next question. clear_board between rounds. Keep replies tight (1-2 sentences).`,
  ].join(" ");
}
