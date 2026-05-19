import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleNftRoutes } from "../routes/nft.js";
import type { RouteContext } from "../routes/context.js";
import { getActivePack } from "../content/registry.js";
import {
  deterministicMintSignatureForTest,
  setHallPassNftMinterForTest,
} from "../services/hall-pass-nfts.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;
let restoreMinter: (() => void) | null = null;

const OWNER = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_PUBLIC_BASE_URL: process.env.RUBY_HIGH_PUBLIC_BASE_URL,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeCtx(opts: {
  method: string;
  path: string;
  cookie?: string | null;
  body?: any;
}): RouteContext {
  lastResponse = null;
  return {
    method: opts.method,
    pathname: opts.path,
    url: new URL(`https://ruby-high.ai${opts.path}`),
    runtime: null,
    res: {} as never,
    cookieHeader: opts.cookie ?? null,
    error: (_res, message, status = 500) => { lastResponse = { status, body: { error: message } }; },
    json: (_res, data, status = 200) => { lastResponse = { status, body: data }; },
    readJsonBody: async () => opts.body ?? {},
  };
}

function deps() {
  return { auth, ruby };
}

function signInUser(token: string): string {
  const userId = `nft-${token}`;
  const now = Date.now();
  auth.injectSessionForTest(token, {
    userId,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  });
  return `rh:user:${userId}`;
}

beforeEach(async () => {
  restoreEnv();
  process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
  process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";
  restoreMinter = setHallPassNftMinterForTest(async (card, ownerWalletAddress) => (
    deterministicMintSignatureForTest(card, ownerWalletAddress)
  ));
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-nft-routes-"));
  const store = new StateStore(join(tmpDir, "state.json"), { debounceMs: 0 });
  auth = await AuthService.start({} as never, store);
  ruby = new RubyHighService({} as never, store);
  await getActivePack();
  await ruby["hydrate"]();
});

afterEach(async () => {
  restoreEnv();
  restoreMinter?.();
  restoreMinter = null;
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("Hall Pass NFT routes", () => {
  it("serves public Hall Pass metadata", async () => {
    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/lyra/123456.json",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Lyra Ruby High Card #123456",
      symbol: "RUBY",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/students/lyra-full.png",
    });
  });

  it("mints unminted active Hall Pass cards and records signatures", async () => {
    const stateKey = signInUser("alice");
    const grant = ruby.grantHallPasses(stateKey, {
      amount: 20,
      idempotencyKey: "stripe:checkout:cs_nft",
      source: "stripe",
    });
    expect(grant.cards).toHaveLength(20);
    expect(ruby.mintableHallPassCards(stateKey)).toHaveLength(25);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pending",
      cookie: "rh_session=alice",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(8);
    expect(lastResponse?.body.remaining).toBe(17);
    const cards = ruby.getOrCreate(stateKey).wallet.hallPassCards ?? [];
    expect(cards.filter((card) => card.mintAddress && card.mintSignature && card.metadataUri)).toHaveLength(8);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("rejects minting when NFT authority is not configured", async () => {
    delete process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY;
    signInUser("bob");

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pending",
      cookie: "rh_session=bob",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(503);
    expect(lastResponse?.body.error).toContain("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY");
  });
});
