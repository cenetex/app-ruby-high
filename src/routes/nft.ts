import type { AuthService } from "../services/auth-service.js";
import {
  HALL_PASS_NFT_PREFIX,
  buildHallPassCardsBurnTransaction,
  hallPassNftMetadataForRoute,
  hallPassNftStatus,
  mintHallPassCardNft,
  publicHallPassNftStatus,
  verifyHallPassCardBurn,
} from "../services/hall-pass-nfts.js";
import type { HallPassCardBurnInput } from "../services/ruby-high-service.js";
import type { RubyHighService } from "../services/ruby-high-service.js";
import type { RouteContext } from "./context.js";

interface NftDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

const MAX_MINTS_PER_REQUEST = 8;
const MAX_BURNS_PER_REQUEST = 8;
const BASE58ISH = /^[1-9A-HJ-NP-Za-km-z]+$/;

export async function handleNftRoutes(ctx: RouteContext, deps: NftDeps): Promise<boolean> {
  if (!ctx.pathname.startsWith(HALL_PASS_NFT_PREFIX)) return false;

  const metadataMatch = ctx.pathname.match(
    /^\/api\/apps\/ruby-high\/nft\/metadata\/hall-pass\/([^/]+)\/([^/]+)\.json$/,
  );
  if (ctx.method === "GET" && metadataMatch) {
    const characterId = decodeURIComponent(metadataMatch[1] ?? "ruby");
    const serial = decodeURIComponent(metadataMatch[2] ?? "1");
    ctx.json(ctx.res, hallPassNftMetadataForRoute({
      characterId,
      serial,
      publicBaseUrl: publicBaseUrlForRequest(ctx),
    }));
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/status`) {
    ctx.json(ctx.res, publicHallPassNftStatus());
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
      const pending = deps.ruby.mintableHallPassCards(stateKey).slice(0, MAX_MINTS_PER_REQUEST);
      const minted = [];
      let mintError: unknown = null;
      for (const card of pending) {
        let result;
        try {
          result = await mintHallPassCardNft(card, ownerWalletAddress);
        } catch (err) {
          mintError = err;
          console.error("[ruby-high] hall-pass-nft.mint-failed", {
            cardId: card.id,
            message: err instanceof Error ? err.message : String(err),
          });
          break;
        }
        const recorded = deps.ruby.recordHallPassCardMint(stateKey, {
          cardId: card.id,
          ownerWalletAddress: result.ownerWalletAddress,
          mintAddress: result.mintAddress,
          mintSignature: result.mintSignature,
          metadataUri: result.metadataUri,
        });
        minted.push({
          cardId: recorded.card.id,
          characterId: recorded.card.characterId,
          characterName: recorded.card.characterName,
          mintAddress: recorded.card.mintAddress,
          mintSignature: recorded.card.mintSignature,
          metadataUri: recorded.card.metadataUri,
        });
      }
      await deps.ruby.flushSession(stateKey);
      if (mintError && minted.length <= 0) {
        ctx.error(ctx.res, publicNftErrorMessage(mintError), 502);
        return true;
      }
      ctx.json(ctx.res, {
        ok: true,
        ownerWalletAddress,
        minted,
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        ...(mintError ? { warning: publicNftErrorMessage(mintError) } : {}),
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
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
      ctx.error(ctx.res, `Burn at most ${MAX_BURNS_PER_REQUEST} cards at once.`, 400);
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

function publicBaseUrlForRequest(ctx: RouteContext): string | undefined {
  const envBase = process.env.RUBY_HIGH_PUBLIC_BASE_URL?.trim();
  if (envBase) return envBase;
  if (!ctx.url) return undefined;
  return `${ctx.url.protocol}//${ctx.url.host}`;
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

function publicNftErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|Attempt to debit|0x1\b/i.test(raw)) {
    return "Card mint authority needs more SOL before cards can be minted.";
  }
  if (/403|forbidden/i.test(raw)) {
    return "Solana RPC rejected the request. Check the configured Helius/Solana RPC key.";
  }
  return raw || "Card NFT request failed.";
}
