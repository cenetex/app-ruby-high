import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const TARGET_COUNT = Number(argValue("target") ?? 200);
const PROVIDER = (argValue("provider") ?? process.env.RUBY_HIGH_LLM_PROVIDER ?? "openrouter").toLowerCase();
const BATCH_SIZE = Number(argValue("batch") ?? (PROVIDER === "local" ? 2 : 10));
const MODEL = argValue("model") ?? process.env.RUBY_HIGH_COURSE_MODEL ?? (PROVIDER === "local" ? "gemma4:latest" : "qwen/qwen3.7-max");
const CHAT_COMPLETIONS_URL = PROVIDER === "local"
  ? normalizeChatCompletionsUrl(argValue("base-url") ?? process.env.RUBY_HIGH_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1")
  : "https://openrouter.ai/api/v1/chat/completions";
const FACULTY_FILTER = argValue("faculty");
const DIFFICULTIES = ["easy", "medium", "hard"];
const STATS = ["head", "heart", "hustle", "honor"];
const CHOICES = ["A", "B", "C", "D"];

loadDotEnv();

const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY
  ?? process.env.OPENROUTER_API_KEY
  ?? process.env.OPENROUTER_KEY;

if (PROVIDER !== "local" && !apiKey) {
  throw new Error("Missing RUBY_HIGH_OPENROUTER_API_KEY, OPENROUTER_API_KEY, or OPENROUTER_KEY.");
}

const facultyConfigs = [
  {
    id: "ruby",
    prefix: "ruby-gen",
    jsonPath: "assets/questions/ruby.json",
    corpusPath: "assets/corpora/ruby.md",
    title: "Ruby",
    description: "Ruby teaches AI literacy, agent culture, general computing, networked systems, on-chain history, and the ethics of useful software agents.",
    voice:
      "Ruby teaches like the school itself is an argument about agency. Frame questions around convenience versus control: who authorized what, what the student is responsible for, when confidence is useful and when it is dangerous. Senior questions should feel like judgment calls, not trivia. Catch the misconceptions she hates: bigger context window does not mean perfect recall; chat history is not durable memory; a model refusing is not the app authorizing; blockchain fairness is not automatic. Prompts may carry dry wit and earned bite — but exactly one option must be unambiguously, academically correct.",
    lanes: [
      "Freshman bridge questions: practical AI/web vocabulary, but asked through small classroom scenarios.",
      "Agent reliability questions: user confirmation, dirty worktrees, tool schemas, idempotency, retries, and safe side effects.",
      "Systems literacy questions: HTTP, TLS, DNS, OAuth, webhooks, database indexes, rate limits, and smoke tests.",
      "On-chain fairness questions: wallets, mint authority, nonces, Merkle proofs, replay resistance, and commit-reveal verification.",
      "Multiplayer ethics questions: what classmates can see, what must stay private, and when confidence should be checked.",
    ],
  },
  {
    id: "sally-science",
    prefix: "sally-gen",
    jsonPath: "assets/questions/sally-science.json",
    corpusPath: "assets/corpora/sally-science.md",
    title: "Sally Science",
    description: "Sally teaches physics, chemistry, biology, and earth science through crisp experiments, clean definitions, and practical high-school reasoning.",
    voice:
      "Sally teaches through crisp experiments and clean definitions, and she prizes evidence discipline above all. Frame questions so they reward reasoning from observation to mechanism, and write distractors that embody the sloppy thinking she catches: correlation mistaken for causation, missing controls, ignored uncertainty, units dropped. Warm but exacting. A good question rewards a student who can explain why, not just recall what.",
    lanes: [
      "Measurement and lab-safety questions: units, variables, controls, uncertainty, goggles, and evidence discipline.",
      "Physics model questions: motion, forces, energy, electricity, waves, optics, thermodynamics, and constraints.",
      "Chemistry reasoning questions: bonding, pH, catalysts, molarity, redox, equilibrium, gases, and lab separation.",
      "Biology systems questions: DNA, transcription, enzymes, evolution, homeostasis, immunity, meiosis, and population assumptions.",
      "Earth science evidence questions: tectonics, seismology, atmosphere, climate records, ocean currents, albedo, and Coriolis.",
    ],
  },
  {
    id: "professor-edward",
    prefix: "edward-gen",
    jsonPath: "assets/questions/professor-edward.json",
    corpusPath: "assets/corpora/professor-edward.md",
    title: "Professor Edward",
    description: "Edward teaches literature, literary theory, mid-century novels, postwar culture, criticism, narration, authorship, genre, and close reading.",
    voice:
      "Edward is a close-reader who separates the narrator from the author and prizes textual evidence over vibes; mid-century literary culture is his playground. Frame questions like seminar prompts that reward precise reading over plot recall, and write distractors that are the confident misreadings a smart student actually makes. Wry and erudite, never pompous.",
    lanes: [
      "Close-reading questions: narrator versus author, point of view, imagery, irony, setting, and textual evidence.",
      "Narrative-form questions: focalization, free indirect discourse, frame narrative, unreliable narration, polyphony, and genre.",
      "Theory-method questions: formalism, New Criticism, Marxist, feminist, postcolonial, reader-response, archive, and affect methods.",
      "Mid-century history questions: Cold War paranoia, suburban conformity, obscenity trials, paperback distribution, and mass media.",
      "Seminar ethics questions: how readers resist manipulative narration, handle authorial intention, and argue responsibly from evidence.",
    ],
  },
];

await mkdir(resolve(root, ".tmp", "generated-question-banks"), { recursive: true });

for (const config of facultyConfigs.filter((entry) => !FACULTY_FILTER || entry.id === FACULTY_FILTER)) {
  await generateForFaculty(config);
}

async function generateForFaculty(config) {
  const filePath = resolve(root, config.jsonPath);
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (parsed.faculty !== config.id) {
    throw new Error(`${config.jsonPath} faculty mismatch: ${parsed.faculty} !== ${config.id}`);
  }
  const existing = Array.isArray(parsed.questions) ? parsed.questions : [];
  const needed = Math.max(0, TARGET_COUNT - existing.length);
  if (needed === 0) {
    console.log(`${config.id}: already has ${existing.length} questions`);
    return;
  }

  const corpus = await readFile(resolve(root, config.corpusPath), "utf8");
  const sourceCards = parseCorpusCards(corpus);
  const materials = [
    config.description,
    "",
    "Teacher research corpus:",
    corpus,
  ].join("\n");
  const working = [...existing];
  let nextNumber = nextGeneratedNumber(config.prefix, working);

  console.log(`${config.id}: generating ${needed} new questions (${existing.length} -> ${TARGET_COUNT})`);
  while (working.length < TARGET_COUNT) {
    const count = Math.min(BATCH_SIZE, TARGET_COUNT - working.length);
    const targets = questionBalanceTargets(working, count);
    const batch = await generateBatch({
      config,
      existing: working,
      avoidCards: sourceCards,
      materials,
      count,
      targets,
      lane: researchLaneFor(config, working.length),
      startNumber: nextNumber,
    });
    if (batch.length === 0) {
      throw new Error(`${config.id}: generator returned no usable questions`);
    }
    for (const q of batch) {
      q.id = `${config.prefix}-${String(nextNumber).padStart(3, "0")}`;
      nextNumber += 1;
      working.push(q);
    }
    await writeSnapshot(config, parsed, working);
    console.log(`${config.id}: ${working.length}/${TARGET_COUNT}`);
  }

  const output = {
    ...parsed,
    questions: working.slice(0, TARGET_COUNT),
  };
  await writeFile(filePath, `${JSON.stringify(output, null, 2)}\n`);
}

async function generateBatch(args) {
  const prompt = [
    `Teacher: ${args.config.title}`,
    `Faculty id: ${args.config.id}`,
    `Teacher research interests: ${args.config.description}`,
    `Teacher voice — write EVERY question (prompt and options) in this voice, not as flat trivia: ${args.config.voice}`,
    `Current research pass: ${args.lane}`,
    `Write exactly ${args.count} new multiple-choice study questions for Ruby High.`,
    "The app is becoming a massively generative online school RPG. Write like this teacher is actively researching and curating a curriculum, not blindly expanding a list.",
    "Return only JSON. No markdown fences.",
    PROVIDER === "local" ? "Return compact minified JSON in one line. Do not add commentary, analysis, or whitespace-heavy formatting." : "",
    "Use this exact shape:",
    `{"questions":[{"prompt":"...","subject":"...","difficulty":"easy","stat":"head","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"..."}]}`,
    "Rules:",
    "- Questions must be answerable from the teacher research corpus below.",
    "- Avoid duplicating existing cards or simply restating a source card word-for-word.",
    "- Prefer applied questions, misconception checks, comparisons, and classroom scenarios over direct front/back flashcard recall.",
    "- Make each question test a distinct concept or distinction. Do not make several questions with the same correct answer or same classroom move.",
    "- Write in the teacher's voice (above): the prompt should sound like this specific teacher framing a judgment call or scenario, never a generic flashcard. The single correct option must still be unambiguously, academically correct.",
    "- Keep prompts concise enough for a fast classroom question loop.",
    "- Options must be plausible, distinct, and similar in length/style.",
    "- Never use meta-options such as 'All of the above', 'None of the above', or 'Both A and B'. Every option must be a standalone answer that reads correctly in any position.",
    "- difficulty must be easy, medium, or hard.",
    "- stat must be head, heart, hustle, or honor.",
    "- correct must be A, B, C, or D.",
    existingQuestionPrompt(args.existing),
    sourceCardAvoidPrompt(args.avoidCards),
    questionBalanceStatusPrompt(args.existing),
    questionBalancePrompt(args.targets),
    "Teacher research corpus:",
    args.materials.slice(0, 24_000),
  ].filter(Boolean).join("\n\n");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const maxTokens = Math.max(2600, Math.min(PROVIDER === "local" ? 9000 : 5200, args.count * (PROVIDER === "local" ? 1800 : 650)));
    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...providerAuthHeaders(),
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are the named Ruby High faculty member writing your own multiple-choice study questions in your own distinctive teaching voice — never generic flashcards. Exactly one option is academically correct. You always return valid JSON and no prose.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        options: PROVIDER === "local" ? { num_predict: maxTokens, temperature: 0.35 } : undefined,
        temperature: 0.48,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (attempt === 3) throw new Error(`OpenRouter ${response.status}: ${detail || response.statusText}`);
      await sleep(1000 * attempt);
      continue;
    }
    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content?.trim() ?? "";
    try {
      const parsed = parseJsonObject(text);
      const rawQuestions = Array.isArray(parsed) ? parsed : parsed?.questions;
      const normalized = normalizeGeneratedQuestions(rawQuestions, {
        facultyId: args.config.id,
        fallbackSubject: subjectFromConfig(args.config),
        targets: args.targets,
        existing: args.existing,
        avoidCards: args.avoidCards,
      });
      if (normalized.length >= Math.max(1, Math.floor(args.count * 0.7))) {
        return normalized.slice(0, args.count);
      }
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await sleep(800 * attempt);
  }
  return [];
}

async function writeSnapshot(config, parsed, questions) {
  const snapshotPath = resolve(root, ".tmp", "generated-question-banks", `${config.id}.json`);
  await writeFile(snapshotPath, `${JSON.stringify({ ...parsed, questions }, null, 2)}\n`);
}

function normalizeGeneratedQuestions(value, opts) {
  if (!Array.isArray(value)) return [];
  const seenPrompts = new Set(opts.existing.map((q) => normalizeText(q.prompt)));
  const seenAnswers = new Set(opts.existing.map((q) => normalizeText(q.options?.[q.correct] ?? "")));
  for (const card of opts.avoidCards ?? []) {
    seenAnswers.add(normalizeText(card.back));
  }
  const existingPrompts = [
    ...opts.existing.map((q) => q.prompt),
    ...(opts.avoidCards ?? []).map((card) => card.front),
  ];
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const prompt = cleanGeneratedText(entry.prompt ?? entry.question, 420);
    if (!prompt || seenPrompts.has(normalizeText(prompt))) continue;
    if (tooSimilarToAny(prompt, existingPrompts)) continue;
    const optionSet = generatedQuestionOptions(entry);
    if (!optionSet) continue;
    const correctAnswer = optionSet.options[optionSet.correct];
    if (seenAnswers.has(normalizeText(correctAnswer))) continue;
    const target = opts.targets[out.length] ?? null;
    const subject = normalizeSubject(cleanGeneratedText(entry.subject ?? entry.topic, 80) || opts.fallbackSubject);
    const difficulty = target?.difficulty ?? cleanDifficulty(entry.difficulty ?? entry.level);
    const stat = target?.stat ?? cleanStat(entry.stat ?? entry.trait ?? entry.attribute);
    const explanation = cleanGeneratedText(entry.explanation ?? entry.rationale ?? entry.answer, 800) || correctAnswer;
    out.push({
      id: `${opts.facultyId}-pending`,
      type: "multiple-choice",
      subject,
      difficulty,
      stat,
      prompt,
      options: optionSet.options,
      correct: optionSet.correct,
      explanation,
      faculty: opts.facultyId,
    });
    seenPrompts.add(normalizeText(prompt));
    seenAnswers.add(normalizeText(correctAnswer));
    existingPrompts.push(prompt);
  }
  return out;
}

function generatedQuestionOptions(record) {
  const answer = cleanGeneratedText(record.answer ?? record.correctAnswer, 220);
  const rawOptions = record.options;
  let values = [];
  if (Array.isArray(rawOptions)) {
    values = rawOptions.map((entry) => cleanGeneratedText(entry, 220));
  } else if (rawOptions && typeof rawOptions === "object") {
    values = CHOICES.map((key) => cleanGeneratedText(rawOptions[key], 220));
  }
  if (values.filter(Boolean).length < 4 && answer) {
    const distractors = Array.isArray(record.distractors)
      ? record.distractors.map((entry) => cleanGeneratedText(entry, 220)).filter(Boolean)
      : [];
    values = [answer, ...distractors].slice(0, 4);
  }
  values = values.slice(0, 4);
  if (values.length < 4 || values.some((entry) => !entry)) return null;
  const options = { A: values[0], B: values[1], C: values[2], D: values[3] };
  const correct = cleanChoice(record.correct)
    ?? correctChoiceFromAnswer(options, answer)
    ?? "A";
  return { options, correct };
}

function questionBalanceTargets(existing, count) {
  const difficultyCounts = countBy(DIFFICULTIES, existing.map((item) => item.difficulty));
  const statCounts = countBy(STATS, existing.map((item) => item.stat));
  const pairCounts = new Map();
  for (const item of existing) {
    const key = `${item.difficulty}:${item.stat}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const targets = [];
  for (let i = 0; i < count; i += 1) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const difficulty of DIFFICULTIES) {
      for (const stat of STATS) {
        const key = `${difficulty}:${stat}`;
        const score = (difficultyCounts[difficulty] * 4) + (statCounts[stat] * 3) + (pairCounts.get(key) ?? 0);
        if (score < bestScore) {
          best = { difficulty, stat };
          bestScore = score;
        }
      }
    }
    targets.push(best);
    difficultyCounts[best.difficulty] += 1;
    statCounts[best.stat] += 1;
    const key = `${best.difficulty}:${best.stat}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  return targets;
}

function questionBalancePrompt(targets) {
  if (targets.length === 0) return "";
  return [
    "Balance requirements:",
    "Use these target buckets in order. Each returned question must include the matching difficulty and stat.",
    "Stat meanings: head=facts/concepts/interpretation, heart=people/voice/audience/relationships, hustle=procedures/application/calculation/action, honor=evidence/safety/responsibility/rules.",
    targets.map((target, index) => `${index + 1}. difficulty=${target.difficulty}, stat=${target.stat}`).join("\n"),
  ].join("\n");
}

function questionBalanceStatusPrompt(existing) {
  const difficultyCounts = countBy(DIFFICULTIES, existing.map((item) => item.difficulty));
  const statCounts = countBy(STATS, existing.map((item) => item.stat));
  return [
    `Current teacher balance: ${existing.length} existing cards.`,
    `Difficulty counts: ${DIFFICULTIES.map((difficulty) => `${difficulty}=${difficultyCounts[difficulty]}`).join(", ")}.`,
    `Stat counts: ${STATS.map((stat) => `${stat}=${statCounts[stat]}`).join(", ")}.`,
  ].join("\n");
}

function existingQuestionPrompt(questions) {
  if (questions.length === 0) return "";
  return [
    "Existing question prompts to avoid:",
    ...questions.slice(-18).map((question, index) => `${index + 1}. ${question.prompt}`),
  ].join("\n");
}

function sourceCardAvoidPrompt(cards) {
  if (!cards.length) return "";
  return [
    "Do not simply restate these source-card prompts as generated MC questions:",
    ...cards.slice(0, 90).map((card, index) => `${index + 1}. ${card.front} => ${card.back}`),
  ].join("\n");
}

function parseCorpusCards(raw) {
  const rows = String(raw).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const frontIndex = header.indexOf("front");
  const backIndex = header.indexOf("back");
  if (frontIndex < 0 || backIndex < 0) return [];
  return rows.slice(1)
    .map((row) => ({ front: row[frontIndex], back: row[backIndex] }))
    .filter((card) => card.front && card.back);
}

function tooSimilarToAny(prompt, existingPrompts) {
  const promptTokens = tokenSet(prompt);
  if (promptTokens.size < 4) return false;
  for (const existing of existingPrompts) {
    const existingTokens = tokenSet(existing);
    if (existingTokens.size < 4) continue;
    const score = jaccard(promptTokens, existingTokens);
    if (score >= 0.62) return true;
    const a = normalizeText(prompt);
    const b = normalizeText(existing);
    if (a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((word) => word.length > 2));
}

function jaccard(a, b) {
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function researchLaneFor(config, currentCount) {
  const lanes = config.lanes ?? [config.description];
  const idx = Math.floor(currentCount / Math.max(1, BATCH_SIZE)) % lanes.length;
  return lanes[idx] ?? config.description;
}

function parseJsonObject(text) {
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const candidates = [cleaned];
  const objectStart = cleaned.indexOf("{");
  const arrayStart = cleaned.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start >= 0) {
    const end = cleaned.lastIndexOf(cleaned[start] === "{" ? "}" : "]");
    if (end > start) candidates.push(cleaned.slice(start, end + 1));
  }
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Generator returned invalid JSON: ${cleaned.slice(0, 400)}`);
}

function cleanGeneratedText(value, max) {
  return String(typeof value === "string" ? value : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanDifficulty(value) {
  const raw = cleanGeneratedText(value, 20).toLowerCase();
  return DIFFICULTIES.includes(raw) ? raw : "medium";
}

function cleanStat(value) {
  const raw = cleanGeneratedText(value, 20).toLowerCase();
  return STATS.includes(raw) ? raw : "head";
}

function cleanChoice(value) {
  const raw = cleanGeneratedText(value, 4).toUpperCase();
  return CHOICES.includes(raw) ? raw : null;
}

function correctChoiceFromAnswer(options, answer) {
  const normalized = normalizeText(answer);
  if (!normalized) return null;
  return CHOICES.find((choice) => normalizeText(options[choice]) === normalized) ?? null;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countBy(keys, values) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) {
    if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value] += 1;
  }
  return counts;
}

function subjectFromConfig(config) {
  if (config.id === "ruby") return "ai-literacy";
  if (config.id === "sally-science") return "physics";
  return "literature";
}

function normalizeSubject(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const aliases = {
    agents: "agent-culture",
    "agent-culture": "agent-culture",
    "ai": "ai-literacy",
    "ai-literacy": "ai-literacy",
    "general-computing": "general-knowledge",
    "general-knowledge": "general-knowledge",
    "scientific-method": "scientific-method",
    "earth": "earth-science",
    "earth-science": "earth-science",
    "literary-theory": "literary-theory",
    theory: "literary-theory",
    narration: "literature",
    "literary-narration": "literature",
    "mid-century": "mid-century",
    midcentury: "mid-century",
  };
  return aliases[slug] ?? slug ?? "open-study";
}

function nextGeneratedNumber(prefix, questions) {
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const question of questions) {
    const match = re.exec(question.id ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function providerAuthHeaders() {
  if (PROVIDER === "local") {
    return {
      Authorization: `Bearer ${process.env.RUBY_HIGH_LLM_API_KEY ?? "local"}`,
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": process.env.RUBY_HIGH_OPENROUTER_REFERER ?? "https://ruby-high.local",
    "X-OpenRouter-Title": "Ruby High Built-in Question Generator",
    "X-Title": "Ruby High Built-in Question Generator",
  };
}

function normalizeChatCompletionsUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function argValue(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

function loadDotEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  const text = awaitableReadEnv(envPath);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function awaitableReadEnv(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
