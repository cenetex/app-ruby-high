/**
 * The built-in pack: Ruby High Original. Composes the existing teacher
 * personas + room layout + JSON question banks into a ContentPack so the
 * rest of the system can read from the active-pack abstraction instead
 * of hardcoded constants.
 *
 * This is the freemium core experience. Lean in: AI/agent culture (Ruby),
 * STEM (Sally), postwar lit (Edward). Future paid packs (SAT prep, USMLE,
 * AP US History, language-vocab) and free runtime packs (Anki imports)
 * follow the same shape.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEACHERS } from "../../characters/teachers.js";
import {
  CHOICES,
  DIFFICULTIES,
  type BankedQuestion,
  type Choice,
  type Difficulty,
} from "../../types.js";
import { classifyQuestionStat, normalizeQuestionStat } from "../../question-stats.js";
import type { ContentPack, PackCourse, PackFaculty, PackRoom } from "../types.js";

const PACK_FILES: Record<string, string> = {
  ruby: "ruby.json",
  "sally-science": "sally-science.json",
  "professor-edward": "professor-edward.json",
};

// Static room + faculty metadata. Persona text + model preference live
// alongside the existing TEACHERS catalog (still the source of truth for
// the original pack — future packs ship their own personas inline).
const FACULTY_META: Array<Omit<PackFaculty, "questions" | "systemPrompt" | "defaultModel">> = [
  {
    id: "ruby",
    displayName: "Ruby",
    shortName: "Ruby",
    subjects: ["onboarding", "general-knowledge", "ratimics-lore", "agent-culture"],
    bio: "Host of Ruby High. Greets students, picks the right teacher for the subject, runs the quiz floor.",
    accent: "#d22a2a",
  },
  {
    id: "sally-science",
    displayName: "Sally Science",
    shortName: "Sally",
    subjects: ["physics", "chemistry", "biology", "earth-science"],
    bio: "STEM teacher. Loves a clean experiment and a clean explanation.",
    accent: "#3aa3e0",
  },
  {
    id: "professor-edward",
    displayName: "Professor Edward",
    shortName: "Edward",
    subjects: ["literature", "literary-theory", "mid-century"],
    bio: "Mid-century literary theory. Reads everything as a conversation between books.",
    accent: "#7a4f2a",
  },
];

const ROOMS_META: PackRoom[] = [
  {
    id: "homeroom",
    name: "Homeroom",
    channelName: "homeroom",
    teacherId: "ruby",
    description: "Ruby's homeroom. General knowledge, ratimics lore, the meta of the school.",
    teaches: true,
  },
  {
    id: "science",
    name: "Science Lab",
    channelName: "science",
    teacherId: "sally-science",
    description: "Sally's lab — physics, chemistry, biology, earth science.",
    teaches: true,
  },
  {
    id: "literature",
    name: "Library",
    channelName: "literature",
    teacherId: "professor-edward",
    description: "Edward's seminar room — postwar literature, literary theory, mid-century intellectual history.",
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
  const faculty: PackFaculty[] = FACULTY_META.map((meta) => {
    const t = TEACHERS[meta.id];
    if (!t) throw new Error(`No TEACHERS entry for faculty '${meta.id}'`);
    const questions = banks.get(meta.id);
    if (!questions) throw new Error(`No question bank loaded for faculty '${meta.id}'`);
    return {
      ...meta,
      systemPrompt: t.systemPrompt,
      defaultModel: t.defaultModel,
      questions,
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
    };
  });
  return {
    id: "ruby-high-original",
    name: "Ruby High",
    description: "AI/agent culture, STEM, and postwar literature. The original Ruby High curriculum.",
    version: "1.0.0",
    faculty,
    courses,
    rooms: ROOMS_META.map((r) => ({ ...r })),
  };
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
    const correct = r.correct as string;
    if (!CHOICES.includes(correct as never)) {
      throw new Error(`${fileName} questions[${i}].correct must be A/B/C/D`);
    }
    const opts = r.options as Record<string, unknown> | undefined;
    if (!opts) throw new Error(`${fileName} questions[${i}].options missing`);
    for (const c of CHOICES) {
      if (typeof opts[c] !== "string" || (opts[c] as string).trim().length === 0) {
        throw new Error(`${fileName} questions[${i}].options.${c} missing or empty`);
      }
    }
    if (typeof r.subject !== "string") throw new Error(`${fileName} questions[${i}].subject missing`);
    const difficulty = r.difficulty as string;
    if (!DIFFICULTIES.includes(difficulty as never)) {
      throw new Error(`${fileName} questions[${i}].difficulty must be easy/medium/hard`);
    }
    const options = { A: opts.A as string, B: opts.B as string, C: opts.C as string, D: opts.D as string };
    const typedCorrect = correct as Choice;
    return {
      id: r.id,
      prompt: r.prompt,
      options,
      correct: typedCorrect,
      explanation: typeof r.explanation === "string" ? r.explanation : undefined,
      subject: r.subject,
      stat: normalizeQuestionStat(r.stat) ?? classifyQuestionStat({
        prompt: r.prompt,
        subject: r.subject,
        explanation: typeof r.explanation === "string" ? r.explanation : undefined,
        correctAnswer: options[typedCorrect],
      }),
      difficulty: difficulty as Difficulty,
      faculty: facultyId,
    };
  });
}
