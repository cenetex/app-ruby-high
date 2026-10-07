import type { AgentAccessService } from "./agent-access-service.js";
import type { AuthService } from "./auth-service.js";
import type { ChatService } from "./chat-service.js";
import type { RubyHighService } from "./ruby-high-service.js";
import type { StoredAccountDeletionTarget } from "./state-store.js";
import { stateRetentionSeconds } from "./privacy-policy.js";

export interface PrivacyServices { auth: AuthService; ruby: RubyHighService; chat: ChatService; agents?: AgentAccessService | null }

export async function deletePlayerData(services: PrivacyServices, target: StoredAccountDeletionTarget) {
  const agentStates = await services.agents?.deleteOwnerData(target.sessionId) ?? [];
  for (const sessionId of agentStates) {
    await services.chat.deleteAccountData({ sessionId });
    await services.ruby.deleteAccountData({ sessionId, userId: sessionId });
  }
  await services.chat.deleteAccountData(target);
  const result = await services.ruby.deleteAccountData(target);
  services.auth.forgetDeletedAccount(target);
  return result;
}

export async function purgeInactiveAccounts(services: PrivacyServices, now = Date.now()): Promise<number> {
  const seconds = stateRetentionSeconds();
  if (seconds <= 0) return 0;
  await services.chat.purgeExpiredPrivacyData();
  const targets = services.auth.inactiveAccountDeletionTargets(now - seconds * 1000);
  for (const target of targets) await deletePlayerData(services, target);
  return targets.length;
}

export function startPrivacyMaintenance(services: PrivacyServices): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await purgeInactiveAccounts(services); }
    catch { console.error("[ruby-high] privacy cleanup failed; it will retry on the next run."); }
    finally { running = false; }
  }, 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
