import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import { requireAdminAuth } from "./admin-auth.js";
import { AgentAccessService } from "../services/agent-access-service.js";
import { AuthService } from "../services/auth-service.js";
import { ChatService } from "../services/chat-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { getRuntime, tryGetService } from "../services/session-identity.js";
import { deletePlayerData } from "../services/privacy-maintenance.js";

export const PRIVACY_DELETE_PATH = `${APP_ROUTE_PREFIX}/admin/privacy/delete-account`;

export async function handlePrivacyDeletion(ctx: RouteContext): Promise<boolean> {
  if (ctx.pathname !== PRIVACY_DELETE_PATH) return false;
  if (ctx.method !== "POST") { ctx.error(ctx.res, "Use POST for a verified deletion request.", 405); return true; }
  if (!requireAdminAuth(ctx)) return true;
  const body = await ctx.readJsonBody().catch(() => null) as { userId?: unknown; confirm?: unknown } | null;
  if (body?.confirm !== "DELETE" || typeof body.userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.userId)) {
    ctx.error(ctx.res, "Supply the verified userId and confirm DELETE.", 400); return true;
  }
  const runtime = getRuntime(ctx.runtime);
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const chat = tryGetService<ChatService>(runtime, ChatService.serviceType);
  if (!auth || !ruby || !chat) { ctx.error(ctx.res, "Ruby High services are starting.", 503); return true; }
  const target = auth.accountDeletionTargetForUser(body.userId);
  if (!target) { ctx.error(ctx.res, "Check the account ID for this request.", 404); return true; }
  try {
    const deleted = await deletePlayerData({ auth, ruby, chat, agents: tryGetService<AgentAccessService>(runtime, AgentAccessService.serviceType) }, target);
    ctx.json(ctx.res, { ok: true, deleted });
  } catch { ctx.error(ctx.res, "Deletion needs another attempt. Please keep this request open.", 500); }
  return true;
}
