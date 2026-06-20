import {
  isLocalLlmProvider,
  resolveLlmApiKey,
} from "./services/llm-provider.js";
import { hostedOpenRouterApiKey } from "./hosted-entitlements.js";
import type { RubyHighService } from "./services/ruby-high-service.js";

export type AiCredentialSource = "browser" | "hosted" | "local";

export interface OpenRouterGenerationCredential {
  apiKey: string | null;
  hosted: boolean;
  source: AiCredentialSource | null;
}

function readBrowserOpenRouterApiKey(apiKeyHeader?: string | null): string | null {
  const key = apiKeyHeader?.trim();
  return key && key.length > 0 ? key : null;
}

function nullCredential(): OpenRouterGenerationCredential {
  return { apiKey: null, hosted: false, source: null };
}

export function resolveOpenRouterGenerationCredential(args: {
  apiKeyHeader?: string | null;
  ruby: RubyHighService;
  sessionId: string;
}): OpenRouterGenerationCredential {
  const browserKey = readBrowserOpenRouterApiKey(args.apiKeyHeader);
  if (browserKey) return { apiKey: browserKey, hosted: false, source: "browser" };
  const hostedKey = hostedOpenRouterApiKey();
  if (hostedKey) {
    return { apiKey: hostedKey, hosted: true, source: "hosted" };
  }
  return nullCredential();
}

/** Resolve a text LLM credential for chat, grading, and source-card MC
 *  generation. Browser BYOK and local providers are free to use; a configured
 *  server OpenRouter key sponsors hosted text AI, while chat routes meter
 *  player messages with Merit Stars. */
export function resolveTextLlmCredential(args: {
  apiKeyHeader?: string | null;
  ruby: RubyHighService;
  sessionId: string;
}): OpenRouterGenerationCredential {
  const browserKey = readBrowserOpenRouterApiKey(args.apiKeyHeader);
  if (browserKey) {
    return { apiKey: resolveLlmApiKey(browserKey), hosted: false, source: "browser" };
  }
  if (isLocalLlmProvider()) {
    return { apiKey: resolveLlmApiKey(null), hosted: false, source: "local" };
  }
  return resolveOpenRouterGenerationCredential(args);
}

/** Character portraits and diplomas are OpenRouter image calls. Local text
 *  providers cannot satisfy them; the hosted fallback remains available only
 *  to routes that charge the configured per-image Hall Pass cost. */
export function resolveOpenRouterImageCredential(args: {
  apiKeyHeader?: string | null;
}): OpenRouterGenerationCredential {
  const browserKey = readBrowserOpenRouterApiKey(args.apiKeyHeader);
  if (browserKey) return { apiKey: browserKey, hosted: false, source: "browser" };
  const hostedKey = hostedOpenRouterApiKey();
  if (hostedKey) return { apiKey: hostedKey, hosted: true, source: "hosted" };
  return nullCredential();
}

export function hasOpenRouterGenerationAccess(args: {
  apiKeyHeader?: string | null;
  ruby: RubyHighService;
  sessionId: string;
}): boolean {
  return !!resolveOpenRouterGenerationCredential(args).apiKey;
}

export function openRouterGenerationRequiredMessage(action: string): string {
  return `Connect AI before ${action}.`;
}
