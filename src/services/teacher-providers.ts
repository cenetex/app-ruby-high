import type { PackFaculty, PackFacultyProvider } from "../content/types.js";
import {
  chatCompletionStream,
  openRouterStream,
  OPENROUTER_STREAM_TIMEOUT_MS,
  type OpenRouterRequest,
  type OpenRouterStreamChunk,
} from "./openrouter-client.js";
import {
  isLocalLlmProvider,
  llmChatCompletionsUrl,
  llmHeaders,
  llmProviderName,
  resolveLlmApiKey,
  resolveLlmModel,
} from "./llm-provider.js";

export interface PublicTeacherProvider {
  kind: PackFacultyProvider["kind"];
  requiresBrowserKey: boolean;
  supportsTools: boolean;
  label: string;
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
    requiresBrowserKey: providerRequiresBrowserKey(provider),
    supportsTools: providerSupportsTools(provider),
    label: providerLabel(provider),
  };
}

export function providerRequiresBrowserKey(provider: PackFacultyProvider): boolean {
  return provider.kind === "openrouter" && !isLocalLlmProvider();
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
    const apiKey = opts.browserApiKey
      ? resolveLlmApiKey(opts.browserApiKey)
      : isLocalLlmProvider()
        ? resolveLlmApiKey(null)
        : null;
    if (!apiKey) throw new Error("OpenRouter key required for this teacher.");
    if (isLocalLlmProvider()) {
      yield* chatCompletionStream({
        url: llmChatCompletionsUrl(),
        headers: llmHeaders(apiKey),
        body: {
          ...opts.body,
          model: resolveLlmModel(typeof opts.body.model === "string" ? opts.body.model : null),
        },
        label: opts.label ?? "local-teacher-stream",
        providerName: llmProviderName(),
        timeoutMs: OPENROUTER_STREAM_TIMEOUT_MS,
      });
      return;
    }
    yield* openRouterStream({
      apiKey,
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

function ratiConfig(): { configured: false; baseUrl: string; apiKey: "" } | { configured: true; baseUrl: string; apiKey: string } {
  const baseUrl = normalizeBaseUrl(process.env.RUBY_HIGH_RATI_BASE_URL || DEFAULT_RATI_BASE_URL);
  const apiKey = (process.env.RUBY_HIGH_RATI_INTERNAL_API_KEY || "").trim();
  if (!apiKey) return { configured: false, baseUrl, apiKey: "" };
  return { configured: true, baseUrl, apiKey };
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function providerLabel(provider: PackFacultyProvider): string {
  switch (provider.kind) {
    case "openrouter": return llmProviderName();
    case "rati-openai-compatible": return "RATi";
    case "elizaos": return "elizaOS";
  }
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
