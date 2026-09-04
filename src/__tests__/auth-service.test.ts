import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService, clientSurfaceFromUserAgent } from "../services/auth-service.js";
import { StateStore, type AuthStoreSnapshot, type AuthSessionRecord, type AuthUserRecord, type StateStoreLike } from "../services/state-store.js";
import { setPasskeyAuthVerifiersForTest, type PasskeyRelyingParty } from "../services/passkey-auth.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const tmpDirs: string[] = [];
const auths: AuthService[] = [];

class AuthOnlyStore implements StateStoreLike {
  constructor(private snapshot: AuthStoreSnapshot) {}

  async load(): Promise<Map<string, any>> { return new Map(); }
  async loadAuth(): Promise<AuthStoreSnapshot> { return this.snapshot; }
  async loadPacks(): Promise<any[]> { return []; }
  async loadTeachers(): Promise<any[]> { return []; }
  async loadDraftPacks(): Promise<any[]> { return []; }
  async loadPackInstallations(): Promise<any[]> { return []; }
  async saveSession(_state: any): Promise<void> {}
  async saveAuthUser(user: AuthUserRecord): Promise<void> {
    const index = this.snapshot.users.findIndex((entry) =>
      entry.provider === user.provider && entry.providerUserHash === user.providerUserHash
    );
    if (index >= 0) this.snapshot.users[index] = user;
    else this.snapshot.users.push(user);
  }
  async saveAuthSession(session: AuthSessionRecord): Promise<void> {
    const index = this.snapshot.sessions.findIndex((entry) => entry.token === session.token);
    if (index >= 0) this.snapshot.sessions[index] = session;
    else this.snapshot.sessions.push(session);
  }
  async savePack(_record: any): Promise<void> {}
  async saveDraftPack(_record: any): Promise<void> {}
  async savePackInstallation(_record: any): Promise<void> {}
  async deletePack(_ownerSessionId: string | null, _packId: string): Promise<void> {}
  async deleteTeacher(_teacherId: string): Promise<void> {}
  async saveTeacher(_record: any): Promise<void> {}
  async deleteDraftPack(_draftId: string): Promise<void> {}
  async deletePackInstallation(_userId: string, _packId: string): Promise<void> {}
  async deleteAuthSession(token: string): Promise<void> {
    this.snapshot.sessions = this.snapshot.sessions.filter((session) => session.token !== token);
  }
  async save(_states: Iterable<any>): Promise<void> {}
  describe(): string { return "auth-only-test-store"; }
}

async function freshAuth(): Promise<AuthService> {
  const dir = await mkdtemp(join(tmpdir(), "ruby-high-auth-"));
  tmpDirs.push(dir);
  const svc = await AuthService.start({} as never, new StateStore(join(dir, "state.json")));
  auths.push(svc);
  return svc;
}

function sessionRecord(userId: string, createdAt: number) {
  return {
    userId,
    createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(auths.splice(0).map((auth) => auth.stop()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AuthService passkey security", () => {
  const relyingParty: PasskeyRelyingParty = {
    id: "localhost",
    name: "Ruby High",
    origin: "http://localhost:3000",
  };

  it("keeps a registration challenge durable and one-time across a restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-passkey-state-"));
    tmpDirs.push(dir);
    const statePath = join(dir, "state.json");
    const store = new StateStore(statePath, { debounceMs: 0 });
    const first = await AuthService.start({} as never, store);
    auths.push(first);
    const guest = await first.createGuestSession();
    const options = await first.beginPasskeyRegistration(guest.token, relyingParty, "Pip");
    await first.stop();

    const second = await AuthService.start({} as never, new StateStore(statePath, { debounceMs: 0 }));
    auths.push(second);
    const restore = setPasskeyAuthVerifiersForTest({
      registration: async () => ({
        id: "durable-passkey",
        publicKey: Buffer.from("durable-public-key").toString("base64url"),
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      }),
    });
    try {
      const completed = await second.completePasskeyRegistration(options.flowId, { id: "durable-passkey" }, guest.token);
      expect(completed.record).toMatchObject({ userId: guest.record.userId, provider: "passkey" });
      await expect(second.completePasskeyRegistration(options.flowId, { id: "durable-passkey" }, guest.token))
        .rejects.toThrow("expired");
    } finally {
      restore();
    }
  });

  it("supports two passkeys, safe deletion, recovery rotation, and recent verification", async () => {
    const auth = await freshAuth();
    const restore = setPasskeyAuthVerifiersForTest({
      registration: async (input) => {
        const id = String((input.response as { id?: string })?.id || "test-passkey");
        return {
          id,
          publicKey: Buffer.from(`public:${id}`).toString("base64url"),
          counter: 0,
          deviceType: id.includes("synced") ? "multiDevice" : "singleDevice",
          backedUp: id.includes("synced"),
        };
      },
      authentication: async () => ({ newCounter: 1 }),
    });
    try {
      const guest = await auth.createGuestSession();
      const firstOptions = await auth.beginPasskeyRegistration(guest.token, relyingParty, "Pip");
      const first = await auth.completePasskeyRegistration(firstOptions.flowId, { id: "device-one" }, guest.token);
      expect(first.recoveryCode).toMatch(/^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/);

      const secondOptions = await auth.beginPasskeyRegistration(first.token, relyingParty, "Pip");
      const second = await auth.completePasskeyRegistration(secondOptions.flowId, { id: "synced-two" }, first.token);
      expect(second.recoveryCode).toBeUndefined();
      expect(auth.passkeySummariesForRecord(second.record)).toMatchObject([
        { name: "Device passkey 1", synced: false },
        { name: "Synced passkey 1", synced: true },
      ]);

      const firstManagementId = auth.passkeySummariesForRecord(second.record)[0]!.id;
      await auth.deletePasskey(second.token, firstManagementId);
      expect(auth.passkeySummariesForRecord(second.record)).toHaveLength(1);
      await expect(auth.deletePasskey(second.token, auth.passkeySummariesForRecord(second.record)[0]!.id))
        .rejects.toThrow("Add another passkey");

      const recoveryOptions = await auth.beginPasskeyRecovery(first.recoveryCode!, relyingParty);
      const recovered = await auth.completePasskeyRecovery(recoveryOptions.flowId, { id: "recovered-device" });
      expect(recovered.record.userId).toBe(guest.record.userId);
      expect(recovered.recoveryCode).not.toBe(first.recoveryCode);
      await expect(auth.beginPasskeyRecovery(first.recoveryCode!, relyingParty)).rejects.toThrow("not valid");

      const reauth = await auth.beginPasskeyAuthentication(relyingParty, guest.record.userId);
      expect(reauth.publicKey.allowCredentials).toHaveLength(2);
      const staleToken = "stale-passkey-session";
      auth.injectSessionForTest(staleToken, {
        ...recovered.record,
        passkeyVerifiedAt: Date.now() - 10 * 60 * 1000,
      });
      await expect(auth.regenerateRecoveryCode(staleToken)).rejects.toThrow("Use your passkey again");
    } finally {
      restore();
    }
  });
});

describe("AuthService.gcSessions", () => {
  it("drops sessions older than the TTL", async () => {
    const auth = await freshAuth();
    // Use real Date.now() because resolve() reads it directly — a "fresh"
    // session in fake-time would still be ancient in real-time and resolve
    // would TTL-reject it.
    const now = Date.now();
    auth.injectSessionForTest("expired-1", sessionRecord("u-exp-1", now - SESSION_TTL_MS - 1000));
    auth.injectSessionForTest("expired-2", sessionRecord("u-exp-2", now - SESSION_TTL_MS - 999_999));
    auth.injectSessionForTest("fresh", sessionRecord("u-fresh", now - 1000));
    expect(auth.sessionCount()).toBe(3);
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(2);
    expect(result.remaining).toBe(1);
    expect(auth.sessionCount()).toBe(1);
    // Fresh session still resolvable.
    expect(auth.resolve("fresh")).not.toBeNull();
    // Expired ones are gone.
    expect(auth.resolve("expired-1")).toBeNull();
  });

  it("is a no-op when nothing is expired", async () => {
    const auth = await freshAuth();
    const now = 2_000_000_000_000;
    auth.injectSessionForTest("a", sessionRecord("u-a", now));
    auth.injectSessionForTest("b", sessionRecord("u-b", now - 1000));
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(0);
    expect(result.remaining).toBe(2);
    expect(auth.sessionCount()).toBe(2);
  });

  it("preserves sessions exactly at the TTL boundary (drops only past it)", async () => {
    const auth = await freshAuth();
    // The gc strict-greater check (`> SESSION_TTL_MS`) keeps the boundary
    // record. Test the count via gcSessions only — resolve() uses Date.now()
    // separately and would walk past the boundary by the time we called it.
    const now = 5_000_000_000_000;
    auth.injectSessionForTest("at-boundary", sessionRecord("u-boundary", now - SESSION_TTL_MS));
    auth.injectSessionForTest("just-past", sessionRecord("u-past", now - SESSION_TTL_MS - 1));
    const result = auth.gcSessions(now);
    expect(result.dropped).toBe(1);
    expect(auth.sessionCount()).toBe(1);
  });

  it("stop() clears the gc timer (no leaked handles)", async () => {
    const auth = await freshAuth();
    auth.injectSessionForTest("a", sessionRecord("u-a", Date.now()));
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
    auth.injectSessionForTest("aging", sessionRecord("u-aging", Date.now() - SESSION_TTL_MS - 1000));
    expect(auth.resolve("aging")).toBeNull();
  });

  it("reuses the same persistent Ruby High user across OpenRouter logins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-auth-persist-"));
    tmpDirs.push(dir);
    const store = new StateStore(join(dir, "state.json"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-user-1" }), { status: 200 });
    });

    const authA = await AuthService.start({} as never, store);
    auths.push(authA);
    const firstPkce = authA.startPkce("http://localhost/callback");
    const first = await authA.completePkce(firstPkce.state, "code-1", null, firstPkce.pendingToken);
    await authA.stop();

    const authB = await AuthService.start({} as never, new StateStore(join(dir, "state.json")));
    auths.push(authB);
    const secondPkce = authB.startPkce("http://localhost/callback");
    const second = await authB.completePkce(secondPkce.state, "code-2", null, secondPkce.pendingToken);

    expect(second.token).not.toBe(first.token);
    expect(second.record.userId).toBe(first.record.userId);
    expect(authB.stateKeyForToken(second.token)).toBe(`rh:user:${first.record.userId}`);
  });

  it("creates a durable guest session without OpenRouter", async () => {
    const auth = await freshAuth();
    const first = await auth.createGuestSession();
    const again = await auth.createGuestSession(first.token);

    expect(first.record.label).toBe("Guest");
    expect(again.token).toBe(first.token);
    expect(again.record.userId).toBe(first.record.userId);
    expect(auth.resolve(first.token)?.userId).toBe(first.record.userId);
    expect(auth.stateKeyForToken(first.token)).toBe(`rh:user:${first.record.userId}`);
  });

  it("persists scheduled smoke identity and excludes it from product analytics", async () => {
    const auth = await freshAuth();
    const human = await auth.createGuestSession(null, "rhv_human_visitor_123");
    const smoke = await auth.createGuestSession(null, null, "smoke");

    expect(smoke.record.clientSurface).toBe("smoke");
    expect(auth.resolve(smoke.token)?.clientSurface).toBe("smoke");
    expect(auth.analyticsSnapshot()).toMatchObject({
      users: 1,
      unexpiredAuthSessions: 1,
      excludedSynthetic: { users: 1, sessions: 1 },
    });
    expect(auth.resolve(human.token)?.clientSurface).toBeUndefined();
  });

  it("classifies coarse client surfaces without retaining raw user agents", () => {
    expect(clientSurfaceFromUserAgent("RubyHighSmoke/1.0")).toBe("smoke");
    expect(clientSurfaceFromUserAgent("Mozilla/5.0 AppleWebKit/537.36")).toBe("viewer");
    expect(clientSurfaceFromUserAgent("curl/8.7.1")).toBe("api");
    expect(clientSurfaceFromUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("api");
    expect(clientSurfaceFromUserAgent("Mozilla/5.0 HeadlessChrome/120.0 Playwright")).toBe("api");
    expect(clientSurfaceFromUserAgent("custom-client")).toBeUndefined();
  });

  it("reuses a guest identity when the cookie is lost but the visitor id remains", async () => {
    const auth = await freshAuth();
    const first = await auth.createGuestSession(null, "rhv_test_visitor_123");
    const second = await auth.createGuestSession(null, "rhv_test_visitor_123");
    const withoutVisitor = await auth.createGuestSession(null, null);
    const snapshot = auth.analyticsSnapshot(Date.now());

    expect(second.token).not.toBe(first.token);
    expect(second.record.userId).toBe(first.record.userId);
    expect(withoutVisitor.record.userId).not.toBe(first.record.userId);
    expect(snapshot.users).toBe(2);
    expect(snapshot.visitors.total).toBe(1);
    expect(snapshot.newVisitors).toBe(1);
  });

  it("ignores legacy unprefixed visitor ids for guest recovery", async () => {
    const auth = await freshAuth();
    const first = await auth.createGuestSession(null, "legacy_visitor_id");
    const second = await auth.createGuestSession(null, "legacy_visitor_id");
    const snapshot = auth.analyticsSnapshot(Date.now());

    expect(second.record.userId).not.toBe(first.record.userId);
    expect(snapshot.users).toBe(2);
    expect(snapshot.visitors.total).toBe(0);
  });

  it("binds an existing cookie guest to a visitor id for later lost-cookie recovery", async () => {
    const auth = await freshAuth();
    const first = await auth.createGuestSession();
    await auth.createGuestSession(first.token, "rhv_cookie_bound_visitor");
    const recovered = await auth.createGuestSession(null, "rhv_cookie_bound_visitor");

    expect(recovered.record.userId).toBe(first.record.userId);
  });

  it("counts a returned guest cookie as activity instead of a fresh identity", async () => {
    const auth = await freshAuth();
    const base = Date.UTC(2026, 4, 1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);

    const first = await auth.createGuestSession();
    clock.mockReturnValue(base + 24 * 60 * 60 * 1000 + 1);
    const again = await auth.createGuestSession(first.token);
    const snapshot = auth.analyticsSnapshot(Date.now());

    expect(again.token).toBe(first.token);
    expect(again.record.userId).toBe(first.record.userId);
    expect(snapshot.users).toBe(1);
    expect(snapshot.returningUsers).toBe(1);
    expect(snapshot.d1Retention).toMatchObject({
      eligibleUsers: 1,
      returnedUsers: 1,
    });
    expect(snapshot.signedInLast24h).toBe(1);
  });

  it("throttles same-visitor last-seen updates for guest traffic stats", async () => {
    const auth = await freshAuth();
    const base = Date.UTC(2026, 4, 1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);

    const first = await auth.createGuestSession(null, "rhv_touch_throttle_visitor");
    clock.mockReturnValue(base + 60_000);
    await auth.createGuestSession(first.token, "rhv_touch_throttle_visitor");
    expect(auth.analyticsSnapshot(Date.now()).visitors.returningLast24h).toBe(0);

    clock.mockReturnValue(base + 5 * 60_000 + 1);
    await auth.createGuestSession(first.token, "rhv_touch_throttle_visitor");
    expect(auth.analyticsSnapshot(Date.now()).visitors.returningLast24h).toBe(1);
  });

  it("treats malformed session cookie encoding as signed out", async () => {
    const auth = await freshAuth();

    expect(auth.parseSessionToken("rh_session=%")).toBeNull();
    expect(auth.stateKeyForCookie("rh_session=%")).toBe("rh:anonymous");
  });

  it("requires the browser-bound pending auth token to complete PKCE", async () => {
    const auth = await freshAuth();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-pending-cookie" }), { status: 200 });
    });
    const pkce = auth.startPkce("http://localhost/callback");

    await expect(auth.completePkce(pkce.state, "code-1", null, null)).rejects.toThrow(/cookie mismatch/i);
    await expect(auth.completePkce(pkce.state, "code-1", null, "wrong-token")).rejects.toThrow(/cookie mismatch/i);
    expect(fetchMock).not.toHaveBeenCalled();

    const completed = await auth.completePkce(pkce.state, "code-1", null, pkce.pendingToken);
    expect(completed.record.provider).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("upgrades a guest session to OpenRouter without moving the character bucket", async () => {
    const auth = await freshAuth();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-user-2" }), { status: 200 });
    });

    const guest = await auth.createGuestSession();
    const pkce = auth.startPkce("http://localhost/callback");
    const upgraded = await auth.completePkce(pkce.state, "code-1", guest.token, pkce.pendingToken);

    expect(upgraded.token).not.toBe(guest.token);
    expect(upgraded.record.userId).toBe(guest.record.userId);
    expect(auth.stateKeyForToken(upgraded.token)).toBe(`rh:user:${guest.record.userId}`);
  });

  it("upgrades a guest session to Privy and persists the verified wallet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ruby-high-auth-privy-"));
    tmpDirs.push(dir);
    const statePath = join(dir, "state.json");
    const wallet = "0x1111111111111111111111111111111111111111";
    const authA = await AuthService.start({} as never, new StateStore(statePath));
    auths.push(authA);
    const guest = await authA.createGuestSession();
    const upgraded = await authA.completePrivyLogin({
      privyUserId: "did:privy:alice",
      label: "alice@example.test",
      walletAddress: wallet,
      walletChainType: "ethereum",
    }, guest.token);

    expect(upgraded.token).not.toBe(guest.token);
    expect(upgraded.record.userId).toBe(guest.record.userId);
    expect(upgraded.record.provider).toBe("privy");
    expect(upgraded.record.label).toBe("alice@example.test");
    expect(authA.stateKeyForToken(upgraded.token)).toBe(`rh:user:${guest.record.userId}`);
    expect(authA.walletAddressForRecord(upgraded.record)).toBe(wallet);

    await authA.stop();
    const authB = await AuthService.start({} as never, new StateStore(statePath));
    auths.push(authB);
    const hydrated = authB.resolve(upgraded.token);

    expect(hydrated).toMatchObject({
      userId: guest.record.userId,
      provider: "privy",
      label: "alice@example.test",
      walletAddress: wallet,
      walletChainType: "ethereum",
    });
    expect(authB.walletAddressForRecord(hydrated)).toBe(wallet);
  });

  it("hydrates linked provider records with wallet metadata regardless of store order", async () => {
    const now = Date.now();
    const userId = "usr_linked_wallet";
    const wallet = "0x2222222222222222222222222222222222222222";
    const store = new AuthOnlyStore({
      users: [
        {
          userId,
          provider: "privy",
          providerUserHash: "privy-hash",
          createdAt: now - 20_000,
          lastLoginAt: now - 1_000,
          label: "alice@example.test",
          walletAddress: wallet,
          walletChainType: "ethereum",
        },
        {
          userId,
          provider: "guest",
          providerUserHash: "guest-hash",
          createdAt: now - 30_000,
          lastLoginAt: now - 10_000,
          label: "Guest",
        },
      ],
      sessions: [
        {
          token: "linked-session-token",
          userId,
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
        },
      ],
    });

    const auth = await AuthService.start({} as never, store);
    auths.push(auth);
    const hydrated = auth.resolve("linked-session-token");

    expect(hydrated).toMatchObject({
      userId,
      provider: "privy",
      walletAddress: wallet,
      walletChainType: "ethereum",
    });
    expect(auth.walletAddressForRecord(hydrated)).toBe(wallet);
  });

  it("keeps Privy wallet metadata when OpenRouter is added to the same account", async () => {
    const auth = await freshAuth();
    const wallet = "0x3333333333333333333333333333333333333333";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-wallet-link" }), { status: 200 });
    });

    const guest = await auth.createGuestSession();
    const privy = await auth.completePrivyLogin({
      privyUserId: "did:privy:wallet-link",
      label: "wallet-link@example.test",
      walletAddress: wallet,
      walletChainType: "ethereum",
    }, guest.token);
    const pkce = auth.startPkce("http://localhost/callback");
    const openrouter = await auth.completePkce(pkce.state, "code-1", privy.token, pkce.pendingToken);

    expect(openrouter.record).toMatchObject({
      userId: guest.record.userId,
      provider: "openrouter",
      walletAddress: wallet,
      walletChainType: "ethereum",
    });
    expect(auth.walletAddressForRecord(openrouter.record)).toBe(wallet);
  });

  it("keeps wallet metadata when returning to a previously linked OpenRouter account", async () => {
    const auth = await freshAuth();
    const wallet = "0x4444444444444444444444444444444444444444";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-returning-link" }), { status: 200 });
    });

    const guest = await auth.createGuestSession();
    const firstPkce = auth.startPkce("http://localhost/callback");
    const firstOpenrouter = await auth.completePkce(firstPkce.state, "code-1", guest.token, firstPkce.pendingToken);
    const privy = await auth.completePrivyLogin({
      privyUserId: "did:privy:returning-link",
      label: "returning-link@example.test",
      walletAddress: wallet,
      walletChainType: "ethereum",
    }, firstOpenrouter.token);
    const secondPkce = auth.startPkce("http://localhost/callback");
    const secondOpenrouter = await auth.completePkce(secondPkce.state, "code-2", privy.token, secondPkce.pendingToken);

    expect(secondOpenrouter.record).toMatchObject({
      userId: guest.record.userId,
      provider: "openrouter",
      walletAddress: wallet,
      walletChainType: "ethereum",
    });
    expect(auth.walletAddressForRecord(secondOpenrouter.record)).toBe(wallet);
  });
});
