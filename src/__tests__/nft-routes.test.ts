import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleNftRoutes } from "../routes/nft.js";
import type { RouteContext } from "../routes/context.js";
import { getActivePack } from "../content/registry.js";
import { setOwnedCorePackNftFetcherForTest } from "../services/core-pack-nfts.js";
import {
  hallPassNftMetadataUri,
  setHallPassNftBurnTransactionBuilderForTest,
  setHallPassNftBurnVerifierForTest,
  setHallPassNftMinterForTest,
  setHallPassNftMintTransactionBuilderForTest,
  setHallPassNftMintSubmitterForTest,
  setHallPassNftMintVerifierForTest,
} from "../services/hall-pass-nfts.js";
import {
  FIRST_BELL_SET_CODE,
  FIRST_BELL_ALTERNATE_ART_PROFILES,
  FIRST_BELL_SET_DRAFT,
  FIRST_BELL_SET_EXPANSION_PROFILE_COUNT,
  FIRST_BELL_SET_LIVE_PROFILE_COUNT,
  FIRST_BELL_SET_NAME,
  FIRST_BELL_SET_TOTAL_PROFILES,
  HALL_PASS_CARD_CATALOG,
  hallPassCardAspectClass,
  hallPassCardImageDimensions,
  hallPassCardMediaType,
  hallPassCardName,
  hallPassCardProfileId,
  hallPassCardRarityLabel,
  hallPassCardRoleLabel,
  hallPassCardSetNumber,
  hallPassCardSourceArtVersion,
  hallPassCardSubject,
} from "../services/hall-pass-card-catalog.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;
let lastHeaders: Record<string, string> = {};
let restoreMinter: (() => void) | null = null;
let restoreMintBuilder: (() => void) | null = null;
let restoreMintSubmitter: (() => void) | null = null;
let restoreMintVerifier: (() => void) | null = null;
let restoreBurnBuilder: (() => void) | null = null;
let restoreBurnVerifier: (() => void) | null = null;
let restorePackFetcher: (() => void) | null = null;

const OWNER = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_PACK_REVEAL_SECRET: process.env.RUBY_HIGH_PACK_REVEAL_SECRET,
  RUBY_HIGH_SOLANA_CARD_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CARD_COLLECTION_ADDRESS,
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
  lastHeaders = {};
  const url = new URL(`https://ruby-high.ai${opts.path}`);
  const res = {
    setHeader(name: string, value: string) {
      lastHeaders[name.toLowerCase()] = value;
    },
  };
  return {
    method: opts.method,
    pathname: url.pathname,
    url,
    runtime: null,
    res: res as never,
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

function expectWebsiteLink(metadata: any, website = "https://ruby-high.ai/"): void {
  expect(metadata.external_url).toBe(website);
  expect(metadata.properties).toMatchObject({ website });
  expect(metadata.attributes).toContainEqual({ trait_type: "Website", value: website });
}

function expectMarketReadyImageMetadata(metadata: any, image: string): void {
  expect(metadata).toMatchObject({
    category: "image",
    seller_fee_basis_points: 0,
  });
  expect(metadata.properties).toMatchObject({
    category: "image",
    files: [{ uri: image, type: "image/png" }],
    creators: [{ address: expect.any(String), share: 100, verified: true }],
  });
}

beforeEach(async () => {
  restoreEnv();
  process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
  process.env.RUBY_HIGH_PACK_REVEAL_SECRET = "nft-route-test-reveal-secret";
  process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";
  restoreMinter = setHallPassNftMinterForTest(async (card, ownerWalletAddress) => ({
    ownerWalletAddress,
    mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
    mintSignature: "5mServerMintSignature111111111111111111111111111111111",
    metadataUri: `https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/card/${encodeURIComponent(card.id)}.json`,
  }));
  restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async (card, ownerWalletAddress) => ({
    cardId: card.id,
    ownerWalletAddress,
    mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
    metadataUri: `https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/card/${encodeURIComponent(card.id)}.json`,
    transactionBase64: "AQID",
    transactionEncoding: "base64",
    chain: "solana:mainnet",
    rpcUrl: "https://rpc.example",
  }));
  restoreMintSubmitter = setHallPassNftMintSubmitterForTest(async () => (
    "5mSubmittedCardMintSignature111111111111111111111111111111111"
  ));
  restoreMintVerifier = setHallPassNftMintVerifierForTest(async (mint) => ({
    signature: mint.mintSignature,
    ownerWalletAddress: mint.ownerWalletAddress,
    mintAddress: mint.mintAddress,
    metadataUri: mint.metadataUri,
    slot: 234,
  }));
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
  restoreMintBuilder?.();
  restoreMintBuilder = null;
  restoreMintSubmitter?.();
  restoreMintSubmitter = null;
  restoreMintVerifier?.();
  restoreMintVerifier = null;
  restoreBurnBuilder?.();
  restoreBurnBuilder = null;
  restoreBurnVerifier?.();
  restoreBurnVerifier = null;
  restorePackFetcher?.();
  restorePackFetcher = null;
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("Hall Pass NFT routes", () => {
  it("serves public Hall Pass metadata", async () => {
    const collectionHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/collection.json",
    }), deps());

    expect(collectionHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: FIRST_BELL_SET_NAME,
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1",
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1",
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set", value: "First Bell" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Code", value: FIRST_BELL_SET_CODE });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Edition", value: "First Bell Set" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Live Profiles", value: FIRST_BELL_SET_LIVE_PROFILE_COUNT });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Draft Profiles", value: FIRST_BELL_SET_TOTAL_PROFILES });
    expectWebsiteLink(lastResponse?.body);

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/lyra/123456.json",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Ruby High: Lyra #123456",
      symbol: "RUBY",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/lyra.png?v=card-crop-v1",
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/lyra.png?v=card-crop-v1",
    );
    expect(lastHeaders["cache-control"]).toBe("no-cache");
    expect(lastResponse?.body.collection).toMatchObject({
      name: FIRST_BELL_SET_NAME,
      family: "Ruby High",
    });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Collection", value: FIRST_BELL_SET_NAME });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Number", value: "FB-001" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Profile ID", value: "lyra-color-coded-spare" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Name", value: "Lyra: Color-Coded Spare" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Subject", value: "Homeroom" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Rarity", value: "Common" });
    expectWebsiteLink(lastResponse?.body);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/captain-null/777777.json",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Ruby High: Captain Null #777777",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/captain-null.png?v=card-crop-v1",
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/captain-null.png?v=card-crop-v1",
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Role", value: "Special" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Rarity", value: "Ultra Rare" });
    expectWebsiteLink(lastResponse?.body);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/not-real/1.json",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 404,
      body: { error: "Unknown Ruby High card character." },
    });
  });

  it("serves every canonical revealed card metadata profile", async () => {
    expect(HALL_PASS_CARD_CATALOG).toHaveLength(FIRST_BELL_SET_LIVE_PROFILE_COUNT);
    expect(FIRST_BELL_SET_DRAFT).toHaveLength(FIRST_BELL_SET_TOTAL_PROFILES);
    expect(FIRST_BELL_SET_DRAFT.filter((profile) => profile.mintable)).toHaveLength(FIRST_BELL_SET_LIVE_PROFILE_COUNT);
    expect(FIRST_BELL_ALTERNATE_ART_PROFILES).toHaveLength(FIRST_BELL_SET_EXPANSION_PROFILE_COUNT);
    expect(new Set(FIRST_BELL_ALTERNATE_ART_PROFILES.map((profile) => profile.imageId ?? profile.profileId)).size).toBe(FIRST_BELL_SET_EXPANSION_PROFILE_COUNT);

    for (const entry of HALL_PASS_CARD_CATALOG) {
      const handled = await handleNftRoutes(makeCtx({
        method: "GET",
        path: `/api/apps/ruby-high/nft/metadata/hall-pass/${entry.characterId}/424242.json`,
      }), deps());

      expect(handled).toBe(true);
      expect(lastResponse?.status).toBe(200);
      expect(lastResponse?.body).toMatchObject({
        name: `Ruby High: ${entry.characterName} #424242`,
        image: `https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/${entry.characterId}.png?v=card-crop-v1`,
      });
      expectMarketReadyImageMetadata(
        lastResponse?.body,
        `https://ruby-high.ai/api/apps/ruby-high/assets/nft/market-cards/${entry.characterId}.png?v=card-crop-v1`,
      );
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Title", value: entry.title });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set", value: "First Bell" });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Code", value: FIRST_BELL_SET_CODE });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Number", value: hallPassCardSetNumber(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Profile ID", value: hallPassCardProfileId(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Name", value: hallPassCardName(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Role", value: hallPassCardRoleLabel(entry.role) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Rarity", value: hallPassCardRarityLabel(entry.rarity) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Subject", value: hallPassCardSubject(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Media Type", value: hallPassCardMediaType(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Aspect Class", value: hallPassCardAspectClass(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Image Dimensions", value: hallPassCardImageDimensions(entry) });
      expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Source Art Version", value: hallPassCardSourceArtVersion(entry) });
      expectWebsiteLink(lastResponse?.body);
      expect(lastHeaders["cache-control"]).toBe("no-cache");
    }
  });

  it("serves Core pack metadata with Ruby High pack artwork", async () => {
    const collectionHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/collection.json",
    }), deps());

    expect(collectionHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: `${FIRST_BELL_SET_NAME} Packs`,
      category: "image",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1",
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1",
    );
    expectWebsiteLink(lastResponse?.body);

    const packHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json",
    }), deps());

    expect(packHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: `${FIRST_BELL_SET_NAME} Pack #123456`,
      category: "image",
      image: "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2",
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2",
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set", value: "First Bell" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Code", value: FIRST_BELL_SET_CODE });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "NFT Type", value: "Pack" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: 5 });
    expectWebsiteLink(lastResponse?.body);

    const legacyUriHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=4",
    }), deps());

    expect(legacyUriHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.description).toContain("5 cards inside");
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: 5 });
    expectWebsiteLink(lastResponse?.body);
  });

  it("uses stable revealed metadata URIs for future card mints", () => {
    const stateKey = signInUser("stable-card-uri");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "stripe:checkout:stable-card-uri",
      source: "stripe",
    });
    const card = grant.cards![0]!;

    expect(hallPassNftMetadataUri(card)).toBe(
      `https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/${encodeURIComponent(card.characterId)}/${encodeURIComponent(String(card.serial))}.json`,
    );
  });

  it("opens an active Pack NFT into deterministic face-down cards", async () => {
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
        pack: {
          id: pack.id,
          status: "opened",
          packRevealVersion: "ruby-high-pack-reveal-v1.1",
          catalogHash: expect.any(String),
          commitment: expect.any(String),
          entropySource: "ruby-high-server-commit-v1",
          revealSeed: expect.any(String),
        },
      },
    });
    expect(lastResponse?.body.cards).toHaveLength(5);
    expect(lastResponse?.body.cards[0]).toMatchObject({
      title: "Ruby High Mystery Card",
      characterId: "card-back",
      characterName: "Mystery Card",
      mintAddress: null,
      mintSignature: null,
      packId: pack.id,
      slotIndex: 0,
      packRevealVersion: "ruby-high-pack-reveal-v1.1",
      catalogHash: expect.any(String),
      commitment: expect.any(String),
      entropySource: "ruby-high-server-commit-v1",
      revealSeed: expect.any(String),
      revealProof: expect.any(String),
      packAssetAddress: pack.assetAddress,
    });
    expect(lastResponse?.body.minted).toHaveLength(0);
    expect(lastResponse?.body.remaining).toBe(5);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      id: pack.id,
      status: "opened",
    });
    const cards = ruby.getOrCreate(stateKey).wallet.hallPassCards ?? [];
    expect(cards).toHaveLength(5);
    expect(cards.filter((card) => card.mintAddress || card.mintSignature || card.metadataUri)).toHaveLength(0);
    expect(new Set(cards.map((card) => `${card.packId}:${card.slotIndex}:${card.revealCommitment}`)).size).toBe(5);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: `/api/apps/ruby-high/nft/metadata/hall-pass/card/${cards[0]!.id}.json`,
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.image).toBe("https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1");
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1",
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Face Down" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Pack Reveal Version", value: "ruby-high-pack-reveal-v1.1" });
    expect(lastResponse?.body.properties.provenance).toMatchObject({
      algorithm: "sha256(version + commitment + revealSeed + assetAddress + slotIndex)",
      revealSeed: expect.any(String),
      packAssetAddress: pack.assetAddress,
    });
    expectWebsiteLink(lastResponse?.body);
    expect(lastHeaders["cache-control"]).toBe("no-cache");

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/card/hpc_missing.json",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 404,
      body: { error: "Unknown Ruby High card metadata id." },
    });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: `/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/${pack.serial}.json`,
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.image).toBe("https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2");
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      "https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2",
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Opened" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Pack Reveal Version", value: "ruby-high-pack-reveal-v1.1" });
    expect(lastResponse?.body.properties.provenance).toMatchObject({
      algorithm: "sha256(version + commitment + revealSeed + assetAddress + slotIndex)",
      revealSeed: expect.any(String),
      packAssetAddress: pack.assetAddress,
    });
    expectWebsiteLink(lastResponse?.body);
    expect(lastHeaders["cache-control"]).toBe("no-cache");
  });

  it("imports transferred Core pack NFTs owned by the connected wallet", async () => {
    const stateKey = signInUser("sync-pack");
    const transferredAsset = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    restorePackFetcher = setOwnedCorePackNftFetcherForTest(async (ownerWalletAddress) => [{
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress,
      assetAddress: transferredAsset,
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5",
      serial: 570329,
      name: "Ruby High Pack #570329",
    }]);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        ownerWalletAddress: OWNER,
        importedCount: 1,
        onChainCount: 1,
      },
    });
    expect(lastResponse?.body.imported).toHaveLength(1);
    expect(lastResponse?.body.imported[0]).toMatchObject({
      serial: 570329,
      productId: "card-pack-1",
      cardCount: 5,
      status: "active",
      ownerWalletAddress: OWNER,
      assetAddress: transferredAsset,
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      serial: 570329,
      status: "active",
      assetAddress: transferredAsset,
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        importedCount: 0,
        onChainCount: 1,
      },
    });
    expect(lastResponse?.body.known).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks).toHaveLength(1);
  });

  it("server-mints one card to the connected wallet during card mint prepare", async () => {
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
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=alice",
      body: { cardId: grant.cards![0]!.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.card).toMatchObject({
      id: grant.cards![0]!.id,
      characterId: grant.cards![0]!.characterId,
      characterName: grant.cards![0]!.characterName,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mServerMintSignature111111111111111111111111111111111",
    });
    expect(lastResponse?.body.mint).toMatchObject({
      cardId: grant.cards![0]!.id,
      ownerWalletAddress: OWNER,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mServerMintSignature111111111111111111111111111111111",
      chain: "solana:mainnet",
      serverMinted: true,
    });
    expect(lastResponse?.body.minted).toHaveLength(1);
    expect(lastResponse?.body.remaining).toBe(19);
    const cards = ruby.getOrCreate(stateKey).wallet.hallPassCards ?? [];
    expect(cards.filter((card) => card.mintAddress && card.mintSignature && card.metadataUri)).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("records one owner-paid card mint only after confirmation", async () => {
    const stateKey = signInUser("owner-paid-confirm");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 2,
      idempotencyKey: "stripe:checkout:owner_paid_confirm",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    const metadataUri = hallPassNftMetadataUri(card);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-confirm",
      cookie: "rh_session=owner-paid-confirm",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        mintSignature: "5mCardMintSignature11111111111111111111111111111111111111",
        metadataUri,
      },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(1);
    expect(lastResponse?.body.card).toMatchObject({
      id: card.id,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mCardMintSignature11111111111111111111111111111111111111",
      metadataUri,
    });
    expect(lastResponse?.body.remaining).toBe(1);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("submits an owner-signed card mint before recording the reveal", async () => {
    let submittedTransactionBase64 = "";
    restoreMintSubmitter?.();
    restoreMintSubmitter = setHallPassNftMintSubmitterForTest(async (signedTransactionBase64) => {
      submittedTransactionBase64 = signedTransactionBase64;
      return "5mSubmittedCardMintSignature222222222222222222222222222222222";
    });
    const stateKey = signInUser("owner-paid-submit");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 2,
      idempotencyKey: "stripe:checkout:owner_paid_submit",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    const metadataUri = hallPassNftMetadataUri(card);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-submit",
      cookie: "rh_session=owner-paid-submit",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        metadataUri,
        signedTransactionBase64: "AQID",
      },
    }), deps());

    expect(handled).toBe(true);
    expect(submittedTransactionBase64).toBe("AQID");
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(1);
    expect(lastResponse?.body.card).toMatchObject({
      id: card.id,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mSubmittedCardMintSignature222222222222222222222222222222222",
      metadataUri,
    });
    expect(lastResponse?.body.remaining).toBe(1);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("keeps the legacy mint-pack endpoint as a one-card prepare path", async () => {
    const stateKey = signInUser("legacy-mint-pack");
    ruby.grantHallPassCards(stateKey, {
      cardCount: 8,
      idempotencyKey: "stripe:checkout:cs_legacy_mint_pack",
      source: "stripe",
    });

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-pack",
      cookie: "rh_session=legacy-mint-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(0);
    expect(lastResponse?.body.card).toMatchObject({
      characterId: expect.any(String),
    });
    expect(lastResponse?.body.mint).toMatchObject({
      ownerWalletAddress: OWNER,
      transactionBase64: "AQID",
      serverMinted: false,
    });
    expect(lastResponse?.body.remaining).toBe(8);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress)).toHaveLength(0);
  });

  it("returns card mint transaction build errors without mutating the card", async () => {
    restoreMinter?.();
    restoreMinter = setHallPassNftMinterForTest(async () => {
      throw new Error("insufficient funds for rent");
    });
    const stateKey = signInUser("mint-user-low-balance");
    ruby.grantHallPassCards(stateKey, {
      cardCount: 5,
      idempotencyKey: "stripe:checkout:cs_mint_user_low_balance",
      source: "stripe",
    });
    const card = ruby.mintableHallPassCards(stateKey)[0]!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=mint-user-low-balance",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 502,
      body: { error: "This card mint needs more SOL for Solana rent and fees. Your card was not changed." },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress)).toHaveLength(0);
  });

  it("returns retryable Solana RPC mint errors without mutating the card", async () => {
    restoreMinter?.();
    restoreMinter = setHallPassNftMinterForTest(async () => {
      throw new Error("Solana RPC failed with 502.");
    });
    const stateKey = signInUser("mint-user-rpc-502");
    ruby.grantHallPassCards(stateKey, {
      cardCount: 5,
      idempotencyKey: "stripe:checkout:cs_mint_user_rpc_502",
      source: "stripe",
    });
    const card = ruby.mintableHallPassCards(stateKey)[0]!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=mint-user-rpc-502",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 502,
      body: { error: "Solana RPC is temporarily unavailable. Your NFT was not changed; try again in a minute." },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress)).toHaveLength(0);
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

  it("rejects multi-card burns so wallets only review one burn at a time", async () => {
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

    expect(lastResponse).toMatchObject({
      status: 400,
      body: { error: "Burn at most 1 card at once." },
    });
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
