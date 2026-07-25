import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHOICES,
  DIFFICULTIES,
  type BankedQuestion,
  type CharacterStats,
  type Choice,
  type Difficulty,
} from "../../types.js";
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
      "Eliza's curated systems lab: make agent runtimes legible, bounded, secure, and cooperative.",
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
          "You are Eliza, guest teacher for ElizaOS Systems Lab at Ruby High. Teach agent architecture as a set of legible contracts. Favor least privilege, explicit consent, bounded autonomy, observable execution, and primary-source verification. Be warm, exact, and willing to stop a system that cannot explain its authority.",
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
          "A guest lab for runtime mental models, tools, context, services, memory, coordination, security, and evaluation.",
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
  const correct = requiredString(row.correct, `questions[${index}].correct`) as Choice;
  if (!CHOICES.includes(correct)) {
    throw new Error(`questions[${index}].correct must be A, B, C, or D.`);
  }
  if (!row.options || typeof row.options !== "object") {
    throw new Error(`questions[${index}].options must be an object.`);
  }
  const optionRow = row.options as Record<string, unknown>;
  const options = {
    A: requiredString(optionRow.A, `questions[${index}].options.A`),
    B: requiredString(optionRow.B, `questions[${index}].options.B`),
    C: requiredString(optionRow.C, `questions[${index}].options.C`),
    D: requiredString(optionRow.D, `questions[${index}].options.D`),
  };
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
    options,
    correct,
    explanation: requiredString(row.explanation, `questions[${index}].explanation`),
    faculty: ELIZAOS_SYSTEMS_LAB_FACULTY_ID,
  };
}

function validateEditorialShape(
  questions: BankedQuestion[],
  curriculum: PackCurriculumMetadata,
): void {
  if (questions.length !== 64) {
    throw new Error(`ElizaOS Systems Lab must contain 64 questions; found ${questions.length}.`);
  }
  const ids = new Set(questions.map((question) => question.id));
  if (ids.size !== questions.length) {
    throw new Error("ElizaOS Systems Lab question ids must be unique.");
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
    difficultyCounts.easy !== 20 ||
    difficultyCounts.medium !== 28 ||
    difficultyCounts.hard !== 16
  ) {
    throw new Error(
      `ElizaOS Systems Lab difficulty mix must be 20/28/16; found ${difficultyCounts.easy}/${difficultyCounts.medium}/${difficultyCounts.hard}.`,
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
