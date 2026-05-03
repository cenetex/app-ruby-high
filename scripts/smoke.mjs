#!/usr/bin/env node
/**
 * Post-deploy smoke check.
 *
 * Five HTTP checks that together would have caught every user-blocking
 * regression we've shipped to date:
 *
 *   1. /health → 200 + JSON shape
 *      Catches: container won't boot (auth-service crash, dynamodb table
 *      missing, AWS creds wrong, etc.).
 *
 *   2. GET /api/apps/ruby-high/viewer → 200 + contains <title>Ruby High
 *      Catches: bundle / templating regression that breaks the SPA shell.
 *
 *   3. GET /api/apps/ruby-high/auth/start → 302, Location = openrouter.ai/auth
 *      Catches: PKCE flow broken (would have caught the earlier
 *      target=_blank-stranded-on-iOS bug if we'd defined "the OAuth
 *      handshake completes" as a smoke target).
 *
 *   4. GET /api/apps/ruby-high/auth/me → 200 + { authed: false }
 *      Catches: header-plumbing regression (PR #30's silent
 *      apiKeyHeader-missing on server.mjs would have failed this if
 *      we'd asserted the response shape).
 *
 *   5. POST /api/apps/ruby-high/chat/character/generate (no auth) → 401
 *      Catches: requireAuth() not gating the LLM endpoints. This is the
 *      single check that most directly catches PR #30's regression
 *      (server returning 401 was the WORKING behavior; 200 or 5xx would
 *      have signalled the gate broke).
 *
 * Usage:
 *   node scripts/smoke.mjs                                # against http://127.0.0.1:8080
 *   node scripts/smoke.mjs https://ruby-high.fly.dev      # against prod
 *   npm run smoke                                          # via package.json
 *   npm run smoke -- https://ruby-high.fly.dev             # with explicit base
 *
 * Exits 0 on all green, non-zero on any failure (with which check
 * failed and what the response was). Wired into the Fly deploy flow
 * so a regression won't ship silently again.
 */

const baseArg = process.argv[2] || process.env.SMOKE_BASE || "http://127.0.0.1:8080";
const base = baseArg.replace(/\/+$/, "");
const TIMEOUT_MS = 20_000;

let failed = 0;

function ok(name, msg) {
  console.log(`✓ ${name}` + (msg ? `  — ${msg}` : ""));
}
function fail(name, msg) {
  failed++;
  console.error(`✗ ${name}` + (msg ? `  — ${msg}` : ""));
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function check1Health() {
  const name = "health";
  try {
    const r = await fetchWithTimeout(`${base}/health`);
    if (r.status !== 200) return fail(name, `expected 200, got ${r.status}`);
    const body = await r.json().catch(() => null);
    if (!body || body.ok !== true || body.app !== "ruby-high") {
      return fail(name, `unexpected body shape: ${JSON.stringify(body).slice(0, 200)}`);
    }
    if (!body.state) return fail(name, "missing 'state' field");
    ok(name, `state=${body.state} build=${body.build}`);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check2ViewerRenders() {
  const name = "viewer";
  try {
    const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/viewer`);
    if (r.status !== 200) return fail(name, `expected 200, got ${r.status}`);
    const html = await r.text();
    if (!/<title>[^<]*Ruby High/i.test(html)) {
      return fail(name, "viewer HTML missing <title>Ruby High</title>");
    }
    // Quiz primary path: A/B/C/D answer buttons must be in the static
    // markup. Catches the #25 class of regression where the quiz
    // interaction surface gets accidentally removed during a refactor.
    const expected = ['data-pick="A"', 'data-pick="B"', 'data-pick="C"', 'data-pick="D"'];
    const missing = expected.filter((p) => !html.includes(p));
    if (missing.length > 0) {
      return fail(name, `quiz buttons missing from rendered HTML: ${missing.join(", ")}`);
    }
    // Daily-challenge banner element must exist in the DOM (hidden by
    // default; revealed by client when daily.available). Catches the
    // case where the banner gets reverted out of the template.
    if (!html.includes('id="daily-banner"')) {
      return fail(name, "daily-challenge banner element missing from rendered HTML");
    }
    // Inline <script> must be parseable JS. The viewer is stitched from
    // a TS template literal that wraps another template literal; an
    // unescaped \n / \t / ` inside a double-quoted string in the source
    // collapses into the rendered output and produces "Unexpected EOF".
    // new Function(src) is a parse-only check — the body never runs.
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      return fail(name, "no inline <script> found in viewer");
    }
    try {
      new Function(scriptMatch[1]);
    } catch (e) {
      return fail(name, `inline <script> failed to parse: ${e?.message || e}`);
    }
    ok(name, `${html.length} bytes, quiz buttons + daily banner present, inline JS parses`);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check3AuthStart() {
  const name = "auth/start";
  try {
    const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/auth/start`);
    if (r.status !== 302) return fail(name, `expected 302 redirect, got ${r.status}`);
    const loc = r.headers.get("location") || "";
    if (!/openrouter\.ai\/auth/.test(loc)) {
      return fail(name, `Location should point to openrouter.ai/auth — got ${loc.slice(0, 200)}`);
    }
    ok(name, "redirects to OpenRouter");
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check4AuthMe() {
  const name = "auth/me";
  try {
    const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/auth/me`);
    if (r.status !== 200) return fail(name, `expected 200, got ${r.status}`);
    const body = await r.json().catch(() => null);
    if (!body || typeof body.authed !== "boolean") {
      return fail(name, `expected { authed: boolean }, got ${JSON.stringify(body).slice(0, 200)}`);
    }
    if (body.authed !== false) {
      // Smoke runs without sending an API key, so the server should always
      // see "not authed." If this returns true, header plumbing has gone
      // sideways and an arbitrary request is somehow getting credentialed.
      return fail(name, `unauthenticated request reported authed=true — auth gate is leaky`);
    }
    ok(name, "anonymous request reports authed=false");
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check5AuthGate() {
  const name = "character/generate auth gate";
  try {
    const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/chat/character/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.status !== 401) {
      const text = await r.text().catch(() => "");
      return fail(name, `unauth POST should return 401, got ${r.status} — body: ${text.slice(0, 200)}`);
    }
    ok(name, "401 (gate is wired)");
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

console.log(`smoke target: ${base}\n`);

await check1Health();
await check2ViewerRenders();
await check3AuthStart();
await check4AuthMe();
await check5AuthGate();

console.log();
if (failed > 0) {
  console.error(`✗ ${failed} smoke check${failed === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("✓ all smoke checks passed");
