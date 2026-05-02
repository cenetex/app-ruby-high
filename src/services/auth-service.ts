import { createHash, randomBytes } from "node:crypto";
import { Service, type IAgentRuntime } from "@elizaos/core";

export interface AuthRecord {
  apiKey: string;
  createdAt: number;
  /** OpenRouter username if returned. */
  label?: string;
}

interface PendingPkce {
  verifier: string;
  createdAt: number;
  callbackUrl: string;
}

const SESSION_COOKIE = "rh_session";
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * OpenRouter PKCE auth + opaque cookie sessions.
 *
 * Flow:
 *  1. Client GET /auth/start. Server mints state + PKCE pair, sets a short-lived
 *     pending cookie, redirects to https://openrouter.ai/auth?... .
 *  2. OpenRouter redirects back to /auth/callback?code=... .
 *  3. Server POSTs to https://openrouter.ai/api/v1/auth/keys with the code +
 *     code_verifier, gets an API key, mints a session cookie, drops the pending
 *     cookie, redirects back to the viewer.
 *  4. /chat reads the session cookie, looks up the API key, proxies to OpenRouter.
 *
 * Keys live in memory only — restart wipes them. Phase 2 can promote to a real
 * encrypted store if needed.
 */
export class AuthService extends Service {
  static override readonly serviceType = "ruby-high-auth";
  override readonly capabilityDescription =
    "OpenRouter PKCE OAuth + cookie-based session storage for Ruby High chat.";

  private readonly sessions = new Map<string, AuthRecord>();
  private readonly pending = new Map<string, PendingPkce>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  static async start(runtime: IAgentRuntime): Promise<AuthService> {
    const svc = new AuthService(runtime);
    // Sweep expired sessions hourly. Read-side TTL checks only catch sessions
    // that get touched again — without this, a user who never returns leaves
    // an entry in the map until process restart.
    svc.gcTimer = setInterval(() => svc.gcSessions(), 60 * 60 * 1000);
    // Don't keep the event loop alive just for this timer.
    if (svc.gcTimer && typeof (svc.gcTimer as { unref?: () => void }).unref === "function") {
      (svc.gcTimer as { unref: () => void }).unref();
    }
    return svc;
  }

  async stop(): Promise<void> {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    this.sessions.clear();
    this.pending.clear();
  }

  /** Drop sessions past their TTL. Called periodically by the timer above and
   *  exposed publicly so tests can drive it deterministically. */
  gcSessions(now: number = Date.now()): { dropped: number; remaining: number } {
    let dropped = 0;
    for (const [k, v] of this.sessions) {
      if (now - v.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(k);
        dropped++;
      }
    }
    return { dropped, remaining: this.sessions.size };
  }

  /** Test hook: how many sessions are currently tracked. */
  sessionCount(): number {
    return this.sessions.size;
  }

  /** Test hook: inject a session record so tests don't have to mock the full
   *  PKCE flow. Production code should use completePkce. */
  injectSessionForTest(token: string, record: AuthRecord): void {
    this.sessions.set(token, record);
  }

  startPkce(callbackUrl: string): { state: string; redirectUrl: string } {
    this.gcPending();
    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    this.pending.set(state, { verifier, callbackUrl, createdAt: Date.now() });

    const u = new URL("https://openrouter.ai/auth");
    u.searchParams.set("callback_url", callbackUrl);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("state", state);
    return { state, redirectUrl: u.toString() };
  }

  async completePkce(state: string, code: string): Promise<{ token: string; record: AuthRecord }> {
    const pending = this.pending.get(state);
    if (!pending) throw new Error("Unknown or expired auth state");
    this.pending.delete(state);
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new Error("Auth state expired");
    }
    const apiKey = await exchangeCodeForKey(code, pending.verifier);
    const token = base64url(randomBytes(24));
    const record: AuthRecord = { apiKey, createdAt: Date.now() };
    this.sessions.set(token, record);
    return { token, record };
  }

  /** Read cookie value from a raw Cookie header. */
  parseSessionToken(cookieHeader: string | undefined | null): string | null {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(/;\s*/);
    for (const p of parts) {
      const i = p.indexOf("=");
      if (i < 0) continue;
      if (p.slice(0, i) === SESSION_COOKIE) return decodeURIComponent(p.slice(i + 1));
    }
    return null;
  }

  resolve(token: string | null): AuthRecord | null {
    if (!token) return null;
    const r = this.sessions.get(token);
    if (!r) return null;
    if (Date.now() - r.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(token);
      return null;
    }
    return r;
  }

  destroy(token: string | null): boolean {
    if (!token) return false;
    return this.sessions.delete(token);
  }

  buildSessionCookie(token: string, opts: { secure: boolean }): string {
    const parts = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (opts.secure) parts.push("Secure");
    return parts.join("; ");
  }

  buildClearCookie(opts: { secure: boolean }): string {
    const parts = [
      `${SESSION_COOKIE}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (opts.secure) parts.push("Secure");
    return parts.join("; ");
  }

  private gcPending(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
    }
  }
}

async function exchangeCodeForKey(code: string, codeVerifier: string): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: "S256" }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`OpenRouter token exchange failed (${r.status}): ${text || r.statusText}`);
  }
  const body = (await r.json()) as { key?: string; user_id?: string };
  if (!body.key) throw new Error("OpenRouter response missing 'key'");
  return body.key;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
