import {
  fetchLlmChatCompletions,
  hasConfiguredLlmCredential,
  llmProviderName,
  throwLlmResponseError,
} from "../services/llm-provider.js";
import { log, logMetricsSnapshot } from "../services/logger.js";
import type { AuthAnalyticsSnapshot, AuthService } from "../services/auth-service.js";
import type { RubyHighAnalyticsSnapshot, RubyHighService } from "../services/ruby-high-service.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export const ADMIN_PATH = `${APP_ROUTE_PREFIX}/admin`;
export const ADMIN_METRICS_PATH = `${APP_ROUTE_PREFIX}/admin/metrics`;
export const ADMIN_METRICS_SCHEMA_PATH = `${APP_ROUTE_PREFIX}/admin/metrics/schema`;
export const ADMIN_OVERVIEW_PATH = `${APP_ROUTE_PREFIX}/admin/overview`;
export const ADMIN_METRICS_SCHEMA_VERSION = "ruby-high-admin-metrics.v4";
const ADMIN_METRICS_SCHEMA_PUBLISHED_AT = "2026-05-19";
const ADMIN_METRICS_DEFAULT_TRUST_START = ADMIN_METRICS_SCHEMA_PUBLISHED_AT;

interface AdminDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

interface AdminMetricsSnapshot {
  ok: true;
  schemaVersion: typeof ADMIN_METRICS_SCHEMA_VERSION;
  schemaPath: typeof ADMIN_METRICS_SCHEMA_PATH;
  generatedAt: string;
  auth: AuthAnalyticsSnapshot;
  ruby: RubyHighAnalyticsSnapshot;
  logs: ReturnType<typeof logMetricsSnapshot>;
  quality: AdminMetricsQuality;
}

interface AdminOverview {
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  actions: string[];
}

interface AdminMetricsQualityIssue {
  field: string;
  severity: "info" | "warning";
  issue: string;
  recommendedUse: string;
}

interface AdminMetricsQuality {
  trustStart: string | null;
  issues: AdminMetricsQualityIssue[];
}

interface AdminMetricFieldSchema {
  path: string;
  label: string;
  source: string;
  semantics: string;
  reliability: "authoritative" | "proxy" | "legacy" | "volatile" | "missing";
  caveat?: string;
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function configuredToken(): string | null {
  const raw = process.env.RUBY_HIGH_ADMIN_TOKEN?.trim();
  return raw ? raw : null;
}

function authorized(ctx: RouteContext, token: string): boolean {
  const auth = firstHeader(ctx.authorizationHeader).trim();
  return auth === token || auth === `Bearer ${token}`;
}

function requireAdminAuth(ctx: RouteContext): string | null {
  const token = configuredToken();
  if (!token) {
    ctx.error(ctx.res, "Admin metrics are not configured.", 503);
    return null;
  }
  if (!authorized(ctx, token)) {
    ctx.error(ctx.res, "Unauthorized.", 401);
    return null;
  }
  return token;
}

function buildAdminMetricsSnapshot(deps: AdminDeps): AdminMetricsSnapshot {
  const auth = deps.auth.analyticsSnapshot();
  const ruby = deps.ruby.analyticsSnapshot();
  const logs = logMetricsSnapshot();
  return {
    ok: true,
    schemaVersion: ADMIN_METRICS_SCHEMA_VERSION,
    schemaPath: ADMIN_METRICS_SCHEMA_PATH,
    generatedAt: new Date().toISOString(),
    auth,
    ruby,
    logs,
    quality: buildAdminMetricsQuality({ auth, ruby, logs }),
  };
}

function metricsTrustStart(): string | null {
  const raw = process.env.RUBY_HIGH_METRICS_TRUST_START?.trim();
  return raw || ADMIN_METRICS_DEFAULT_TRUST_START;
}

function buildAdminMetricsQuality(metrics: {
  auth: AuthAnalyticsSnapshot;
  ruby: RubyHighAnalyticsSnapshot;
  logs: ReturnType<typeof logMetricsSnapshot>;
}): AdminMetricsQuality {
  const issues: AdminMetricsQualityIssue[] = [
    {
      field: "auth.users",
      severity: "warning",
      issue: "Counts auth identity records, not deduped people. Guest records can include legacy cookie-bound identities.",
      recommendedUse: "Use only as identity-record volume; use auth.visitors and ruby.retention.visitorD1 for visitor traffic/retention.",
    },
    {
      field: "auth.daily.signedInUsers",
      severity: "warning",
      issue: "Derived from each identity's current lastLoginAt. Historical buckets can move when a user returns.",
      recommendedUse: "Use as a last-seen snapshot, not a durable daily sign-in event count.",
    },
    {
      field: "auth.activeSessions",
      severity: "warning",
      issue: "Counts unexpired cookie sessions, not currently active users.",
      recommendedUse: "Use for cookie/session inventory, not real-time concurrency.",
    },
    {
      field: "logs.counters",
      severity: "info",
      issue: "In-memory process counters reset on deploy, restart, and machine replacement.",
      recommendedUse: "Use for current-process smoke signals only; production trend analysis should use ruby.events.",
    },
  ];
  const guestRecords = metrics.auth.providers.guest;
  const totalRecords = Math.max(1, metrics.auth.users);
  if (guestRecords / totalRecords > 0.8) {
    issues.push({
      field: "auth.providers.guest",
      severity: "warning",
      issue: `${guestRecords} of ${metrics.auth.users} identity records are guest records.`,
      recommendedUse: "Treat legacy acquisition and identity retention as suspect; use auth.visitors and ruby.events visitor-backed app_open/session_resume after the trust start date.",
    });
  }
  if (metrics.ruby.characters > 0 && metrics.ruby.completedGrades === 0) {
    issues.push({
      field: "ruby.completedGrades",
      severity: "info",
      issue: "No completed grades among existing characters.",
      recommendedUse: "Prioritize progression funnel instrumentation and first-grade completion tuning.",
    });
  }
  if (metrics.ruby.events.total === 0) {
    issues.push({
      field: "ruby.events",
      severity: "info",
      issue: "No durable metric events have been recorded yet. The v4 streams start accumulating from deployment.",
      recommendedUse: "Use product-state snapshots until v4 event volume exists; set RUBY_HIGH_METRICS_TRUST_START on deploy.",
    });
  }
  return {
    trustStart: metricsTrustStart(),
    issues,
  };
}

function buildAdminMetricsSchema(): {
  ok: true;
  schemaVersion: typeof ADMIN_METRICS_SCHEMA_VERSION;
  publishedAt: string;
  endpoint: typeof ADMIN_METRICS_PATH;
  schemaPath: typeof ADMIN_METRICS_SCHEMA_PATH;
  bucketTimezone: "UTC";
  trustStart: string | null;
  trustModel: string[];
  fields: AdminMetricFieldSchema[];
  missingEvents: AdminMetricFieldSchema[];
} {
  return {
    ok: true,
    schemaVersion: ADMIN_METRICS_SCHEMA_VERSION,
    publishedAt: ADMIN_METRICS_SCHEMA_PUBLISHED_AT,
    endpoint: ADMIN_METRICS_PATH,
    schemaPath: ADMIN_METRICS_SCHEMA_PATH,
    bucketTimezone: "UTC",
    trustStart: metricsTrustStart(),
    trustModel: [
      "Durable product-state metrics are authoritative for current state.",
      "Auth users are identity records. Visitor metrics use the browser-local visitor id after server-side hashing.",
      "Daily buckets are UTC day buckets derived from current records unless a field explicitly says it is event-backed.",
      "In-process log counters are operational smoke signals only.",
    ],
    fields: [
      {
        path: "auth.users",
        label: "Identity records",
        source: "AuthUserRecord store",
        semantics: "Total stored auth identity records across guest, OpenRouter, and Privy providers.",
        reliability: "legacy",
        caveat: "Legacy guest records can be cookie-bound; v4 visitor metrics are the traffic source.",
      },
      {
        path: "auth.visitors",
        label: "Visitors",
        source: "AuthUserRecord visitorHash, visitorFirstSeenAt, visitorLastSeenAt",
        semantics: "Privacy-preserving browser visitor ids deduped after server-side hashing. Includes total, newLast24h, returningLast24h, and D1 retention.",
        reliability: "authoritative",
        caveat: "Only public-web browsers that can persist localStorage send the visitor id. Does not fingerprint or infer identity from IP/user-agent.",
      },
      {
        path: "auth.newVisitors",
        label: "New visitors in 24h",
        source: "AuthUserRecord visitorFirstSeenAt",
        semantics: "Alias for auth.visitors.newLast24h.",
        reliability: "authoritative",
      },
      {
        path: "auth.returningVisitors",
        label: "Returning visitors in 24h",
        source: "AuthUserRecord visitorLastSeenAt",
        semantics: "Alias for auth.visitors.returningLast24h.",
        reliability: "authoritative",
        caveat: "Requires a later auth touch from the same local visitor id.",
      },
      {
        path: "auth.providers",
        label: "Provider mix",
        source: "AuthUserRecord.provider",
        semantics: "Counts identity records by guest, OpenRouter, and Privy.",
        reliability: "authoritative",
        caveat: "Authoritative for records, not people.",
      },
      {
        path: "auth.createdLast24h",
        label: "New identity records in 24h",
        source: "AuthUserRecord.createdAt",
        semantics: "Identity records created in the last rolling 24 hours.",
        reliability: "legacy",
        caveat: "Guest records can represent returning people if their cookie was missing.",
      },
      {
        path: "auth.signedInLast24h",
        label: "Seen identity records in 24h",
        source: "AuthUserRecord.lastLoginAt",
        semantics: "Identity records with lastLoginAt in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "The timestamp is mutable and throttled for returning guest cookies.",
      },
      {
        path: "auth.activeSessions",
        label: "Unexpired cookie sessions",
        source: "AuthSessionRecord store",
        semantics: "Cookie sessions not expired by the 30-day TTL.",
        reliability: "proxy",
        caveat: "Not a real-time active-user count.",
      },
      {
        path: "auth.d1Retention",
        label: "Identity D1 retention",
        source: "AuthUserRecord.createdAt and lastLoginAt",
        semantics: "Identity records older than 24h whose lastLoginAt is at least 24h after creation.",
        reliability: "legacy",
        caveat: "Guest-heavy populations make this a weak people-retention metric.",
      },
      {
        path: "auth.daily",
        label: "Auth daily buckets",
        source: "AuthUserRecord and AuthSessionRecord timestamps",
        semantics: "14 UTC day buckets for new identity records, last-seen identity records, and cookie session starts.",
        reliability: "proxy",
        caveat: "Last-seen buckets are derived from current mutable records, not durable event history.",
      },
      {
        path: "ruby.sessions",
        label: "Saved game sessions",
        source: "QuizState store",
        semantics: "Persisted Ruby High state buckets keyed by Ruby High session id.",
        reliability: "authoritative",
        caveat: "One human can still own multiple saved sessions after cookie loss.",
      },
      {
        path: "ruby.updatedLast24h",
        label: "Saved game sessions updated in 24h",
        source: "QuizState.updatedAt",
        semantics: "Saved game sessions whose current updatedAt is in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "Captures current last update only, not all visits.",
      },
      {
        path: "ruby.characterSessionsUpdatedLast24h",
        label: "Active character sessions in 24h",
        source: "QuizState.updatedAt plus PlayerCharacter presence",
        semantics: "Saved game sessions with a character and an update in the last rolling 24 hours.",
        reliability: "proxy",
        caveat: "Use as a product-state proxy; prefer visitor-backed ruby.events.appOpen and ruby.events.sessionResume for traffic and return-visit claims after schema v4 deployment.",
      },
      {
        path: "ruby.characterD1Retention",
        label: "Character-session D1 retention",
        source: "PlayerCharacter.createdAt and QuizState.updatedAt",
        semantics: "Character sessions older than 24h whose saved game was updated at least 24h after character creation.",
        reliability: "proxy",
        caveat: "Better than guest identity retention, but still uses last update rather than explicit return events.",
      },
      {
        path: "ruby.retention.characterD1",
        label: "Event-backed character D1 retention",
        source: "StoredMetricEventRecord funnel_step plus app_open/session_resume",
        semantics: "Sessions with first_character_created and later durable activity at least 24h after creation.",
        reliability: "authoritative",
        caveat: "Falls back to product-state characterD1Retention until event history exists.",
      },
      {
        path: "ruby.retention.visitorD1",
        label: "Event-backed visitor D1 retention",
        source: "StoredMetricEventRecord visitor_seen/app_open/session_resume visitorHash",
        semantics: "Visitors first seen at least 24h ago who later returned with durable activity at least 24h after first seen.",
        reliability: "authoritative",
        caveat: "Begins only after v4 visitor headers are deployed.",
      },
      {
        path: "ruby.characters",
        label: "Current characters",
        source: "QuizState.character",
        semantics: "Saved game sessions with an active player character.",
        reliability: "authoritative",
      },
      {
        path: "ruby.completedGrades",
        label: "Completed grades",
        source: "PlayerCharacter.yearbook and StudentPoolEntry.yearbook",
        semantics: "Sealed grade entries across current and pooled characters.",
        reliability: "authoritative",
      },
      {
        path: "ruby.graduatedCharacters",
        label: "Graduated characters",
        source: "PlayerCharacter.yearbook length",
        semantics: "Current characters with all Ruby High grades sealed.",
        reliability: "authoritative",
      },
      {
        path: "ruby.questions",
        label: "Question performance",
        source: "QuizState.score",
        semantics: "Aggregate answered-question correct, total, and accuracy.",
        reliability: "authoritative",
        caveat: "No per-day historical answer counts until answer events are persisted.",
      },
      {
        path: "ruby.essayReports",
        label: "Essay reports",
        source: "QuizState.essayReports",
        semantics: "Durable graded essay reports stored on saved game sessions.",
        reliability: "authoritative",
      },
      {
        path: "ruby.daily",
        label: "Play daily buckets",
        source: "QuizState, PlayerCharacter, yearbook entries, and EssayReport timestamps",
        semantics: "14 UTC day buckets for saved-session updates, character creation, grade completion, essays graded, and v4 metric events.",
        reliability: "proxy",
        caveat: "Good for durable milestones; appOpens/sessionResumes are event-backed only after schema v4 deployment.",
      },
      {
        path: "ruby.events.appOpen",
        label: "App opens",
        source: "StoredMetricEventRecord app_open",
        semantics: "Durable viewer boot events with session identity from the Ruby High cookie.",
        reliability: "authoritative",
        caveat: "Begins only after schema v4 deployment; uniqueVisitors dedupes only browsers retaining ruby-high:visitor-id.",
      },
      {
        path: "ruby.events.sessionResume",
        label: "Session resumes",
        source: "StoredMetricEventRecord session_resume",
        semantics: "Durable viewer-visible events after the tab returns from at least five minutes inactive.",
        reliability: "authoritative",
        caveat: "Browser lifecycle quirks can undercount if the tab is killed before sending.",
      },
      {
        path: "ruby.events.funnel",
        label: "Activation funnel",
        source: "StoredMetricEventRecord funnel_step",
        semantics: "First character created, first question answered, first essay submitted, first daily class passed, and first grade completed.",
        reliability: "authoritative",
        caveat: "Dedupe is per Ruby High session id.",
      },
      {
        path: "ruby.funnel.first10m",
        label: "First 10 minute funnel",
        source: "StoredMetricEventRecord app_open plus funnel_step",
        semantics: "Counts first activation milestones reached within ten minutes of a session's first durable app_open.",
        reliability: "authoritative",
        caveat: "Requires app_open to fire before the funnel step.",
      },
      {
        path: "ruby.guestSpotlight",
        label: "Guest spotlight",
        source: "StoredMetricEventRecord guest_spotlight_seen, guest_spotlight_started, guest_pack_override_set",
        semantics: "Weekly guest-teacher spotlight impressions, starts, manual overrides, and start rate.",
        reliability: "authoritative",
      },
      {
        path: "ruby.balance.repeatRate",
        label: "Question repeat rate",
        source: "QuizState.history plus balance_sample",
        semantics: "Observed repeated answers within saved sessions. Simulation samples are reported separately under ruby.balance.",
        reliability: "proxy",
        caveat: "Observed state is current-session history, not a normalized event stream yet.",
      },
      {
        path: "ruby.events.commerce",
        label: "Commerce events",
        source: "StoredMetricEventRecord commerce plus wallet mutation path",
        semantics: "Durable wallet and entitlement mutations with currency deltas and transaction ids.",
        reliability: "authoritative",
        caveat: "Stripe/RevenueCat revenue uses server webhook metadata when present; this is not accounting-grade financial reporting.",
      },
      {
        path: "ruby.events.llm",
        label: "LLM usage",
        source: "StoredMetricEventRecord llm_usage plus LLM client wrappers",
        semantics: "Durable provider/model/status/latency events for server-side text, stream, and image-generation calls.",
        reliability: "authoritative",
        caveat: "Browser-owned direct client calls are visible only when they route through the Ruby High server.",
      },
      {
        path: "ruby.events.errors",
        label: "Durable errors",
        source: "StoredMetricEventRecord error plus structured logger sink",
        semantics: "Durable operational error events grouped by feature.",
        reliability: "authoritative",
        caveat: "Stores clipped messages and feature names, not full stack traces.",
      },
      {
        path: "logs.counters",
        label: "Process log counters",
        source: "In-memory logger map",
        semantics: "Event/error counts since current process start.",
        reliability: "volatile",
        caveat: "Resets on deploy or restart.",
      },
    ],
    missingEvents: [],
  };
}

export async function handleAdminMetricsRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  ctx.json(ctx.res, buildAdminMetricsSnapshot(deps));
  return true;
}

export async function handleAdminMetricsSchemaRoute(ctx: RouteContext): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_SCHEMA_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  ctx.json(ctx.res, buildAdminMetricsSchema());
  return true;
}

export async function handleAdminOverviewRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_OVERVIEW_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requireAdminAuth(ctx)) return true;
  if (!hasConfiguredLlmCredential()) {
    ctx.error(ctx.res, "Admin overview needs an LLM credential.", 503);
    return true;
  }
  const metrics = buildAdminMetricsSnapshot(deps);
  try {
    const overview = await generateAdminOverview(metrics);
    ctx.json(ctx.res, {
      ok: true,
      generatedAt: new Date().toISOString(),
      provider: llmProviderName(),
      overview,
    });
  } catch (err) {
    log.error("admin.overview-failed", err);
    ctx.error(ctx.res, "Admin overview generation failed.", 502);
  }
  return true;
}

async function generateAdminOverview(metrics: AdminMetricsSnapshot): Promise<AdminOverview> {
  const r = await fetchLlmChatCompletions({
    label: "admin-overview",
    title: "Ruby High Admin",
    timeoutMs: 30_000,
    body: {
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: [
            "You are Ruby High's operator analyst.",
            "Read aggregate product metrics and return compact JSON only.",
            "Do not mention secrets, implementation details, or that you are an AI.",
            "Keep it useful for a product owner deciding what to fix next.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            "Return JSON with keys headline, summary, highlights, risks, actions.",
            "highlights, risks, and actions must be short string arrays with 2 to 4 items.",
            "Use these aggregate metrics:",
            JSON.stringify(compactMetricsForOverview(metrics)),
          ].join("\n"),
        },
      ],
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "admin-overview");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim() ?? "";
  return parseAdminOverview(content);
}

function compactMetricsForOverview(metrics: AdminMetricsSnapshot): Record<string, unknown> {
  return {
    schemaVersion: metrics.schemaVersion,
    generatedAt: metrics.generatedAt,
    quality: metrics.quality,
    interpretationRules: [
      "Do not call auth identity records unique users.",
      "Use auth.visitors and visitor-backed ruby.events.appOpen/sessionResume for traffic and return-visit claims after the trustStart date.",
      "Use ruby.retention.characterD1 and ruby.retention.visitorD1 before identity D1 retention.",
    ],
    auth: {
      identityRecords: metrics.auth.users,
      guestIdentityRecords: metrics.auth.providers.guest,
      verifiedIdentityRecords: metrics.auth.providers.openrouter + metrics.auth.providers.privy,
      visitorMetrics: metrics.auth.visitors,
      newVisitorsLast24h: metrics.auth.newVisitors,
      returningVisitorsLast24h: metrics.auth.returningVisitors,
      identityCaveat: "Auth identity records are not deduped people. Use visitor metrics for public-web traffic when localStorage persists.",
      activeSessions: metrics.auth.activeSessions,
      pendingAuth: metrics.auth.pendingAuth,
      newIdentityRecordsLast24h: metrics.auth.createdLast24h,
      seenIdentityRecordsLast24h: metrics.auth.signedInLast24h,
      returningUsers: metrics.auth.returningUsers,
      identityD1Retention: metrics.auth.d1Retention,
      providers: metrics.auth.providers,
      daily: metrics.auth.daily,
    },
    play: {
      store: metrics.ruby.store,
      sessions: metrics.ruby.sessions,
      updatedLast24h: metrics.ruby.updatedLast24h,
      characterSessionsUpdatedLast24h: metrics.ruby.characterSessionsUpdatedLast24h,
      characterD1Retention: metrics.ruby.characterD1Retention,
      retention: metrics.ruby.retention,
      characters: metrics.ruby.characters,
      graduatedCharacters: metrics.ruby.graduatedCharacters,
      activeRounds: metrics.ruby.activeRounds,
      completedGrades: metrics.ruby.completedGrades,
      essayReports: metrics.ruby.essayReports,
      questions: metrics.ruby.questions,
      wallet: metrics.ruby.wallet,
      events: metrics.ruby.events,
      funnel: metrics.ruby.funnel,
      guestSpotlight: metrics.ruby.guestSpotlight,
      balance: metrics.ruby.balance,
      daily: metrics.ruby.daily,
    },
    logs: {
      build: metrics.logs.build,
      counters: metrics.logs.counters.slice(0, 12),
    },
  };
}

function parseAdminOverview(content: string): AdminOverview {
  const parsed = parseJsonObject(content);
  return {
    headline: cleanOverviewText(parsed?.headline, "Ruby High usage overview"),
    summary: cleanOverviewText(parsed?.summary, content || "No overview returned."),
    highlights: cleanOverviewList(parsed?.highlights),
    risks: cleanOverviewList(parsed?.risks),
    actions: cleanOverviewList(parsed?.actions),
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {}
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function cleanOverviewText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 800) : fallback;
}

function cleanOverviewList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean)
    .slice(0, 4);
}

export function renderAdminDashboardHtml(): string {
  const metricsPath = JSON.stringify(ADMIN_METRICS_PATH);
  const schemaPath = JSON.stringify(ADMIN_METRICS_SCHEMA_PATH);
  const overviewPath = JSON.stringify(ADMIN_OVERVIEW_PATH);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ruby High Admin</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1c1721;
      --muted: #665c6d;
      --line: #ded7e5;
      --surface: #fffaf6;
      --panel: #ffffff;
      --accent: #9f2338;
      --accent-2: #0f6f68;
      --warn: #a56a00;
      --bad: #a12b2b;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--surface);
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1;
    }
    h2 {
      font-size: 16px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand img {
      width: 46px;
      height: 46px;
      object-fit: contain;
    }
    .controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
    input[type="password"] {
      width: min(360px, 100%);
      height: 38px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 0 12px;
      border-radius: 6px;
      font: inherit;
    }
    button {
      height: 38px;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: white;
      padding: 0 14px;
      border-radius: 6px;
      font: 700 14px/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    button.secondary {
      background: var(--panel);
      color: var(--accent);
    }
    button:disabled {
      opacity: .6;
      cursor: wait;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
    }
    .status {
      min-height: 28px;
      margin: 16px 0;
      color: var(--muted);
      font-size: 14px;
    }
    .status strong { color: var(--ink); }
    .status.is-error { color: var(--bad); }
    .status.is-warn { color: var(--warn); }
    .section {
      padding: 22px 0 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr);
      gap: 14px;
      margin-top: 16px;
    }
    .overview {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 18px;
      min-height: 170px;
    }
    .overview h2 {
      color: var(--ink);
      font-size: 22px;
      text-transform: none;
    }
    .overview p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .overview-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .overview-list h3 {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .overview-list ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 7px;
    }
    .overview-list li {
      color: var(--ink);
      font-size: 13px;
      line-height: 1.35;
    }
    .quick-stack {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .metric {
      min-height: 92px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .value {
      display: block;
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
      font-weight: 800;
    }
    .sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .value.good { color: var(--accent-2); }
    .tables {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      margin-top: 12px;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .chart {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
      min-height: 250px;
    }
    .chart-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .chart-title {
      font-weight: 800;
      font-size: 15px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend i {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: -1px;
    }
    .chart svg {
      width: 100%;
      height: 180px;
      display: block;
      overflow: visible;
    }
    .axis {
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 14px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      background: #f8f1f4;
    }
    tr:last-child td { border-bottom: 0; }
    td:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.6);
      padding: 18px;
      color: var(--muted);
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      .controls { justify-content: flex-start; width: 100%; }
      input[type="password"] { flex: 1 1 260px; }
      .hero-grid { grid-template-columns: 1fr; }
      .overview-list { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .charts { grid-template-columns: 1fr; }
      .tables { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      main { width: min(100vw - 20px, 1180px); padding-top: 18px; }
      .grid { grid-template-columns: 1fr; }
      button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">
        <img src="${APP_ROUTE_PREFIX}/assets/logo.png" alt="">
        <h1>Ruby High Admin</h1>
      </div>
      <form class="controls" id="admin-form">
        <input id="token" type="password" autocomplete="current-password" placeholder="Admin token">
        <button id="refresh" type="submit">Refresh</button>
        <button class="secondary" id="overview-refresh" type="button">Overview</button>
        <button class="secondary" id="clear-token" type="button">Clear</button>
        <label class="toggle"><input id="auto-refresh" type="checkbox"> Auto</label>
      </form>
    </header>
    <div class="status" id="status">Locked.</div>
    <section class="hero-grid">
      <div class="overview" id="overview">
        <h2>Overview</h2>
        <p id="overview-summary">Waiting for metrics.</p>
        <div class="overview-list" id="overview-list"></div>
      </div>
      <div class="quick-stack" id="quick-stack"></div>
    </section>
    <section class="section">
      <h2>Trends</h2>
      <div class="charts" id="charts"></div>
    </section>
    <section class="section">
      <h2>Auth</h2>
      <div class="grid" id="auth-grid"></div>
    </section>
    <section class="section">
      <h2>Play</h2>
      <div class="grid" id="play-grid"></div>
    </section>
    <section class="section">
      <h2>Creator</h2>
      <div class="grid" id="creator-grid"></div>
    </section>
    <section class="section">
      <h2>Logs</h2>
      <div class="tables" id="tables"></div>
    </section>
  </main>
  <script>
    const metricsPath = ${metricsPath};
    const schemaPath = ${schemaPath};
    const overviewPath = ${overviewPath};
    const tokenKey = "ruby-high-admin-token";
    const tokenEl = document.getElementById("token");
    const formEl = document.getElementById("admin-form");
    const refreshEl = document.getElementById("refresh");
    const overviewRefreshEl = document.getElementById("overview-refresh");
    const clearEl = document.getElementById("clear-token");
    const autoEl = document.getElementById("auto-refresh");
    const statusEl = document.getElementById("status");
    const overviewSummaryEl = document.getElementById("overview-summary");
    const overviewListEl = document.getElementById("overview-list");
    const quickStackEl = document.getElementById("quick-stack");
    const chartsEl = document.getElementById("charts");
    const authGrid = document.getElementById("auth-grid");
    const playGrid = document.getElementById("play-grid");
    const creatorGrid = document.getElementById("creator-grid");
    const tablesEl = document.getElementById("tables");
    let timer = null;
    let latestMetrics = null;

    tokenEl.value = localStorage.getItem(tokenKey) || "";
    if (tokenEl.value) refresh();

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
    });
    clearEl.addEventListener("click", () => {
      localStorage.removeItem(tokenKey);
      tokenEl.value = "";
      latestMetrics = null;
      status("Locked.", "");
      overviewSummaryEl.textContent = "Waiting for metrics.";
      overviewListEl.innerHTML = "";
      quickStackEl.innerHTML = "";
      chartsEl.innerHTML = "";
      authGrid.innerHTML = "";
      playGrid.innerHTML = "";
      creatorGrid.innerHTML = "";
      tablesEl.innerHTML = "";
    });
    overviewRefreshEl.addEventListener("click", () => {
      generateOverview();
    });
    autoEl.addEventListener("change", () => {
      if (timer) clearInterval(timer);
      timer = autoEl.checked ? setInterval(refresh, 60000) : null;
    });

    async function refresh() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      refreshEl.disabled = true;
      status("Refreshing...", "");
      try {
        const response = await fetch(metricsPath, {
          headers: { "Authorization": "Bearer " + token },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Metrics request failed.");
        }
        localStorage.setItem(tokenKey, token);
        latestMetrics = data;
        render(data);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        refreshEl.disabled = false;
      }
    }

    async function generateOverview() {
      const token = tokenEl.value.trim();
      if (!token) {
        status("Locked.", "");
        return;
      }
      overviewRefreshEl.disabled = true;
      overviewSummaryEl.textContent = "Generating overview...";
      try {
        const response = await fetch(overviewPath, {
          headers: { "Authorization": "Bearer " + token },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Overview request failed.");
        }
        renderOverview(data.overview || {}, data.provider);
      } catch (err) {
        overviewSummaryEl.textContent = err && err.message ? err.message : String(err);
      } finally {
        overviewRefreshEl.disabled = false;
      }
    }

    function render(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      const logs = data.logs || {};
      status("Updated " + time(data.generatedAt) + " - build " + (logs.build || "unknown") + " - " + (data.schemaVersion || "legacy schema"), "");
      renderQuick(data);
      renderCharts(data);
      renderOverview(localOverview(data), "local");
      authGrid.innerHTML = [
        metric("Identity records", n(auth.users), n(auth.createdLast24h) + " new records - not unique people"),
        metric("Sessions", n(auth.activeSessions), n(auth.pendingAuth) + " pending auth"),
        metric("Identity D1", pct(auth.d1Retention && auth.d1Retention.rate), n(auth.d1Retention && auth.d1Retention.returnedUsers) + " / " + n(auth.d1Retention && auth.d1Retention.eligibleUsers) + " cookie-bound"),
        metric("Providers", n(auth.providers && auth.providers.guest) + " / " + n(auth.providers && auth.providers.openrouter) + " / " + n(auth.providers && auth.providers.privy), "guest / OpenRouter / Privy"),
      ].join("");
      playGrid.innerHTML = [
        metric("Saved sessions", n(ruby.sessions), n(ruby.updatedLast24h) + " updated in 24h"),
        metric("Character D1", pct(ruby.characterD1Retention && ruby.characterD1Retention.rate), n(ruby.characterD1Retention && ruby.characterD1Retention.returnedSessions) + " / " + n(ruby.characterD1Retention && ruby.characterD1Retention.eligibleSessions)),
        metric("App opens", n(events.appOpen && events.appOpen.total), n(events.sessionResume && events.sessionResume.total) + " resumes"),
        metric("Characters", n(ruby.characters), n(ruby.graduatedCharacters) + " graduated - " + n(ruby.completedGrades) + " grades sealed"),
        metric("Questions", n(ruby.questions && ruby.questions.total), n(ruby.questions && ruby.questions.correct) + " correct - " + pct(ruby.questions && ruby.questions.accuracy) + " accuracy"),
      ].join("");
      creatorGrid.innerHTML = [
        metric("Store", ruby.store || "unknown", ruby.loaded ? "loaded" : "not loaded"),
        metric("Active rounds", n(ruby.activeRounds), n(ruby.essayReports) + " essay reports"),
        metric("LLM calls", n(events.llm && events.llm.calls), n(events.llm && events.llm.errors) + " errors"),
        metric("Durable errors", n(events.errors && events.errors.total), n((logs.counters || []).length) + " process counters"),
        metric("Health", data.ok ? "OK" : "Check", "metrics route"),
      ].join("");
      tablesEl.innerHTML = [
        table("Provider Records", auth.providers || {}),
        table("Durable Events", events.byName || {}),
        logTable(logs.counters || []),
      ].join("");
    }

    function renderQuick(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      quickStackEl.innerHTML = [
        metric("App opens", n(events.appOpen && events.appOpen.total), n(events.sessionResume && events.sessionResume.total) + " resumes"),
        metric("24h play", n(ruby.characterSessionsUpdatedLast24h || ruby.updatedLast24h), n(ruby.sessions) + " saved sessions"),
        metric("Question accuracy", pct(ruby.questions && ruby.questions.accuracy), n(ruby.questions && ruby.questions.total) + " answered"),
      ].join("");
    }

    function renderOverview(overview, provider) {
      const headline = overview.headline || "Ruby High usage overview";
      const summary = overview.summary || "Metrics loaded.";
      overviewSummaryEl.innerHTML = "<strong>" + esc(headline) + "</strong><br>" + esc(summary) + (provider && provider !== "local" ? "<br><span class=\\"sub\\">" + esc(provider) + "</span>" : "");
      overviewListEl.innerHTML = [
        overviewColumn("Highlights", overview.highlights || []),
        overviewColumn("Risks", overview.risks || []),
        overviewColumn("Actions", overview.actions || []),
      ].join("");
    }

    function localOverview(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const events = ruby.events || {};
      const retention = ruby.retention || {};
      const characterD1 = retention.characterD1 || ruby.characterD1Retention || {};
      const visitorD1 = retention.visitorD1 || {};
      const d1 = characterD1.rate != null ? pct(characterD1.rate) : "n/a";
      const activeShare = ruby.sessions ? Math.round((Number(ruby.updatedLast24h || 0) / Number(ruby.sessions || 1)) * 100) : 0;
      return {
        headline: n(auth.visitors && auth.visitors.total) + " visitor ids recorded",
        summary: "The current loop has " + n(ruby.characters) + " characters, " + n(ruby.completedGrades) + " sealed grades, and " + pct(ruby.questions && ruby.questions.accuracy) + " answer accuracy.",
        highlights: [
          n(events.appOpen && events.appOpen.total) + " durable app opens",
          n(events.sessionResume && events.sessionResume.total) + " durable session resumes",
          n(auth.visitors && auth.visitors.returningLast24h) + " returning visitors in 24h",
          n(ruby.updatedLast24h) + " saved sessions updated in 24h",
          n(ruby.essayReports) + " essay reports generated",
        ],
        risks: [
          d1 + " character-session D1 retention",
          (visitorD1.rate == null ? "n/a" : pct(visitorD1.rate)) + " visitor D1 retention",
          n(auth.providers && auth.providers.guest) + " guest identity records are not unique people",
          activeShare + "% of saved sessions were active in 24h",
        ],
        actions: [
          "Use v4 visitor events after the trust-start date",
          "Watch grade completion rate",
        ],
      };
    }

    function overviewColumn(title, rows) {
      const list = rows.length ? rows : ["No signal yet."];
      return "<div><h3>" + esc(title) + "</h3><ul>" + list.map((row) => "<li>" + esc(row) + "</li>").join("") + "</ul></div>";
    }

    function renderCharts(data) {
      const authDaily = (data.auth && data.auth.daily) || [];
      const rubyDaily = (data.ruby && data.ruby.daily) || [];
      chartsEl.innerHTML = [
        chartCard("Auth", authDaily, [
          { key: "newUsers", label: "New records", color: "#9f2338", mode: "bar" },
          { key: "signedInUsers", label: "Seen records", color: "#0f6f68", mode: "line" },
          { key: "newVisitors", label: "New visitors", color: "#2f5f91", mode: "bar" },
          { key: "returningVisitors", label: "Returning", color: "#7a4f2a", mode: "line" },
          { key: "sessionStarts", label: "Starts", color: "#665c6d", mode: "line" },
        ]),
        chartCard("Play", rubyDaily, [
          { key: "appOpens", label: "Opens", color: "#665c6d", mode: "bar" },
          { key: "sessionResumes", label: "Resumes", color: "#0f6f68", mode: "line" },
          { key: "updatedSessions", label: "Updated", color: "#9f2338", mode: "bar" },
          { key: "charactersCreated", label: "Characters", color: "#2f5f91", mode: "line" },
          { key: "gradesCompleted", label: "Grades", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Essay Flow", rubyDaily, [
          { key: "essaysGraded", label: "Essays", color: "#9f2338", mode: "bar" },
          { key: "gradesCompleted", label: "Grades", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Events", rubyDaily, [
          { key: "funnelSteps", label: "Funnel", color: "#9f2338", mode: "bar" },
          { key: "visitorSeen", label: "Visitors", color: "#2f5f91", mode: "line" },
          { key: "commerceEvents", label: "Commerce", color: "#665c6d", mode: "line" },
          { key: "llmCalls", label: "LLM", color: "#2f5f91", mode: "line" },
          { key: "durableErrors", label: "Errors", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Activation", mergeDaily(authDaily, rubyDaily), [
          { key: "returningVisitors", label: "Returning", color: "#0f6f68", mode: "line" },
          { key: "updatedSessions", label: "Updated", color: "#9f2338", mode: "bar" },
        ]),
      ].join("");
    }

    function mergeDaily(a, b) {
      const byDate = new Map();
      for (const row of a || []) byDate.set(row.date, Object.assign({}, row));
      for (const row of b || []) byDate.set(row.date, Object.assign({}, byDate.get(row.date) || { date: row.date }, row));
      return Array.from(byDate.values()).sort((x, y) => String(x.date).localeCompare(String(y.date)));
    }

    function chartCard(title, rows, specs) {
      if (!rows.length) return "<div class=\\"chart\\"><div class=\\"chart-head\\"><div class=\\"chart-title\\">" + esc(title) + "</div></div><div class=\\"empty\\">No trend data.</div></div>";
      const width = 720;
      const height = 180;
      const pad = 22;
      const max = Math.max(1, ...rows.flatMap((row) => specs.map((spec) => Number(row[spec.key] || 0))));
      const step = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0;
      const barSpecs = specs.filter((spec) => spec.mode === "bar");
      const lineSpecs = specs.filter((spec) => spec.mode !== "bar");
      let svg = "<svg viewBox=\\"0 0 " + width + " " + height + "\\" role=\\"img\\">";
      svg += "<line x1=\\"" + pad + "\\" y1=\\"" + (height - pad) + "\\" x2=\\"" + (width - pad) + "\\" y2=\\"" + (height - pad) + "\\" stroke=\\"#ded7e5\\"/>";
      svg += "<line x1=\\"" + pad + "\\" y1=\\"" + pad + "\\" x2=\\"" + pad + "\\" y2=\\"" + (height - pad) + "\\" stroke=\\"#ded7e5\\"/>";
      rows.forEach((row, index) => {
        const x = pad + step * index;
        const groupWidth = Math.max(5, Math.min(18, (width - pad * 2) / Math.max(rows.length, 1) * 0.52));
        barSpecs.forEach((spec, specIndex) => {
          const value = Number(row[spec.key] || 0);
          const barWidth = groupWidth / Math.max(barSpecs.length, 1);
          const h = Math.max(0, (value / max) * (height - pad * 2));
          const bx = x - groupWidth / 2 + specIndex * barWidth;
          const by = height - pad - h;
          svg += "<rect x=\\"" + bx.toFixed(2) + "\\" y=\\"" + by.toFixed(2) + "\\" width=\\"" + Math.max(2, barWidth - 1).toFixed(2) + "\\" height=\\"" + h.toFixed(2) + "\\" fill=\\"" + spec.color + "\\" opacity=\\"0.78\\"><title>" + esc(spec.label + " " + row.date + ": " + value) + "</title></rect>";
        });
      });
      for (const spec of lineSpecs) {
        const points = rows.map((row, index) => {
          const x = pad + step * index;
          const y = height - pad - (Number(row[spec.key] || 0) / max) * (height - pad * 2);
          return x.toFixed(2) + "," + y.toFixed(2);
        }).join(" ");
        svg += "<polyline points=\\"" + points + "\\" fill=\\"none\\" stroke=\\"" + spec.color + "\\" stroke-width=\\"3\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/>";
        rows.forEach((row, index) => {
          const x = pad + step * index;
          const y = height - pad - (Number(row[spec.key] || 0) / max) * (height - pad * 2);
          const value = Number(row[spec.key] || 0);
          svg += "<circle cx=\\"" + x.toFixed(2) + "\\" cy=\\"" + y.toFixed(2) + "\\" r=\\"3.5\\" fill=\\"" + spec.color + "\\"><title>" + esc(spec.label + " " + row.date + ": " + value) + "</title></circle>";
        });
      }
      svg += "<text x=\\"" + (pad + 2) + "\\" y=\\"16\\" fill=\\"#665c6d\\" font-size=\\"11\\">max " + n(max) + "</text>";
      svg += "</svg>";
      const legend = specs.map((spec) => "<span><i style=\\"background:" + esc(spec.color) + "\\"></i>" + esc(spec.label) + "</span>").join("");
      const first = rows[0] && rows[0].date ? shortDate(rows[0].date) : "";
      const last = rows[rows.length - 1] && rows[rows.length - 1].date ? shortDate(rows[rows.length - 1].date) : "";
      return "<div class=\\"chart\\"><div class=\\"chart-head\\"><div class=\\"chart-title\\">" + esc(title) + "</div><div class=\\"legend\\">" + legend + "</div></div>" + svg + "<div class=\\"axis\\"><span>" + esc(first) + "</span><span>" + esc(last) + "</span></div></div>";
    }

    function metric(label, value, sub) {
      return "<div class=\\"metric\\"><div class=\\"label\\">" + esc(label) + "</div><span class=\\"value\\">" + esc(String(value)) + "</span><div class=\\"sub\\">" + esc(String(sub || "")) + "</div></div>";
    }
    function table(title, rows) {
      const entries = Object.entries(rows);
      if (!entries.length) return "<div class=\\"empty\\">" + esc(title) + "</div>";
      return "<table><thead><tr><th>" + esc(title) + "</th><th>Count</th></tr></thead><tbody>" + entries.map(([key, value]) => "<tr><td>" + esc(key) + "</td><td>" + n(value) + "</td></tr>").join("") + "</tbody></table>";
    }
    function logTable(rows) {
      if (!rows.length) return "<div class=\\"empty\\">No log counters.</div>";
      const sorted = rows.slice().sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
      return "<table><thead><tr><th>Log</th><th>Count</th></tr></thead><tbody>" + sorted.map((row) => "<tr><td>" + esc((row.level || "event") + ":" + (row.name || "unknown")) + "<div class=\\"sub\\">" + esc(time(row.lastAt)) + "</div></td><td>" + n(row.count) + "</td></tr>").join("") + "</tbody></table>";
    }
    function n(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : "0";
    }
    function pct(value) {
      if (value === null || value === undefined) return "n/a";
      const number = Number(value);
      return Number.isFinite(number) ? (number * 100).toFixed(1) + "%" : "n/a";
    }
    function time(value) {
      const date = value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown";
    }
    function shortDate(value) {
      const date = value ? new Date(value + "T00:00:00Z") : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    }
    function esc(value) {
      return String(value).replace(/[&<>"']/g, (ch) => {
        if (ch === "&") return "&amp;";
        if (ch === "<") return "&lt;";
        if (ch === ">") return "&gt;";
        if (ch === '"') return "&quot;";
        return "&#39;";
      });
    }
    function status(text, className) {
      statusEl.textContent = text;
      statusEl.className = "status " + (className || "");
    }
  </script>
</body>
</html>`;
}
