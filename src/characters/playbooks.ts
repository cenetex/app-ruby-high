/**
 * Six playbooks the player can choose at character creation. Each is a
 * starting template — name, hook question, recommended stat-distribution,
 * starting move. Stats sum to +2 (one +2, one +1, one 0, one -1) — the
 * player can re-assign at creation time.
 *
 * License: CC BY 4.0. Inspired by Apocalypse World / Dungeon World / the
 * general PbtA lineage.
 */

import type { CharacterStats } from "../types.js";

export type PlaybookId =
  | "overachiever"
  | "slacker"
  | "heart"
  | "outsider"
  | "class-clown"
  | "lifer";

export interface Playbook {
  id: PlaybookId;
  name: string;
  shortName: string;
  blurb: string;
  /** Suggested stat array — the player can reassign letters but the sum
   *  stays at +2 (one +2, one +1, one 0, one -1). */
  suggestedStats: CharacterStats;
  /** The personal-arc question presented at character creation. The
   *  player's answer becomes their `arcAnswer`. */
  hookQuestion: string;
  /** Starting move — gameplay rule baked in. Phase 3 wires these. */
  startingMove: { name: string; description: string };
  accent: string;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "overachiever",
    name: "The Overachiever",
    shortName: "Overachiever",
    blurb: "Cs are not enough. You sweat the ones you miss.",
    suggestedStats: { head: 2, heart: 0, hustle: -1, honor: 1 },
    hookQuestion: "Why is Cs not enough?",
    startingMove: {
      name: "Margins are sacred",
      description: "Once per year, retake one missed question.",
    },
    accent: "#ff6f91",
  },
  {
    id: "slacker",
    name: "The Slacker",
    shortName: "Slacker",
    blurb: "Hides being smart. Always knows more than they let on.",
    suggestedStats: { head: 0, heart: 1, hustle: 2, honor: -1 },
    hookQuestion: "Who do you not want to disappoint?",
    startingMove: {
      name: "Wing it",
      description: "When you'd fail a HEAD roll, swap it for HUSTLE.",
    },
    accent: "#36c2cc",
  },
  {
    id: "heart",
    name: "The Heart",
    shortName: "Heart",
    blurb: "Glue of every group. Quietly carries the people around you.",
    suggestedStats: { head: -1, heart: 2, hustle: 0, honor: 1 },
    hookQuestion: "Whose orbit are you stuck in?",
    startingMove: {
      name: "Pep talk",
      description: "When a classmate misses, you can write them a one-liner — they remember it.",
    },
    accent: "#52c673",
  },
  {
    id: "outsider",
    name: "The Outsider",
    shortName: "Outsider",
    blurb: "Transferred in. You see the things the locals stopped noticing.",
    suggestedStats: { head: 1, heart: 0, hustle: -1, honor: 2 },
    hookQuestion: "What did you leave behind?",
    startingMove: {
      name: "Outside eyes",
      description: "Once per period, see the explanation for one question before answering — you must write a one-line observation about the school in chat.",
    },
    accent: "#a06bff",
  },
  {
    id: "class-clown",
    name: "The Class Clown",
    shortName: "Clown",
    blurb: "Deflects with a joke. Sneakily makes the room better.",
    suggestedStats: { head: -1, heart: 2, hustle: 1, honor: 0 },
    hookQuestion: "What can't you say without a joke?",
    startingMove: {
      name: "Crack the room",
      description: "When you'd miss a question, roll HEART instead of HEAD; on 10+ the question is voided for everyone.",
    },
    accent: "#ffb05a",
  },
  {
    id: "lifer",
    name: "The Lifer",
    shortName: "Lifer",
    blurb: "Knows everyone's history. Knows where the bodies are buried.",
    suggestedStats: { head: 1, heart: 1, hustle: 1, honor: -1 },
    // "What does this school owe you?" was the prior hook — structurally a
    // grievance prompt that pushed the LLM toward political/historical
    // weight. The Lifer is supposed to be a gossip-trader who knows
    // institutional weirdness, not a kid carrying a debt. New hook keeps
    // the insider-knowing vibe but lands on small school-specific oddities.
    hookQuestion: "What's the best gossip you've picked up about this place?",
    startingMove: {
      name: "Old gossip",
      description: "You know which teacher is in a mood today. The rest find out.",
    },
    accent: "#ec4f9e",
  },
];

export function playbookById(id: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

/** Validate a stat array conforms to the +2/+1/0/-1 distribution. */
export function isValidStatDistribution(s: CharacterStats): boolean {
  const sorted = [s.head, s.heart, s.hustle, s.honor].sort((a, b) => b - a);
  return sorted[0] === 2 && sorted[1] === 1 && sorted[2] === 0 && sorted[3] === -1;
}
