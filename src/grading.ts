/**
 * Pure parser for the teacher's grading-turn output.
 *
 * The teacher LLM is asked to return per-responder grades in a strict line
 * format, plus a separate "BEST: <id>" line, plus 2-3 narrative sentences.
 * Anything that looks like a GRADE or BEST line is consumed; everything else
 * is preserved as narrativeText. That gives us a parser that's:
 *
 *   - resilient to model deviation (extra prose, blank lines, headers)
 *   - case-insensitive on the keywords
 *   - clamping (score is clamped to [0, 10])
 *   - lossless for the narrative half (the teacher response stays intact)
 *
 * It's a pure function with no I/O, so it's exhaustively testable without
 * touching OpenRouter.
 */

export interface ParsedGrade {
  responder: string;
  /** Clamped to [0, 10]. */
  score: number;
  comment: string;
}

export interface ParsedTeacherGrades {
  grades: ParsedGrade[];
  bestResponder: string | null;
  /** Lines that weren't a GRADE/BEST directive, joined with newlines and
   *  trimmed. This is the human-readable response the viewer renders as
   *  the teacher's "delta" stream. */
  narrativeText: string;
}

const OFFLINE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "for",
  "from", "had", "has", "have", "he", "her", "hers", "him", "his", "i",
  "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "ours",
  "she", "so", "that", "the", "their", "theirs", "them", "they", "this",
  "to", "us", "was", "we", "were", "what", "which", "who", "will", "with",
  "you", "your", "yours",
]);

function offlineWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)?/g) ?? [])
    .map((word) => word.replace("’", "'"));
}

/**
 * Content-first fallback score for an opinion response when the teacher LLM
 * is unavailable. This intentionally rewards relevance, reasoning, and a
 * concrete verification step; character dice may nudge this score elsewhere,
 * but never replace it.
 */
export function offlineOpinionContentScore(input: {
  question: string;
  rubric?: string;
  response: string;
}): number {
  const words = offlineWords(input.response);
  const meaningful = words.filter((word) => !OFFLINE_STOP_WORDS.has(word));
  if (words.length < 4 || meaningful.length < 2) return 3;
  if (/\b(?:i\s+do(?:n't| not)\s+know|no\s+idea|idk)\b/i.test(input.response)) return 3;

  const uniqueMeaningful = new Set(meaningful);
  const promptKeywords = new Set(
    offlineWords(`${input.question} ${input.rubric ?? ""}`)
      .filter((word) => !OFFLINE_STOP_WORDS.has(word)),
  );
  const overlap = [...uniqueMeaningful].filter((word) => promptKeywords.has(word)).length;
  const hasReasoning = /\b(?:because|before|evidence|if|reason|since|so|therefore|when|why|would)\b/i.test(input.response);
  const hasVerificationStep = /\b(?:ask|check|compare|confirm|question|source|test|verify)\b/i.test(input.response);

  let score = 4.5;
  if (words.length >= 8) score += 0.75;
  if (words.length >= 15) score += 0.75;
  if (words.length >= 25) score += 0.5;
  if (meaningful.length >= 4) score += 0.5;
  if (uniqueMeaningful.size / meaningful.length >= 0.65) score += 0.5;
  if (hasReasoning) score += 0.75;
  if (hasVerificationStep) score += 0.5;
  if (overlap >= 2) score += 0.75;
  if (overlap >= 4) score += 0.5;
  if (/[.!?].+[.!?]/s.test(input.response.trim())) score += 0.25;

  // Length alone must not pass an unrelated or unsupported response.
  if (!hasReasoning && !hasVerificationStep && overlap < 2) score = Math.min(score, 6.5);
  return Math.min(9, Math.max(0, Math.round(score * 2) / 2));
}

// Accepts negative scores so the clamp can ground them at 0 — better than
// silently letting a "-3" line fall through as narrative.
const GRADE_LINE = /^\s*GRADE\s+responder=([\w-]+)\s+score=(-?\d+(?:\.\d+)?)\s+comment=(.+?)\s*$/i;
const BEST_LINE = /^\s*BEST:\s*([\w-]+)\s*$/i;

/** Parse the teacher's grading-turn raw text. Order of grade lines is
 *  preserved; if the teacher emits the same responder twice, both entries
 *  land in `grades` and the caller decides what to do. */
export function parseTeacherGrades(text: string): ParsedTeacherGrades {
  if (typeof text !== "string" || text.length === 0) {
    return { grades: [], bestResponder: null, narrativeText: "" };
  }
  const grades: ParsedGrade[] = [];
  let bestResponder: string | null = null;
  const narrativeLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const gm = line.match(GRADE_LINE);
    if (gm) {
      const score = parseFloat(gm[2] ?? "0");
      grades.push({
        responder: gm[1] ?? "",
        score: clampScore(score),
        comment: (gm[3] ?? "").trim(),
      });
      continue;
    }
    const bm = line.match(BEST_LINE);
    if (bm) {
      // First BEST: line wins. Subsequent ones are dropped on the floor —
      // we don't want to silently overwrite the teacher's first BEST line.
      if (bestResponder == null) bestResponder = bm[1] ?? null;
      continue;
    }
    narrativeLines.push(line);
  }
  return {
    grades,
    bestResponder,
    narrativeText: narrativeLines.join("\n").trim(),
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return n;
}
/** Generic-praise patterns that should never appear in a teacher response.
 *  A response containing any of these is a regression: the teacher is
 *  handing out participation credit instead of offering a real standard. */
const GENERIC_PRAISE_PATTERNS = [
  /\bgood job\b/i,
  /\bnice (try|effort|work|one)\b/i,
  /\bgreat (job|work|effort|answer)\b/i,
  /\bwell done\b/i,
  /\bkeep (it )?up\b/i,
  /\bgood (effort|thinking|point|start)\b/i,
  /\bexcellent (job|work|answer)\b/i,
  /\bamazing (job|work|answer)\b/i,
  /\bkeep up the good work\b/i,
  /\bproud of you\b/i,
];

/** Check every comment and the narrative text for generic praise. Returns
 *  the first matched pattern or null if the response has real substance. */
export function detectGenericPraise(response: ParsedTeacherGrades): string | null {
  const texts = [
    response.narrativeText,
    ...response.grades.map((g) => g.comment),
  ];
  for (const text of texts) {
    for (const pattern of GENERIC_PRAISE_PATTERNS) {
      if (pattern.test(text)) return pattern.source;
    }
  }
  return null;
}

/** Lazy-signal patterns that suggest the teacher is generating generic
 *  commentary without actually reading the student's response. A response
 *  where EVERY grade comment hits one of these is likely a hallucinated
 *  grade — it doesn't reference anything specific to what the student wrote. */
const VAGUE_COMMENT_PATTERNS = [
  /^you (made|raised|brought up|offered|presented|shared|gave) (a |an |some )?(good |solid |strong |interesting |compelling |nice |fair )?(point|argument|take|idea|perspective|response|answer|thought)/i,
  /^you (clearly |obviously |really )?(understood|understand|get|grasped) the (question|prompt|topic|material|concept)/i,
  /^you (could|should|need to|must) (have )?(gone|go|dive|dig|push|think) (deeper|further|more)/i,
  /^you (tried|attempted)/i,
  /^(solid|strong|decent|fair|ok|okay|fine|good) (start|effort|attempt|try|response|answer|take)/i,
  /^(needs|needed|lacks|lacked) (more |some )?(depth|detail|specificity|development|support|evidence|examples)/i,
  /^you (articulated|expressed|communicated|conveyed) (your|the) (point|idea|thought|argument)/i,
  /^you (could|should|might) (have )?(benefit|benefited) from/i,
  /^I (would have|wanted to|expected to) (see|hear)/i,
];

/** Check whether every grade comment is vague — none reference anything specific
 *  to the student's actual response. Returns true if the teacher response has
 *  real substance (at least one comment is specific). Returns false if all comments
 *  could apply to any response. */
export function teacherResponseHasSubstance(response: ParsedTeacherGrades): boolean {
  if (response.grades.length === 0) return false;
  return response.grades.some((g) => {
    const comment = g.comment;
    if (!comment || comment.length < 15) return false;
    return !VAGUE_COMMENT_PATTERNS.some((p) => p.test(comment));
  });
}

/** Returns all grade comments that are too vague to be meaningful. */
export function vagueComments(response: ParsedTeacherGrades): string[] {
  return response.grades
    .filter((g) => {
      if (!g.comment || g.comment.length < 15) return true;
      return VAGUE_COMMENT_PATTERNS.some((p) => p.test(g.comment));
    })
    .map((g) => g.comment);
}
