export const DEFAULT_STATE_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function stateRetentionSeconds(raw = process.env.RUBY_HIGH_STATE_TTL_SECONDS): number {
  if (raw == null || raw.trim() === "") return DEFAULT_STATE_RETENTION_SECONDS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_STATE_RETENTION_SECONDS;
}
