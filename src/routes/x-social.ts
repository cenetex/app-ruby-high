import type { XSocialService } from "../services/x-social-service.js";
import type { RouteContext } from "./context.js";
import { X_SOCIAL_CONNECT_PATH, X_SOCIAL_CALLBACK_PATH, X_SOCIAL_PREFIX } from "./constants.js";

function requireAdminAuth(ctx: RouteContext): boolean {
  const token = process.env.RUBY_HIGH_ADMIN_TOKEN;
  if (!token) return false;
  const auth = ctx.authorizationHeader;
  if (typeof auth !== "string") return false;
  if (auth === `Bearer ${token}` || auth === token) return true;
  return false;
}

function sendRedirect(res: unknown, url: string, status = 302): void {
  const r = res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
  if (r.setHeader) {
    r.setHeader("Location", url);
    r.writeHead?.(status, { "Content-Type": "text/plain" });
    r.end?.(`Redirecting to ${url}`);
  }
}

function sendJson(res: unknown, data: unknown, status = 200): void {
  const r = res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
  const body = JSON.stringify(data);
  if (r.setHeader) {
    r.setHeader("Content-Type", "application/json");
    r.writeHead?.(status, { "Content-Type": "application/json" });
    r.end?.(body);
  }
}

function sendError(res: unknown, message: string, status = 400): void {
  sendJson(res, { error: message }, status);
}

export async function handleXSocialRoutes(
  ctx: RouteContext,
  xSocial: XSocialService,
): Promise<boolean> {
  const pathname = ctx.pathname;

  // GET /x/callback — OAuth callback
  if (ctx.method === "GET" && pathname === X_SOCIAL_CALLBACK_PATH) {
    const url = new URL(pathname, "http://localhost");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const reqUrl = ctx.url ?? new URL(pathname, "http://localhost");
    const actualCode = reqUrl.searchParams.get("code") ?? code;
    const actualState = reqUrl.searchParams.get("state") ?? state;
    if (!actualCode || !actualState) {
      sendError(ctx.res, "Missing code or state parameter.", 400);
      return true;
    }
    try {
      await xSocial.handleCallback(actualCode, actualState);
      const html = `<!doctype html><html><head><title>Connected</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e;color:#eee;text-align:center;}h1{color:#4ade80;}p{color:#94a3b8;}</style></head><body><div><h1>Connected to X</h1><p>The teacher account is now linked. You can close this window.</p></div></body></html>`;
      const r = ctx.res as { setHeader?: (n: string, v: string) => void; writeHead?: (s: number, h: Record<string, string>) => void; end?: (b?: string) => void };
      if (r.setHeader) {
        r.setHeader("Content-Type", "text/html; charset=utf-8");
        r.writeHead?.(200, { "Content-Type": "text/html; charset=utf-8" });
        r.end?.(html);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth failed";
      // Distinguish auth failures from internal/network errors.
      const isAuthErr = msg.includes("invalid_grant") || msg.includes("Invalid state") || msg.includes("Authorization code");
      sendError(ctx.res, msg, isAuthErr ? 400 : 502);
    }
    return true;
  }

  // GET /x/connect/:teacherId — start OAuth (admin only)
  if (ctx.method === "GET" && pathname.startsWith(X_SOCIAL_CONNECT_PATH + "/")) {
    if (!requireAdminAuth(ctx)) {
      sendError(ctx.res, "Admin authentication required.", 401);
      return true;
    }
    const teacherId = pathname.slice((X_SOCIAL_CONNECT_PATH + "/").length).split("?")[0];
    if (!teacherId) {
      sendError(ctx.res, "Teacher ID is required.", 400);
      return true;
    }
    try {
      const { url, state } = xSocial.beginConnect(teacherId);
      const isApiCall = typeof ctx.authorizationHeader === "string";
      if (isApiCall) {
        sendJson(ctx.res, { ok: true, url, state });
      } else {
        sendRedirect(ctx.res, url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start OAuth";
      sendError(ctx.res, msg, 500);
    }
    return true;
  }

  // GET /x/status/:teacherId (admin only)
  if (ctx.method === "GET" && pathname.startsWith(`${X_SOCIAL_PREFIX}/status/`)) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/status/`.length).split("?")[0];
    if (!teacherId) { sendError(ctx.res, "Teacher ID is required.", 400); return true; }
    sendJson(ctx.res, xSocial.getStatus(teacherId));
    return true;
  }

  // GET /x/connected — list connected teachers (admin only)
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/connected`) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    sendJson(ctx.res, { teachers: xSocial.listConnected() });
    return true;
  }

  // GET /x/students — list recently active students (admin only)
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/students`) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const runtime = (xSocial as any).runtime;
    const rsvc = runtime?.getService?.("ruby-high") as { getRecentlyActiveStudents?: () => any[] } | null;
    const students = rsvc?.getRecentlyActiveStudents?.() ?? [];
    ctx.json(ctx.res, { students });
    return true;
  }

  // POST /x/import-token/:teacherId — import raw tokens (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/import-token/`)) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/import-token/`.length);
    if (!teacherId) { sendError(ctx.res, "Teacher ID is required.", 400); return true; }
    try {
      const body = await ctx.readJsonBody() as Record<string, unknown> | null;
      if (!body || typeof body.accessToken !== "string" || typeof body.refreshToken !== "string") {
        sendError(ctx.res, "accessToken and refreshToken are required.", 400); return true; }
      const result = await xSocial.importToken({
        teacherId,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        xUserId: typeof body.xUserId === "string" ? body.xUserId : undefined,
        xScreenName: typeof body.xScreenName === "string" ? body.xScreenName : undefined,
      });
      ctx.json(ctx.res, { ok: true, teacherId, xScreenName: result.xScreenName });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : "Import failed", 500);
    }
    return true;
  }

  // GET /x/snapshot — full school context for bots (admin only)
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/snapshot`) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const runtime = (xSocial as any).runtime;
    const rsvc = runtime?.getService?.("ruby-high") as { getSchoolSnapshot?: () => any } | null;
    const snapshot = rsvc?.getSchoolSnapshot?.() ?? { topByYear: {}, photoPool: [], dailyMemories: {} };
    ctx.json(ctx.res, snapshot);
    return true;
  }

  // POST /x/post/:teacherId — teacher reflection post (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/post/`)) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/post/`.length);
    if (!teacherId) { sendError(ctx.res, "Teacher ID is required.", 400); return true; }
    try {
      const runtime = (xSocial as any).runtime;
      const rsvc = runtime?.getService?.("ruby-high") as { getSchoolSnapshot?: () => any; getDailyMemories?: () => any } | null;
      const snapshot = rsvc?.getSchoolSnapshot?.() ?? null;
      const memories = snapshot?.dailyMemories ?? rsvc?.getDailyMemories?.() ?? { date: new Date().toISOString().slice(0,10), charactersCreated:[], classesPassed:[], gradesAdvanced:[], graduations:[], totalStudents:0, totalQuestionsAnswered:0 };
      const { teacherById } = await import("../characters/teachers.js");
      const teacher = teacherById(teacherId);
      if (!teacher) { sendError(ctx.res, "Unknown teacher: " + teacherId, 404); return true; }
      const tweetId = await xSocial.postReflection(teacher, memories, snapshot);
      if (tweetId) { ctx.json(ctx.res, { ok: true, tweetId }); }
      else { ctx.json(ctx.res, { ok: false, error: "Post failed or teacher not connected." }, 400); }
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : "Post failed", 500);
    }
    return true;
  }

  // POST /x/post-report/:teacherId — post student report card (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/post-report/`)) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/post-report/`.length);
    if (!teacherId) { sendError(ctx.res, "Teacher ID is required.", 400); return true; }
    try {
      const body = await ctx.readJsonBody() as Record<string, unknown> | null;
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
      if (!sessionId) { ctx.error(ctx.res, "sessionId is required.", 400); return true; }
      const runtime = (xSocial as any).runtime;
      const rsvc = runtime?.getService?.("ruby-high") as { getRecentlyActiveStudents?: () => any[] } | null;
      const students = rsvc?.getRecentlyActiveStudents?.() ?? [];
      const student = students.find((s: any) => s.sessionId === sessionId);
      if (!student) { ctx.error(ctx.res, "Student not found.", 404); return true; }
      const { teacherById } = await import("../characters/teachers.js");
      const teacher = teacherById(teacherId);
      if (!teacher) { ctx.error(ctx.res, "Unknown teacher.", 404); return true; }
      const tweetId = await xSocial.postReportCard(teacher, student);
      if (tweetId) { ctx.json(ctx.res, { ok: true, tweetId }); }
      else { ctx.json(ctx.res, { ok: false, error: "Post failed." }, 400); }
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : "Report post failed", 500);
    }
    return true;
  }

  // POST /x/class-photo/:teacherId — post a class photo (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/class-photo/`)) {
    if (!requireAdminAuth(ctx)) { ctx.error(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/class-photo/`.length);
    if (!teacherId) { ctx.error(ctx.res, "Teacher ID is required.", 400); return true; }
    try {
      const rt = (xSocial as any).runtime;
      const rsvc = rt?.getService?.("ruby-high") as { getSchoolSnapshot?: () => any; enqueuePhotoReveal?: (sid: string, kind: string, url: string, tid: string) => string; sessions?: Map<string, any> } | null;
      const snapshot = rsvc?.getSchoolSnapshot?.() ?? { topByYear: {}, photoPool: [] };
      // Collect student portraits from the top-3-per-year list.
      const studentImages: Array<{ name: string; imageUrl: string; sessionId: string }> = [];
      const sessions = rsvc?.sessions
        ? (rsvc as any).sessions as Map<string, any>
        : new Map();
      for (const gradeStudents of Object.values(snapshot.topByYear) as any[]) {
        for (const s of gradeStudents) {
          const state = sessions.get(s.sessionId);
          const portraitUrl = state?.character?.portraitDataUrl;
          if (portraitUrl) {
            studentImages.push({ name: s.name, imageUrl: portraitUrl, sessionId: s.sessionId || "" });
          }
        }
      }
      if (studentImages.length === 0) {
        ctx.json(ctx.res, { ok: false, error: "No students with portraits found." }, 400);
        return true;
      }
      const selected = studentImages.slice(0, 8);
      const { teacherById } = await import("../characters/teachers.js");
      const teacher = teacherById(teacherId);
      if (!teacher) { ctx.error(ctx.res, "Unknown teacher.", 404); return true; }
      // Generate the composite image, then enqueue it into the daily photo pool.
      const imageUrl = await xSocial.generateClassPhoto(teacher, selected);
      if (!imageUrl) {
        ctx.json(ctx.res, { ok: false, error: "Class photo generation failed." }, 400);
        return true;
      }

      
      let photoId = "class-photo-" + Date.now();
      if (rsvc?.enqueuePhotoReveal) {
        for (const s of selected) {
          photoId = rsvc.enqueuePhotoReveal(s.sessionId || "", "class-photo", imageUrl, teacherId);
          break; // Just enqueue once
        }
      }
      ctx.json(ctx.res, { ok: true, photoId, imageUrl, studentCount: selected.length });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : "Class photo failed", 500);
    }
    return true;
  }

  // POST /x/disconnect/:teacherId — revoke (admin only)
  if (ctx.method === "POST" && pathname.startsWith(`${X_SOCIAL_PREFIX}/disconnect/`)) {
    if (!requireAdminAuth(ctx)) { sendError(ctx.res, "Admin authentication required.", 401); return true; }
    const teacherId = pathname.slice(`${X_SOCIAL_PREFIX}/disconnect/`.length);
    if (!teacherId) { sendError(ctx.res, "Teacher ID is required.", 400); return true; }
    await xSocial.disconnect(teacherId);
    sendJson(ctx.res, { ok: true });
    return true;
  }

  // GET /x/telegram/find-chat?token=... — proxy Telegram getUpdates (admin only)
  // Token must match Telegram bot token format (digits:alphanum) before
  // the outbound fetch to avoid leakage into access logs via the URL path.
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/telegram/find-chat`) {
    if (!requireAdminAuth(ctx)) { ctx.error(ctx.res, "Admin authentication required.", 401); return true; }
    const token = ctx.url?.searchParams.get("token") ?? "";
    if (!token) { ctx.error(ctx.res, "token is required.", 400); return true; }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) { ctx.error(ctx.res, "Invalid bot token format.", 400); return true; }
    try {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?limit=5`, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json();
      ctx.json(ctx.res, data);
    } catch (err) {
      ctx.error(ctx.res, "Failed to reach Telegram API", 502);
    }
    return true;
  }

  // GET /x/telegram — get Telegram config (admin only)
  if (ctx.method === "GET" && pathname === `${X_SOCIAL_PREFIX}/telegram`) {
    if (!requireAdminAuth(ctx)) { ctx.error(ctx.res, "Admin authentication required.", 401); return true; }
    const runtime = (xSocial as any).runtime;
    const telegram = runtime?.getService?.("telegram") as { getConfig?: () => any } | null;
    ctx.json(ctx.res, telegram?.getConfig?.() ?? { chatId: "", enabled: false, hasToken: false });
    return true;
  }

  // POST /x/telegram — update Telegram config (admin only)
  if (ctx.method === "POST" && pathname === `${X_SOCIAL_PREFIX}/telegram`) {
    if (!requireAdminAuth(ctx)) { ctx.error(ctx.res, "Admin authentication required.", 401); return true; }
    const body = await ctx.readJsonBody() as Record<string, unknown> | null;
    const botToken = typeof body?.botToken === "string" ? body.botToken.trim() : "";
    const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
    // If no chatId provided, auto-detect from Telegram getUpdates
    let resolvedChatId = chatId;
    if (botToken && !resolvedChatId) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=3`, { signal: AbortSignal.timeout(10_000) });
        const tgData = await tgRes.json() as { ok: boolean; result?: Array<{ message?: { chat: { id: number; title?: string } }; channel_post?: { chat: { id: number; title?: string } } }> };
        if (tgData.ok && tgData.result?.length) {
          for (const upd of tgData.result) {
            const msg = upd.message || upd.channel_post;
            if (msg?.chat?.id) {
              resolvedChatId = String(msg.chat.id);
              break;
            }
          }
        }
      } catch { /* keep empty */ }
    }
    if (!botToken || !resolvedChatId) { ctx.error(ctx.res, "botToken and chatId are required. Send a message in the group first.", 400); return true; }
    const runtime = (xSocial as any).runtime;
    const telegram = runtime?.getService?.("telegram") as { updateConfig?: (t: string, c: string) => void; getConfig?: () => any } | null;
    telegram?.updateConfig?.(botToken, resolvedChatId);
    ctx.json(ctx.res, { ok: true, ...(telegram?.getConfig?.() ?? {}) });
    return true;
  }

  // POST /x/telegram/post — trigger a school snapshot post (admin only)
  if (ctx.method === "POST" && pathname === `${X_SOCIAL_PREFIX}/telegram/post`) {
    if (!requireAdminAuth(ctx)) { ctx.error(ctx.res, "Admin authentication required.", 401); return true; }
    const runtime = (xSocial as any).runtime;
    const telegram = runtime?.getService?.("telegram") as { postSchoolSnapshot?: () => Promise<void> } | null;
    if (!telegram) { ctx.error(ctx.res, "Telegram service not available.", 503); return true; }
    await telegram.postSchoolSnapshot?.();
    ctx.json(ctx.res, { ok: true });
    return true;
  }

  return false;
}
