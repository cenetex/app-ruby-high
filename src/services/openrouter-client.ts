export const STUDENT_MODEL = process.env.RUBY_HIGH_STUDENT_MODEL ?? "anthropic/claude-haiku-4.5";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const REFERER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
export const TITLE = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

export const OPENROUTER_TIMEOUT_MS = Number(process.env.RUBY_HIGH_OPENROUTER_TIMEOUT_MS ?? 60_000);
export const OPENROUTER_STREAM_TIMEOUT_MS = Number(process.env.RUBY_HIGH_OPENROUTER_STREAM_TIMEOUT_MS ?? 180_000);

export interface OpenRouterRequest {
  model: string;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface OpenRouterChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type OpenRouterStreamChunk =
  | { kind: "text"; text: string }
  | { kind: "tool-call"; toolCall: OpenRouterToolCall }
  | { kind: "finish"; reason: string | null };

interface OpenRouterCallOpts {
  apiKey: string;
  body: OpenRouterRequest;
  label?: string;
  title?: string;
  timeoutMs?: number;
}

interface ChatCompletionStreamOpts {
  url: string;
  headers: Record<string, string>;
  body: OpenRouterRequest;
  label?: string;
  providerName?: string;
  timeoutMs?: number;
}

export class OpenRouterHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(message);
    this.name = "OpenRouterHttpError";
  }
}

export class ChatCompletionHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(message);
    this.name = "ChatCompletionHttpError";
  }
}

export async function throwChatCompletionError(
  r: Response,
  label: string,
  providerName = "chat-completion",
): Promise<never> {
  const body = await r.text().catch(() => "");
  const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
  throw new ChatCompletionHttpError(
    `${label}: ${providerName} ${r.status} ${r.statusText}${trimmed ? ` — ${trimmed}` : ""}`,
    r.status,
    r.statusText,
    body,
  );
}

export async function throwOpenRouterError(r: Response, label: string): Promise<never> {
  const body = await r.text().catch(() => "");
  const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
  throw new OpenRouterHttpError(
    `${label}: OpenRouter ${r.status} ${r.statusText}${trimmed ? ` — ${trimmed}` : ""}`,
    r.status,
    r.statusText,
    body,
  );
}

export function openRouterHeaders(apiKey: string, title: string = TITLE): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": REFERER,
    "X-Title": title,
  };
}

export async function openRouterFetch(
  init: RequestInit,
  timeoutMs: number = OPENROUTER_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(OPENROUTER_URL, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function openRouterJson<T = OpenRouterChatCompletion>(opts: OpenRouterCallOpts): Promise<T> {
  const r = await openRouterFetch({
    method: "POST",
    headers: openRouterHeaders(opts.apiKey, opts.title),
    body: JSON.stringify(opts.body),
  }, opts.timeoutMs);
  if (!r.ok) await throwOpenRouterError(r, opts.label ?? "openrouter");
  return await r.json() as T;
}

export async function* openRouterStream(opts: OpenRouterCallOpts): AsyncGenerator<OpenRouterStreamChunk> {
  yield* chatCompletionStream({
    url: OPENROUTER_URL,
    headers: openRouterHeaders(opts.apiKey, opts.title),
    body: opts.body,
    label: opts.label ?? "openrouter-stream",
    providerName: "OpenRouter",
    timeoutMs: opts.timeoutMs ?? OPENROUTER_STREAM_TIMEOUT_MS,
  });
}

export async function* chatCompletionStream(opts: ChatCompletionStreamOpts): AsyncGenerator<OpenRouterStreamChunk> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? OPENROUTER_STREAM_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const r = await fetch(opts.url, {
      method: "POST",
      headers: opts.headers,
      body: JSON.stringify({ ...opts.body, stream: true }),
      signal: ctrl.signal,
    });
    if (!r.ok) await throwChatCompletionError(r, opts.label ?? "chat-completion-stream", opts.providerName);
    if (!r.body) throw new Error(`${opts.label ?? "chat-completion-stream"}: ${opts.providerName ?? "Provider"} response had no stream body`);

    reader = r.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!frame) continue;
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const parsed = safeJson(payload);
          const choice = firstChoice(parsed);
          if (!choice) continue;
          const delta = choice.delta ?? {};
          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield { kind: "text", text: delta.content };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const slot = typeof tc?.index === "number" ? tc.index : toolCalls.size;
              const existing = toolCalls.get(slot) ?? { id: typeof tc?.id === "string" ? tc.id : "", name: "", arguments: "" };
              if (typeof tc?.id === "string") existing.id = tc.id;
              if (typeof tc?.function?.name === "string") existing.name = tc.function.name;
              if (typeof tc?.function?.arguments === "string") existing.arguments += tc.function.arguments;
              toolCalls.set(slot, existing);
            }
          }
          if (choice.finish_reason) {
            yield* flushToolCalls(toolCalls);
            yield { kind: "finish", reason: typeof choice.finish_reason === "string" ? choice.finish_reason : null };
            return;
          }
        }
      }
    }

    yield* flushToolCalls(toolCalls);
    yield { kind: "finish", reason: null };
  } finally {
    clearTimeout(timer);
    try {
      await reader?.cancel();
    } catch {
      // The stream may already be closed; cancellation is best-effort cleanup.
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function firstChoice(value: unknown): { delta?: Record<string, unknown>; finish_reason?: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  return first && typeof first === "object" ? first as { delta?: Record<string, unknown>; finish_reason?: unknown } : null;
}

async function* flushToolCalls(
  toolCalls: Map<number, { id: string; name: string; arguments: string }>,
): AsyncGenerator<OpenRouterStreamChunk> {
  for (const [, tc] of toolCalls) {
    if (!tc.id || !tc.name) continue;
    yield {
      kind: "tool-call",
      toolCall: {
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      },
    };
  }
}
