import type {
  PluginAppBridgeLaunchContext,
  PluginAppBridgeRunContext,
  PluginAppLaunchDiagnostic,
  PluginAppSessionState,
} from "@elizaos/core";
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
import { ADMIN_METRICS_PATH, handleAdminMetricsRoute } from "./routes/admin.js";
import { handleYearbookRoutes } from "./routes/yearbook.js";
import { buildSessionState, getCharacterName } from "./routes/session-state.js";
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

export async function resolveLaunchSession(
  ctx: PluginAppBridgeLaunchContext,
): Promise<PluginAppSessionState | null> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  if (!ruby) return null;
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  // Launch context (from the eliza app-bridge) doesn't carry an HTTP cookie,
  // so launch-time state lands in the anonymous bucket. The interactive HTTP
  // routes pick up the per-user state once the browser sends rh_session.
  const state = ruby.getOrCreate(getSessionId(runtime));
  return buildSessionState({ runtime, state, faculty });
}

export async function refreshRunSession(
  ctx: PluginAppBridgeRunContext,
): Promise<PluginAppSessionState | null> {
  return resolveLaunchSession(ctx);
}

export async function collectLaunchDiagnostics(
  ctx: PluginAppBridgeRunContext,
): Promise<PluginAppLaunchDiagnostic[]> {
  const runtime = getRuntime(ctx.runtime);
  const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
  const faculty = tryGetService<FacultyService>(runtime, FacultyService.serviceType);
  const diagnostics: PluginAppLaunchDiagnostic[] = [];
  if (!ruby) {
    diagnostics.push({
      code: "ruby-high-service-missing",
      severity: "error",
      message:
        "RubyHighService is not registered. Include @cenetex/app-ruby-high in the character's plugins.",
    });
  }
  if (!faculty) {
    diagnostics.push({
      code: "ruby-high-faculty-missing",
      severity: "warning",
      message:
        "FacultyService is not registered — PICK_QUESTION will fail. Make sure the plugin's services are loaded in the order declared.",
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

  if (ctx.pathname === ADMIN_METRICS_PATH) {
    const auth = tryGetService<AuthService>(runtime, AuthService.serviceType);
    const ruby = tryGetService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!auth || !ruby) {
      ctx.error(ctx.res, !auth ? "AuthService unavailable" : "RubyHighService unavailable", 503);
      return true;
    }
    return handleAdminMetricsRoute(ctx, { auth, ruby });
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
        privy: getPrivyPublicConfigFromEnv() ?? undefined,
      }),
      ctx.acceptEncoding,
    );
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname.startsWith(ASSETS_PREFIX)) {
    const name = ctx.pathname.slice(ASSETS_PREFIX.length);
    const sent = await sendAsset(ctx.res, name, ctx.ifNoneMatch ?? null);
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
    return handleCommandRoute({ ctx, ruby, faculty, runtime, stateKey });
  }

  return false;
}
