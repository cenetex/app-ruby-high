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
export const ADMIN_OVERVIEW_PATH = `${APP_ROUTE_PREFIX}/admin/overview`;

interface AdminDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

interface AdminMetricsSnapshot {
  ok: true;
  generatedAt: string;
  auth: AuthAnalyticsSnapshot;
  ruby: RubyHighAnalyticsSnapshot;
  logs: ReturnType<typeof logMetricsSnapshot>;
}

interface AdminOverview {
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  actions: string[];
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
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    auth: deps.auth.analyticsSnapshot(),
    ruby: deps.ruby.analyticsSnapshot(),
    logs: logMetricsSnapshot(),
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
    generatedAt: metrics.generatedAt,
    auth: {
      users: metrics.auth.users,
      activeSessions: metrics.auth.activeSessions,
      pendingAuth: metrics.auth.pendingAuth,
      createdLast24h: metrics.auth.createdLast24h,
      signedInLast24h: metrics.auth.signedInLast24h,
      returningUsers: metrics.auth.returningUsers,
      d1Retention: metrics.auth.d1Retention,
      providers: metrics.auth.providers,
      daily: metrics.auth.daily,
    },
    play: {
      store: metrics.ruby.store,
      sessions: metrics.ruby.sessions,
      updatedLast24h: metrics.ruby.updatedLast24h,
      characters: metrics.ruby.characters,
      graduatedCharacters: metrics.ruby.graduatedCharacters,
      activeRounds: metrics.ruby.activeRounds,
      completedGrades: metrics.ruby.completedGrades,
      essayReports: metrics.ruby.essayReports,
      questions: metrics.ruby.questions,
      wallet: metrics.ruby.wallet,
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
      const logs = data.logs || {};
      status("Updated " + time(data.generatedAt) + " - build " + (logs.build || "unknown"), "");
      renderQuick(data);
      renderCharts(data);
      renderOverview(localOverview(data), "local");
      authGrid.innerHTML = [
        metric("Users", n(auth.users), n(auth.createdLast24h) + " new - " + n(auth.signedInLast24h) + " active in 24h"),
        metric("Sessions", n(auth.activeSessions), n(auth.pendingAuth) + " pending auth"),
        metric("D1 retention", pct(auth.d1Retention && auth.d1Retention.rate), n(auth.d1Retention && auth.d1Retention.returnedUsers) + " / " + n(auth.d1Retention && auth.d1Retention.eligibleUsers)),
        metric("Providers", n(auth.providers && auth.providers.guest) + " / " + n(auth.providers && auth.providers.openrouter) + " / " + n(auth.providers && auth.providers.privy), "guest / OpenRouter / Privy"),
      ].join("");
      playGrid.innerHTML = [
        metric("Saved sessions", n(ruby.sessions), n(ruby.updatedLast24h) + " updated in 24h"),
        metric("Characters", n(ruby.characters), n(ruby.graduatedCharacters) + " graduated - " + n(ruby.completedGrades) + " grades sealed"),
        metric("Questions", n(ruby.questions && ruby.questions.total), n(ruby.questions && ruby.questions.correct) + " correct - " + pct(ruby.questions && ruby.questions.accuracy) + " accuracy"),
        metric("Wallet", n(ruby.wallet && ruby.wallet.meritStars) + " / " + n(ruby.wallet && ruby.wallet.hallPasses), "Merit Stars / Hall Passes"),
      ].join("");
      creatorGrid.innerHTML = [
        metric("Store", ruby.store || "unknown", ruby.loaded ? "loaded" : "not loaded"),
        metric("Active rounds", n(ruby.activeRounds), n(ruby.essayReports) + " essay reports"),
        metric("Log counters", n((logs.counters || []).length), "events and errors"),
        metric("Health", data.ok ? "OK" : "Check", "metrics route"),
      ].join("");
      tablesEl.innerHTML = [
        table("Provider Records", auth.providers || {}),
        logTable(logs.counters || []),
      ].join("");
    }

    function renderQuick(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      quickStackEl.innerHTML = [
        metric("24h users", n(auth.signedInLast24h), n(auth.createdLast24h) + " new"),
        metric("24h sessions", n(ruby.updatedLast24h), n(ruby.sessions) + " total"),
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
      const d1 = auth.d1Retention && auth.d1Retention.rate != null ? pct(auth.d1Retention.rate) : "n/a";
      const activeShare = ruby.sessions ? Math.round((Number(ruby.updatedLast24h || 0) / Number(ruby.sessions || 1)) * 100) : 0;
      return {
        headline: n(auth.signedInLast24h) + " signed-in users in the last 24h",
        summary: "The current loop has " + n(ruby.characters) + " characters, " + n(ruby.completedGrades) + " sealed grades, and " + pct(ruby.questions && ruby.questions.accuracy) + " answer accuracy.",
        highlights: [
          n(ruby.updatedLast24h) + " saved sessions updated in 24h",
          n(ruby.essayReports) + " essay reports generated",
          n(ruby.wallet && ruby.wallet.hallPasses) + " Hall Passes in circulation",
        ],
        risks: [
          d1 + " D1 retention",
          activeShare + "% of saved sessions were active in 24h",
        ],
        actions: [
          "Tune first-return hooks",
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
          { key: "newUsers", label: "New", color: "#9f2338", mode: "bar" },
          { key: "signedInUsers", label: "Signed in", color: "#0f6f68", mode: "line" },
          { key: "sessionStarts", label: "Starts", color: "#665c6d", mode: "line" },
        ]),
        chartCard("Play", rubyDaily, [
          { key: "updatedSessions", label: "Updated", color: "#9f2338", mode: "bar" },
          { key: "charactersCreated", label: "Characters", color: "#0f6f68", mode: "line" },
          { key: "gradesCompleted", label: "Grades", color: "#665c6d", mode: "line" },
        ]),
        chartCard("Essay Flow", rubyDaily, [
          { key: "essaysGraded", label: "Essays", color: "#9f2338", mode: "bar" },
          { key: "gradesCompleted", label: "Grades", color: "#0f6f68", mode: "line" },
        ]),
        chartCard("Activation", mergeDaily(authDaily, rubyDaily), [
          { key: "signedInUsers", label: "Signed in", color: "#0f6f68", mode: "line" },
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
