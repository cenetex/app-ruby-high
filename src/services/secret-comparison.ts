import { createHash, timingSafeEqual } from "node:crypto";

/** Compare high-value bearer/admin secrets without leaking a useful prefix or length signal. */
export function constantTimeSecretEqual(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
