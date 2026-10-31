import type { QuizState } from "../types.js";

/** Explicit marking handles all new smoke runs. The narrow character
 * fingerprints remove the historical scheduled-smoke rows that predate the
 * marker without sweeping up ordinary players. */
export function isSyntheticQuizState(state: QuizState | undefined): boolean {
  if (!state) return false;
  if (state.synthetic === true) return true;
  const name = String(state.character?.name ?? "");
  const personality = String(state.character?.personality ?? "").toLowerCase();
  const flavorQuote = String(state.character?.flavorQuote ?? "").toLowerCase();
  return (
    name.startsWith("Smoke ")
    && personality.includes("synthetic smoke-test")
    && flavorQuote === "smoke test"
  ) || (
    name.startsWith("Pacing ")
    && personality.includes("synthetic pacing smoke-test")
    && flavorQuote === "pacing smoke"
  );
}

/** Auth users, auth sessions, and metric events from smoke clients carry
 *  clientSurface "smoke". */
export function isSmokeSurfaceRecord(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { clientSurface?: unknown }).clientSurface === "smoke";
}

/** SQL twin of isSyntheticQuizState over a kv `data` column. */
export const SYNTHETIC_SESSION_SQL = `(
  json_extract(data, '$.synthetic') = 1
  OR (
    substr(json_extract(data, '$.character.name'), 1, 6) = 'Smoke '
    AND instr(lower(json_extract(data, '$.character.personality')), 'synthetic smoke-test') > 0
    AND lower(json_extract(data, '$.character.flavorQuote')) = 'smoke test'
  )
  OR (
    substr(json_extract(data, '$.character.name'), 1, 7) = 'Pacing '
    AND instr(lower(json_extract(data, '$.character.personality')), 'synthetic pacing smoke-test') > 0
    AND lower(json_extract(data, '$.character.flavorQuote')) = 'pacing smoke'
  )
)`;
