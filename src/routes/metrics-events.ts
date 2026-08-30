import { RubyHighService } from "../services/ruby-high-service.js";
import { TokenBucket } from "../services/rate-limit.js";
import { clientSurfaceFromUserAgent, visitorHashFromHeader } from "../services/auth-service.js";
import type { MetricClientSurface } from "../services/state-store.js";
import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX } from "./constants.js";

export const METRICS_EVENT_PATH = `${APP_ROUTE_PREFIX}/metrics/event`;

const METRICS_EVENT_LIMITER = new TokenBucket(60, 1);

type MetricsEventBody = {
  type?: unknown;
  clientSurface?: unknown;
  campaignSource?: unknown;
  campaignId?: unknown;
  landingVariant?: unknown;
  entrypoint?: unknown;
  inactiveMs?: unknown;
  reason?: unknown;
  path?: unknown;
  referrer?: unknown;
  ref?: unknown;
  destination?: unknown;
  kind?: unknown;
  landing?: unknown;
  shareId?: unknown;
  grade?: unknown;
  packId?: unknown;
  repeatRate?: unknown;
  diagnosticType?: unknown;
  level?: unknown;
  stage?: unknown;
  errorMessage?: unknown;
  errorName?: unknown;
  errorCode?: unknown;
  dataError?: unknown;
  dataMessage?: unknown;
  causeMessage?: unknown;
  privyErrorCode?: unknown;
  walletClientType?: unknown;
  connectorType?: unknown;
  provider?: unknown;
  addressPreview?: unknown;
  questionId?: unknown;
  faculty?: unknown;
  phantomAvailable?: unknown;
  hasWindowPhantom?: unknown;
  hasWindowSolana?: unknown;
  providerIsPhantom?: unknown;
  hasConnect?: unknown;
  hasSignMessage?: unknown;
  step?: unknown;
  failureKind?: unknown;
  statusCode?: unknown;
  beats?: unknown;
  items?: unknown;
};

const VIEWER_ONBOARDING_STEPS = new Set([
  "onboarding_intro_shown",
  "onboarding_creation_opened",
  "onboarding_candidate_ready",
  "onboarding_enrollment_started",
]);

export async function handleMetricsEventRoute(
  ctx: RouteContext,
  deps: {
    ruby: RubyHighService;
    sessionId: string;
  },
): Promise<boolean> {
  if (ctx.pathname !== METRICS_EVENT_PATH) return false;
  if (ctx.method !== "POST") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const limitKey = metricsRateLimitKey(ctx.clientIp, deps.sessionId);
  if (!METRICS_EVENT_LIMITER.take(limitKey)) {
    const retryAfter = METRICS_EVENT_LIMITER.retryAfterSeconds(limitKey);
    const res = ctx.res as { setHeader?: (name: string, value: string) => void };
    res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
    ctx.error(ctx.res, "Too many metrics events.", 429);
    return true;
  }
  const body = (await ctx.readJsonBody().catch(() => ({}))) as MetricsEventBody;
  const type = typeof body?.type === "string" ? body.type : "";
  const visitorHash = visitorHashFromHeader(ctx.visitorHeader);
  const clientSurface = trustedMetricClientSurface(body.clientSurface, ctx.userAgentHeader, deps.sessionId);
  if (type === "app_open") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordAppOpenDurably(deps.sessionId, {
      source: "viewer",
      clientSurface,
      visitorHash,
      attribution: {
        source: body.campaignSource,
        campaignId: body.campaignId,
        landingVariant: body.landingVariant,
        entrypoint: body.entrypoint,
      },
    }));
  }
  if (type === "take_card_started" || type === "class_result_viewed") {
    return await respondAfterMetricPersist(ctx, async () => {
      await deps.ruby.recordViewerClassFlowMilestoneDurably(deps.sessionId, type, {
        visitorHash,
        clientSurface,
        questionId: requestString(body.questionId),
      });
    });
  }
  if (type === "funnel_step") {
    const step = requestString(body.step);
    if (!step || !VIEWER_ONBOARDING_STEPS.has(step)) {
      ctx.error(ctx.res, "Unknown onboarding funnel step.", 400);
      return true;
    }
    return await respondAfterMetricPersist(ctx, async () => {
      await deps.ruby.recordViewerOnboardingStepDurably(deps.sessionId, step as
        | "onboarding_intro_shown"
        | "onboarding_creation_opened"
        | "onboarding_candidate_ready"
        | "onboarding_enrollment_started", {
        visitorHash,
        clientSurface,
      });
    });
  }
  if (type === "onboarding_enrollment_failed") {
    return await respondAfterMetricPersist(ctx, async () => {
      const failureKind = onboardingEnrollmentFailureKind(body.failureKind);
      const statusCode = Number(body.statusCode);
      await deps.ruby.recordMetricEventDurably("error", {
        sessionId: deps.sessionId,
        ...(visitorHash ? { visitorHash } : {}),
        ...(clientSurface ? { clientSurface } : {}),
        source: "viewer",
        feature: "first_run_onboarding",
        step: "onboarding_enrollment_failed",
        status: "error",
        metadata: {
          failureKind,
          ...(Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? { statusCode } : {}),
        },
      });
    });
  }
  if (type === "share_initiated") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordShareInitiatedDurably(deps.sessionId, {
      visitorHash,
      shareId: typeof body.shareId === "string" ? body.shareId : undefined,
      destination: typeof body.destination === "string" ? body.destination : undefined,
      kind: typeof body.kind === "string" ? body.kind : undefined,
    }));
  }
  if (type === "share_link_visited") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordShareLinkVisitedDurably(deps.sessionId, {
      visitorHash,
      ref: typeof body.ref === "string" ? body.ref : undefined,
      landing: typeof body.landing === "string" ? body.landing : undefined,
    }));
  }
  if (type === "session_resume") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordSessionResumeDurably(deps.sessionId, {
      source: "viewer",
      visitorHash,
      inactiveMs: typeof body.inactiveMs === "number" ? body.inactiveMs : Number(body.inactiveMs),
      reason: typeof body.reason === "string" ? body.reason : undefined,
    }));
  }
  if (type === "yearbook_open") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordYearbookOpenDurably(deps.sessionId, {
      visitorHash,
      shareId: typeof body.shareId === "string" ? body.shareId : undefined,
      grade: typeof body.grade === "string" ? body.grade : undefined,
    }));
  }
  if (type === "yearbook_copy") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordYearbookCopyDurably(deps.sessionId, {
      visitorHash,
      shareId: typeof body.shareId === "string" ? body.shareId : undefined,
      grade: typeof body.grade === "string" ? body.grade : undefined,
    }));
  }
  if (type === "guest_spotlight_seen") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordGuestSpotlightSeenDurably(deps.sessionId, {
      visitorHash,
      packId: typeof body.packId === "string" ? body.packId : undefined,
    }));
  }
  if (type === "guest_spotlight_started") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordGuestSpotlightStartedDurably(deps.sessionId, {
      visitorHash,
      packId: typeof body.packId === "string" ? body.packId : undefined,
    }));
  }
  if (type === "balance_sample") {
    return await respondAfterMetricPersist(ctx, () => deps.ruby.recordBalanceSampleDurably({
      source: "viewer",
      metadata: {
        ...(Number.isFinite(Number(body.repeatRate)) ? { repeatRate: Number(body.repeatRate) } : {}),
      },
    }));
  }
  if (type === "teacher_response_viewed" || type === "room_reaction_viewed") {
    return await respondAfterMetricPersist(ctx, async () => {
      await deps.ruby.recordMetricEventDurably(type, {
        sessionId: deps.sessionId,
        ...(visitorHash ? { visitorHash } : {}),
        source: "viewer",
        feature: "daily_class_ritual",
        step: type === "teacher_response_viewed" ? "teacher_response" : "room_reaction",
        status: "success",
        metadata: {
          ...(requestString(body.questionId) ? { questionId: requestString(body.questionId) } : {}),
          ...(requestString(body.faculty) ? { faculty: requestString(body.faculty) } : {}),
        },
      });
    });
  }
  if (
    type === "scene_summary_opened" ||
    type === "dialogue_log_opened" ||
    type === "scene_latest_used" ||
    type === "scene_advanced"
  ) {
    return await respondAfterMetricPersist(ctx, async () => {
      const count = type === "scene_summary_opened" ? Number(body.beats) : Number(body.items);
      await deps.ruby.recordMetricEventDurably(type, {
        sessionId: deps.sessionId,
        ...(visitorHash ? { visitorHash } : {}),
        ...(clientSurface ? { clientSurface } : {}),
        source: "viewer",
        feature: "scene_flow",
        step: type,
        status: "success",
        metadata: {
          ...(requestString(body.questionId) ? { questionId: requestString(body.questionId) } : {}),
          ...(Number.isInteger(count) && count >= 0 && count <= 100 ? { count } : {}),
        },
      });
    });
  }
  if (type === "privy_auth_error") {
    return await respondAfterMetricPersist(ctx, async () => {
      await deps.ruby.recordMetricEventDurably("error", {
        sessionId: deps.sessionId,
        ...(visitorHash ? { visitorHash } : {}),
        source: "viewer",
        feature: "privy_wallet_auth",
        step: requestString(body.diagnosticType) || requestString(body.stage) || "privy_auth_error",
        status: "error",
        metadata: privyAuthErrorMetadata(body),
      });
    });
  }
  ctx.error(ctx.res, "Unknown metrics event type.", 400);
  return true;
}

function metricsRateLimitKey(clientIp: string | null | undefined, sessionId: string): string {
  return `${clientIp || "no-ip"}:${sessionId || "anon"}`;
}

function metricClientSurface(value: unknown): MetricClientSurface | undefined {
  return value === "viewer"
    || value === "agent"
    || value === "smoke"
    || value === "api"
    ? value
    : undefined;
}

function trustedMetricClientSurface(
  claimedValue: unknown,
  userAgent: string | string[] | null | undefined,
  sessionId: string,
): MetricClientSurface | undefined {
  const normalizedSessionId = sessionId.toLowerCase();
  if (normalizedSessionId.startsWith("rh:agent-player:") || normalizedSessionId.startsWith("rh:agent:")) {
    return "agent";
  }
  const observed = clientSurfaceFromUserAgent(userAgent);
  if (observed) return observed;
  const claimed = metricClientSurface(claimedValue);
  return claimed === "viewer" || claimed === "api" ? claimed : undefined;
}

function requestString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || undefined;
}

function requestBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function onboardingEnrollmentFailureKind(value: unknown): string {
  const kind = requestString(value);
  return kind === "http" || kind === "network" || kind === "timeout"
    ? kind
    : "missing_response";
}

function privyAuthErrorMetadata(body: MetricsEventBody): Record<string, string | boolean> {
  const metadata: Record<string, string | boolean> = {};
  const stringFields: Array<keyof MetricsEventBody> = [
    "diagnosticType",
    "level",
    "stage",
    "errorMessage",
    "errorName",
    "errorCode",
    "dataError",
    "dataMessage",
    "causeMessage",
    "privyErrorCode",
    "walletClientType",
    "connectorType",
    "provider",
    "addressPreview",
  ];
  for (const field of stringFields) {
    const value = requestString(body[field]);
    if (value) metadata[field] = value;
  }
  const booleanFields: Array<keyof MetricsEventBody> = [
    "phantomAvailable",
    "hasWindowPhantom",
    "hasWindowSolana",
    "providerIsPhantom",
    "hasConnect",
    "hasSignMessage",
  ];
  for (const field of booleanFields) {
    const value = requestBoolean(body[field]);
    if (value != null) metadata[field] = value;
  }
  return metadata;
}

async function respondAfterMetricPersist(ctx: RouteContext, persist: () => Promise<void>): Promise<true> {
  try {
    await persist();
    ctx.json(ctx.res, { ok: true });
  } catch {
    ctx.error(ctx.res, "Could not persist metrics event.", 503);
  }
  return true;
}
