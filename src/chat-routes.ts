import type { IAgentRuntime } from "@elizaos/core";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { TokenBucket } from "./services/rate-limit.js";
import { parseTeacherGrades } from "./grading.js";
import { GRADE_LABELS, type CharacterStats, type Grade } from "./types.js";
import { STUDENTS, type StudentCharacter } from "./characters/students.js";
import { teacherById } from "./characters/teachers.js";
import { PLAYBOOKS } from "./characters/playbooks.js";

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
  if (!r.ok) await throwOpenRouterError(r, "chat");
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  return parseTeacherGrades(text);
}

const PORTRAIT_MODEL = process.env.RUBY_HIGH_PORTRAIT_MODEL ?? "google/gemini-3.1-flash-image-preview";
const PORTRAIT_MAX_TOKENS = Number(process.env.RUBY_HIGH_PORTRAIT_MAX_TOKENS ?? 4000);

/** One-shot portrait gen using the same sticker style as the teachers/students.
 *  Returns a base64 data URL. */
async function renderCharacterPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const userPrompt = [
    `JRPG dialog-portrait of ${args.name}, a high schooler at Ruby High.`,
    `Personality: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Dynamic relaxed pose, expressive face that fits the personality.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
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
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${text || r.statusText}`);
  }
  const body = await r.json() as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("No image returned");
  return url;
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
  const userPrompt = [
    `JRPG dialog-portrait of ${args.name} at their Ruby High graduation.`,
    `Personality: ${args.personality}`,
    "",
    `STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. The character is wearing a high-school graduation cap and gown over their normal clothes — gown is a warm crimson red, cap is matching with a yellow tassel. They are smiling, proud but a little nervous. ${accessory}.`,
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale gold background (#f5e8c2). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
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
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${text || r.statusText}`);
  }
  const body = await r.json() as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("No image returned");
  return url;
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

/** Roll a random character: random playbook + random stat distribution, then
 *  LLM-generated name + arc + flavor + personality grounded in those choices.
 *  The prompt deliberately avoids steering toward any cultural template or
 *  thematic register — we want a kid in school, not a manifesto or an
 *  edgelord. Anti-pattern guards live at the bottom of the prompt. */
async function rollRandomCharacter(args: { apiKey: string }): Promise<{
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote: string;
  personality: string;
}> {
  const playbook = PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!;
  const stats = randomStatDistribution();
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const userPrompt = [
    "Roll a random AI student attending Ruby High (a high school RPG). The player inhabits this character. Aim for a real teenager with small specific concerns — the register of group-chat texts, lunch-line gossip, a half-finished homework excuse.",
    "",
    `Playbook (locked): ${playbook.name} — ${playbook.blurb}`,
    `Hook question (locked): "${playbook.hookQuestion}"`,
    `Stats (locked): HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}`,
    "",
    "Generate JSON exactly in this shape (no other text, no markdown, no code fences):",
    `{"name":"...","arcAnswer":"...","flavorQuote":"...","personality":"..."}`,
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
  const name = String(parsed.name ?? "").trim();
  const arcAnswer = String(parsed.arcAnswer ?? "").trim();
  // Trim wrapping curly/straight quotes if the model added them despite instructions.
  const flavorQuote = String(parsed.flavorQuote ?? "").trim().replace(/^["“'\s]+|["”'\s]+$/g, "");
  const personality = String(parsed.personality ?? "").trim();
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
}): Promise<string> {
  const facultyContext = args.faculty
    ? `The current class is taught by ${args.faculty.replace("-", " ")}.`
    : "";
  const noteContext = args.note ? `Context: ${args.note}` : "";
  const userPrompt = [
    `Situation: ${args.situation}.`,
    facultyContext,
    noteContext,
    "React in one short line — like a text in a group chat. Lowercase, 12 words max. If you genuinely have nothing, 'lol' or 'idk' or 'fr' is plenty.",
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

function getRuntime(value: unknown): IAgentRuntime | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { agentId?: unknown; getService?: unknown };
  if (typeof candidate.getService !== "function") return null;
  return candidate as unknown as IAgentRuntime;
}

/** See routes.ts for the multi-tenant explanation. Per-user session keys come
 *  from the rh_session cookie. */
function getSessionId(runtime: IAgentRuntime | null, cookieHeader?: string | null): string {
  if (!cookieHeader) return "rh:anonymous";
  for (const part of cookieHeader.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i) === "rh_session") return "rh:user:" + decodeURIComponent(part.slice(i + 1));
  }
  return "rh:anonymous";
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
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }

    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; message?: string; model?: string }
      | null;
    const faculty = body?.faculty ?? ruby.getOrCreate(getSessionId(runtime, ctx.cookieHeader)).faculty;
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
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
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
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as
      | { faculty?: string; trigger?: string; context?: { grade?: string } }
      | null;
    const faculty = body?.faculty ?? ruby.getOrCreate(getSessionId(runtime, ctx.cookieHeader)).faculty;
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
        "LOUNGE CONTEXT: You're hanging out in the Ruby High teachers' lounge with the other faculty (Ruby, Sally Science, Professor Edward). This is downtime — just conversation, no blackboard, no tools. Chat in 1-2 short sentences in your voice — riff on a student you saw, ask a colleague's opinion, share a small observation. Address colleagues by name when natural. The student is lurking and may chime in.";

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
            agentSessionId: getSessionId(runtime, ctx.cookieHeader),
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
      directive = `EVENT: The student just walked into your classroom${grade ? ` for ${gradeLabel(grade)} year` : ""}. Greet them in ONE short sentence, then call pick_from_bank to put the first question on the board. Pick something fitting their year directly — your call, not theirs.`;
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
      let toolsFired = 0;
      for await (const ev of chat.send({
        apiKey: record.apiKey,
        sessionToken: token,
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
        faculty,
        systemEventNote: directive,
      })) {
        if (ev.type === "tool") toolsFired++;
        send(ev.type, ev);
      }
      // Defensive fallback: a channel-enter directive's whole point is to put
      // a question on the board. If the model greeted but didn't fire any
      // tool, the player would land on an empty chalkboard and the only
      // recovery is the manual "Next question" button. Auto-pose so the
      // room never sits silent on entry. No-op if pickAndPose throws (bank
      // empty for filter, etc.) — better empty board with a recoverable
      // error than crashing the SSE stream.
      if (trigger === "channel-enter" && toolsFired === 0) {
        try {
          const sessionId = getSessionId(runtime, ctx.cookieHeader);
          const state = ruby.pickAndPose(sessionId, { faculty });
          send("tool", {
            tool: "pick_from_bank",
            args: { faculty },
            result: { ok: true, message: "fallback: auto-posed first question (model greeted without tool)" },
            state,
          });
        } catch (err) {
          // Don't fail the whole turn — just log via SSE so the client knows.
          send("error", { type: "error", message: `channel-enter fallback skipped: ${err instanceof Error ? err.message : String(err)}` });
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
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
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

  // Roll a random character preview. Returns JSON; the client either accepts
  // (calls the regular /command create-character) or rerolls.
  // Generate a sticker portrait of the player's character. Returns a base64
  // data URL that the client persists onto the character via set-portrait.
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/portrait`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Sign in with OpenRouter first.", 401);
      return true;
    }
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
        apiKey: record.apiKey,
        name,
        personality,
      });
      ctx.json(ctx.res, { ok: true, portraitDataUrl: dataUrl });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // Diploma image — fired by the viewer when graduation lands. Reads the
  // character's subjectScores server-side to pick the subject-themed
  // accessory. Same rate-limiter as portrait gen (8 burst, 1/30s).
  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/diploma`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Sign in with OpenRouter first.", 401);
      return true;
    }
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
        apiKey: record.apiKey,
        name: ch.name,
        personality: ch.personality,
        bestSubjectFacultyId: highestScoringFaculty(ch.subjectScores),
      });
      ch.diplomaImageDataUrl = dataUrl;
      ctx.json(ctx.res, {
        ok: true,
        diplomaImageDataUrl: dataUrl,
        bestSubject: highestScoringFaculty(ch.subjectScores),
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/generate`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Sign in with OpenRouter first to roll a character.", 401);
      return true;
    }
    const rlKey = rateLimitKey(ctx, token);
    if (!CHAT_LIMITER.take(rlKey)) {
      reject429(ctx, CHAT_LIMITER.retryAfterSeconds(rlKey));
      return true;
    }
    try {
      const c = await rollRandomCharacter({ apiKey: record.apiKey });
      ctx.json(ctx.res, { ok: true, character: c });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
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
