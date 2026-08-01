import type { AuthRecord, AuthService } from "../services/auth-service.js";
import { createHash } from "node:crypto";
import {
  corePackCollectionMetadataForRoute,
  fetchCorePackCurrentOwnershipOrNull,
  fetchCorePacksCurrentOwnershipOrNull,
  corePackNftMetadataForRoute,
  type OwnedCorePackNft,
  fetchOwnedCorePackNfts,
  publicCorePackNftStatus,
  updateCorePackNftToOpened,
} from "../services/core-pack-nfts.js";
import {
  HALL_PASS_NFT_PREFIX,
  hallPassCollectionMetadataForRoute,
  hallPassCardBackMetadataForRoute,
  hallPassNftMetadataUris,
  buildHallPassCardMintTransaction,
  buildHallPassCardsBurnTransaction,
  generatedHallPassCardMetadataForRoute,
  hallPassNftMetadataForRoute,
  hallPassNftStatus,
  fetchHallPassCardsCurrentOwnershipOrNull,
  publicHallPassNftStatus,
  revealHallPassCardNft,
  submitSignedHallPassCardMintTransaction,
  verifyHallPassCardMint,
  verifyHallPassCardBurn,
} from "../services/hall-pass-nfts.js";
import type { HallPassCardBurnInput } from "../services/ruby-high-service.js";
import {
  HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
  type RubyHighService,
} from "../services/ruby-high-service.js";
import { log } from "../services/logger.js";
import { TokenBucket } from "../services/rate-limit.js";
import { solanaErrorMessages } from "../services/solana-errors.js";
import {
  FIRST_BELL_SET_CODE,
  FIRST_BELL_SET_NAME,
  hallPassCardCatalogEntry,
  hallPassCardName,
  hallPassCardProfileId,
  hallPassCardSetNumber,
  hallPassCardSubject,
} from "../services/hall-pass-card-catalog.js";
import type { RubyHighHallPassCard, RubyHighHallPassPack, RubyHighWalletTransaction } from "../types.js";
import type { RouteContext } from "./context.js";
import { constantTimeSecretEqual } from "../services/secret-comparison.js";

interface NftDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

const MAX_MINTS_PER_REQUEST = 8;
const MAX_BURNS_PER_REQUEST = 1;
const PENDING_MINT_RETRY_AFTER_MS = 2 * 60 * 1000;
const BASE58ISH = /^[1-9A-HJ-NP-Za-km-z]+$/;
const NFT_MUTATION_LIMITER = new TokenBucket(30, 1 / 10);
const PACK_OPEN_QUEUE = new Map<string, Promise<void>>();

interface PackOpenRouteResult {
  applied: boolean;
  pack: RubyHighHallPassPack;
  cards: RubyHighHallPassCard[];
  transaction: RubyHighWalletTransaction;
  packUpdate: Record<string, unknown> | null;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function nftOriginAllowed(ctx: RouteContext): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidates = [
      ctx.callbackUrlBuilder ? ctx.callbackUrlBuilder("/") : null,
      ctx.url?.origin ?? null,
    ].filter(Boolean) as string[];
    if (candidates.length === 0) return true;
    return candidates.some((candidate) => {
      const candidateUrl = new URL(candidate);
      return candidateUrl.origin === originUrl.origin
        || (originUrl.protocol === "https:" && candidateUrl.host === originUrl.host);
    });
  } catch {
    return false;
  }
}

function nftRequestLooksLikeJson(ctx: RouteContext): boolean {
  const contentType = firstHeader(ctx.contentTypeHeader).toLowerCase();
  return !contentType || contentType.startsWith("application/json");
}

function rejectBadNftMutationRequest(ctx: RouteContext): boolean {
  if (ctx.method === "GET" || ctx.method === "HEAD") return false;
  if (!nftRequestLooksLikeJson(ctx)) {
    ctx.error(ctx.res, "NFT requests must be sent as JSON.", 415);
    return true;
  }
  if (!nftOriginAllowed(ctx)) {
    ctx.error(ctx.res, "NFT request origin is not allowed.", 403);
    return true;
  }
  return false;
}

function nftMutationRateKey(ctx: RouteContext, deps: NftDeps): string {
  const token = deps.auth.parseSessionToken(ctx.cookieHeader);
  return `${ctx.clientIp || "no-ip"}:${token || "anon"}:nft`;
}

function takeNftMutationToken(ctx: RouteContext, deps: NftDeps): boolean {
  if (ctx.method === "GET" || ctx.method === "HEAD") return true;
  const key = nftMutationRateKey(ctx, deps);
  if (NFT_MUTATION_LIMITER.take(key)) return true;
  const retryAfter = NFT_MUTATION_LIMITER.retryAfterSeconds(key);
  const res = ctx.res as { setHeader?: (name: string, value: string) => void };
  res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
  ctx.error(ctx.res, "Too many NFT requests. Try again shortly.", 429);
  return false;
}

function configuredCosyWorldExportToken(): string {
  return (process.env.RUBY_HIGH_COSYWORLD_EXPORT_TOKEN ?? "").trim();
}

function bearerTokenFromAuthHeader(value: string | string[] | null | undefined): string {
  const header = firstHeader(value).trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] ?? "").trim();
}

function authorizeCosyWorldExport(ctx: RouteContext): boolean {
  const expected = configuredCosyWorldExportToken();
  if (!expected) {
    ctx.error(ctx.res, "CosyWorld ownership export is not configured.", 503);
    return false;
  }
  if (!constantTimeSecretEqual(bearerTokenFromAuthHeader(ctx.authorizationHeader), expected)) {
    ctx.error(ctx.res, "CosyWorld ownership export requires authorization.", 401);
    return false;
  }
  return true;
}

function setPrivateNoStoreHeaders(res: unknown): void {
  (res as { setHeader?: (name: string, value: string) => void }).setHeader?.("Cache-Control", "private, no-store");
}

function hallPassBurnConversionKey(burns: HallPassCardBurnInput[]): string {
  const stable = burns
    .map((burn) => `${burn.cardId}:${burn.mintAddress}:${burn.burnSignature}`)
    .sort()
    .join("|");
  return `hall-pass-card-burn:${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

export async function handleNftRoutes(ctx: RouteContext, deps: NftDeps): Promise<boolean> {
  if (!ctx.pathname.startsWith(HALL_PASS_NFT_PREFIX)) return false;
  if (rejectBadNftMutationRequest(ctx)) return true;
  if (!takeNftMutationToken(ctx, deps)) return true;

  if (ctx.method === "GET" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/internal/cosyworld/wallet-cards`) {
    if (!authorizeCosyWorldExport(ctx)) return true;
    try {
      const exportPayload = await deps.ruby.cosyWorldWalletCards(
        fetchHallPassCardsCurrentOwnershipOrNull,
        fetchCorePacksCurrentOwnershipOrNull,
      );
      setPrivateNoStoreHeaders(ctx.res);
      ctx.json(ctx.res, exportPayload);
    } catch (err) {
      log.error("nft.cosyworld-export-failed", err);
      ctx.error(ctx.res, "CosyWorld ownership export failed.", 502);
    }
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/metadata/core/collection.json`) {
    setNftMetadataCacheHeaders(ctx.res);
    ctx.json(ctx.res, corePackCollectionMetadataForRoute({
      publicBaseUrl: publicBaseUrlForRequest(ctx),
    }));
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/metadata/hall-pass/collection.json`) {
    setNftMetadataCacheHeaders(ctx.res);
    ctx.json(ctx.res, hallPassCollectionMetadataForRoute({
      publicBaseUrl: publicBaseUrlForRequest(ctx),
    }));
    return true;
  }

  const corePackMetadataMatch = ctx.pathname.match(
    /^\/api\/apps\/ruby-high\/nft\/metadata\/core\/pack\/([^/]+)\/([^/]+)\.json$/,
  );
  if (ctx.method === "GET" && corePackMetadataMatch) {
    const productId = decodePathSegment(corePackMetadataMatch[1] ?? "card-pack-1");
    const serial = decodePathSegment(corePackMetadataMatch[2] ?? "1");
    if (!productId || !serial) {
      ctx.error(ctx.res, "Unknown Ruby High pack metadata id.", 404);
      return true;
    }
    const knownPack = deps.ruby.findHallPassPackByMetadata(productId, Math.max(1, Math.floor(Number(serial || 1))));
    const opened = ctx.url?.searchParams.get("opened") === "1"
      || ctx.url?.searchParams.get("state") === "opened"
      || knownPack?.status === "opened";
    setNftMetadataCacheHeaders(ctx.res);
    ctx.json(ctx.res, corePackNftMetadataForRoute({
      productId,
      serial,
      packCount: ctx.url?.searchParams.get("packs") ?? undefined,
      cardCount: ctx.url?.searchParams.get("cards") ?? undefined,
      publicBaseUrl: publicBaseUrlForRequest(ctx),
      opened,
      ...revealProvenanceFromPack(knownPack),
    }));
    return true;
  }

  const cardMetadataMatch = ctx.pathname.match(
    /^\/api\/apps\/ruby-high\/nft\/metadata\/hall-pass\/card\/([^/]+)\.json$/,
  );
  if (ctx.method === "GET" && cardMetadataMatch) {
    const cardId = decodePathSegment(cardMetadataMatch[1] ?? "");
    if (!cardId) {
      ctx.error(ctx.res, "Unknown Ruby High card metadata id.", 404);
      return true;
    }
    const card = deps.ruby.findHallPassCardById(cardId);
    if (!card) {
      ctx.error(ctx.res, "Unknown Ruby High card metadata id.", 404);
      return true;
    }
    setNftMetadataCacheHeaders(ctx.res);
    if (card?.mintAddress && card.mintSignature) {
      const metadata = hallPassNftMetadataForRoute({
        characterId: card.characterId,
        serial: String(card.serial),
        publicBaseUrl: publicBaseUrlForRequest(ctx),
        ...revealProvenanceFromCard(card),
      }) ?? generatedHallPassCardMetadataForRoute({
        card,
        publicBaseUrl: publicBaseUrlForRequest(ctx),
      });
      if (!metadata) {
        ctx.error(ctx.res, "Unknown Ruby High card character.", 404);
        return true;
      }
      ctx.json(ctx.res, metadata);
    } else {
      ctx.json(ctx.res, hallPassCardBackMetadataForRoute({
        cardId,
        serial: String(card.serial),
        publicBaseUrl: publicBaseUrlForRequest(ctx),
        ...revealProvenanceFromCard(card),
      }));
    }
    return true;
  }

  const metadataMatch = ctx.pathname.match(
    /^\/api\/apps\/ruby-high\/nft\/metadata\/hall-pass\/([^/]+)\/([^/]+)\.json$/,
  );
  if (ctx.method === "GET" && metadataMatch) {
    const characterId = decodePathSegment(metadataMatch[1] ?? "ruby");
    const serial = decodePathSegment(metadataMatch[2] ?? "1");
    if (!characterId || !serial) {
      ctx.error(ctx.res, "Unknown Ruby High card character.", 404);
      return true;
    }
    const knownCard = deps.ruby.findHallPassCardByMetadata(characterId, Math.max(1, Math.floor(Number(serial || 1))));
    const metadata = hallPassNftMetadataForRoute({
      characterId,
      serial,
      publicBaseUrl: publicBaseUrlForRequest(ctx),
      ...revealProvenanceFromCard(knownCard),
    }) ?? (knownCard
      ? generatedHallPassCardMetadataForRoute({
        card: knownCard,
        publicBaseUrl: publicBaseUrlForRequest(ctx),
      })
      : null);
    if (!metadata) {
      ctx.error(ctx.res, "Unknown Ruby High card character.", 404);
      return true;
    }
    setNftMetadataCacheHeaders(ctx.res);
    ctx.json(ctx.res, metadata);
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/status`) {
    ctx.json(ctx.res, {
      ...publicHallPassNftStatus(),
      corePacks: publicCorePackNftStatus(),
    });
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/v2/cast-card`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    const characterId = typeof body.characterId === "string" ? body.characterId.trim().slice(0, 96) : "";
    if (!characterId) {
      ctx.error(ctx.res, "Cast character id is required.", 400);
      return true;
    }
    try {
      const result = deps.ruby.createGeneratedCastNftCard(stateKey, {
        characterId,
        ownerWalletAddress,
        requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      });
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        card: revealedCardPayload(result.card),
        minted: [],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.v2-cast-card-failed", err, { sessionId: stateKey, characterId });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/v2/player-card`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    try {
      const result = deps.ruby.createGeneratedPlayerNftCard(stateKey, {
        ownerWalletAddress,
        requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      });
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        card: revealedCardPayload(result.card),
        minted: [],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.v2-player-card-failed", err, { sessionId: stateKey });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/v2/yearbook-card`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    const grade = typeof body.grade === "string" ? body.grade.trim() : "";
    if (grade !== "9" && grade !== "10" && grade !== "11" && grade !== "12") {
      ctx.error(ctx.res, "Grade must be one of 9, 10, 11, or 12.", 400);
      return true;
    }
    try {
      const result = deps.ruby.createGeneratedYearbookNftCard(stateKey, {
        grade,
        ownerWalletAddress,
        requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      });
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        card: revealedCardPayload(result.card),
        minted: [],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.v2-yearbook-card-failed", err, { sessionId: stateKey, grade });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/sync-packs`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const boundWallet = boundSolanaWalletAddress(record, deps.auth, body.ownerWalletAddress);
    const ownerWalletAddress = boundWallet.address;
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, boundWallet.error || "Connect a Solana wallet before syncing packs.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    try {
      const repairedCardReveals = await repairPendingCardReveals(stateKey, ownerWalletAddress, deps.ruby);
      const ownedPacks = await fetchOwnedCorePackNfts(ownerWalletAddress);
      const recordedPacks = deps.ruby.hallPassPacks(stateKey);
      const enumeratedAssets = new Set(ownedPacks.map((pack) => pack.assetAddress));
      const missingActiveAssets = recordedPacks
        .filter((pack) => (
          pack.status === "active" &&
          pack.ownerWalletAddress === ownerWalletAddress &&
          !enumeratedAssets.has(pack.assetAddress)
        ))
        .map((pack) => pack.assetAddress);
      const directlyVerified = await fetchCorePacksCurrentOwnershipOrNull(missingActiveAssets);
      const ownedAssetAddresses = new Set(enumeratedAssets);
      for (const ownership of directlyVerified.values()) {
        if (ownership.ownerWalletAddress !== ownerWalletAddress) continue;
        ownedAssetAddresses.add(ownership.assetAddress);
        if (ownership.opened) {
          deps.ruby.recordHallPassPackOnChainOpened(
            stateKey,
            ownership.assetAddress,
            ownership.metadataUri,
          );
        }
      }
      const existingAssets = new Set(recordedPacks.map((pack) => pack.assetAddress));
      const imported: RubyHighHallPassPack[] = [];
      const known: OwnedCorePackNft[] = [];
      for (const owned of ownedPacks) {
        if (existingAssets.has(owned.assetAddress)) {
          if (owned.opened) {
            deps.ruby.recordHallPassPackOnChainOpened(
              stateKey,
              owned.assetAddress,
              owned.metadataUri,
            );
          }
          known.push(owned);
          continue;
        }
        const result = deps.ruby.recordHallPassPackMint(stateKey, {
          productId: owned.productId,
          packCount: owned.packCount,
          cardCount: owned.cardCount,
          ownerWalletAddress: owned.ownerWalletAddress,
          assetAddress: owned.assetAddress,
          mintSignature: `import:${owned.assetAddress}`,
          metadataUri: owned.metadataUri,
          idempotencyKey: `solana:core-pack-import:${owned.assetAddress}`,
          status: owned.opened ? "opened" : "active",
          source: "solana",
          description: "Ruby High Pack imported from wallet",
          serial: owned.serial,
          metadata: {
            importedOnChain: true,
            ownerWalletAddress: owned.ownerWalletAddress,
            packAssetAddress: owned.assetAddress,
            packMetadataUri: owned.metadataUri,
          },
        });
        if (result.pack) imported.push(result.pack);
        existingAssets.add(owned.assetAddress);
      }
      const reconciliation = deps.ruby.reconcileHallPassPacksForOwner(
        stateKey,
        ownerWalletAddress,
        [...ownedAssetAddresses],
      );
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        ownerWalletAddress,
        imported: imported.map(packPayload),
        removed: reconciliation.removed.map(packPayload),
        restored: reconciliation.restored.map(packPayload),
        known: known.map((pack) => ({
          productId: pack.productId,
          packCount: pack.packCount,
          cardCount: pack.cardCount,
          assetAddress: pack.assetAddress,
          metadataUri: pack.metadataUri,
          serial: pack.serial,
          opened: pack.opened,
        })),
        onChainCount: ownedPacks.length,
        importedCount: imported.length,
        removedCount: reconciliation.removed.length,
        restoredCount: reconciliation.restored.length,
        repairedCardReveals,
      });
    } catch (err) {
      log.error("nft.pack-sync-failed", err, {
        sessionId: stateKey,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, publicPackSyncErrorMessage(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/open-pack`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const packId = typeof body.packId === "string" ? body.packId.trim().slice(0, 96) : "";
    const boundWallet = boundSolanaWalletAddress(record, deps.auth, body.ownerWalletAddress);
    const ownerWalletAddress = boundWallet.address;
    if (!packId) {
      ctx.error(ctx.res, "Pack id is required.", 400);
      return true;
    }
    const status = publicCorePackNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Pack opening is not configured.", 503);
      return true;
    }
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, boundWallet.error || "Connect a Solana wallet before opening a pack.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const recordedPack = deps.ruby.hallPassPacks(stateKey)
      .find((candidate) => candidate.id === packId || candidate.assetAddress === packId);
    if (!recordedPack) {
      ctx.error(ctx.res, "Pack not found.", 404);
      return true;
    }
    try {
      const result = await openHallPassPackWithLock(deps, stateKey, recordedPack.id, ownerWalletAddress);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        ownerWalletAddress,
        pack: result.pack ? packPayload(result.pack) : null,
        packNftUpdate: result.packUpdate,
        cards: result.cards.map(hiddenCardPayload),
        minted: [],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
        cardCount: result.cards.length > 0
          ? result.cards.length
          : Number(result.transaction.metadata?.cardCount ?? 0),
      });
    } catch (err) {
      log.error("nft.pack-open-failed", err, {
        sessionId: stateKey,
        packId,
        ownerWalletAddress,
      });
      const message = publicNftErrorMessage(err);
      ctx.error(ctx.res, message, /ownership|owned|already opened on-chain/i.test(message) ? 409 : 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/mint-card-prepare`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card minting is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const cardId = typeof body.cardId === "string" ? body.cardId.trim().slice(0, 96) : "";
    const clientBuild = cleanClientBuild(body.clientBuild);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    const requestId = nftRequestId("cmp");
    log.event("nft.card-mint-prepare-received", {
      requestId,
      sessionId: stateKey,
      cardId,
      ownerWalletAddress,
      clientBuild,
      userAgent: clipLogValue(headerString(ctx.userAgentHeader), 96),
    });
    if (!cardId) {
      ctx.error(ctx.res, "Card id is required.", 400);
      return true;
    }
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before minting cards.", 400);
      return true;
    }
    const card = deps.ruby.mintableHallPassCards(stateKey).find((candidate) => candidate.id === cardId);
    if (!card) {
      ctx.error(ctx.res, "No face-down card is available to mint.", 404);
      return true;
    }
    if (card.ownerWalletAddress && card.ownerWalletAddress !== ownerWalletAddress) {
      ctx.error(ctx.res, "Card belongs to a different wallet.", 400);
      return true;
    }
    try {
      const recoveredCard = await recoverPendingCardMint(stateKey, card, deps.ruby);
      if (recoveredCard) {
        ctx.json(ctx.res, {
          ok: true,
          card: revealedCardPayload(recoveredCard),
          minted: [{
            cardId: recoveredCard.id,
            characterId: recoveredCard.characterId,
            characterName: recoveredCard.characterName,
            mintAddress: recoveredCard.mintAddress,
            mintSignature: recoveredCard.mintSignature,
            metadataUri: recoveredCard.metadataUri,
          }],
          mint: {
            cardId: recoveredCard.id,
            ownerWalletAddress: recoveredCard.ownerWalletAddress,
            mintAddress: recoveredCard.mintAddress,
            metadataUri: recoveredCard.metadataUri,
            serverMinted: true,
          },
          remaining: deps.ruby.mintableHallPassCards(stateKey).length,
          status: publicHallPassNftStatus(),
        });
        return true;
      }
      const mint = await buildHallPassCardMintTransaction(card, ownerWalletAddress);
      const preparedCard = deps.ruby.recordHallPassCardMintPreparation(stateKey, {
        cardId: card.id,
        ownerWalletAddress: mint.ownerWalletAddress,
        mintAddress: mint.mintAddress,
        metadataUri: mint.metadataUri,
        transactionMessageHash: mint.transactionMessageHash,
      });
      await deps.ruby.flushSession(stateKey);
      log.event("nft.card-mint-prepare-built", {
        requestId,
        sessionId: stateKey,
        cardId,
        ownerWalletAddress: mint.ownerWalletAddress,
        mintAddress: mint.mintAddress,
        metadataUri: previewUri(mint.metadataUri),
        clientBuild,
      });
      ctx.json(ctx.res, {
        ok: true,
        card: hiddenCardPayload(preparedCard),
        minted: [],
        mint: {
          cardId: card.id,
          ownerWalletAddress: mint.ownerWalletAddress,
          mintAddress: mint.mintAddress,
          metadataUri: mint.metadataUri,
          transactionBase64: mint.transactionBase64,
          transactionMessageHash: mint.transactionMessageHash,
          transactionEncoding: mint.transactionEncoding,
          chain: mint.chain,
          serverMinted: false,
        },
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.card-mint-prepare-failed", err, {
        requestId,
        sessionId: stateKey,
        cardId,
        ownerWalletAddress,
        clientBuild,
      });
      const message = publicNftErrorMessage(err);
      ctx.error(ctx.res, message, /still confirming/i.test(message) ? 425 : 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/mint-card-submit`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card minting is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const cardId = typeof body.cardId === "string" ? body.cardId.trim().slice(0, 96) : "";
    const ownerWalletAddress = cleanOwnerWalletAddress(typeof body.ownerWalletAddress === "string" ? body.ownerWalletAddress : "");
    const mintAddress = cleanOwnerWalletAddress(typeof body.mintAddress === "string" ? body.mintAddress : "");
    const metadataUri = typeof body.metadataUri === "string" ? body.metadataUri.trim() : "";
    const signedTransactionBase64 = typeof body.signedTransactionBase64 === "string" ? body.signedTransactionBase64.trim() : "";
    const clientBuild = cleanClientBuild(body.clientBuild);
    const requestId = nftRequestId("cms");
    log.event("nft.card-mint-submit-received", {
      requestId,
      sessionId: stateKey,
      cardId,
      ownerWalletAddress,
      mintAddress,
      metadataUri: previewUri(metadataUri),
      signedTransactionBytes: signedTransactionBase64 ? Math.floor((signedTransactionBase64.length * 3) / 4) : 0,
      clientBuild,
      userAgent: clipLogValue(headerString(ctx.userAgentHeader), 96),
    });
    if (!cardId || !ownerWalletAddress || !mintAddress || !metadataUri || !signedTransactionBase64) {
      ctx.error(ctx.res, "Card mint submission is incomplete.", 400);
      return true;
    }
    const card = deps.ruby.mintableHallPassCards(stateKey).find((candidate) => candidate.id === cardId);
    if (!card) {
      ctx.error(ctx.res, "No face-down card matches this mint.", 404);
      return true;
    }
    if (card.ownerWalletAddress && card.ownerWalletAddress !== ownerWalletAddress) {
      ctx.error(ctx.res, "Card belongs to a different wallet.", 400);
      return true;
    }
    if (!hallPassCardPendingMintMatches(card, { ownerWalletAddress, mintAddress, metadataUri })) {
      ctx.error(ctx.res, "Card mint metadata does not match this card.", 400);
      return true;
    }
    const transactionMessageHash = typeof card.pendingMintTransactionHash === "string"
      ? card.pendingMintTransactionHash.trim()
      : "";
    if (!transactionMessageHash) {
      ctx.error(ctx.res, "Card mint transaction was not prepared. Refresh and try again.", 400);
      return true;
    }
    try {
      let expectedMintSignature = "";
      const mintSignature = await submitSignedHallPassCardMintTransaction(signedTransactionBase64, [
        ownerWalletAddress,
        mintAddress,
      ], {
        card,
        ownerWalletAddress,
        mintAddress,
        metadataUri,
        transactionMessageHash,
        beforeBroadcast: async (signature) => {
          expectedMintSignature = signature;
          deps.ruby.recordHallPassCardMintSubmission(stateKey, {
            cardId,
            ownerWalletAddress,
            mintAddress,
            metadataUri,
            mintSignature: signature,
          });
          await deps.ruby.flushSession(stateKey);
        },
      });
      if (!expectedMintSignature || mintSignature !== expectedMintSignature) {
        throw new Error("Solana RPC returned a different card mint signature.");
      }
      const verified = await verifyHallPassCardMint({
        ownerWalletAddress,
        mintAddress,
        mintSignature,
        metadataUri,
      });
      const recorded = deps.ruby.recordHallPassCardMint(stateKey, {
        cardId,
        ownerWalletAddress: verified.ownerWalletAddress,
        mintAddress: verified.mintAddress,
        mintSignature: verified.signature,
        metadataUri: verified.metadataUri,
      });
      await deps.ruby.flushSession(stateKey);
      await finishHallPassCardReveal(stateKey, recorded.card, deps.ruby);
      await deps.ruby.flushSession(stateKey);
      log.event("nft.card-mint-submit-recorded", {
        requestId,
        sessionId: stateKey,
        cardId,
        ownerWalletAddress: verified.ownerWalletAddress,
        mintAddress: verified.mintAddress,
        mintSignature: verified.signature,
        clientBuild,
      });
      ctx.json(ctx.res, {
        ok: true,
        card: revealedCardPayload(recorded.card),
        minted: [{
          cardId: recorded.card.id,
          characterId: recorded.card.characterId,
          characterName: recorded.card.characterName,
          mintAddress: recorded.card.mintAddress,
          mintSignature: recorded.card.mintSignature,
          metadataUri: recorded.card.metadataUri,
        }],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.card-mint-submit-failed", err, {
        requestId,
        sessionId: stateKey,
        cardId,
        ownerWalletAddress,
        mintAddress,
        metadataUri: previewUri(metadataUri),
        clientBuild,
      });
      ctx.error(ctx.res, `${publicNftErrorMessage(err)} [${requestId}]`, 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/mint-card-confirm`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card minting is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const cardId = typeof body.cardId === "string" ? body.cardId.trim().slice(0, 96) : "";
    const ownerWalletAddress = cleanOwnerWalletAddress(typeof body.ownerWalletAddress === "string" ? body.ownerWalletAddress : "");
    const mintAddress = cleanOwnerWalletAddress(typeof body.mintAddress === "string" ? body.mintAddress : "");
    const mintSignature = typeof body.mintSignature === "string" ? body.mintSignature.trim() : "";
    const metadataUri = typeof body.metadataUri === "string" ? body.metadataUri.trim() : "";
    if (!cardId || !ownerWalletAddress || !mintAddress || !mintSignature || !metadataUri) {
      ctx.error(ctx.res, "Card mint confirmation is incomplete.", 400);
      return true;
    }
    const card = deps.ruby.mintableHallPassCards(stateKey).find((candidate) => candidate.id === cardId);
    if (!card) {
      ctx.error(ctx.res, "No face-down card matches this mint.", 404);
      return true;
    }
    if (card.ownerWalletAddress && card.ownerWalletAddress !== ownerWalletAddress) {
      ctx.error(ctx.res, "Card belongs to a different wallet.", 400);
      return true;
    }
    if (!hallPassCardMintMetadataMatches(card, { ownerWalletAddress, mintAddress, metadataUri })) {
      ctx.error(ctx.res, "Card mint metadata does not match this card.", 400);
      return true;
    }
    try {
      const verified = await verifyHallPassCardMint({
        ownerWalletAddress,
        mintAddress,
        mintSignature,
        metadataUri,
      });
      const recorded = deps.ruby.recordHallPassCardMint(stateKey, {
        cardId,
        ownerWalletAddress: verified.ownerWalletAddress,
        mintAddress: verified.mintAddress,
        mintSignature: verified.signature,
        metadataUri: verified.metadataUri,
      });
      await deps.ruby.flushSession(stateKey);
      await finishHallPassCardReveal(stateKey, recorded.card, deps.ruby);
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        card: revealedCardPayload(recorded.card),
        minted: [{
          cardId: recorded.card.id,
          characterId: recorded.card.characterId,
          characterName: recorded.card.characterName,
          mintAddress: recorded.card.mintAddress,
          mintSignature: recorded.card.mintSignature,
          metadataUri: recorded.card.metadataUri,
        }],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.card-mint-confirm-failed", err, {
        sessionId: stateKey,
        cardId,
        ownerWalletAddress,
        mintAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/mint-pack`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card minting is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before minting cards.", 400);
      return true;
    }
    try {
      const card = deps.ruby.mintableHallPassCards(stateKey).slice(0, MAX_MINTS_PER_REQUEST)[0];
      if (!card) {
        ctx.json(ctx.res, {
          ok: true,
          ownerWalletAddress,
          minted: [],
          remaining: 0,
          status: publicHallPassNftStatus(),
        });
        return true;
      }
      if (card.ownerWalletAddress && card.ownerWalletAddress !== ownerWalletAddress) {
        ctx.error(ctx.res, "Card belongs to a different wallet.", 400);
        return true;
      }
      const mint = await buildHallPassCardMintTransaction(card, ownerWalletAddress);
      const preparedCard = deps.ruby.recordHallPassCardMintPreparation(stateKey, {
        cardId: card.id,
        ownerWalletAddress: mint.ownerWalletAddress,
        mintAddress: mint.mintAddress,
        metadataUri: mint.metadataUri,
        transactionMessageHash: mint.transactionMessageHash,
      });
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        ownerWalletAddress,
        minted: [],
        card: hiddenCardPayload(preparedCard),
        mint: {
          cardId: card.id,
          ownerWalletAddress: mint.ownerWalletAddress,
          mintAddress: mint.mintAddress,
          metadataUri: mint.metadataUri,
          transactionBase64: mint.transactionBase64,
          transactionMessageHash: mint.transactionMessageHash,
          transactionEncoding: mint.transactionEncoding,
          chain: mint.chain,
          serverMinted: false,
        },
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.legacy-mint-pack-failed", err, {
        sessionId: stateKey,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/burn-prepare`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card burning is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const stateKey = deps.auth.stateKeyForRecord(record);
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before burning a card.", 400);
      return true;
    }
    const cardIds = readCardIds(body);
    const burnable = deps.ruby.burnableHallPassCards(stateKey, ownerWalletAddress);
    const cards = cardIds.length > 0
      ? cardIds.flatMap((cardId) => {
        const card = burnable.find((candidate) => candidate.id === cardId);
        return card ? [card] : [];
      })
      : burnable.slice(0, 1);
    if (cards.length <= 0 || (cardIds.length > 0 && cards.length !== cardIds.length)) {
      ctx.error(ctx.res, "No minted card is available to burn from this wallet.", 404);
      return true;
    }
    if (cards.length > MAX_BURNS_PER_REQUEST) {
      ctx.error(ctx.res, `Burn at most ${MAX_BURNS_PER_REQUEST} card${MAX_BURNS_PER_REQUEST === 1 ? "" : "s"} at once.`, 400);
      return true;
    }
    try {
      const burn = await buildHallPassCardsBurnTransaction(cards, ownerWalletAddress);
      const { rpcUrl: _rpcUrl, ...publicBurn } = burn;
      const preparedCards = cards.map((card) => ({
        cardId: card.id,
        characterId: card.characterId,
        characterName: card.characterName,
        mintAddress: card.mintAddress,
      }));
      const firstCard = preparedCards[0]!;
      ctx.json(ctx.res, {
        ok: true,
        cardId: firstCard.cardId,
        characterId: firstCard.characterId,
        characterName: firstCard.characterName,
        mintAddress: firstCard.mintAddress,
        cards: preparedCards,
        ownerWalletAddress,
        burn: publicBurn,
      });
    } catch (err) {
      log.error("nft.card-burn-prepare-failed", err, {
        sessionId: stateKey,
        cardIds,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/burn-confirm`) {
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card burning is not configured.", 503);
      return true;
    }
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const burn = readBurnInput(body);
    if (!burn) {
      ctx.error(ctx.res, "Burn confirmation is incomplete.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    const card = deps.ruby.burnableHallPassCards(stateKey, burn.ownerWalletAddress)
      .find((candidate) => candidate.id === burn.cardId && candidate.mintAddress === burn.mintAddress);
    if (!card) {
      const existing = deps.ruby.getOrCreate(stateKey).wallet.hallPassCards
        ?.find((candidate) =>
          candidate.id === burn.cardId &&
          candidate.mintAddress === burn.mintAddress &&
          candidate.ownerWalletAddress === burn.ownerWalletAddress &&
          candidate.status === "redeemed" &&
          candidate.burnSignature === burn.burnSignature);
      if (existing) {
        ctx.json(ctx.res, {
          ok: true,
          applied: false,
          burn: {
            ...burn,
            slot: null,
            blockTime: null,
          },
          hallPasses: deps.ruby.hallPassBalance(stateKey),
          amount: HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
          burnedCards: [{
            cardId: existing.id,
            characterId: existing.characterId,
            characterName: existing.characterName,
            burnSignature: existing.burnSignature,
          }],
        });
        return true;
      }
      ctx.error(ctx.res, "No active minted card matches this burn.", 404);
      return true;
    }
    try {
      const verified = await verifyHallPassCardBurn(burn);
      const result = deps.ruby.convertBurnedHallPassCardsToHallPasses(stateKey, {
        burns: [burn],
        idempotencyKey: hallPassBurnConversionKey([burn]),
        source: "hall-pass-card",
        description: `1 Card burned for ${HALL_PASS_CARD_BURN_HALL_PASS_VALUE} Hall Passes`,
      });
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        burn: {
          ...burn,
          slot: verified.slot ?? null,
          blockTime: verified.blockTime ?? null,
        },
        hallPasses: result.state.wallet.hallPasses,
        amount: HALL_PASS_CARD_BURN_HALL_PASS_VALUE,
        burnedCards: result.cards?.map((burnedCard) => ({
          cardId: burnedCard.id,
          characterId: burnedCard.characterId,
          characterName: burnedCard.characterName,
          burnSignature: burnedCard.burnSignature,
        })) ?? [],
      });
    } catch (err) {
      log.error("nft.card-burn-confirm-failed", err, {
        sessionId: stateKey,
        cardId: burn.cardId,
        ownerWalletAddress: burn.ownerWalletAddress,
        mintAddress: burn.mintAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
    }
    return true;
  }

  return false;
}

function cleanOwnerWalletAddress(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  if (clean.length < 32 || clean.length > 44 || !BASE58ISH.test(clean)) return "";
  return clean;
}

function boundSolanaWalletAddress(
  record: AuthRecord,
  auth: AuthService,
  requestedValue: unknown,
): { address: string; error?: string } {
  const authenticated = record.walletChainType === "solana"
    ? cleanOwnerWalletAddress(auth.walletAddressForRecord(record))
    : "";
  if (!authenticated) {
    return { address: "", error: "Reconnect your Solana wallet before changing packs." };
  }
  const requested = typeof requestedValue === "string" && requestedValue.trim()
    ? cleanOwnerWalletAddress(requestedValue)
    : authenticated;
  if (!requested) return { address: "", error: "Solana wallet address is invalid." };
  if (requested !== authenticated) {
    return { address: "", error: "Pack wallet does not match the authenticated Solana wallet." };
  }
  return { address: authenticated };
}

function hallPassCardMintMetadataMatches(
  card: RubyHighHallPassCard,
  input: { ownerWalletAddress: string; mintAddress: string; metadataUri: string },
): boolean {
  const metadataUri = input.metadataUri.trim();
  if (!metadataUri) return false;
  if (hallPassNftMetadataUris(card).includes(metadataUri)) return true;
  return (
    typeof card.pendingMintMetadataUri === "string" &&
    card.pendingMintMetadataUri.trim() === metadataUri &&
    typeof card.pendingMintAddress === "string" &&
    card.pendingMintAddress.trim() === input.mintAddress &&
    typeof card.pendingMintOwnerWalletAddress === "string" &&
    card.pendingMintOwnerWalletAddress.trim() === input.ownerWalletAddress
  );
}

function hallPassCardPendingMintMatches(
  card: RubyHighHallPassCard,
  input: { ownerWalletAddress: string; mintAddress: string; metadataUri: string },
): boolean {
  return (
    typeof card.pendingMintMetadataUri === "string" &&
    card.pendingMintMetadataUri.trim() === input.metadataUri.trim() &&
    typeof card.pendingMintAddress === "string" &&
    card.pendingMintAddress.trim() === input.mintAddress &&
    typeof card.pendingMintOwnerWalletAddress === "string" &&
    card.pendingMintOwnerWalletAddress.trim() === input.ownerWalletAddress
  );
}

async function recoverPendingCardMint(
  stateKey: string,
  card: RubyHighHallPassCard,
  ruby: RubyHighService,
): Promise<RubyHighHallPassCard | null> {
  const ownerWalletAddress = card.pendingMintOwnerWalletAddress?.trim() ?? "";
  const mintAddress = card.pendingMintAddress?.trim() ?? "";
  const metadataUri = card.pendingMintMetadataUri?.trim() ?? "";
  const mintSignature = card.pendingMintSignature?.trim() ?? "";
  if (!ownerWalletAddress || !mintAddress || !metadataUri || !mintSignature) return null;
  try {
    const verified = await verifyHallPassCardMint({
      ownerWalletAddress,
      mintAddress,
      mintSignature,
      metadataUri,
    });
    const recorded = ruby.recordHallPassCardMint(stateKey, {
      cardId: card.id,
      ownerWalletAddress: verified.ownerWalletAddress,
      mintAddress: verified.mintAddress,
      mintSignature: verified.signature,
      metadataUri: verified.metadataUri,
    });
    await ruby.flushSession(stateKey);
    await finishHallPassCardReveal(stateKey, recorded.card, ruby);
    await ruby.flushSession(stateKey);
    return recorded.card;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const submittedAt = Math.max(0, Math.floor(Number(card.pendingMintSubmittedAt ?? 0)));
    const stillFresh = submittedAt > 0 && Date.now() - submittedAt < PENDING_MINT_RETRY_AFTER_MS;
    if (/not found|not confirmed|not indexed|try again after confirmation/i.test(message)) {
      if (stillFresh) {
        throw new Error("The previous card mint is still confirming on Solana. Try again shortly.");
      }
      return null;
    }
    throw err;
  }
}

async function finishHallPassCardReveal(
  stateKey: string,
  card: RubyHighHallPassCard,
  ruby: RubyHighService,
): Promise<boolean> {
  try {
    await revealHallPassCardNft(card);
    ruby.recordHallPassCardRevealAttempt(stateKey, card.id, true);
    return true;
  } catch (err) {
    ruby.recordHallPassCardRevealAttempt(stateKey, card.id, false);
    log.error("nft.card-on-chain-reveal-update-failed", err, {
      sessionId: stateKey,
      cardId: card.id,
      mintAddress: card.mintAddress,
    });
    return false;
  }
}

async function repairPendingCardReveals(
  stateKey: string,
  ownerWalletAddress: string,
  ruby: RubyHighService,
): Promise<number> {
  const cards = ruby.pendingHallPassCardReveals(stateKey, ownerWalletAddress).slice(0, 3);
  let repaired = 0;
  for (const card of cards) {
    if (await finishHallPassCardReveal(stateKey, card, ruby)) repaired += 1;
  }
  if (cards.length > 0) await ruby.flushSession(stateKey);
  return repaired;
}

async function openHallPassPackWithLock(
  deps: NftDeps,
  stateKey: string,
  packId: string,
  ownerWalletAddress: string,
): Promise<PackOpenRouteResult> {
  const recordedPack = deps.ruby.hallPassPacks(stateKey)
    .find((candidate) => candidate.id === packId || candidate.assetAddress === packId);
  if (!recordedPack) throw new Error("Pack not found.");
  const key = recordedPack.assetAddress;
  const previous = PACK_OPEN_QUEUE.get(key) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => openHallPassPackTransaction(deps, stateKey, packId, ownerWalletAddress));
  const tail = operation.then(() => undefined, () => undefined);
  PACK_OPEN_QUEUE.set(key, tail);
  try {
    return await operation;
  } finally {
    if (PACK_OPEN_QUEUE.get(key) === tail) PACK_OPEN_QUEUE.delete(key);
  }
}

async function openHallPassPackTransaction(
  deps: NftDeps,
  stateKey: string,
  packId: string,
  ownerWalletAddress: string,
): Promise<PackOpenRouteResult> {
  const state = deps.ruby.getOrCreate(stateKey);
  const recordedPack = deps.ruby.hallPassPacks(stateKey)
    .find((candidate) => candidate.id === packId || candidate.assetAddress === packId);
  if (!recordedPack) throw new Error("Pack not found.");
  const currentOwnership = await fetchCorePackCurrentOwnershipOrNull(recordedPack.assetAddress);
  if (!currentOwnership) {
    throw new Error("Could not verify current on-chain pack ownership. Try syncing your wallet, then try again.");
  }
  if (currentOwnership.ownerWalletAddress !== ownerWalletAddress) {
    throw new Error("Pack is no longer owned by this wallet. Sync your wallet packs before opening.");
  }
  if (currentOwnership.opened == null) {
    throw new Error("Could not verify current on-chain pack ownership and opened state. Try syncing your wallet, then try again.");
  }
  if (currentOwnership.opened && recordedPack.status !== "opened") {
    deps.ruby.recordHallPassPackOnChainOpened(
      stateKey,
      recordedPack.assetAddress,
      currentOwnership.metadataUri,
    );
    await deps.ruby.flushSession(stateKey);
    throw new Error("Pack is already opened on-chain and cannot be redeemed again.");
  }

  const walletSnapshot = structuredClone(state.wallet);
  const updatedAtSnapshot = state.updatedAt;
  let result: ReturnType<RubyHighService["openHallPassPack"]> | null = null;
  let packUpdate: Record<string, unknown> | null = null;
  let updateCompleted = currentOwnership.opened;
  try {
    result = deps.ruby.openHallPassPack(stateKey, {
      packId,
      ownerWalletAddress,
      deferPersist: true,
    });
    const openedPack = result.pack;
    if (!openedPack) throw new Error("Pack open record is incomplete.");
    if (result.applied) {
      // Persist the deterministic open intent before the external write so a
      // process restart can resume the metadata update without issuing cards twice.
      await deps.ruby.flushSession(stateKey);
    }
    if (!currentOwnership.opened) {
      try {
        packUpdate = await updateOpenedCorePackNft(stateKey, openedPack);
        updateCompleted = true;
      } catch (updateError) {
        // A timeout can happen after Solana accepted the update. Re-read the
        // asset before rolling back so an acknowledged on-chain open can never
        // become locally redeemable again.
        const reconciled = await fetchCorePackCurrentOwnershipOrNull(recordedPack.assetAddress);
        if (
          reconciled?.ownerWalletAddress === ownerWalletAddress &&
          reconciled.opened
        ) {
          updateCompleted = true;
          openedPack.metadataUri = reconciled.metadataUri;
          openedPack.updatedAt = Date.now();
          packUpdate = {
            assetAddress: reconciled.assetAddress,
            signature: null,
            metadataUri: reconciled.metadataUri,
            recoveredAfterAmbiguousSubmit: true,
          };
        } else {
          throw updateError;
        }
      }
    } else if (currentOwnership.metadataUri && openedPack.metadataUri !== currentOwnership.metadataUri) {
      openedPack.metadataUri = currentOwnership.metadataUri;
      openedPack.updatedAt = Date.now();
    }
    await deps.ruby.flushSession(stateKey);
    return {
      applied: result.applied,
      pack: openedPack,
      cards: result.cards ?? [],
      transaction: result.transaction,
      packUpdate,
    };
  } catch (err) {
    if (result?.applied && !updateCompleted) {
      state.wallet = walletSnapshot;
      state.updatedAt = updatedAtSnapshot;
      await deps.ruby.flushSession(stateKey).catch((persistErr) => {
        log.error("nft.pack-open-rollback-persist-failed", persistErr, {
          sessionId: stateKey,
          packId,
        });
      });
    }
    throw err;
  }
}

async function updateOpenedCorePackNft(
  sessionId: string,
  pack: RubyHighHallPassPack | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!pack?.assetAddress) return null;
  if (!publicCorePackNftStatus().configured) {
    throw new Error("Pack NFT updates are not configured. Your pack was not opened; try again in a minute.");
  }
  try {
    const updated = await updateCorePackNftToOpened({
      assetAddress: pack.assetAddress,
      productId: pack.productId,
      packCount: pack.packCount,
      cardCount: pack.cardCount,
      serial: pack.serial,
      ...revealProvenanceFromPack(pack),
    });
    pack.metadataUri = updated.metadataUri;
    pack.updatedAt = Date.now();
    return {
      assetAddress: updated.assetAddress,
      signature: updated.signature,
      metadataUri: updated.metadataUri,
    };
  } catch (err) {
    log.error("nft.pack-open-core-update-failed", err, {
      sessionId,
      packId: pack.id,
      assetAddress: pack.assetAddress,
    });
    throw new Error("Pack NFT update failed. Your pack was not opened; try again in a minute.");
  }
}

function publicBaseUrlForRequest(ctx: RouteContext): string | undefined {
  const envBase = process.env.RUBY_HIGH_PUBLIC_BASE?.trim()
    || process.env.RUBY_HIGH_PUBLIC_BASE_URL?.trim();
  if (envBase) return envBase;
  if (!ctx.url) return undefined;
  return `${ctx.url.protocol}//${ctx.url.host}`;
}

function setNftMetadataCacheHeaders(response: unknown): void {
  (response as { setHeader?: (name: string, value: string) => void }).setHeader?.("Cache-Control", "no-cache");
}

function readBurnInput(body: Record<string, unknown>): HallPassCardBurnInput | null {
  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  const ownerWalletAddress = cleanOwnerWalletAddress(typeof body.ownerWalletAddress === "string" ? body.ownerWalletAddress : "");
  const mintAddress = cleanOwnerWalletAddress(typeof body.mintAddress === "string" ? body.mintAddress : "");
  const burnSignature = typeof body.burnSignature === "string" ? body.burnSignature.trim() : "";
  if (!cardId || !ownerWalletAddress || !mintAddress || !burnSignature) return null;
  return { cardId, ownerWalletAddress, mintAddress, burnSignature };
}

function readCardIds(body: Record<string, unknown>): string[] {
  const rawIds = Array.isArray(body.cardIds) ? body.cardIds : [body.cardId];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of rawIds) {
    const id = typeof raw === "string" ? raw.trim().slice(0, 96) : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function revealProvenancePayload(record: {
  packRevealVersion?: string;
  catalogHash?: string;
  commitment?: string;
  entropySource?: string;
  revealSeed?: string;
  revealProof?: string;
  packAssetAddress?: string;
  assetAddress?: string;
  revealSlot?: number;
  randomnessAccount?: string;
  revealTransaction?: string;
} | null | undefined): Record<string, unknown> {
  if (!record) return {};
  return {
    ...(record.packRevealVersion ? { packRevealVersion: record.packRevealVersion } : {}),
    ...(record.catalogHash ? { catalogHash: record.catalogHash } : {}),
    ...(record.commitment ? { commitment: record.commitment } : {}),
    ...(record.entropySource ? { entropySource: record.entropySource } : {}),
    ...(record.revealSeed ? { revealSeed: record.revealSeed } : {}),
    ...(record.revealProof ? { revealProof: record.revealProof } : {}),
    ...(record.packAssetAddress || record.assetAddress ? { packAssetAddress: record.packAssetAddress ?? record.assetAddress } : {}),
    ...(typeof record.revealSlot === "number" ? { revealSlot: record.revealSlot } : {}),
    ...(record.randomnessAccount ? { randomnessAccount: record.randomnessAccount } : {}),
    ...(record.revealTransaction ? { revealTransaction: record.revealTransaction } : {}),
  };
}

function revealProvenanceFromPack(pack: RubyHighHallPassPack | null | undefined): Record<string, string | number> {
  return revealProvenancePayload(pack) as Record<string, string | number>;
}

function revealProvenanceFromCard(card: RubyHighHallPassCard | null | undefined): Record<string, string | number> {
  return revealProvenancePayload(card) as Record<string, string | number>;
}

function hiddenCardPayload(card: RubyHighHallPassCard): Record<string, unknown> {
  return {
    id: card.id,
    serial: card.serial,
    title: "Ruby High Mystery Card",
    characterId: "card-back",
    characterName: "Mystery Card",
    setName: FIRST_BELL_SET_NAME,
    setCode: FIRST_BELL_SET_CODE,
    role: "special",
    rarity: "common",
    blurb: "Mint this Card to reveal it.",
    color: "#8f1d1d",
    status: card.status,
    issuedAt: card.issuedAt,
    updatedAt: card.updatedAt,
    mintAddress: null,
    mintSignature: null,
    metadataUri: null,
    ...(card.grantTransactionId ? { grantTransactionId: card.grantTransactionId } : {}),
    ...(card.packId ? { packId: card.packId } : {}),
    ...(typeof card.slotIndex === "number" ? { slotIndex: card.slotIndex } : {}),
    ...(card.ownerWalletAddress ? { ownerWalletAddress: card.ownerWalletAddress } : {}),
    ...revealProvenancePayload(card),
  };
}

function revealedCardPayload(card: RubyHighHallPassCard): Record<string, unknown> {
  const profile = hallPassCardCatalogEntry(card.characterId);
  return {
    id: card.id,
    serial: card.serial,
    title: card.title,
    characterId: card.characterId,
    canonicalCharacterId: card.canonicalCharacterId ?? null,
    characterName: card.characterName,
    setName: card.setName ?? FIRST_BELL_SET_NAME,
    setCode: card.setCode ?? FIRST_BELL_SET_CODE,
    setNumber: card.setNumber ?? (profile ? hallPassCardSetNumber(profile) : null),
    profileId: card.profileId ?? (profile ? hallPassCardProfileId(profile) : null),
    cardName: card.cardName ?? (profile ? hallPassCardName(profile) : null),
    subject: card.subject ?? (profile ? hallPassCardSubject(profile) : null),
    role: card.role,
    rarity: card.rarity,
    imageUrl: card.imageUrl ?? null,
    sourceImageUrl: card.sourceImageUrl ?? null,
    nftProfileKind: card.nftProfileKind ?? null,
    playbookId: card.playbookId ?? null,
    grade: card.grade ?? null,
    status: card.status,
    artSheet: card.artSheet ?? null,
    artPosition: card.artPosition ?? null,
    mintAddress: card.mintAddress ?? null,
    mintSignature: card.mintSignature ?? null,
    metadataUri: card.metadataUri ?? null,
    ...(card.packId ? { packId: card.packId } : {}),
    ...(typeof card.slotIndex === "number" ? { slotIndex: card.slotIndex } : {}),
    ...(card.ownerWalletAddress ? { ownerWalletAddress: card.ownerWalletAddress } : {}),
    ...revealProvenancePayload(card),
  };
}

function packPayload(pack: RubyHighHallPassPack): Record<string, unknown> {
  return {
    id: pack.id,
    serial: pack.serial,
    productId: pack.productId,
    packCount: pack.packCount,
    cardCount: pack.cardCount,
    status: pack.status,
    ownerWalletAddress: pack.ownerWalletAddress,
    assetAddress: pack.assetAddress,
    metadataUri: pack.metadataUri,
    issuedAt: pack.issuedAt,
    updatedAt: pack.updatedAt,
    ...revealProvenancePayload(pack),
  };
}

function publicPackSyncErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/getProgramAccounts|410|forbidden|rpc/i.test(raw)) {
    return "Solana RPC could not sync wallet packs. Check the configured Ruby High Solana RPC.";
  }
  return raw || "Solana pack sync failed.";
}

function cleanClientBuild(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 32) : "";
}

function nftRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function headerString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ");
  return "";
}

function clipLogValue(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

function previewUri(value: string): string {
  const clean = value.trim();
  if (clean.length <= 96) return clean;
  return `${clean.slice(0, 72)}...${clean.slice(-20)}`;
}

function publicNftErrorMessage(err: unknown): string {
  const raw = solanaErrorMessages(err).join(" ") || (err instanceof Error ? err.message : String(err));
  if (/needs more SOL|insufficient funds|insufficient lamports|Attempt to debit|0x1\b|needs at least|balance is .*needs/i.test(raw)) {
    return "This card mint needs more SOL for Solana rent and fees. Your card was not changed.";
  }
  if (/Solana RPC failed with (?:429|5\d\d)|429|too many requests|rate.?limit/i.test(raw)) {
    return "Solana RPC is temporarily unavailable. Your NFT was not changed; try again in a minute.";
  }
  if (/fetch failed|network|timed out|timeout|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(raw)) {
    return "Solana RPC did not answer. Your NFT was not changed; try again in a minute.";
  }
  if (/blockhash|recent blockhash/i.test(raw)) {
    return "Solana could not provide a recent blockhash. Your NFT was not changed; try again in a minute.";
  }
  if (/403|forbidden/i.test(raw)) {
    return "Solana RPC rejected the request. Check the configured Helius/Solana RPC key.";
  }
  if (/preflight|simulation/i.test(raw)) {
    return "Solana rejected the transaction preview. Your NFT was not changed; try again in a minute.";
  }
  return raw || "Card NFT request failed.";
}
