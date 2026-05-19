import type { IAgentRuntime } from "../runtime.js";
import { AuthService } from "./auth-service.js";

export const ANONYMOUS_SESSION_ID = "rh:anonymous";

export function getRuntime(value: unknown): IAgentRuntime | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { agentId?: unknown; getService?: unknown };
  if (typeof candidate.getService !== "function") return null;
  return candidate as unknown as IAgentRuntime;
}

export function tryGetService<T>(runtime: IAgentRuntime | null, type: string): T | null {
  if (!runtime) return null;
  try {
    return (runtime.getService(type) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Single state-key derivation path for app routes, chat routes, and legacy
 * runtime actions. Auth cookies own player state when present; unauthenticated
 * runtime actions fall back to an agent-scoped key in the same `rh:*` namespace.
 */
export function getSessionId(
  runtime: IAgentRuntime | null,
  cookieHeader?: string | null,
  options: { allowAgentFallback?: boolean } = {},
): string {
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
  const hasCookieHeader = typeof cookieHeader === "string" && cookieHeader.trim().length > 0;
  if (auth && (hasCookieHeader || !options.allowAgentFallback)) return auth.stateKeyForCookie(cookieHeader);
  if (!options.allowAgentFallback) return ANONYMOUS_SESSION_ID;
  const agentId = (runtime as { agentId?: unknown } | null)?.agentId;
  return typeof agentId === "string" && agentId.trim()
    ? `rh:agent:${agentId.trim()}`
    : ANONYMOUS_SESSION_ID;
}
