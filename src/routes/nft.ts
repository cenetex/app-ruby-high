import type { AuthService } from "../services/auth-service.js";
import {
  HALL_PASS_NFT_PREFIX,
  hallPassNftMetadataForRoute,
  hallPassNftStatus,
  mintHallPassCardNft,
  publicHallPassNftStatus,
} from "../services/hall-pass-nfts.js";
import type { RubyHighService } from "../services/ruby-high-service.js";
import type { RouteContext } from "./context.js";

interface NftDeps {
  auth: AuthService;
  ruby: RubyHighService;
}

const MAX_MINTS_PER_REQUEST = 8;
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

  if (ctx.method === "POST" && ctx.pathname === `${HALL_PASS_NFT_PREFIX}/mint-pending`) {
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
      for (const card of pending) {
        const result = await mintHallPassCardNft(card, ownerWalletAddress);
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
      ctx.json(ctx.res, {
        ok: true,
        ownerWalletAddress,
        minted,
        remaining: deps.ruby.mintableHallPassCards(stateKey).length,
        status: publicHallPassNftStatus(),
      });
    } catch (err) {
      ctx.error(ctx.res, err instanceof Error ? err.message : String(err), 502);
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
