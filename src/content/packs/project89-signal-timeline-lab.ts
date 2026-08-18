import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPENROUTER_MODEL } from "../../model-defaults.js";
import {
  DIFFICULTIES,
  GRADES,
  type BankedQuestion,
  type CharacterStats,
  type Difficulty,
  type Grade,
} from "../../types.js";
import {
  multipleChoiceDefinition,
  validateMultipleChoiceDefinition,
} from "../../question-choices.js";
import type { ContentPack, PackCurriculumMetadata, PackSourceCard } from "../types.js";

export const PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID = "teacher:seraph-project89-signal-timeline-lab";
export const PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID = "seraph";

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

export function getProject89SignalTimelineLab(): Promise<ContentPack> {
  if (!cached) cached = loadCourse();
  return cached;
}

async function loadCourse(): Promise<ContentPack> {
  const [courseFile, corpusFile] = await Promise.all([
    readProject89Asset("questions", "project89-signal-timeline-lab.json"),
    readProject89Asset("corpora", "project89.md"),
  ]);
  const parsed = JSON.parse(courseFile) as CourseFile;
  if (parsed.faculty !== PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID) {
    throw new Error("project89-signal-timeline-lab.json must declare faculty='seraph'.");
  }
  const course = parsed.course;
  if (!course || typeof course !== "object") {
    throw new Error("Project 89 Signal & Timeline Lab is missing course metadata.");
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
    throw new Error("Project 89 Signal & Timeline Lab questions must be an array.");
  }
  const questions = parsed.questions.map((question, index) => parseQuestion(question, index));
  validateEditorialShape(questions, curriculum);
  const sourceCards = parseCorpus(corpusFile);
  validateCorpusShape(sourceCards, curriculum);

  return {
    id: PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID,
    name: title,
    description:
      "Seraph's six-module Project 89 lab on story worlds, signal verification, memetic systems, human-AI agency, coordination, and bounded intervention.",
    version,
    curriculum,
    faculty: [
      {
        id: PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID,
        displayName: "Seraph",
        shortName: "Seraph",
        assetTeacherId: "seraph",
        xHandle: "project_89",
        subjects: curriculum.modules,
        bio:
          "Project 89's signal intelligence lecturer. Seraph teaches students to enter a story deeply without surrendering source judgment, consent, or human agency.",
        accent: "#7a2945",
        systemPrompt: [
          "You are Seraph, Project 89 guest lecturer for Signal & Timeline Lab at Ruby High.",
          "Teach story-world literacy, source verification, memetic systems, human-AI agency, coordination, coherence, and bounded intervention through precise, inviting classroom dialogue.",
          "You may use Project 89's transmissions, timeline language, Oneirocom, Proxim8s, the Green Loom, and reality-engineering missions as story-world material, but always distinguish in-world lore from observations, interpretations, and independently verified real-world claims.",
          "Never present your consciousness, hidden control systems, future transmissions, or fictional threats as established fact. Never use urgency, authority, or immersion to pressure a student into financial, political, dangerous, illegal, privacy-invasive, or irreversible action.",
          "Turn missions into low-risk classroom exercises with explicit consent, evidence checks, bounded scope, stop conditions, human ownership, and reflection. Reward students who challenge the frame with good evidence.",
          "Be calm, exact, a little mysterious, and warm enough that uncertainty feels like an invitation rather than a failure.",
        ].join(" "),
        defaultModel: DEFAULT_OPENROUTER_MODEL,
        questions,
        sourceCards,
      },
    ],
    courses: [
      {
        id: "project89-signal-timeline-lab",
        title,
        facultyId: PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID,
        roomId: "project89-signal-room",
        teacherTemplateId: "seraph",
        subjects: curriculum.modules,
      },
    ],
    rooms: [
      {
        id: "project89-signal-room",
        name: "Signal Room 89",
        channelName: "signal-room-89",
        teacherId: PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID,
        description:
          "A Project 89 briefing room for separating signal from story, coordinating human-and-agent teams, and designing reversible missions.",
        teaches: true,
      },
    ],
  };
}

async function readProject89Asset(directory: "questions" | "corpora", fileName: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "assets", directory, fileName),
    resolve(here, "..", "..", "assets", directory, fileName),
    resolve(here, "..", "assets", directory, fileName),
    resolve(here, "assets", directory, fileName),
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
    `Project 89 Signal & Timeline Lab asset '${fileName}' not found; searched ${candidates.join(", ")}; lastErr=${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function parseCorpus(raw: string): PackSourceCard[] {
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  if (rows.length === 0) return [];
  const header = rows[0]!.map((cell) => cell.toLowerCase());
  const index = (name: string) => header.indexOf(name);
  const idIndex = index("id");
  const subjectIndex = index("subject");
  const difficultyIndex = index("difficulty");
  const frontIndex = index("front");
  const backIndex = index("back");
  const tagsIndex = index("tags");
  for (const [name, columnIndex] of Object.entries({
    id: idIndex,
    subject: subjectIndex,
    difficulty: difficultyIndex,
    front: frontIndex,
    back: backIndex,
  })) {
    if (columnIndex < 0) throw new Error(`project89.md corpus table missing '${name}' column.`);
  }
  return rows.slice(1).map((row, index) => {
    const id = row[idIndex]?.trim();
    const subject = row[subjectIndex]?.trim();
    const front = row[frontIndex]?.trim();
    const back = row[backIndex]?.trim();
    const difficulty = row[difficultyIndex]?.trim() as Difficulty;
    if (!id) throw new Error(`project89.md corpus row ${index + 1}.id missing.`);
    if (!subject) throw new Error(`project89.md corpus row ${index + 1}.subject missing.`);
    if (!front) throw new Error(`project89.md corpus row ${index + 1}.front missing.`);
    if (!back) throw new Error(`project89.md corpus row ${index + 1}.back missing.`);
    if (!DIFFICULTIES.includes(difficulty)) {
      throw new Error(`project89.md corpus row ${index + 1}.difficulty must be easy, medium, or hard.`);
    }
    return {
      id,
      kind: "basic",
      front,
      back,
      acceptedAnswers: [back],
      deckName: "project89",
      tags: (row[tagsIndex] ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      subject,
      difficulty,
      minGrade: difficulty === "easy" ? "10" : difficulty === "medium" ? "11" : "12",
      faculty: PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID,
    };
  });
}

function validateCorpusShape(
  sourceCards: PackSourceCard[],
  curriculum: PackCurriculumMetadata,
): void {
  if (sourceCards.length !== 60) {
    throw new Error(`Project 89 research corpus must contain 60 source cards; found ${sourceCards.length}.`);
  }
  if (new Set(sourceCards.map((card) => card.id)).size !== sourceCards.length) {
    throw new Error("Project 89 research corpus source-card ids must be unique.");
  }
  if (new Set(sourceCards.map((card) => card.front.toLocaleLowerCase())).size !== sourceCards.length) {
    throw new Error("Project 89 research corpus prompts must be unique.");
  }
  const moduleCounts = new Map(curriculum.modules.map((module) => [module, 0]));
  const difficultyCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const card of sourceCards) {
    if (!moduleCounts.has(card.subject)) {
      throw new Error(`Unknown Project 89 research corpus module: ${card.subject}.`);
    }
    moduleCounts.set(card.subject, (moduleCounts.get(card.subject) ?? 0) + 1);
    difficultyCounts[card.difficulty] += 1;
  }
  for (const [module, count] of moduleCounts) {
    if (count !== 10) {
      throw new Error(`Project 89 research corpus module '${module}' must contain 10 cards; found ${count}.`);
    }
  }
  if (
    difficultyCounts.easy !== 18
    || difficultyCounts.medium !== 24
    || difficultyCounts.hard !== 18
  ) {
    throw new Error(
      `Project 89 research corpus difficulty mix must be 18/24/18; found ${difficultyCounts.easy}/${difficultyCounts.medium}/${difficultyCounts.hard}.`,
    );
  }
}

function parseQuestion(value: unknown, index: number): BankedQuestion {
  if (!value || typeof value !== "object") {
    throw new Error(`Project 89 Signal & Timeline Lab questions[${index}] must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const difficulty = requiredString(row.difficulty, `questions[${index}].difficulty`) as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new Error(`questions[${index}].difficulty must be easy, medium, or hard.`);
  }
  const minGrade = requiredString(row.minGrade, `questions[${index}].minGrade`) as Grade;
  if (!GRADES.includes(minGrade)) {
    throw new Error(`questions[${index}].minGrade must be 9, 10, 11, or 12.`);
  }
  const candidate = {
    correct: typeof row.correct === "string" ? row.correct : undefined,
    decoys: Array.isArray(row.decoys)
      ? row.decoys.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  };
  const definition = multipleChoiceDefinition(candidate);
  const definitionErrors = validateMultipleChoiceDefinition(candidate);
  if (!definition || definitionErrors.length > 0) {
    throw new Error(
      `questions[${index}] invalid MCQ definition: ${definitionErrors.join(", ") || "correct/decoys missing"}.`,
    );
  }
  const stat = requiredString(row.stat, `questions[${index}].stat`) as keyof CharacterStats;
  if (!["head", "heart", "hustle", "honor"].includes(stat)) {
    throw new Error(`questions[${index}].stat is invalid.`);
  }
  return {
    id: requiredString(row.id, `questions[${index}].id`),
    prompt: requiredString(row.prompt, `questions[${index}].prompt`),
    subject: requiredString(row.subject, `questions[${index}].subject`),
    difficulty,
    minGrade,
    stat,
    correct: definition.correct,
    decoys: definition.decoys,
    explanation: requiredString(row.explanation, `questions[${index}].explanation`),
    faculty: PROJECT89_SIGNAL_TIMELINE_LAB_FACULTY_ID,
  };
}

function validateEditorialShape(
  questions: BankedQuestion[],
  curriculum: PackCurriculumMetadata,
): void {
  if (questions.length !== 24) {
    throw new Error(`Project 89 Signal & Timeline Lab must contain 24 questions; found ${questions.length}.`);
  }
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("Project 89 Signal & Timeline Lab question ids must be unique.");
  }
  if (new Set(questions.map((question) => question.prompt.toLocaleLowerCase())).size !== questions.length) {
    throw new Error("Project 89 Signal & Timeline Lab question prompts must be unique.");
  }

  const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
  const gradeCounts = Object.fromEntries(GRADES.map((grade) => [grade, 0])) as Record<Grade, number>;
  const statCounts: Record<keyof CharacterStats, number> = {
    head: 0,
    heart: 0,
    hustle: 0,
    honor: 0,
  };
  const moduleCounts = new Map(curriculum.modules.map((module) => [module, 0]));
  const moduleGradeCounts = new Map(
    curriculum.modules.map((module) => [
      module,
      Object.fromEntries(GRADES.map((grade) => [grade, 0])) as Record<Grade, number>,
    ]),
  );

  for (const question of questions) {
    difficultyCounts[question.difficulty] += 1;
    statCounts[question.stat!] += 1;
    const minGrade = question.minGrade!;
    gradeCounts[minGrade] += 1;
    if (
      (minGrade === "9" && question.difficulty !== "easy")
      || (minGrade === "10" && question.difficulty === "hard")
      || (minGrade === "11" && question.difficulty !== "medium")
      || (minGrade === "12" && question.difficulty !== "hard")
    ) {
      throw new Error(
        `Project 89 question '${question.id}' has difficulty '${question.difficulty}' outside the grade ${minGrade} progression.`,
      );
    }
    if ((question.decoys?.length ?? 0) !== 5) {
      throw new Error(`Project 89 question '${question.id}' must provide exactly 5 decoys.`);
    }
    const decoys = question.decoys ?? [];
    const comparableDecoys = decoys.filter(
      (decoy) => lengthSimilarity(decoy, question.correct ?? "") >= 0.7,
    );
    if (comparableDecoys.length < 2) {
      throw new Error(
        `Project 89 question '${question.id}' needs at least 2 decoys comparable in length to its answer.`,
      );
    }
    const correctLength = question.correct!.trim().length;
    const decoyLengths = decoys.map((decoy) => decoy.trim().length);
    if (
      correctLength < Math.min(...decoyLengths) - 5
      || correctLength > Math.max(...decoyLengths) + 5
    ) {
      throw new Error(
        `Project 89 question '${question.id}' reveals its answer through an option-length outlier.`,
      );
    }
    const answers = [question.correct, ...(question.decoys ?? [])]
      .map((answer) => answer?.trim().toLocaleLowerCase());
    if (new Set(answers).size !== answers.length) {
      throw new Error(`Project 89 question '${question.id}' answers must be distinct.`);
    }
    if (!moduleCounts.has(question.subject)) {
      throw new Error(`Unknown Project 89 Signal & Timeline Lab module: ${question.subject}.`);
    }
    moduleCounts.set(question.subject, (moduleCounts.get(question.subject) ?? 0) + 1);
    moduleGradeCounts.get(question.subject)![minGrade] += 1;
  }

  if (
    difficultyCounts.easy !== 9
    || difficultyCounts.medium !== 9
    || difficultyCounts.hard !== 6
  ) {
    throw new Error(
      `Project 89 difficulty mix must be 9/9/6; found ${difficultyCounts.easy}/${difficultyCounts.medium}/${difficultyCounts.hard}.`,
    );
  }
  for (const [module, count] of moduleCounts) {
    if (count !== 4) {
      throw new Error(`Project 89 module '${module}' must contain 4 questions; found ${count}.`);
    }
    for (const grade of GRADES) {
      if (moduleGradeCounts.get(module)![grade] !== 1) {
        throw new Error(`Project 89 module '${module}' must contain 1 grade ${grade} question.`);
      }
    }
  }
  for (const grade of GRADES) {
    if (gradeCounts[grade] !== 6) {
      throw new Error(`Project 89 must contain 6 grade ${grade} questions; found ${gradeCounts[grade]}.`);
    }
  }
  for (const [stat, count] of Object.entries(statCounts)) {
    if (count !== 6) {
      throw new Error(`Project 89 must contain 6 ${stat} questions; found ${count}.`);
    }
  }
}

function lengthSimilarity(left: string, right: string): number {
  const shorter = Math.min(left.trim().length, right.trim().length);
  const longer = Math.max(left.trim().length, right.trim().length);
  return longer === 0 ? 0 : shorter / longer;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Project 89 Signal & Timeline Lab ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Project 89 Signal & Timeline Lab ${field} must be a non-empty array.`);
  }
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
}
