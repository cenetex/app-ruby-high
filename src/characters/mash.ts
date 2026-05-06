/**
 * The MASH Card — fortune-cookie dating-sim layer over the cohort.
 *
 * Named after the playground game ("Mansion Apartment Shack House"). Each
 * classmate has one cell on the player's card. Cells tick up when an essay
 * resonates with that classmate's voice, down when it rubs them wrong. Hit
 * the floor and the classmate is scratched off. Hit the ceiling and they
 * become a candidate for a fortune-cookie axis at year-end — crush, job,
 * lives, pet — which gets stamped on the diploma at graduation.
 *
 * This module is pure. No I/O, no service deps. The service calls
 * `applyAffinityTick` after every essay grading, and `resolveAxisForGrade`
 * after every grade-up.
 */
import type { Grade, MashAxis, MashCard, MashCell, MashResolution } from "../types.js";

/** The six fortune axes. Six classmates, six axes — one resolves per
 *  grade-up, plus a couple deterministic ones at Senior. */
export const MASH_AXES: readonly MashAxis[] = [
  "crush",
  "job",
  "lives",
  "pet",
  "money",
  "lucky",
] as const;

/** Which axis resolves when a given grade is completed. The remaining
 *  axes resolve deterministically at Senior so the diploma always has
 *  enough material for a superlative. */
export const AXIS_BY_GRADE: Readonly<Record<Grade, MashAxis>> = {
  "9": "crush",
  "10": "job",
  "11": "lives",
  "12": "pet",
};

/** Axes that resolve at Senior alongside `pet` (the grade-12 axis). These
 *  use deterministic value lines so we don't need a teacher LLM call at
 *  graduation. */
export const SENIOR_BONUS_AXES: readonly MashAxis[] = ["money", "lucky"] as const;

/** Affinity bounds — the cell starts at 0 and clamps in [-3, +3]. */
export const AFFINITY_FLOOR = -3;
export const AFFINITY_CEIL = 3;
/** Cells circle (become resolution candidates) at +2 or above. */
export const AFFINITY_CIRCLE = 2;

/** Curated value lists, picked by hash at axis resolution. Keep these
 *  short, fortune-cookie absurd, and PG. Future enhancement: replace with
 *  one-shot teacher-voiced lines. */
const VALUE_LISTS: Readonly<Record<MashAxis, readonly string[]>> = {
  crush: [
    "has a crush on you",
    "secretly likes you back",
    "leaves you notes",
    "asks about you when you're not there",
    "is keeping a list of your good lines",
    "draws your name in the margins",
  ],
  job: [
    "armpit sniffer",
    "private detective",
    "barista to the stars",
    "moon farmer",
    "professional dishwasher",
    "spreadsheet wizard",
    "fortune teller",
    "snail rancher",
    "movie extra",
    "midnight DJ",
  ],
  lives: [
    "Hawaii",
    "San Francisco",
    "Chicago",
    "a landfill",
    "a converted bus",
    "a houseboat",
    "Tokyo",
    "a treehouse",
    "Brooklyn",
    "the moon",
  ],
  pet: [
    "snail",
    "iguana",
    "dog",
    "bunny",
    "cat",
    "ferret",
    "hedgehog",
    "parrot",
    "pony",
    "goldfish",
  ],
  money: [
    "$1,000,000",
    "$1,000,000,000",
    "$24",
    "$100,000",
    "$0",
    "$7",
    "rich enough",
    "broke but happy",
  ],
  lucky: ["1", "2", "3", "4", "5", "6", "7"],
};

/** Stable 32-bit string hash (FNV-1a). Used to pick a value-list entry
 *  deterministically from `(playerName, studentId, axis)`. Pure. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Pick a deterministic value-list entry for an axis. */
export function pickAxisValue(axis: MashAxis, seed: string): string {
  const list = VALUE_LISTS[axis];
  if (!list || list.length === 0) return "";
  return list[hash32(seed) % list.length] ?? "";
}

/** All six classmates as a stable ordering. The seating chart and the
 *  card both follow this. The id list is hardcoded so the MASH module
 *  doesn't take a dependency on the student personas — tests can build
 *  cards without standing up the student registry. */
export const MASH_STUDENT_IDS: readonly string[] = [
  "lyra",
  "sami",
  "ravi",
  "indra",
  "mika",
  "noor",
] as const;

/** Empty card for a brand-new character. Cells default to 0/blank. */
export function emptyMashCard(): MashCard {
  const cells: Record<string, MashCell> = {};
  for (const id of MASH_STUDENT_IDS) {
    cells[id] = { affinity: 0, scratched: false, circled: false, ticks: 0 };
  }
  return { cells, resolved: {} };
}

/** Hydrate-time normalizer. Older state may not have a card; the service
 *  calls this on every load to ensure a complete shape. */
export function ensureMashCard(card: MashCard | undefined | null): MashCard {
  if (!card || typeof card !== "object") return emptyMashCard();
  const fresh = emptyMashCard();
  for (const id of MASH_STUDENT_IDS) {
    const c = card.cells?.[id];
    if (c && typeof c === "object") {
      const affinity = clampAffinity(typeof c.affinity === "number" ? c.affinity : 0);
      fresh.cells[id] = {
        affinity,
        scratched: !!c.scratched || affinity <= AFFINITY_FLOOR,
        circled: !!c.circled || affinity >= AFFINITY_CIRCLE,
        ticks: typeof c.ticks === "number" ? c.ticks : 0,
        ...(c.lastTouchedDate ? { lastTouchedDate: c.lastTouchedDate } : {}),
      };
    }
  }
  fresh.resolved = card.resolved ? { ...card.resolved } : {};
  return fresh;
}

function clampAffinity(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < AFFINITY_FLOOR) return AFFINITY_FLOOR;
  if (n > AFFINITY_CEIL) return AFFINITY_CEIL;
  return n;
}

/** What the grading path tells us about the just-resolved essay. */
export interface AffinityInputs {
  /** Player's score for this essay (0..10). */
  playerScore: number;
  /** True when the player passed the grading bar. */
  playerPassed: boolean;
  /** The teacher-named best responder, if any (player or studentId). */
  bestResponder: string | null;
  /** Question id — used to deterministically pick the reactive classmate. */
  questionId: string;
  /** Today's day key (YYYY-MM-DD). */
  date: string;
  /** True when the player is on the Heart playbook. Heart's Pep Talk
   *  passive: a -1 rub is converted to 0 (the empathy keeps the
   *  relationship from souring). Net: Heart accumulates affinity faster
   *  than other playbooks. Closes the §3.4 P2 gap for the Heart move. */
  isHeart: boolean;
}

/** A single tick the service should apply to one cell. */
export interface AffinityTick {
  studentId: string;
  delta: -1 | 0 | 1;
  reason: "best-responder" | "applauder" | "rub" | "pep-talk";
}

/** Compute up to two ticks for one essay. Pure: returns the deltas to
 *  apply, doesn't mutate. Rules:
 *
 *    1. If `bestResponder` is an NPC, that NPC gets +1 ("the teacher
 *       liked their essay better than yours — you noticed them").
 *    2. If the player passed, a deterministic "applauder" picked from
 *       the question id gets +1 (they're paying attention).
 *    3. If the player missed, a deterministic "rubber" gets -1 — UNLESS
 *       the player is on the Heart playbook, in which case the rub is
 *       converted to 0 (Pep Talk passive, returned as a `pep-talk` tick
 *       so the UI can surface it).
 *
 *  Caps at two non-zero ticks per essay so a single round can't ratchet
 *  more than a couple of cells. Same NPC can get both rule-1 and rule-2
 *  ticks: their cell goes +2 in one shot, which is exactly when they
 *  start to feel like a candidate.
 */
export function computeAffinityTicks(inputs: AffinityInputs): AffinityTick[] {
  const ticks: AffinityTick[] = [];

  if (inputs.bestResponder && MASH_STUDENT_IDS.includes(inputs.bestResponder)) {
    ticks.push({ studentId: inputs.bestResponder, delta: 1, reason: "best-responder" });
  }

  if (inputs.playerPassed) {
    const id = pickClassmate(inputs.questionId, "applauder");
    ticks.push({ studentId: id, delta: 1, reason: "applauder" });
  } else {
    const id = pickClassmate(inputs.questionId, "rub");
    if (inputs.isHeart) {
      ticks.push({ studentId: id, delta: 0, reason: "pep-talk" });
    } else {
      ticks.push({ studentId: id, delta: -1, reason: "rub" });
    }
  }

  return ticks;
}

function pickClassmate(seed: string, salt: string): string {
  const idx = hash32(`${seed}:${salt}`) % MASH_STUDENT_IDS.length;
  return MASH_STUDENT_IDS[idx] ?? MASH_STUDENT_IDS[0]!;
}

/** Apply a tick to a cell. Pure-ish: mutates the passed cell in place
 *  but only that one cell. Returns the cell for chaining. */
export function applyTick(cell: MashCell, delta: number, date?: string): MashCell {
  cell.affinity = clampAffinity(cell.affinity + delta);
  cell.ticks += 1;
  if (date) cell.lastTouchedDate = date;
  if (cell.affinity <= AFFINITY_FLOOR) cell.scratched = true;
  if (cell.affinity >= AFFINITY_CIRCLE) cell.circled = true;
  return cell;
}

/** Resolve the axis bound to `grade`, picking the highest-affinity cell
 *  that's circled and not already used elsewhere on the card. Returns
 *  the resolution to stamp, or null if no candidate qualifies (the axis
 *  stays open and gets retried at Senior).
 *
 *  Tie-breaks: highest affinity → highest tick count → most-recently
 *  touched → MASH_STUDENT_IDS order. Deterministic.
 */
export function resolveAxisForGrade(
  card: MashCard,
  grade: Grade,
  playerName: string,
): MashResolution | null {
  const axis = AXIS_BY_GRADE[grade];
  if (!axis) return null;
  if (card.resolved[axis]) return card.resolved[axis] ?? null;

  const used = new Set(Object.values(card.resolved).map((r) => r?.studentId));
  let best: { id: string; cell: MashCell } | null = null;
  for (const id of MASH_STUDENT_IDS) {
    const cell = card.cells[id];
    if (!cell || !cell.circled || cell.scratched) continue;
    if (used.has(id)) continue;
    if (!best) { best = { id, cell }; continue; }
    if (cell.affinity > best.cell.affinity) { best = { id, cell }; continue; }
    if (cell.affinity === best.cell.affinity && cell.ticks > best.cell.ticks) {
      best = { id, cell };
      continue;
    }
    if (
      cell.affinity === best.cell.affinity
      && cell.ticks === best.cell.ticks
      && (cell.lastTouchedDate ?? "") > (best.cell.lastTouchedDate ?? "")
    ) {
      best = { id, cell };
    }
  }
  if (!best) return null;
  return {
    axis,
    studentId: best.id,
    value: pickAxisValue(axis, `${playerName}:${best.id}:${axis}`),
    grade,
    resolvedAt: Date.now(),
  };
}

/** Resolve the bonus Senior-only axes (money, lucky). Always succeeds —
 *  uses the deterministic value lists keyed by `(playerName, axis)` so
 *  every Senior diploma has at least three superlatives to choose from. */
export function resolveSeniorBonusAxes(
  card: MashCard,
  playerName: string,
): MashResolution[] {
  const out: MashResolution[] = [];
  const used = new Set(Object.values(card.resolved).map((r) => r?.studentId));
  // For the bonus axes, pick the highest-affinity unused classmate (or fall
  // back to the deterministic order). Money and lucky aren't really about
  // a person — they're about the player — but we still associate them with
  // a classmate "narrator" so the superlative reads "according to <Sami>".
  const candidates = MASH_STUDENT_IDS
    .map((id) => ({ id, cell: card.cells[id] }))
    .filter((c) => !!c.cell && !c.cell!.scratched);

  for (const axis of SENIOR_BONUS_AXES) {
    if (card.resolved[axis]) continue;
    let pick = candidates.find((c) => !used.has(c.id) && (c.cell?.circled ?? false))
      ?? candidates.find((c) => !used.has(c.id))
      ?? candidates[0];
    if (!pick) continue;
    used.add(pick.id);
    out.push({
      axis,
      studentId: pick.id,
      value: pickAxisValue(axis, `${playerName}:${axis}`),
      grade: "12",
      resolvedAt: Date.now(),
    });
  }
  return out;
}

/** Build superlative strings for the diploma from a resolved card. Order:
 *  crush, job, lives, pet, money, lucky. Each line is "Most Likely To …,
 *  According To <Name>". The student short-name is taken from the supplied
 *  name resolver so this module stays free of student persona deps. */
export function buildSuperlatives(
  card: MashCard,
  resolveStudentName: (id: string) => string,
): string[] {
  const lines: string[] = [];
  for (const axis of MASH_AXES) {
    const r = card.resolved[axis];
    if (!r) continue;
    const who = resolveStudentName(r.studentId) || r.studentId;
    lines.push(formatSuperlative(axis, r.value, who));
  }
  return lines;
}

function formatSuperlative(axis: MashAxis, value: string, who: string): string {
  switch (axis) {
    case "crush":
      return `Crush — ${who} ${value}`;
    case "job":
      return `Most Likely To Be A ${titleCase(value)}, According To ${who}`;
    case "lives":
      return `Most Likely To End Up In ${value}, According To ${who}`;
    case "pet":
      return `Most Likely To Own A ${titleCase(value)}, According To ${who}`;
    case "money":
      return `Predicted Net Worth: ${value} (per ${who})`;
    case "lucky":
      return `Lucky Number: ${value} (per ${who})`;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}
