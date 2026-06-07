import { findModel, isKnownModel } from "./model-catalog.js";

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-4-5";
export const DEFAULT_STUDENT_MODEL = "google/gemini-3.5-flash";
export const DEFAULT_CREATOR_MODEL = DEFAULT_OPENROUTER_MODEL;
export const DEFAULT_COURSE_MODEL = "qwen/qwen3.7-max";

/** Fallback models used when the preferred default is not in the catalog. */
const FALLBACK_OPENROUTER_MODEL = "google/gemma-4-31b-it:free";
const FALLBACK_STUDENT_MODEL = "google/gemma-4-26b-a4b-it:free";
const FALLBACK_COURSE_MODEL = "google/gemma-4-31b-it:free";

/** Resolve a model id, falling back if the preferred one isn't in the
 *  catalog. Always returns a known model id or the universal fallback. */
export function resolveModelDefault(
  preferred: string,
  fallback: string,
): string {
  if (isKnownModel(preferred)) return preferred;
  if (isKnownModel(fallback)) return fallback;
  return FALLBACK_OPENROUTER_MODEL;
}

/** Look up a model entry — useful for checking pricing / context / moderation
 *  before sending a request. */
export function lookupModel(id: string) {
  return findModel(id);
}
