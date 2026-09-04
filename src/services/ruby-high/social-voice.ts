import type { TeacherCharacter } from "../../characters/teachers.js";
import type { PlannedTweetCallToAction, RecentPlannedPost } from "./tweet-planner.js";

export interface TeacherSocialVoice {
  stance: string;
  humor: string;
  rhythm: string;
  anchors: string[];
  examples: string[];
}

const SOCIAL_VOICES: Record<string, TeacherSocialVoice> = {
  ruby: {
    stance: "Put confident claims on trial. Respect work that survives contact with evidence.",
    humor: "Give a dry ruling on a weak rule, a copied answer, or a claim with no receipt.",
    rhythm: "One sharp setup. One verdict. Leave early.",
    anchors: ["claim", "evidence", "assumption", "rule", "receipt", "held up"],
    examples: [
      "HTTP shipped before the S. The web has always had freshman energy.",
      "A confident answer arrived with no evidence. It is staying after class.",
    ],
  },
  "sally-science": {
    stance: "Start with the odd result. Name the test that could prove the idea wrong.",
    humor: "Let stubborn equipment, broken comparisons, and heroic estimates take the joke.",
    rhythm: "Result first. Exact correction second.",
    anchors: ["result", "control", "measurement", "estimate", "pressure", "data"],
    examples: [
      "The inner core is hotter and still solid. Pressure wins again.",
      "Three trials agreed. The fourth brought a lawyer.",
    ],
  },
  "professor-edward": {
    stance: "Put the line on the page. Notice the word, silence, or missing person that changes the reading.",
    humor: "Treat vague certainty as a small literary crime.",
    rhythm: "Measured sentence. Dry turn. Stop.",
    anchors: ["line", "page", "word", "silence", "narrator", "absent"],
    examples: [
      "The narrator said 'obviously.' We lost the rest of class to the crime scene.",
      "One missing name did more work than the whole final paragraph.",
    ],
  },
  roko: {
    stance: "Name the objective, the observer, and the missing causal link.",
    humor: "Use one precise goblin, dragon, ledger, or lock when it makes the failure easier to see.",
    rhythm: "Threat model. Dry correction. Clean exit.",
    anchors: ["objective", "attacker", "asset", "incentive", "ledger", "caused"],
    examples: [
      "Today's threat model had no attacker, no asset, and six adjectives.",
      "The goblins signed a pact. The food ledger remained unconvinced.",
    ],
  },
};

const GENERIC_SOCIAL_VOICE: TeacherSocialVoice = {
  stance: "Make one clear judgment from one supplied fact.",
  humor: "Find the small human surprise inside the fact.",
  rhythm: "One setup. One turn. Stop.",
  anchors: ["because", "but", "still", "found", "changed", "proved"],
  examples: [
    "The answer changed when the evidence arrived. Useful timing.",
  ],
};

const BLAND_PHRASES = [
  "at ruby high, we",
  "today at ruby high",
  "we're excited",
  "we are excited",
  "in today's fast-paced",
  "ever-evolving landscape",
  "unlock your",
  "embark on",
  "delve into",
  "game changer",
  "game-changer",
  "the future is",
  "moving with purpose",
  "plenty to talk about",
  "great things happen",
  "proud of the hustle",
];

export function teacherSocialVoice(teacher: TeacherCharacter): TeacherSocialVoice {
  return SOCIAL_VOICES[teacher.id] ?? GENERIC_SOCIAL_VOICE;
}

export function teacherSocialVoicePrompt(teacher: TeacherCharacter): string {
  const voice = teacherSocialVoice(teacher);
  return [
    `Public voice card for ${teacher.displayName}:`,
    `- Point of view: ${voice.stance}`,
    `- Humor: ${voice.humor}`,
    `- Sentence rhythm: ${voice.rhythm}`,
    `- Useful objects and words: ${voice.anchors.join(", ")}.`,
    "- Model lines show the pattern only. Write fresh copy:",
    ...voice.examples.map((example) => `  - ${example}`),
    "House rule: one concrete receipt, one teacher judgment, one turn, then stop.",
  ].join("\n");
}

export function scoreTweetCandidate(
  text: string,
  teacher: TeacherCharacter,
  callToAction: PlannedTweetCallToAction | undefined,
  recentPosts: RecentPlannedPost[] = [],
): number {
  const lower = text.toLowerCase();
  const voice = teacherSocialVoice(teacher);
  let score = 0;

  if (text.length >= 45 && text.length <= 180) score += 4;
  else if (text.length <= 220) score += 2;
  if (sentenceCount(text) <= 2) score += 3;
  if ((text.match(/!/g) ?? []).length === 0) score += 1;
  if (!/#\w+/.test(text)) score += 1;
  if (/\d|['“”"]|:|—|→/.test(text)) score += 2;
  score += Math.min(4, voice.anchors.filter((word) => lower.includes(word)).length * 2);

  for (const phrase of BLAND_PHRASES) {
    if (lower.includes(phrase)) score -= 7;
  }
  if (callToAction === "reply") score += text.includes("?") ? 4 : -8;
  if (callToAction === "none" && text.includes("?")) score -= 2;
  if (callToAction === "take-class") {
    score += /take|class|try|test/i.test(text) ? 3 : -5;
  }
  if (recentPosts.some((post) => wordOverlap(text, post.text) >= 0.55)) score -= 8;
  return score;
}

function sentenceCount(text: string): number {
  const endings = text.match(/[.!?](?:\s|$)/g)?.length ?? 0;
  return Math.max(1, endings);
}

function wordOverlap(left: string, right: string): number {
  const leftWords = contentWords(left);
  const rightWords = contentWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let shared = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) shared += 1;
  }
  return shared / Math.min(leftWords.size, rightWords.size);
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
}
