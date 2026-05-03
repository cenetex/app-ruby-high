import { describe, expect, it } from "vitest";
import { AuthService } from "../services/auth-service.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function freshAuth(): Promise<AuthService> {
  const svc = await AuthService.start({} as never);
  return svc;
}

describe("AuthService.gcSessions", () => {
  it("drops sessions older than the TTL", async () => {
    const auth = await freshAuth();
    // Use real Date.now() because resolve() reads it directly — a "fresh"
    // session in fake-time would still be ancient in real-time and resolve
    // would TTL-reject it.
    const now = Date.now();
    auth.injectSessionForTest("expired-1", { createdAt: now - SESSION_TTL_MS - 1000 });
    auth.injectSessionForTest("expired-2", { createdAt: now - SESSION_TTL_MS - 999_999 });
    auth.injectSessionForTest("fresh", { createdAt: now - 1000 });
    expect(auth.sessionCount()).toBe(3);
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(2);
    expect(result.remaining).toBe(1);
    expect(auth.sessionCount()).toBe(1);
    // Fresh session still resolvable.
    expect(auth.resolve("fresh")).not.toBeNull();
    // Expired ones are gone.
    expect(auth.resolve("expired-1")).toBeNull();
    await auth.stop();
  });

  it("is a no-op when nothing is expired", async () => {
    const auth = await freshAuth();
    const now = 2_000_000_000_000;
    auth.injectSessionForTest("a", { createdAt: now });
    auth.injectSessionForTest("b", { createdAt: now - 1000 });
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(0);
    expect(result.remaining).toBe(2);
    expect(auth.sessionCount()).toBe(2);
    await auth.stop();
  });

  it("preserves sessions exactly at the TTL boundary (drops only past it)", async () => {
    const auth = await freshAuth();
    // The gc strict-greater check (`> SESSION_TTL_MS`) keeps the boundary
    // record. Test the count via gcSessions only — resolve() uses Date.now()
    // separately and would walk past the boundary by the time we called it.
    const now = 5_000_000_000_000;
    auth.injectSessionForTest("at-boundary", { createdAt: now - SESSION_TTL_MS });
    auth.injectSessionForTest("just-past", { createdAt: now - SESSION_TTL_MS - 1 });
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(1);
    expect(auth.sessionCount()).toBe(1);
    await auth.stop();
  });

  it("stop() clears the gc timer (no leaked handles)", async () => {
    const auth = await freshAuth();
    auth.injectSessionForTest("a", { createdAt: Date.now() });
    await auth.stop();
    expect(auth.sessionCount()).toBe(0);
    // Calling stop() again is a no-op — must not throw.
    await auth.stop();
  });

  it("resolve() still TTL-checks alongside the GC (defense in depth)", async () => {
    const auth = await freshAuth();
    // GC sweeps periodically, but a session can age past TTL between sweeps.
    // resolve() must still reject it independently — proven by injecting a
    // record dated past TTL relative to real time and never calling gcSessions.
    auth.injectSessionForTest("aging", { createdAt: Date.now() - SESSION_TTL_MS - 1000 });
    expect(auth.resolve("aging")).toBeNull();
    await auth.stop();
  });
});
