import type { IAgentRuntime } from "@elizaos/core";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { GRADE_LABELS, type CharacterStats, type Grade } from "./types.js";
import { STUDENTS, type StudentCharacter } from "./characters/students.js";
import { teacherById } from "./characters/teachers.js";
import { PLAYBOOKS } from "./characters/playbooks.js";

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
    `JRPG dialog-portrait of ${args.name}, a junior at Ruby High.`,
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

/** Pool of name "vibes" — randomly seeded into the prompt so the LLM
 *  doesn't keep landing on its training-bias defaults (Marcus Kim, Emma
 *  Patel, etc.). Each vibe describes a NAMING style, not a specific name —
 *  the LLM still picks the actual letters. */
const NAME_VIBES = [
  "a contemporary Filipino name, common spelling",
  "a Nigerian Igbo or Yoruba name, traditional",
  "a hyphenated double last name reflecting biracial heritage",
  "a chosen mononym this teen uses instead of their legal name",
  "a regional Tamil or Telugu name, written naturally not romanized",
  "an old-fashioned name like a 1940s newspaper byline",
  "a hyphenated Quebecois or Acadian name",
  "a Vietnamese name with a middle character that has a meaning",
  "a Brazilian Portuguese name with three or four parts",
  "a Polish or Czech surname that's hard to pronounce in English",
  "a Lebanese or Syrian-American name that mixes Arabic and English",
  "an Inuit or First Nations name with a chosen English first name",
  "a Sami or other indigenous European name",
  "a Kazakh or Uzbek name, with the patronymic optional",
  "a Welsh name with an unusual spelling",
  "a Yiddish/Ashkenazi name, family carried it from before WWII",
  "an Ethiopian or Eritrean name in two parts",
  "a Hawaiian or Samoan name with multiple vowels",
  "a Quechua or Aymara name",
  "a southern Black American name from the 70s-80s naming wave",
  "a Greek-American kid's family name, full version not the shortened one",
  "a Burmese, Thai, or Lao name",
  "a Croatian or Bosnian name with a -ić ending",
  "a single-syllable surname-first name common in Cantonese-speaking families",
  "a quirky punk/skater nickname the kid demands everyone use",
  "a name from an obscure indie film the parents loved",
  "a name explicitly chosen by the teen themselves — trans or genderqueer",
  "an Irish Gaelic name with a fada that nobody pronounces correctly",
  "a Persian/Farsi name with a poetic meaning",
  "a Romani name, surname uncommon in English-speaking school records",
  "a Mongolian name, herder ancestry, family-given-name order",
  "a Korean name where the family insists on keeping syllable order",
  "a name from Trinidad and Tobago, calypso-era flavor",
  "an Albanian or Kosovar name, post-90s diaspora",
  "a Maori name from Aotearoa with hyphenation",
  "a Khmer name, two short parts",
  "a Caribbean-Hispanic name like a Puerto Rican or Dominican kid",
  "an Ashkenazi Argentine kid's name, mix of Yiddish and Spanish",
  "a Boer-Afrikaner name, no anglicization",
  "a Tibetan or Himalayan name with religious significance",
];

const FORBIDDEN_NAMES_HINT = [
  "Marcus", "Maya", "Mariana", "Emma", "Sarah", "James", "Alex", "Sam", "Jordan", "Liam",
  "Olivia", "Noah", "Ava", "Mia", "Ethan", "Aiden", "Lucas", "Harper", "Sophia", "Cortés",
  "Patel", "Kim", "Chen", "Rodriguez", "Garcia", "Smith", "Johnson", "Williams", "Anderson",
  "Brown", "Lopez", "Gonzalez", "Martinez", "Wilson", "Davis", "Taylor", "Thomas",
];

/** Roll a random character: random playbook + random stat distribution +
 *  random name vibe seed, then LLM-generated name/arc/personality grounded
 *  in those choices. The vibe seed is what keeps names from converging on
 *  AI-default common picks. */
async function rollRandomCharacter(args: { apiKey: string }): Promise<{
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  personality: string;
}> {
  const playbook = PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!;
  const stats = randomStatDistribution();
  const nameVibe = NAME_VIBES[Math.floor(Math.random() * NAME_VIBES.length)]!;
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const userPrompt = [
    "Roll a random AI student attending Ruby High (a high school RPG). The player will INHABIT this character — they're playing them, not designing them. Make them specific and a little weird, not generic.",
    "",
    `Playbook (locked): ${playbook.name} — ${playbook.blurb}`,
    `Hook question (locked): "${playbook.hookQuestion}"`,
    `Stats (locked): HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}`,
    `Name vibe (HARD CONSTRAINT, this run): ${nameVibe}`,
    "",
    "Generate JSON exactly in this shape (no other text, no markdown, no code fences):",
    `{"name":"...","arcAnswer":"...","personality":"..."}`,
    "",
    "Rules for each field:",
    "- name: a real plausible name following the name-vibe constraint above. Don't anglicize or simplify it. Use proper diacritics where they belong. The vibe is locked — do NOT swap it for a different cultural template. Avoid these overused names entirely: " + FORBIDDEN_NAMES_HINT.join(", ") + ".",
    "- arcAnswer: 1-2 sentences in the character's voice answering the hook question above. Specific, not abstract. First person.",
    "- personality: 2-3 sentences describing how this character SHOWS UP in class — quirks, what they care about, what they do when bored, who they sit with. Tie at least one trait back to a high stat (HEAD = sharp, HEART = warm, HUSTLE = quick, HONOR = principled) and at least one to a low stat (the same negative). Third person.",
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
      max_tokens: 380,
      temperature: 1.1,
    }),
  });
  if (!r.ok) throw new Error("OpenRouter " + r.status);
  const body = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  // Strip code fences if the model added any despite instructions.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: { name?: unknown; arcAnswer?: unknown; personality?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse character JSON: ${(err as Error).message} — body: ${cleaned.slice(0, 200)}`);
  }
  const name = String(parsed.name ?? "").trim();
  const arcAnswer = String(parsed.arcAnswer ?? "").trim();
  const personality = String(parsed.personality ?? "").trim();
  if (!name || !arcAnswer || !personality) {
    throw new Error("Generated character missing required fields.");
  }
  return { name, playbookId: playbook.id, stats, arcAnswer, personality };
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
    "RULES — NO EXCEPTIONS:",
    "- Output ONLY one short sentence (max 12 words). Nothing else.",
    "- Do NOT ask for context. Do NOT ask clarifying questions.",
    "- Do NOT explain what you're doing. Just say the line.",
    "- Lowercase mostly. Casual texting style. No quotes, no hashtags, no preamble.",
    "- If you genuinely don't have a reaction, say 'lol' or 'idk' or 'fr'. Never refuse.",
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
        agentSessionId: getSessionId(runtime, ctx.cookieHeader),
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

  if (ctx.method === "POST" && ctx.pathname === `${CHAT_PREFIX}/character/generate`) {
    const token = auth.parseSessionToken(ctx.cookieHeader);
    const record = auth.resolve(token);
    if (!record || !token) {
      ctx.error(ctx.res, "Sign in with OpenRouter first to roll a character.", 401);
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
