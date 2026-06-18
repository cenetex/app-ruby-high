#!/usr/bin/env node
/**
 * Post-deploy smoke check.
 *
 * HTTP checks that together exercise the app's boot, auth, offline play,
 * viewer shell, and AI auth gate:
 *
 *   1. /health → 200 + JSON shape after readiness
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
 *   6. Billing products + guest billing status expose entitlement shape.
 *      Catches: hosted economy payload regressions without requiring live
 *      Stripe/OpenRouter secrets in the smoke environment.
 *
 *   7. Guest session flow: GET session, create character, draw a board,
 *      answer it.
 *      Catches: broken telemetry shape, offline character creation command,
 *      scheduler question posting, and answer resolution.
 *
 *   8. POST /api/apps/ruby-high/chat/character/generate (no auth) → 401
 *      Catches: requireAuth() not gating the LLM endpoints. This is the
 *      single check that most directly catches PR #30's regression
 *      (server returning 401 was the WORKING behavior; 200 or 5xx would
 *      have signalled the gate broke).
 *
 *   9. Guest daily pacing + gate: today's lesson serves direct class cards
 *      (not forced Social cards), then blocks further progress with a signup
 *      gate once the daily class is complete.
 *
 *   10. Public world snapshot + SSE replay expose the multiplayer feed
 *       shape without leaking private school-event identifiers.
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
const READY_TIMEOUT_MS = Number(process.env.SMOKE_READY_TIMEOUT_MS || 90_000);
const READY_POLL_MS = Number(process.env.SMOKE_READY_POLL_MS || 2_000);
const MIN_BUILT_IN_PACK_QUESTIONS = 600;

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

async function readText(r) {
  return r.text().catch(() => "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function entitlementShapeError(entitlements) {
  if (!entitlements || typeof entitlements !== "object") return "missing entitlements object";
  if (typeof entitlements.hallPasses !== "number") return "missing numeric entitlements.hallPasses";
  const hostedAi = entitlements.hosted_ai;
  if (!hostedAi || typeof hostedAi !== "object") return "missing hosted_ai entitlement";
  for (const key of ["configured", "active", "affordable", "canActivate"]) {
    if (typeof hostedAi[key] !== "boolean") return `hosted_ai.${key} is not boolean`;
  }
  for (const key of ["remainingMs", "cost", "durationMs"]) {
    if (typeof hostedAi[key] !== "number") return `hosted_ai.${key} is not numeric`;
  }
  if (hostedAi.expiresAt !== null && typeof hostedAi.expiresAt !== "number") {
    return "hosted_ai.expiresAt is neither null nor numeric";
  }
  const images = entitlements.hosted_images;
  if (!images || typeof images !== "object") return "missing hosted_images entitlement";
  for (const kind of ["portrait", "diploma"]) {
    const image = images[kind];
    if (!image || typeof image !== "object") return `missing hosted_images.${kind}`;
    for (const key of ["configured", "affordable", "canUseHosted"]) {
      if (typeof image[key] !== "boolean") return `hosted_images.${kind}.${key} is not boolean`;
    }
    if (typeof image.cost !== "number") return `hosted_images.${kind}.cost is not numeric`;
  }
  return "";
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

async function waitForAppReady() {
  const name = "readiness";
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempts = 0;
  let last = "";

  while (Date.now() <= deadline) {
    attempts++;
    try {
      const r = await fetchWithTimeout(`${base}/api/apps/ruby-high/auth/me`);
      const text = await readText(r.clone());
      if (r.status === 200) {
        const body = await readJson(r);
        if (body && typeof body.authed === "boolean" && typeof body.session === "boolean" && typeof body.ai === "boolean") {
          return ok(name, `app routes ready after ${attempts} ${attempts === 1 ? "try" : "tries"}`);
        }
        last = `status 200 with unexpected body: ${text.slice(0, 200)}`;
      } else {
        last = `status ${r.status}: ${text.slice(0, 200)}`;
        if (r.status !== 503 || !/Ruby High is starting/i.test(text)) {
          return fail(name, last);
        }
      }
    } catch (e) {
      last = e?.message || String(e);
    }
    await sleep(READY_POLL_MS);
  }

  fail(name, `timed out after ${Math.round(READY_TIMEOUT_MS / 1000)}s; last response: ${last || "none"}`);
}

async function check1Health() {
  const name = "health";
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempts = 0;
  let last = "";

  while (Date.now() <= deadline) {
    attempts++;
    try {
      const r = await fetchWithTimeout(`${base}/health`);
      const text = await readText(r.clone());
      if (r.status === 200) {
        const body = await readJson(r);
        if (!body || body.ok !== true || body.app !== "ruby-high") {
          return fail(name, `unexpected body shape: ${JSON.stringify(body).slice(0, 200)}`);
        }
        if (!body.state) return fail(name, "missing 'state' field");
        const healthQuestionCount = Number(body.curriculum?.totalQuestions || 0);
        if (healthQuestionCount < MIN_BUILT_IN_PACK_QUESTIONS) {
          return fail(
            name,
            `health curriculum expected >=${MIN_BUILT_IN_PACK_QUESTIONS} questions, got ${body.curriculum ? healthQuestionCount : "missing"}`,
          );
        }
        return ok(name, `ready after ${attempts} ${attempts === 1 ? "try" : "tries"}; state=${body.state} build=${body.build}`);
      }
      last = `status ${r.status}: ${text.slice(0, 200)}`;
      if (r.status !== 503 || !/starting/i.test(text)) {
        return fail(name, last);
      }
    } catch (e) {
      last = e?.message || String(e);
    }
    await sleep(READY_POLL_MS);
  }

  fail(name, `timed out after ${Math.round(READY_TIMEOUT_MS / 1000)}s; last response: ${last || "none"}`);
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
    const requiredHelpers = [
      "withViewerTimeoutSignal",
      "createViewerApiClient",
      "createViewerTurnController",
      "parseViewerSseFrames",
      "consumeViewerSseStream",
      "runViewerClient",
    ];
    for (const helper of requiredHelpers) {
      if (!new RegExp(`\\bconst\\s+${helper}\\s+=\\s+(?:async\\s+)?function\\b`).test(scriptMatch[1])) {
        return fail(name, `viewer script does not bind ${helper} for runtime use`);
      }
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
      const hasDeclaration = new RegExp(`\\b(const|let|var)\\s+${local}\\b`).test(careerBody);
      const hasBundledPropertyMapping = new RegExp(`\\b${local}\\s*:`).test(careerBody);
      const hasBareShorthandReference = new RegExp(`\\b${local}\\s*[,}]`).test(careerBody);
      if (hasBareShorthandReference && !hasDeclaration && !hasBundledPropertyMapping) {
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
    const entitlementError = entitlementShapeError(body.entitlements);
    if (entitlementError) return fail(name, entitlementError);
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

async function check6BillingEntitlements() {
  const name = "billing entitlements";
  if (!smokeCookie) return fail(name, "no guest cookie from auth/guest");
  try {
    const productsRes = await fetchWithTimeout(`${base}/api/apps/ruby-high/billing/products`, {
      headers: { Cookie: smokeCookie },
    });
    if (productsRes.status !== 200) return fail(name, `billing/products expected 200, got ${productsRes.status}`);
    const productsBody = await readJson(productsRes);
    if (!productsBody?.ok || !Array.isArray(productsBody.products) || productsBody.products.length < 1) {
      return fail(name, `billing/products missing product list: ${JSON.stringify(productsBody).slice(0, 240)}`);
    }
    if (!productsBody.imageCosts || typeof productsBody.imageCosts.portrait !== "number" || typeof productsBody.imageCosts.diploma !== "number") {
      return fail(name, `billing/products missing image costs: ${JSON.stringify(productsBody).slice(0, 240)}`);
    }
    if (!productsBody.hostedAiAccess || typeof productsBody.hostedAiAccess.configured !== "boolean") {
      return fail(name, `billing/products missing hosted AI status: ${JSON.stringify(productsBody).slice(0, 240)}`);
    }
    const productsEntitlementError = entitlementShapeError(productsBody.entitlements);
    if (productsEntitlementError) return fail(name, `billing/products ${productsEntitlementError}`);

    const statusRes = await fetchWithTimeout(`${base}/api/apps/ruby-high/billing/status`, {
      headers: { Cookie: smokeCookie },
    });
    if (statusRes.status !== 200) return fail(name, `billing/status expected 200, got ${statusRes.status}`);
    const statusBody = await readJson(statusRes);
    if (!statusBody?.ok || typeof statusBody.hallPasses !== "number") {
      return fail(name, `billing/status missing balance: ${JSON.stringify(statusBody).slice(0, 240)}`);
    }
    const statusEntitlementError = entitlementShapeError(statusBody.entitlements);
    if (statusEntitlementError) return fail(name, `billing/status ${statusEntitlementError}`);
    ok(
      name,
      `${productsBody.products.length} products, stripe=${productsBody.configured ? "on" : "off"}, hostedAI=${productsBody.entitlements.hosted_ai.configured ? "on" : "off"}`,
    );
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function check7OfflinePlayFlow() {
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
    const builtInPack = (telemetry.available_packs || []).find((p) => p?.id === "ruby-high-original");
    const builtInQuestionCount = Number(builtInPack?.question_count || 0);
    if (!builtInPack || builtInQuestionCount < MIN_BUILT_IN_PACK_QUESTIONS) {
      return fail(
        name,
        `built-in question bank expected >=${MIN_BUILT_IN_PACK_QUESTIONS}, got ${builtInPack ? builtInQuestionCount : "missing"}; expanded question assets may be missing from the deployed image`,
      );
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

async function check8AuthGate() {
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

async function check9GuestDailyGate() {
  const name = "guest daily pacing gate";
  const guest = await postJson("/api/apps/ruby-high/auth/guest", {}, "");
  if (guest.status !== 200) {
    return fail(name, `fresh guest session expected 200, got ${guest.status}: ${(await readText(guest)).slice(0, 200)}`);
  }
  const gateCookie = firstSetCookie(guest.headers).split(";")[0] || "";
  if (!gateCookie) return fail(name, "fresh guest session did not set cookie");
  const sessionPath = `/api/apps/ruby-high/session/smoke-pacing-${Date.now().toString(36)}`;
  const commandPath = `${sessionPath}/command`;
  try {
    const reset = await postJson(commandPath, { type: "reset" }, gateCookie);
    if (reset.status !== 200) return fail(name, `reset expected 200, got ${reset.status}: ${(await reset.text()).slice(0, 200)}`);

    const create = await postJson(commandPath, {
      type: "create-character",
      name: `Pacing ${Date.now().toString(36)}`,
      playbookId: "heart",
      stats: { head: 2, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "Smoke pacing arc",
      flavorQuote: "pacing smoke",
      personality: "Synthetic pacing smoke-test student.",
    }, gateCookie);
    if (create.status !== 200) return fail(name, `create-character expected 200, got ${create.status}: ${(await create.text()).slice(0, 200)}`);

    const afterCreate = await fetchWithTimeout(`${base}${sessionPath}`, { headers: { Cookie: gateCookie } });
    if (afterCreate.status !== 200) return fail(name, `session GET expected 200, got ${afterCreate.status}`);
    const afterCreateBody = await readJson(afterCreate);
    const dailyFacultyId = afterCreateBody?.telemetry?.daily?.facultyId;
    if (!dailyFacultyId || typeof dailyFacultyId !== "string") {
      return fail(name, `missing telemetry.daily.facultyId: ${JSON.stringify(afterCreateBody).slice(0, 240)}`);
    }

    const seen = [];
    const maxAttemptsBeforeGate = 8;
    let gatedText = "";
    for (let attempt = 0; attempt < maxAttemptsBeforeGate; attempt++) {
      const daily = await postJson(commandPath, { type: "play-bonus" }, gateCookie);
      const dailyText = await readText(daily);
      if (daily.status === 403) {
        gatedText = dailyText;
        break;
      }
      if (daily.status !== 200) {
        return fail(name, `play-bonus expected 200/403, got ${daily.status}: ${dailyText.slice(0, 200)}`);
      }
      const picked = JSON.parse(dailyText);
      if (picked?.noQuestionDue) return fail(name, `no scheduled question due during guest daily pacing: ${JSON.stringify(picked).slice(0, 240)}`);
      const currentQuestion = picked?.session?.telemetry?.current;
      const cardRole = picked?.session?.telemetry?.active_round?.cardRole || "";
      if (!currentQuestion) return fail(name, `pick did not produce a question: ${JSON.stringify(picked).slice(0, 240)}`);
      if (currentQuestion.type === "opinion") {
        return fail(name, `forced Social opinion card appeared during guest daily pacing: ${currentQuestion.id}`);
      }
      seen.push(cardRole || currentQuestion.type || "unknown");

      const answer = await postJson(commandPath, { type: "answer", picked: "A" }, gateCookie);
      if (answer.status === 403) {
        gatedText = await readText(answer);
        break;
      }
      if (answer.status !== 200) return fail(name, `answer expected 200/403, got ${answer.status}: ${(await readText(answer)).slice(0, 200)}`);
      const answered = await readJson(answer);
      if (!answered?.session?.telemetry?.active_round?.resolved) {
        return fail(name, `answer did not resolve ${currentQuestion.id}: ${JSON.stringify(answered).slice(0, 240)}`);
      }
    }
    if (!gatedText) {
      return fail(name, `expected signup gate within ${maxAttemptsBeforeGate} completed cards; seen=${seen.join(", ") || "none"}`);
    }
    if (!/sign up to keep your character/i.test(gatedText)) {
      return fail(name, `unexpected gate message: ${gatedText.slice(0, 200)}`);
    }
    ok(name, `direct cards only before gate: ${seen.join(", ")}; signup gate active`);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

function containsPrivateWorldIdentifier(text) {
  return /\bschool:event:|\bteacher:|\bstudent:|\bsession:/i.test(text);
}

async function check10PublicWorldFeed() {
  const name = "public world feed";
  try {
    const snapshotRes = await fetchWithTimeout(`${base}/api/apps/ruby-high/world?limit=5`);
    const snapshotText = await readText(snapshotRes.clone());
    if (snapshotRes.status !== 200) return fail(name, `world snapshot expected 200, got ${snapshotRes.status}: ${snapshotText.slice(0, 200)}`);
    const cacheControl = snapshotRes.headers.get("cache-control") || "";
    if (!/\bno-store\b/i.test(cacheControl)) {
      return fail(name, `world snapshot should be no-store, got cache-control=${cacheControl || "missing"}`);
    }
    if (containsPrivateWorldIdentifier(snapshotText)) {
      return fail(name, `world snapshot leaked an internal identifier: ${snapshotText.slice(0, 240)}`);
    }
    const snapshotBody = await readJson(snapshotRes);
    const snapshot = snapshotBody?.world;
    if (!snapshotBody?.ok || !snapshot || typeof snapshot.generatedAt !== "number" || typeof snapshot.activeStudents !== "number") {
      return fail(name, `world snapshot missing public envelope: ${JSON.stringify(snapshotBody).slice(0, 240)}`);
    }
    if (!Array.isArray(snapshot.activeRooms) || !snapshot.cohorts || typeof snapshot.cohorts !== "object" || Array.isArray(snapshot.cohorts)) {
      return fail(name, `world snapshot missing activeRooms or grade-keyed cohorts: ${JSON.stringify(snapshot).slice(0, 240)}`);
    }
    if (!Array.isArray(snapshot.recentEvents)) {
      return fail(name, `world snapshot missing recentEvents array: ${JSON.stringify(snapshot).slice(0, 240)}`);
    }
    if (!snapshot.curriculum || typeof snapshot.curriculum !== "object" || !Array.isArray(snapshot.curriculum.lowPools)) {
      return fail(name, `world snapshot missing curriculum coverage: ${JSON.stringify(snapshot).slice(0, 240)}`);
    }

    const eventsRes = await fetchWithTimeout(`${base}/api/apps/ruby-high/world/events?limit=3&since=0`);
    const eventsText = await readText(eventsRes);
    if (eventsRes.status !== 200) return fail(name, `world events expected 200, got ${eventsRes.status}: ${eventsText.slice(0, 200)}`);
    const contentType = eventsRes.headers.get("content-type") || "";
    if (!/\btext\/event-stream\b/i.test(contentType)) {
      return fail(name, `world events should be text/event-stream, got ${contentType || "missing"}`);
    }
    const eventsCache = eventsRes.headers.get("cache-control") || "";
    if (!/\bno-store\b/i.test(eventsCache)) {
      return fail(name, `world events should be no-store, got cache-control=${eventsCache || "missing"}`);
    }
    if (!/event: world-snapshot\n/.test(eventsText) || !/event: end\n/.test(eventsText)) {
      return fail(name, `world events missing snapshot/end SSE frames: ${eventsText.slice(0, 240)}`);
    }
    if (containsPrivateWorldIdentifier(eventsText)) {
      return fail(name, `world events leaked an internal identifier: ${eventsText.slice(0, 240)}`);
    }
    ok(name, `${snapshot.activeStudents} active students, ${snapshot.activeRooms.length} rooms, SSE replay framed`);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

console.log(`smoke target: ${base}\n`);

await check1Health();
await waitForAppReady();
if (failed > 0) {
  console.log();
  console.error(`✗ ${failed} smoke check${failed === 1 ? "" : "s"} failed`);
  process.exit(1);
}
await check2ViewerRenders();
await check3AuthStart();
await check4AuthMe();
await check5GuestSession();
await check6BillingEntitlements();
await check7OfflinePlayFlow();
await check8AuthGate();
await check9GuestDailyGate();
await check10PublicWorldFeed();

console.log();
if (failed > 0) {
  console.error(`✗ ${failed} smoke check${failed === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("✓ all smoke checks passed");
