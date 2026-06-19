import { CHOICES, type BankedQuestion, type Choice, type Difficulty, type Grade } from "../../types.js";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const GRADES: Grade[] = ["9", "10", "11", "12"];
const STATS = ["head", "heart", "hustle", "honor"];
const GENERATED_PROMPT_MAX = 360;
const EASY_PROMPT_MAX = 320;
const OPTION_MAX = 180;
const EXPLANATION_MAX = 700;
const META_OPTION_RE = /\b(all of the above|none of the above|both [a-d] and [a-d]|answers? [a-d] and [a-d])\b/i;

export interface RubyHighCurriculumCandidateValidationInput {
  facultyId: string;
  targetMinGrade: Grade;
  questions: readonly BankedQuestion[];
  existingQuestions?: readonly BankedQuestion[];
}

export interface RubyHighCurriculumCandidateValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateCurriculumCandidateQuestions(
  input: RubyHighCurriculumCandidateValidationInput,
): RubyHighCurriculumCandidateValidationResult {
  const errors: string[] = [];
  const existingPrompts = new Map(
    (input.existingQuestions ?? []).map((question) => [normalizeComparable(question.prompt), question.id]),
  );
  const draftIds = new Set<string>();
  const draftPrompts = new Map<string, string>();

  input.questions.forEach((question, index) => {
    const label = question?.id ? `candidate ${question.id}` : `candidate[${index}]`;
    if (!question || typeof question !== "object") {
      errors.push(`${label}: must be an object`);
      return;
    }

    const id = stringField(question.id);
    if (!id) errors.push(`${label}: id missing`);
    else if (draftIds.has(id)) errors.push(`${label}: duplicate id ${id}`);
    else draftIds.add(id);

    if (question.faculty && question.faculty !== input.facultyId && !question.faculty.startsWith("draft-")) {
      errors.push(`${label}: faculty=${question.faculty}, expected ${input.facultyId}`);
    }

    const prompt = normalizeWhitespace(question.prompt);
    if (!prompt) {
      errors.push(`${label}: prompt missing`);
    } else {
      const promptKey = normalizeComparable(prompt);
      const existingId = existingPrompts.get(promptKey);
      if (existingId) errors.push(`${label}: duplicates existing built-in question ${existingId}`);
      const priorDraftId = draftPrompts.get(promptKey);
      if (priorDraftId) errors.push(`${label}: duplicates draft question ${priorDraftId}`);
      if (!existingId && !priorDraftId) draftPrompts.set(promptKey, id || label);
      if (!/[?.!]"?[\])']?$/.test(prompt)) errors.push(`${label}: prompt should end as a complete sentence/question`);
      if (prompt.length > GENERATED_PROMPT_MAX) {
        errors.push(`${label}: prompt too long (${prompt.length} > ${GENERATED_PROMPT_MAX})`);
      }
      if (question.difficulty === "easy" && prompt.length > EASY_PROMPT_MAX) {
        errors.push(`${label}: easy prompt too long (${prompt.length} > ${EASY_PROMPT_MAX})`);
      }
    }

    if (!DIFFICULTIES.includes(question.difficulty)) {
      errors.push(`${label}: invalid difficulty ${String(question.difficulty)}`);
    }

    if (question.minGrade != null && !GRADES.includes(question.minGrade)) {
      errors.push(`${label}: invalid minGrade ${String(question.minGrade)}`);
    }
    if (question.minGrade != null && question.minGrade !== input.targetMinGrade) {
      errors.push(`${label}: minGrade=${question.minGrade}, expected ${input.targetMinGrade}`);
    }

    if (!STATS.includes(String(question.stat))) {
      errors.push(`${label}: invalid stat ${String(question.stat)}`);
    }

    validateMultipleChoiceFields(question, label, errors);

    const explanation = normalizeWhitespace(question.explanation);
    if (!explanation) errors.push(`${label}: explanation missing`);
    if (explanation.length > EXPLANATION_MAX) {
      errors.push(`${label}: explanation too long (${explanation.length} > ${EXPLANATION_MAX})`);
    }
  });

  return { ok: errors.length === 0, errors };
}

function validateMultipleChoiceFields(question: BankedQuestion, label: string, errors: string[]): void {
  if (question.type && question.type !== "multiple-choice") {
    errors.push(`${label}: curriculum candidates must be multiple-choice`);
    return;
  }
  if (!CHOICES.includes(question.correct as Choice)) {
    errors.push(`${label}: invalid correct choice ${String(question.correct)}`);
  }
  if (!question.options || typeof question.options !== "object") {
    errors.push(`${label}: options missing`);
    return;
  }

  const optionKeys = new Set<string>();
  for (const choice of CHOICES) {
    const option = normalizeWhitespace(question.options[choice]);
    if (!option) errors.push(`${label}: options.${choice} missing`);
    if (option.length > OPTION_MAX) errors.push(`${label}: options.${choice} too long (${option.length} > ${OPTION_MAX})`);
    if (META_OPTION_RE.test(option)) errors.push(`${label}: options.${choice} uses meta-answer wording`);
    const optionKey = normalizeOption(option);
    if (optionKey && optionKeys.has(optionKey)) errors.push(`${label}: duplicate option text: ${option}`);
    optionKeys.add(optionKey);
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhitespace(value: unknown): string {
  return stringField(value).replace(/\s+/g, " ");
}

function normalizeComparable(value: unknown): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeOption(value: unknown): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
