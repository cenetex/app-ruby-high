import type { CharacterStats, Question } from "./types.js";
import { correctAnswerForQuestion } from "./question-choices.js";

export type QuestionStat = keyof CharacterStats;

export const QUESTION_STATS: readonly QuestionStat[] = ["head", "heart", "hustle", "honor"] as const;

export function normalizeQuestionStat(value: unknown): QuestionStat | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return QUESTION_STATS.includes(v as QuestionStat) ? (v as QuestionStat) : null;
}

export function statForQuestion(
  question: Pick<Question, "stat" | "prompt" | "subject" | "explanation" | "options" | "correct" | "decoys" | "correctChoice">,
): QuestionStat {
  const explicit = normalizeQuestionStat(question.stat);
  if (explicit) return explicit;
  return classifyQuestionStat({
    prompt: question.prompt,
    subject: question.subject,
    explanation: question.explanation,
    correctAnswer: correctAnswerForQuestion(question) ?? undefined,
  });
}

export function classifyQuestionStat(input: {
  prompt?: string;
  subject?: string;
  explanation?: string;
  correctAnswer?: string;
}): QuestionStat {
  const text = [
    input.subject,
    input.prompt,
    input.correctAnswer,
    input.explanation,
  ].filter(Boolean).join(" ").toLowerCase();

  const scores: Record<QuestionStat, number> = {
    head: 1,
    heart: 0,
    hustle: 0,
    honor: 0,
  };

  addMatches(scores, "heart", text, [
    "empathy", "feel", "feeling", "relationship", "community", "friend", "kind",
    "motivat", "care", "trust", "tone", "voice", "emotion", "social", "support",
    "belong", "identity", "perspective", "audience", "conversation", "dialogue",
  ]);
  addMatches(scores, "hustle", text, [
    "calculate", "solve", "compute", "estimate", "speed", "fast", "quick", "rate",
    "force", "motion", "experiment", "lab", "procedure", "step", "first", "next",
    "apply", "practical", "build", "make", "run", "measure", "graph", "equation",
    "chemistry", "physics",
  ]);
  addMatches(scores, "honor", text, [
    "rule", "ethic", "honest", "integrity", "discipline", "duty", "responsib",
    "source", "citation", "evidence", "proof", "law", "policy", "safety",
    "permission", "consent", "fair", "bias", "reliable", "contract", "standard",
  ]);
  addMatches(scores, "head", text, [
    "define", "definition", "term", "concept", "theory", "which", "what", "why",
    "biology", "literature", "history", "grammar", "vocab", "meaning", "identify",
    "describe", "compare", "analyze", "interpret", "classification", "fact",
  ]);

  const order: QuestionStat[] = ["head", "heart", "hustle", "honor"];
  return order.reduce((best, stat) => scores[stat] > scores[best] ? stat : best, "head");
}

function addMatches(
  scores: Record<QuestionStat, number>,
  stat: QuestionStat,
  text: string,
  needles: string[],
): void {
  for (const needle of needles) {
    if (text.includes(needle)) scores[stat] += 1;
  }
}
