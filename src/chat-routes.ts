import type { IAgentRuntime } from "@elizaos/core";
import { AuthService, type AuthRecord } from "./services/auth-service.js";
import { ChatService, type ChatMessage, type ChatStreamEvent, type ToolCall } from "./services/chat-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { TokenBucket } from "./services/rate-limit.js";
import { log } from "./services/logger.js";
import { parseTeacherGrades } from "./grading.js";
import { GRADE_LABELS, type CharacterStats, type Grade, type Question, type QuizState } from "./types.js";
import { resolveFacultyIdForSession, roomForFacultyForSession } from "./content/registry.js";
import { STUDENTS, type StudentCharacter } from "./characters/students.js";
import { teacherById } from "./characters/teachers.js";
import { PLAYBOOKS } from "./characters/playbooks.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const STUDENT_MODEL = process.env.RUBY_HIGH_STUDENT_MODEL ?? "anthropic/claude-haiku-4.5";

/** Throw a debuggable error from an OpenRouter HTTP response. The default
 *  `throw new Error("OpenRouter " + status)` pattern dropped the body, which
 *  hid the real cause (auth issue, model not found, content filter, etc).
 *  This helper preserves the body text up to a sane limit. */
async function throwOpenRouterError(r: Response, label: string): Promise<never> {
  const body = await r.text().catch(() => "");
  const trimmed = body.length > 500 ? body.slice(0, 500) + "…" : body;
  throw new Error(`${label}: OpenRouter ${r.status} ${r.statusText}${trimmed ? ` — ${trimmed}` : ""}`);
}
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REFERER = process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local";
const TITLE = process.env.RUBY_HIGH_OPENROUTER_TITLE ?? "Ruby High";

/** Default ceiling for non-streaming OpenRouter calls. Without this a
 *  hung upstream (network blip, model overloaded but not erroring,
 *  Cloudflare grey-period) holds the Node request slot indefinitely.
 *  60s is comfortably above realistic completion times for the prompts
 *  in this file — student lines (~80 tokens), opinion responses
 *  (~220 tokens), opinion grading (~700 tokens), character JSON
 *  (~480 tokens) all finish in well under 30s on the configured models.
 *  Configurable via RUBY_HIGH_OPENROUTER_TIMEOUT_MS for slower models. */
const OPENROUTER_TIMEOUT_MS = Number(process.env.RUBY_HIGH_OPENROUTER_TIMEOUT_MS ?? 60_000);
async function openRouterFetch(init: RequestInit, timeoutMs: number = OPENROUTER_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(OPENROUTER_URL, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function publicChatHistory(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const pendingTools = new Map<string, { call: ToolCall; faculty?: string }>();
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content, faculty: m.faculty, at: m.at });
      continue;
    }
    if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", content: m.content, faculty: m.faculty, at: m.at });
      if (Array.isArray(m.toolCalls)) {
        for (const call of m.toolCalls) {
          pendingTools.set(call.id, { call, faculty: m.faculty });
        }
      }
      continue;
    }
    if (m.role === "tool" && m.toolCallId) {
      const pending = pendingTools.get(m.toolCallId);
      if (!pending) continue;
      pendingTools.delete(m.toolCallId);
      out.push({
        role: "tool",
        content: "",
        faculty: m.faculty ?? pending.faculty,
        at: m.at,
        tool: pending.call.function.name,
        args: publicToolArgs(pending.call),
        result: safeJsonObject(m.content),
      });
    }
  }
  return out;
}

function publicToolArgs(call: ToolCall): Record<string, unknown> {
  const args = safeJsonObject(call.function.arguments || "{}");
  if (call.function.name === "handoff_faculty" && typeof args.faculty === "string") {
    return { faculty: args.faculty };
  }
  return {};
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function characterGraduated(state: { character?: { yearbook?: unknown[] } | null }): boolean {
  return !!(state.character && Array.isArray(state.character.yearbook) && state.character.yearbook.length >= 4);
}

function graduationReady(state: { character?: { pendingGraduation?: unknown } | null }): boolean {
  return !!(state.character && state.character.pendingGraduation);
}

function gradeLabel(grade: string | undefined | null): string {
  if (!grade) return "";
  return (GRADE_LABELS as Record<string, string>)[grade] ?? grade;
}

function toolPlacedFreshQuestion(ev: ChatStreamEvent): boolean {
  if (ev.type !== "tool" || !ev.result.ok) return false;
  if (ev.tool !== "pick_from_bank" && ev.tool !== "pose_question" && ev.tool !== "pose_opinion") {
    return false;
  }
  return !!(ev.state?.current && ev.state.activeRound && !ev.state.activeRound.resolved);
}

function nextBoardInstruction(bank: { mode?: string; remaining: number; grade?: string }, banked: string): string {
  if (bank.remaining > 0) return banked;
  if (bank.mode === "srs") {
    return "No scheduled deck card is available right now. Do NOT call pick_from_bank or try alternate filters. If the class needs a fresh board, call pose_question exactly once for a custom challenge, or talk briefly about progress.";
  }
  return "No scheduled Ruby High card is available right now. Do NOT call pick_from_bank or try alternate filters. If the class needs a fresh board, call pose_question exactly once and write a custom question.";
}

function schedulerOwnsBoard(bank: { remaining: number; todayClass?: { status?: string } }): boolean {
  // The deterministic scheduler can only own the board when it actually
  // has cards to post. When the bank runs dry — mid-class or in practice
  // — AI takes over via pose_question so the lesson keeps moving instead
  // of dead-ending in a "No scheduled question is due" error from the
  // viewer's auto-pick.
  return bank.remaining > 0;
}

function schedulerBoundaryInstruction(bank: { mode?: string; remaining: number; todayClass?: { status?: string; questionCount?: number; totalQuestions?: number } }): string {
  if (!schedulerOwnsBoard(bank)) {
    return nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh scheduled card, or pose_question for a custom practice challenge.");
  }
  const today = bank.todayClass;
  const classLine = today?.status === "complete"
    ? "today's graded class is complete"
    : today?.status === "active"
      ? `today's graded class is in progress (${today.questionCount ?? 0}/${today.totalQuestions ?? 3})`
      : "today's graded class is available";
  const readyLine = bank.remaining > 0
    ? `${bank.remaining} scheduled card${bank.remaining === 1 ? "" : "s"} ready`
    : "no scheduled cards ready";
  return `The Ruby High scheduler owns the blackboard while ${classLine} and ${readyLine}. Do not call tools or post/replace/clear questions.`;
}

function classReportOwnsBoard(bank: { todayClass?: { status?: string } }): boolean {
  return bank.todayClass?.status === "complete";
}

type AnswerGradedContext = {
  intent?: string | null;
  grade?: string;
  playerLine?: string | null;
  questionId?: string | null;
  prompt?: string | null;
  type?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  options?: Record<string, string> | null;
  picked?: string | null;
  correct?: string | null;
  forfeit?: boolean;
  pickedAnswer?: string | null;
  correctAnswer?: string | null;
  answerText?: string | null;
  expectedAnswer?: string | null;
  answerJudge?: { mode?: string; score?: number } | null;
  explanation?: string | null;
  wasCorrect?: boolean;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function cleanOptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["A", "B", "C", "D"]) {
    const text = cleanText(raw[key]);
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function clipped(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function choiceAnswer(options: Record<string, string> | undefined, choice: string | undefined): string | undefined {
  if (!choice) return undefined;
  const label = choice.trim().toUpperCase();
  const option = options?.[label];
  return option ? `${label}) ${option}` : label;
}

function questionOptionsFrom(stateQuestion: Question | null | undefined, reveal: QuizState["lastReveal"], context: AnswerGradedContext | undefined): Record<string, string> | undefined {
  return cleanOptions(context?.options)
    ?? cleanOptions(stateQuestion?.options)
    ?? cleanOptions(reveal?.questionOptions);
}

function buildResolvedAnswerBriefing(args: {
  state: QuizState;
  context?: AnswerGradedContext;
  playerName: string;
}): {
  correctChoice: string;
  pickedLine: string;
  eventText: string;
  extraSystemContext: string;
} {
  const { state, context: c, playerName } = args;
  const q = state.current;
  const reveal = state.lastReveal;
  const options = questionOptionsFrom(q, reveal, c);
  const questionId = cleanText(c?.questionId) ?? q?.id ?? reveal?.questionId ?? "unknown";
  const prompt = cleanText(c?.prompt) ?? q?.prompt ?? reveal?.questionPrompt;
  const type = cleanText(c?.type) ?? q?.type ?? reveal?.questionType ?? (reveal?.expectedAnswer || c?.expectedAnswer ? "typed-answer" : "multiple-choice");
  const subject = cleanText(c?.subject) ?? q?.subject ?? reveal?.questionSubject;
  const difficulty = cleanText(c?.difficulty) ?? q?.difficulty ?? reveal?.questionDifficulty;
  const picked = cleanText(c?.picked)?.toUpperCase() ?? reveal?.picked;
  const correct = cleanText(c?.correct)?.toUpperCase() ?? reveal?.correct ?? q?.correct ?? "?";
  const forfeit = c?.forfeit === true || reveal?.forfeit === true;
  const wasCorrect = typeof c?.wasCorrect === "boolean"
    ? c.wasCorrect
    : (typeof reveal?.wasCorrect === "boolean" ? reveal.wasCorrect : picked === correct);
  const answerText = cleanText(c?.answerText) ?? reveal?.answerText;
  const expectedAnswer = cleanText(c?.expectedAnswer) ?? reveal?.expectedAnswer ?? q?.expectedAnswer;
  const pickedAnswer = forfeit ? undefined : cleanText(c?.pickedAnswer) ?? answerText ?? choiceAnswer(options, picked);
  const correctAnswer = cleanText(c?.correctAnswer) ?? expectedAnswer ?? choiceAnswer(options, correct);
  const explanation = cleanText(c?.explanation) ?? reveal?.explanation ?? q?.explanation;
  const judgeScore = Number(c?.answerJudge?.score ?? reveal?.answerJudge?.score);
  const judgeMode = cleanText(c?.answerJudge?.mode) ?? reveal?.answerJudge?.mode;
  const resultText = wasCorrect ? "correct" : "wrong";
  const playerDisplay = forfeit ? "no answer before time expired" : pickedAnswer ?? picked ?? "an answer";
  const correctDisplay = correctAnswer ?? correct ?? "?";
  const pickedLine = forfeit
    ? `Time expired before ${playerName} answered; the correct answer was ${correctDisplay}.`
    : wasCorrect
    ? `${playerName} answered ${playerDisplay}; that was correct.`
    : `${playerName} answered ${playerDisplay}; the correct answer was ${correctDisplay}.`;
  const eventParts = [
    prompt ? `Round resolved for "${clipped(prompt, 180)}".` : "Round resolved.",
    forfeit
      ? `${playerName} did not answer before time expired.`
      : `${playerName} answered ${playerDisplay} — ${resultText}.`,
    correctDisplay ? `Correct answer: ${correctDisplay}.` : "",
  ].filter(Boolean);
  const contextLines = [
    "RESOLVED CARD SNAPSHOT for this answer-graded reaction.",
    "Use this snapshot for the reaction even if the active board context is empty, cleared, or already showing a different card.",
    `Question ID: ${questionId}`,
    prompt ? `Question: ${prompt}` : "",
    `Question type: ${type}`,
    subject ? `Subject: ${subject}` : "",
    difficulty ? `Difficulty: ${difficulty}` : "",
  ];
  if (options) {
    contextLines.push("Answer choices:");
    for (const key of ["A", "B", "C", "D"]) {
      if (options[key]) contextLines.push(`  ${key}) ${options[key]}`);
    }
  }
  contextLines.push(forfeit ? "Player answer: no answer (timeout)" : `Player answer: ${playerDisplay}`);
  contextLines.push(`Correct answer: ${correctDisplay}`);
  contextLines.push(`Result: ${forfeit ? "timeout" : resultText}`);
  if (Number.isFinite(judgeScore)) {
    contextLines.push(`Typed-answer judge: ${Math.round(judgeScore * 100)}%${judgeMode ? ` (${judgeMode})` : ""}`);
  }
  if (explanation) contextLines.push(`Explanation shown on board: ${explanation}`);
  return {
    correctChoice: correct,
    pickedLine,
    eventText: eventParts.join(" "),
    extraSystemContext: contextLines.filter(Boolean).join("\n"),
  };
}

function answerGradedContextMatchesReveal(state: QuizState, context: AnswerGradedContext | undefined): boolean {
  const questionId = cleanText(context?.questionId);
  if (!questionId) return true;
  const reveal = state.lastReveal;
  if (!reveal) return true;
  if (reveal.questionId !== questionId) return false;
  const picked = cleanText(context?.picked)?.toUpperCase();
  if (picked && reveal.picked && picked !== reveal.picked) return false;
  const correct = cleanText(context?.correct)?.toUpperCase();
  if (correct && reveal.correct && correct !== reveal.correct) return false;
  const forfeit = context?.forfeit;
  if (typeof forfeit === "boolean" && typeof reveal.forfeit === "boolean" && forfeit !== reveal.forfeit) return false;
  return true;
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
    "Write 2-3 sentences in your voice. Make it specific, have an opinion, engage the question. Reference a classmate or the teacher by name when it fits. Lowercase and casual where it lands.",
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
  const r = await openRouterFetch({
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
  if (!r.ok) await throwOpenRouterError(r, "chat");
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
}): Promise<import("./grading.js").ParsedTeacherGrades> {
  const teacher = teacherById(args.facultyId);
  const responseList = args.responses.map((r, i) =>
    `[${i + 1}] ${r.displayName} (responder=${r.responder}):\n${r.text}\n`
  ).join("\n");
  const directive = [
    `You posed: "${args.question}"`,
    args.rubric ? `Rubric: ${args.rubric}` : "",
    "",
    "Below are the student responses (the player + your AI students). Grade each one 0-10 based on how much they actually thought about the question and showed it in the writing — depth, specificity, engagement, originality.",
    "",
    responseList,
    "",
    "Output strictly the following format on its own line for each responder, then a final BEST: line:",
    "GRADE responder=<id> score=<0-10> comment=<one short sentence in your voice>",
    "BEST: <responder id>",
    "",
    "After the grade lines, write 2-3 short sentences in your voice as the teacher delivering the verdict to the class. Reference at least one student by name. Plain and direct, in your voice.",
  ].filter(Boolean).join("\n");

  const r = await openRouterFetch({
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
  if (!r.ok) await throwOpenRouterError(r, "chat");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  return parseTeacherGrades(text);
}

const PORTRAIT_MODEL = process.env.RUBY_HIGH_PORTRAIT_MODEL ?? "google/gemini-3.1-flash-image-preview";
const PORTRAIT_MAX_TOKENS = Number(process.env.RUBY_HIGH_PORTRAIT_MAX_TOKENS ?? 4000);

/** One-shot portrait gen using the same sticker style as the teachers/students.
 *  Returns a base64 data URL. */
/** Image-gen retry strategy: image models are flaky in three ways
 *  (overload 5xx, slow-stall hang, success-with-empty-image content
 *  filter). One retry catches all three with high probability. We
 *  also bound each attempt to PORTRAIT_TIMEOUT_MS so a stalled
 *  request can't block the response indefinitely.
 *
 *  Rate limiter (PORTRAIT_LIMITER) is on the OUTER endpoint, so the
 *  retry consumes the same budget as the original request — no
 *  amplification. */
const PORTRAIT_TIMEOUT_MS = 60_000;
async function fetchPortraitOnce(args: {
  apiKey: string;
  prompt: string;
}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PORTRAIT_TIMEOUT_MS);
  try {
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "HTTP-Referer": REFERER,
        "X-Title": TITLE,
      },
      body: JSON.stringify({
        model: PORTRAIT_MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: args.prompt }],
        max_tokens: PORTRAIT_MAX_TOKENS,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`OpenRouter ${r.status}: ${(text || r.statusText).slice(0, 240)}`);
    }
    const body = await r.json() as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("OpenRouter returned no image (likely a content-filter trip; try a different name/personality).");
    return url;
  } finally {
    clearTimeout(timer);
  }
}

/** Upload a base64 image dataUrl to S3 and return the public URL.
 *
 *  Why S3: AI-generated portraits are routinely 200KB–1MB as inline
 *  base64. Storing them in the character record blew DynamoDB's 400KB
 *  per-item cap and crashed the persist path (which then crashed the
 *  process — caught and patched in ruby-high-service.persistSession).
 *  Storing the bytes in S3 and the URL in the character record keeps
 *  the record tiny.
 *
 *  Configuration via env:
 *    RUBY_HIGH_PORTRAITS_BUCKET   — bucket name (required to enable)
 *    RUBY_HIGH_PORTRAITS_REGION   — bucket region (default us-east-1)
 *    RUBY_HIGH_PORTRAITS_PUBLIC_BASE — optional CDN/custom-domain prefix
 *      (default: https://<bucket>.s3.<region>.amazonaws.com)
 *
 *  When the bucket isn't configured, returns the input unchanged so
 *  callers degrade gracefully — the server-side size cap in
 *  createCharacter will still reject inline data > 280KB. Default-pack
 *  portraits are simple URL strings, so they always pass.
 */
let portraitS3Client: S3Client | null = null;
function getPortraitS3Client(): S3Client | null {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  if (!bucket) return null;
  if (portraitS3Client) return portraitS3Client;
  portraitS3Client = new S3Client({
    region: process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  });
  return portraitS3Client;
}

async function maybeUploadPortrait(dataUrl: string, kind: "portrait" | "diploma"): Promise<string> {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  const client = getPortraitS3Client();
  if (!bucket || !client) {
    // S3 disabled — return the dataUrl unchanged. The downstream size
    // cap in createCharacter will reject if it's too big, surfacing a
    // clear error to the user instead of a silent corruption.
    return dataUrl;
  }
  // Parse the dataUrl into mime + bytes. The OpenRouter image endpoint
  // returns image/png most of the time but we read the actual mime
  // rather than assume.
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    // Not a dataUrl — could be already a URL (legacy path). Return
    // unchanged.
    return dataUrl;
  }
  const mime = match[1] ?? "image/png";
  const bytes = Buffer.from(match[2] ?? "", "base64");
  // Content-addressed key so identical bytes dedupe and we don't have
  // to track per-character object ownership for cleanup.
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const key = `${kind}/${hash}.${ext}`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } catch (err) {
    log.error("portrait.s3-upload-failed", err, { kind, bucket, key, bytes: bytes.length });
    // Surface to caller — the route will translate to 502 and the
    // client falls back to the default portrait.
    throw new Error("portrait upload failed: " + (err instanceof Error ? err.message : String(err)));
  }
  const base = process.env.RUBY_HIGH_PORTRAITS_PUBLIC_BASE
    ?? `https://${bucket}.s3.${process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "us-east-1"}.amazonaws.com`;
  return base.replace(/\/+$/, "") + "/" + key;
}

async function renderCharacterPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const prompt = [
    `JRPG dialog-portrait of ${args.name}, a high schooler at Ruby High.`,
    `Personality: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Dynamic relaxed pose, expressive face that fits the personality.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("portrait.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    // Single retry. Most flake is transient (model overload / abort);
    // a second swing inside the same request budget catches it.
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

/** Diploma image — generated at Senior graduation. Same image model as
 *  portrait gen ("nano banana 2" / google/gemini-3.1-flash-image-preview),
 *  different prompt: cap-and-gown JRPG sticker featuring a subject-themed
 *  accessory derived from the player's highest-scoring faculty.
 *
 *  Subject accessory map:
 *    sally-science    → microscope or beaker
 *    professor-edward → book or quill
 *    ruby             → diploma scroll (homeroom default)
 */
async function renderDiplomaImage(args: {
  apiKey: string;
  name: string;
  personality: string;
  bestSubjectFacultyId: string;
}): Promise<string> {
  const accessory = (() => {
    switch (args.bestSubjectFacultyId) {
      case "sally-science": return "holding a beaker that glows faintly green";
      case "professor-edward": return "holding a thick hardcover book against their chest";
      case "ruby":
      default: return "holding a rolled diploma scroll tied with a red ribbon";
    }
  })();
  const prompt = [
    `JRPG dialog-portrait of ${args.name} at their Ruby High graduation.`,
    `Personality: ${args.personality}`,
    "",
    `STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. The character is wearing a high-school graduation cap and gown over their normal clothes — gown is a warm crimson red, cap is matching with a yellow tassel. They are smiling, proud but a little nervous. ${accessory}.`,
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale gold background (#f5e8c2). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  // Same retry-once-on-flake strategy as the regular portrait path.
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("diploma.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

/** Determine the player's highest-scoring faculty for the diploma image's
 *  subject accessory. Ties broken by total volume (more answered → wins).
 *  Defaults to "ruby" if no scores yet (shouldn't happen at graduation
 *  since you can't graduate without answering questions, but guarded). */
function highestScoringFaculty(scores: Record<string, { correct: number; total: number }> | undefined): string {
  if (!scores) return "ruby";
  let best: { id: string; ratio: number; total: number } | null = null;
  for (const [id, s] of Object.entries(scores)) {
    if (s.total === 0) continue;
    const ratio = s.correct / s.total;
    if (!best || ratio > best.ratio || (ratio === best.ratio && s.total > best.total)) {
      best = { id, ratio, total: s.total };
    }
  }
  return best ? best.id : "ruby";
}

/** Generate a random valid stat distribution: one each of +2, +1, 0, -1
 *  shuffled across the four stat keys. */
function randomStatDistribution(): CharacterStats {
  const values = [2, 1, 0, -1];
  // Fisher-Yates shuffle in place.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = values[i]!;
    values[i] = values[j]!;
    values[j] = tmp;
  }
  return { head: values[0]!, heart: values[1]!, hustle: values[2]!, honor: values[3]! };
}

/** Default-name nudge: the LLM converges on a small pool of training-bias
 *  picks unless told otherwise. We give it a no-go list rather than steering
 *  toward any particular tradition — the previous "vibe rotation" produced
 *  cultural-tourism mashups (e.g. "Derek Igloolik"). First names only. */
const FORBIDDEN_NAMES_HINT = [
  "Marcus", "Maya", "Mariana", "Emma", "Sarah", "James", "Alex", "Sam", "Jordan", "Liam",
  "Olivia", "Noah", "Ava", "Mia", "Ethan", "Aiden", "Lucas", "Harper", "Sophia",
];

/** Component identifiers the creation card can ask the server to reroll.
 *  Stats and playbook are dice (instant, no LLM); the four text fields go
 *  through a single LLM call with the unchanged fields locked in the
 *  prompt so the model can match register. */
export type CharacterComponent = "name" | "personality" | "arcAnswer" | "flavorQuote" | "stats" | "playbook";
const ALL_COMPONENTS: CharacterComponent[] = ["name", "personality", "arcAnswer", "flavorQuote", "stats", "playbook"];

interface RolledCharacter {
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote: string;
  personality: string;
}

/** Roll a character. Three modes:
 *
 *  - Full roll (regen omitted or includes everything) — current behaviour.
 *  - Dice-only reroll (regen ⊆ {stats, playbook}) — no LLM call. Returns
 *    the reshuffled fields merged with `keep`.
 *  - Text reroll (regen contains any of name / personality / arcAnswer /
 *    flavorQuote) — one LLM call with `keep` fields locked into the
 *    prompt. The model is asked to emit only the requested fields; the
 *    rest are echoed back from `keep` server-side so the contract is
 *    "always returns a full character." */
async function rollRandomCharacter(args: {
  apiKey: string;
  regen?: CharacterComponent[];
  keep?: Partial<RolledCharacter>;
}): Promise<RolledCharacter> {
  const regenSet = new Set<CharacterComponent>(args.regen && args.regen.length > 0 ? args.regen : ALL_COMPONENTS);
  const keep = args.keep ?? {};

  // ── dice rolls (no LLM) ───────────────────────────────────────────────
  let playbook = regenSet.has("playbook")
    ? PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!
    : PLAYBOOKS.find((p) => p.id === keep.playbookId);
  if (!playbook) {
    // keep.playbookId was missing or unknown — fall back to a fresh roll
    // rather than throwing. Same for stats below.
    playbook = PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!;
  }
  const stats: CharacterStats = regenSet.has("stats") || !keep.stats
    ? randomStatDistribution()
    : keep.stats;

  // Text fields needing the LLM. If none, return the dice-only result.
  const textFields: CharacterComponent[] = ["name", "personality", "arcAnswer", "flavorQuote"];
  const textRegen = textFields.filter((f) => regenSet.has(f));
  if (textRegen.length === 0) {
    // Pure dice reroll. All text fields must be present in `keep`.
    const name = String(keep.name ?? "").trim();
    const arcAnswer = String(keep.arcAnswer ?? "").trim();
    const flavorQuote = String(keep.flavorQuote ?? "").trim();
    const personality = String(keep.personality ?? "").trim();
    if (!name || !arcAnswer || !personality) {
      throw new Error("Dice-only reroll requires name, arcAnswer, and personality in `keep`.");
    }
    return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
  }

  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;

  // Locked-fields block: only fields the user is KEEPING (i.e. text
  // fields not in regen) get fed back to the model so it can match
  // register. The fresh-roll path leaves this block empty, which
  // collapses back to the original prompt shape.
  const lockedLines: string[] = [];
  if (!regenSet.has("name") && keep.name) lockedLines.push(`Existing name (do not change): ${keep.name}`);
  if (!regenSet.has("personality") && keep.personality) lockedLines.push(`Existing personality (do not change): ${keep.personality}`);
  if (!regenSet.has("arcAnswer") && keep.arcAnswer) lockedLines.push(`Existing arcAnswer (do not change): ${keep.arcAnswer}`);
  if (!regenSet.has("flavorQuote") && keep.flavorQuote) lockedLines.push(`Existing flavorQuote (do not change): ${keep.flavorQuote}`);

  // Schema string: only the fields being regenerated appear. The LLM
  // returns a partial JSON object; we merge with `keep` server-side.
  const schemaFields = textRegen.map((f) => `"${f}":"..."`).join(",");
  const schemaLine = `{${schemaFields}}`;

  const userPrompt = [
    "Roll a random AI student attending Ruby High (a high school RPG). The player inhabits this character. Aim for a real teenager with small specific concerns — the register of group-chat texts, lunch-line gossip, a half-finished homework excuse.",
    "",
    `Playbook (locked): ${playbook.name} — ${playbook.blurb}`,
    `Hook question (locked): "${playbook.hookQuestion}"`,
    `Stats (locked): HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}`,
    ...lockedLines,
    "",
    `Generate JSON containing ONLY the fields below (no other text, no markdown, no code fences). Output exactly this shape:`,
    schemaLine,
    "",
    "Field guidance:",
    "- name: ONE first name. Anything goes — common, uncommon, a chosen name, a nickname, a strange spelling. The kind of name a teenager actually has. Examples of the spread: Kit, Theo, Saoirse, Mei, Pip, Yusuf, Birta, Lior, Niamh, Tomás, Arlo, Vic, Ren, Esi, Soren. Skip the AI-default picks: " + FORBIDDEN_NAMES_HINT.join(", ") + ".",
    "- arcAnswer: 1-2 sentences answering the hook in voice. Specific, dorky, small. Examples of the register:",
    `    Overachiever / "Why is Cs not enough?": "honestly if i get an A- i replay it for like a week. last quiz i missed one and didn't sleep. my mom thinks im fine."`,
    `    Slacker / "Who do you not want to disappoint?": "my older brother. he was good at this stuff. its embarrassing how much i think about it."`,
    `    Class Clown / "What can't you say without a joke?": "anytime someone cries i panic and do a bit. did one at my uncle's funeral. my mom is still annoyed."`,
    `    Lifer / "What's the best gossip you've picked up?": "the science wing has a closet with 40 trophies from 1987 and nobody knows why. also Mr. Kelner is on his third divorce."`,
    `    Pull from the same register as the playbook above.`,
    `- flavorQuote: ONE short line, 6-18 words. Magic: the Gathering flavor text — captures attitude in a moment, not backstory. Examples of the right shape:`,
    `    "I'd rather you be wrong with reasons than right by accident." (Sally Science)`,
    `    "wait what — i KNEW it was c. ok im rewriting my notes." (Lyra)`,
    `    "i'm just here to drink chocolate milk and lose, and im out of chocolate milk."`,
    `    "if mr. patek calls on me one more time im transferring to the moon."`,
    `  No surrounding quote marks — the renderer adds them.`,
    "- personality: 2-3 sentences. How they SHOW UP in class — fixations, doodles, what they whisper, who they sit by, their thing. Tie one trait to a high stat (HEAD=sharp / HEART=warm / HUSTLE=quick / HONOR=principled) and one to the low stat. Examples of the register:",
    `    "Always has gum, never offers it. Sits by the broken radiator on purpose because the noise helps her think. Doodles snakes through every verbal lesson and forgets her name is being called."`,
    `    "Knows the lyrics to one (1) song and references it constantly. Visibly stressed when the teacher reorders the day. Will eat anyone's leftover fries without asking."`,
    `    Third person. Same scale as those — kid stuff, not life themes.`,
  ].join("\n");

  const r = await openRouterFetch({
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
        { role: "system", content: "You generate compact JSON character sheets for a high school RPG. Output VALID JSON only — no commentary, no code fences, no extra keys." },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 480,
      temperature: 1.1,
    }),
  });
  if (!r.ok) await throwOpenRouterError(r, "chat");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  // Strip code fences if the model added any despite instructions.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: { name?: unknown; arcAnswer?: unknown; flavorQuote?: unknown; personality?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse character JSON: ${(err as Error).message} — body: ${cleaned.slice(0, 200)}`);
  }
  // Merge: the LLM only emits fields named in `regen`. For the others
  // we trust the `keep` payload. The full-roll path has empty `keep`
  // but `regen` covers everything, so the merge collapses to the
  // current-behaviour shape.
  const pick = (field: "name" | "arcAnswer" | "flavorQuote" | "personality"): string => {
    if (regenSet.has(field)) {
      const v = String(parsed[field] ?? "").trim();
      // Strip wrapping quotes the model sometimes adds to flavorQuote.
      return field === "flavorQuote" ? v.replace(/^["“'\s]+|["”'\s]+$/g, "") : v;
    }
    return String(keep[field] ?? "").trim();
  };
  const name = pick("name");
  const arcAnswer = pick("arcAnswer");
  const flavorQuote = pick("flavorQuote");
  const personality = pick("personality");
  if (!name || !arcAnswer || !personality) {
    throw new Error("Generated character missing required fields.");
  }
  return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
}

async function generateStudentLine(args: {
  apiKey: string;
  student: StudentCharacter;
  situation: string;
  note?: string;
  faculty?: string;
  /** Player display name. Lets the NPC address them by name when natural
   *  ("nice one Rayan") instead of saying "the player." */
  playerName?: string;
  /** Other AI students in the room. Used so each NPC chime knows who else
   *  is in the group chat — avoids "wait who's everyone else" hallucinations
   *  and lets NPCs riff on each other by name. */
  classmateNames?: string[];
  /** The teacher's most recent spoken line. Without this NPCs would react
   *  to a faceless event instead of the words on screen — "can't see what
   *  edward said so i got nothing" was a real complaint. */
  teacherSaid?: string;
  /** What the player just typed in chat. Required for the "mention"
   *  situation — without it the model produces a generic acknowledgement
   *  ("yo", "fr") instead of an actual reply. Quoted into the prompt
   *  verbatim so the student can react to the words on screen. */
  playerText?: string;
}): Promise<string> {
  const facultyContext = args.faculty
    ? `The current class is taught by ${args.faculty.replace("-", " ")}.`
    : "";
  const playerContext = args.playerName
    ? `The player in the room with you is ${args.playerName}.`
    : "";
  const classmatesContext = args.classmateNames && args.classmateNames.length
    ? `Other classmates also here: ${args.classmateNames.join(", ")}.`
    : "";
  const teacherSaidContext = args.teacherSaid && args.teacherSaid.trim()
    ? `The teacher just said: "${args.teacherSaid.trim()}"`
    : "";
  // Quote the player's actual message when present. Sanitize the
  // closing quote so a player message containing " can't break out
  // of the surrounding quotation. Also cap length so a megapaste
  // doesn't blow the prompt budget.
  const playerSaidContext = args.playerText
    ? `The player just said to you: "${args.playerText.replace(/"/g, "'").slice(0, 400)}"`
    : "";
  const noteContext = args.note ? `Context: ${args.note}` : "";
  const userPrompt = [
    `Situation: ${args.situation}.`,
    facultyContext,
    playerContext,
    classmatesContext,
    teacherSaidContext,
    playerSaidContext,
    noteContext,
    "React in one short line — like a text in a group chat. Lowercase, 12 words max. Address whoever just acted by name when natural. If you genuinely have nothing, 'lol' or 'idk' or 'fr' is plenty.",
  ].filter(Boolean).join("\n");

  const r = await openRouterFetch({
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
  if (!r.ok) await throwOpenRouterError(r, "chat");
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
  /** Raw value of the `X-Openrouter-Key` header. Clients store the key in
   *  localStorage and attach it on every LLM-touching request; the server
   *  reads it here without persisting. Empty / missing → 401 at LLM endpoints. */
  apiKeyHeader?: string | null;
  /** Caller-provided callback URL builder. Lets the dev server use http://localhost while the eliza host uses https://app.example.com . */
  callbackUrlBuilder?: (path: string) => string;
  /** True when the response is being served over HTTPS. Controls `Secure` cookie attribute. */
  isSecure?: boolean;
  /** Best-known client IP, derived by the host (x-forwarded-for or socket.remoteAddress).
   *  Optional — when absent, rate limiting falls back to a per-cookie key only. */
  clientIp?: string | null;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
}

/** Module-scope rate limiter for LLM-backed chat endpoints. 60 requests in a
 *  burst, refilling at 1/sec — a comfortable budget for an actively-playing
 *  user, tight enough to stop a runaway script from melting OpenRouter spend.
 *
 *  Keyed by `${clientIp}:${sessionToken|"anon"}` so a signed-in user on a
 *  shared NAT and a script-from-the-same-IP get separate buckets. */
const CHAT_LIMITER = new TokenBucket(60, 1);
const PORTRAIT_LIMITER = new TokenBucket(8, 1 / 30); // image gen: 8 burst, ~1 every 30s
const CHAT_EVENT_TURN_SEQ = new Map<string, number>();

/** Drop idle keys hourly so the maps don't grow unbounded for one-off IPs. */
const limiterGcTimer = setInterval(() => {
  const now = Date.now();
  CHAT_LIMITER.gc(now);
  PORTRAIT_LIMITER.gc(now);
}, 60 * 60 * 1000);
if (typeof limiterGcTimer === "object" && limiterGcTimer && "unref" in limiterGcTimer) {
  (limiterGcTimer as { unref: () => void }).unref();
}

function rateLimitKey(ctx: ChatRouteContext, sessionToken: string | null): string {
  const ip = ctx.clientIp || "no-ip";
  return `${ip}:${sessionToken ?? "anon"}`;
}

function chatEventTurnGuard(sessionId: string, faculty: string, rawSeq: unknown): () => boolean {
  const seq = Number(rawSeq);
  if (!Number.isFinite(seq) || seq <= 0) return () => false;
  const key = `${sessionId}:${faculty}`;
  const prev = CHAT_EVENT_TURN_SEQ.get(key) ?? 0;
  if (seq > prev) CHAT_EVENT_TURN_SEQ.set(key, seq);
  return () => (CHAT_EVENT_TURN_SEQ.get(key) ?? seq) !== seq;
}

/** 429 helper. Sets Retry-After before delegating to ctx.error so the host's
 *  error renderer doesn't have to know about rate-limit semantics. */
function reject429(ctx: ChatRouteContext, retryAfterSeconds: number): void {
  const r = ctx.res as { setHeader?: (n: string, v: string) => void };
  if (typeof r.setHeader === "function") {
    r.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
  }
  ctx.error(ctx.res, "Too many requests — slow down a moment.", 429);
}

const CHAT_PREFIX = "/api/apps/ruby-high/chat";
const AUTH_PREFIX = "/api/apps/ruby-high/auth";
const DEFAULT_AUTH_REDIRECT = "/api/apps/ruby-high/viewer";

function getRuntime(value: unknown): IAgentRuntime | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { agentId?: unknown; getService?: unknown };
  if (typeof candidate.getService !== "function") return null;
  return candidate as unknown as IAgentRuntime;
}

/** See routes.ts for the multi-tenant explanation. Per-user state keys come
 *  from the app-owned auth session, not the raw cookie token. */
function getSessionId(runtime: IAgentRuntime | null, cookieHeader?: string | null): string {
  const auth = getService<AuthService>(runtime, AuthService.serviceType);
  return auth?.stateKeyForCookie(cookieHeader) ?? "rh:anonymous";
}

/** Trim + sanity-check the OpenRouter key the client sent in
 *  X-Openrouter-Key. Returns null if the header is absent or obviously
 *  malformed; the caller should respond with 401 in that case. We don't
 *  validate the key format beyond non-empty — OpenRouter is the authority. */
function readApiKey(ctx: ChatRouteContext): string | null {
  const raw = ctx.apiKeyHeader;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Pull the session cookie + API key for an LLM endpoint. The cookie
 *  identifies the QuizState bucket; the header carries the credential.
 *  Returns null on either missing piece — callers respond with 401. */
function requireAuth(
  ctx: ChatRouteContext,
  auth: AuthService,
): { token: string; apiKey: string; record: AuthRecord; stateKey: string } | null {
  const token = auth.parseSessionToken(ctx.cookieHeader);
  const apiKey = readApiKey(ctx);
  const record = auth.resolve(token);
  if (!token || !apiKey || !record) return null;
  return { token, apiKey, record, stateKey: auth.stateKeyForRecord(record) };
}

function canonicalFacultyForRoute(ruby: RubyHighService, sessionId: string, requested?: string | null): string {
  const state = ruby.getOrCreate(sessionId);
  const raw = requested && requested.trim().length > 0 ? requested.trim() : state.faculty;
  if (raw === "lounge") return raw;
  return resolveFacultyIdForSession(state, raw) ?? raw;
}

function activeFacultyMatches(ruby: RubyHighService, sessionId: string, faculty: string): boolean {
  const state = ruby.getOrCreate(sessionId);
  const active = state.faculty === "lounge"
    ? state.faculty
    : (resolveFacultyIdForSession(state, state.faculty) ?? state.faculty);
  return active === faculty;
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

function safeAuthRedirect(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AUTH_REDIRECT;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) {
    return DEFAULT_AUTH_REDIRECT;
  }
  try {
    const parsed = new URL(trimmed, "https://ruby-high.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

/** Render the OAuth-callback HTML shim that lands the API key in the
 *  browser's localStorage and gets the OAuth tab out of the way. The key
 *  is the only piece that actually has to travel back to the client; we
 *  embed it as JSON inside an inline script. localStorage is per-origin
 *  shared, so the original SPA tab notices via the `storage` event and
 *  can flip to authed without polling. */
function writeAuthCallbackHtml(
  res: unknown,
  args: { apiKey: string; label: string | null; redirectTo: string },
): void {
  const payload = JSON.stringify({ apiKey: args.apiKey, label: args.label });
  // The </script> escape is paranoia: if the OpenRouter response ever
  // included that exact substring inside a key it would otherwise terminate
  // our inline script early. The unicode escape keeps JSON.parse happy.
  const safePayload = payload.replace(/<\/script>/gi, "<\\/script>");
  const safeRedirect = JSON.stringify(args.redirectTo);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signed in to Ruby High</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0d1018; color: #f1f1f1; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 24px; max-width: 420px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #b8b8c8; margin: 4px 0 0; }
</style>
</head>
<body>
<main>
  <h1>You're signed in.</h1>
  <p>Heading back to the school…</p>
</main>
<script>
(function () {
  try {
    var data = JSON.parse(${JSON.stringify(safePayload)});
    if (data && data.apiKey) {
      try { localStorage.setItem("rh_openrouter_key", data.apiKey); } catch (e) {}
      try { if (data.label) localStorage.setItem("rh_openrouter_label", data.label); } catch (e) {}
      try { localStorage.setItem("rh_openrouter_at", String(Date.now())); } catch (e) {}
    }
  } catch (e) {}
  // Redirect back to the viewer. Always — no opener-close branch. Safari
  // preserves window.opener across same-origin navigations in some cases,
  // and the previous "if (window.opener) window.close(); return;" hit
  // that path and swallowed the redirect, leaving the player stuck on
  // this stub page after a successful sign-in. localStorage writes above
  // are synchronous so the next line sees the key already persisted.
  try { window.location.replace(${safeRedirect}); } catch (e) {}
})();
</script>
</body>
</html>`;
  const r = res as { setHeader: (n: string, v: string) => void; statusCode: number; end: (b?: string) => void };
  r.statusCode = 200;
  r.setHeader("Content-Type", "text/html; charset=utf-8");
  r.setHeader("Cache-Control", "no-store");
  r.end(html);
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

  if (ctx.method === "POST" && ctx.pathname === `${AUTH_PREFIX}/guest`) {
    const existingToken = auth.parseSessionToken(ctx.cookieHeader);
    const { token, record } = await auth.createGuestSession(existingToken);
    if (token !== existingToken) {
      setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
    }
    ctx.json(ctx.res, {
      ok: true,
      session: true,
      ai: !!readApiKey(ctx),
      since: record.createdAt,
      label: record.label ?? "Guest",
    });
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
      const { token, apiKey, record } = await auth.completePkce(state, code, auth.parseSessionToken(ctx.cookieHeader));
      setCookieHeader(ctx.res, auth.buildSessionCookie(token, { secure }));
      const back = safeAuthRedirect(ctx.url?.searchParams.get("redirect"));
      // Hand the API key back to the browser via a tiny HTML shim. We write
      // it to localStorage (not a cookie, not a URL fragment) so it never
      // leaves the client and survives reloads. localStorage events fan out
      // across same-origin tabs, so the original SPA tab notices and flips
      // to authed without a poll. Redirect targets are sanitized to
      // root-relative same-origin paths before they hit the inline shim.
      writeAuthCallbackHtml(ctx.res, { apiKey, label: record.label ?? null, redirectTo: back });
    } catch (err) {
      ctx.error(ctx.res, `Auth failed: ${err instanceof Error ? err.message : String(err)}`, 400);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${AUTH_PREFIX}/me`) {
    // Ruby High play requires only the app-owned session cookie. AI/chat
    // additionally requires the browser-owned OpenRouter key. The key still
    // never persists server-side.
    const apiKey = readApiKey(ctx);
    const record = auth.resolve(auth.parseSessionToken(ctx.cookieHeader));
    ctx.json(ctx.res, {
      authed: !!record,
      session: !!record,
      ai: !!apiKey && !!record,
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
    const requestedFaculty = ctx.url?.searchParams.get("faculty") ?? "ruby";
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!token || !record) {
      ctx.json(ctx.res, { authed: false, history: [] });
      return true;
    }
    const faculty = canonicalFacultyForRoute(ruby, auth.stateKeyForRecord(record), requestedFaculty);
    const messages = chat.history({ sessionToken: token, faculty });
    // History is bucketed by the cookie; the X-Openrouter-Key header decides
    // whether the client is "authed" for chat actions. Both can be present
    // independently — a fresh tab might have a cookie from a prior session
    // and want history but not have a key yet (or vice versa).
    ctx.json(ctx.res, {
      authed: !!readApiKey(ctx),
      history: publicChatHistory(messages),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === CHAT_PREFIX) {
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated. Sign in with OpenRouter first.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }

    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; message?: string; model?: string }
      | null;
    const faculty = canonicalFacultyForRoute(ruby, getSessionId(runtime, ctx.cookieHeader), body?.faculty);
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
      const bank = ruby.questionBankStatus(getSessionId(runtime, ctx.cookieHeader), faculty);
      for await (const ev of chat.send({
        apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
        faculty,
        userMessage: message,
        model: body?.model,
        disableTools: schedulerOwnsBoard(bank),
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
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; trigger?: string; context?: AnswerGradedContext; clientTurnSeq?: number }
      | null;
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const faculty = canonicalFacultyForRoute(ruby, sessionId, body?.faculty);
    const trigger = String(body?.trigger ?? "manual");
    const grade = body?.context?.grade;
    const isStaleChatEvent = chatEventTurnGuard(sessionId, faculty, body?.clientTurnSeq);

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
    if (isStaleChatEvent()) {
      send("done", { type: "done", finishReason: "stale-turn" });
      res.write("event: end\ndata: {}\n\n");
      res.end();
      return true;
    }

    // ── Teachers' Lounge: round-robin three teachers in a shared bucket. ───
    if (faculty === "lounge") {
      const TEACHERS = ["ruby", "sally-science", "professor-edward"];
      const order = trigger === "lounge-enter"
        ? TEACHERS
        : [pickNextLoungeSpeaker(chat, token)];
      const playerLine = trigger === "manual" ? cleanText(body?.context?.playerLine) : undefined;
      const loungeSystem =
        "LOUNGE CONTEXT: You're hanging out in the Ruby High teachers' lounge with the other faculty (Ruby, Sally Science, Professor Edward). This is downtime — just conversation, no blackboard, no tools. Chat in 1-2 short sentences in your voice — riff on a student you saw, ask a colleague's opinion, share a small observation. Address colleagues by name when natural. The student is lurking and may chime in.";

      // For lounge-enter, log the event so each speaker's first-turn
      // synopsis includes "the student just walked in."
      if (trigger === "lounge-enter") {
        chat.appendEvent(
          { sessionToken: token, faculty: "lounge" },
          {
            kind: "lounge-enter",
            text: "The student just walked into the teachers' lounge to lurk.",
          },
        );
      }
      try {
        for (const speaker of order) {
          send("speaker", { facultyId: speaker });
          // The "Ruby goes first" kickoff is a per-turn directive for
          // Ruby only, on a lounge-enter trigger. Sally + Edward pick
          // up the room state from RECENT EVENTS + the prior speakers'
          // utterances in history.
          const turnDirective =
            trigger === "lounge-enter" && speaker === "ruby"
              ? "The student just walked in. You go first — open a quick chat thread with Sally and Edward. They'll each chime in after."
              : playerLine
              ? "The student just spoke in the lounge. Reply to them directly in character in 1-2 short sentences, then keep the faculty-room scene moving."
              : undefined;
          for await (const ev of chat.send({
            apiKey,
            sessionToken: token,
            agentSessionId: getSessionId(runtime, ctx.cookieHeader),
            faculty: "lounge",
            speakerFacultyId: speaker,
            bucketKey: "lounge",
            userMessage: playerLine,
            disableTools: true,
            extraSystemContext: loungeSystem,
            systemEventNote: turnDirective,
            maxTokens: 220,
            isStale: isStaleChatEvent,
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
    //
    // Trigger ⇒ (event log entry, thin directive). We split the round-state
    // describing event ("Vee picked B; Sami picked C; correct was C") from
    // the action ask ("react in one sentence and pose the next question")
    // because the event lives in the room's awareness layer (synopsised
    // into RECENT EVENTS each turn) and the directive is per-turn-only.
    // Pre-refactor these were fused into one bloated system note that got
    // appended to history and then re-read every subsequent turn as if it
    // were a fresh instruction.
    const bank = ruby.questionBankStatus(sessionId, faculty);
    const classReportControlsBoard = classReportOwnsBoard(bank);
    const schedulerControlsBoard = !classReportControlsBoard && schedulerOwnsBoard(bank);
    const playerLine = trigger === "manual" ? cleanText(body?.context?.playerLine) : undefined;
    let directive = "";
    let disableToolsForTurn = schedulerControlsBoard || classReportControlsBoard;
    let extraSystemContext: string | undefined;
    if (trigger === "channel-enter") {
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "the player";
      chat.appendEvent(
        { sessionToken: token, faculty },
        {
          kind: "channel-enter",
          text: `${playerName} just walked into your classroom${grade ? ` for ${gradeLabel(grade)} year` : ""}.`,
        },
      );
      directive = classReportControlsBoard
        ? `Greet ${playerName} in ONE short sentence and acknowledge that today's class report is on the blackboard${bank.todayClass?.letterGrade ? ` with a ${bank.todayClass.letterGrade}` : ""}. Do not call tools or put another question on the board.`
        : schedulerControlsBoard
        ? `Greet ${playerName} in ONE short sentence. Do not mention UI controls. ${schedulerBoundaryInstruction(bank)}`
        : `Greet ${playerName} in ONE short sentence. Do not mention a "Next question" button or tell the player to press a UI control. ${nextBoardInstruction(bank, "Then call pick_from_bank to put the first question on the board. Pick something fitting their year — your call, not theirs.")}`;
    } else if (trigger === "answer-graded") {
      const c = body?.context;
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "the player";
      if (!answerGradedContextMatchesReveal(state, c)) {
        send("done", { type: "done", finishReason: "stale-answer" });
        res.write("event: end\ndata: {}\n\n");
        res.end();
        return true;
      }
      const round = state.activeRound;
      const resolved = buildResolvedAnswerBriefing({ state, context: c, playerName });
      const correctAns = resolved.correctChoice;
      extraSystemContext = resolved.extraSystemContext;
      // Build the round summary as a structured event line. Synopsised
      // exactly once into the model's RECENT EVENTS block — never
      // re-quoted in subsequent directives.
      const parts: string[] = [resolved.eventText];
      if (round && Array.isArray(round.npcs)) {
        for (const n of round.npcs) {
          const nm = STUDENTS[n.studentId]?.name ?? n.studentId;
          const pick = n.plannedPick ?? "?";
          parts.push(`${nm} picked ${pick} — ${pick === correctAns ? "right" : "wrong"}.`);
        }
      }
      chat.appendEvent(
        { sessionToken: token, faculty },
        { kind: "answer-resolved", text: parts.join(" ") },
      );
      if (characterGraduated(state)) {
        disableToolsForTurn = true;
        directive = `The player has completed Senior year and graduated. Congratulate ${playerName} in one or two short sentences. Do not call tools or put another question on the board.`;
      } else if (graduationReady(state)) {
        disableToolsForTurn = true;
        directive = `${playerName} has completed the year's requirements and is ready for the graduation ceremony. Congratulate them in one or two short sentences and remind them to choose a ceremony reward on their School Career card. Do not call tools or put another question on the board.`;
      } else if (classReportControlsBoard) {
        disableToolsForTurn = true;
        const classGrade = bank.todayClass?.letterGrade ? ` The class report shows ${bank.todayClass.letterGrade}.` : "";
        directive = `React in ONE short sentence to the round that just resolved: ${resolved.pickedLine}.${classGrade} The class report is on the blackboard now; do not call tools or put another question on the board.`;
      } else {
        const pickedLine = resolved.pickedLine;
        // The scheduler may have already auto-posted the next question by
        // the time we compose. The teacher should react to the round that
        // just resolved (described in RECENT EVENTS), not to whatever new
        // question the BOARD context shows. Both cases below say so
        // explicitly so the model isn't reconciling two boards.
        directive = schedulerControlsBoard
          ? `React in ONE short sentence to the round that just resolved: ${pickedLine} Name whoever did something interesting (the player or a classmate by name). The scheduler handles the next question on its own; if a new question already shows on the board, ignore it for this turn — you'll be fired again when the player engages with it. ${schedulerBoundaryInstruction(bank)}`
          : `React in ONE short sentence to the round that just resolved: ${pickedLine} Name whoever did something interesting (the player or a classmate by name). ${nextBoardInstruction(bank, "Then call pick_from_bank to put the next question on the board.")}`;
      }
    } else if (trigger === "manual") {
      const intent = body?.context?.intent;
      const state = ruby.getOrCreate(sessionId);
      const playerName = state.character?.name ?? "The player";
      if (intent === "hint") {
        disableToolsForTurn = true;
        directive = playerLine
          ? `${playerName} just said: "${clipped(playerLine, 140)}" Give ONE short hint that helps them reason, but do not reveal the answer, the correct choice, or any exact expected answer. Do not call tools or change the board.`
          : "The player pressed Chat while a live challenge is on the blackboard. Give ONE short hint that helps them reason, but do not reveal the answer, the correct choice, or any exact expected answer. Do not call tools or change the board.";
      } else if (playerLine) {
        directive = classReportControlsBoard
          ? `${playerName} just said: "${clipped(playerLine, 140)}" Reply directly in character about today's class report or the recent class. Do not call tools or put another question on the board.`
          : schedulerControlsBoard
          ? `${playerName} just said: "${clipped(playerLine, 140)}" Reply directly in character, explain the current or recent board if useful, or keep the room moving. ${schedulerBoundaryInstruction(bank)}`
          : `${playerName} just said: "${clipped(playerLine, 140)}" Reply directly in character, then either keep the room moving or put a fresh challenge on the board. ${nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh banked question.")}`;
      } else {
        directive = classReportControlsBoard
          ? `The player pressed Chat while today's class report is on the blackboard. Discuss the result or the recent class in character. Do not call tools or put another question on the board.`
          : schedulerControlsBoard
          ? `The player pressed Chat to move the room forward. Follow up on the last exchange, explain the current or recent board if useful, or keep the scene moving. ${schedulerBoundaryInstruction(bank)}`
          : `The player pressed Chat to move the room forward. Either follow up on the last exchange, or put a fresh challenge on the board. ${nextBoardInstruction(bank, "Use pick_from_bank if you want a fresh banked question.")}`;
      }
    }

    try {
      send("speaker", { facultyId: faculty });
      let questionPosted = false;
      let handoffFired = false;
      for await (const ev of chat.send({
        apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
        faculty,
        userMessage: playerLine,
        disableTools: disableToolsForTurn,
        extraSystemContext,
        systemEventNote: directive,
        isStale: isStaleChatEvent,
      })) {
        if (ev.type === "tool") {
          if (toolPlacedFreshQuestion(ev)) questionPosted = true;
          if (ev.tool === "handoff_faculty" && ev.result.ok) handoffFired = true;
        }
        send(ev.type, ev);
      }
      // When the scheduled class loop is done, AI mode regains its previous
      // board-control behavior. If it narrates a transition but forgets the
      // tool call, keep the board state matched by posting a scheduled card
      // when available or asking it once for a custom practice challenge.
      const needsFreshQuestion = !disableToolsForTurn && (trigger === "channel-enter" || trigger === "answer-graded");
      if (needsFreshQuestion && !questionPosted && !handoffFired && activeFacultyMatches(ruby, sessionId, faculty)) {
        const agentSessionId = getSessionId(runtime, ctx.cookieHeader);
        const latestBank = ruby.questionBankStatus(agentSessionId, faculty);
        let fallbackPosted = false;
        if (latestBank.remaining > 0) {
          try {
            const state = ruby.pickAndPose(agentSessionId, { faculty });
            send("tool", {
              tool: "pick_from_bank",
              args: { faculty },
              result: { ok: true, message: `fallback: auto-posed next question (model narrated ${trigger} without tool)` },
              state,
            });
            fallbackPosted = true;
          } catch (err) {
            log.event("chat.bank-exhausted", { faculty, trigger, reason: err instanceof Error ? err.message : String(err) });
          }
        } else {
          log.event("chat.bank-exhausted", { faculty, trigger, reason: "active faculty bank exhausted before fallback" });
        }
        if (!fallbackPosted) {
          const noQuestionNote = latestBank.mode === "srs"
            ? `No scheduled deck card is available for ${latestBank.displayName} right now.`
            : `No scheduled Ruby High card is available for ${latestBank.displayName} right now.`;
          const noQuestionDirective = latestBank.mode === "srs"
            ? "No scheduled deck card is available right now, and pick_from_bank is unavailable. Do not say the deck is exhausted or dry. Call pose_question exactly once for a custom practice challenge, or talk briefly about progress."
            : "No scheduled Ruby High card is available, and pick_from_bank is unavailable. Call pose_question exactly once and write a custom practice question, or talk briefly about progress.";
          chat.appendEvent(
            { sessionToken: token, faculty },
            { kind: "note", text: noQuestionNote },
          );
          for await (const ev of chat.send({
            apiKey,
            sessionToken: token,
            agentSessionId,
            faculty,
            systemEventNote: noQuestionDirective,
            isStale: isStaleChatEvent,
          })) {
            send(ev.type, ev);
          }
        }
      }
    } catch (err) {
      log.error("chat.event-failed", err, { faculty, trigger });
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
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { studentId?: string; situation?: string; note?: string; faculty?: string; playerText?: string }
      | null;
    const student = STUDENTS[String(body?.studentId ?? "")];
    if (!student) {
      ctx.error(ctx.res, "Unknown studentId.", 400);
      return true;
    }
    const situation = String(body?.situation ?? "ambient classroom moment");
    // Plumb group-chat context into the chime: who the player is, who else
    // is seated nearby. Keeps NPCs grounded in the room instead of riffing
    // on a faceless "user" — and lets them address each other by name.
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const state = ruby.getOrCreate(sessionId);
    const faculty = body?.faculty ? canonicalFacultyForRoute(ruby, sessionId, body.faculty) : undefined;
    const playerName = state.character?.name;
    let classmateNames: string[] = [];
    if (state.currentGrade && state.faculty) {
      const r = state.npcRosters[state.currentGrade] ?? [];
      const room = roomForFacultyForSession(state, state.faculty);
      if (room && room.teaches) {
        classmateNames = r
          .filter((n) => n.currentRoom === room.id && n.id !== student.id)
          .map((n) => STUDENTS[n.id]?.name ?? n.id);
      }
    }
    // Pull the teacher's most recent spoken line so the NPC reacts to actual
    // words on screen, not a faceless event tag. Without this an NPC will
    // openly admit it can't see the conversation ("can't see what edward
    // actually said to iris so i got nothing rn lol").
    let teacherSaid: string | undefined;
    if (faculty) {
      const history = chat.history({ sessionToken: token, faculty });
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === "assistant" && m.content && m.content.trim()) {
          teacherSaid = m.content.trim();
          break;
        }
      }
    }
    const playerText = body?.playerText?.trim() || undefined;
    if (playerText && faculty) {
      chat.appendEvent(
        { sessionToken: token, faculty },
        {
          kind: "note",
          text: `${playerName ?? "The player"} said: "${clipped(playerText, 180)}"`,
        },
      );
    }
    try {
      const line = await generateStudentLine({
        apiKey,
        student,
        situation,
        note: body?.note,
        faculty,
        playerName,
        classmateNames,
        teacherSaid,
        playerText,
      });
      // Stamp the chime into the active teacher's room awareness so the
      // next teacher turn's RECENT EVENTS synopsis includes it. Without
      // this, an NPC speaks on screen, the player replies "Thanks Sami!"
      // and the teacher — whose dialogue history only carries her own
      // messages plus the player's — has no record of Sami at all and
      // denies knowing him. Routed through the structured event log so
      // it shows up in synopsis order, never as a stale system note in
      // the dialogue stream.
      if (line && faculty) {
        chat.appendEvent(
          { sessionToken: token, faculty },
          {
            kind: "chime",
            text: `${student.name} (classmate) chimed in: "${line}"`,
          },
        );
      }
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
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { text?: string; force?: boolean } | null;
    const text = (body?.text ?? "").trim();
    const force = !!body?.force;
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
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
        apiKey,
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
      // Log the grading event for the next teacher turn's synopsis. The
      // narrativeText itself is yielded as deltas above (visible in
      // chat); this entry exists so a follow-up teacher turn knows the
      // grading has already happened and doesn't re-grade.
      chat.appendEvent(
        { sessionToken: token, faculty: facultyId },
        { kind: "opinion-graded", text: `Opinion grading delivered: ${narrativeText}` },
      );
    } catch (err) {
      send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
    return true;
  }

  // Roll a random character preview. Returns JSON; the client either accepts
  // (calls the regular /command create-character) or rerolls.
  // Generate a sticker portrait of the player's character. Returns a base64
  // data URL that the client persists onto the character via set-portrait.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/portrait`) {
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Sign in with OpenRouter first.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    // Image generation is the most expensive call we make — keep its bucket
    // separate and tighter than the chat one.
    const rlKey = rateLimitKey(ctx, token);
    if (!PORTRAIT_LIMITER.take(rlKey)) {
      reject429(ctx, PORTRAIT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { name?: string; playbookId?: string; personality?: string; stats?: { head?: number; heart?: number; hustle?: number; honor?: number } }
      | null;
    const name = String(body?.name ?? "").trim();
    const personality = String(body?.personality ?? "").trim();
    if (!name || !personality) {
      ctx.error(ctx.res, "Missing name or personality.", 400);
      return true;
    }
    try {
      const dataUrl = await renderCharacterPortrait({
        apiKey,
        name,
        personality,
      });
      // S3 upload returns the public URL; falls through to the dataUrl
      // when RUBY_HIGH_PORTRAITS_BUCKET isn't set (the createCharacter
      // size cap will then reject on save and the user sees a clear
      // error). The field name stays portraitDataUrl for callsite
      // backward compat — value is now usually an https:// URL.
      const url = await maybeUploadPortrait(dataUrl, "portrait");
      ctx.json(ctx.res, { ok: true, portraitDataUrl: url });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // Diploma image — fired by the viewer when graduation lands. Reads the
  // character's subjectScores server-side to pick the subject-themed
  // accessory. Same rate-limiter as portrait gen (8 burst, 1/30s).
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/diploma`) {
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Sign in with OpenRouter first.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    const rlKey = rateLimitKey(ctx, token);
    if (!PORTRAIT_LIMITER.take(rlKey)) {
      reject429(ctx, PORTRAIT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const ruby = getService<RubyHighService>(runtime, RubyHighService.serviceType);
    if (!ruby) {
      ctx.error(ctx.res, "RubyHighService unavailable.", 503);
      return true;
    }
    const sessionId = getSessionId(runtime, ctx.cookieHeader);
    const state = ruby.getOrCreate(sessionId);
    const ch = state.character;
    if (!ch) {
      ctx.error(ctx.res, "No character on this session.", 400);
      return true;
    }
    if ((ch.yearbook ?? []).length < 4) {
      ctx.error(ctx.res, "Diploma is only available after Senior graduation.", 400);
      return true;
    }
    try {
      const dataUrl = await renderDiplomaImage({
        apiKey,
        name: ch.name,
        personality: ch.personality,
        bestSubjectFacultyId: highestScoringFaculty(ch.subjectScores),
      });
      const url = await maybeUploadPortrait(dataUrl, "diploma");
      ch.diplomaImageDataUrl = url;
      await ruby.flushSession(sessionId);
      ctx.json(ctx.res, {
        ok: true,
        diplomaImageDataUrl: url,
        bestSubject: highestScoringFaculty(ch.subjectScores),
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/generate`) {
    const cred = requireAuth(ctx, auth);
    if (!cred) {
      ctx.error(ctx.res, "Sign in with OpenRouter first to roll a character.", 401);
      return true;
    }
    const { token, apiKey } = cred;
    // Body: { regen?: CharacterComponent[], keep?: Partial<RolledCharacter> }
    // No body / empty body → full roll (current behaviour).
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { regen?: unknown; keep?: unknown }
      | null;
    const regen = Array.isArray(body?.regen)
      ? (body!.regen.filter((x): x is CharacterComponent =>
          x === "name" || x === "personality" || x === "arcAnswer" ||
          x === "flavorQuote" || x === "stats" || x === "playbook"))
      : undefined;
    const keep = body?.keep && typeof body.keep === "object"
      ? body.keep as Partial<RolledCharacter>
      : undefined;
    // Rate-limit only when an LLM call is actually going to fire. Pure
    // dice rerolls (regen ⊆ {stats, playbook}) skip the limiter so
    // tapping the dice icon stays snappy.
    const willHitLLM =
      !regen ||
      regen.some((c) => c === "name" || c === "personality" || c === "arcAnswer" || c === "flavorQuote");
    if (willHitLLM) {
      const rlKey = rateLimitKey(ctx, token);
      if (!CHAT_LIMITER.take(rlKey)) {
        reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
        return true;
      }
    }
    try {
      const c = await rollRandomCharacter({ apiKey, regen, keep });
      ctx.json(ctx.res, { ok: true, character: c });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/reset`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as { faculty?: string } | null;
    const faculty = canonicalFacultyForRoute(ruby, auth.stateKeyForRecord(record), body?.faculty ?? "ruby");
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
  const ruby = getService<RubyHighService>(args.runtime, RubyHighService.serviceType);
  if (!auth || !chat || !ruby) return;
  const token = auth.parseSessionToken(args.cookieHeader);
  if (!token || !auth.resolve(token)) return;
  const sessionId = getSessionId(getRuntime(args.runtime), args.cookieHeader);
  const faculty = canonicalFacultyForRoute(ruby, sessionId, args.faculty);
  const state = ruby.getOrCreate(sessionId);
  const playerName = state.character?.name ?? "the player";
  const resolved = buildResolvedAnswerBriefing({
    state,
    playerName,
    context: {
      picked: args.picked,
      correct: args.correct,
      forfeit: false,
      wasCorrect: args.wasCorrect,
    },
  });
  const note = `${resolved.eventText} Do not ask for this answer again.`;
  chat.noteAnswer({ sessionToken: token, faculty }, note);
}
