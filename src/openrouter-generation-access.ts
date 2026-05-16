import { RubyHighService } from "./services/ruby-high-service.js";

export interface OpenRouterGenerationCredential {
  apiKey: string | null;
  hosted: boolean;
}

export function resolveOpenRouterGenerationCredential(args: {
  apiKeyHeader?: string | null;
  ruby: RubyHighService;
  sessionId: string;
}): OpenRouterGenerationCredential {
  const browserKey = args.apiKeyHeader?.trim();
  if (browserKey) return { apiKey: browserKey, hosted: false };
  const hostedKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY?.trim() || "";
  if (hostedKey && args.ruby.hostedAiAccessExpiresAt(args.sessionId)) {
    return { apiKey: hostedKey, hosted: true };
  }
  return { apiKey: null, hosted: false };
}

export function hasOpenRouterGenerationAccess(args: {
  apiKeyHeader?: string | null;
  ruby: RubyHighService;
  sessionId: string;
}): boolean {
  return !!resolveOpenRouterGenerationCredential(args).apiKey;
}

export function openRouterGenerationRequiredMessage(action: string): string {
  return `Enable OpenRouter AI before ${action}.`;
}
