import type { AuthService } from "../services/auth-service.js";
import {
  corePackCollectionMetadataForRoute,
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
  hallPassNftMetadataForRoute,
  hallPassNftStatus,
  publicHallPassNftStatus,
  submitSignedHallPassCardMintTransaction,
  verifyHallPassCardMint,
  verifyHallPassCardBurn,
} from "../services/hall-pass-nfts.js";
import type { HallPassCardBurnInput } from "../services/ruby-high-service.js";
import type { RubyHighService } from "../services/ruby-high-service.js";
import { log } from "../services/logger.js";
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
import type { RubyHighHallPassCard, RubyHighHallPassPack } from "../types.js";
import type { RouteContext } from "./context.js";

interface NftDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

const MAX_MINTS_PER_REQUEST = 8;
const MAX_BURNS_PER_REQUEST = 1;
const BASE58ISH = /^[1-9A-HJ-NP-Za-km-z]+$/;

export async function handleNftRoutes(ctx: RouteContext, deps: NftDeps): Promise<boolean> {
  if (!ctx.pathname.startsWith(HALL_PASS_NFT_PREFIX)) return false;

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
    const productId = decodeURIComponent(corePackMetadataMatch[1] ?? "card-pack-1");
    const serial = decodeURIComponent(corePackMetadataMatch[2] ?? "1");
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
    const cardId = decodeURIComponent(cardMetadataMatch[1] ?? "");
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
    const characterId = decodeURIComponent(metadataMatch[1] ?? "ruby");
    const serial = decodeURIComponent(metadataMatch[2] ?? "1");
    const knownCard = deps.ruby.findHallPassCardByMetadata(characterId, Math.max(1, Math.floor(Number(serial || 1))));
    const metadata = hallPassNftMetadataForRoute({
      characterId,
      serial,
      publicBaseUrl: publicBaseUrlForRequest(ctx),
      ...revealProvenanceFromCard(knownCard),
    });
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

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/sync-packs`) {
    const token = deps.auth.parseSessionToken(ctx.cookieHeader);
    const record = deps.auth.resolve(token);
    if (!token || !record) {
      ctx.error(ctx.res, "Not authenticated.", 401);
      return true;
    }
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before syncing packs.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    try {
      const ownedPacks = await fetchOwnedCorePackNfts(ownerWalletAddress);
      const existingAssets = new Set(deps.ruby.hallPassPacks(stateKey).map((pack) => pack.assetAddress));
      const imported: RubyHighHallPassPack[] = [];
      const known: OwnedCorePackNft[] = [];
      for (const owned of ownedPacks) {
        if (existingAssets.has(owned.assetAddress)) {
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
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        ownerWalletAddress,
        imported: imported.map(packPayload),
        known: known.map((pack) => ({
          productId: pack.productId,
          packCount: pack.packCount,
          cardCount: pack.cardCount,
          assetAddress: pack.assetAddress,
          metadataUri: pack.metadataUri,
          serial: pack.serial,
        })),
        onChainCount: ownedPacks.length,
        importedCount: imported.length,
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
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
    if (!packId) {
      ctx.error(ctx.res, "Pack id is required.", 400);
      return true;
    }
    const status = hallPassNftStatus();
    if (!status.configured) {
      ctx.error(ctx.res, status.reason || "Card minting is not configured.", 503);
      return true;
    }
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before opening a pack.", 400);
      return true;
    }
    const stateKey = deps.auth.stateKeyForRecord(record);
    try {
      const result = deps.ruby.openHallPassPack(stateKey, {
        packId,
        ownerWalletAddress,
      });
      const packUpdate = await updateOpenedCorePackNft(stateKey, result.pack);
      await deps.ruby.flushSession(stateKey);
      ctx.json(ctx.res, {
        ok: true,
        applied: result.applied,
        ownerWalletAddress,
        pack: result.pack ? packPayload(result.pack) : null,
        packNftUpdate: packUpdate,
        cards: (result.cards ?? []).map(hiddenCardPayload),
        minted: [],
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
        cardCount: result.cards?.length ?? Number(result.transaction.metadata?.cardCount ?? 0),
      });
    } catch (err) {
      log.error("nft.pack-open-failed", err, {
        sessionId: stateKey,
        packId,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
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
    const ownerWalletAddress = cleanOwnerWalletAddress(
      typeof body.ownerWalletAddress === "string" && body.ownerWalletAddress.trim()
        ? body.ownerWalletAddress
        : record.walletChainType === "solana"
          ? deps.auth.walletAddressForRecord(record)
          : "",
    );
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
        card: revealedCardPayload(preparedCard),
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
          rpcUrl: mint.rpcUrl,
          serverMinted: false,
        },
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      log.error("nft.card-mint-prepare-failed", err, {
        sessionId: stateKey,
        cardId,
        ownerWalletAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 502);
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
      const mintSignature = await submitSignedHallPassCardMintTransaction(signedTransactionBase64, [
        ownerWalletAddress,
        mintAddress,
      ], {
        card,
        ownerWalletAddress,
        mintAddress,
        transactionMessageHash,
      });
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
        sessionId: stateKey,
        cardId,
        ownerWalletAddress,
        mintAddress,
      });
      ctx.error(ctx.res, publicNftErrorMessage(err), 400);
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
        card: revealedCardPayload(preparedCard),
        mint: {
          cardId: card.id,
          ownerWalletAddress: mint.ownerWalletAddress,
          mintAddress: mint.mintAddress,
          metadataUri: mint.metadataUri,
          transactionBase64: mint.transactionBase64,
          transactionMessageHash: mint.transactionMessageHash,
          transactionEncoding: mint.transactionEncoding,
          chain: mint.chain,
          rpcUrl: mint.rpcUrl,
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
        burn,
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
      ctx.error(ctx.res, "No active minted card matches this burn.", 404);
      return true;
    }
    try {
      const verified = await verifyHallPassCardBurn(burn);
      ctx.json(ctx.res, {
        ok: true,
        burn: {
          ...burn,
          slot: verified.slot ?? null,
          blockTime: verified.blockTime ?? null,
        },
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

async function updateOpenedCorePackNft(
  sessionId: string,
  pack: RubyHighHallPassPack | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!pack?.assetAddress) return null;
  if (!publicCorePackNftStatus().configured) return null;
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
    return null;
  }
}

function publicBaseUrlForRequest(ctx: RouteContext): string | undefined {
  const envBase = process.env.RUBY_HIGH_PUBLIC_BASE_URL?.trim();
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
    characterName: card.characterName,
    setName: card.setName ?? FIRST_BELL_SET_NAME,
    setCode: card.setCode ?? FIRST_BELL_SET_CODE,
    setNumber: card.setNumber ?? (profile ? hallPassCardSetNumber(profile) : null),
    profileId: card.profileId ?? (profile ? hallPassCardProfileId(profile) : null),
    cardName: card.cardName ?? (profile ? hallPassCardName(profile) : null),
    subject: card.subject ?? (profile ? hallPassCardSubject(profile) : null),
    role: card.role,
    rarity: card.rarity,
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
    return "Solana RPC could not sync wallet pack NFTs. Check the configured Ruby High Solana RPC.";
  }
  return raw || "Pack NFT sync failed.";
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
