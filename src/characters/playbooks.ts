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
    blurb: "Your notes have tabs. Your tabs have a system. One missed point can follow you home.",
    suggestedStats: { head: 2, heart: 0, hustle: -1, honor: 1 },
    hookQuestion: "Who taught you that one missed point matters?",
    startingMove: {
      name: "Margins are sacred",
      description: "Once per year, turn over one missed card and try a different route.",
    },
    accent: "#ff6f91",
  },
  {
    id: "slacker",
    name: "The Slacker",
    shortName: "Slacker",
    blurb: "You look half asleep until the shortcut appears. Then you are already through the door.",
    suggestedStats: { head: 0, heart: 1, hustle: 2, honor: -1 },
    hookQuestion: "Who knows how hard you are pretending not to try?",
    startingMove: {
      name: "Wing it",
      description: "When HEAD would miss, use HUSTLE and take the improvised route.",
    },
    accent: "#36c2cc",
  },
  {
    id: "heart",
    name: "The Heart",
    shortName: "Heart",
    blurb: "You notice the empty chair, the shaking hand, and who has been carrying the map alone.",
    suggestedStats: { head: -1, heart: 2, hustle: 0, honor: 1 },
    hookQuestion: "Who do you keep helping before they ask?",
    startingMove: {
      name: "Pep talk",
      description: "When a classmate misses, choose one support card; they carry its effect into the next room.",
    },
    accent: "#52c673",
  },
  {
    id: "outsider",
    name: "The Outsider",
    shortName: "Outsider",
    blurb: "The map says one thing. The worn floor says another. Everyone else stopped looking years ago.",
    suggestedStats: { head: 1, heart: 0, hustle: -1, honor: 2 },
    hookQuestion: "What was the first strange thing you noticed here?",
    startingMove: {
      name: "Outside eyes",
      description: "Once per period, reveal one clue before choosing; then select the observation card that explains what tipped you off.",
    },
    accent: "#a06bff",
  },
  {
    id: "class-clown",
    name: "The Class Clown",
    shortName: "Clown",
    blurb: "You can crack a locked-up room with one joke. Sometimes the joke is also a shield.",
    suggestedStats: { head: -1, heart: 2, hustle: 1, honor: 0 },
    hookQuestion: "What truth keeps coming out as a joke?",
    startingMove: {
      name: "Crack the room",
      description: "When HEAD would miss, use HEART; on 10+, break the tension and clear the obstacle for everyone.",
    },
    accent: "#ffb05a",
  },
  {
    id: "lifer",
    name: "The Lifer",
    shortName: "Lifer",
    blurb: "You know which stair squeaks, which trophy is fake, and why two teachers never share a table.",
    suggestedStats: { head: 1, heart: 1, hustle: 1, honor: -1 },
    hookQuestion: "Which school secret are you almost ready to trade?",
    startingMove: {
      name: "Old gossip",
      description: "At the first locked passage, reveal the old-rumor card; the group decides whether to trust it.",
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
