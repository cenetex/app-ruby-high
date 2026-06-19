#!/usr/bin/env node
// Local Ruby High harness with AI key login + per-teacher chat.

import { createServer } from "node:http";
import { URL } from "node:url";
import { bodyLimitForPath } from "./http-limits.mjs";
import { serveLandingRequest } from "./landing.mjs";
import { normalizePublicOrigin } from "./public-base.mjs";
import {
  AuthService,
  ChatService,
  FacultyService,
  RubyHighService,
  TelegramService,
  XSocialService,
  createStateStore,
  handleAppRoutes,
} from "../dist/index.js";

// The AI key callback accepts http://localhost:3000 for local dev callbacks.
// Production callback bases should be HTTPS. Default accordingly.
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "localhost";
const STATE_PATH = process.env.RUBY_HIGH_STATE_PATH ?? null;
const PUBLIC_BASE = normalizePublicOrigin(process.env.RUBY_HIGH_PUBLIC_BASE) ?? `http://${HOST}:${PORT}`;
const GRADES = ["9", "10", "11", "12"];
const CLASS_QUESTIONS_PER_DAY = 3;
const GRADUATION_ROOM_TARGETS = { "9": 1, "10": 2, "11": 3, "12": 4 };
const GRADUATION_DAYS = { "9": 1, "10": 1, "11": 2, "12": 3 };
const CORE_GRADUATION_FACULTY = ["ruby", "sally-science", "professor-edward"];

const stateStore = await createStateStore({ jsonPath: STATE_PATH ?? undefined });
console.log(`[ruby-high] state store: ${stateStore.describe()}`);

const facultySvc = await FacultyService.start({});
const authSvc = await AuthService.start({}, stateStore);
const chatSvc = await ChatService.start({});

const fakeRuntime = {
  agentId: "local-ruby",
  character: { name: "Ruby" },
  getService: (type) => {
    if (type === FacultyService.serviceType) return facultySvc;
    if (type === RubyHighService.serviceType) return rubySvc;
    if (type === AuthService.serviceType) return authSvc;
    if (type === ChatService.serviceType) return chatSvc;
    if (type === XSocialService.serviceType) return xSocialSvc;
    if (type === TelegramService.serviceType) return telegramSvc;
    return null;
  },
  getSetting: (k) => process.env[k] ?? null,
};

let xSocialSvc = null;
try {
  xSocialSvc = await XSocialService.start(fakeRuntime);
} catch (err) {
  console.error("XSocialService failed to start:", err.message);
}
let telegramSvc = null;
try {
  telegramSvc = await TelegramService.start(fakeRuntime);
} catch (err) {
  console.error("TelegramService failed to start:", err.message);
}

const rubySvc = await (async () => {
  const svc = new RubyHighService(fakeRuntime, stateStore);
  await svc["hydrate"]();
  svc.setFacultyService(facultySvc);
  return svc;
})();
chatSvc.setRubyHighService(rubySvc);

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      bytes += c.length;
      if (bytes > maxBytes) {
        rejected = true;
        const err = new Error("Request body too large");
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (rejected) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => { if (!rejected) reject(err); });
  });
}

async function readJsonBody(req, maxBytes) {
  const buf = await readRawBody(req, maxBytes);
  return buf ? JSON.parse(buf) : {};
}

function deriveClientIp(req) {
  // Local dev usually surfaces socket.remoteAddress; if you're behind a proxy
  // for testing, x-forwarded-for wins.
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}

function makeRouteContext(req, res, url) {
  const cookieHeader = req.headers.cookie ?? null;
  const apiKeyRaw = req.headers["x-openrouter-key"];
  const apiKeyHeader = Array.isArray(apiKeyRaw) ? (apiKeyRaw[0] ?? null) : (apiKeyRaw ?? null);
  return {
    method: req.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: fakeRuntime,
    res,
    cookieHeader,
    userAgentHeader: req.headers["user-agent"] ?? null,
    visitorHeader: req.headers["x-ruby-high-visitor"] ?? null,
    apiKeyHeader,
    isSecure: false,
    clientIp: deriveClientIp(req),
    contentTypeHeader: req.headers["content-type"] ?? null,
    originHeader: req.headers.origin ?? null,
    authorizationHeader: req.headers.authorization ?? null,
    stripeSignatureHeader: req.headers["stripe-signature"] ?? null,
    ifNoneMatch: req.headers["if-none-match"] ?? null,
    acceptEncoding: req.headers["accept-encoding"] ?? null,
    callbackUrlBuilder: (path) => {
      const base = new URL(PUBLIC_BASE);
      return base.origin + path;
    },
    error(_r, message, status = 500) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: message }));
    },
    json(_r, data, status = 200) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    },
    readRawBody: () => readRawBody(req, bodyLimitForPath(url.pathname)),
    readJsonBody: () => readJsonBody(req, bodyLimitForPath(url.pathname)),
  };
}

function healthPayload() {
  return {
    ok: true,
    app: "ruby-high",
    build: process.env.RUBY_HIGH_BUILD ?? "dev",
    state: stateStore?.describe?.() ?? "starting",
    curriculum: curriculumHealthPayload(),
    t: Date.now(),
  };
}

function curriculumHealthPayload() {
  if (!facultySvc?.faculty || !facultySvc?.bank) return null;
  const byFaculty = {};
  for (const faculty of facultySvc.faculty()) {
    byFaculty[faculty.id] = facultySvc.bank(faculty.id)?.questions.length ?? 0;
  }
  const totalQuestions = Object.values(byFaculty).reduce((sum, count) => sum + count, 0);
  return {
    pack: "ruby-high-original",
    totalQuestions,
    byFaculty,
  };
}

function nextGradeAfter(grade) {
  const index = GRADES.indexOf(grade);
  return index >= 0 && index < GRADES.length - 1 ? GRADES[index + 1] : null;
}

function classDateForOffset(offset) {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function graduationFacultyIdsForState(state, grade) {
  const available = new Set((state.contentPack?.faculty ?? facultySvc.faculty()).map((faculty) => faculty.id));
  const selected = CORE_GRADUATION_FACULTY.filter((facultyId) => available.has(facultyId));
  for (const faculty of state.contentPack?.faculty ?? facultySvc.faculty()) {
    if (!selected.includes(faculty.id)) selected.push(faculty.id);
  }
  return selected.slice(0, Math.min(GRADUATION_ROOM_TARGETS[grade] ?? 1, selected.length || 1));
}

async function completeCurrentGradeForDev(sessionId) {
  const state = rubySvc.getOrCreate(sessionId);
  const ch = state.character;
  const grade = state.currentGrade;
  if (!ch || !grade) {
    const err = new Error("No active character grade to complete.");
    err.statusCode = 400;
    throw err;
  }

  const facultyIds = graduationFacultyIdsForState(state, grade);
  const requiredDays = GRADUATION_DAYS[grade] ?? 1;
  const now = Date.now();
  ch.dailyClasses = ch.dailyClasses ?? {};
  ch.graduationClassrooms = ch.graduationClassrooms ?? {};
  ch.graduationClassrooms[grade] = facultyIds;
  for (const facultyId of facultyIds) {
    for (let day = 0; day < requiredDays; day += 1) {
      const date = classDateForOffset(GRADES.indexOf(grade) * 10 + day);
      ch.dailyClasses[`${grade}:${facultyId}:${date}`] = {
        grade,
        facultyId,
        date,
        status: "complete",
        questionCount: CLASS_QUESTIONS_PER_DAY,
        correctCount: CLASS_QUESTIONS_PER_DAY,
        scoreTotal: CLASS_QUESTIONS_PER_DAY * 100,
        scoreMax: CLASS_QUESTIONS_PER_DAY * 100,
        letterGrade: "A",
        completedAt: now,
        updatedAt: now,
      };
    }
  }
  ch.streak = { grade, count: requiredDays, lastDate: classDateForOffset(GRADES.indexOf(grade) * 10 + requiredDays - 1) };
  ch.essayCompleted = true;
  ch.pendingGraduation = {
    grade,
    readyAt: now,
    summary: { correct: requiredDays, total: requiredDays },
  };

  const completed = rubySvc.completeGraduation(sessionId, { kind: "advantage" });
  await rubySvc.flushSession(sessionId);
  return {
    ok: true,
    completedGrade: grade,
    nextGrade: nextGradeAfter(grade),
    currentGrade: completed.currentGrade,
    graduated: !completed.currentGrade,
    yearbookCount: completed.character?.yearbook?.length ?? completed.graduatedCharacter?.yearbook?.length ?? 0,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(healthPayload()));
    return;
  }

  if (await serveLandingRequest(req, res, url)) {
    return;
  }

  // Convenience dev endpoints (no auth needed) for poking at the bank.
  if (req.method === "GET" && url.pathname === "/dev/pick") {
    try {
      const state = rubySvc.pickAndPose("ruby-high:local-ruby", {
        faculty: url.searchParams.get("faculty") ?? undefined,
        subject: url.searchParams.get("subject") ?? undefined,
        difficulty: url.searchParams.get("difficulty") ?? undefined,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        question: state.current?.prompt,
        faculty: state.faculty,
        subject: state.current?.subject,
        difficulty: state.current?.difficulty,
        asked: state.askedQuestionIds.length,
      }));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/dev/clear") {
    rubySvc.clearBoard("ruby-high:local-ruby");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/dev/reset") {
    rubySvc.resetSession("ruby-high:local-ruby");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/dev/faculty") {
    const roster = facultySvc.faculty().map((f) => ({
      ...f,
      subjects: facultySvc.subjects(f.id),
      questionCount: facultySvc.bank(f.id)?.questions.length ?? 0,
    }));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, roster }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/dev/tick-grade") {
    try {
      const sessionId = authSvc.stateKeyForCookie(req.headers.cookie ?? null);
      const payload = await completeCurrentGradeForDev(sessionId);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.statusCode = err.statusCode ?? 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/dev/contribute-live-room-goal") {
    try {
      const sessionId = authSvc.stateKeyForCookie(req.headers.cookie ?? null);
      const body = await readJsonBody(req, bodyLimitForPath(url.pathname)).catch(() => ({}));
      const requestedFaculty = typeof body?.faculty === "string" ? body.faculty.trim() : "";
      if (requestedFaculty) {
        const state = rubySvc.getOrCreate(sessionId);
        if (state?.character) state.faculty = requestedFaculty;
      }
      const result = rubySvc.contributeLiveRoomGoal(sessionId);
      if (!result) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "No public live-room contribution available for this session." }));
        return;
      }
      await rubySvc.flush();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.statusCode = err.statusCode ?? 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname.startsWith("/api/apps/ruby-high")) {
    const ctx = makeRouteContext(req, res, url);
    try {
      const handled = await handleAppRoutes(ctx);
      if (handled) return;
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }
  }

  if (!res.headersSent) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ruby High dev server listening at ${PUBLIC_BASE}`);
  console.log(`  Open:               ${PUBLIC_BASE}/api/apps/ruby-high/viewer`);
  console.log(`  Sign in:            ${PUBLIC_BASE}/api/apps/ruby-high/auth/start`);
  console.log(`  Auth status:        ${PUBLIC_BASE}/api/apps/ruby-high/auth/me`);
  console.log(`  Pick (current):     ${PUBLIC_BASE}/dev/pick`);
  console.log(`  Pick (Sally hard):  ${PUBLIC_BASE}/dev/pick?faculty=sally-science&difficulty=hard`);
  console.log(`  Faculty roster:     ${PUBLIC_BASE}/dev/faculty`);
  console.log(`  Session API:        ${PUBLIC_BASE}/api/apps/ruby-high/session/ruby-high%3Alocal-ruby`);
  console.log("");
  console.log("AI key callback URL is", new URL(PUBLIC_BASE).origin + "/api/apps/ruby-high/auth/callback");
  console.log("If the AI key callback is rejected, set RUBY_HIGH_PUBLIC_BASE to a URL it allows.");
});

const stop = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
