import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleNftRoutes } from "../routes/nft.js";
import type { RouteContext } from "../routes/context.js";
import { getActivePack } from "../content/registry.js";
import {
  deterministicMintSignatureForTest,
  setHallPassNftBurnTransactionBuilderForTest,
  setHallPassNftBurnVerifierForTest,
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
let restoreBurnBuilder: (() => void) | null = null;
let restoreBurnVerifier: (() => void) | null = null;

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
  const url = new URL(`https://ruby-high.ai${opts.path}`);
  return {
    method: opts.method,
    pathname: url.pathname,
    url,
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
  restoreBurnBuilder = setHallPassNftBurnTransactionBuilderForTest(async (card, ownerWalletAddress) => ({
    ownerWalletAddress,
    mintAddress: card.mintAddress || "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
    tokenAccountAddress: "TokenAccount1111111111111111111111111111111",
    transaction: "AQID",
    transactionEncoding: "base64",
    rpcUrl: "https://rpc.example",
  }));
  restoreBurnVerifier = setHallPassNftBurnVerifierForTest(async (burn) => ({
    signature: burn.burnSignature,
    ownerWalletAddress: burn.ownerWalletAddress,
    mintAddress: burn.mintAddress,
    slot: 123,
  }));
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
  restoreBurnBuilder?.();
  restoreBurnBuilder = null;
  restoreBurnVerifier?.();
  restoreBurnVerifier = null;
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
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/cards/lyra.png?v=card-v1",
    });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Rarity", value: "Common" });
  });

  it("serves Core pack metadata with Ruby High pack artwork", async () => {
    const collectionHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/collection.json",
    }), deps());

    expect(collectionHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Ruby High Packs",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1",
    });

    const packHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json",
    }), deps());

    expect(packHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Ruby High Pack #123456",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2",
    });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: 5 });

    const legacyUriHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=4",
    }), deps());

    expect(legacyUriHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.description).toContain("5 cards inside");
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: 5 });
  });

  it("opens an active Pack NFT and mints five card NFTs", async () => {
    const stateKey = signInUser("open-pack");
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5",
      idempotencyKey: "solana:spl-token-transfer:open-pack-route",
      source: "solana",
    }).pack!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: true,
        cardCount: 5,
        pack: { id: pack.id, status: "opened" },
      },
    });
    expect(lastResponse?.body.cards).toHaveLength(5);
    expect(lastResponse?.body.minted).toHaveLength(5);
    expect(lastResponse?.body.remaining).toBe(0);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      id: pack.id,
      status: "opened",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards).toHaveLength(5);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress && card.mintSignature && card.metadataUri)).toHaveLength(5);
  });

  it("mints unminted active Hall Pass cards and records signatures", async () => {
    const stateKey = signInUser("alice");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 20,
      idempotencyKey: "stripe:checkout:cs_nft",
      source: "stripe",
    });
    expect(grant.cards).toHaveLength(20);
    expect(ruby.mintableHallPassCards(stateKey)).toHaveLength(20);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pack",
      cookie: "rh_session=alice",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(8);
    expect(lastResponse?.body.remaining).toBe(12);
    const cards = ruby.getOrCreate(stateKey).wallet.hallPassCards ?? [];
    expect(cards.filter((card) => card.mintAddress && card.mintSignature && card.metadataUri)).toHaveLength(8);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("returns partial mint success instead of failing the whole batch", async () => {
    restoreMinter?.();
    let attempts = 0;
    restoreMinter = setHallPassNftMinterForTest(async (card, ownerWalletAddress) => {
      attempts += 1;
      if (attempts > 2) throw new Error("insufficient funds for rent");
      return deterministicMintSignatureForTest(card, ownerWalletAddress);
    });
    const stateKey = signInUser("partial");
    ruby.grantHallPassCards(stateKey, {
      cardCount: 8,
      idempotencyKey: "stripe:checkout:cs_partial",
      source: "stripe",
    });

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pack",
      cookie: "rh_session=partial",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(2);
    expect(lastResponse?.body.warning).toContain("SOL");
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress)).toHaveLength(2);
  });

  it("prepares and confirms owner-signed card burns", async () => {
    const stateKey = signInUser("burn");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 4,
      idempotencyKey: "stripe:checkout:cs_burn",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    ruby.recordHallPassCardMint(stateKey, {
      cardId: card.id,
      ownerWalletAddress: OWNER,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mMintSignature111111111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/burn-prepare",
      cookie: "rh_session=burn",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.burn.transaction).toBe("AQID");

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/burn-confirm",
      cookie: "rh_session=burn",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
      },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.burn.slot).toBe(123);
  });

  it("prepares multiple owner-signed card burns in one transaction", async () => {
    const stateKey = signInUser("burn-batch");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 4,
      idempotencyKey: "stripe:checkout:cs_burn_batch",
      source: "stripe",
    });
    const cards = grant.cards!.slice(0, 2);
    cards.forEach((card, index) => {
      ruby.recordHallPassCardMint(stateKey, {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: index === 0
          ? "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump"
          : "BBoP7Eav3vUrF7kvQRrUMr7BXPr4u4D2nPWn84bWpump",
        mintSignature: `5mMintSignatureBatch${index}111111111111111111111111111111111111`,
        metadataUri: "https://ruby-high.ai/card.json",
      });
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/burn-prepare",
      cookie: "rh_session=burn-batch",
      body: { cardIds: cards.map((card) => card.id), ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.cards).toHaveLength(2);
    expect(lastResponse?.body.cards.map((card: { cardId: string }) => card.cardId)).toEqual(cards.map((card) => card.id));
    expect(lastResponse?.body.burn.transaction).toBe("AQID");
  });

  it("rejects minting when NFT authority is not configured", async () => {
    delete process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY;
    signInUser("bob");

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pack",
      cookie: "rh_session=bob",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(503);
    expect(lastResponse?.body.error).toContain("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY");
  });
});
