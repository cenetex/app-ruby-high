import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleChatRoutes, type ChatRouteContext } from "../chat-routes.js";
import { AuthService } from "../services/auth-service.js";
import { ChatService } from "../services/chat-service.js";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { getActivePack, registerPublicPack, resetActivePack } from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { getPrivyPublicConfigFromEnv, setPrivyAuthVerifierForTest } from "../services/privy-auth.js";
import { setHallPassNftBurnVerifierForTest } from "../services/hall-pass-nfts.js";

let tmpDir: string;
let auth: AuthService;
let chat: ChatService;
let faculty: FacultyService;
let ruby: RubyHighService;
let capturedChatRequest: any | null = null;
let restoreHallPassBurnVerifier: (() => void) | null = null;
const originalHostedOpenRouterKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY;
const originalPortraitBucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
const originalPortraitCost = process.env.RUBY_HIGH_PORTRAIT_HALL_PASS_COST;
const originalPrivyAppId = process.env.RUBY_HIGH_PRIVY_APP_ID;
const originalPrivyClientId = process.env.RUBY_HIGH_PRIVY_CLIENT_ID;
const originalPrivyLoginMethods = process.env.RUBY_HIGH_PRIVY_LOGIN_METHODS;
const originalPrivyAppSecret = process.env.RUBY_HIGH_PRIVY_APP_SECRET;
const originalPrivyVerificationKey = process.env.RUBY_HIGH_PRIVY_VERIFICATION_KEY;

class TestResponse {
  statusCode = 0;
  body = "";
  headers = new Map<string, string | string[]>();

  setHeader(name: string, value: string | string[]): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  writeHead(status: number, headers: Record<string, string | string[]>): void {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  flushHeaders(): void {
    // no-op for route tests
  }

  end(body?: string): void {
    if (body) this.body += body;
  }
}

function runtime() {
  return {
    agentId: "test-agent",
    getService(type: string) {
      if (type === AuthService.serviceType) return auth;
      if (type === ChatService.serviceType) return chat;
      if (type === FacultyService.serviceType) return faculty;
      if (type === RubyHighService.serviceType) return ruby;
      return null;
    },
  };
}

function makeCtx(url: URL, res: TestResponse, opts: {
  method?: string;
  cookieHeader?: string | null;
  apiKeyHeader?: string | null;
  authorizationHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
  body?: unknown;
} = {}): ChatRouteContext {
  return {
    method: opts.method ?? "GET",
    pathname: url.pathname,
    url,
    runtime: runtime(),
    res,
    cookieHeader: opts.cookieHeader ?? null,
    apiKeyHeader: opts.apiKeyHeader ?? null,
    authorizationHeader: opts.authorizationHeader ?? null,
    originHeader: opts.originHeader ?? null,
    error: (_res, message, status = 500) => {
      res.statusCode = status;
      res.body = JSON.stringify({ error: message });
    },
    json: (_res, data, status = 200) => {
      res.statusCode = status;
      res.body = JSON.stringify(data);
    },
    readJsonBody: async () => opts.body ?? {},
  };
}

function emptyWelcomeHallPasses(stateKey: string): void {
  expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
}

function buildSseChunk(text: string): Uint8Array {
  return new TextEncoder().encode([
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""));
}

function fakePublicGuestPack(): ContentPack {
  return {
    id: "teacher:route-lounge-guest",
    name: "Extraterrestrial Life",
    description: "Guest astrobiology week.",
    version: "1.0.0",
    faculty: [{
      id: "route-lounge-guest-teacher",
      displayName: "Dr. Cassandra Wells",
      shortName: "Dr. Wells",
      subjects: ["astrobiology"],
      bio: "Astrobiology guest faculty.",
      accent: "#7c66ff",
      systemPrompt: "You are Dr. Cassandra Wells, Ruby High's guest astrobiology teacher.",
      defaultModel: "test/guest-model",
      questions: [{
        id: "astro-q1",
        faculty: "route-lounge-guest-teacher",
        subject: "astrobiology",
        difficulty: "easy",
        prompt: "What makes a planet a plausible target for life?",
        options: { A: "Stable energy and chemistry", B: "Only purple rocks", C: "No atmosphere", D: "Random noise" },
        correct: "A",
        explanation: "Habitability starts with available energy, chemistry, and stable conditions.",
      }],
    }],
    rooms: [{
      id: "astro-room",
      name: "Astrobiology",
      channelName: "guest",
      teacherId: "route-lounge-guest-teacher",
      description: "Guest astrobiology room",
      teaches: true,
    }],
  };
}

function hostedImageSpendKey(route: string, requestId: string): string {
  const digest = createHash("sha256").update(`${route}:${requestId}`).digest("hex").slice(0, 32);
  return `hosted-image:${route}:${digest}`;
}

function hostedImageFingerprint(route: string, payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ route, payload }))
    .digest("hex")
    .slice(0, 32);
}

async function callbackRequest(redirect: string): Promise<{ url: URL; cookieHeader: string }> {
  const { state, pendingToken } = auth.startPkce("http://localhost:3000/api/apps/ruby-high/auth/callback");
  const url = new URL("http://localhost:3000/api/apps/ruby-high/auth/callback");
  url.searchParams.set("code", "code-1");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect", redirect);
  return {
    url,
    cookieHeader: auth.buildPendingAuthCookie(pendingToken, { secure: false }).split(";")[0]!,
  };
}

beforeEach(async () => {
  delete process.env.RUBY_HIGH_OPENROUTER_API_KEY;
  delete process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  delete process.env.RUBY_HIGH_PORTRAIT_HALL_PASS_COST;
  delete process.env.RUBY_HIGH_PRIVY_APP_ID;
  delete process.env.RUBY_HIGH_PRIVY_CLIENT_ID;
  delete process.env.RUBY_HIGH_PRIVY_LOGIN_METHODS;
  delete process.env.RUBY_HIGH_PRIVY_APP_SECRET;
  delete process.env.RUBY_HIGH_PRIVY_VERIFICATION_KEY;
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-chat-routes-auth-"));
  capturedChatRequest = null;
  resetActivePack();
  await getActivePack();
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  chat = await ChatService.start({} as never);
  faculty = await FacultyService.start({} as never);
  ruby = new RubyHighService({} as never, store);
  ruby.setFacultyService(faculty);
  chat.setRubyHighService(ruby);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify({ key: "sk-test", user_id: "openrouter-user" }), { status: 200 });
  });
});

afterEach(async () => {
  restoreEnv("RUBY_HIGH_OPENROUTER_API_KEY", originalHostedOpenRouterKey);
  restoreEnv("RUBY_HIGH_PORTRAITS_BUCKET", originalPortraitBucket);
  restoreEnv("RUBY_HIGH_PORTRAIT_HALL_PASS_COST", originalPortraitCost);
  restoreEnv("RUBY_HIGH_PRIVY_APP_ID", originalPrivyAppId);
  restoreEnv("RUBY_HIGH_PRIVY_CLIENT_ID", originalPrivyClientId);
  restoreEnv("RUBY_HIGH_PRIVY_LOGIN_METHODS", originalPrivyLoginMethods);
  restoreEnv("RUBY_HIGH_PRIVY_APP_SECRET", originalPrivyAppSecret);
  restoreEnv("RUBY_HIGH_PRIVY_VERIFICATION_KEY", originalPrivyVerificationKey);
  setPrivyAuthVerifierForTest(null);
  if (restoreHallPassBurnVerifier) restoreHallPassBurnVerifier();
  restoreHallPassBurnVerifier = null;
  vi.restoreAllMocks();
  await auth.stop();
  await chat.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
  resetActivePack();
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}

describe("auth callback redirect sanitization", () => {
  it("falls back to the viewer when redirect points off-origin", async () => {
    const res = new TestResponse();
    const callback = await callbackRequest("https://evil.example/pwn");
    const handled = await handleChatRoutes(makeCtx(callback.url, res, { cookieHeader: callback.cookieHeader }));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('window.location.replace("/api/apps/ruby-high/viewer")');
    expect(res.body).toContain('localStorage.getItem("rh_openrouter_persist")');
    expect(res.body).toContain("sessionStorage");
    expect(res.body).not.toContain('localStorage.setItem("rh_openrouter_key", data.apiKey)');
    expect(res.body).not.toContain("evil.example");
  });

  it("allows root-relative same-origin callback redirects", async () => {
    const res = new TestResponse();
    const callback = await callbackRequest("/api/apps/ruby-high/viewer?tab=packs#store");
    const handled = await handleChatRoutes(makeCtx(callback.url, res, { cookieHeader: callback.cookieHeader }));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('window.location.replace("/api/apps/ruby-high/viewer?tab=packs#store")');
  });

  it("sets and requires the pending auth cookie for OpenRouter callbacks", async () => {
    const startRes = new TestResponse();
    const startHandled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/start"),
      startRes,
    ));

    expect(startHandled).toBe(true);
    expect(startRes.statusCode).toBe(302);
    expect(startRes.getHeader("set-cookie")).toEqual(expect.stringContaining("rh_auth_pending="));
    expect(startRes.getHeader("location")).toEqual(expect.stringContaining("https://openrouter.ai/auth"));

    const callback = await callbackRequest("/api/apps/ruby-high/viewer");
    const callbackRes = new TestResponse();
    const callbackHandled = await handleChatRoutes(makeCtx(callback.url, callbackRes));

    expect(callbackHandled).toBe(true);
    expect(callbackRes.statusCode).toBe(400);
    expect(callbackRes.body).toContain("Auth state cookie mismatch");
  });
});

describe("auth origin guard", () => {
  it("allows same-origin guest session creation", async () => {
    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/guest"),
      res,
      { method: "POST", originHeader: "http://localhost:3000" },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader("set-cookie")).toBeDefined();
  });

  it("rejects cross-origin auth POSTs without mutating the session", async () => {
    const guestRes = new TestResponse();
    const guestHandled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/guest"),
      guestRes,
      { method: "POST", originHeader: "https://evil.example" },
    ));

    expect(guestHandled).toBe(true);
    expect(guestRes.statusCode).toBe(403);
    expect(guestRes.getHeader("set-cookie")).toBeUndefined();

    const token = "csrf-logout-token";
    auth.injectSessionForTest(token, {
      userId: "csrf-logout-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "CSRF User",
    });
    const logoutRes = new TestResponse();
    const logoutHandled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/logout"),
      logoutRes,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        originHeader: "https://evil.example",
      },
    ));

    expect(logoutHandled).toBe(true);
    expect(logoutRes.statusCode).toBe(403);
    expect(logoutRes.getHeader("set-cookie")).toBeUndefined();
    expect(auth.resolve(token)).not.toBeNull();
  });
});

describe("Privy auth", () => {
  it("publishes email and wallet Privy login by default", () => {
    expect(getPrivyPublicConfigFromEnv({
      RUBY_HIGH_PRIVY_APP_ID: "privy-app-test",
      RUBY_HIGH_PRIVY_CLIENT_ID: "privy-client-test",
    } as NodeJS.ProcessEnv)).toEqual({
      appId: "privy-app-test",
      clientId: "privy-client-test",
      loginMethods: ["email", "wallet"],
    });
  });

  it("publishes only supported configured Privy login methods", () => {
    expect(getPrivyPublicConfigFromEnv({
      RUBY_HIGH_PRIVY_APP_ID: "privy-app-test",
      RUBY_HIGH_PRIVY_CLIENT_ID: "privy-client-test",
      RUBY_HIGH_PRIVY_LOGIN_METHODS: "wallet,google,unknown,privy:cross-app",
    } as NodeJS.ProcessEnv)).toEqual({
      appId: "privy-app-test",
      clientId: "privy-client-test",
      loginMethods: ["wallet", "google", "privy:cross-app"],
    });
  });

  it("verifies the Privy token and upgrades the current session to a wallet account", async () => {
    process.env.RUBY_HIGH_PRIVY_APP_ID = "privy-app-test";
    process.env.RUBY_HIGH_PRIVY_CLIENT_ID = "privy-client-test";
    process.env.RUBY_HIGH_PRIVY_APP_SECRET = "privy-secret-test";
    const wallet = "0x1111111111111111111111111111111111111111";
    const guest = await auth.createGuestSession();
    const restoreVerifier = setPrivyAuthVerifierForTest(async (input) => {
      expect(input.accessToken).toBe("access-token-test");
      expect(input.identityToken).toBe("identity-token-test");
      return {
        privyUserId: "did:privy:alice",
        label: "alice@example.test",
        walletAddress: wallet,
        walletChainType: "ethereum",
      };
    });

    try {
      const res = new TestResponse();
      const handled = await handleChatRoutes(makeCtx(
        new URL("http://localhost:3000/api/apps/ruby-high/auth/privy"),
        res,
        {
          method: "POST",
          cookieHeader: `rh_session=${guest.token}`,
          originHeader: "http://localhost:3000",
          authorizationHeader: "Bearer access-token-test",
          body: { identityToken: "identity-token-test" },
        },
      ));

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.getHeader("set-cookie")).toBeDefined();
      const body = JSON.parse(res.body);
      expect(body.session).toBe(true);
      expect(body.label).toBe("alice@example.test");
      expect(body.privy).toMatchObject({
        configured: true,
        authenticated: true,
        walletAddress: wallet,
        walletChainType: "ethereum",
        label: "alice@example.test",
      });
      const cookie = String(res.getHeader("set-cookie"));
      const nextToken = cookie.match(/rh_session=([^;]+)/)?.[1];
      expect(nextToken).toBeTruthy();
      expect(nextToken).not.toBe(guest.token);
      const record = auth.resolve(decodeURIComponent(nextToken!));
      expect(record).toMatchObject({
        userId: guest.record.userId,
        provider: "privy",
        label: "alice@example.test",
        walletAddress: wallet,
        walletChainType: "ethereum",
      });
    } finally {
      restoreVerifier();
    }
  });
});

describe("hosted AI access auth", () => {
  it("does not expose the hosted OpenRouter key for text AI without an active pass", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-ai-no-pass";
    auth.injectSessionForTest(token, {
      userId: "hosted-ai-no-pass-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted AI",
    });

    const meRes = new TestResponse();
    await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/me"),
      meRes,
      { cookieHeader: `rh_session=${token}` },
    ));
    const me = JSON.parse(meRes.body);
    expect(me.ai).toBe(false);
    expect(me.hosted_ai).toMatchObject({ configured: true, active: false });
    expect(me.entitlements.hosted_ai).toMatchObject(me.hosted_ai);
    expect(me.entitlements.hosted_images.portrait).toMatchObject({
      configured: true,
      cost: 1,
      affordable: false,
      canUseHosted: false,
    });

    const chatRes = new TestResponse();
    await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat"),
      chatRes,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: { faculty: "ruby", message: "hello" },
      },
    ));
    expect(chatRes.statusCode).toBe(401);
    expect(JSON.parse(chatRes.body).error).toContain("Connect AI first");
  });

  it("enables text AI while a Hall Pass access window is active", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-ai-pass";
    auth.injectSessionForTest(token, {
      userId: "hosted-ai-pass-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted AI",
    });
    const stateKey = "rh:user:hosted-ai-pass-user";
    ruby.grantHallPasses(stateKey, {
      amount: 1,
      idempotencyKey: "test:hosted-ai-pass-seed",
      source: "admin",
    });
    ruby.activateHostedAiAccess(stateKey, {
      hallPassCost: 1,
      durationMs: 604_800_000,
      now: Date.now(),
    });

    const res = new TestResponse();
    await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/auth/me"),
      res,
      { cookieHeader: `rh_session=${token}` },
    ));
    const body = JSON.parse(res.body);
    expect(body.ai).toBe(true);
    expect(body.hosted_ai.active).toBe(true);
    expect(body.hosted_ai.expiresAt).toBeGreaterThan(Date.now());
    expect(body.entitlements).toMatchObject({
      hallPasses: 0,
      hosted_ai: { configured: true, active: true, affordable: false, canActivate: false },
      hosted_images: {
        portrait: { configured: true, affordable: false },
      },
    });
  });
});

describe("hosted image Hall Passes", () => {
  it("spends Hall Passes for hosted teacher images without requiring AI Access", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-teacher-image-funded";
    const record = {
      userId: "hosted-teacher-image-no-ai-pass-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Teacher Image",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.claimWelcomeHallPasses(stateKey);
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: "data:image/png;base64,TEACHER" } }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/teacher/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId: "teacher-image-funded-1",
          name: "Signal Coach",
          personality: "Turns signal notes into study cards.",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      profileImageUrl: "data:image/png;base64,TEACHER",
      hallPassCost: 1,
      hallPasses: 4,
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-spend" &&
      tx.source === "hosted-image" &&
      tx.metadata?.route === "teacher-portrait" &&
      tx.metadata?.requestId === "teacher-image-funded-1" &&
      tx.metadata?.status === "completed"
    )).toBe(true);
  });

  it("rejects hosted portraits when the wallet has no Hall Passes", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-empty-wallet";
    auth.injectSessionForTest(token, {
      userId: "hosted-portrait-empty-wallet-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait",
    });
    emptyWelcomeHallPasses("rh:user:hosted-portrait-empty-wallet-user");
    (globalThis.fetch as any).mockClear();

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId: "portrait-funded-1",
          name: "Mina",
          personality: "Quietly intense and observant.",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toContain("Need 1 Hall Pass or 1 burned Card");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("converts burned card value before spending for hosted portraits", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-card-burn";
    const record = {
      userId: "hosted-portrait-card-burn-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait Card Burn",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    emptyWelcomeHallPasses(stateKey);
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "test:portrait-card-burn-pack",
      source: "admin",
    });
    const card = grant.cards![0]!;
    ruby.recordHallPassCardMint(stateKey, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mMintSignature111111111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });
    restoreHallPassBurnVerifier = setHallPassNftBurnVerifierForTest(async (burn) => ({
      signature: burn.burnSignature,
      ownerWalletAddress: burn.ownerWalletAddress,
      mintAddress: burn.mintAddress,
      slot: 123,
    }));
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: "data:image/png;base64,BURNED" } }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId: "portrait-card-burn-1",
          name: "Mina",
          personality: "Quietly intense and observant.",
          hallPassBurns: [{
            cardId: card.id,
            ownerWalletAddress,
            mintAddress,
            burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
          }],
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      portraitDataUrl: "data:image/png;base64,BURNED",
      hallPassCost: 1,
      hallPasses: 4,
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(4);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-card-burn" &&
      tx.hallPasses === 5 &&
      tx.metadata?.hallPassesPerCard === 5 &&
      tx.metadata?.requestId === "portrait-card-burn-1"
    )).toBe(true);
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-spend" &&
      tx.hallPasses === -1 &&
      tx.metadata?.requestId === "portrait-card-burn-1" &&
      tx.metadata?.status === "completed"
    )).toBe(true);
  });

  it("spends Hall Passes for server-hosted portraits", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-funded-wallet";
    const record = {
      userId: "hosted-portrait-funded-wallet-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.grantHallPasses(stateKey, {
      amount: 2,
      idempotencyKey: "stripe:checkout:funded",
      source: "stripe",
    });
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: "data:image/png;base64,AAAA" } }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          name: "Mina",
          personality: "Quietly intense and observant.",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      portraitDataUrl: "data:image/png;base64,AAAA",
      hallPassCost: 1,
      hallPasses: 1,
      entitlements: {
        hallPasses: 1,
        hosted_images: {
          portrait: { configured: true, cost: 1, affordable: true, canUseHosted: true },
          diploma: { configured: true, cost: 3, affordable: false, canUseHosted: false },
        },
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(1);
  });

  it("uses a Photo Day credit before Hall Passes for hosted character portraits", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-photo-day";
    const record = {
      userId: "hosted-portrait-photo-day-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait Photo Day",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    emptyWelcomeHallPasses(stateKey);
    ruby.grantHallPasses(stateKey, {
      amount: 1,
      idempotencyKey: "test:photo-day-slot-fund",
      source: "admin",
    });
    ruby.unlockCharacterSlot(stateKey, {
      requestId: "photo-day-slot-2",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
    expect(ruby.characterSlotEntitlements(stateKey).photoDayCredits).toBe(1);
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: "data:image/png;base64,PHOTO" } }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId: "portrait-photo-day-1",
          name: "Mina",
          personality: "Quietly intense and observant.",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      portraitDataUrl: "data:image/png;base64,PHOTO",
      hallPassCost: 0,
      hallPasses: 0,
      photoDayCreditsUsed: true,
      characterSlots: {
        photoDayCredits: 0,
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(0);
    expect(ruby.characterSlotEntitlements(stateKey).photoDayCredits).toBe(0);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.kind === "photo-day-spend" &&
      tx.source === "photo-day" &&
      tx.metadata?.requestId === "portrait-photo-day-1" &&
      tx.metadata?.status === "completed"
    )).toBe(true);
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-spend" &&
      tx.source === "hosted-image" &&
      tx.metadata?.requestId === "portrait-photo-day-1"
    )).toBe(false);
  });

  it("refunds hosted portrait spend when generation fails", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-refund-wallet";
    const record = {
      userId: "hosted-portrait-refund-wallet-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait Refund",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.grantHallPasses(stateKey, {
      amount: 1,
      idempotencyKey: "stripe:checkout:refund",
      source: "stripe",
    });
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId: "portrait-fail-1",
          name: "Mina",
          personality: "Quietly intense and observant.",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(502);
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(1);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-spend" &&
      tx.source === "hosted-image" &&
      tx.metadata?.requestId === "portrait-fail-1" &&
      tx.metadata?.status === "failed"
    )).toBe(true);
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-refund" &&
      tx.source === "hosted-image" &&
      tx.metadata?.requestId === "portrait-fail-1"
    )).toBe(true);
  });

  it("replays a completed hosted portrait request without spending twice", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-replay-wallet";
    const record = {
      userId: "hosted-portrait-replay-wallet-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait Replay",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.grantHallPasses(stateKey, {
      amount: 2,
      idempotencyKey: "stripe:checkout:replay",
      source: "stripe",
    });
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: "data:image/png;base64,REPLAY" } }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const requestBody = {
      requestId: "portrait-replay-1",
      name: "Mina",
      personality: "Quietly intense and observant.",
    };
    const firstRes = new TestResponse();
    const firstHandled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      firstRes,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: requestBody,
      },
    ));
    expect(firstHandled).toBe(true);
    expect(firstRes.statusCode).toBe(200);
    expect(JSON.parse(firstRes.body)).toMatchObject({
      portraitDataUrl: "data:image/png;base64,REPLAY",
      hallPasses: 1,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const secondRes = new TestResponse();
    const secondHandled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      secondRes,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: requestBody,
      },
    ));

    expect(secondHandled).toBe(true);
    expect(secondRes.statusCode).toBe(200);
    expect(JSON.parse(secondRes.body)).toMatchObject({
      portraitDataUrl: "data:image/png;base64,REPLAY",
      hallPasses: 1,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.filter((tx) =>
      tx.kind === "hall-pass-spend" &&
      tx.source === "hosted-image" &&
      tx.metadata?.requestId === "portrait-replay-1"
    )).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPasses).toBe(1);
  });

  it("refunds stale pending hosted image spends before rejecting the replay", async () => {
    process.env.RUBY_HIGH_OPENROUTER_API_KEY = "sk-hosted";
    const token = "hosted-portrait-stale-pending";
    const record = {
      userId: "hosted-portrait-stale-pending-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Hosted Portrait Stale Pending",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    const requestId = "portrait-stale-1";
    const fingerprintPayload = {
      name: "Mina",
      personality: "Quietly intense and observant.",
      playbookId: null,
      stats: null,
    };
    const spendKey = hostedImageSpendKey("character-portrait", requestId);
    ruby.claimWelcomeHallPasses(stateKey);
    ruby.spendHallPasses(stateKey, {
      amount: 1,
      idempotencyKey: spendKey,
      source: "hosted-image",
      description: "Custom character portrait",
      at: Date.now() - 20 * 60 * 1000,
      metadata: {
        route: "character-portrait",
        requestId,
        fingerprint: hostedImageFingerprint("character-portrait", fingerprintPayload),
        status: "pending",
      },
    });
    expect(ruby.hallPassBalance(stateKey)).toBe(4);
    (globalThis.fetch as any).mockClear();
    process.env.RUBY_HIGH_PORTRAIT_HALL_PASS_COST = "2";

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/character/portrait"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        body: {
          requestId,
          name: fingerprintPayload.name,
          personality: fingerprintPayload.personality,
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("timed out");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ruby.hallPassBalance(stateKey)).toBe(5);
    const transactions = ruby.getOrCreate(stateKey).wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.id === spendKey &&
      tx.kind === "hall-pass-spend" &&
      tx.metadata?.status === "failed"
    )).toBe(true);
    expect(transactions.some((tx) =>
      tx.id === `${spendKey}:refund` &&
      tx.kind === "hall-pass-refund" &&
      tx.source === "hosted-image" &&
      tx.hallPasses === 1
    )).toBe(true);
  });
});

describe("chat event context", () => {
  it("generates Chat button player lines from the character voice and visible room context", async () => {
    const token = "route-player-line-token";
    const record = {
      userId: "route-player-line-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Player Line",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.createCharacter(stateKey, {
      name: "Mina",
      playbookId: "outsider",
      stats: { head: 2, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "I want to notice what everyone else keeps stepping around.",
      flavorQuote: "the answer is hiding in the part nobody wants to read",
      personality: "Quietly intense, observant, and allergic to obvious answers.",
    });
    ruby.pickAndPose(stateKey, { faculty: "ruby" });
    chat.appendPlayerMessage({ sessionToken: token, faculty: "ruby" }, "Ruby, I think the board is trying to trick us.");

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Mika, am I supposed to trust the wording or the pattern here?" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/player-line"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          context: { intent: "hint" },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).line).toBe("Mika, am I supposed to trust the wording or the pattern here?");
    expect(capturedChatRequest).not.toBeNull();
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("You are writing the next chat bubble for the player's avatar, Mina");
    expect(promptText).toContain("Quietly intense, observant");
    expect(promptText).toContain("Recent dialogue");
    expect(promptText).toContain("Ruby, I think the board is trying to trick us.");
    expect(promptText).toContain("Hidden from the player right now: the correct answer.");
    expect(promptText).not.toContain("Correct choice:");
  });

  it("can persist Chat button player lines when a student is the only responder", async () => {
    const token = "route-player-line-student-record-token";
    const record = {
      userId: "route-player-line-student-record-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Player Student Record",
    };
    auth.injectSessionForTest(token, record);
    ruby.createCharacter(auth.stateKeyForRecord(record), {
      name: "Mina",
      playbookId: "outsider",
      stats: { head: 2, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "I want to notice what everyone else keeps stepping around.",
      personality: "Quietly intense, observant, and allergic to obvious answers.",
    });
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "nah mina that wording is definitely suspicious" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/student-chime"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          studentId: "sami",
          situation: "player-chat",
          playerText: "Does this wording feel too neat to anyone else?",
          recordPlayerText: true,
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(chat.history({ sessionToken: token, faculty: "ruby" }).some((m) => (
      m.role === "user" && m.content === "Does this wording feel too neat to anyone else?"
    ))).toBe(true);
  });

  it("replaces one-word student chimes with a fuller fallback line", async () => {
    const token = "route-student-chime-fallback-token";
    const record = {
      userId: "route-student-chime-fallback-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Student Chime Fallback",
    };
    auth.injectSessionForTest(token, record);
    ruby.createCharacter(auth.stateKeyForRecord(record), {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "yo" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/student-chime"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          studentId: "mika",
          situation: "answer-correct",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(JSON.stringify(capturedChatRequest.body.messages)).toContain("At least 4 words");
    expect(JSON.parse(res.body).line).toBe("okay Vince, nice one - that answer was clean.");
  });

  it("routes Chat button player lines through one room turn ledger before a student response", async () => {
    const token = "route-room-turn-student-token";
    const record = {
      userId: "route-room-turn-student-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Room Turn Student",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.createCharacter(stateKey, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(stateKey, "9");
    ruby.pickAndPose(stateKey, { faculty: "ruby" });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const requests: any[] = [];
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [, init] = args;
      requests.push(init?.body ? JSON.parse(init.body) : null);
      const content = requests.length === 1
        ? "Can someone give me the first clue without saying it outright?"
        : "wait Vince, check the wording first - that's where the trap is.";
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/room-turn"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          context: { intent: "hint" },
          clientTurnSeq: 1,
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: player-line");
    expect(res.body).toContain("Can someone give me the first clue without saying it outright?");
    expect(res.body).toContain("event: student");
    expect(res.body).toContain("wait Vince, check the wording first");
    const history = chat.history({ sessionToken: token, faculty: "ruby" });
    expect(history.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "Can someone give me the first clue without saying it outright?",
    ]);
    expect(chat.events_for_test({ sessionToken: token, faculty: "ruby" }).some((event) =>
      event.kind === "chime" && event.text.includes("wait Vince")
    )).toBe(true);
    expect(JSON.stringify(requests[0].messages)).toContain("You are writing the next chat bubble for the player's avatar, Vince");
    expect(JSON.stringify(requests[1].messages)).toContain("Situation: player-asked-hint");
  });

  it("keeps room turns usable when player-line generation falls back", async () => {
    const token = "route-room-turn-player-fallback-token";
    const record = {
      userId: "route-room-turn-player-fallback-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Room Turn Player Fallback",
    };
    auth.injectSessionForTest(token, record);
    const stateKey = auth.stateKeyForRecord(record);
    ruby.createCharacter(stateKey, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(stateKey, "9");
    ruby.pickAndPose(stateKey, { faculty: "ruby" });
    vi.spyOn(Math, "random").mockReturnValue(0);
    let calls = 0;
    (globalThis.fetch as any).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return new Response("player model down", { status: 500, statusText: "Bad Gateway" });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "yo" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/room-turn"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          context: { intent: "hint" },
          clientTurnSeq: 1,
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: player-line");
    expect(res.body).toContain("Can someone give me the first clue without saying it outright?");
    expect(res.body).toContain("event: student");
    expect(res.body).not.toContain("event: error");
    const history = chat.history({ sessionToken: token, faculty: "ruby" });
    expect(history.some((m) =>
      m.role === "user" && m.content === "Can someone give me the first clue without saying it outright?"
    )).toBe(true);
  });

  it("shows the same completed class report board to the player avatar prompt", async () => {
    const token = "route-player-line-report-board-token";
    auth.injectSessionForTest(token, {
      userId: "route-player-line-report-board-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Player Report Board",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sessionId, "10");
    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sessionId, { faculty: "sally-science" });
      const wrong = posed.current!.correct === "A" ? "B" : "A";
      ruby.submitAnswer(sessionId, wrong as "A" | "B" | "C" | "D");
      ruby.clearBoard(sessionId);
    }

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Okay, that F is loud. Can we practice the weak spot now?" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/player-line"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          context: { intent: "advance" },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).line).toBe("Okay, that F is loud. Can we practice the weak spot now?");
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("Visible board: class report card for Sally Science.");
    expect(promptText).toContain("Today's graded class is complete.");
    expect(promptText).not.toContain("3/3 questions");
    expect(promptText).toContain("Final grade shown: F.");
    expect(promptText).toContain("The report card says practice is open");
    expect(promptText).not.toContain("Visible board: empty");
  });

  it("threads the resolved card snapshot into answer-graded teacher turns", async () => {
    const token = "route-event-token";
    const record = {
      userId: "route-event-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Event",
    };
    auth.injectSessionForTest(token, record);
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Nice work.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            grade: "9",
            questionId: "cell-q1",
            prompt: "Which organelle is known as the powerhouse of the cell?",
            type: "multiple-choice",
            subject: "biology",
            difficulty: "easy",
            options: {
              A: "Nucleus",
              B: "Mitochondria",
              C: "Ribosome",
              D: "Chloroplast",
            },
            picked: "B",
            correct: "B",
            pickedAnswer: "B) Mitochondria",
            correctAnswer: "B) Mitochondria",
            explanation: "Mitochondria generate ATP.",
            wasCorrect: true,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("RESOLVED CARD SNAPSHOT");
    expect(promptText).toContain("Which organelle is known as the powerhouse of the cell?");
    expect(promptText).toContain("B) Mitochondria");
    expect(promptText).toContain("Mitochondria generate ATP");
    expect(promptText).toContain("Use this snapshot for the reaction");
  });

  it("resolves forced opinion grading with the deterministic fallback when the AI grader fails", async () => {
    const token = "route-opinion-grader-fallback-token";
    auth.injectSessionForTest(token, {
      userId: "route-opinion-grader-fallback-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Opinion Fallback",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.poseOpinion(sessionId, {
      prompt: "When a classmate answers confidently, what should you trust and what should you check?",
      faculty: "ruby",
    });
    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response("grader down", { status: 500, statusText: "Bad Gateway" });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/opinion-submit"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: { force: true },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: opinion-graded");
    expect(res.body).not.toContain("event: error");
    const state = ruby.getOrCreate(sessionId);
    expect(state.activeRound?.resolved).toBe(true);
    expect(state.lastReveal).toMatchObject({
      questionId: state.current?.id,
      questionType: "opinion",
    });
    expect(state.activeRound?.opinionResponses.some((r) => r.responder === "player")).toBe(true);
    expect(state.activeRound?.opinionGrades.some((g) => g.responder === "player")).toBe(true);
  });

  it("grades a submitted opinion instead of waiting on the round timeout when NPCs are missing", async () => {
    const token = "route-opinion-submit-no-timeout-token";
    auth.injectSessionForTest(token, {
      userId: "route-opinion-submit-no-timeout-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Opinion No Timeout",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sessionId, "9");
    ruby.poseOpinion(sessionId, {
      prompt: "When a classmate answers confidently, what should you trust and what should you check?",
      faculty: "ruby",
    });
    const round = ruby.getOrCreate(sessionId).activeRound;
    expect(round?.type).toBe("opinion");
    expect(round!.npcs.length).toBeGreaterThan(0);

    (globalThis.fetch as any).mockImplementation(async () => {
      return new Response("openrouter down", { status: 500, statusText: "Bad Gateway" });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/opinion-submit"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: { text: "I trust a clear trail of evidence and check the source behind the confidence." },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: opinion-graded");
    expect(res.body).not.toContain("event: waiting");
    expect(res.body).not.toContain("event: error");
    const state = ruby.getOrCreate(sessionId);
    expect(state.activeRound?.resolved).toBe(true);
    expect(state.activeRound?.opinionResponses.map((r) => r.responder)).toEqual(
      expect.arrayContaining(["player", ...round!.npcs.map((n) => n.studentId)]),
    );
    expect(state.activeRound?.opinionGrades.some((g) => g.responder === "player")).toBe(true);
  });

  it("drops answer-graded teacher turns when the live reveal has moved on", async () => {
    const token = "route-stale-answer-token";
    auth.injectSessionForTest(token, {
      userId: "route-stale-answer-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Stale Answer",
    });
    const state = ruby.getOrCreate(auth.stateKeyForToken(token));
    state.faculty = "sally-science";
    state.lastReveal = {
      questionId: "current-q",
      picked: "A",
      correct: "A",
      wasCorrect: true,
      forfeit: false,
      explanation: null,
      encouragement: null,
    };
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("This should not run.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            questionId: "old-q",
            picked: "B",
            correct: "B",
            wasCorrect: true,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).toBeNull();
    expect(res.body).toContain("stale-answer");
  });

  it("threads lounge Chat button player lines into the next faculty turn", async () => {
    const token = "route-lounge-player-line-token";
    auth.injectSessionForTest(token, {
      userId: "route-lounge-player-line-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Lounge Player",
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Pull up a chair.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "lounge",
          trigger: "manual",
          context: {
            playerLine: "Can I sit in for a minute?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const messages = capturedChatRequest.body.messages as Array<{ role?: string; content?: string }>;
    expect(messages.some((m) => m.role === "user" && m.content === "Can I sit in for a minute?")).toBe(true);
    const promptText = JSON.stringify(messages);
    expect(promptText).toContain("The student just spoke in the lounge");
    expect(capturedChatRequest.body.tools).toEqual([]);
  });

  it("includes the active guest teacher in lounge enter turns", async () => {
    registerPublicPack(fakePublicGuestPack(), 1_000);
    const token = "route-lounge-guest-token";
    auth.injectSessionForTest(token, {
      userId: "route-lounge-guest-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Lounge Guest",
    });
    const calls: any[] = [];
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      calls.push(capturedChatRequest);
      return new Response(buildSseChunk("The lounge keeps odd hours.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "lounge",
          trigger: "lounge-enter",
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"facultyId":"guest"');
    expect(calls).toHaveLength(4);
    const loungeContexts = calls.flatMap((call) =>
      (call.body.messages as Array<{ role?: string; content?: string }>)
        .filter((m) => typeof m.content === "string" && m.content.startsWith("LOUNGE CONTEXT"))
        .map((m) => m.content as string)
    );
    expect(loungeContexts.length).toBeGreaterThan(0);
    expect(loungeContexts[0]).toContain("Dr. Wells");
    expect(loungeContexts[0]).not.toMatch(/\btools?\b/i);
    expect(capturedChatRequest.body.model).toBe("test/guest-model");
  });

  it("threads classroom Chat button player lines into the teacher turn", async () => {
    const token = "route-class-player-line-token";
    auth.injectSessionForTest(token, {
      userId: "route-class-player-line-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Class Player",
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Let's work it from the first clue.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            playerLine: "Can someone pressure-test my answer?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const messages = capturedChatRequest.body.messages as Array<{ role?: string; content?: string }>;
    expect(messages.some((m) => m.role === "user" && m.content === "Can someone pressure-test my answer?")).toBe(true);
    const promptText = JSON.stringify(messages);
    expect(promptText).toContain("Can someone pressure-test my answer?");
    expect(promptText).toContain("Reply directly in character");
  });

  it("manual advance Chat turns post a board even when the teacher only narrates", async () => {
    const token = "route-manual-advance-fallback-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-advance-fallback-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Advance",
    });
    const sessionId = auth.stateKeyForToken(token);
    const state = ruby.getOrCreate(sessionId);
    state.faculty = "ruby";
    expect(state.current).toBeNull();

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Let's take the next card cleanly.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "advance",
            playerLine: "What is the read in this room?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(JSON.stringify(capturedChatRequest.body.messages)).toContain("scheduler will put the next card on the board");
    expect(res.body).toContain("pick_from_bank");
    expect(res.body).toContain("fallback: auto-posed next question");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.resolved).toBe(false);
  });

  it("manual advance Chat moves a completed class report into a practice board", async () => {
    const token = "route-class-report-advance-token";
    auth.injectSessionForTest(token, {
      userId: "route-class-report-advance-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Class Report Advance",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sessionId, "10");

    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sessionId, { faculty: "sally-science" });
      const wrong = posed.current!.correct === "A" ? "B" : "A";
      ruby.submitAnswer(sessionId, wrong as "A" | "B" | "C" | "D");
      ruby.clearBoard(sessionId);
    }
    expect(ruby.courseProgress(sessionId, "sally-science").today.status).toBe("complete");
    expect(ruby.getOrCreate(sessionId).current).toBeNull();

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Practice is open; let's take one more cleanly.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "manual",
          context: {
            intent: "advance",
            playerLine: "Okay, practice then. What are we doing next?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("BOARD STATUS: CLASS_REPORT.");
    expect(promptText).toContain("The chalkboard is showing today's Sally Science class report card");
    expect(promptText).not.toContain("BOARD STATUS: EMPTY.");
    expect(promptText).toContain("scheduler will put the next card on the board");
    expect(promptText).toContain("Do not say tool names like pick_from_bank");
    expect(res.body).toContain("fallback: auto-posed next question");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current).not.toBeNull();
    expect(after.activeRound?.resolved).toBe(false);
    expect(after.activeRound?.classSession?.mode).toBe("practice");
  });

  it("manual hint Chat turns never change the current board", async () => {
    const token = "route-manual-hint-no-board-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-hint-no-board-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Hint",
    });
    const sessionId = auth.stateKeyForToken(token);
    const before = ruby.pickAndPose(sessionId, { faculty: "ruby" });
    const questionId = before.current!.id;

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Start with the most specific clue.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "hint",
            playerLine: "What should I notice first?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(capturedChatRequest.body.tools).toEqual([]);
    expect(res.body).not.toContain("pick_from_bank");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current?.id).toBe(questionId);
    expect(after.phase).toBe("asking");
    expect(after.activeRound?.resolved).toBe(false);
  });

  it("manual report Chat turns never post a new board", async () => {
    const token = "route-manual-report-no-board-token";
    auth.injectSessionForTest(token, {
      userId: "route-manual-report-no-board-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      label: "Route Manual Report",
    });
    const sessionId = auth.stateKeyForToken(token);
    ruby.pickAndPose(sessionId, { faculty: "ruby" });
    const questionId = ruby.getOrCreate(sessionId).current!.id;
    const correct = ruby.getOrCreate(sessionId).current!.correct as "A" | "B" | "C" | "D";
    ruby.submitAnswer(sessionId, correct);

    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("That result tells us where to tighten up.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "ruby",
          trigger: "manual",
          context: {
            intent: "report",
            playerLine: "How did that class actually go?",
          },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedChatRequest).not.toBeNull();
    expect(capturedChatRequest.body.tools).toEqual([]);
    expect(res.body).not.toContain("pick_from_bank");
    const after = ruby.getOrCreate(sessionId);
    expect(after.current?.id).toBe(questionId);
    expect(after.phase).toBe("revealed");
    expect(after.activeRound?.resolved).toBe(true);
  });

  it("describes answer-graded timeouts without inventing a player pick", async () => {
    const token = "route-timeout-token";
    auth.injectSessionForTest(token, {
      userId: "route-timeout-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    (globalThis.fetch as any).mockImplementation(async (...args: any[]) => {
      const [input, init] = args;
      capturedChatRequest = {
        url: typeof input === "string" ? input : input.url,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      return new Response(buildSseChunk("Clock got them.") as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: "sally-science",
          trigger: "answer-graded",
          context: {
            prompt: "Which organelle is known as the powerhouse of the cell?",
            options: { A: "Nucleus", B: "Mitochondria", C: "Ribosome", D: "Chloroplast" },
            picked: null,
            correct: "B",
            correctAnswer: "B) Mitochondria",
            forfeit: true,
            wasCorrect: false,
          },
        },
      },
    ));

    expect(handled).toBe(true);
    const promptText = JSON.stringify(capturedChatRequest.body.messages);
    expect(promptText).toContain("Player answer: no answer (timeout)");
    expect(promptText).toContain("Time expired before");
    expect(promptText).not.toContain("answered A");
    expect(promptText).not.toContain("Player answer: A");
  });
});

describe("guest access gates", () => {
  it("blocks guest chat requests for classrooms outside homeroom + daily lesson", async () => {
    const token = "route-guest-gate-faculty-token";
    const record = {
      userId: "route-guest-gate-faculty-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      provider: "guest" as const,
      label: "Guest",
    };
    auth.injectSessionForTest(token, record);
    const sessionId = auth.stateKeyForRecord(record);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sessionId, "9");
    const dailyFaculty = ruby.dailyStatus(sessionId).facultyId;
    const blockedFaculty = ["sally-science", "professor-edward", "guest", "lounge"]
      .find((id) => id !== "ruby" && id !== dailyFaculty) ?? "lounge";

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: { faculty: blockedFaculty, message: "Hello?" },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Guest mode is limited to Homeroom");
  });

  it("requires signup after a guest completes today's daily lesson", async () => {
    const token = "route-guest-gate-signup-token";
    const record = {
      userId: "route-guest-gate-signup-user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      provider: "guest" as const,
      label: "Guest",
    };
    auth.injectSessionForTest(token, record);
    const sessionId = auth.stateKeyForRecord(record);
    ruby.createCharacter(sessionId, {
      name: "Vince",
      playbookId: "outsider",
      stats: { head: 1, heart: 0, hustle: 2, honor: -1 },
      arcAnswer: "I want the room to notice when I am actually trying.",
      personality: "Restless, social, and eager to keep the room moving.",
    });
    ruby.selectGrade(sessionId, "9");
    const dailyFaculty = ruby.dailyStatus(sessionId).facultyId;
    for (let i = 0; i < 8; i += 1) {
      const status = ruby.dailyStatus(sessionId);
      if (!status.available) break;
      ruby.playBonus(sessionId);
      ruby.submitAnswer(sessionId, "A");
    }
    expect(ruby.dailyStatus(sessionId).available).toBe(false);
    expect(ruby.dailyStatus(sessionId).reason).toBe("completed");

    const res = new TestResponse();
    const handled = await handleChatRoutes(makeCtx(
      new URL("http://localhost:3000/api/apps/ruby-high/chat/event"),
      res,
      {
        method: "POST",
        cookieHeader: `rh_session=${token}`,
        apiKeyHeader: "sk-test",
        body: {
          faculty: dailyFaculty,
          trigger: "manual",
          context: { intent: "advance", playerLine: "What's next?" },
        },
      },
    ));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Sign up to continue");
  });
});
