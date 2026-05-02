import type { IAgentRuntime } from "@elizaos/core";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { GRADE_LABELS, type Grade } from "./types.js";
import { STUDENTS, type StudentCharacter } from "./characters/students.js";
import { teacherById } from "./characters/teachers.js";

const STUDENT_MODEL = process.env.RUBY_HIGH_STUDENT_MODEL ?? "anthropic/claude-haiku-4.5";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REFERER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
const TITLE = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

function gradeLabel(grade: string | undefined | null): string {
  if (!grade) return "";
  return (GRADE_LABELS as Record<string, string>)[grade] ?? grade;
}

function pickNextLoungeSpeaker(chat: ChatService, sessionToken: string): string {
  const TEACHERS = ["ruby", "sally-science", "professor-edward"];
  const history = chat.history({ sessionToken, faculty: "lounge" });
  // Find the last assistant message and pick the next teacher in rotation.
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === "assistant" && m.faculty) {
      const idx = TEACHERS.indexOf(m.faculty);
      return TEACHERS[(idx + 1) % TEACHERS.length] ?? "ruby";
    }
  }
  return "ruby";
}

/** Build the per-NPC social context bundle handed to opinion calls. The
 *  student sees who's teaching them, who they're sitting next to, what
 *  grade they're in, and the player's first name. */
function buildOpinionContext(args: {
  student: StudentCharacter;
  npcStats: { head: number; heart: number; hustle: number; honor: number };
  teacherId: string | null;
  classmates: StudentCharacter[];
  playerName: string;
  grade: string | null;
  question: string;
  rubric?: string;
}): string {
  const t = args.teacherId ? teacherById(args.teacherId) : null;
  const teacherLine = t ? `Class: ${t.displayName} (${args.teacherId === "ruby" ? "homeroom" : args.teacherId === "sally-science" ? "science" : "literature"}).` : "Class: independent study.";
  const classmateLines = args.classmates
    .filter((c) => c.id !== args.student.id)
    .map((c) => `- ${c.name}: ${oneLineVibe(c.id)}`)
    .join("\n");
  const stats = args.npcStats;
  return [
    `You are ${args.student.name}, a ${args.grade ? gradeLabel(args.grade) : "junior"} at Ruby High.`,
    teacherLine,
    `Your stats — HEAD ${stats.head >= 0 ? "+" : ""}${stats.head}, HEART ${stats.heart >= 0 ? "+" : ""}${stats.heart}, HUSTLE ${stats.hustle >= 0 ? "+" : ""}${stats.hustle}, HONOR ${stats.honor >= 0 ? "+" : ""}${stats.honor}. Let your higher stats shape what you notice.`,
    `In the room with you:`,
    classmateLines || "- (empty)",
    `Player at the next desk: ${args.playerName}.`,
    "",
    `Question: ${args.question}`,
    args.rubric ? `Rubric: ${args.rubric}` : "",
    "",
    "Write a 2-3 sentence response in YOUR voice. Make it specific. Have an opinion. Reference a classmate or the teacher by name if it's natural. Lowercase, casual where it fits, but don't perform — actually engage with the question.",
  ].filter(Boolean).join("\n");
}

function oneLineVibe(id: string): string {
  switch (id) {
    case "lyra": return "anxious overachiever, sweats every wrong answer";
    case "sami": return "dry sarcastic, pretends not to care";
    case "ravi": return "loud, drops weirdly specific facts";
    case "indra": return "quiet sniper, drops one perfect line a day";
    case "mika": return "bright supportive jock energy";
    case "noor": return "deadpan one-liner master";
    default: return "classmate";
  }
}

/** Generate one NPC's opinion response (1 OpenRouter call). Returns the text. */
async function generateOpinionResponse(args: {
  apiKey: string;
  student: StudentCharacter;
  npcStats: { head: number; heart: number; hustle: number; honor: number };
  teacherId: string | null;
  classmates: StudentCharacter[];
  playerName: string;
  grade: string | null;
  question: string;
  rubric?: string;
}): Promise<string> {
  const userPrompt = buildOpinionContext({
    student: args.student,
    npcStats: args.npcStats,
    teacherId: args.teacherId,
    classmates: args.classmates,
    playerName: args.playerName,
    grade: args.grade,
    question: args.question,
    rubric: args.rubric,
  });
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": REFERER,
      "X-Title": TITLE,
    },
    body: JSON.stringify({
      model: STUDENT_MODEL,
      messages: [
        { role: "system", content: args.student.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.9,
    }),
  });
  if (!r.ok) throw new Error("OpenRouter " + r.status);
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

/** Have the teacher grade all opinion responses in one call. Returns
 *  parsed { grades, bestResponder, narrativeText }. */
async function gradeOpinionResponses(args: {
  apiKey: string;
  facultyId: string;
  question: string;
  rubric?: string;
  responses: Array<{ responder: string; displayName: string; text: string }>;
  playerName: string;
}): Promise<{
  grades: Array<{ responder: string; score: number; comment: string }>;
  bestResponder: string | null;
  narrativeText: string;
}> {
  const teacher = teacherById(args.facultyId);
  const responseList = args.responses.map((r, i) =>
    `[${i + 1}] ${r.displayName} (responder=${r.responder}):\n${r.text}\n`
  ).join("\n");
  const directive = [
    `You posed: "${args.question}"`,
    args.rubric ? `Rubric: ${args.rubric}` : "",
    "",
    "Below are the student responses (the player + your AI students). Grade each one 0-10. The score should reflect: thoughtfulness, specificity, engagement with the question, and originality. NOT politeness or grammar.",
    "",
    responseList,
    "",
    "Output strictly the following format on its own line for each responder, then a final BEST: line:",
    "GRADE responder=<id> score=<0-10> comment=<one short sentence in your voice>",
    "BEST: <responder id>",
    "",
    "After the grade lines, write 2-3 short sentences in your voice as the teacher delivering the verdict to the class. Reference at least one student by name. Don't be saccharine.",
  ].filter(Boolean).join("\n");

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": REFERER,
      "X-Title": TITLE,
    },
    body: JSON.stringify({
      model: teacher.defaultModel,
      messages: [
        { role: "system", content: teacher.systemPrompt },
        { role: "user", content: directive },
      ],
      max_tokens: 700,
      temperature: 0.6,
    }),
  });
  if (!r.ok) throw new Error("OpenRouter " + r.status);
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  const grades: Array<{ responder: string; score: number; comment: string }> = [];
  let bestResponder: string | null = null;
  const lines = text.split(/\r?\n/);
  const narrativeLines: string[] = [];
  for (const line of lines) {
    const gm = line.match(/^GRADE\s+responder=([\w-]+)\s+score=(\d+(?:\.\d+)?)\s+comment=(.+)$/i);
    if (gm) {
      grades.push({
        responder: gm[1] ?? "",
        score: Math.max(0, Math.min(10, parseFloat(gm[2] ?? "0"))),
        comment: (gm[3] ?? "").trim(),
      });
      continue;
    }
    const bm = line.match(/^BEST:\s*([\w-]+)/i);
    if (bm) {
      bestResponder = bm[1] ?? null;
      continue;
    }
    narrativeLines.push(line);
  }
  return { grades, bestResponder, narrativeText: narrativeLines.join("\n").trim() };
}

async function generateStudentLine(args: {
  apiKey: string;
  student: StudentCharacter;
  situation: string;
  note?: string;
  faculty?: string;
}): Promise<string> {
  const facultyContext = args.faculty
    ? `The current class is taught by ${args.faculty.replace("-", " ")}.`
    : "";
  const noteContext = args.note ? `Context: ${args.note}` : "";
  const userPrompt = [
    `Situation: ${args.situation}.`,
    facultyContext,
    noteContext,
    "Reply in ONE short sentence (max 12 words). Lowercase, casual texting style. No quotes, no hashtags.",
  ].filter(Boolean).join("\n");

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": REFERER,
      "X-Title": TITLE,
    },
    body: JSON.stringify({
      model: STUDENT_MODEL,
      messages: [
        { role: "system", content: args.student.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.95,
    }),
  });
  if (!r.ok) throw new Error("OpenRouter " + r.status);
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  // Strip wrapping quotes if model added them.
  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

export interface ChatRouteContext {
  method: string;
  pathname: string;
  url?: URL;
  runtime: unknown | null;
  res: unknown;
  /** Raw incoming Cookie header. Optional — if the host doesn't expose it, auth degrades to "logged out". */
  cookieHeader?: string | null;
  /** Caller-provided callback URL builder. Lets the dev server use http://localhost while the eliza host uses https://app.example.com . */
  callbackUrlBuilder?: (path: string) => string;
  /** True when the response is being served over HTTPS. Controls `Secure` cookie attribute. */
  isSecure?: boolean;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

const CHAT_PREFIX = "/api/apps/ruby-high/chat";
const AUTH_PREFIX = "/api/apps/ruby-high/auth";

function getRuntime(value: unknown): IAgentRuntime | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { agentId?: unknown; getService?: unknown };
  if (typeof candidate.getService !== "function") return null;
  return candidate as unknown as IAgentRuntime;
}

function getSessionId(runtime: IAgentRuntime | null): string {
  const agentId = (runtime as { agentId?: string } | null)?.agentId;
  return agentId ? `ruby-high:${agentId}` : "ruby-high:anonymous";
}

function getService<T>(runtime: IAgentRuntime | null, type: string): T | null {
  if (!runtime) return null;
  try {
    return (runtime.getService(type) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

function setCookieHeader(res: unknown, value: string): void {
  const r = res as { setHeader: (name: string, value: string | string[]) => void; getHeader?: (name: string) => unknown };
  const existing = r.getHeader?.("Set-Cookie");
  if (Array.isArray(existing)) r.setHeader("Set-Cookie", [...existing, value]);
  else if (typeof existing === "string") r.setHeader("Set-Cookie", [existing, value]);
  else r.setHeader("Set-Cookie", value);
}

function redirect(res: unknown, location: string): void {
  const r = res as { setHeader: (n: string, v: string) => void; statusCode: number; end: (b?: string) => void };
  r.statusCode = 302;
  r.setHeader("Location", location);
  r.end();
}

function defaultCallbackBuilder(ctx: ChatRouteContext): (path: string) => string {
  if (ctx.callbackUrlBuilder) return ctx.callbackUrlBuilder;
  return (path: string) => {
    const base = ctx.url?.origin ?? "http://127.0.0.1:4711";
    return `${base}${path}`;
  };
}

/**
 * Returns true if the route was handled. Otherwise the host should try other handlers.
 */
export async function handleChatRoutes(ctx: ChatRouteContext): Promise<boolean> {
  if (!ctx.pathname.startsWith(CHAT_PREFIX) && !ctx.pathname.startsWith(AUTH_PREFIX)) return false;

  const runtime = getRuntime(ctx.runtime);
  const auth = getService<AuthService>(runtime, AuthService.serviceType);
  const chat = getService<ChatService>(runtime, ChatService.serviceType);
  const ruby = getService<RubyHighService>(runtime, RubyHighService.serviceType);

  if (!auth || !chat || !ruby) {
    ctx.error(ctx.res, "Ruby High auth/chat services unavailable.", 503);
    return true;
  }

  const buildCallback = defaultCallbackBuilder(ctx);
  const secure = ctx.isSecure ?? false;

  // ── auth ──────────────────────────────────────────────────────────────────
  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/start`) {
    const callbackUrl = buildCallback(`${AUTH_PREFIX}/callback`);
    const { redirectUrl } = auth.startPkce(callbackUrl);
    redirect(ctx.res, redirectUrl);
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/callback`) {
    const code = ctx.url?.searchParams.get("code") ?? "";
    const state = ctx.url?.searchParams.get("state") ?? "";
    if (!code || !state) {
      ctx.error(ctx.res, "Missing 'code' or 'state' in callback.", 400);
      return true;
    }
    try {
      const { token } = await auth.completePkce(state, code);
      setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
      const back = ctx.url?.searchParams.get("redirect") ?? "/api/apps/ruby-high/viewer";
      redirect(ctx.res, back);
    } catch (err) {
      ctx.error(ctx.res, `Auth failed: ${err instanceof Error ? err.message : String(err)}`, 400);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/me`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    ctx.json(ctx.res, {
      authed: !!record,
      since: record?.createdAt ?? null,
      label: record?.label ?? null,
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${AUTH_PREFIX}/logout`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    auth.destroy(token);
    setCookieHeader(ctx.res, auth.buildClearCookie({ secure }));
    ctx.json(ctx.res, { ok: true });
    return true;
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  if (ctx.method === "GET" && ctx.pathname === `${CHAT_PREFIX}/history`) {
    const faculty = ctx.url?.searchParams.get("faculty") ?? "ruby";
    const token = auth.parseSessionToken(ctx.cookieHeader);
    if (!token) {
      ctx.json(ctx.res, { authed: false, history: [] });
      return true;
    }
    const messages = chat.history({ sessionToken: token, faculty });
    ctx.json(ctx.res, {
      authed: !!auth.resolve(token),
      history: messages.map((m) => ({ role: m.role, content: m.content, faculty: m.faculty, at: m.at })),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === CHAT_PREFIX) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Not authenticated. Sign in with OpenRouter first.", 401);
      return true;
    }

    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; message?: string; model?: string }
      | null;
    const faculty = body?.faculty ?? ruby.getOrCreate(getSessionId(runtime)).faculty;
    const message = (body?.message ?? "").trim();
    if (!message) {
      ctx.error(ctx.res, "Missing 'message'.", 400);
      return true;
    }

    const res = ctx.res as {
      writeHead: (status: number, headers: Record<string, string | string[]>) => void;
      write: (chunk: string) => boolean | void;
      end: () => void;
      flushHeaders?: () => void;
    };
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const ev of chat.send({
        apiKey: record.apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime),
        faculty,
        userMessage: message,
        model: body?.model,
      })) {
        send(ev.type, ev);
      }
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
    return true;
  }

  // Fire a teacher-driven turn (no user message). The client calls this when
  // a state event happens — the student enters a classroom, answers a question,
  // etc. The server constructs the appropriate system directive and runs the
  // model, streaming the response back.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/event`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; trigger?: string; context?: { grade?: string } }
      | null;
    const faculty = body?.faculty ?? ruby.getOrCreate(getSessionId(runtime)).faculty;
    const trigger = String(body?.trigger ?? "manual");
    const grade = body?.context?.grade;

    const res = ctx.res as {
      writeHead: (status: number, headers: Record<string, string | string[]>) => void;
      write: (chunk: string) => boolean | void;
      end: () => void;
      flushHeaders?: () => void;
    };
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // ── Teachers' Lounge: round-robin three teachers in a shared bucket. ───
    if (faculty === "lounge") {
      const TEACHERS = ["ruby", "sally-science", "professor-edward"];
      const order = trigger === "lounge-enter"
        ? TEACHERS
        : [pickNextLoungeSpeaker(chat, token)];
      const loungeSystem =
        "LOUNGE CONTEXT: You're hanging out in the Ruby High teachers' lounge with the OTHER faculty (Ruby, Sally Science, Professor Edward). This is downtime, not class. There is no blackboard and no tools. Just chat in 1-2 short sentences in your voice — riff on a student you saw, ask a colleague's opinion, share a small observation. Don't lecture. Be human. Address the colleagues by name when natural. The student is lurking and may chime in.";

      // For lounge-enter, append a "kickoff" system note so Ruby starts the convo.
      if (trigger === "lounge-enter") {
        chat.appendSystemNote(
          { sessionToken: token, faculty: "lounge" },
          "EVENT: The student just walked into the teachers' lounge to lurk. Ruby, you go first — open a quick chat thread with Sally and Edward. They'll each chime in after.",
        );
      }
      try {
        for (const speaker of order) {
          send("speaker", { facultyId: speaker });
          for await (const ev of chat.send({
            apiKey: record.apiKey,
            sessionToken: token,
            agentSessionId: getSessionId(runtime),
            faculty: "lounge",
            speakerFacultyId: speaker,
            bucketKey: "lounge",
            disableTools: true,
            extraSystemContext: loungeSystem,
            maxTokens: 220,
          })) {
            send(ev.type, ev);
          }
        }
      } catch (err) {
        send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        res.write("event: end\ndata: {}\n\n");
        res.end();
      }
      return true;
    }

    // ── Classroom: a single teacher takes a turn. ───────────────────────────
    let directive = "";
    if (trigger === "channel-enter") {
      directive = `EVENT: The student just walked into your classroom${grade ? ` for ${gradeLabel(grade)} year` : ""}. Greet them in ONE short sentence, then call pick_from_bank to put the first question on the board. Don't ask them what topic — just pick something fitting their year.`;
    } else if (trigger === "answer-graded") {
      const c = body?.context as { picked?: string; correct?: string; wasCorrect?: boolean } | undefined;
      if (c?.picked && c?.correct) {
        const verdict = c.wasCorrect ? "GOT IT RIGHT" : "MISSED IT";
        directive = `EVENT: The student picked ${c.picked}. The correct answer was ${c.correct}. They ${verdict}. React in ONE short sentence (celebrate or console in your voice), then call pick_from_bank to put the next question on the board. If five correct have been earned for the year, congratulate them on the ✓ instead.`;
      } else {
        directive = "EVENT: The student just answered the previous question. React in ONE short sentence, then call pick_from_bank for the next question.";
      }
    } else if (trigger === "manual") {
      directive = "EVENT: The student is asking you to take a turn. Either follow up on the last exchange or call pick_from_bank to put a fresh question on the board.";
    }

    try {
      send("speaker", { facultyId: faculty });
      for await (const ev of chat.send({
        apiKey: record.apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime),
        faculty,
        systemEventNote: directive,
      })) {
        send(ev.type, ev);
      }
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
    return true;
  }

  // Cheap one-shot LLM call for an AI student to chime in. Returns a single
  // short line (no streaming, no history). Client fires this on triggers like
  // an answer reveal or a teacher message landing.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/student-chime`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { studentId?: string; situation?: string; note?: string; faculty?: string }
      | null;
    const student = STUDENTS[String(body?.studentId ?? "")];
    if (!student) {
      ctx.error(ctx.res, "Unknown studentId.", 400);
      return true;
    }
    const situation = String(body?.situation ?? "ambient classroom moment");
    try {
      const line = await generateStudentLine({
        apiKey: record.apiKey,
        student,
        situation,
        note: body?.note,
        faculty: body?.faculty,
      });
      ctx.json(ctx.res, {
        ok: true,
        student: { id: student.id, name: student.name, color: student.color },
        line,
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // Player submits their written response to an opinion question. If all
  // responses are in (player + both NPCs), this also runs the grading turn
  // and streams the teacher's verdict as SSE.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/opinion-submit`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { text?: string; force?: boolean } | null;
    const text = (body?.text ?? "").trim();
    const force = !!body?.force;
    const sessionId = getSessionId(runtime);
    if (text) {
      ruby.recordOpinion(sessionId, "player", text);
    }

    const res = ctx.res as {
      writeHead: (status: number, headers: Record<string, string | string[]>) => void;
      write: (chunk: string) => boolean | void;
      end: () => void;
      flushHeaders?: () => void;
    };
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Force-grade path: the round timer expired or all NPCs are in but the
    // player never spoke. Fill missing responders with placeholders so the
    // teacher can grade what's there.
    if (force) {
      const state = ruby.getOrCreate(sessionId);
      const round = state.activeRound;
      if (round && round.type === "opinion" && !round.resolved) {
        const present = new Set(round.opinionResponses.map((r) => r.responder));
        if (!present.has("player")) {
          ruby.recordOpinion(sessionId, "player", "(no response — ran out the clock)");
        }
        for (const npc of round.npcs) {
          if (!present.has(npc.studentId)) {
            ruby.recordOpinion(sessionId, npc.studentId, "(no response — couldn't get it down in time)");
          }
        }
      }
    }

    if (!ruby.isOpinionRoundReadyToGrade(sessionId)) {
      send("waiting", { ok: true });
      res.write("event: end\ndata: {}\n\n");
      res.end();
      return true;
    }

    // Everyone's in — run the grading.
    try {
      const state = ruby.getOrCreate(sessionId);
      const round = state.activeRound;
      if (!round || !state.current) throw new Error("No active opinion round.");
      const responses = round.opinionResponses.map((r) => ({
        responder: r.responder,
        displayName: r.responder === "player"
          ? "the Player"
          : (STUDENTS[r.responder]?.name ?? r.responder),
        text: r.text,
      }));
      const facultyId = state.faculty;
      send("speaker", { facultyId });
      const { grades, bestResponder, narrativeText } = await gradeOpinionResponses({
        apiKey: record.apiKey,
        facultyId,
        question: state.current.prompt,
        rubric: state.current.rubric,
        responses,
        playerName: "the player",
      });
      // Stream the narrative as deltas (chunked by sentence so the typewriter
      // effect lands).
      const chunks = narrativeText.match(/[^.!?]+[.!?]+\s*|.+$/g) ?? [narrativeText];
      for (const chunk of chunks) {
        send("delta", { text: chunk });
        await new Promise((r) => setTimeout(r, 80));
      }
      // Finalize.
      ruby.recordGrades(sessionId, grades, bestResponder);
      send("opinion-graded", {
        grades,
        bestResponder,
        responses,
      });
      send("done", { finishReason: "stop" });
      // Append a synthesized assistant message into the teacher's chat
      // history so the grading is visible if the user reloads.
      chat.appendSystemNote(
        { sessionToken: token, faculty: facultyId },
        "GRADING DELIVERED: " + narrativeText,
      );
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/reset`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    if (!token) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { faculty?: string } | null;
    const faculty = body?.faculty ?? "ruby";
    chat.resetHistory({ sessionToken: token, faculty });
    ctx.json(ctx.res, { ok: true });
    return true;
  }

  return false;
}

/**
 * Helper for the answer-was-graded notification. Call this after the user
 * answers via the existing /command path so the active teacher's history
 * gets a system note that they can react to.
 */
export function noteGradedAnswer(args: {
  runtime: IAgentRuntime | null;
  cookieHeader: string | null | undefined;
  faculty: string;
  picked: string;
  correct: string;
  wasCorrect: boolean;
}): void {
  const auth = getService<AuthService>(args.runtime, AuthService.serviceType);
  const chat = getService<ChatService>(args.runtime, ChatService.serviceType);
  if (!auth || !chat) return;
  const token = auth.parseSessionToken(args.cookieHeader);
  if (!token) return;
  const note = args.wasCorrect
    ? `The student picked ${args.picked} — correct. Score updated.`
    : `The student picked ${args.picked}, but the correct answer was ${args.correct}. Score updated.`;
  chat.noteAnswer({ sessionToken: token, faculty: args.faculty }, note);
}
