import { log } from "./logger.js";
import { DEFAULT_OPENROUTER_MODEL, DEFAULT_STUDENT_MODEL } from "../model-defaults.js";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_MODEL = "ruby-high-local";

export type LlmProviderKind = "openrouter" | "local";

export interface LlmProviderInfo {
  kind: LlmProviderKind;
  name: string;
  chatCompletionsUrl: string;
  defaultModel: string;
  local: boolean;
}

export function llmProviderKind(): LlmProviderKind {
  const raw = (process.env.RUBY_HIGH_LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "local" || raw === "llama.cpp" || raw === "llamacpp") return "local";
  if (raw === "openrouter" || raw === "remote") return "openrouter";
  return process.env.RUBY_HIGH_LLM_BASE_URL?.trim() ? "local" : "openrouter";
}

export function isLocalLlmProvider(): boolean {
  return llmProviderKind() === "local";
}

export function llmProviderInfo(): LlmProviderInfo {
  const kind = llmProviderKind();
  if (kind === "local") {
    const base = process.env.RUBY_HIGH_LLM_BASE_URL?.trim() || DEFAULT_LOCAL_BASE_URL;
    return {
      kind,
      name: "Local LLM",
      chatCompletionsUrl: normalizeChatCompletionsUrl(base),
      defaultModel: localModelName(),
      local: true,
    };
  }
  return {
    kind,
    name: "OpenRouter",
    chatCompletionsUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    local: false,
  };
}

export function llmChatCompletionsUrl(): string {
  return llmProviderInfo().chatCompletionsUrl;
}

export function llmProviderName(): string {
  return llmProviderInfo().name;
}

export function localModelName(): string {
  return (
    process.env.RUBY_HIGH_LLM_MODEL ??
    process.env.RUBY_HIGH_LOCAL_MODEL ??
    DEFAULT_LOCAL_MODEL
  ).trim() || DEFAULT_LOCAL_MODEL;
}

export function resolveLlmModel(requested: string | undefined | null): string {
  if (isLocalLlmProvider()) return localModelName();
  return requested?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export function resolveStudentModel(): string {
  return resolveLlmModel(process.env.RUBY_HIGH_STUDENT_MODEL ?? DEFAULT_STUDENT_MODEL);
}

export function resolveLlmApiKey(userApiKey?: string | null): string | null {
  if (isLocalLlmProvider()) {
    return (
      process.env.RUBY_HIGH_LLM_API_KEY ??
      process.env.RUBY_HIGH_LOCAL_LLM_API_KEY ??
      userApiKey ??
      "local"
    );
  }
  return userApiKey?.trim() || process.env.RUBY_HIGH_OPENROUTER_API_KEY?.trim() || null;
}

export function hasConfiguredLlmCredential(userApiKey?: string | null): boolean {
  return !!resolveLlmApiKey(userApiKey);
}

export function llmHeaders(userApiKey?: string | null, opts: { title?: string } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = resolveLlmApiKey(userApiKey);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (!isLocalLlmProvider()) {
    const title = opts.title ?? process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";
    headers["HTTP-Referer"] = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
    headers["X-OpenRouter-Title"] = title;
    headers["X-Title"] = title;
  }
  return headers;
}

export async function fetchLlmChatCompletions(
  args: {
    apiKey?: string | null;
    body: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
    title?: string;
    label?: string;
  },
): Promise<Response> {
  const ctrl = args.signal ? null : new AbortController();
  const timer = ctrl && args.timeoutMs ? setTimeout(() => ctrl.abort(), args.timeoutMs) : null;
  const startedAt = Date.now();
  const provider = llmProviderInfo();
  const model = resolveLlmModel(String(args.body.model ?? ""));
  try {
    const response = await fetch(provider.chatCompletionsUrl, {
      method: "POST",
      headers: llmHeaders(args.apiKey, { title: args.title }),
      body: JSON.stringify({
        ...args.body,
        model,
      }),
      signal: args.signal ?? ctrl?.signal,
    });
    log.event("llm.usage", {
      label: args.label ?? args.title ?? "chat-completions",
      feature: args.title ?? args.label ?? "llm",
      provider: provider.name,
      mode: provider.kind,
      model,
      status: response.ok ? "success" : "error",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (err) {
    log.event("llm.usage", {
      label: args.label ?? args.title ?? "chat-completions",
      feature: args.title ?? args.label ?? "llm",
      provider: provider.name,
      mode: provider.kind,
      model,
      status: "error",
      durationMs: Date.now() - startedAt,
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function throwLlmResponseError(r: Response, label: string): Promise<never> {
  const body = await r.text().catch(() => "");
  const trimmed = body.length > 500 ? body.slice(0, 500) + "..." : body;
  throw new Error(`${label}: ${llmProviderName()} ${r.status} ${r.statusText}${trimmed ? ` - ${trimmed}` : ""}`);
}

function normalizeChatCompletionsUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) return `${DEFAULT_LOCAL_BASE_URL}/chat/completions`;
  if (raw.endsWith("/chat/completions")) return raw;
  if (raw.endsWith("/v1")) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
}
