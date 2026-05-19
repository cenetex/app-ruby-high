import { createHash, randomBytes } from "node:crypto";
import { Service, type IAgentRuntime } from "@elizaos/core";
import { log } from "./logger.js";
import {
  authUserKey,
  getDefaultStateStore,
  type AuthUserRecord,
  type StateStoreLike,
} from "./state-store.js";

/** What we keep server-side per session. The OpenRouter API key is NOT
 *  stored here — it's handed back to the browser at PKCE completion and
 *  lives only in client-side localStorage. The session record exists so we
 *  can still issue a stable cookie identity for QuizState routing without
 *  putting a credential in server memory. */
export interface AuthRecord {
  userId: string;
  createdAt: number;
  expiresAt: number;
  provider?: AuthUserRecord["provider"];
  /** OpenRouter username if returned by the token exchange. Cosmetic. */
  label?: string;
  walletAddress?: string;
  walletChainType?: "ethereum" | "solana";
}

export interface AuthAnalyticsSnapshot {
  users: number;
  activeSessions: number;
  pendingAuth: number;
  providers: Record<AuthUserRecord["provider"], number>;
  createdLast24h: number;
  signedInLast24h: number;
  returningUsers: number;
  d1Retention: {
    eligibleUsers: number;
    returnedUsers: number;
    rate: number | null;
  };
  daily: AuthAnalyticsDay[];
}

export interface AuthAnalyticsDay {
  date: string;
  newUsers: number;
  signedInUsers: number;
  sessionStarts: number;
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
 *  4. The callback handler returns a small HTML page that writes the API
 *     key into the browser's localStorage and (where possible) closes the
 *     OAuth tab. The original SPA picks up the key from localStorage and
 *     attaches it to every LLM request as an `X-Openrouter-Key` header.
 *
 * The server never persists the API key. It stores only a random Ruby High
 * user id, a hash of the OpenRouter identity, and opaque session tokens that
 * point at that user id. That is enough to route QuizState back to the same
 * character across restarts without holding provider credentials or raw
 * provider identifiers.
 */
export class AuthService extends Service {
  static override readonly serviceType = "ruby-high-auth";
  override readonly capabilityDescription =
    "OpenRouter PKCE OAuth + cookie-based session storage for Ruby High chat.";

  private readonly sessions = new Map<string, AuthRecord>();
  private readonly usersByProviderHash = new Map<string, AuthUserRecord>();
  private readonly usersById = new Map<string, AuthUserRecord>();
  private readonly store: StateStoreLike;
  private readonly pending = new Map<string, PendingPkce>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? getDefaultStateStore();
  }

  static async start(runtime: IAgentRuntime, store?: StateStoreLike): Promise<AuthService> {
    const svc = new AuthService(runtime, store);
    await svc.hydrateAuth();
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
    this.usersByProviderHash.clear();
    this.usersById.clear();
    this.pending.clear();
  }

  /** Drop sessions past their TTL. Called periodically by the timer above and
   *  exposed publicly so tests can drive it deterministically. */
  gcSessions(now: number = Date.now()): { dropped: number; remaining: number } {
    let dropped = 0;
    for (const [k, v] of this.sessions) {
      if (this.isExpired(v, now)) {
        this.sessions.delete(k);
        void this.store.deleteAuthSession(k).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[ruby-high] auth session cleanup failed:", err);
        });
        log.event("session.ended", {
          userId: v.userId,
          reason: "ttl-expired",
          ageMs: now - v.createdAt,
        });
        dropped++;
      }
    }
    return { dropped, remaining: this.sessions.size };
  }

  /** Test hook: how many sessions are currently tracked. */
  sessionCount(): number {
    return this.sessions.size;
  }

  analyticsSnapshot(now: number = Date.now()): AuthAnalyticsSnapshot {
    const dayMs = 24 * 60 * 60 * 1000;
    const { days, byDate } = buildAuthDailyBuckets(now, 14);
    const users = Array.from(this.usersById.values());
    const providers: Record<AuthUserRecord["provider"], number> = {
      guest: 0,
      openrouter: 0,
      privy: 0,
    };
    let createdLast24h = 0;
    let signedInLast24h = 0;
    let returningUsers = 0;
    let eligibleUsers = 0;
    let returnedUsers = 0;
    for (const user of users) {
      providers[user.provider] += 1;
      if (now - user.createdAt <= dayMs) createdLast24h += 1;
      if (now - user.lastLoginAt <= dayMs) signedInLast24h += 1;
      incrementAuthDay(byDate, user.createdAt, "newUsers");
      incrementAuthDay(byDate, user.lastLoginAt, "signedInUsers");
      if (user.lastLoginAt > user.createdAt) returningUsers += 1;
      if (now - user.createdAt >= dayMs) {
        eligibleUsers += 1;
        if (user.lastLoginAt - user.createdAt >= dayMs) returnedUsers += 1;
      }
    }
    for (const session of this.sessions.values()) {
      incrementAuthDay(byDate, session.createdAt, "sessionStarts");
    }
    return {
      users: users.length,
      activeSessions: this.sessions.size,
      pendingAuth: this.pending.size,
      providers,
      createdLast24h,
      signedInLast24h,
      returningUsers,
      d1Retention: {
        eligibleUsers,
        returnedUsers,
        rate: eligibleUsers > 0 ? returnedUsers / eligibleUsers : null,
      },
      daily: days,
    };
  }

  /** Test hook: inject a session record so tests don't have to mock the full
   *  PKCE flow. Production code should use completePkce. */
  injectSessionForTest(token: string, record: AuthRecord): void {
    this.sessions.set(token, record);
  }

  /** Mint an app-owned Ruby High session without a provider login. This is the
   *  default play path: it gives the browser a durable character bucket while
   *  leaving OpenRouter as an optional AI/chat upgrade. */
  async createGuestSession(existingToken?: string | null): Promise<{ token: string; record: AuthRecord }> {
    const existing = this.resolve(existingToken ?? null);
    if (existing) {
      return { token: existingToken!, record: existing };
    }

    const now = Date.now();
    const providerUserHash = providerIdentityHash(base64url(randomBytes(24)), "guest");
    const user: AuthUserRecord = {
      userId: `usr_${base64url(randomBytes(18))}`,
      provider: "guest",
      providerUserHash,
      createdAt: now,
      lastLoginAt: now,
      label: "Guest",
    };
    this.rememberAuthUser(user);
    await this.store.saveAuthUser(user);

    const token = base64url(randomBytes(24));
    const record: AuthRecord = {
      userId: user.userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      provider: user.provider,
      label: user.label,
    };
    this.sessions.set(token, record);
    await this.store.saveAuthSession({
      token,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    log.event("auth.guest-session-created", { userId: user.userId });
    return { token, record };
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

  /** Complete the PKCE handshake. Returns the fresh API key (to hand back
   *  to the browser) along with a session token (for the cookie). The key
   *  is NOT retained server-side — once this method returns, AuthService
   *  has forgotten it. */
  async completePkce(state: string, code: string, existingToken?: string | null): Promise<{ token: string; record: AuthRecord; apiKey: string }> {
    const pending = this.pending.get(state);
    if (!pending) throw new Error("Unknown or expired auth state");
    this.pending.delete(state);
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new Error("Auth state expired");
    }
    const exchanged = await exchangeCodeForKey(code, pending.verifier);
    const apiKey = exchanged.key;
    const now = Date.now();
    const providerUserHash = providerIdentityHash(exchanged.userId ?? apiKey, exchanged.userId ? "user" : "key");
    const providerKey = authUserKey("openrouter", providerUserHash);
    const existing = this.usersByProviderHash.get(providerKey);
    const existingSession = this.resolve(existingToken ?? null);
    const sessionUser = existingSession ? this.usersById.get(existingSession.userId) : undefined;
    const user: AuthUserRecord = existing
      ? { ...existing, lastLoginAt: now }
      : {
          userId: sessionUser?.userId ?? `usr_${base64url(randomBytes(18))}`,
          provider: "openrouter",
          providerUserHash,
          createdAt: sessionUser?.createdAt ?? now,
          lastLoginAt: now,
          ...(sessionUser?.label && sessionUser.label !== "Guest" ? { label: sessionUser.label } : {}),
        };
    this.rememberAuthUser(user);
    await this.store.saveAuthUser(user);

    const token = base64url(randomBytes(24));
    const record = this.recordForUser(user, now);
    this.sessions.set(token, record);
    await this.store.saveAuthSession({
      token,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    log.event("auth.signed-in", {
      userId: user.userId,
      provider: user.provider,
      isReturning: !!existing,
    });
    return { token, record, apiKey };
  }

  /** Complete a server-verified Privy login by minting a Ruby High session
   *  for the verified Privy user. If the browser already had a guest session,
   *  keep the same Ruby High user id so the character bucket does not move. */
  async completePrivyLogin(
    identity: {
      privyUserId: string;
      label?: string;
      walletAddress?: string;
      walletChainType?: "ethereum" | "solana";
    },
    existingToken?: string | null,
  ): Promise<{ token: string; record: AuthRecord; isReturning: boolean }> {
    const now = Date.now();
    const providerUserHash = providerIdentityHash(identity.privyUserId, "privy");
    const providerKey = authUserKey("privy", providerUserHash);
    const existing = this.usersByProviderHash.get(providerKey);
    const existingSession = this.resolve(existingToken ?? null);
    const sessionUser = existingSession ? this.usersById.get(existingSession.userId) : undefined;
    const label = identity.label || sessionUser?.label || existing?.label || "Privy";
    const user: AuthUserRecord = existing
      ? {
          ...existing,
          lastLoginAt: now,
          label,
          ...(identity.walletAddress ? { walletAddress: identity.walletAddress } : {}),
          ...(identity.walletChainType ? { walletChainType: identity.walletChainType } : {}),
        }
      : {
          userId: sessionUser?.userId ?? `usr_${base64url(randomBytes(18))}`,
          provider: "privy",
          providerUserHash,
          createdAt: sessionUser?.createdAt ?? now,
          lastLoginAt: now,
          label,
          ...(identity.walletAddress ? { walletAddress: identity.walletAddress } : {}),
          ...(identity.walletChainType ? { walletChainType: identity.walletChainType } : {}),
        };
    this.rememberAuthUser(user);
    await this.store.saveAuthUser(user);

    const token = base64url(randomBytes(24));
    const record = this.recordForUser(user, now);
    this.sessions.set(token, record);
    await this.store.saveAuthSession({
      token,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    log.event("auth.signed-in", {
      userId: user.userId,
      provider: user.provider,
      isReturning: !!existing,
      wallet: !!user.walletAddress,
    });
    return { token, record, isReturning: !!existing };
  }

  /** Read cookie value from a raw Cookie header. */
  parseSessionToken(cookieHeader: string | undefined | null): string | null {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(/;\s*/);
    for (const p of parts) {
      const i = p.indexOf("=");
      if (i < 0) continue;
      if (p.slice(0, i) === SESSION_COOKIE) {
        try {
          return decodeURIComponent(p.slice(i + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  resolve(token: string | null): AuthRecord | null {
    if (!token) return null;
    const r = this.sessions.get(token);
    if (!r) return null;
    if (this.isExpired(r, Date.now())) {
      this.sessions.delete(token);
      void this.store.deleteAuthSession(token).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[ruby-high] auth session cleanup failed:", err);
      });
      return null;
    }
    return this.enrichRecord(r);
  }

  destroy(token: string | null): boolean {
    if (!token) return false;
    const deleted = this.sessions.delete(token);
    void this.store.deleteAuthSession(token).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[ruby-high] auth session delete failed:", err);
    });
    return deleted;
  }

  stateKeyForCookie(cookieHeader: string | undefined | null): string {
    return this.stateKeyForToken(this.parseSessionToken(cookieHeader));
  }

  stateKeyForToken(token: string | null): string {
    const record = this.resolve(token);
    return record ? this.stateKeyForRecord(record) : "rh:anonymous";
  }

  stateKeyForRecord(record: AuthRecord): string {
    return `rh:user:${record.userId}`;
  }

  walletAddressForRecord(record: AuthRecord | null | undefined): string {
    if (!record) return "";
    return record.walletAddress ?? this.userProfileForId(record.userId)?.walletAddress ?? "";
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

  private async hydrateAuth(): Promise<void> {
    const now = Date.now();
    const auth = await this.store.loadAuth();
    for (const user of auth.users) {
      this.rememberAuthUser(user);
    }
    for (const session of auth.sessions) {
      if (session.expiresAt < now || !this.usersById.has(session.userId)) {
        void this.store.deleteAuthSession(session.token).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[ruby-high] auth session cleanup failed:", err);
        });
        continue;
      }
      const user = this.userProfileForId(session.userId);
      this.sessions.set(session.token, this.enrichRecord({
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        provider: user?.provider,
        label: user?.label,
        ...(user?.walletAddress ? { walletAddress: user.walletAddress } : {}),
        ...(user?.walletChainType ? { walletChainType: user.walletChainType } : {}),
      }));
    }
  }

  private isExpired(record: AuthRecord, now: number): boolean {
    return now - record.createdAt > SESSION_TTL_MS || record.expiresAt < now;
  }

  private recordForUser(user: AuthUserRecord, now: number): AuthRecord {
    const profile = this.userProfileForId(user.userId) ?? user;
    return {
      userId: user.userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      provider: user.provider,
      label: user.label ?? profile.label,
      ...(profile.walletAddress ? { walletAddress: profile.walletAddress } : {}),
      ...(profile.walletChainType ? { walletChainType: profile.walletChainType } : {}),
    };
  }

  private rememberAuthUser(user: AuthUserRecord): AuthUserRecord {
    this.usersByProviderHash.set(authUserKey(user.provider, user.providerUserHash), user);
    const merged = mergeAuthUserProfile(this.usersById.get(user.userId), user);
    this.usersById.set(user.userId, merged);
    return merged;
  }

  private userProfileForId(userId: string): AuthUserRecord | undefined {
    const direct = this.usersById.get(userId);
    let profile = direct;
    for (const user of this.usersByProviderHash.values()) {
      if (user.userId === userId) profile = mergeAuthUserProfile(profile, user);
    }
    if (profile) this.usersById.set(userId, profile);
    return profile;
  }

  private enrichRecord(record: AuthRecord): AuthRecord {
    const profile = this.userProfileForId(record.userId);
    if (!profile) return record;
    return {
      ...record,
      provider: record.provider ?? profile.provider,
      label: record.label ?? profile.label,
      ...(record.walletAddress ?? profile.walletAddress
        ? { walletAddress: record.walletAddress ?? profile.walletAddress }
        : {}),
      ...(record.walletChainType ?? profile.walletChainType
        ? { walletChainType: record.walletChainType ?? profile.walletChainType }
        : {}),
    };
  }
}

function authProviderRank(provider: AuthUserRecord["provider"]): number {
  if (provider === "privy") return 3;
  if (provider === "openrouter") return 2;
  return 1;
}

function preferredAuthUserRecord(a: AuthUserRecord, b: AuthUserRecord): AuthUserRecord {
  if (b.lastLoginAt !== a.lastLoginAt) return b.lastLoginAt > a.lastLoginAt ? b : a;
  const rankDelta = authProviderRank(b.provider) - authProviderRank(a.provider);
  if (rankDelta !== 0) return rankDelta > 0 ? b : a;
  return b.createdAt >= a.createdAt ? b : a;
}

function mergeAuthUserProfile(current: AuthUserRecord | undefined, next: AuthUserRecord): AuthUserRecord {
  if (!current) return next;
  const primary = preferredAuthUserRecord(current, next);
  const secondary = primary === current ? next : current;
  return {
    ...primary,
    createdAt: Math.min(current.createdAt, next.createdAt),
    lastLoginAt: Math.max(current.lastLoginAt, next.lastLoginAt),
    label: primary.label ?? secondary.label,
    ...(primary.walletAddress ?? secondary.walletAddress
      ? { walletAddress: primary.walletAddress ?? secondary.walletAddress }
      : {}),
    ...(primary.walletChainType ?? secondary.walletChainType
      ? { walletChainType: primary.walletChainType ?? secondary.walletChainType }
      : {}),
  };
}

function buildAuthDailyBuckets(now: number, count: number): {
  days: AuthAnalyticsDay[];
  byDate: Map<string, AuthAnalyticsDay>;
} {
  const start = startOfUtcDay(now) - (count - 1) * 24 * 60 * 60 * 1000;
  const days: AuthAnalyticsDay[] = [];
  const byDate = new Map<string, AuthAnalyticsDay>();
  for (let i = 0; i < count; i++) {
    const date = isoDate(start + i * 24 * 60 * 60 * 1000);
    const day = { date, newUsers: 0, signedInUsers: 0, sessionStarts: 0 };
    days.push(day);
    byDate.set(date, day);
  }
  return { days, byDate };
}

function incrementAuthDay(
  byDate: Map<string, AuthAnalyticsDay>,
  timestamp: number,
  key: Exclude<keyof AuthAnalyticsDay, "date">,
): void {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const day = byDate.get(isoDate(timestamp));
  if (day) day[key] += 1;
}

function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function exchangeCodeForKey(code: string, codeVerifier: string): Promise<{ key: string; userId?: string }> {
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
  return { key: body.key, userId: body.user_id };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function providerIdentityHash(value: string, source: "user" | "key" | "guest" | "privy"): string {
  if (source === "privy") {
    return createHash("sha256")
      .update(`privy:user:${value}`)
      .digest("hex");
  }
  return createHash("sha256")
    .update(`${source === "guest" ? "guest" : "openrouter"}:${source}:${value}`)
    .digest("hex");
}
