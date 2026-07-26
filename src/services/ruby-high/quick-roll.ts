import { playbookById, type PlaybookId } from "../../characters/playbooks.js";
import type { CharacterStats } from "../../types.js";

export interface QuickRollStudent {
  name: string;
  playbookId: PlaybookId;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote: string;
  personality: string;
}

const QUICK_ROLL_PRESETS: ReadonlyArray<Omit<QuickRollStudent, "stats">> = [
  {
    name: "Iris",
    playbookId: "outsider",
    arcAnswer: "I want to notice the pattern everyone else stopped seeing.",
    flavorQuote: "I am not lost. I am collecting evidence.",
    personality: "Quietly intense, observant, and allergic to obvious answers.",
  },
  {
    name: "Nova",
    playbookId: "overachiever",
    arcAnswer: "I want to learn whether being excellent can also leave room for doubt.",
    flavorQuote: "If this is extra credit, I am morally required to overdo it.",
    personality: "Fast, exacting, and more generous with classmates than with themself.",
  },
  {
    name: "Mara",
    playbookId: "heart",
    arcAnswer: "I want to help the room get braver without speaking for anyone.",
    flavorQuote: "The answer changes when you notice who has not spoken.",
    personality: "Warm, steady, and good at finding the person a group forgot.",
  },
  {
    name: "Jules",
    playbookId: "class-clown",
    arcAnswer: "I want to know which jokes make the room safer and which ones only hide me.",
    flavorQuote: "My backup plan has a punchline and no adult supervision.",
    personality: "Quick-witted, loyal, and serious precisely when nobody expects it.",
  },
  {
    name: "Theo",
    playbookId: "slacker",
    arcAnswer: "I want to stop hiding what I know before it costs somebody else.",
    flavorQuote: "I read the instructions. I just objected to their tone.",
    personality: "Dry, resourceful, and much more prepared than they let on.",
  },
  {
    name: "Mina",
    playbookId: "lifer",
    arcAnswer: "I want to use what I know about this school without becoming its gatekeeper.",
    flavorQuote: "Every hallway has a rule and every rule has a story.",
    personality: "Connected, perceptive, and careful with the gossip people trust them to carry.",
  },
];

function stableIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, length);
}

export function quickRollStudentForSeed(seed: string): QuickRollStudent {
  const preset = QUICK_ROLL_PRESETS[stableIndex(seed, QUICK_ROLL_PRESETS.length)]
    ?? QUICK_ROLL_PRESETS[0]!;
  const playbook = playbookById(preset.playbookId);
  if (!playbook) throw new Error(`Quick Roll playbook is unavailable: ${preset.playbookId}`);
  return {
    ...preset,
    stats: { ...playbook.suggestedStats },
  };
}
