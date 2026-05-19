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

export function providerForFaculty(faculty: PackFaculty | null | undefined): PackFacultyProvider {
  const provider = faculty?.provider as { kind?: unknown; supportsTools?: unknown } | undefined;
  if (provider?.kind === "openrouter") {
    return {
      kind: "openrouter",
      ...(provider.supportsTools === false ? { supportsTools: false } : {}),
    };
  }
  return { kind: "openrouter", supportsTools: true };
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

export function providerRequiresBrowserKey(_provider: PackFacultyProvider): boolean {
  return !isLocalLlmProvider();
}

export function providerSupportsTools(provider: PackFacultyProvider): boolean {
  return provider.supportsTools !== false;
}

export async function* streamTeacherCompletion(opts: {
  provider: PackFacultyProvider;
  browserApiKey?: string | null;
  body: OpenRouterRequest;
  label?: string;
}): AsyncGenerator<OpenRouterStreamChunk> {
  const apiKey = opts.browserApiKey
    ? resolveLlmApiKey(opts.browserApiKey)
    : isLocalLlmProvider()
      ? resolveLlmApiKey(null)
      : null;
  if (!apiKey) throw new Error("AI key required for this teacher.");
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
}

function providerLabel(_provider: PackFacultyProvider): string {
  return llmProviderName();
}
