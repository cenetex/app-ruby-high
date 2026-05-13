import type { ContentPack, PackFaculty, PackFacultyProvider } from "../content/types.js";
import { connectedPackId } from "../content/registry.js";
import type { BankedQuestion, Choice, Difficulty } from "../types.js";
import {
  chatCompletionStream,
  openRouterStream,
  OPENROUTER_STREAM_TIMEOUT_MS,
  type OpenRouterRequest,
  type OpenRouterStreamChunk,
} from "./openrouter-client.js";

export interface PublicTeacherProvider {
  kind: PackFacultyProvider["kind"];
  requiresBrowserKey: boolean;
  supportsTools: boolean;
  label: string;
}

export interface ConnectedTeacherCandidate {
  id: string;
  model: string;
  root: string;
  name: string;
  description: string;
  provider: "rati-openai-compatible";
  supportsTools: boolean;
  profileImage?: string | null;
}

interface RatiModelRecord {
  id?: unknown;
  root?: unknown;
  avatar?: {
    name?: unknown;
    description?: unknown;
    profile_image?: unknown;
    profileImage?: unknown;
  };
}

const DEFAULT_RATI_BASE_URL = "https://swarm.rati.chat/api/v1";
const RATI_TIMEOUT_MS = readPositiveInt(process.env.RUBY_HIGH_RATI_TIMEOUT_MS, 60_000);
const CONNECTED_TEACHER_QUESTION_COUNT = readPositiveInt(process.env.RUBY_HIGH_CONNECTED_TEACHER_QUESTION_COUNT, 8);

export function providerForFaculty(faculty: PackFaculty | null | undefined): PackFacultyProvider {
  return faculty?.provider ?? { kind: "openrouter", supportsTools: true };
}

export function publicProviderForFaculty(faculty: PackFaculty | null | undefined): PublicTeacherProvider {
  const provider = providerForFaculty(faculty);
  return {
    kind: provider.kind,
    requiresBrowserKey: provider.kind === "openrouter",
    supportsTools: providerSupportsTools(provider),
    label: providerLabel(provider),
  };
}

export function providerRequiresBrowserKey(provider: PackFacultyProvider): boolean {
  return provider.kind === "openrouter";
}

export function providerSupportsTools(provider: PackFacultyProvider): boolean {
  if (provider.kind === "rati-openai-compatible") {
    // This is a server-side backend capability, not stable pack metadata.
    // Older persisted connected-teacher packs stored supportsTools:false from
    // the previous chat-only route, so do not let that stale flag disable the
    // board tools after the RATi API has gained tool-call support.
    return ratiToolsEnabled();
  }
  return provider.supportsTools !== false;
}

export async function* streamTeacherCompletion(opts: {
  provider: PackFacultyProvider;
  browserApiKey?: string | null;
  body: OpenRouterRequest;
  label?: string;
}): AsyncGenerator<OpenRouterStreamChunk> {
  if (opts.provider.kind === "openrouter") {
    if (!opts.browserApiKey) throw new Error("OpenRouter key required for this teacher.");
    yield* openRouterStream({
      apiKey: opts.browserApiKey,
      label: opts.label,
      body: opts.body,
    });
    return;
  }

  if (opts.provider.kind === "rati-openai-compatible") {
    const config = ratiConfig();
    if (!config.configured) throw new Error("RATi teacher backend is not configured.");
    const body: OpenRouterRequest = {
      ...opts.body,
      model: opts.provider.model || opts.body.model,
    };
    if (!providerSupportsTools(opts.provider)) {
      delete body.tools;
      delete body.tool_choice;
    }
    yield* stripKnownProviderFallbackChunks(chatCompletionStream({
      url: `${config.baseUrl}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
      label: opts.label ?? "rati-teacher-stream",
      providerName: "RATi",
      timeoutMs: RATI_TIMEOUT_MS || OPENROUTER_STREAM_TIMEOUT_MS,
    }));
    return;
  }

  throw new Error("Native elizaOS teacher provider is not wired yet.");
}

export function ratiConfigured(): boolean {
  return ratiConfig().configured;
}

export async function listRatiTeacherCandidates(): Promise<ConnectedTeacherCandidate[]> {
  const config = ratiConfig();
  if (!config.configured) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RATI_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: ctrl.signal,
    });
    if (!response.ok) {
      throw new Error(`RATi models ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { data?: unknown };
    const models = Array.isArray(data.data) ? data.data as RatiModelRecord[] : [];
    return models
      .map(candidateFromModel)
      .filter((candidate): candidate is ConnectedTeacherCandidate => !!candidate);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateConnectedTeacherQuestionBank(candidate: ConnectedTeacherCandidate): Promise<BankedQuestion[]> {
  if (CONNECTED_TEACHER_QUESTION_COUNT <= 0) return [];
  const config = ratiConfig();
  if (!config.configured) throw new Error("RATi teacher backend is not configured.");
  const facultyId = connectedFacultyId(candidate);
  const displayName = candidate.name || candidate.root || candidate.model;
  const response = await ratiChatCompletionJson({
    model: candidate.model,
    messages: [
      {
        role: "system",
        content: [
          "You create Ruby High multiple-choice study cards.",
          "Return only valid JSON. No markdown. No commentary.",
          "Every question must be answerable from general reasoning or your teaching domain, not private chat state.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Teacher: ${displayName}`,
          candidate.description ? `Teacher description: ${candidate.description}` : "",
          `Write ${CONNECTED_TEACHER_QUESTION_COUNT} Ruby High board questions for a high-school class taught by this teacher.`,
          "Return a JSON array. Each item must have exactly these fields:",
          `{"subject":"short subject label","difficulty":"easy|medium|hard","prompt":"question text","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A|B|C|D","explanation":"one sentence"}`,
          "Make the questions varied, classroom-appropriate, and concrete.",
        ].filter(Boolean).join("\n"),
      },
    ],
    max_tokens: 2400,
    temperature: 0.35,
  });
  const content = firstMessageContent(response);
  const items = parseQuestionBankJson(content);
  const questions = items
    .map((item, index) => bankedQuestionFromGeneratedItem(item, { facultyId, index }))
    .filter((question): question is BankedQuestion => !!question);
  if (questions.length < Math.min(4, CONNECTED_TEACHER_QUESTION_COUNT)) {
    throw new Error(`RATi teacher returned ${questions.length} valid generated questions; at least ${Math.min(4, CONNECTED_TEACHER_QUESTION_COUNT)} required.`);
  }
  return questions.slice(0, CONNECTED_TEACHER_QUESTION_COUNT);
}

export function packForConnectedTeacher(candidate: ConnectedTeacherCandidate, questions: BankedQuestion[] = []): ContentPack {
  const packId = connectedTeacherPackId(candidate);
  const facultyId = connectedFacultyId(candidate);
  const roomId = `${facultyId}-room`;
  const displayName = candidate.name || candidate.root || candidate.model;
  const shortName = displayName.split(/\s+/)[0] || "Teacher";
  const subjects = Array.from(new Set([
    ...questions.map((q) => q.subject).filter(Boolean),
    "open study",
  ]));
  return {
    id: packId,
    name: `${displayName} Teacher`,
    description: candidate.description || `Live RATi teacher connected through ${candidate.model}.`,
    version: "1.0.0",
    faculty: [{
      id: facultyId,
      displayName,
      shortName,
      ...(candidate.profileImage ? { profileImageUrl: candidate.profileImage } : {}),
      subjects,
      bio: candidate.description || "A live RATi/aws-swarm avatar teaching at Ruby High.",
      accent: colorForString(candidate.model),
      systemPrompt: [
        `You are ${displayName}, a live guest teacher at Ruby High.`,
        "Teach conversationally, keep answers concrete, and adapt to the student's current class context.",
        "Use Ruby High board tools when the class needs a new challenge; Ruby High will report the blackboard state after a tool succeeds.",
      ].join("\n"),
      defaultModel: candidate.model,
      provider: {
        kind: "rati-openai-compatible",
        model: candidate.model,
        externalId: candidate.root,
        supportsTools: candidate.supportsTools,
      },
      questions,
    }],
    courses: [{
      id: facultyId,
      title: `${displayName} Seminar`,
      facultyId,
      roomId,
      subjects,
    }],
    rooms: [{
      id: roomId,
      name: `${displayName} Seminar`,
      channelName: channelNameFor(displayName),
      teacherId: facultyId,
      description: candidate.description || `Live class with ${displayName}.`,
      teaches: true,
    }],
  };
}

export function connectedTeacherPackId(candidate: ConnectedTeacherCandidate): string {
  return connectedPackId(`rati-${slugForModel(candidate.root || candidate.model)}`);
}

async function ratiChatCompletionJson(body: OpenRouterRequest): Promise<unknown> {
  const config = ratiConfig();
  if (!config.configured) throw new Error("RATi teacher backend is not configured.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RATI_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: false }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`RATi question generation ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
    }
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function ratiConfig(): { configured: false; baseUrl: string; apiKey: "" } | { configured: true; baseUrl: string; apiKey: string } {
  const baseUrl = normalizeBaseUrl(process.env.RUBY_HIGH_RATI_BASE_URL || DEFAULT_RATI_BASE_URL);
  const apiKey = (process.env.RUBY_HIGH_RATI_API_KEY || "").trim();
  if (!apiKey) return { configured: false, baseUrl, apiKey: "" };
  return { configured: true, baseUrl, apiKey };
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function providerLabel(provider: PackFacultyProvider): string {
  switch (provider.kind) {
    case "openrouter": return "OpenRouter";
    case "rati-openai-compatible": return "RATi";
    case "elizaos": return "elizaOS";
  }
}

function candidateFromModel(model: RatiModelRecord): ConnectedTeacherCandidate | null {
  const id = typeof model.id === "string" ? model.id : "";
  if (!id) return null;
  const root = typeof model.root === "string" && model.root.trim() ? model.root.trim() : id.replace(/^avatar:/, "");
  const avatar = model.avatar ?? {};
  const profileImage = profileImageFromModelAvatar(avatar);
  const name = typeof avatar.name === "string" && avatar.name.trim()
    ? avatar.name.trim()
    : root.replace(/[-_]+/g, " ");
  const description = typeof avatar.description === "string" ? avatar.description.trim() : "";
  return {
    id,
    model: id,
    root,
    name,
    description,
    provider: "rati-openai-compatible",
    supportsTools: ratiToolsEnabled(),
    profileImage,
  };
}

function profileImageFromModelAvatar(avatar: RatiModelRecord["avatar"]): string | null {
  const snake = avatar && typeof avatar.profile_image === "string" ? avatar.profile_image.trim() : "";
  if (snake) return snake;
  const camel = avatar && avatar.profileImage;
  if (typeof camel === "string" && camel.trim()) return camel.trim();
  if (camel && typeof camel === "object") {
    const url = (camel as { url?: unknown }).url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return null;
}

function connectedFacultyId(candidate: ConnectedTeacherCandidate): string {
  return `rati-${slugForModel(candidate.root || candidate.model)}`;
}

function firstMessageContent(response: unknown): string {
  const choices = response && typeof response === "object" ? (response as { choices?: unknown }).choices : undefined;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : "";
}

function parseQuestionBankJson(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const direct = safeJson(trimmed);
  if (Array.isArray(direct)) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = safeJson(fenced[1]!.trim());
    if (Array.isArray(parsed)) return parsed;
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const parsed = safeJson(trimmed.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function bankedQuestionFromGeneratedItem(
  item: unknown,
  opts: { facultyId: string; index: number },
): BankedQuestion | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const optionsRaw = record.options;
  if (!optionsRaw || typeof optionsRaw !== "object") return null;
  const optionsRecord = optionsRaw as Record<string, unknown>;
  const options = {
    A: cleanText(optionsRecord.A),
    B: cleanText(optionsRecord.B),
    C: cleanText(optionsRecord.C),
    D: cleanText(optionsRecord.D),
  };
  if (!options.A || !options.B || !options.C || !options.D) return null;
  const correct = cleanText(record.correct).toUpperCase();
  if (!isChoice(correct)) return null;
  const prompt = cleanText(record.prompt);
  if (!prompt) return null;
  const difficulty = normalizeDifficulty(record.difficulty);
  const subject = cleanText(record.subject) || "open study";
  return {
    id: `${opts.facultyId}-seed-${opts.index + 1}`,
    prompt,
    type: "multiple-choice",
    options,
    correct,
    explanation: cleanText(record.explanation) || undefined,
    subject,
    difficulty,
    faculty: opts.facultyId,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isChoice(value: string): value is Choice {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function normalizeDifficulty(value: unknown): Difficulty {
  const text = cleanText(value).toLowerCase();
  if (text === "easy" || text === "medium" || text === "hard") return text;
  return "medium";
}

function ratiToolsEnabled(): boolean {
  return readBoolean(process.env.RUBY_HIGH_RATI_SUPPORTS_TOOLS, true);
}

const KNOWN_PROVIDER_FALLBACK_TEXTS = [
  "I apologize, but I couldn't generate a response. Please try again.",
  "I apologise, but I couldn't generate a response. Please try again.",
  "I apologize, but I could not generate a response. Please try again.",
  "I'm sorry, but I couldn't generate a response. Please try again.",
  "I’m sorry, but I couldn’t generate a response. Please try again.",
].map((text) => text.toLowerCase());

export function stripKnownProviderFallbackText(text: string): string {
  let next = text;
  for (const fallback of KNOWN_PROVIDER_FALLBACK_TEXTS) {
    next = next.replace(new RegExp(escapeRegExp(fallback).replace(/\s+/g, "\\s+") + "\\s*", "gi"), "");
  }
  return next;
}

async function* stripKnownProviderFallbackChunks(
  chunks: AsyncGenerator<OpenRouterStreamChunk>,
): AsyncGenerator<OpenRouterStreamChunk> {
  let buffer = "";
  const flushText = (final = false): string => {
    buffer = stripKnownProviderFallbackText(buffer);
    if (!buffer) return "";
    if (final) {
      const text = buffer;
      buffer = "";
      return text;
    }
    const retain = fallbackPrefixSuffixLength(buffer);
    const emit = buffer.slice(0, buffer.length - retain);
    buffer = buffer.slice(buffer.length - retain);
    return emit;
  };

  for await (const chunk of chunks) {
    if (chunk.kind === "text") {
      buffer += chunk.text;
      const text = flushText(false);
      if (text) yield { kind: "text", text };
      continue;
    }
    if (chunk.kind === "finish") {
      const text = flushText(true);
      if (text) yield { kind: "text", text };
    }
    yield chunk;
  }
}

function fallbackPrefixSuffixLength(text: string): number {
  const lower = text.toLowerCase();
  let best = 0;
  for (const fallback of KNOWN_PROVIDER_FALLBACK_TEXTS) {
    const max = Math.min(lower.length, fallback.length - 1);
    for (let length = max; length > best; length--) {
      if (fallback.startsWith(lower.slice(lower.length - length))) {
        best = length;
        break;
      }
    }
  }
  return best;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugForModel(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^avatar:/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "teacher";
}

function channelNameFor(value: string): string {
  return slugForModel(value).replace(/-/g, "-") || "teacher";
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function colorForString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  const palette = ["#d22a2a", "#2e8f7b", "#6f5fc7", "#c27a2c", "#2f76b7", "#b04782"];
  return palette[Math.abs(hash) % palette.length]!;
}
