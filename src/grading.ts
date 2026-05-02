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
 *   - lossless for the narrative half (the teacher's verdict stays intact)
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
   *  trimmed. This is the human-readable verdict the viewer renders as
   *  the teacher's "delta" stream. */
  narrativeText: string;
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
      // we don't want to silently overwrite the teacher's first verdict.
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
