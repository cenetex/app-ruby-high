export const STUDENT_MODEL = process.env.RUBY_HIGH_STUDENT_MODEL ?? "anthropic/claude-haiku-4.5";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const REFERER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
export const TITLE = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

const OPENROUTER_TIMEOUT_MS = Number(process.env.RUBY_HIGH_OPENROUTER_TIMEOUT_MS ?? 60_000);

export async function throwOpenRouterError(r: Response, label: string): Promise<never> {
  const body = await r.text().catch(() => "");
  const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
  throw new Error(`${label}: OpenRouter ${r.status} ${r.statusText}${trimmed ? ` — ${trimmed}` : ""}`);
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
