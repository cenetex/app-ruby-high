#!/usr/bin/env node
/**
 * Post-deploy smoke check.
 *
 * HTTP checks that together exercise the app's boot, auth, offline play,
 * viewer shell, and AI auth gate:
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
 *   4. GET /api/apps/ruby-high/auth/me → 200 + { authed: false, session: false }
 *      Catches: header-plumbing regression (PR #30's silent
 *      apiKeyHeader-missing on server.mjs would have failed this if
 *      we'd asserted the response shape).
 *
 *   5. POST /api/apps/ruby-high/auth/guest → 200 + Set-Cookie
 *      Catches: offline mode cannot establish a persistent character bucket.
 *
 *   6. Guest session flow: GET session, create character, draw a board,
 *      answer it.
 *      Catches: broken telemetry shape, offline character creation command,
 *      scheduler question posting, and answer resolution.
 *
 *   7. POST /api/apps/ruby-high/chat/character/generate (no auth) → 401
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
let smokeCookie = "";

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

function firstSetCookie(headers) {
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    if (values && values.length > 0) return values[0];
  }
  return headers.get("set-cookie") || "";
}

async function readJson(r) {
  return r.json().catch(() => null);
}

async function postJson(path, body, cookie = smokeCookie) {
  return fetchWithTimeout(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function extractFunctionBody(src, name) {
  const sig = src.indexOf(`function ${name}`);
  if (sig < 0) return "";
  const start = src.indexOf("{", sig);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return "";
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
    // (Daily-banner check retired — the banner was removed in the
    //  rarity refactor follow-up. Every question is now a draw, so a
    //  separate daily-bonus surface no longer exists.)
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
    if (!scriptMatch[1].includes("/api/apps/ruby-high/auth/guest")) {
      return fail(name, "viewer script does not contain guest-session boot path");
    }
    const mobileFitSelectors = [
      ".blackboard-panel.is-long-prompt",
      ".answers.is-very-long",
      "@media (max-width: 600px)",
    ];
    const missingMobileFit = mobileFitSelectors.filter((s) => !html.includes(s));
    if (missingMobileFit.length > 0) {
      return fail(name, `viewer missing mobile fit CSS: ${missingMobileFit.join(", ")}`);
    }
    const careerBody = extractFunctionBody(scriptMatch[1], "buildCareerCard");
    if (!careerBody) {
      return fail(name, "viewer script missing buildCareerCard()");
    }
    for (const local of ["streakLastDate", "todayKey"]) {
      if (careerBody.includes(local) && !new RegExp(`\\b(const|let|var)\\s+${local}\\b`).test(careerBody)) {
        return fail(name, `buildCareerCard references ${local} without declaring it`);
      }
    }
    ok(name, `${html.length} bytes, quiz buttons present, inline JS parses, offline boot present`);
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
    if (!body || typeof body.authed !== "boolean" || typeof body.session !== "boolean" || typeof body.ai !== "boolean") {
      return fail(name, `expected { authed/session/ai: boolean }, got ${JSON.stringify(body).slice(0, 200)}`);
    }
    if (body.authed !== false || body.session !== false || body.ai !== false) {
      // Smoke runs without sending an API key, so the server should always
      // see no session and no AI. If this returns true, header plumbing has gone
      // sideways and an arbitrary request is somehow getting credentialed.
      return fail(name, `anonymous request reported credentialed state: ${JSON.stringify(body).slice(0, 200)}`);
    }
    ok(name, "anonymous request reports no session and no AI");
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check5GuestSession() {
  const name = "auth/guest";
  try {
    const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/auth/guest`, { method: "POST" });
    if (r.status !== 200) return fail(name, `expected 200, got ${r.status}`);
    const body = await readJson(r);
    if (!body || body.session !== true || body.ai !== false || body.label !== "Guest") {
      return fail(name, `unexpected guest body: ${JSON.stringify(body).slice(0, 200)}`);
    }
    const setCookie = firstSetCookie(r.headers);
    const cookie = setCookie.split(";")[0];
    if (!/^rh_session=/.test(cookie)) {
      return fail(name, `missing rh_session Set-Cookie: ${setCookie.slice(0, 200)}`);
    }
    smokeCookie = cookie;
    ok(name, "guest session cookie issued");
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check6OfflinePlayFlow() {
  const name = "offline play flow";
  if (!smokeCookie) return fail(name, "no guest cookie from auth/guest");
  const sessionPath = "/api/apps/ruby-high/session/smoke";
  const commandPath = `${sessionPath}/command`;
  try {
    const before = await fetchWithTimeout(`${base}${sessionPath}`, { headers: { Cookie: smokeCookie } });
    if (before.status !== 200) return fail(name, `session GET expected 200, got ${before.status}`);
    const beforeBody = await readJson(before);
    const telemetry = beforeBody?.telemetry;
    if (!telemetry || !Array.isArray(telemetry.faculty_roster) || !Array.isArray(telemetry.playbooks)) {
      return fail(name, `session telemetry missing core arrays: ${JSON.stringify(beforeBody).slice(0, 240)}`);
    }
    if (!telemetry.active_course_progress || !telemetry.current_grade) {
      return fail(name, `session telemetry missing grade/course progress: ${JSON.stringify(telemetry).slice(0, 240)}`);
    }

    const create = await postJson(commandPath, {
      type: "create-character",
      name: `Smoke ${Date.now().toString(36)}`,
      playbookId: "overachiever",
      stats: { head: 2, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "Smoke test arc",
      flavorQuote: "smoke test",
      personality: "Synthetic smoke-test student.",
    });
    if (create.status !== 200) return fail(name, `create-character expected 200, got ${create.status}: ${(await create.text()).slice(0, 200)}`);
    const created = await readJson(create);
    if (!created?.session?.telemetry?.character?.name?.startsWith("Smoke ")) {
      return fail(name, `create-character did not return character telemetry: ${JSON.stringify(created).slice(0, 240)}`);
    }

    const pick = await postJson(commandPath, { type: "pick" });
    if (pick.status !== 200) return fail(name, `pick expected 200, got ${pick.status}: ${(await pick.text()).slice(0, 200)}`);
    const picked = await readJson(pick);
    const current = picked?.session?.telemetry?.current;
    if (!current || !current.id || !current.options?.A || !picked?.session?.telemetry?.active_round) {
      return fail(name, `pick did not produce a live board: ${JSON.stringify(picked).slice(0, 260)}`);
    }

    const answer = await postJson(commandPath, { type: "answer", picked: "A" });
    if (answer.status !== 200) return fail(name, `answer expected 200, got ${answer.status}: ${(await answer.text()).slice(0, 200)}`);
    const answered = await readJson(answer);
    const reveal = answered?.session?.telemetry?.lastReveal;
    if (!reveal || reveal.picked !== "A" || !answered?.session?.telemetry?.active_round?.resolved) {
      return fail(name, `answer did not resolve round: ${JSON.stringify(answered).slice(0, 260)}`);
    }
    ok(name, `created character, drew ${current.id}, answered A`);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check7AuthGate() {
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
await check5GuestSession();
await check6OfflinePlayFlow();
await check7AuthGate();

console.log();
if (failed > 0) {
  console.error(`✗ ${failed} smoke check${failed === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("✓ all smoke checks passed");
