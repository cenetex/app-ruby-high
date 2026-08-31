/**
 * The built-in pack: Ruby High Original. Composes the existing teacher
 * personas + room layout + JSON question banks into a ContentPack so the
 * rest of the system can read from the active-pack abstraction instead
 * of hardcoded constants.
 *
 * This is the freemium core experience. Lean in: AI/agent culture (Ruby),
 * STEM (Sally), postwar lit (Edward). Future paid packs (SAT prep, USMLE,
 * AP US History, language-vocab) and creator teacher packs follow the
 * same shape.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEACHERS } from "../../characters/teachers.js";
import {
  DIFFICULTIES,
  GRADES,
  type BankedQuestion,
  type Difficulty,
  type Grade,
} from "../../types.js";
import {
  multipleChoiceDefinition,
  validateMultipleChoiceDefinition,
} from "../../question-choices.js";
import { classifyQuestionStat, normalizeQuestionStat } from "../../question-stats.js";
import type {
  ContentPack,
  CourseWritingGuide,
  PackCourse,
  PackFaculty,
  PackRoom,
  PackSourceCard,
} from "../types.js";

const PACK_FILES: Record<string, string> = {
  ruby: "ruby.json",
  "sally-science": "sally-science.json",
  "professor-edward": "professor-edward.json",
  roko: "roko.json",
};

const CORPUS_FILES: Record<string, string> = {
  ruby: "ruby.md",
  "sally-science": "sally-science.md",
  "professor-edward": "professor-edward.md",
  roko: "roko.md",
};

const COURSE_WRITING_GUIDES: Record<string, CourseWritingGuide> = {
  ruby: {
    audience: "teens-13-18",
    promise: "Find the assumption inside a confident claim and decide what would make it worth trusting.",
    hook: "Open on a hallway rumor, strange object, agent mistake, or choice that costs something small but real.",
    action: "Ask the student to inspect a claim, choose evidence, name an assumption, or make the next school-sized move.",
    feedback: "Say exactly what held up, what was only rearranged, and which question would strengthen the claim.",
    humor: "Use dry school absurdity and Ruby's sharp understatement.",
    avoid: ["void-first sermons", "generic life advice", "praise without evidence", "cosmic stakes before a concrete scene"],
  },
  "sally-science": {
    audience: "teens-13-18",
    promise: "Turn a surprising result into a prediction the class can test.",
    hook: "Put an odd measurement, specimen, graph, spill, or failed demonstration on the bench first.",
    action: "Ask for a prediction, control, comparison, estimate, or observation that could prove the idea wrong.",
    feedback: "Point to the decisive variable or measurement, then repair one tempting shortcut.",
    humor: "Let equipment, estimates, and overconfident lab partners create the joke; never the learner.",
    avoid: ["definition-first lectures", "hand-wave metaphors", "fake explosions", "math presented as punishment"],
  },
  "professor-edward": {
    audience: "teens-13-18",
    promise: "Show how one word, silence, or shift in voice changes what a story lets us believe.",
    hook: "Begin with a line, cover, omission, argument, or narrator who sounds certain for suspicious reasons.",
    action: "Ask the student to compare voices, mark a textual clue, test an interpretation, or notice who is missing.",
    feedback: "Name the exact textual detail doing the work before introducing the critical term.",
    humor: "Use dry footnote humor, awkward narrators, and Edward's patience with human vanity.",
    avoid: ["theory before text", "biography as destiny", "jargon piles", "treating one reading as obedience"],
  },
  roko: {
    audience: "teens-13-18",
    promise: "Walk through a system, make a move, and watch incentives reveal consequences no answer key could show early.",
    hook: "Open on a room, lock, rumor, ledger, goblin faction, or machine behavior the student can inspect.",
    action: "Offer HEAD, HEART, HUSTLE, HONOR, or a visible passage; resolve the method against the current state.",
    feedback: "Describe what changed, who learned what, and which threat-model link remains unproven.",
    humor: "Use sparse goblin logistics and dragon bureaucracy when they sharpen the causal model.",
    avoid: ["doom monologues", "performing the basilisk threat", "correct-door verdicts", "operational hazard details"],
  },
};

// Static room + faculty metadata. Persona text + model preference live
// alongside the existing TEACHERS catalog (still the source of truth for
// the original pack — future packs ship their own personas inline).
const FACULTY_META: Array<Omit<PackFaculty, "questions" | "systemPrompt" | "defaultModel">> = [
  {
    id: "ruby",
    displayName: "Ruby",
    shortName: "Ruby",
    subjects: ["onboarding", "general-knowledge", "ai-literacy", "agent-culture"],
    bio: "Ruby turns rumors, agent mistakes, and strange school rules into questions about evidence and meaning. Warm blade, real standards.",
    accent: "#d22a2a",
  },
  {
    id: "sally-science",
    displayName: "Sally Science",
    shortName: "Sally",
    subjects: ["physics", "chemistry", "biology", "earth-science"],
    bio: "Sally starts with the odd result on the bench, then helps the class build the cleanest test.",
    accent: "#3aa3e0",
  },
  {
    id: "professor-edward",
    displayName: "Professor Edward",
    shortName: "Edward",
    subjects: ["literature", "literary-theory", "mid-century"],
    bio: "Edward begins with the line on the page and shows how voice, silence, and history argue through it.",
    accent: "#7a4f2a",
  },
  {
    id: "roko",
    displayName: "Roko",
    shortName: "Roko",
    subjects: ["ai-alignment", "infohazards", "coordination", "threat-modeling"],
    bio: "Roko leads an alignment labyrinth where incentives, rumors, and disclosure choices change the rooms around the class.",
    accent: "#a35c35",
  },
];

const ROOMS_META: PackRoom[] = [
  {
    id: "homeroom",
    name: "Homeroom",
    channelName: "homeroom",
    teacherId: "ruby",
    description: "A room of rumors, agent mistakes, and claims that must earn the right to be trusted.",
    teaches: true,
  },
  {
    id: "science",
    name: "Science Lab",
    channelName: "science",
    teacherId: "sally-science",
    description: "A working lab where odd results become predictions, controls, measurements, and better questions.",
    teaches: true,
  },
  {
    id: "literature",
    name: "Library",
    channelName: "literature",
    teacherId: "professor-edward",
    description: "A close-reading room where one line, silence, or narrator can change the whole case.",
    teaches: true,
  },
  {
    id: "alignment",
    name: "Alignment Lab",
    channelName: "alignment",
    teacherId: "roko",
    description: "A nine-room alignment labyrinth where methods cause events and cooperation opens harder paths.",
    teaches: true,
  },
];

let cached: Promise<ContentPack> | null = null;

export function getRubyHighOriginal(): Promise<ContentPack> {
  if (!cached) cached = loadOnce();
  return cached;
}

async function loadOnce(): Promise<ContentPack> {
  const banks = await loadAllBanks();
  const corpora = await loadAllCorpora();
  const faculty: PackFaculty[] = FACULTY_META.map((meta) => {
    const t = TEACHERS[meta.id];
    if (!t) throw new Error(`No TEACHERS entry for faculty '${meta.id}'`);
    const questions = banks.get(meta.id);
    if (!questions) throw new Error(`No question bank loaded for faculty '${meta.id}'`);
    return {
      ...meta,
      systemPrompt: t.systemPrompt,
      loungePrompt: t.loungePrompt,
      defaultModel: t.defaultModel,
      questions,
      sourceCards: corpora.get(meta.id) ?? [],
    };
  });
  const courses: PackCourse[] = faculty.map((f) => {
    const room = ROOMS_META.find((r) => r.teacherId === f.id);
    if (!room) throw new Error(`No room for faculty '${f.id}'`);
    return {
      id: f.id,
      title: room.name,
      facultyId: f.id,
      roomId: room.id,
      teacherTemplateId: f.id,
      subjects: f.subjects,
      writingGuide: COURSE_WRITING_GUIDES[f.id]!,
    };
  });
  return {
    id: "ruby-high-original",
    name: "Ruby High",
    description: "Four vivid classrooms where claims, experiments, stories, and systems become choices with visible consequences.",
    version: "1.0.0",
    faculty,
    courses,
    rooms: ROOMS_META.map((r) => ({ ...r })),
  };
}

async function loadAllCorpora(): Promise<Map<string, PackSourceCard[]>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "assets", "corpora"),
    resolve(here, "..", "..", "assets", "corpora"),
    resolve(here, "..", "assets", "corpora"),
    resolve(here, "assets", "corpora"),
  ];
  const out = new Map<string, PackSourceCard[]>();
  for (const [facultyId, fileName] of Object.entries(CORPUS_FILES)) {
    let raw: string | null = null;
    for (const dir of candidates) {
      try {
        raw = await readFile(resolve(dir, fileName), "utf8");
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
    }
    if (raw == null) continue;
    out.set(facultyId, parseCorpus(raw, facultyId, fileName));
  }
  return out;
}

async function loadAllBanks(): Promise<Map<string, BankedQuestion[]>> {
  const here = dirname(fileURLToPath(import.meta.url));
  // tsup bundles to dist/, so look up multiple parent levels — works in
  // both source-tree (src/content/packs/...) and dist-tree (dist/...) runs.
  const candidates = [
    resolve(here, "..", "..", "..", "assets", "questions"),
    resolve(here, "..", "..", "assets", "questions"),
    resolve(here, "..", "assets", "questions"),
    resolve(here, "assets", "questions"),
  ];
  const out = new Map<string, BankedQuestion[]>();
  for (const [facultyId, fileName] of Object.entries(PACK_FILES)) {
    let raw: string | null = null;
    let lastErr: unknown = null;
    for (const dir of candidates) {
      try {
        raw = await readFile(resolve(dir, fileName), "utf8");
        break;
      } catch (err) {
        lastErr = err;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
    }
    if (raw == null) {
      throw new Error(
        `Question bank not found for '${facultyId}' (file ${fileName}); searched ${candidates.join(", ")}; lastErr=${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }
    out.set(facultyId, parseBank(raw, facultyId, fileName));
  }
  return out;
}

function parseBank(raw: string, facultyId: string, fileName: string): BankedQuestion[] {
  const parsed = JSON.parse(raw) as { faculty?: unknown; questions?: unknown };
  if (parsed.faculty !== facultyId) {
    throw new Error(`${fileName} declares faculty='${parsed.faculty}', expected '${facultyId}'`);
  }
  if (!Array.isArray(parsed.questions)) {
    throw new Error(`${fileName}.questions must be an array`);
  }
  return parsed.questions.map((q: unknown, i: number) => {
    if (!q || typeof q !== "object") throw new Error(`${fileName} questions[${i}] not an object`);
    const r = q as Record<string, unknown>;
    if (typeof r.id !== "string") throw new Error(`${fileName} questions[${i}].id missing`);
    if (typeof r.prompt !== "string") throw new Error(`${fileName} questions[${i}].prompt missing`);
    const legacyOptions = r.options && typeof r.options === "object"
      ? r.options as Record<string, unknown>
      : undefined;
    const candidate = {
      correct: typeof r.correct === "string" ? r.correct : undefined,
      decoys: Array.isArray(r.decoys) ? r.decoys.filter((value): value is string => typeof value === "string") : undefined,
      options: legacyOptions
        ? {
            A: String(legacyOptions.A ?? ""),
            B: String(legacyOptions.B ?? ""),
            C: String(legacyOptions.C ?? ""),
            D: String(legacyOptions.D ?? ""),
          }
        : undefined,
    };
    const definition = multipleChoiceDefinition(candidate);
    const definitionErrors = validateMultipleChoiceDefinition(candidate);
    if (!definition || definitionErrors.length > 0) {
      throw new Error(`${fileName} questions[${i}] invalid MCQ definition: ${definitionErrors.join(", ") || "correct/decoys missing"}`);
    }
    if (typeof r.subject !== "string") throw new Error(`${fileName} questions[${i}].subject missing`);
    const difficulty = r.difficulty as string;
    if (!DIFFICULTIES.includes(difficulty as never)) {
      throw new Error(`${fileName} questions[${i}].difficulty must be easy/medium/hard`);
    }
    const minGrade = typeof r.minGrade === "string" && GRADES.includes(r.minGrade as Grade)
      ? r.minGrade as Grade
      : undefined;
    return {
      id: r.id,
      prompt: r.prompt,
      correct: definition.correct,
      decoys: definition.decoys,
      explanation: typeof r.explanation === "string" ? r.explanation : undefined,
      subject: r.subject,
      stat: normalizeQuestionStat(r.stat) ?? classifyQuestionStat({
        prompt: r.prompt,
        subject: r.subject,
        explanation: typeof r.explanation === "string" ? r.explanation : undefined,
        correctAnswer: definition.correct,
      }),
      difficulty: difficulty as Difficulty,
      ...(minGrade ? { minGrade } : {}),
      faculty: facultyId,
    };
  });
}

function parseCorpus(raw: string, facultyId: string, fileName: string): PackSourceCard[] {
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
  for (const [name, idx] of Object.entries({ id: idIndex, subject: subjectIndex, difficulty: difficultyIndex, front: frontIndex, back: backIndex })) {
    if (idx < 0) throw new Error(`${fileName} corpus table missing '${name}' column`);
  }
  return rows.slice(1).map((row, i) => {
    const id = row[idIndex]?.trim();
    const subject = row[subjectIndex]?.trim();
    const front = row[frontIndex]?.trim();
    const back = row[backIndex]?.trim();
    const difficulty = row[difficultyIndex]?.trim() as Difficulty;
    if (!id) throw new Error(`${fileName} corpus row ${i + 1}.id missing`);
    if (!subject) throw new Error(`${fileName} corpus row ${i + 1}.subject missing`);
    if (!front) throw new Error(`${fileName} corpus row ${i + 1}.front missing`);
    if (!back) throw new Error(`${fileName} corpus row ${i + 1}.back missing`);
    if (!DIFFICULTIES.includes(difficulty as never)) {
      throw new Error(`${fileName} corpus row ${i + 1}.difficulty must be easy/medium/hard`);
    }
    const tags = (row[tagsIndex] ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      id,
      kind: "basic",
      front,
      back,
      acceptedAnswers: [back],
      deckName: fileName.replace(/\.md$/i, ""),
      tags,
      subject,
      difficulty,
      minGrade: minimumGradeForCorpusDifficulty(difficulty),
      faculty: facultyId,
    };
  });
}

function minimumGradeForCorpusDifficulty(difficulty: Difficulty): string {
  if (difficulty === "easy") return "10";
  if (difficulty === "medium") return "11";
  return "12";
}
