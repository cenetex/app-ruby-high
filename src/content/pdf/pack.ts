/**
 * PDF extract → ContentPack.
 *
 * Chunks the extracted text, calls the AI to generate typed-answer study
 * cards from each chunk, and assembles them into a private ContentPack
 * with the same shape the Anki importer produces.
 */

import type { ContentPack, PackCourse, PackFaculty, PackRoom, PackSourceCard } from "../types.js";
import type { PdfExtract } from "./extract.js";
import { TEACHERS } from "../../characters/teachers.js";
import {
  slug,
  shortenName,
  defaultIdSuffix,
  hashedAccent,
  teacherAccent,
  importedModulePrompt,
  anchoredTeacherPrompt,
} from "../pack-utils.js";
import { fetchLlmChatCompletions, llmProviderName, resolveStudentModel } from "../../services/llm-provider.js";

export interface BuildPdfPackOpts {
  apiKey: string;
  packName?: string;
  teacherId?: string;
  maxCards?: number;
  filename?: string;
}

export interface BuildPdfPackResult {
  pack: ContentPack;
  generated: number;
}

const TIMEOUT_MS = Number(process.env.RUBY_HIGH_OPENROUTER_TIMEOUT_MS ?? 60_000);

const CHUNK_CHARS = 2400;
const QA_PER_CHUNK = 4;

interface QAPair { q: string; a: string }

async function generateQA(apiKey: string, chunk: string): Promise<QAPair[]> {
  const r = await fetchLlmChatCompletions({
    apiKey,
    timeoutMs: TIMEOUT_MS,
    title: "Ruby High PDF Import",
    body: {
      model: resolveStudentModel(),
      messages: [
        {
          role: "system",
          content:
            "You extract study questions from educational text. Respond with valid JSON only — no prose, no code fences.",
        },
        {
          role: "user",
          content:
            `Generate exactly ${QA_PER_CHUNK} typed-answer study question/answer pairs from the text below. ` +
            `Each answer must be concise (one clear sentence). ` +
            `Return ONLY a JSON array: [{"q":"...","a":"..."}]\n\nTEXT:\n${chunk.slice(0, CHUNK_CHARS)}`,
        },
      ],
      max_tokens: 700,
      temperature: 0.25,
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`pdf-qa: ${llmProviderName()} ${r.status} - ${text.slice(0, 200)}`);
  }
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<unknown>).filter(
      (item): item is QAPair =>
        typeof (item as QAPair)?.q === "string" &&
        typeof (item as QAPair)?.a === "string" &&
        (item as QAPair).q.trim().length > 0 &&
        (item as QAPair).a.trim().length > 0,
    );
  } catch (err) {
    console.warn("[pdf-pack] Failed to parse AI response as QA JSON:", err instanceof Error ? err.message : String(err), "raw:", raw.slice(0, 200));
    return [];
  }
}

/** Group pages into text chunks of roughly CHUNK_CHARS characters. */
function chunkPages(pages: string[], maxChunks: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const page of pages) {
    if (chunks.length >= maxChunks) break;
    if (current.length + page.length > CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + page;
  }
  if (current.trim() && chunks.length < maxChunks) chunks.push(current.trim());
  return chunks;
}

export async function buildPdfPack(
  extract: PdfExtract,
  opts: BuildPdfPackOpts,
): Promise<BuildPdfPackResult> {
  const cap = Math.max(1, Math.min(200, opts.maxCards ?? 50));
  const maxChunks = Math.ceil(cap / QA_PER_CHUNK);
  const suffix = defaultIdSuffix();
  const rawName =
    opts.packName ||
    extract.title ||
    opts.filename?.replace(/\.pdf$/i, "").replace(/[-_]/g, " ") ||
    "Imported PDF";
  const packName = rawName.trim();
  const baseSlug = slug(packName);
  const facultyId = `pdf:${baseSlug}-${suffix}`;
  const selectedTeacher = opts.teacherId ? (TEACHERS[opts.teacherId] ?? null) : null;

  const chunks = chunkPages(extract.pages, maxChunks);
  const sourceCards: PackSourceCard[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    if (sourceCards.length >= cap) break;
    try {
      const pairs = await generateQA(opts.apiKey, chunks[chunkIdx]);
      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
        if (sourceCards.length >= cap) break;
        const pair = pairs[pairIdx];
        sourceCards.push({
          // ID is stable for (chunk position, pair position) so re-importing
          // the same PDF with the same chunk size produces the same IDs.
          id: `pdf-${facultyId}-${chunkIdx}-${pairIdx}`,
          kind: "basic",
          front: pair.q.trim(),
          back: pair.a.trim(),
          acceptedAnswers: [pair.a.trim()],
          deckName: packName,
          tags: ["pdf"],
          subject: baseSlug,
          difficulty: "medium",
          faculty: facultyId,
        });
      }
    } catch (err) {
      console.warn("[pdf-pack] Chunk QA generation failed, skipping chunk:", err instanceof Error ? err.message : String(err));
    }
  }

  const accent = selectedTeacher ? teacherAccent(selectedTeacher.id) : hashedAccent(packName);
  const teacherDisplay = selectedTeacher?.displayName ?? `${packName} Teacher`;

  const room: PackRoom = {
    id: `${facultyId}-room`,
    name: packName,
    channelName: baseSlug,
    teacherId: facultyId,
    description: packName,
    teaches: true,
  };

  const course: PackCourse = {
    id: facultyId,
    title: packName,
    facultyId,
    roomId: room.id,
    ...(selectedTeacher ? { teacherTemplateId: selectedTeacher.id } : {}),
    subjects: [baseSlug],
  };

  const member: PackFaculty = {
    id: facultyId,
    displayName: teacherDisplay,
    shortName: selectedTeacher?.shortName ?? shortenName(teacherDisplay),
    ...(selectedTeacher ? { assetTeacherId: selectedTeacher.id } : {}),
    subjects: [baseSlug],
    bio: `${teacherDisplay} — ${packName}.`,
    accent,
    systemPrompt: selectedTeacher
      ? importedModulePrompt(selectedTeacher, packName, packName)
      : anchoredTeacherPrompt(packName),
    defaultModel: selectedTeacher?.defaultModel ?? resolveStudentModel(),
    questions: [],
    sourceCards,
  };

  const pack: ContentPack = {
    id: `pdf:${baseSlug}-${suffix}`,
    name: packName,
    description: `${sourceCards.length} AI-generated study cards · ${packName}.`,
    version: "1.0.0",
    faculty: [member],
    courses: [course],
    rooms: [room],
  };

  return { pack, generated: sourceCards.length };
}
