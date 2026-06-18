import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const FACULTY_FILES = [
  ["ruby", "assets/questions/ruby.json"],
  ["sally-science", "assets/questions/sally-science.json"],
  ["professor-edward", "assets/questions/professor-edward.json"],
];
const CHOICES = ["A", "B", "C", "D"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const GRADES = ["9", "10", "11", "12"];
const STATS = ["head", "heart", "hustle", "honor"];
const MIN_QUESTIONS_PER_FACULTY = 200;
const GENERATED_PROMPT_MAX = 360;
const EASY_PROMPT_MAX = 320;
const OPTION_MAX = 180;
const EXPLANATION_MAX = 700;
const MIN_PER_DIFFICULTY = 60;
const MIN_PER_STAT = 45;
const MAX_FRESHMAN_STARTER_CARDS = 36;
const META_OPTION_RE = /\b(all of the above|none of the above|both [a-d] and [a-d]|answers? [a-d] and [a-d])\b/i;

const failures = [];

for (const [facultyId, path] of FACULTY_FILES) {
  const parsed = JSON.parse(await readFile(resolve(root, path), "utf8"));
  if (parsed.faculty !== facultyId) {
    fail(path, `declares faculty=${parsed.faculty}, expected ${facultyId}`);
  }
  if (!Array.isArray(parsed.questions)) {
    fail(path, "questions must be an array");
    continue;
  }
  checkFaculty(path, facultyId, parsed.questions);
}

if (failures.length > 0) {
  console.error("question bank check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("question bank check ok");

function checkFaculty(path, facultyId, questions) {
  if (questions.length < MIN_QUESTIONS_PER_FACULTY) {
    fail(path, `expected at least ${MIN_QUESTIONS_PER_FACULTY} questions, found ${questions.length}`);
  }

  const seenIds = new Set();
  const seenPrompts = new Map();
  const difficulties = Object.fromEntries(DIFFICULTIES.map((key) => [key, 0]));
  const stats = Object.fromEntries(STATS.map((key) => [key, 0]));
  let freshmanStarterCards = 0;

  questions.forEach((question, index) => {
    const label = `${path} questions[${index}]${question?.id ? ` (${question.id})` : ""}`;
    if (!question || typeof question !== "object") {
      fail(label, "must be an object");
      return;
    }

    const id = stringField(question.id);
    if (!id) fail(label, "id missing");
    else if (seenIds.has(id)) fail(label, `duplicate id ${id}`);
    else seenIds.add(id);

    if (question.faculty && question.faculty !== facultyId) {
      fail(label, `faculty=${question.faculty}, expected ${facultyId}`);
    }

    const prompt = normalizeWhitespace(question.prompt);
    if (!prompt) fail(label, "prompt missing");
    else {
      const promptKey = normalizeComparable(prompt);
      const prior = seenPrompts.get(promptKey);
      if (prior) fail(label, `duplicate prompt with ${prior}`);
      else seenPrompts.set(promptKey, id || label);
      if (!/[?.!]"?[\])']?$/.test(prompt)) fail(label, "prompt should end as a complete sentence/question");
      if (prompt.length > GENERATED_PROMPT_MAX) fail(label, `prompt too long (${prompt.length} > ${GENERATED_PROMPT_MAX})`);
      if (question.difficulty === "easy" && prompt.length > EASY_PROMPT_MAX) {
        fail(label, `freshman/easy prompt too long (${prompt.length} > ${EASY_PROMPT_MAX})`);
      }
    }

    if (!DIFFICULTIES.includes(question.difficulty)) fail(label, `invalid difficulty ${question.difficulty}`);
    else difficulties[question.difficulty] += 1;

    const minGrade = question.minGrade == null ? null : stringField(question.minGrade);
    if (minGrade != null && !GRADES.includes(minGrade)) {
      fail(label, `invalid minGrade ${question.minGrade}`);
    }
    if (isGeneratedId(question.id)) {
      const expectedMinGrade = minimumGradeForGeneratedDifficulty(question.difficulty);
      if (minGrade !== expectedMinGrade) {
        fail(label, `generated ${question.difficulty} question must use minGrade ${expectedMinGrade}`);
      }
    } else if (question.difficulty === "easy" && !minGrade) {
      freshmanStarterCards += 1;
    }

    if (!STATS.includes(question.stat)) fail(label, `invalid stat ${question.stat}`);
    else stats[question.stat] += 1;

    if (!CHOICES.includes(question.correct)) fail(label, `invalid correct choice ${question.correct}`);
    if (!question.options || typeof question.options !== "object") {
      fail(label, "options missing");
    } else {
      const optionKeys = new Set();
      for (const choice of CHOICES) {
        const option = normalizeWhitespace(question.options[choice]);
        if (!option) fail(label, `options.${choice} missing`);
        if (option.length > OPTION_MAX) fail(label, `options.${choice} too long (${option.length} > ${OPTION_MAX})`);
        if (META_OPTION_RE.test(option)) fail(label, `options.${choice} uses meta-answer wording`);
        const optionKey = normalizeOption(option);
        if (optionKey && optionKeys.has(optionKey)) fail(label, `duplicate option text: ${option}`);
        optionKeys.add(optionKey);
      }
    }

    const explanation = normalizeWhitespace(question.explanation);
    if (!explanation) fail(label, "explanation missing");
    if (explanation.length > EXPLANATION_MAX) fail(label, `explanation too long (${explanation.length} > ${EXPLANATION_MAX})`);
  });

  for (const difficulty of DIFFICULTIES) {
    if (difficulties[difficulty] < MIN_PER_DIFFICULTY) {
      fail(path, `${facultyId} has only ${difficulties[difficulty]} ${difficulty} questions`);
    }
  }
  for (const stat of STATS) {
    if (stats[stat] < MIN_PER_STAT) {
      fail(path, `${facultyId} has only ${stats[stat]} ${stat} questions`);
    }
  }
  if (freshmanStarterCards > MAX_FRESHMAN_STARTER_CARDS) {
    fail(path, `${facultyId} exposes ${freshmanStarterCards} ungated easy starter cards to Freshmen; max ${MAX_FRESHMAN_STARTER_CARDS}`);
  }
}

function fail(scope, message) {
  failures.push(`${scope}: ${message}`);
}

function stringField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isGeneratedId(id) {
  return /-gen-\d+$/.test(stringField(id));
}

function minimumGradeForGeneratedDifficulty(difficulty) {
  if (difficulty === "easy") return "10";
  if (difficulty === "medium") return "11";
  return "12";
}

function normalizeWhitespace(value) {
  return stringField(value).replace(/\s+/g, " ");
}

function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeOption(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
