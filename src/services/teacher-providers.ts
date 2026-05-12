import type { ContentPack, PackFaculty, PackFacultyProvider } from "../content/types.js";
import { connectedPackId } from "../content/registry.js";
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
  };
}

const DEFAULT_RATI_BASE_URL = "https://swarm.rati.chat/api/v1";
const RATI_TIMEOUT_MS = readPositiveInt(process.env.RUBY_HIGH_RATI_TIMEOUT_MS, 60_000);

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
  return provider.supportsTools !== false && provider.kind !== "rati-openai-compatible";
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
    yield* chatCompletionStream({
      url: `${config.baseUrl}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
      label: opts.label ?? "rati-teacher-stream",
      providerName: "RATi",
      timeoutMs: RATI_TIMEOUT_MS || OPENROUTER_STREAM_TIMEOUT_MS,
    });
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

export function packForConnectedTeacher(candidate: ConnectedTeacherCandidate): ContentPack {
  const slug = slugForModel(candidate.root || candidate.model);
  const facultyId = `rati-${slug}`;
  const roomId = `${facultyId}-room`;
  const displayName = candidate.name || candidate.root || candidate.model;
  const shortName = displayName.split(/\s+/)[0] || "Teacher";
  const subjects = ["open study"];
  return {
    id: connectedPackId(`rati-${slug}`),
    name: `${displayName} Teacher`,
    description: candidate.description || `Live RATi teacher connected through ${candidate.model}.`,
    version: "1.0.0",
    faculty: [{
      id: facultyId,
      displayName,
      shortName,
      subjects,
      bio: candidate.description || "A live RATi/aws-swarm avatar teaching at Ruby High.",
      accent: colorForString(candidate.model),
      systemPrompt: [
        `You are ${displayName}, a live guest teacher at Ruby High.`,
        "Teach conversationally, keep answers concrete, and adapt to the student's current class context.",
        "The current RATi compatibility route is chat-only, so do not claim you changed the blackboard unless Ruby High reports that state to you.",
      ].join("\n"),
      defaultModel: candidate.model,
      provider: {
        kind: "rati-openai-compatible",
        model: candidate.model,
        externalId: candidate.root,
        supportsTools: candidate.supportsTools,
      },
      questions: [],
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
    supportsTools: false,
    profileImage: typeof avatar.profile_image === "string" ? avatar.profile_image : null,
  };
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

function colorForString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  const palette = ["#d22a2a", "#2e8f7b", "#6f5fc7", "#c27a2c", "#2f76b7", "#b04782"];
  return palette[Math.abs(hash) % palette.length]!;
}
