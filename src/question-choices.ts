import {
  CHOICES,
  type Choice,
  type Question,
} from "./types.js";

type MultipleChoiceLike = Pick<Question, "correct" | "decoys" | "options" | "correctChoice">;

export interface MultipleChoiceDefinition {
  correct: string;
  decoys: string[];
}

export interface MaterializedMultipleChoice extends MultipleChoiceDefinition {
  options: Record<Choice, string>;
  correctChoice: Choice;
}

export interface MaterializedStoryChoice {
  storyChoices: string[];
  options: Record<Choice, string>;
}

/** Put four story moves on A-D without inventing a correct answer. */
export function materializeStoryChoices(
  choices: unknown,
  options: { shuffle?: boolean; rng?: () => number } = {},
): MaterializedStoryChoice {
  const authored = uniqueAnswers(cleanAnswers(choices));
  if (authored.length !== 4) {
    throw new Error("Story-choice question needs exactly four unique choices.");
  }
  const placedChoices = options.shuffle === false
    ? authored
    : shuffled(authored, options.rng ?? Math.random);
  const placed = {} as Record<Choice, string>;
  placedChoices.forEach((answer, index) => {
    placed[CHOICES[index]!] = answer;
  });
  return { storyChoices: authored, options: placed };
}

/**
 * Read the semantic MCQ definition.
 *
 * The options/correct-letter branch is intentionally retained for persisted
 * custom packs and in-flight sessions written before the value-based schema.
 * New definitions must use `correct` answer text plus `decoys`.
 */
export function multipleChoiceDefinition(
  question: MultipleChoiceLike,
): MultipleChoiceDefinition | null {
  const correct = cleanAnswer(question.correct);
  const authoredDecoys = cleanAnswers(question.decoys);
  if (correct && authoredDecoys.length > 0) {
    return { correct, decoys: withoutAnswer(authoredDecoys, correct) };
  }

  const options = question.options;
  if (!options) return null;
  const legacyCorrectChoice = validChoice(question.correctChoice)
    ?? (validChoice(correct) && !question.decoys ? correct as Choice : null);
  const correctAnswer = legacyCorrectChoice
    ? cleanAnswer(options[legacyCorrectChoice])
    : correct && Object.values(options).some((answer) => sameAnswer(answer, correct))
      ? correct
      : null;
  if (!correctAnswer) return null;

  const decoys = CHOICES
    .filter((choice) => choice !== legacyCorrectChoice)
    .map((choice) => options[choice])
    .filter((answer) => !sameAnswer(answer, correctAnswer));
  return { correct: correctAnswer, decoys: uniqueAnswers(decoys) };
}

/** Return the shuffled slot that grading must use for a posed question. */
export function correctChoiceForQuestion(question: MultipleChoiceLike): Choice | null {
  const explicit = validChoice(question.correctChoice);
  if (explicit) return explicit;

  // Backwards compatibility for a persisted/in-flight legacy board.
  const legacy = validChoice(question.correct);
  return legacy && question.options && !question.decoys ? legacy : null;
}

/** Return the semantic correct answer for authored or already-posed cards. */
export function correctAnswerForQuestion(question: MultipleChoiceLike): string | null {
  return multipleChoiceDefinition(question)?.correct ?? null;
}

/**
 * Sample three decoys, mix them with the correct answer, and assign A-D.
 * Randomness is injectable so tests can cover both selection and placement.
 */
export function materializeMultipleChoice(
  question: MultipleChoiceLike,
  options: {
    shuffle?: boolean;
    rng?: () => number;
  } = {},
): MaterializedMultipleChoice {
  const definition = multipleChoiceDefinition(question);
  if (!definition?.correct) {
    throw new Error("Multiple-choice question is missing its correct answer.");
  }
  const decoys = uniqueAnswers(withoutAnswer(definition.decoys, definition.correct));
  if (decoys.length < 3) {
    throw new Error("Multiple-choice question needs at least three unique decoys.");
  }

  const shuffle = options.shuffle !== false;
  const rng = options.rng ?? Math.random;
  const selectedDecoys = shuffle
    ? shuffled(decoys, rng).slice(0, 3)
    : decoys.slice(0, 3);
  const answers = [
    { text: definition.correct, isCorrect: true },
    ...selectedDecoys.map((text) => ({ text, isCorrect: false })),
  ];
  if (shuffle) shuffleInPlace(answers, rng);

  const placed = {} as Record<Choice, string>;
  let correctChoice: Choice = "A";
  answers.forEach((answer, index) => {
    const choice = CHOICES[index]!;
    placed[choice] = answer.text;
    if (answer.isCorrect) correctChoice = choice;
  });
  return {
    correct: definition.correct,
    decoys,
    options: placed,
    correctChoice,
  };
}

export function validateMultipleChoiceDefinition(
  question: MultipleChoiceLike,
): string[] {
  const definition = multipleChoiceDefinition(question);
  if (!definition?.correct) return ["correct answer missing"];
  const errors: string[] = [];
  const decoys = uniqueAnswers(withoutAnswer(definition.decoys, definition.correct));
  if (decoys.length < 3) errors.push("at least three unique decoys are required");
  if (cleanAnswers(question.decoys).some((answer) => sameAnswer(answer, definition.correct))) {
    errors.push("correct answer must not appear in decoys");
  }
  return errors;
}

function validChoice(value: unknown): Choice | null {
  return typeof value === "string" && CHOICES.includes(value as Choice)
    ? value as Choice
    : null;
}

function cleanAnswer(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAnswers(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanAnswer).filter(Boolean)
    : [];
}

function answerKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function sameAnswer(left: string, right: string): boolean {
  return answerKey(left) === answerKey(right);
}

function withoutAnswer(values: string[], answer: string): string[] {
  return values.filter((value) => !sameAnswer(value, answer));
}

function uniqueAnswers(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of cleanAnswers(values)) {
    const key = answerKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function shuffled<T>(values: readonly T[], rng: () => number): T[] {
  const result = values.slice();
  shuffleInPlace(result, rng);
  return result;
}

function shuffleInPlace<T>(values: T[], rng: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex]!, values[index]!];
  }
}
