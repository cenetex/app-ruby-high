import type { IAgentRuntime } from "@elizaos/core";
import { RubyHighService } from "../services/ruby-high-service.js";

export function getService(runtime: IAgentRuntime): RubyHighService {
  const svc = runtime.getService<RubyHighService>(RubyHighService.serviceType);
  if (!svc) {
    throw new Error(
      "RubyHighService is not registered. Add @cenetex/app-ruby-high to the character's plugins.",
    );
  }
  return svc;
}

export function getSessionId(runtime: IAgentRuntime): string {
  const agentId = (runtime as { agentId?: string } | null)?.agentId;
  return agentId ? `ruby-high:${agentId}` : "ruby-high:anonymous";
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
