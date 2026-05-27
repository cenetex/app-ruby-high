export const CANONICAL_PUBLIC_ORIGIN = "https://ruby-high.ai";

const DEAD_PUBLIC_HOSTS = new Set([
  "rubyhighai.com",
  "www.rubyhighai.com",
]);

export function normalizePublicOrigin(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  try {
    const url = new URL(value);
    if (DEAD_PUBLIC_HOSTS.has(url.hostname.toLowerCase())) {
      return CANONICAL_PUBLIC_ORIGIN;
    }
    return url.origin;
  } catch {
    return null;
  }
}
