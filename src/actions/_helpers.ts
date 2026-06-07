import type { IAgentRuntime } from "../runtime.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { getSessionId as getRuntimeSessionId } from "../services/session-identity.js";

export function getService(runtime: IAgentRuntime): RubyHighService {
  const svc = runtime.getService<RubyHighService>(RubyHighService.serviceType);
  if (!svc) {
    throw new Error("RubyHighService is not registered in the Ruby High runtime.");
  }
  return svc;
}

export function getSessionId(runtime: IAgentRuntime): string {
  return getRuntimeSessionId(runtime, undefined, { allowAgentFallback: true });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
