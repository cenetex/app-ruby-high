import { logMetricsSnapshot } from "../services/logger.js";
import type { AuthService } from "../services/auth-service.js";
import type { RubyHighService } from "../services/ruby-high-service.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export const ADMIN_PATH = `${APP_ROUTE_PREFIX}/admin`;
export const ADMIN_METRICS_PATH = `${APP_ROUTE_PREFIX}/admin/metrics`;

interface AdminDeps {
  auth: AuthService;
  ruby: RubyHighService;
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

export async function handleAdminMetricsRoute(ctx: RouteContext, deps: AdminDeps): Promise<boolean> {
  if (ctx.pathname !== ADMIN_METRICS_PATH) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const token = configuredToken();
  if (!token) {
    ctx.error(ctx.res, "Admin metrics are not configured.", 503);
    return true;
  }
  if (!authorized(ctx, token)) {
    ctx.error(ctx.res, "Unauthorized.", 401);
    return true;
  }
  ctx.json(ctx.res, {
    ok: true,
    generatedAt: new Date().toISOString(),
    auth: deps.auth.analyticsSnapshot(),
    ruby: deps.ruby.analyticsSnapshot(),
    logs: logMetricsSnapshot(),
  });
  return true;
}

export function renderAdminDashboardHtml(): string {
  const metricsPath = JSON.stringify(ADMIN_METRICS_PATH);
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
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
        <button class="secondary" id="clear-token" type="button">Clear</button>
        <label class="toggle"><input id="auto-refresh" type="checkbox"> Auto</label>
      </form>
    </header>
    <div class="status" id="status">Locked.</div>
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
    const tokenKey = "ruby-high-admin-token";
    const tokenEl = document.getElementById("token");
    const formEl = document.getElementById("admin-form");
    const refreshEl = document.getElementById("refresh");
    const clearEl = document.getElementById("clear-token");
    const autoEl = document.getElementById("auto-refresh");
    const statusEl = document.getElementById("status");
    const authGrid = document.getElementById("auth-grid");
    const playGrid = document.getElementById("play-grid");
    const creatorGrid = document.getElementById("creator-grid");
    const tablesEl = document.getElementById("tables");
    let timer = null;

    tokenEl.value = localStorage.getItem(tokenKey) || "";
    if (tokenEl.value) refresh();

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
    });
    clearEl.addEventListener("click", () => {
      localStorage.removeItem(tokenKey);
      tokenEl.value = "";
      status("Locked.", "");
      authGrid.innerHTML = "";
      playGrid.innerHTML = "";
      creatorGrid.innerHTML = "";
      tablesEl.innerHTML = "";
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
        render(data);
      } catch (err) {
        status(err && err.message ? err.message : String(err), "is-error");
      } finally {
        refreshEl.disabled = false;
      }
    }

    function render(data) {
      const auth = data.auth || {};
      const ruby = data.ruby || {};
      const logs = data.logs || {};
      status("Updated " + time(data.generatedAt) + " - build " + (logs.build || "unknown"), "");
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
