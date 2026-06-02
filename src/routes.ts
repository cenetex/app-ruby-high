import type {
  AppBridgeLaunchContext,
  AppBridgeRunContext,
  AppLaunchDiagnostic,
  AppSessionState,
} from "./runtime.js";
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
  ADMIN_PATH,
  handleAdminMetricsSchemaRoute,
  handleAdminOverviewRoute,
  handleAdminMetricsRoute,
  renderAdminDashboardHtml,
} from "./routes/admin.js";
import { handleYearbookRoutes } from "./routes/yearbook.js";
import { buildSessionState, getCharacterName } from "./routes/session-state.js";
import { handleMetricsEventRoute, METRICS_EVENT_PATH } from "./routes/metrics-events.js";
import { handleNftRoutes } from "./routes/nft.js";
import { XSocialService } from "./services/x-social-service.js";
import { handleXSocialRoutes } from "./routes/x-social.js";
import { X_SOCIAL_PREFIX } from "./routes/constants.js";
import type { RouteContext } from "./routes/context.js";
import { getPrivyPublicConfigFromEnv } from "./services/privy-auth.js";

export type { RouteContext } from "./routes/context.js";

function parseSessionId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/apps\/ruby-high\/session\/([^/]+)(?:\/.*)?$/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function parseSessionSubroute(pathname: string): "command" | "control" | null {
  if (pathname.endsWith("/command")) return "command";
  if (pathname.endsWith("/control")) return "control";
  return null;
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

  if (ctx.pathname.startsWith("/api/apps/ruby-high/yearbook")) {
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    return handleYearbookRoutes(ctx, ruby);
  }


  if (ctx.method === "GET" && ctx.pathname === `${APP_ROUTE_PREFIX}/leaderboard`) {
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable", 503);
      return true;
    }
    const snapshot = ruby.getSchoolSnapshot();
    ctx.json(ctx.res, { ok: true, topByYear: snapshot.topByYear });
    return true;
  }
  if (ctx.pathname === ADMIN_METRICS_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminMetricsRoute(ctx, { auth, ruby });
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
    return handleAdminOverviewRoute(ctx, { auth, ruby });
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
        res: ctx.res,
        cookieHeader: ctx.cookieHeader,
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
