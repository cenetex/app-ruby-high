import type { ChatService, ChatStreamEvent, SendOpts } from "./chat-service.js";
import {
  streamLlmChatCompletions,
} from "./llm-provider.js";

export interface AvatarLineGeneration {
  apiKey: string;
  label: string;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  clean?: (text: string) => string;
  unusable?: (text: string) => boolean;
  fallback?: (args: { raw: string; cleaned: string }) => string;
}

export type AvatarChatLineStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; raw: string; finishReason: string | null; usedFallback: boolean };

export async function* streamAvatarChatLine(args: AvatarLineGeneration): AsyncGenerator<AvatarChatLineStreamEvent> {
  let raw = "";
  let finishReason: string | null = null;
  for await (const chunk of streamLlmChatCompletions({
    apiKey: args.apiKey,
    label: args.label,
    body: {
      model: args.model,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      max_tokens: args.maxTokens,
      temperature: args.temperature,
    },
  })) {
    if (chunk.kind === "text") {
      raw += chunk.text;
      yield { type: "delta", text: chunk.text };
    } else if (chunk.kind === "finish") {
      finishReason = chunk.reason;
    }
  }

  const cleaned = args.clean ? args.clean(raw) : cleanAvatarChatLine(raw);
  if (!args.unusable?.(cleaned)) {
    yield { type: "done", text: cleaned, raw, finishReason, usedFallback: false };
    return;
  }
  const fallback = args.fallback?.({ raw, cleaned }) ?? "";
  if (fallback.trim()) {
    yield { type: "done", text: fallback.trim(), raw, finishReason, usedFallback: true };
    return;
  }
  throw new Error(`${args.label}: avatar line was empty or unusable.`);
}

export function streamTeacherAvatarTurn(
  chat: ChatService,
  opts: SendOpts,
): AsyncGenerator<ChatStreamEvent> {
  return chat.send(opts);
}

export function cleanAvatarChatLine(
  text: string,
  opts: { maxChars?: number; speakerPrefixes?: string[] } = {},
): string {
  let line = text.trim().replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");
  const prefixes = (opts.speakerPrefixes ?? []).map((prefix) => prefix.trim()).filter(Boolean);
  if (prefixes.length > 0) {
    const escaped = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const prefixRe = new RegExp(`^[\\s"'*_~]*(${escaped.join("|")})[\\s"'*_~]*:\\s*`, "i");
    line = line.replace(prefixRe, "").trim();
  }
  const maxChars = opts.maxChars;
  if (typeof maxChars === "number" && maxChars > 0 && line.length > maxChars) {
    line = line.slice(0, maxChars - 1).trimEnd() + "...";
  }
  return line;
}

function normalizeSpeakerLabel(value: string): string {
  return value.toLowerCase().replace(/[*_`"']/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function avatarChatLineStartsWithSpeakerLabel(text: string, labels: string[]): boolean {
  const match = text.trim().match(/^[\s"'*_`~]*([^:\n]{1,60}?)[\s"'*_`~]*:/);
  if (!match) return false;
  const label = normalizeSpeakerLabel(match[1] ?? "");
  if (!label) return false;
  return labels.map(normalizeSpeakerLabel).filter(Boolean).some((candidate) => label === candidate);
}

export function avatarChatLineLooksTooThin(
  text: string,
  opts: { minWords?: number; minChars?: number } = {},
): boolean {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return true;
  const minWords = opts.minWords ?? 1;
  const minChars = opts.minChars ?? 1;
  if (cleaned.split(" ").filter(Boolean).length < minWords) return true;
  if (cleaned.length < minChars) return true;
  return false;
}
