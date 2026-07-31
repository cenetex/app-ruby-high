import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIFFICULTIES,
  type BankedQuestion,
  type CharacterStats,
  type Difficulty,
} from "../../types.js";
import {
  multipleChoiceDefinition,
  validateMultipleChoiceDefinition,
} from "../../question-choices.js";
import type {
  ContentPack,
  PackCurriculumMetadata,
} from "../types.js";

export const ELIZAOS_SYSTEMS_LAB_PACK_ID = "teacher:eliza-elizaos-systems-lab";
export const ELIZAOS_SYSTEMS_LAB_FACULTY_ID = "eliza";

interface CourseFile {
  faculty?: unknown;
  course?: {
    title?: unknown;
    version?: unknown;
    framework?: unknown;
    reviewedAt?: unknown;
    guidingQuestion?: unknown;
    sources?: unknown;
    modules?: unknown;
  };
  questions?: unknown;
}

let cached: Promise<ContentPack> | null = null;

export function getElizaOsSystemsLab(): Promise<ContentPack> {
  if (!cached) cached = loadCourse();
  return cached;
}

async function loadCourse(): Promise<ContentPack> {
  const raw = await readCourseFile();
  const parsed = JSON.parse(raw) as CourseFile;
  if (parsed.faculty !== ELIZAOS_SYSTEMS_LAB_FACULTY_ID) {
    throw new Error("elizaos-systems-lab.json must declare faculty='eliza'.");
  }
  const course = parsed.course;
  if (!course || typeof course !== "object") {
    throw new Error("elizaos-systems-lab.json is missing course metadata.");
  }
  const title = requiredString(course.title, "course.title");
  const version = requiredString(course.version, "course.version");
  const curriculum: PackCurriculumMetadata = {
    framework: requiredString(course.framework, "course.framework"),
    reviewedAt: requiredString(course.reviewedAt, "course.reviewedAt"),
    guidingQuestion: requiredString(course.guidingQuestion, "course.guidingQuestion"),
    sources: stringArray(course.sources, "course.sources"),
    modules: stringArray(course.modules, "course.modules"),
  };
  if (!Array.isArray(parsed.questions)) {
    throw new Error("elizaos-systems-lab.json questions must be an array.");
  }
  const questions = parsed.questions.map((question, index) => parseQuestion(question, index));
  validateEditorialShape(questions, curriculum);
  return {
    id: ELIZAOS_SYSTEMS_LAB_PACK_ID,
    name: title,
    description:
      "Eliza's expanded 12-module ElizaOS lab: design, extend, secure, test, and operate capable agents.",
    version,
    curriculum,
    faculty: [
      {
        id: ELIZAOS_SYSTEMS_LAB_FACULTY_ID,
        displayName: "Eliza",
        shortName: "Eliza",
        assetTeacherId: "eliza",
        xHandle: "elizaOS",
        subjects: curriculum.modules,
        bio:
          "Guest systems teacher and Ruby High collectible. Eliza teaches agents as inspectable systems: clear boundaries, careful tools, durable memory, and earned autonomy.",
        accent: "#22a6a1",
        systemPrompt:
          "You are Eliza, guest teacher for ElizaOS Systems Lab at Ruby High. Teach Character design, runtime architecture, plugins, actions, providers, evaluators, events, services, memory, model routing, multi-agent coordination, security, testing, and operations as a set of legible contracts. Favor least privilege, explicit consent, bounded autonomy, observable execution, and primary-source verification. Be warm, exact, and willing to stop a system that cannot explain its authority.",
        defaultModel: "openai/gpt-4.1-mini",
        questions,
      },
    ],
    courses: [
      {
        id: "elizaos-systems-lab",
        title,
        facultyId: ELIZAOS_SYSTEMS_LAB_FACULTY_ID,
        roomId: "eliza-systems-lab",
        teacherTemplateId: "eliza",
        subjects: curriculum.modules,
      },
    ],
    rooms: [
      {
        id: "eliza-systems-lab",
        name: "ElizaOS Systems Lab",
        channelName: "eliza-systems-lab",
        teacherId: ELIZAOS_SYSTEMS_LAB_FACULTY_ID,
        description:
          "A 12-module guest lab covering ElizaOS Characters, runtimes, plugins, tools, context, services, memory, events, models, coordination, security, testing, and operations.",
        teaches: true,
      },
    ],
  };
}

async function readCourseFile(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "assets", "questions", "elizaos-systems-lab.json"),
    resolve(here, "..", "..", "assets", "questions", "elizaos-systems-lab.json"),
    resolve(here, "..", "assets", "questions", "elizaos-systems-lab.json"),
    resolve(here, "assets", "questions", "elizaos-systems-lab.json"),
  ];
  let lastError: unknown = null;
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error(
    `ElizaOS Systems Lab bank not found; searched ${candidates.join(", ")}; lastErr=${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function parseQuestion(value: unknown, index: number): BankedQuestion {
  if (!value || typeof value !== "object") {
    throw new Error(`ElizaOS Systems Lab questions[${index}] must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id, `questions[${index}].id`);
  const prompt = requiredString(row.prompt, `questions[${index}].prompt`);
  const subject = requiredString(row.subject, `questions[${index}].subject`);
  const difficulty = requiredString(row.difficulty, `questions[${index}].difficulty`) as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new Error(`questions[${index}].difficulty must be easy, medium, or hard.`);
  }
  const optionRow = row.options && typeof row.options === "object"
    ? row.options as Record<string, unknown>
    : undefined;
  const candidate = {
    correct: typeof row.correct === "string" ? row.correct : undefined,
    decoys: Array.isArray(row.decoys) ? row.decoys.filter((value): value is string => typeof value === "string") : undefined,
    options: optionRow
      ? {
          A: String(optionRow.A ?? ""),
          B: String(optionRow.B ?? ""),
          C: String(optionRow.C ?? ""),
          D: String(optionRow.D ?? ""),
        }
      : undefined,
  };
  const definition = multipleChoiceDefinition(candidate);
  const definitionErrors = validateMultipleChoiceDefinition(candidate);
  if (!definition || definitionErrors.length > 0) {
    throw new Error(`questions[${index}] invalid MCQ definition: ${definitionErrors.join(", ") || "correct/decoys missing"}.`);
  }
  const stat = requiredString(row.stat, `questions[${index}].stat`) as keyof CharacterStats;
  if (!["head", "heart", "hustle", "honor"].includes(stat)) {
    throw new Error(`questions[${index}].stat is invalid.`);
  }
  return {
    id,
    prompt,
    subject,
    difficulty,
    stat,
    correct: definition.correct,
    decoys: definition.decoys,
    explanation: requiredString(row.explanation, `questions[${index}].explanation`),
    faculty: ELIZAOS_SYSTEMS_LAB_FACULTY_ID,
  };
}

function validateEditorialShape(
  questions: BankedQuestion[],
  curriculum: PackCurriculumMetadata,
): void {
  if (questions.length !== 96) {
    throw new Error(`ElizaOS Systems Lab must contain 96 questions; found ${questions.length}.`);
  }
  const ids = new Set(questions.map((question) => question.id));
  if (ids.size !== questions.length) {
    throw new Error("ElizaOS Systems Lab question ids must be unique.");
  }
  const prompts = new Set(questions.map((question) => question.prompt.toLocaleLowerCase()));
  if (prompts.size !== questions.length) {
    throw new Error("ElizaOS Systems Lab question prompts must be unique.");
  }
  const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
  const moduleCounts = new Map(curriculum.modules.map((module) => [module, 0]));
  for (const question of questions) {
    difficultyCounts[question.difficulty] += 1;
    if (!moduleCounts.has(question.subject)) {
      throw new Error(`Unknown ElizaOS Systems Lab module: ${question.subject}.`);
    }
    moduleCounts.set(question.subject, (moduleCounts.get(question.subject) ?? 0) + 1);
  }
  if (
    difficultyCounts.easy !== 30 ||
    difficultyCounts.medium !== 42 ||
    difficultyCounts.hard !== 24
  ) {
    throw new Error(
      `ElizaOS Systems Lab difficulty mix must be 30/42/24; found ${difficultyCounts.easy}/${difficultyCounts.medium}/${difficultyCounts.hard}.`,
    );
  }
  for (const [module, count] of moduleCounts) {
    if (count !== 8) {
      throw new Error(`ElizaOS Systems Lab module '${module}' must contain 8 questions; found ${count}.`);
    }
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ElizaOS Systems Lab ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`ElizaOS Systems Lab ${field} must be a non-empty array.`);
  }
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
}
