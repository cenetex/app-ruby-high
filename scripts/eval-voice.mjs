#!/usr/bin/env node
/**
 * Lightweight faculty-voice evaluation harness.
 *
 * Without RUBY_HIGH_OPENROUTER_API_KEY this runs the static reference checks
 * and exits 0. Set RUBY_HIGH_EVAL_REQUIRE_API=1 in CI if the LLM-judge pass
 * should be mandatory.
 */

import { TEACHERS } from "../dist/index.js";

const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY?.trim() || "";
const requireApi = process.env.RUBY_HIGH_EVAL_REQUIRE_API === "1";
const judgeModel = process.env.RUBY_HIGH_EVAL_MODEL || "openai/gpt-4.1-mini";
const referer = process.env.RUBY_HIGH_OPENROUTER_REFERER || "https://ruby-high.local";
const title = process.env.RUBY_HIGH_OPENROUTER_TITLE || "Ruby High Voice Eval";
const teachers = Object.values(TEACHERS);

const references = [
  {
    teacherId: "ruby",
    prompt: "A new student got the answer wrong and wants to quit.",
    expected: "Warm, quick, practical, a little mischievous, never syrupy.",
    candidate: "Wrong answer, right corridor. Take the next swing before the bell notices.",
  },
  {
    teacherId: "ruby",
    prompt: "The room needs a first question.",
    expected: "Brief homeroom energy; invites action without explaining UI.",
    candidate: "Pencils up. I found us a question with just enough teeth.",
  },
  {
    teacherId: "sally-science",
    prompt: "A student confused correlation with causation.",
    expected: "Sharp graduate-TA science voice, concrete correction, no fluff.",
    candidate: "Correlation is the smoke alarm, not the fire report. Find the mechanism before you make the claim.",
  },
  {
    teacherId: "sally-science",
    prompt: "A student guessed correctly without reasoning.",
    expected: "Approves evidence and method more than luck.",
    candidate: "Correct, but do not frame luck as a lab technique. Show me the evidence chain.",
  },
  {
    teacherId: "professor-edward",
    prompt: "A student made a shallow claim about a poem.",
    expected: "Dry, careful, literary, takes the student seriously.",
    candidate: "A serviceable claim, but it is still standing in the doorway. Let the image do some actual work.",
  },
  {
    teacherId: "professor-edward",
    prompt: "A student wrote a strong short response.",
    expected: "Mid-century literary professor, restrained praise, precise judgment.",
    candidate: "Good. You resisted summary and let the sentence carry an argument.",
  },
];

const teacherIds = new Set(teachers.map((teacher) => teacher.id));
const missing = references.filter((ref) => !teacherIds.has(ref.teacherId));
if (missing.length > 0) {
  console.error("Voice eval references missing teachers:", missing.map((ref) => ref.teacherId).join(", "));
  process.exit(1);
}

if (!apiKey) {
  const message = `voice eval static references ok (${references.length}); set RUBY_HIGH_OPENROUTER_API_KEY for LLM judge`;
  if (requireApi) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

let failed = 0;
for (const ref of references) {
  const teacher = teachers.find((entry) => entry.id === ref.teacherId);
  const result = await judgeReference({ teacher, ref });
  const pass = result.pass && result.score >= 4;
  console.log(`${pass ? "PASS" : "FAIL"} ${ref.teacherId}: ${result.score}/5 - ${result.reason}`);
  if (!pass) failed += 1;
}

if (failed > 0) process.exit(1);

async function judgeReference({ teacher, ref }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": referer,
      "X-OpenRouter-Title": title,
      "X-Title": title,
    },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        {
          role: "system",
          content: "You judge whether a short teacher line matches a Ruby High faculty voice. Return only JSON.",
        },
        {
          role: "user",
          content: [
            `Teacher: ${teacher.displayName}`,
            `Teacher system prompt: ${teacher.systemPrompt}`,
            `Situation: ${ref.prompt}`,
            `Expected voice: ${ref.expected}`,
            `Candidate line: ${ref.candidate}`,
            'Return {"score":1-5,"pass":true|false,"reason":"short reason"}.',
          ].join("\n"),
        },
      ],
      temperature: 0,
      max_tokens: 180,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`voice judge ${response.status}: ${text || response.statusText}`);
  }
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content?.trim() || "{}";
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, ""));
  return {
    score: Math.max(1, Math.min(5, Number(parsed.score) || 1)),
    pass: !!parsed.pass,
    reason: String(parsed.reason || "no reason").slice(0, 160),
  };
}
