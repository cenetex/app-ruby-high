import type {
  AppBridgeLaunchContext,
  AppBridgeRunContext,
  AppLaunchDiagnostic,
  AppSessionState,
  IAgentRuntime,
} from "./runtime.js";
import { createHash } from "node:crypto";
import { RubyHighService } from "./services/ruby-high-service.js";
import { FacultyService } from "./services/faculty-service.js";
import { renderViewerHtml } from "./viewer.js";
import { handleChatRoutes } from "./chat-routes.js";
import { handlePackRoutes } from "./pack-routes.js";
import { handlePackLibraryRoutes } from "./pack-library-routes.js";
import { AuthService } from "./services/auth-service.js";
import { getRuntime, getSessionId, tryGetService } from "./services/session-identity.js";
import {
  APP_ROUTE_PREFIX,
  ASSETS_PREFIX,
  BUG_REPORT_PATH,
  MANIFEST_PATH,
  SERVICE_WORKER_PATH,
  VIEWER_PATH,
} from "./routes/constants.js";
import {
  sendAsset,
  sendHtmlResponse,
  sendManifest,
  sendServiceWorker,
} from "./routes/assets.js";
import { handleCommandRoute } from "./routes/commands.js";
import { handleBugReportRoute } from "./routes/bug-report.js";
import { BILLING_PREFIX, handleBillingRoutes } from "./routes/billing.js";
import {
  ADMIN_METRICS_PATH,
  ADMIN_METRICS_SCHEMA_PATH,
  ADMIN_OVERVIEW_PATH,
  ADMIN_CURRICULUM_REPLENISHMENT_PATH,
  ADMIN_WORLD_MODERATION_PATH,
  ADMIN_PATH,
  handleAdminCurriculumReplenishmentRoute,
  handleAdminMetricsSchemaRoute,
  handleAdminOverviewRoute,
  handleAdminMetricsRoute,
  handleAdminWorldModerationRoute,
  renderAdminDashboardHtml,
} from "./routes/admin.js";
import type { AdminOpsSnapshot } from "./routes/admin.js";
import { handleYearbookRoutes } from "./routes/yearbook.js";
import { handleFirstBellRoutes, FIRST_BELL_PREFIX } from "./routes/first-bell.js";
import { buildSessionState, getCharacterName } from "./routes/session-state.js";
import { handleMetricsEventRoute, METRICS_EVENT_PATH } from "./routes/metrics-events.js";
import { handleNftRoutes } from "./routes/nft.js";
import { XSocialService } from "./services/x-social-service.js";
import { handleXSocialRoutes } from "./routes/x-social.js";
import { X_SOCIAL_PREFIX } from "./routes/constants.js";
import type { RouteContext } from "./routes/context.js";
import {
  applyWorldReplaySelection,
  firstHeaderValue,
  formatSseFrame,
  formatSseRetry,
  initialWorldReplayCursorState,
  parseBoundedWorldMs,
  parseWorldCursorParam,
  parseWorldLastCursor,
  parseWorldLastEventId,
  parseWorldLimit,
  parseWorldLive,
  parseWorldSince,
  selectWorldReplayEvents,
  WorldSnapshotPresenter,
  worldCursorForEvent,
} from "./routes/world-stream.js";
import { LiveStreamPool } from "./routes/live-stream-pool.js";
import { publicWorldStudentFromPresence } from "./services/ruby-high/world-projection.js";
import { getPrivyPublicConfigFromEnv } from "./services/privy-auth.js";
import { TokenBucket } from "./services/rate-limit.js";
import { GRADES, type Grade } from "./types.js";

export type { RouteContext } from "./routes/context.js";

const PUBLIC_READ_LIMITER = new TokenBucket(120, 2);
const PUBLIC_READ_LIMITER_GC_INTERVAL_MS = 60_000;
const WORLD_LIVE_STREAM_LIMIT = 6;
const WORLD_LIVE_STREAM_POOL = new LiveStreamPool(WORLD_LIVE_STREAM_LIMIT);
const PUBLIC_VISITOR_ID_RE = /^rhv_[A-Za-z0-9._:-]{4,124}$/;
let publicReadLimiterLastGcAt = 0;
type WorldLiveStreamCloseReason = "client" | "finish" | "timeout" | "write-failure" | "handler-error";
type WorldLiveStreamWritePhase = "initial" | "snapshot" | "event" | "heartbeat" | "end";
const WORLD_LIVE_STREAM_STATS = {
  accepted: 0,
  rejected: 0,
  closed: 0,
  closedByClient: 0,
  closedByFinish: 0,
  closedByTimeout: 0,
  closedByWriteFailure: 0,
  handlerErrors: 0,
  writeFailures: 0,
  initialWriteFailures: 0,
  snapshotWriteFailures: 0,
  eventWriteFailures: 0,
  heartbeatWriteFailures: 0,
  endWriteFailures: 0,
};

function recordWorldLiveStreamClose(reason: WorldLiveStreamCloseReason): void {
  WORLD_LIVE_STREAM_STATS.closed += 1;
  if (reason === "client") WORLD_LIVE_STREAM_STATS.closedByClient += 1;
  else if (reason === "finish") WORLD_LIVE_STREAM_STATS.closedByFinish += 1;
  else if (reason === "timeout") WORLD_LIVE_STREAM_STATS.closedByTimeout += 1;
  else if (reason === "write-failure") WORLD_LIVE_STREAM_STATS.closedByWriteFailure += 1;
  else if (reason === "handler-error") WORLD_LIVE_STREAM_STATS.handlerErrors += 1;
}

function recordWorldLiveStreamWriteFailure(phase: WorldLiveStreamWritePhase): void {
  WORLD_LIVE_STREAM_STATS.writeFailures += 1;
  if (phase === "initial") WORLD_LIVE_STREAM_STATS.initialWriteFailures += 1;
  else if (phase === "snapshot") WORLD_LIVE_STREAM_STATS.snapshotWriteFailures += 1;
  else if (phase === "event") WORLD_LIVE_STREAM_STATS.eventWriteFailures += 1;
  else if (phase === "heartbeat") WORLD_LIVE_STREAM_STATS.heartbeatWriteFailures += 1;
  else if (phase === "end") WORLD_LIVE_STREAM_STATS.endWriteFailures += 1;
}

function publicClientKey(ctx: RouteContext): string {
  const ip = ctx.clientIp || "no-ip";
  const visitor = firstHeaderValue(ctx.visitorHeader).trim();
  if (!PUBLIC_VISITOR_ID_RE.test(visitor)) return ip;
  const visitorHash = createHash("sha256").update(visitor).digest("hex").slice(0, 16);
  return `${ip}:visitor:${visitorHash}`;
}

function publicReadRateKey(ctx: RouteContext, scope: string): string {
  return `${publicClientKey(ctx)}:${scope}`;
}

function publicWorldViewerStateKey(runtime: IAgentRuntime | null, ctx: RouteContext): string | null {
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
  if (!auth) return null;
  const token = auth.parseSessionToken(ctx.cookieHeader);
  const record = auth.resolve(token);
  return record ? auth.stateKeyForRecord(record) : null;
}

function worldLiveStreamKey(ctx: RouteContext): string {
  return publicClientKey(ctx);
}

function reserveWorldLiveStream(ctx: RouteContext): (() => void) | null {
  const release = WORLD_LIVE_STREAM_POOL.reserve(worldLiveStreamKey(ctx));
  if (release) WORLD_LIVE_STREAM_STATS.accepted += 1;
  else WORLD_LIVE_STREAM_STATS.rejected += 1;
  return release;
}

function rejectWorldLiveStreamLimit(ctx: RouteContext): void {
  const res = ctx.res as { setHeader?: (name: string, value: string) => void };
  res.setHeader?.("Retry-After", "5");
  ctx.error(ctx.res, "Too many live world streams.", 429);
}

function worldLiveStreamOpsSnapshot(): AdminOpsSnapshot["worldLiveStreams"] {
  return {
    ...WORLD_LIVE_STREAM_POOL.snapshot(),
    ...WORLD_LIVE_STREAM_STATS,
  };
}

function publicReadLimiterOpsSnapshot(): AdminOpsSnapshot["publicReadLimiter"] {
  return {
    trackedKeys: PUBLIC_READ_LIMITER.size(),
    gcIntervalMs: PUBLIC_READ_LIMITER_GC_INTERVAL_MS,
    lastGcAt: publicReadLimiterLastGcAt || null,
  };
}

function adminOpsSnapshot(): AdminOpsSnapshot {
  return {
    publicReadLimiter: publicReadLimiterOpsSnapshot(),
    worldLiveStreams: worldLiveStreamOpsSnapshot(),
  };
}

function setNoStoreJsonHeaders(res: unknown): void {
  const r = res as { setHeader?: (name: string, value: string) => void };
  r.setHeader?.("Cache-Control", "no-store");
}

function sessionCommandOriginAllowed(ctx: RouteContext): boolean {
  const origin = firstHeaderValue(ctx.originHeader);
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidates = [
      ctx.callbackUrlBuilder ? ctx.callbackUrlBuilder("/") : null,
      ctx.url?.origin ?? null,
    ].filter(Boolean) as string[];
    if (candidates.length === 0) return true;
    return candidates.some((candidate) => {
      const candidateUrl = new URL(candidate);
      return candidateUrl.origin === originUrl.origin
        || (originUrl.protocol === "https:" && candidateUrl.host === originUrl.host);
    });
  } catch {
    return false;
  }
}

function sessionCommandRequestLooksLikeJson(ctx: RouteContext): boolean {
  const contentType = firstHeaderValue(ctx.contentTypeHeader).toLowerCase();
  return !contentType || contentType.startsWith("application/json");
}

function rejectBadSessionCommandMutation(ctx: RouteContext): boolean {
  if (!sessionCommandRequestLooksLikeJson(ctx)) {
    ctx.error(ctx.res, "Command requests must be sent as JSON.", 415);
    return true;
  }
  if (!sessionCommandOriginAllowed(ctx)) {
    ctx.error(ctx.res, "Command request origin is not allowed.", 403);
    return true;
  }
  return false;
}

function takePublicReadToken(ctx: RouteContext, scope: string): boolean {
  const now = Date.now();
  if (now - publicReadLimiterLastGcAt >= PUBLIC_READ_LIMITER_GC_INTERVAL_MS) {
    PUBLIC_READ_LIMITER.gc(now);
    publicReadLimiterLastGcAt = now;
  }
  const key = publicReadRateKey(ctx, scope);
  if (PUBLIC_READ_LIMITER.take(key, 1, now)) return true;
  const retryAfter = PUBLIC_READ_LIMITER.retryAfterSeconds(key, now);
  const res = ctx.res as { setHeader?: (name: string, value: string) => void };
  res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
  ctx.error(ctx.res, "Too many public read requests.", 429);
  return false;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseSessionId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/apps\/ruby-high\/session\/([^/]+)(?:\/.*)?$/);
  return m?.[1] ? decodePathSegment(m[1]) : null;
}

function parseSessionSubroute(pathname: string): "command" | "control" | null {
  if (pathname.endsWith("/command")) return "command";
  if (pathname.endsWith("/control")) return "control";
  return null;
}

function parseCohortGradePath(pathname: string): { matches: boolean; grade: Grade | null; invalidGrade: string | null } {
  if (pathname === `${APP_ROUTE_PREFIX}/cohort`) return { matches: true, grade: null, invalidGrade: null };
  const prefix = `${APP_ROUTE_PREFIX}/cohort/`;
  if (!pathname.startsWith(prefix)) return { matches: false, grade: null, invalidGrade: null };
  const rawGrade = decodePathSegment(pathname.slice(prefix.length));
  if (rawGrade === null) return { matches: true, grade: null, invalidGrade: "malformed" };
  if (!rawGrade || rawGrade.includes("/")) return { matches: false, grade: null, invalidGrade: null };
  if (!GRADES.includes(rawGrade as Grade)) return { matches: true, grade: null, invalidGrade: rawGrade };
  return { matches: true, grade: rawGrade as Grade, invalidGrade: null };
}

interface SseResponse {
  writeHead?(status: number, headers: Record<string, string | string[]>): void;
  setHeader?(name: string, value: string | string[]): void;
  write?(chunk: string): boolean | void;
  end(body?: string): void;
  flushHeaders?: () => void;
  statusCode?: number;
  on?(event: "close" | "finish", listener: () => void): void;
}

async function sendWorldEventStream(ctx: RouteContext, ruby: RubyHighService, opts: { onClose?: () => void; viewerSessionId?: string | null } = {}): Promise<void> {
  const res = ctx.res as SseResponse;
  const headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (typeof res.writeHead === "function") {
    res.writeHead(200, headers);
  } else {
    res.statusCode = 200;
    for (const [name, value] of Object.entries(headers)) res.setHeader?.(name, value);
  }
  res.flushHeaders?.();
  const live = parseWorldLive(ctx.url);
  let closed = false;
  let polling = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  function cleanup(end: boolean, reason: WorldLiveStreamCloseReason) {
    if (closed) return;
    closed = true;
    if (live) recordWorldLiveStreamClose(reason);
    opts.onClose?.();
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
    if (end) {
      write(formatSseFrame("end", { ok: true, generatedAt: Date.now(), eventCount: 0 }), { allowClosed: true, phase: "end" });
      try {
        res.end(buffered || undefined);
      } catch {
        // The socket may already be gone; cleanup has already released the slot.
      }
    }
  }
  let buffered = "";
  const write = (chunk: string, opts: { allowClosed?: boolean; phase?: WorldLiveStreamWritePhase } = {}) => {
    if (closed && !opts.allowClosed) return false;
    try {
      if (typeof res.write === "function") res.write(chunk);
      else buffered += chunk;
      return true;
    } catch {
      if (live) recordWorldLiveStreamWriteFailure(opts.phase ?? "event");
      cleanup(false, "write-failure");
      return false;
    }
  };
  const send = (event: string, data: unknown, id?: string, phase: WorldLiveStreamWritePhase = "event") => {
    return write(formatSseFrame(event, data, id), { phase });
  };
  const explicitSince = parseWorldSince(ctx.url);
  const replayState = initialWorldReplayCursorState({
    explicitSince,
    lastEventId: parseWorldLastEventId(ctx),
    durableCursor: parseWorldCursorParam(ctx.url) ?? parseWorldLastCursor(ctx),
    live,
  });
  const presenter = new WorldSnapshotPresenter();
  const sendSnapshotAndEvents = async (snapshotOpts: { forceSnapshot?: boolean } = {}) => {
    const limit = parseWorldLimit(ctx.url);
    const now = Date.now();
    const world = ruby.filterSchoolWorldSnapshotForSession(
      await ruby.getFreshSchoolWorldSnapshot(0, now),
      opts.viewerSessionId,
    );
    if (closed) {
      return { generatedAt: world.generatedAt, eventCount: 0, snapshotChanged: false };
    }
    const worldEvents = ruby.filterSchoolWorldEventsForSession(
      await ruby.getFreshSchoolWorldEvents(limit, now),
      opts.viewerSessionId,
    );
    if (closed) {
      return { generatedAt: world.generatedAt, eventCount: 0, snapshotChanged: false };
    }
    const snapshot = presenter.snapshotFrame(world, { force: snapshotOpts.forceSnapshot });
    if (snapshot.frame && !write(snapshot.frame, { phase: "snapshot" })) {
      return { generatedAt: world.generatedAt, eventCount: 0, snapshotChanged: snapshot.changed };
    }
    const replay = selectWorldReplayEvents(worldEvents, replayState);
    const deliveredEvents: typeof replay.events = [];
    for (const event of replay.events) {
      if (!send("world-event", event, worldCursorForEvent(event))) break;
      deliveredEvents.push(event);
    }
    applyWorldReplaySelection(replayState, { ...replay, events: deliveredEvents });
    return { generatedAt: world.generatedAt, eventCount: deliveredEvents.length, snapshotChanged: snapshot.changed };
  };
  res.on?.("close", () => cleanup(false, "client"));
  res.on?.("finish", () => cleanup(false, "finish"));
  if (!write(formatSseRetry(5000), { phase: "initial" })) return;
  let first: Awaited<ReturnType<typeof sendSnapshotAndEvents>>;
  try {
    first = await sendSnapshotAndEvents({ forceSnapshot: true });
  } catch (err) {
    if (closed) return;
    send("end", {
      ok: false,
      generatedAt: Date.now(),
      eventCount: 0,
      error: "World stream unavailable.",
    }, undefined, "end");
    if (live) cleanup(false, "handler-error");
    try {
      res.end(buffered || undefined);
    } catch {
      // The client may already be gone; live cleanup has released the stream slot.
    }
    return;
  }
  if (!live) {
    if (closed) return;
    send("end", { ok: true, generatedAt: first.generatedAt, eventCount: first.eventCount }, undefined, "end");
    res.end(buffered || undefined);
    return;
  }
  if (closed) return;
  const heartbeatMs = parseBoundedWorldMs(ctx.url, "heartbeatMs", 5000, 1000, 30000);
  const streamMs = parseBoundedWorldMs(ctx.url, "streamMs", 55000, 1000, 120000);
  interval = setInterval(() => {
    if (closed) return;
    if (!send("heartbeat", { ok: true, generatedAt: Date.now(), eventCount: 0 }, undefined, "heartbeat")) return;
    if (polling) return;
    polling = true;
    void sendSnapshotAndEvents()
      .catch(() => {
        // Keep the stream alive; storage refresh errors are logged by the service.
      })
      .finally(() => {
        polling = false;
      });
  }, heartbeatMs);
  timeout = setTimeout(() => cleanup(true, "timeout"), streamMs);
}

function publicCohortStudents(students: ReturnType<RubyHighService["getRecentlyActiveStudents"]>) {
  return students.map((student) => publicWorldStudentFromPresence({
    sessionId: student.sessionId,
    grade: student.grade as Grade,
    facultyId: "",
    displayName: "",
    name: student.name,
    playbookId: student.playbookId,
    stats: student.stats,
    classGrades: student.classGrades,
    yearbookCount: student.yearbookCount,
    lastActive: student.lastActive,
    portraitUrl: student.portraitUrl,
  }));
}

type NodeLikeResponse = {
  getHeader?: (name: string) => string | string[] | number | undefined;
  setHeader?: (name: string, value: string | string[]) => void;
};

function setCookieHeader(res: unknown, value: string): void {
  const r = res as NodeLikeResponse;
  const existing = r.getHeader?.("Set-Cookie");
  if (Array.isArray(existing)) r.setHeader?.("Set-Cookie", [...existing, value]);
  else if (typeof existing === "string") r.setHeader?.("Set-Cookie", [existing, value]);
  else r.setHeader?.("Set-Cookie", value);
}

function cookieHeaderWithSessionToken(cookieHeader: string | null | undefined, token: string): string {
  const parts = (cookieHeader ?? "")
    .split(/;\s*/)
    .filter((part) => {
      const index = part.indexOf("=");
      return index > 0 && part.slice(0, index) !== "rh_session";
    });
  return [`rh_session=${encodeURIComponent(token)}`, ...parts].join("; ");
}

export async function resolveLaunchSession(
  ctx: AppBridgeLaunchContext,
): Promise<AppSessionState | null> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  if (!ruby) return null;
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  // Launch context from app hosts does not always carry an HTTP cookie,
  // so launch-time state lands in the anonymous bucket. The interactive HTTP
  // routes pick up the per-user state once the browser sends rh_session.
  const state = ruby.getOrCreate(getSessionId(runtime));
  return buildSessionState({ runtime, state, faculty });
}

export async function refreshRunSession(
  ctx: AppBridgeRunContext,
): Promise<AppSessionState | null> {
  return resolveLaunchSession(ctx);
}

export async function collectLaunchDiagnostics(
  ctx: AppBridgeRunContext,
): Promise<AppLaunchDiagnostic[]> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  const diagnostics: AppLaunchDiagnostic[] = [];
  if (!ruby) {
    diagnostics.push({
      code: "ruby-high-service-missing",
      severity: "error",
      message: "RubyHighService is not registered in the Ruby High runtime.",
    });
  }
  if (!faculty) {
    diagnostics.push({
      code: "ruby-high-faculty-missing",
      severity: "warning",
      message: "FacultyService is not registered; question picking will be unavailable.",
    });
  }
  return diagnostics;
}

export async function handleAppRoutes(ctx: RouteContext): Promise<boolean> {
  const runtime = getRuntime(ctx.runtime);

  if ((ctx.method === "GET" || ctx.method === "HEAD") && ctx.pathname === MANIFEST_PATH) {
    sendManifest(ctx.res, ctx.method === "GET");
    return true;
  }

  if ((ctx.method === "GET" || ctx.method === "HEAD") && ctx.pathname === SERVICE_WORKER_PATH) {
    sendServiceWorker(ctx.res, ctx.method === "GET");
    return true;
  }

  if (ctx.pathname === BUG_REPORT_PATH) {
    return handleBugReportRoute(ctx);
  }

  if (ctx.pathname.startsWith(FIRST_BELL_PREFIX)) {
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    return handleFirstBellRoutes(ctx, ruby);
  }

  if (ctx.pathname.startsWith("/api/apps/ruby-high/yearbook")) {
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    return handleYearbookRoutes(ctx, ruby);
  }

  if (ctx.method === "GET" && ctx.pathname === `${APP_ROUTE_PREFIX}/world`) {
    if (!takePublicReadToken(ctx, "world")) return true;
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    const viewerSessionId = publicWorldViewerStateKey(runtime, ctx);
    const world = ruby.filterSchoolWorldSnapshotForSession(
      await ruby.getFreshSchoolWorldSnapshot(parseWorldLimit(ctx.url)),
      viewerSessionId,
    );
    setNoStoreJsonHeaders(ctx.res);
    ctx.json(ctx.res, { ok: true, world });
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${APP_ROUTE_PREFIX}/world/events`) {
    if (!takePublicReadToken(ctx, "world-events")) return true;
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    const live = parseWorldLive(ctx.url);
    const releaseLiveStream = live ? reserveWorldLiveStream(ctx) : null;
    if (live && !releaseLiveStream) {
      rejectWorldLiveStreamLimit(ctx);
      return true;
    }
    try {
      await sendWorldEventStream(ctx, ruby, {
        onClose: releaseLiveStream ?? undefined,
        viewerSessionId: publicWorldViewerStateKey(runtime, ctx),
      });
    } catch (err) {
      if (live) recordWorldLiveStreamClose("handler-error");
      releaseLiveStream?.();
      throw err;
    }
    return true;
  }

  const cohortPath = parseCohortGradePath(ctx.pathname);
  if (ctx.method === "GET" && cohortPath.matches) {
    if (!takePublicReadToken(ctx, "cohort")) return true;
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    if (cohortPath.invalidGrade) {
      ctx.error(ctx.res, `Unknown grade: ${cohortPath.invalidGrade}`, 400);
      return true;
    }
    const currentGrade = cohortPath.grade ?? (() => {
      const sessionId = getSessionId(runtime, ctx.cookieHeader);
      const state = ruby.getOrCreate(sessionId);
      return state.currentGrade ?? "9";
    })();
    const snapshot = await ruby.getFreshSchoolSnapshot();
    const students = publicCohortStudents(snapshot.topByYear[currentGrade] || []);
    setNoStoreJsonHeaders(ctx.res);
    ctx.json(ctx.res, { ok: true, grade: currentGrade, students });
    return true;
  }
  if (ctx.pathname === ADMIN_METRICS_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminMetricsRoute(ctx, { auth, ruby, ops: adminOpsSnapshot() });
  }

  if (ctx.pathname === ADMIN_METRICS_SCHEMA_PATH) {
    return handleAdminMetricsSchemaRoute(ctx);
  }

  if (ctx.pathname === ADMIN_OVERVIEW_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminOverviewRoute(ctx, { auth, ruby, ops: adminOpsSnapshot() });
  }

  if (ctx.pathname === ADMIN_CURRICULUM_REPLENISHMENT_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminCurriculumReplenishmentRoute(ctx, { auth, ruby });
  }

  if (ctx.pathname === ADMIN_WORLD_MODERATION_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminWorldModerationRoute(ctx, { auth, ruby });
  }

  if (ctx.pathname === METRICS_EVENT_PATH) {
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    return handleMetricsEventRoute(ctx, {
      ruby,
      sessionId: getSessionId(runtime, ctx.cookieHeader),
    });
  }

  if (ctx.method === "GET" && ctx.pathname === ADMIN_PATH) {
    sendHtmlResponse(ctx.res, renderAdminDashboardHtml(), ctx.acceptEncoding);
    return true;
  }

  if (ctx.pathname.startsWith(BILLING_PREFIX)) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleBillingRoutes(ctx, { auth, ruby });
  }

  if (ctx.pathname.startsWith("/api/apps/ruby-high/nft")) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleNftRoutes(ctx, { auth, ruby });
  }

  if (
    ctx.pathname.startsWith("/api/apps/ruby-high/auth") ||
    ctx.pathname.startsWith("/api/apps/ruby-high/chat")
  ) {
    return handleChatRoutes({
      method: ctx.method,
      pathname: ctx.pathname,
      url: ctx.url,
      runtime: ctx.runtime,
      res: ctx.res,
      cookieHeader: ctx.cookieHeader,
      apiKeyHeader: ctx.apiKeyHeader,
      visitorHeader: ctx.visitorHeader,
      authorizationHeader: ctx.authorizationHeader,
      callbackUrlBuilder: ctx.callbackUrlBuilder,
      isSecure: ctx.isSecure,
      clientIp: ctx.clientIp,
      originHeader: ctx.originHeader,
      error: ctx.error,
      json: ctx.json,
      readJsonBody: ctx.readJsonBody,
    });
  }

  if (
    ctx.pathname.startsWith("/api/apps/ruby-high/pack-library") ||
    ctx.pathname.startsWith("/api/apps/ruby-high/pack/") ||
    ctx.pathname.startsWith("/api/apps/ruby-high/pack-drafts")
  ) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handlePackLibraryRoutes(
      {
        method: ctx.method,
        pathname: ctx.pathname,
        url: ctx.url,
        res: ctx.res,
        cookieHeader: ctx.cookieHeader,
        apiKeyHeader: ctx.apiKeyHeader,
        clientIp: ctx.clientIp,
        contentTypeHeader: ctx.contentTypeHeader,
        originHeader: ctx.originHeader,
        callbackUrlBuilder: ctx.callbackUrlBuilder,
        error: ctx.error,
        json: ctx.json,
        readJsonBody: ctx.readJsonBody,
      },
      {
        auth,
        ruby,
        sessionIdFor: (cookieHeader) => getSessionId(runtime, cookieHeader),
      },
    );
  }


  // X (Twitter) social integration — per-teacher OAuth and milestone posting.
  if (ctx.pathname.startsWith(X_SOCIAL_PREFIX)) {
    const xSocial = tryGetService<XSocialService>(runtime, XSocialService.serviceType);
    if (!xSocial) {
      ctx.error(ctx.res, "XSocialService unavailable", 503);
      return true;
    }
    return handleXSocialRoutes(ctx, xSocial);
  }

  // Pack endpoints: per-session ownership, auth required.
  if (ctx.pathname.startsWith("/api/apps/ruby-high/packs")) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handlePackRoutes(
      {
        method: ctx.method,
        pathname: ctx.pathname,
        url: ctx.url,
        res: ctx.res,
        cookieHeader: ctx.cookieHeader,
        contentTypeHeader: ctx.contentTypeHeader,
        originHeader: ctx.originHeader,
        callbackUrlBuilder: ctx.callbackUrlBuilder,
        error: ctx.error,
        json: ctx.json,
        readJsonBody: ctx.readJsonBody,
      },
      {
        auth,
        ruby,
        sessionIdFor: (cookieHeader) => getSessionId(runtime, cookieHeader),
      },
    );
  }

  if (ctx.method === "GET" && ctx.pathname === VIEWER_PATH) {
    const role = ctx.url?.searchParams.get("role") === "agent" ? "agent" : "human";
    sendHtmlResponse(
      ctx.res,
      renderViewerHtml({
        agentName: getCharacterName(runtime),
        sessionId: getSessionId(runtime, ctx.cookieHeader),
        apiBase: APP_ROUTE_PREFIX,
        role,
        build: process.env.RUBY_HIGH_BUILD ?? "dev",
        privy: getPrivyPublicConfigFromEnv() ?? undefined,
      }),
      ctx.acceptEncoding,
    );
    return true;
  }

  if ((ctx.method === "GET" || ctx.method === "HEAD") && ctx.pathname.startsWith(ASSETS_PREFIX)) {
    const name = ctx.pathname.slice(ASSETS_PREFIX.length);
    const sent = await sendAsset(ctx.res, name, ctx.ifNoneMatch ?? null, ctx.method === "GET", ctx.url?.searchParams.has("v") ?? false);
    if (sent) return true;
    ctx.error(ctx.res, `Asset not found: ${name}`, 404);
    return true;
  }

  if (!parseSessionId(ctx.pathname)) return false;

  const subroute = parseSessionSubroute(ctx.pathname);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  if (!ruby) {
    ctx.error(ctx.res, "RubyHighService unavailable", 503);
    return true;
  }
  const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  const stateKey = getSessionId(runtime, ctx.cookieHeader);

  if (ctx.method === "GET" && !subroute) {
    await ruby.refreshPublicWorldSessions(Date.now());
    const state = ruby.getOrCreate(stateKey);
    ctx.json(ctx.res, buildSessionState({ runtime, state, faculty, cookieHeader: ctx.cookieHeader }));
    return true;
  }

  if (ctx.method === "POST" && subroute === "control") {
    ctx.json(ctx.res, {
      success: true,
      message: "Ruby High has no global pause/resume; the classroom keeps its state until cleared.",
      session: null,
    });
    return true;
  }

  if (ctx.method === "POST" && subroute === "command") {
    if (rejectBadSessionCommandMutation(ctx)) return true;
    let commandStateKey = stateKey;
    let commandCookieHeader = ctx.cookieHeader;
    let commandAuthRecord = null;
    if (auth) {
      const existingToken = auth.parseSessionToken(ctx.cookieHeader);
      const existingRecord = auth.resolve(existingToken);
      const session = existingRecord && existingToken
        ? { token: existingToken, record: existingRecord, isNew: false }
        : { ...(await auth.createGuestSession(existingToken, ctx.visitorHeader)), isNew: true };
      if (session.isNew || session.token !== existingToken) {
        setCookieHeader(ctx.res, auth.buildSessionCookie(session.token, { secure: ctx.isSecure ?? false }));
      }
      commandStateKey = auth.stateKeyForRecord(session.record);
      commandCookieHeader = cookieHeaderWithSessionToken(ctx.cookieHeader, session.token);
      commandAuthRecord = session.record;
    }
    return handleCommandRoute({
      ctx,
      ruby,
      faculty,
      runtime,
      stateKey: commandStateKey,
      auth,
      authRecord: commandAuthRecord,
      cookieHeader: commandCookieHeader,
      rateLimitStateKey: stateKey,
    });
  }

  return false;
}
