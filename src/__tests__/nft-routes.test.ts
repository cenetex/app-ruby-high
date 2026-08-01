import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Connection as Web3Connection,
  Keypair as Web3Keypair,
  PublicKey as Web3PublicKey,
  SystemProgram as Web3SystemProgram,
  Transaction as Web3Transaction,
} from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBillingRoutes } from "../routes/billing.js";
import { handleNftRoutes } from "../routes/nft.js";
import type { RouteContext } from "../routes/context.js";
import { getActivePack } from "../content/registry.js";
import {
  type OwnedCorePackNft,
  setCorePackCurrentOwnershipFetcherForTest,
  setCorePackNftOpenedUpdaterForTest,
  setOwnedCorePackNftFetcherForTest,
} from "../services/core-pack-nfts.js";
import {
  hallPassCardMintSignatureFromSignedTransaction,
  hallPassNftMetadataUri,
  setHallPassCardOwnershipFetcherForTest,
  setHallPassNftBurnTransactionBuilderForTest,
  setHallPassNftBurnVerifierForTest,
  setHallPassNftMintTransactionBuilderForTest,
  setHallPassNftMintSubmitterForTest,
  setHallPassNftMintVerifierForTest,
  setHallPassNftRevealUpdaterForTest,
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
import { nftImageUri } from "../services/nft-arweave-assets.js";
import { StateStore } from "../services/state-store.js";
import type { RubyHighHallPassCard } from "../types.js";

let tmpDir: string;
let auth: AuthService;
let ruby: RubyHighService;
let lastResponse: { status: number; body: any } | null = null;
let lastHeaders: Record<string, string> = {};
let restoreMintBuilder: (() => void) | null = null;
let restoreMintSubmitter: (() => void) | null = null;
let restoreMintVerifier: (() => void) | null = null;
let restoreRevealUpdater: (() => void) | null = null;
let restoreBurnBuilder: (() => void) | null = null;
let restoreBurnVerifier: (() => void) | null = null;
let restoreCardOwnershipFetcher: (() => void) | null = null;
let restorePackFetcher: (() => void) | null = null;
let restorePackOpenedUpdater: (() => void) | null = null;
let restorePackCurrentOwnershipFetcher: (() => void) | null = null;
let currentCardOwners: Map<string, string | null>;

const OWNER = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_NFT_RPC_URL: process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
  RUBY_HIGH_SOLANA_OWNERSHIP_RPC_URL: process.env.RUBY_HIGH_SOLANA_OWNERSHIP_RPC_URL,
  RUBY_HIGH_PACK_REVEAL_SECRET: process.env.RUBY_HIGH_PACK_REVEAL_SECRET,
  RUBY_HIGH_PUBLIC_BASE_URL: process.env.RUBY_HIGH_PUBLIC_BASE_URL,
  RUBY_HIGH_COSYWORLD_EXPORT_TOKEN: process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN,
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
  contentTypeHeader?: string | string[] | null;
  originHeader?: string | string[] | null;
  authorizationHeader?: string | string[] | null;
  callbackOrigin?: string | null;
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
    contentTypeHeader: opts.contentTypeHeader === undefined ? "application/json" : opts.contentTypeHeader,
    originHeader: opts.originHeader ?? null,
    authorizationHeader: opts.authorizationHeader ?? null,
    callbackUrlBuilder: (path) => `${opts.callbackOrigin ?? "https://ruby-high.ai"}${path}`,
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
    walletAddress: OWNER,
    walletChainType: "solana",
  });
  return `rh:user:${userId}`;
}

function signedCardMintTransactionForTest(): string {
  const signer = Web3Keypair.generate();
  const transaction = new Web3Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: Web3Keypair.generate().publicKey.toBase58(),
  }).add(Web3SystemProgram.transfer({
    fromPubkey: signer.publicKey,
    toPubkey: signer.publicKey,
    lamports: 0,
  }));
  transaction.partialSign(signer);
  return transaction.serialize().toString("base64");
}

function makeOwnedHallPassCard(
  overrides: Partial<RubyHighHallPassCard> & Pick<RubyHighHallPassCard, "id" | "serial" | "characterId" | "characterName" | "role">,
): RubyHighHallPassCard {
  const now = Date.now();
  return {
    title: `${overrides.characterName} #${overrides.serial}`,
    setName: FIRST_BELL_SET_NAME,
    setCode: FIRST_BELL_SET_CODE,
    rarity: "common",
    blurb: "A CosyWorld route test card.",
    color: "#82e0aa",
    hallPasses: 1,
    status: "active",
    issuedAt: now,
    updatedAt: now,
    ownerWalletAddress: OWNER,
    mintAddress: `Mint${overrides.serial}111111111111111111111111111111`,
    mintSignature: `Sig${overrides.serial}111111111111111111111111111111`,
    metadataUri: `https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/card/${encodeURIComponent(overrides.id)}.json`,
    ...overrides,
  };
}

function setCurrentOnChainCardOwners(cards: RubyHighHallPassCard[]): void {
  for (const card of cards) {
    if (card.mintAddress) currentCardOwners.set(card.mintAddress, card.ownerWalletAddress ?? null);
  }
}

function expectWebsiteLink(metadata: any, website = "https://ruby-high.ai/"): void {
  expect(metadata.external_url).toBe(website);
  expect(metadata.properties).toMatchObject({ website });
  expect(metadata.attributes).toContainEqual({ trait_type: "Website", value: website });
}

function expectedNftImage(path: string): string {
  return nftImageUri("https://ruby-high.ai", path);
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

function expectNoVisibleProvenanceTraits(metadata: any): void {
  const hiddenTraits = new Set([
    "Pack Reveal Version",
    "Catalog Hash",
    "Commitment",
    "Entropy Source",
    "Reveal Seed",
    "Reveal Proof",
    "Pack Asset",
    "Reveal Slot",
    "Randomness Account",
    "Reveal Transaction",
  ]);
  for (const attribute of metadata?.attributes ?? []) {
    expect(hiddenTraits.has(attribute.trait_type)).toBe(false);
  }
}

beforeEach(async () => {
  restoreEnv();
  process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
  process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
  process.env.RUBY_HIGH_PACK_REVEAL_SECRET = "nft-route-test-reveal-secret";
  process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";
  restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async (card, ownerWalletAddress) => ({
    cardId: card.id,
    ownerWalletAddress,
    mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
    metadataUri: `https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/card/${encodeURIComponent(card.id)}.json`,
    transactionBase64: "AQID",
    transactionMessageHash: "prepared-transaction-hash",
    transactionEncoding: "base64",
    chain: "solana:mainnet",
    rpcUrl: "https://rpc.example",
  }));
  restoreMintSubmitter = setHallPassNftMintSubmitterForTest(async (transactionBase64) => (
    hallPassCardMintSignatureFromSignedTransaction(transactionBase64)
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
  currentCardOwners = new Map();
  restoreCardOwnershipFetcher = setHallPassCardOwnershipFetcherForTest(async (mintAddress) => {
    if (!currentCardOwners.has(mintAddress)) return null;
    const ownerWalletAddress = currentCardOwners.get(mintAddress);
    return ownerWalletAddress
      ? { mintAddress, ownerWalletAddress, collectionAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q" }
      : null;
  });
  restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
    assetAddress,
    ownerWalletAddress: OWNER,
    metadataUri: "https://ruby-high.ai/pack.json",
    opened: false,
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
  restoreMintBuilder?.();
  restoreMintBuilder = null;
  restoreMintSubmitter?.();
  restoreMintSubmitter = null;
  restoreMintVerifier?.();
  restoreMintVerifier = null;
  restoreRevealUpdater?.();
  restoreRevealUpdater = null;
  restoreBurnBuilder?.();
  restoreBurnBuilder = null;
  restoreBurnVerifier?.();
  restoreBurnVerifier = null;
  restoreCardOwnershipFetcher?.();
  restoreCardOwnershipFetcher = null;
  restorePackFetcher?.();
  restorePackFetcher = null;
  restorePackOpenedUpdater?.();
  restorePackOpenedUpdater = null;
  restorePackCurrentOwnershipFetcher?.();
  restorePackCurrentOwnershipFetcher = null;
  vi.restoreAllMocks();
  await auth.stop();
  await ruby.flush();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("Hall Pass NFT routes", () => {
  it("exports active minted wallet cards for CosyWorld only with internal authorization", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const stateKey = signInUser("cosy-export");
    const state = ruby.getOrCreate(stateKey);
    const mintedRati = makeOwnedHallPassCard({
      id: "cosy-rati-owned",
      serial: 1001,
      characterId: "rati",
      characterName: "Rati",
      role: "teacher",
      subject: "Textiles",
    });
    const mintedScience = makeOwnedHallPassCard({
      id: "cosy-science-owned",
      serial: 1002,
      characterId: "location-science-lab",
      characterName: "Science Class",
      role: "location",
      subject: "Science",
    });
    const unmintedLibrary = makeOwnedHallPassCard({
      id: "cosy-library-unminted",
      serial: 1003,
      characterId: "location-library",
      characterName: "Library",
      role: "location",
      subject: "Library",
      mintAddress: undefined,
      mintSignature: undefined,
    });
    const redeemedGarden = makeOwnedHallPassCard({
      id: "cosy-garden-redeemed",
      serial: 1004,
      characterId: "cosy-rain-soft-garden",
      characterName: "Rain-Soft Garden",
      role: "location",
      status: "redeemed",
    });
    state.wallet.hallPassCards = [mintedRati, mintedScience, unmintedLibrary, redeemedGarden];
    setCurrentOnChainCardOwners([mintedRati, mintedScience, unmintedLibrary, redeemedGarden]);

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastHeaders["cache-control"]).toBe("private, no-store");
    expect(lastResponse?.body.wallets).toHaveLength(1);
    expect(lastResponse?.body.wallets[0]).toMatchObject({
      walletAddress: OWNER,
      cardIds: ["location-science-lab", "rati"],
    });
    expect(lastResponse?.body.wallets[0].hallPassCards.map((card: any) => card.characterId)).toEqual([
      "location-science-lab",
      "rati",
    ]);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer wrong-token",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 401,
      body: { error: "CosyWorld ownership export requires authorization." },
    });
  });

  it("does not expose the CosyWorld wallet-card export until configured", async () => {
    delete process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN;

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 503,
      body: { error: "CosyWorld ownership export is not configured." },
    });
  });

  it("skips stale on-chain card records instead of failing the CosyWorld export", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const state = ruby.getOrCreate(signInUser("cosy-stale-card"));
    const activeCard = makeOwnedHallPassCard({
      id: "cosy-active-rati",
      serial: 1005,
      characterId: "rati",
      characterName: "Rati",
      role: "student",
    });
    const staleCard = makeOwnedHallPassCard({
      id: "cosy-stale-science",
      serial: 1006,
      characterId: "location-science-lab",
      characterName: "Science Lab",
      role: "location",
      subject: "Science",
    });
    state.wallet.hallPassCards = [activeCard, staleCard];

    restoreCardOwnershipFetcher?.();
    restoreCardOwnershipFetcher = setHallPassCardOwnershipFetcherForTest(async (mintAddress) => {
      if (mintAddress === staleCard.mintAddress) {
        throw new Error(
          "The account at the provided address [8KhcnVACpVRyrBnVLHijPZ2bHMgyZqYZpJppBHdkCSFa] is not of the expected type [AssetAccountData].\n\nCaused By: DeserializingEmptyBufferError: Serializer [publicKey] cannot deserialize empty buffers.",
        );
      }
      return {
        mintAddress,
        ownerWalletAddress: OWNER,
        collectionAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      };
    });

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.wallets).toHaveLength(1);
    expect(lastResponse?.body.wallets[0].cardIds).toEqual(["rati"]);
    expect(lastResponse?.body.wallets[0].hallPassCards).toHaveLength(1);
    expect(lastResponse?.body.wallets[0].hallPassCards[0]).toMatchObject({
      characterId: "rati",
      mintAddress: activeCard.mintAddress,
    });
  });

  it("keeps case-distinct wallet addresses in separate CosyWorld export buckets", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const lowerState = ruby.getOrCreate(signInUser("cosy-case-lower"));
    const upperState = ruby.getOrCreate(signInUser("cosy-case-upper"));
    const lowerWallet = "CaseSensitiveWallet11111111111111111111111111a";
    const upperWallet = "CaseSensitiveWallet11111111111111111111111111A";
    lowerState.wallet.hallPassCards = [
      makeOwnedHallPassCard({
        id: "cosy-case-lower",
        serial: 1101,
        characterId: "lower-case-card",
        characterName: "Lower Case",
        role: "teacher",
        ownerWalletAddress: lowerWallet,
      }),
    ];
    upperState.wallet.hallPassCards = [
      makeOwnedHallPassCard({
        id: "cosy-case-upper",
        serial: 1102,
        characterId: "upper-case-card",
        characterName: "Upper Case",
        role: "teacher",
        ownerWalletAddress: upperWallet,
      }),
    ];
    setCurrentOnChainCardOwners([
      ...(lowerState.wallet.hallPassCards ?? []),
      ...(upperState.wallet.hallPassCards ?? []),
    ]);

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    const exported = lastResponse?.body.wallets.filter((wallet: any) =>
      wallet.walletAddress === lowerWallet || wallet.walletAddress === upperWallet
    );
    expect(exported).toHaveLength(2);
    expect(exported.map((wallet: any) => wallet.walletAddress).sort()).toEqual([lowerWallet, upperWallet].sort());
    expect(exported.flatMap((wallet: any) => wallet.cardIds).sort()).toEqual([
      "lower-case-card",
      "upper-case-card",
    ]);
  });

  it("uses current on-chain owners for the CosyWorld export instead of stale persisted owners", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const state = ruby.getOrCreate(signInUser("cosy-transfer"));
    const originalWallet = OWNER;
    const transferredWallet = "6b7Fv4Qc5HQVEyZAF83NGe2JC2JtjNS2FjBQuYCF8Nxo";
    const transferredCard = makeOwnedHallPassCard({
      id: "cosy-transferred-card",
      serial: 1201,
      characterId: "mika",
      characterName: "Mika",
      role: "student",
      ownerWalletAddress: originalWallet,
    });
    state.wallet.hallPassCards = [transferredCard];
    currentCardOwners.set(transferredCard.mintAddress!, transferredWallet);

    const handled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.wallets).toHaveLength(1);
    expect(lastResponse?.body.wallets[0]).toMatchObject({
      walletAddress: transferredWallet,
      cardIds: ["mika"],
    });
    expect(lastResponse?.body.wallets[0].hallPassCards[0]).toMatchObject({
      ownerWalletAddress: transferredWallet,
      mintAddress: transferredCard.mintAddress,
    });
    expect(lastResponse?.body.wallets.some((wallet: any) => wallet.walletAddress === originalWallet)).toBe(false);
  });

  it("exports generated cast cards with canonical CosyWorld ids", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const stateKey = signInUser("cosy-generated-cast");
    const grant = ruby.createGeneratedCastNftCard(stateKey, {
      characterId: "lyra",
      ownerWalletAddress: OWNER,
    });
    ruby.recordHallPassCardMint(stateKey, {
      cardId: grant.card.id,
      ownerWalletAddress: OWNER,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mGeneratedCastMintSignature111111111111111111111111111",
      metadataUri: hallPassNftMetadataUri(grant.card),
    });
    const mintedCard = ruby.getOrCreate(stateKey).wallet.hallPassCards!
      .find((card) => card.id === grant.card.id)!;
    setCurrentOnChainCardOwners([mintedCard]);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    const wallet = lastResponse?.body.wallets[0];
    expect(wallet.cardIds).toEqual(expect.arrayContaining([mintedCard.characterId, "lyra"]));
    expect(wallet.hallPassCards[0]).toMatchObject({
      characterId: mintedCard.characterId,
      canonicalCharacterId: "lyra",
      nftProfileKind: "cast",
      imageUrl: "/api/apps/ruby-high/assets/nft/market-cards/lyra.png",
      source: "ruby_high",
      transactionSource: "hall-pass-card",
    });
  });

  it("exports unopened pack NFTs for CosyWorld when current ownership matches", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const stateKey = signInUser("cosy-pack-export");
    const mint = ruby.recordHallPassPackMint(stateKey, {
      idempotencyKey: "cosy-pack-export",
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "PackAsset111111111111111111111111111111111",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5",
    });
    const pack = mint.pack!;
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => (
      assetAddress === pack.assetAddress
        ? { assetAddress, ownerWalletAddress: OWNER, metadataUri: pack.metadataUri, opened: false }
        : null
    ));

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.wallets).toHaveLength(1);
    expect(lastResponse?.body.wallets[0]).toMatchObject({
      walletAddress: OWNER,
      cardIds: [],
      packs: [{
        packAssetAddress: pack.assetAddress,
        assetAddress: pack.assetAddress,
        status: "unopened",
        productId: "card-pack-1",
        cardCount: 5,
        source: "ruby_high",
      }],
    });
  });

  it("bounds concurrent on-chain owner lookups for the CosyWorld export", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    const state = ruby.getOrCreate(signInUser("cosy-concurrency"));
    state.wallet.hallPassCards = Array.from({ length: 18 }, (_, index) => makeOwnedHallPassCard({
      id: `cosy-concurrent-${index}`,
      serial: 1300 + index,
      characterId: `cosy-concurrent-${index}`,
      characterName: `Concurrent ${index}`,
      role: "student",
    }));
    const ownersByMint = new Map(
      state.wallet.hallPassCards.map((card) => [card.mintAddress!, card.ownerWalletAddress!]),
    );
    restoreCardOwnershipFetcher?.();
    let inFlight = 0;
    let maxInFlight = 0;
    restoreCardOwnershipFetcher = setHallPassCardOwnershipFetcherForTest(async (mintAddress) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      const ownerWalletAddress = ownersByMint.get(mintAddress);
      return ownerWalletAddress
        ? { mintAddress, ownerWalletAddress, collectionAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q" }
        : null;
    });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.wallets[0].hallPassCards).toHaveLength(18);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it("batches CosyWorld ownership reads and fails over immediately when the configured RPC is exhausted", async () => {
    process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN = "cosy-test-token";
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://quota-rpc.example";
    delete process.env.RUBY_HIGH_SOLANA_OWNERSHIP_RPC_URL;
    restoreCardOwnershipFetcher?.();
    restoreCardOwnershipFetcher = null;
    const state = ruby.getOrCreate(signInUser("cosy-rpc-fallback"));
    state.wallet.hallPassCards = Array.from({ length: 18 }, (_, index) => makeOwnedHallPassCard({
      id: `cosy-rpc-fallback-${index}`,
      serial: 1400 + index,
      characterId: `cosy-rpc-fallback-${index}`,
      characterName: `Fallback ${index}`,
      role: "student",
      mintAddress: new Web3PublicKey(Uint8Array.from({ length: 32 }, (_, byteIndex) => (
        byteIndex === 31 ? index + 1 : byteIndex + 1
      ))).toBase58(),
    }));
    const rpcCalls: Array<{ endpoint: string; addressCount: number }> = [];
    vi.spyOn(Web3Connection.prototype, "getMultipleAccountsInfo").mockImplementation(async function (
      this: Web3Connection,
      publicKeys,
    ) {
      rpcCalls.push({ endpoint: this.rpcEndpoint, addressCount: publicKeys.length });
      if (this.rpcEndpoint === "https://quota-rpc.example") {
        throw new Error("429 Too Many Requests: max usage reached");
      }
      return publicKeys.map(() => null);
    });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards",
      authorizationHeader: "Bearer cosy-test-token",
    }), deps());

    expect(lastResponse).toMatchObject({ status: 200, body: { wallets: [] } });
    expect(rpcCalls).toEqual([
      { endpoint: "https://quota-rpc.example", addressCount: 18 },
      { endpoint: "https://api.mainnet-beta.solana.com", addressCount: 18 },
    ]);
  });

  it("serves public Hall Pass metadata", async () => {
    const collectionHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/collection.json",
    }), deps());

    expect(collectionHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: FIRST_BELL_SET_NAME,
      image: expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1"),
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1"),
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set", value: "First Bell" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Code", value: FIRST_BELL_SET_CODE });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Edition", value: "First Bell Set" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Live Profiles", value: String(FIRST_BELL_SET_LIVE_PROFILE_COUNT) });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Draft Profiles", value: String(FIRST_BELL_SET_TOTAL_PROFILES) });
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
      image: expectedNftImage("/api/apps/ruby-high/assets/nft/market-cards/lyra.png?v=card-v2"),
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/market-cards/lyra.png?v=card-v2"),
    );
    expect(lastHeaders["cache-control"]).toBe("no-cache");
    expect(lastResponse?.body.collection).toMatchObject({
      name: FIRST_BELL_SET_NAME,
      family: "Ruby High",
    });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Collection", value: FIRST_BELL_SET_NAME });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Number", value: "FB-001" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Profile ID", value: "lyra-color-coded-spare" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Revealed" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Card Name", value: "Lyra: Color-Coded Spare" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Character ID", value: "lyra" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Subject", value: "Homeroom" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Rarity", value: "Common" });
    expect(lastResponse?.body.properties.rubyHigh).toMatchObject({
      source: "ruby_high",
      collection: "first_bell",
      characterId: "lyra",
      canonicalCharacterId: "lyra",
      setCode: FIRST_BELL_SET_CODE,
      nftType: "card",
      status: "revealed",
    });
    expectWebsiteLink(lastResponse?.body);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/captain-null/777777.json",
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: "Ruby High: Captain Null #777777",
      image: expectedNftImage("/api/apps/ruby-high/assets/nft/market-cards/captain-null.png?v=card-v2"),
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/market-cards/captain-null.png?v=card-v2"),
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

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/%E0%A4%A/1.json",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 404,
      body: { error: "Unknown Ruby High card character." },
    });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/hall-pass/card/%E0%A4%A.json",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 404,
      body: { error: "Unknown Ruby High card metadata id." },
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
        image: expectedNftImage(`/api/apps/ruby-high/assets/nft/market-cards/${entry.characterId}.png?v=card-v2`),
      });
      expectMarketReadyImageMetadata(
        lastResponse?.body,
        expectedNftImage(`/api/apps/ruby-high/assets/nft/market-cards/${entry.characterId}.png?v=card-v2`),
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
      image: expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1"),
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1"),
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
      image: expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2"),
    });
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2"),
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set", value: "First Bell" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Set Code", value: FIRST_BELL_SET_CODE });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "NFT Type", value: "Pack" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: "5" });
    expect(lastResponse?.body.properties.rubyHigh).toMatchObject({
      source: "ruby_high",
      collection: "first_bell_packs",
      productId: "card-pack-1",
      cardCount: 5,
      nftType: "pack",
      status: "unopened",
    });
    expectWebsiteLink(lastResponse?.body);

    const legacyUriHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=4",
    }), deps());

    expect(legacyUriHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.description).toContain("5 revealable cards");
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Cards Inside", value: "5" });
    expectWebsiteLink(lastResponse?.body);

    const openedUriHandled = await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5&opened=1",
    }), deps());

    expect(openedUriHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.image).toBe(expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2"));
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Opened" });
    expect(lastResponse?.body.properties.rubyHigh).toMatchObject({ status: "opened" });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: "/api/apps/ruby-high/nft/metadata/core/pack/%E0%A4%A/123456.json",
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 404,
      body: { error: "Unknown Ruby High pack metadata id." },
    });
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

  it("creates v2 generated cast and player cards as mintable face-down NFTs", async () => {
    const stateKey = signInUser("v2-generated");
    ruby.createCharacter(stateKey, {
      name: "Mina",
      playbookId: "lifer",
      stats: { head: 3, heart: 1, hustle: 0, honor: -1 },
      arcAnswer: "keeps the old yearbook alive",
      personality: "Mina treats every class like a long-running mystery.",
      portraitDataUrl: "https://cdn.example/ruby-high/mina.png",
    });

    const playerHandled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/v2/player-card",
      cookie: "rh_session=v2-generated",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(playerHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.card).toMatchObject({
      characterName: "Mina",
      setName: "Ruby High Generated",
      setCode: "GEN2",
      cardName: "Mina: Student ID",
      imageUrl: "https://cdn.example/ruby-high/mina.png",
      nftProfileKind: "player",
      playbookId: "lifer",
      mintAddress: null,
      mintSignature: null,
    });
    const playerCardId = lastResponse?.body.card.id;
    expect(ruby.mintableHallPassCards(stateKey).some((card) => card.id === playerCardId)).toBe(true);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: `/api/apps/ruby-high/nft/metadata/hall-pass/card/${playerCardId}.json`,
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.image).toBe(expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1"));
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Face Down" });

    const castHandled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/v2/cast-card",
      cookie: "rh_session=v2-generated",
      body: { characterId: "lyra", ownerWalletAddress: OWNER },
    }), deps());

    expect(castHandled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.card).toMatchObject({
      characterName: "Lyra",
      setName: "Ruby High Generated",
      setCode: "GEN2",
      cardName: "Lyra: Cast Edition",
      imageUrl: "/api/apps/ruby-high/assets/nft/market-cards/lyra.png",
      nftProfileKind: "cast",
      canonicalCharacterId: "lyra",
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/v2/cast-card",
      cookie: "rh_session=v2-generated",
      body: { characterId: "lyra", ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.applied).toBe(false);
    expect(ruby.mintableHallPassCards(stateKey).filter((card) => card.nftProfileKind === "cast")).toHaveLength(1);
  });

  it("serves v2 generated player metadata after the card is minted", async () => {
    const stateKey = signInUser("v2-generated-metadata");
    ruby.createCharacter(stateKey, {
      name: "Ari",
      playbookId: "outsider",
      stats: { head: 2, heart: -1, hustle: 1, honor: 0 },
      arcAnswer: "takes notes from the hallway",
      personality: "Ari watches the room first and talks second.",
      portraitDataUrl: "https://cdn.example/ruby-high/ari.png",
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/v2/player-card",
      cookie: "rh_session=v2-generated-metadata",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    const card = ruby.mintableHallPassCards(stateKey)
      .find((candidate) => candidate.id === lastResponse?.body.card.id)!;
    ruby.recordHallPassCardMint(stateKey, {
      cardId: card.id,
      ownerWalletAddress: OWNER,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: "5mGeneratedPlayerMintSignature11111111111111111111111111",
      metadataUri: hallPassNftMetadataUri(card),
    });

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: `/api/apps/ruby-high/nft/metadata/hall-pass/card/${card.id}.json`,
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body).toMatchObject({
      name: `Ruby High: Ari #${card.serial}`,
      image: "https://cdn.example/ruby-high/ari.png",
      collection: {
        name: "Ruby High Generated",
        family: "Ruby High",
      },
    });
    expectMarketReadyImageMetadata(lastResponse?.body, "https://cdn.example/ruby-high/ari.png");
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "NFT Type", value: "Generated Profile Card" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Profile Kind", value: "Player" });
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "Playbook", value: "outsider" });
    expect(lastResponse?.body.properties.rubyHigh).toMatchObject({
      source: "ruby_high",
      collection: "generated_profiles",
      cardId: card.id,
      characterId: card.characterId,
      canonicalCharacterId: card.characterId,
      profileKind: "player",
      playbookId: "outsider",
      nftType: "generated_profile_card",
      status: "revealed",
    });
    expectWebsiteLink(lastResponse?.body);
  });

  it("creates v2 yearbook cards from sealed player snapshots", async () => {
    const stateKey = signInUser("v2-yearbook");
    const state = ruby.createCharacter(stateKey, {
      name: "June",
      playbookId: "heart",
      stats: { head: 0, heart: 3, hustle: 1, honor: -1 },
      arcAnswer: "keeps the table together",
      personality: "June notices who has gone quiet.",
      portraitDataUrl: "https://cdn.example/ruby-high/june.png",
    });
    state.character!.yearbook = [{
      grade: "9",
      completedAt: 1_700_000_000_000,
      summary: { correct: 12, total: 14 },
      name: "June",
      playbookId: "heart",
      stats: { head: 0, heart: 3, hustle: 1, honor: -1 },
      portraitDataUrl: "https://cdn.example/ruby-high/june-freshman.png",
      yearbookImageUrl: "https://cdn.example/ruby-high/june-yearbook.png",
    }];

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/v2/yearbook-card",
      cookie: "rh_session=v2-yearbook",
      body: { grade: "9", ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.card).toMatchObject({
      characterName: "June",
      cardName: "June: Freshman Yearbook",
      imageUrl: "https://cdn.example/ruby-high/june-yearbook.png",
      nftProfileKind: "yearbook",
      playbookId: "heart",
      grade: "9",
    });
  });

  it("opens an active Pack NFT into deterministic face-down cards", async () => {
    const stateKey = signInUser("open-pack");
    const openedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5&opened=1";
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    let openedOnChain = false;
    const updateOpenedPack = vi.fn(async () => {
      openedOnChain = true;
      return {
        assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
        signature: "5mPackOpenedUpdateSignature11111111111111111111111111111",
        metadataUri: openedMetadataUri,
      };
    });
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
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
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
      assetAddress,
      ownerWalletAddress: OWNER,
      metadataUri: openedOnChain ? openedMetadataUri : pack.metadataUri,
      opened: openedOnChain,
    }));

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
          metadataUri: openedMetadataUri,
        },
        packNftUpdate: {
          assetAddress: pack.assetAddress,
          signature: "5mPackOpenedUpdateSignature11111111111111111111111111111",
          metadataUri: openedMetadataUri,
        },
      },
    });
    expect(updateOpenedPack).toHaveBeenCalledWith(expect.objectContaining({
      assetAddress: pack.assetAddress,
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      serial: 123456,
      packRevealVersion: "ruby-high-pack-reveal-v1.1",
      revealSeed: expect.any(String),
    }));
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
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        applied: false,
        cardCount: 5,
        pack: { status: "opened" },
      },
    });
    expect(updateOpenedPack).toHaveBeenCalledTimes(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards).toHaveLength(5);

    await handleNftRoutes(makeCtx({
      method: "GET",
      path: `/api/apps/ruby-high/nft/metadata/hall-pass/card/${cards[0]!.id}.json`,
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.image).toBe(expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1"));
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1"),
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Face Down" });
    expectNoVisibleProvenanceTraits(lastResponse?.body);
    expect(lastResponse?.body.properties.provenance).toMatchObject({
      algorithm: "sha256(version + commitment + revealSeed + assetAddress + slotIndex)",
      packRevealVersion: "ruby-high-pack-reveal-v1.1",
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
    expect(lastResponse?.body.image).toBe(expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2"));
    expectMarketReadyImageMetadata(
      lastResponse?.body,
      expectedNftImage("/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2"),
    );
    expect(lastResponse?.body.attributes).toContainEqual({ trait_type: "State", value: "Opened" });
    expectNoVisibleProvenanceTraits(lastResponse?.body);
    expect(lastResponse?.body.properties.provenance).toMatchObject({
      algorithm: "sha256(version + commitment + revealSeed + assetAddress + slotIndex)",
      packRevealVersion: "ruby-high-pack-reveal-v1.1",
      revealSeed: expect.any(String),
      packAssetAddress: pack.assetAddress,
    });
    expectWebsiteLink(lastResponse?.body);
    expect(lastHeaders["cache-control"]).toBe("no-cache");
  });

  it("refuses to open a pack after it has moved to another on-chain wallet", async () => {
    const stateKey = signInUser("open-pack-transferred");
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5",
      idempotencyKey: "solana:sol-transfer:open-pack-transferred",
      source: "solana",
    }).pack!;
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
      assetAddress,
      ownerWalletAddress: "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP",
      metadataUri: pack.metadataUri,
      opened: false,
    }));

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-transferred",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toEqual({
      status: 409,
      body: { error: "Pack is no longer owned by this wallet. Sync your wallet packs before opening." },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]?.status).toBe("active");
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards ?? []).toHaveLength(0);
  });

  it("serializes concurrent opens so one Core update and one card grant are recorded", async () => {
    const stateKey = signInUser("open-pack-concurrent");
    const sealedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5";
    const openedMetadataUri = `${sealedMetadataUri}&opened=1`;
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    let openedOnChain = false;
    const updateOpenedPack = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      openedOnChain = true;
      return {
        assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
        signature: "5mPackOpenedConcurrentSignature11111111111111111111111111",
        metadataUri: openedMetadataUri,
      };
    });
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintConcurrentSignature11111111111111111111111111111",
      metadataUri: sealedMetadataUri,
      idempotencyKey: "solana:open-pack-concurrent",
      source: "solana",
    }).pack!;
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
      assetAddress,
      ownerWalletAddress: OWNER,
      metadataUri: openedOnChain ? openedMetadataUri : sealedMetadataUri,
      opened: openedOnChain,
    }));

    await Promise.all([
      handleNftRoutes(makeCtx({
        method: "POST",
        path: "/api/apps/ruby-high/nft/open-pack",
        cookie: "rh_session=open-pack-concurrent",
        body: { packId: pack.id, ownerWalletAddress: OWNER },
      }), deps()),
      handleNftRoutes(makeCtx({
        method: "POST",
        path: "/api/apps/ruby-high/nft/open-pack",
        cookie: "rh_session=open-pack-concurrent",
        body: { packId: pack.id, ownerWalletAddress: OWNER },
      }), deps()),
    ]);

    expect(updateOpenedPack).toHaveBeenCalledTimes(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards).toHaveLength(5);
    expect(ruby.getOrCreate(stateKey).wallet.transactions
      ?.filter((transaction) => transaction.kind === "hall-pass-pack-open")).toHaveLength(1);
  });

  it("marks a locally active pack opened when its Core metadata is already opened", async () => {
    const stateKey = signInUser("open-pack-already-opened");
    const openedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5&opened=1";
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const updateOpenedPack = vi.fn();
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintAlreadyOpenedSignature111111111111111111111111",
      metadataUri: openedMetadataUri.replace("&opened=1", ""),
      idempotencyKey: "solana:open-pack-already-opened",
      source: "solana",
    }).pack!;
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
      assetAddress,
      ownerWalletAddress: OWNER,
      metadataUri: openedMetadataUri,
      opened: true,
    }));

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-already-opened",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toEqual({
      status: 409,
      body: { error: "Pack is already opened on-chain and cannot be redeemed again." },
    });
    expect(updateOpenedPack).not.toHaveBeenCalled();
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      status: "opened",
      metadataUri: openedMetadataUri,
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards ?? []).toHaveLength(0);
  });

  it("rejects a pack wallet that is not the authenticated Solana wallet", async () => {
    const stateKey = signInUser("open-pack-wallet-mismatch");
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const updateOpenedPack = vi.fn();
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignatureWalletMismatch111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5",
      idempotencyKey: "solana:open-pack-wallet-mismatch",
      source: "solana",
    }).pack!;

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-wallet-mismatch",
      body: {
        packId: pack.id,
        ownerWalletAddress: "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP",
      },
    }), deps());

    expect(lastResponse).toEqual({
      status: 400,
      body: { error: "Pack wallet does not match the authenticated Solana wallet." },
    });
    expect(updateOpenedPack).not.toHaveBeenCalled();
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]?.status).toBe("active");
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards ?? []).toHaveLength(0);
  });

  it("does not reveal a Pack NFT when the opened Core metadata update fails", async () => {
    const stateKey = signInUser("open-pack-update-fails");
    const sealedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5";
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const updateOpenedPack = vi.fn(async () => {
      throw new Error("simulated core update failure");
    });
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111111111",
      metadataUri: sealedMetadataUri,
      idempotencyKey: "solana:spl-token-transfer:open-pack-update-fails",
      source: "solana",
    }).pack!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-update-fails",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 400,
      body: { error: "Pack NFT update failed. Your pack was not opened; try again in a minute." },
    });
    expect(updateOpenedPack).toHaveBeenCalledWith(expect.objectContaining({
      assetAddress: pack.assetAddress,
      productId: "card-pack-1",
      revealSeed: expect.any(String),
    }));
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      id: pack.id,
      status: "active",
      metadataUri: sealedMetadataUri,
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards ?? []).toHaveLength(0);
    expect(ruby.getOrCreate(stateKey).wallet.operationLedger?.[`hall-pass-pack-open:${pack.id}`]).toBeUndefined();
  });

  it("keeps a pack open when Solana confirms an update after the RPC response times out", async () => {
    const stateKey = signInUser("open-pack-ambiguous-update");
    const sealedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5";
    const openedMetadataUri = `${sealedMetadataUri}&opened=1`;
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    let openedOnChain = false;
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(async () => {
      openedOnChain = true;
      throw new Error("RPC timed out after sending the Core update");
    });
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignatureAmbiguousUpdate111111111111111111111111",
      metadataUri: sealedMetadataUri,
      idempotencyKey: "solana:open-pack-ambiguous-update",
      source: "solana",
    }).pack!;
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => ({
      assetAddress,
      ownerWalletAddress: OWNER,
      metadataUri: openedOnChain ? openedMetadataUri : sealedMetadataUri,
      opened: openedOnChain,
    }));

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-ambiguous-update",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        applied: true,
        pack: { status: "opened", metadataUri: openedMetadataUri },
        packNftUpdate: {
          assetAddress: pack.assetAddress,
          signature: null,
          metadataUri: openedMetadataUri,
          recoveredAfterAmbiguousSubmit: true,
        },
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards).toHaveLength(5);
    expect(ruby.getOrCreate(stateKey).wallet.operationLedger?.[`hall-pass-pack-open:${pack.id}`]).toBeDefined();
  });

  it("rejects cross-origin pack opens before mutating wallet state", async () => {
    const stateKey = signInUser("open-pack-origin-guard");
    const updateOpenedPack = vi.fn(async () => ({
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      signature: "5mPackOpenedUpdateSignature11111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5&opened=1",
    }));
    restorePackOpenedUpdater = setCorePackNftOpenedUpdaterForTest(updateOpenedPack);
    const pack = ruby.recordHallPassPackMint(stateKey, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress: OWNER,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5",
      idempotencyKey: "solana:spl-token-transfer:open-pack-origin-guard",
      source: "solana",
    }).pack!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/open-pack",
      cookie: "rh_session=open-pack-origin-guard",
      originHeader: "https://evil.example",
      body: { packId: pack.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 403,
      body: { error: "NFT request origin is not allowed." },
    });
    expect(updateOpenedPack).not.toHaveBeenCalled();
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      id: pack.id,
      status: "active",
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards ?? []).toHaveLength(0);
  });

  it("imports transferred Core pack NFTs owned by the connected wallet", async () => {
    const stateKey = signInUser("sync-pack");
    const transferredAsset = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const transferredMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5";
    let directlyOwned = true;
    let ownedPackNfts: Array<Omit<OwnedCorePackNft, "ownerWalletAddress">> = [{
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      assetAddress: transferredAsset,
      metadataUri: transferredMetadataUri,
      serial: 570329,
      name: "Ruby High Pack #570329",
      opened: false,
    }];
    restorePackFetcher = setOwnedCorePackNftFetcherForTest(async (ownerWalletAddress) => (
      ownedPackNfts.map((pack) => ({ ...pack, ownerWalletAddress }))
    ));
    restorePackCurrentOwnershipFetcher?.();
    restorePackCurrentOwnershipFetcher = setCorePackCurrentOwnershipFetcherForTest(async (assetAddress) => {
      const enumerated = ownedPackNfts.find((pack) => pack.assetAddress === assetAddress);
      if (!enumerated && !directlyOwned) return null;
      return {
        assetAddress,
        ownerWalletAddress: OWNER,
        metadataUri: enumerated?.metadataUri ?? transferredMetadataUri,
        opened: false,
      };
    });

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

    ownedPackNfts = [];
    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { removedCount: 0 },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]?.ownershipMissCount).toBeUndefined();
    directlyOwned = false;
    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { removedCount: 0 },
    });
    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());
    expect(lastResponse).toMatchObject({
      status: 200,
      body: { removedCount: 0 },
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
        removedCount: 1,
        onChainCount: 0,
      },
    });
    expect(lastResponse?.body.removed).toHaveLength(1);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      assetAddress: transferredAsset,
      status: "void",
    });

    ownedPackNfts = [{
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      assetAddress: transferredAsset,
      metadataUri: transferredMetadataUri,
      serial: 570329,
      name: "Ruby High Pack #570329",
      opened: false,
    }];
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
        restoredCount: 1,
        onChainCount: 1,
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      assetAddress: transferredAsset,
      status: "active",
    });
  });

  it("imports and reconciles opened Core packs as permanently non-redeemable", async () => {
    const stateKey = signInUser("sync-opened-pack");
    const transferredAsset = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const sealedMetadataUri = "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5";
    const openedMetadataUri = `${sealedMetadataUri}&opened=1`;
    let opened = false;
    restorePackFetcher = setOwnedCorePackNftFetcherForTest(async (ownerWalletAddress) => [{
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      assetAddress: transferredAsset,
      metadataUri: opened ? openedMetadataUri : sealedMetadataUri,
      serial: 570329,
      name: "Ruby High Pack #570329",
      ownerWalletAddress,
      opened,
    }]);

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-opened-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      assetAddress: transferredAsset,
      status: "active",
    });

    opened = true;
    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-opened-pack",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        importedCount: 0,
        known: [{ assetAddress: transferredAsset, opened: true }],
      },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassPacks?.[0]).toMatchObject({
      assetAddress: transferredAsset,
      status: "opened",
      metadataUri: openedMetadataUri,
    });
  });

  it("rate limits repeated wallet pack syncs before calling the on-chain fetcher", async () => {
    signInUser("sync-pack-rate-limit");
    const fetchOwned = vi.fn(async () => [] as OwnedCorePackNft[]);
    restorePackFetcher = setOwnedCorePackNftFetcherForTest(fetchOwned);

    for (let i = 0; i < 30; i += 1) {
      await handleNftRoutes(makeCtx({
        method: "POST",
        path: "/api/apps/ruby-high/nft/sync-packs",
        cookie: "rh_session=sync-pack-rate-limit",
        body: { ownerWalletAddress: OWNER },
      }), deps());
      expect(lastResponse?.status).toBe(200);
    }

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=sync-pack-rate-limit",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toEqual({
      status: 429,
      body: { error: "Too many NFT requests. Try again shortly." },
    });
    expect(lastHeaders["retry-after"]).toBe("10");
    expect(fetchOwned).toHaveBeenCalledTimes(30);
  });

  it("prepares one owner-paid card mint without recording the reveal", async () => {
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
      characterId: "card-back",
      characterName: "Mystery Card",
      mintAddress: null,
      mintSignature: null,
    });
    expect(lastResponse?.body.mint).toMatchObject({
      cardId: grant.cards![0]!.id,
      ownerWalletAddress: OWNER,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      transactionBase64: "AQID",
      transactionMessageHash: "prepared-transaction-hash",
      chain: "solana:mainnet",
      serverMinted: false,
    });
    expect(lastResponse?.body.mint.rpcUrl).toBeUndefined();
    expect(lastResponse?.body.minted).toHaveLength(0);
    expect(lastResponse?.body.remaining).toBe(20);
    const cards = ruby.getOrCreate(stateKey).wallet.hallPassCards ?? [];
    expect(cards.filter((card) => card.mintAddress && card.mintSignature && card.metadataUri)).toHaveLength(0);
    expect(cards.find((card) => card.id === grant.cards![0]!.id)).toMatchObject({
      pendingMintOwnerWalletAddress: OWNER,
      pendingMintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      pendingMintMetadataUri: lastResponse?.body.mint.metadataUri,
      pendingMintTransactionHash: "prepared-transaction-hash",
      pendingMintPreparedAt: expect.any(Number),
    });
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(false);
  });

  it("rejects non-json card mint preparation before writing pending mint state", async () => {
    const stateKey = signInUser("mint-prepare-content-type");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "stripe:checkout:mint_prepare_content_type",
      source: "stripe",
    });
    const card = grant.cards![0]!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=mint-prepare-content-type",
      contentTypeHeader: "text/plain",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 415,
      body: { error: "NFT requests must be sent as JSON." },
    });
    const recorded = ruby.getOrCreate(stateKey).wallet.hallPassCards?.[0];
    expect(recorded).toMatchObject({ id: card.id });
    expect(recorded).not.toHaveProperty("mintAddress");
    expect(recorded).not.toHaveProperty("mintSignature");
    expect(recorded).not.toHaveProperty("metadataUri");
    expect(recorded).not.toHaveProperty("pendingMintAddress");
    expect(recorded).not.toHaveProperty("pendingMintMetadataUri");
    expect(recorded).not.toHaveProperty("pendingMintTransactionHash");
  });

  it("accepts the prepared durable metadata URI for owner-paid card mint submission", async () => {
    const durableMetadataUri = "https://arweave.net/ruby-high-card-metadata-json";
    restoreMintBuilder?.();
    restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async (card, ownerWalletAddress) => ({
      cardId: card.id,
      ownerWalletAddress,
      mintAddress: "PreparedMint11111111111111111111111111111",
      metadataUri: durableMetadataUri,
      transactionBase64: "AQID",
      transactionMessageHash: "durable-prepared-transaction-hash",
      transactionEncoding: "base64",
      chain: "solana:mainnet",
      rpcUrl: "https://rpc.example",
    }));
    const stateKey = signInUser("owner-paid-durable-submit");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "stripe:checkout:owner_paid_durable_submit",
      source: "stripe",
    });
    const card = grant.cards![0]!;

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=owner-paid-durable-submit",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.mint.metadataUri).toBe(durableMetadataUri);
    const recordedCard = ruby.getOrCreate(stateKey).wallet.hallPassCards?.find((candidate) => candidate.id === card.id);
    expect(recordedCard).toMatchObject({
      pendingMintAddress: "PreparedMint11111111111111111111111111111",
      pendingMintMetadataUri: durableMetadataUri,
      pendingMintTransactionHash: "durable-prepared-transaction-hash",
    });
    const signedTransactionBase64 = signedCardMintTransactionForTest();

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-submit",
      cookie: "rh_session=owner-paid-durable-submit",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "PreparedMint11111111111111111111111111111",
        metadataUri: durableMetadataUri,
        signedTransactionBase64,
      },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.card).toMatchObject({
      id: card.id,
      mintAddress: "PreparedMint11111111111111111111111111111",
      metadataUri: durableMetadataUri,
    });
    const mintedCard = ruby.getOrCreate(stateKey).wallet.hallPassCards?.find((candidate) => candidate.id === card.id);
    expect(mintedCard).toMatchObject({ metadataUri: durableMetadataUri });
    expect(mintedCard).not.toHaveProperty("pendingMintAddress");
    expect(mintedCard).not.toHaveProperty("pendingMintMetadataUri");
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
      return hallPassCardMintSignatureFromSignedTransaction(signedTransactionBase64);
    });
    const stateKey = signInUser("owner-paid-submit");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 2,
      idempotencyKey: "stripe:checkout:owner_paid_submit",
      source: "stripe",
    });
    const card = grant.cards![0]!;

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=owner-paid-submit",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());
    expect(lastResponse?.status).toBe(200);
    const preparedMetadataUri = lastResponse?.body.mint.metadataUri;
    const signedTransactionBase64 = signedCardMintTransactionForTest();
    const expectedMintSignature = hallPassCardMintSignatureFromSignedTransaction(signedTransactionBase64);

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-submit",
      cookie: "rh_session=owner-paid-submit",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        metadataUri: preparedMetadataUri,
        signedTransactionBase64,
      },
    }), deps());

    expect(handled).toBe(true);
    expect(submittedTransactionBase64).toBe(signedTransactionBase64);
    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.minted).toHaveLength(1);
    expect(lastResponse?.body.card).toMatchObject({
      id: card.id,
      mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      mintSignature: expectedMintSignature,
      metadataUri: preparedMetadataUri,
    });
    expect(lastResponse?.body.remaining).toBe(1);
    expect(ruby.getOrCreate(stateKey).wallet.transactions?.some((tx) => tx.kind === "hall-pass-card-mint")).toBe(true);
  });

  it("recovers a card mint when Solana accepted the transaction but the submit response failed", async () => {
    const stateKey = signInUser("owner-paid-submit-recovery");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "stripe:checkout:owner_paid_submit_recovery",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=owner-paid-submit-recovery",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());
    const prepared = lastResponse?.body.mint;
    const signedTransactionBase64 = signedCardMintTransactionForTest();
    const expectedMintSignature = hallPassCardMintSignatureFromSignedTransaction(signedTransactionBase64);
    const submit = vi.fn(async () => {
      throw new Error("Solana RPC response timed out after broadcast");
    });
    restoreMintSubmitter?.();
    restoreMintSubmitter = setHallPassNftMintSubmitterForTest(submit);

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-submit",
      cookie: "rh_session=owner-paid-submit-recovery",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: prepared.mintAddress,
        metadataUri: prepared.metadataUri,
        signedTransactionBase64,
      },
    }), deps());

    expect(lastResponse?.status).toBe(400);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.[0]).toMatchObject({
      pendingMintSignature: expectedMintSignature,
      pendingMintSubmittedAt: expect.any(Number),
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=owner-paid-submit-recovery",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        mint: {
          mintAddress: prepared.mintAddress,
          serverMinted: true,
        },
        card: {
          id: card.id,
          mintSignature: expectedMintSignature,
        },
      },
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(ruby.mintableHallPassCards(stateKey)).toHaveLength(0);
  });

  it("keeps failed on-chain card reveals pending and repairs them during wallet sync", async () => {
    const stateKey = signInUser("card-reveal-repair");
    const grant = ruby.grantHallPassCards(stateKey, {
      cardCount: 1,
      idempotencyKey: "stripe:checkout:card_reveal_repair",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    let revealAttempts = 0;
    restoreRevealUpdater = setHallPassNftRevealUpdaterForTest(async () => {
      revealAttempts += 1;
      if (revealAttempts === 1) throw new Error("temporary Core update timeout");
    });
    restorePackFetcher = setOwnedCorePackNftFetcherForTest(async () => []);

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-confirm",
      cookie: "rh_session=card-reveal-repair",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        mintSignature: "5mCardMintSignatureRevealRepair111111111111111111111111111",
        metadataUri: hallPassNftMetadataUri(card),
      },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.[0]).toMatchObject({
      onChainRevealPending: true,
      onChainRevealAttemptedAt: expect.any(Number),
    });

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/sync-packs",
      cookie: "rh_session=card-reveal-repair",
      body: { ownerWalletAddress: OWNER },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: { repairedCardReveals: 1 },
    });
    expect(revealAttempts).toBe(2);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.[0]?.onChainRevealPending).toBeUndefined();
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
      transactionMessageHash: "prepared-transaction-hash",
      serverMinted: false,
    });
    expect(lastResponse?.body.mint.rpcUrl).toBeUndefined();
    expect(lastResponse?.body.remaining).toBe(8);
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((card) => card.mintAddress)).toHaveLength(0);
  });

  it("returns card mint transaction build errors without mutating the card", async () => {
    restoreMintBuilder?.();
    restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async () => {
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

  it("returns server mint authority errors for insufficient lamports preflight failures", async () => {
    restoreMintBuilder?.();
    restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async () => {
      throw new Error("Transfer: insufficient lamports 1620352, need 15115600");
    });
    const stateKey = signInUser("mint-user-insufficient-lamports");
    ruby.grantHallPassCards(stateKey, {
      cardCount: 5,
      idempotencyKey: "stripe:checkout:cs_mint_user_insufficient_lamports",
      source: "stripe",
    });
    const card = ruby.mintableHallPassCards(stateKey)[0]!;

    const handled = await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/mint-card-prepare",
      cookie: "rh_session=mint-user-insufficient-lamports",
      body: { cardId: card.id, ownerWalletAddress: OWNER },
    }), deps());

    expect(handled).toBe(true);
    expect(lastResponse).toMatchObject({
      status: 502,
      body: { error: "This card mint needs more SOL for Solana rent and fees. Your card was not changed." },
    });
    expect(ruby.getOrCreate(stateKey).wallet.hallPassCards?.filter((candidate) => candidate.mintAddress)).toHaveLength(0);
  });

  it("returns retryable Solana RPC mint errors without mutating the card", async () => {
    restoreMintBuilder?.();
    restoreMintBuilder = setHallPassNftMintTransactionBuilderForTest(async () => {
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
    const burnSignature = "4444444444444444444444444444444444444444444444444444444444444444";
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
    expect(lastResponse?.body.burn.rpcUrl).toBeUndefined();

    await handleNftRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/nft/burn-confirm",
      cookie: "rh_session=burn",
      body: {
        cardId: card.id,
        ownerWalletAddress: OWNER,
        mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
        burnSignature,
      },
    }), deps());

    expect(lastResponse?.status).toBe(200);
    expect(lastResponse?.body.burn.slot).toBe(123);
    expect(lastResponse?.body).toMatchObject({
      applied: true,
      amount: 5,
      hallPasses: 5,
      burnedCards: [{
        cardId: card.id,
        characterId: card.characterId,
        characterName: card.characterName,
        burnSignature,
      }],
    });
    const burnedCard = ruby.getOrCreate(stateKey).wallet.hallPassCards?.find((candidate) => candidate.id === card.id);
    expect(burnedCard).toMatchObject({
      status: "redeemed",
      burnSignature,
    });
    expect(ruby.burnableHallPassCards(stateKey, OWNER)).toHaveLength(0);

    await handleBillingRoutes(makeCtx({
      method: "POST",
      path: "/api/apps/ruby-high/billing/card-burn",
      cookie: "rh_session=burn",
      body: {
        hallPassBurns: [{
          cardId: card.id,
          ownerWalletAddress: OWNER,
          mintAddress: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
          burnSignature,
        }],
      },
    }), deps());

    expect(lastResponse).toMatchObject({
      status: 200,
      body: {
        ok: true,
        applied: false,
        amount: 5,
        hallPasses: 5,
      },
    });
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
