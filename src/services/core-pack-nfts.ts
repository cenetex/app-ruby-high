import { createHash } from "node:crypto";
import {
  Key,
  create,
  createCollection,
  fetchAssetV1,
  fetchCollectionV1,
  getAssetV1GpaBuilder,
  mplCore,
  update,
} from "@metaplex-foundation/mpl-core";
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { address as kitAddress } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  PublicKey as Web3PublicKey,
  Transaction as Web3Transaction,
  TransactionInstruction as Web3TransactionInstruction,
} from "@solana/web3.js";
import { isPreflightUnsupportedError } from "./solana-errors.js";
import {
  type HallPassRevealProvenance,
  HALL_PASS_PACK_REVEAL_ALGORITHM,
  revealProvenanceAttributes,
  revealProvenanceProperties,
} from "./hall-pass-reveal-provenance.js";
import {
  FIRST_BELL_SET_CODE,
  FIRST_BELL_SET_FAMILY,
  FIRST_BELL_SET_NAME,
} from "./hall-pass-card-catalog.js";
import { nftImageUri } from "./nft-arweave-assets.js";

export const CORE_PACK_NFT_PREFIX = "/api/apps/ruby-high/nft";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]));
const DEFAULT_PUBLIC_BASE_URL = "https://ruby-high.ai";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SYMBOL = "RUBY";
const CORE_PACK_CARDS_PER_PACK = 5;
const NFT_SELLER_FEE_BASIS_POINTS = 0;
const PACK_COLLECTION_NAME = `${FIRST_BELL_SET_NAME} Packs`;
const PACK_IMAGE_ASSET_PATH = "/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2";
const PACK_OPENED_IMAGE_ASSET_PATH = "/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2";
const PACK_PROMO_IMAGE_ASSET_PATH = "/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1";
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

export interface CorePackNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcUrl: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  reason?: string;
}

export interface PublicCorePackNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcConfigured: boolean;
  rpcHost: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  reason?: string;
}

export interface CorePackNftMintInput {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  paymentSignature: string;
}

export interface CorePackNftMintResult {
  ownerWalletAddress: string;
  assetAddress: string;
  mintSignature: string;
  metadataUri: string;
}

export interface CorePackNftOpenedUpdateInput {
  assetAddress: string;
  productId: string;
  packCount: number;
  cardCount: number;
  serial: number | string;
}

export interface CorePackNftOpenedUpdateResult {
  assetAddress: string;
  signature: string;
  metadataUri: string;
}

export interface CorePackPurchaseTransactionInput {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  paymentReference: string;
  tokenMint: string;
  tokenRecipient: string;
  tokenAmount: string;
  tokenAmountBaseUnits: string;
  tokenDecimals: number;
  tokenSymbol: string;
  sourceTokenAccountAddress?: string;
  latestBlockhash?: { blockhash: string; lastValidBlockHeight: number };
}

export interface CorePackPurchaseTransactionResult {
  ownerWalletAddress: string;
  assetAddress?: string;
  metadataUri?: string;
  sourceTokenAccountAddress: string;
  destinationTokenAccountAddress: string;
  transactionBase64: string;
  transactionEncoding: "base64";
  chain: "solana:mainnet";
  rpcUrl: string;
}

export interface CorePackNftVerifyInput {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  assetAddress: string;
  metadataUri?: string;
  paymentSignature: string;
}

export interface CoreCollectionCreateResult {
  collectionAddress: string;
  signature: string;
  metadataUri: string;
}

export interface OwnedCorePackNft {
  productId: string;
  packCount: number;
  cardCount: number;
  ownerWalletAddress: string;
  assetAddress: string;
  metadataUri: string;
  serial: number;
  name: string;
}

type CorePackNftMinter = (input: CorePackNftMintInput) => Promise<CorePackNftMintResult>;
type CorePackNftOpenedUpdater = (input: CorePackNftOpenedUpdateInput) => Promise<CorePackNftOpenedUpdateResult>;
type CorePackPurchaseTransactionBuilder = (
  input: CorePackPurchaseTransactionInput,
) => Promise<CorePackPurchaseTransactionResult>;
type CorePackNftVerifier = (input: CorePackNftVerifyInput) => Promise<CorePackNftMintResult>;
type CorePackNftOwnerFetcher = (ownerWalletAddress: string) => Promise<OwnedCorePackNft[]>;

let packMinterOverride: CorePackNftMinter | null = null;
let packOpenedUpdaterOverride: CorePackNftOpenedUpdater | null = null;
let packPurchaseTransactionBuilderOverride: CorePackPurchaseTransactionBuilder | null = null;
let packVerifierOverride: CorePackNftVerifier | null = null;
let packOwnerFetcherOverride: CorePackNftOwnerFetcher | null = null;

export function setCorePackNftMinterForTest(minter: CorePackNftMinter | null): () => void {
  const previous = packMinterOverride;
  packMinterOverride = minter;
  return () => {
    packMinterOverride = previous;
  };
}

export function setCorePackNftOpenedUpdaterForTest(updater: CorePackNftOpenedUpdater | null): () => void {
  const previous = packOpenedUpdaterOverride;
  packOpenedUpdaterOverride = updater;
  return () => {
    packOpenedUpdaterOverride = previous;
  };
}

export function setCorePackPurchaseTransactionBuilderForTest(
  builder: CorePackPurchaseTransactionBuilder | null,
): () => void {
  const previous = packPurchaseTransactionBuilderOverride;
  packPurchaseTransactionBuilderOverride = builder;
  return () => {
    packPurchaseTransactionBuilderOverride = previous;
  };
}

export function setCorePackNftVerifierForTest(verifier: CorePackNftVerifier | null): () => void {
  const previous = packVerifierOverride;
  packVerifierOverride = verifier;
  return () => {
    packVerifierOverride = previous;
  };
}

export function setOwnedCorePackNftFetcherForTest(fetcher: CorePackNftOwnerFetcher | null): () => void {
  const previous = packOwnerFetcherOverride;
  packOwnerFetcherOverride = fetcher;
  return () => {
    packOwnerFetcherOverride = previous;
  };
}

export function corePackNftStatus(env: NodeJS.ProcessEnv = process.env): CorePackNftStatus {
  const publicBaseUrl = publicBaseUrlFromEnv(env);
  const rpcUrl = nftRpcUrl(env);
  const symbol = nftSymbol(env);
  const collectionAddress = cleanEnv(env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS);
  const secret = cleanEnv(env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      reason: "RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.",
    };
  }
  if (!collectionAddress) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      reason: "RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS is not set.",
    };
  }
  try {
    const bytes = parseSecretKeyBytes(secret);
    cleanSolanaAddress(collectionAddress, "Core collection address");
    return {
      configured: true,
      publicBaseUrl,
      rpcUrl,
      symbol,
      authorityAddress: addressFromPublicKeyBytes(bytes),
      collectionAddress,
    };
  } catch (err) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      collectionAddress,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function publicCorePackNftStatus(env: NodeJS.ProcessEnv = process.env): PublicCorePackNftStatus {
  const status = corePackNftStatus(env);
  return {
    configured: status.configured,
    publicBaseUrl: status.publicBaseUrl,
    rpcConfigured: !!status.rpcUrl,
    rpcHost: rpcHostForPublicStatus(status.rpcUrl),
    symbol: status.symbol,
    ...(status.authorityAddress ? { authorityAddress: status.authorityAddress } : {}),
    ...(status.collectionAddress ? { collectionAddress: status.collectionAddress } : {}),
    ...(status.reason ? { reason: status.reason } : {}),
  };
}

function nftMetadataCreators(env: NodeJS.ProcessEnv = process.env): Array<{ address: string; share: number; verified: boolean }> {
  const secret = cleanEnv(env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) return [];
  try {
    return [{ address: addressFromPublicKeyBytes(parseSecretKeyBytes(secret)), share: 100, verified: true }];
  } catch {
    return [];
  }
}

function metadataCreatorProperties(env: NodeJS.ProcessEnv = process.env): { creators?: Array<{ address: string; share: number; verified: boolean }> } {
  const creators = nftMetadataCreators(env);
  return creators.length > 0 ? { creators } : {};
}

export function corePackNftMetadataUri(args: {
  productId: string;
  packCount: number;
  cardCount: number;
  paymentSignature: string;
}, env: NodeJS.ProcessEnv = process.env): string {
  const base = publicBaseUrlFromEnv(env);
  const productId = encodeURIComponent(cleanProductId(args.productId));
  const packCount = Math.max(1, Math.floor(Number(args.packCount || 1)));
  const requestedCardCount = Math.max(1, Math.floor(Number(args.cardCount || packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  const serial = encodeURIComponent(packSerial(args.paymentSignature));
  return `${base}${CORE_PACK_NFT_PREFIX}/metadata/core/pack/${productId}/${serial}.json?packs=${encodeURIComponent(String(packCount))}&cards=${encodeURIComponent(String(cardCount))}`;
}

export function corePackOpenedNftMetadataUri(args: {
  productId: string;
  packCount: number;
  cardCount: number;
  serial: number | string;
}, env: NodeJS.ProcessEnv = process.env): string {
  const base = publicBaseUrlFromEnv(env);
  const productId = encodeURIComponent(cleanProductId(args.productId));
  const packCount = Math.max(1, Math.floor(Number(args.packCount || 1)));
  const requestedCardCount = Math.max(1, Math.floor(Number(args.cardCount || packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  const serial = encodeURIComponent(normalizeSerial(String(args.serial || 1)));
  return `${base}${CORE_PACK_NFT_PREFIX}/metadata/core/pack/${productId}/${serial}.json?packs=${encodeURIComponent(String(packCount))}&cards=${encodeURIComponent(String(cardCount))}&opened=1`;
}

export function coreCollectionMetadataUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${publicBaseUrlFromEnv(env)}${CORE_PACK_NFT_PREFIX}/metadata/core/collection.json`;
}

export function corePackAssetPluginsForMint(args: {
  authorityAddress: string;
  productId: string;
  packCount: number;
  cardCount: number;
  serial: string;
}) {
  const packCount = Math.max(1, Math.floor(Number(args.packCount || 1)));
  const requestedCardCount = Math.max(1, Math.floor(Number(args.cardCount || packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  const productId = cleanProductId(args.productId);
  const serial = normalizeSerial(args.serial);
  return [
    {
      type: "VerifiedCreators" as const,
      signatures: [{ address: publicKey(args.authorityAddress), verified: true }],
    },
    {
      type: "Attributes" as const,
      attributeList: [
        { key: "School", value: "Ruby High" },
        { key: "Collection", value: PACK_COLLECTION_NAME },
        { key: "Set", value: "First Bell" },
        { key: "Set Code", value: FIRST_BELL_SET_CODE },
        { key: "NFT Type", value: "Pack" },
        { key: "Product", value: productId },
        { key: "Packs", value: String(packCount) },
        { key: "Cards Inside", value: String(cardCount) },
        { key: "Serial", value: serial },
      ],
    },
  ];
}

export function corePackNftMetadataForRoute(args: {
  productId: string;
  serial: string;
  packCount?: string;
  cardCount?: string;
  publicBaseUrl?: string;
  opened?: boolean;
} & HallPassRevealProvenance): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const website = publicWebsiteUrl(publicBaseUrl);
  const packCount = Math.max(1, Math.floor(Number(args.packCount ?? 1)));
  const requestedCardCount = Math.max(1, Math.floor(Number(args.cardCount ?? packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  const serial = normalizeSerial(args.serial);
  const name = packCount === 1 ? `${FIRST_BELL_SET_NAME} Pack #${serial}` : `${FIRST_BELL_SET_NAME} ${packCount}-Pack #${serial}`;
  const image = nftImageUri(publicBaseUrl, args.opened ? PACK_OPENED_IMAGE_ASSET_PATH : PACK_IMAGE_ASSET_PATH);
  const collection = {
    name: PACK_COLLECTION_NAME,
    family: FIRST_BELL_SET_FAMILY,
  };
  return {
    name,
    symbol: nftSymbol(process.env),
    description: `${packCount} ${FIRST_BELL_SET_NAME} ${packCount === 1 ? "pack" : "packs"} with ${cardCount} cards inside.`,
    image,
    category: "image",
    external_url: website,
    seller_fee_basis_points: NFT_SELLER_FEE_BASIS_POINTS,
    collection,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Collection", value: PACK_COLLECTION_NAME },
      { trait_type: "Set", value: "First Bell" },
      { trait_type: "Set Code", value: FIRST_BELL_SET_CODE },
      { trait_type: "NFT Type", value: "Pack" },
      { trait_type: "Product", value: cleanProductId(args.productId) },
      { trait_type: "Packs", value: packCount },
      { trait_type: "Cards Inside", value: cardCount },
      { trait_type: "State", value: args.opened ? "Opened" : "Sealed" },
      { trait_type: "Serial", value: serial },
      { trait_type: "Website", value: website },
      ...revealProvenanceAttributes(args),
    ],
    properties: {
      category: "image",
      files: [{ uri: image, type: "image/png" }],
      website,
      collection,
      ...metadataCreatorProperties(),
      provenance: {
        algorithm: HALL_PASS_PACK_REVEAL_ALGORITHM,
        ...(revealProvenanceProperties(args) ?? {}),
      },
    },
  };
}

export function corePackCollectionMetadataForRoute(args: {
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const website = publicWebsiteUrl(publicBaseUrl);
  const image = nftImageUri(publicBaseUrl, PACK_PROMO_IMAGE_ASSET_PATH);
  return {
    name: PACK_COLLECTION_NAME,
    symbol: nftSymbol(process.env),
    description: `${FIRST_BELL_SET_NAME} card packs.`,
    image,
    category: "image",
    external_url: website,
    seller_fee_basis_points: NFT_SELLER_FEE_BASIS_POINTS,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Collection", value: PACK_COLLECTION_NAME },
      { trait_type: "Set", value: "First Bell" },
      { trait_type: "Set Code", value: FIRST_BELL_SET_CODE },
      { trait_type: "Type", value: "Pack Collection" },
      { trait_type: "Website", value: website },
    ],
    properties: {
      category: "image",
      files: [{ uri: image, type: "image/png" }],
      website,
      collection: {
        name: PACK_COLLECTION_NAME,
        family: FIRST_BELL_SET_FAMILY,
      },
      ...metadataCreatorProperties(),
    },
  };
}

export async function mintCorePackNft(input: CorePackNftMintInput): Promise<CorePackNftMintResult> {
  if (packMinterOverride) return packMinterOverride(input);
  const config = readCoreMintConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const owner = publicKey(cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet"));
  const collectionAddress = publicKey(config.collectionAddress);
  const collection = await fetchCollectionV1(umi, collectionAddress);
  const asset = generateSigner(umi);
  const metadataUri = corePackNftMetadataUri(input);
  const packCount = Math.max(1, Math.floor(Number(input.packCount || 1)));
  const requestedCardCount = Math.max(1, Math.floor(Number(input.cardCount || packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  const serial = packSerial(input.paymentSignature);
  const builder = create(umi, {
    asset,
    collection,
    authority: umi.identity,
    payer: umi.payer,
    owner,
    name: packCount === 1 ? `${FIRST_BELL_SET_NAME} Pack #${serial}` : `${FIRST_BELL_SET_NAME} ${packCount}-Pack #${serial}`,
    uri: metadataUri,
    plugins: corePackAssetPluginsForMint({
      authorityAddress: String(umi.identity.publicKey),
      productId: input.productId,
      packCount,
      cardCount,
      serial,
    }),
  });
  const sent = await sendAndConfirmCoreTransaction(umi, builder);
  return {
    ownerWalletAddress: owner,
    assetAddress: asset.publicKey,
    mintSignature: base58Encode(sent.signature),
    metadataUri,
  };
}

export async function updateCorePackNftToOpened(
  input: CorePackNftOpenedUpdateInput,
): Promise<CorePackNftOpenedUpdateResult> {
  if (packOpenedUpdaterOverride) return packOpenedUpdaterOverride(input);
  const config = readCoreMintConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const assetAddress = cleanSolanaAddress(input.assetAddress, "Pack asset address");
  const collectionAddress = publicKey(config.collectionAddress);
  const [asset, collection] = await Promise.all([
    fetchAssetV1(umi, publicKey(assetAddress), { commitment: "confirmed" }),
    fetchCollectionV1(umi, collectionAddress),
  ]);
  const metadataUri = corePackOpenedNftMetadataUri(input);
  const sent = await sendAndConfirmCoreTransaction(umi, update(umi, {
    asset,
    collection,
    authority: umi.identity,
    payer: umi.payer,
    uri: metadataUri,
  }));
  return {
    assetAddress,
    signature: base58Encode(sent.signature),
    metadataUri,
  };
}

export async function buildCorePackPurchaseTransaction(
  input: CorePackPurchaseTransactionInput,
): Promise<CorePackPurchaseTransactionResult> {
  if (packPurchaseTransactionBuilderOverride) return packPurchaseTransactionBuilderOverride(input);
  const config = readCoreMintConfig();
  const ownerWalletAddress = cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet");
  const tokenMint = cleanSolanaAddress(input.tokenMint, "Solana token mint");
  const tokenRecipient = cleanSolanaAddress(input.tokenRecipient, "Solana token recipient");
  const paymentReference = cleanSolanaAddress(input.paymentReference, "Solana payment reference");
  const tokenDecimals = readTokenDecimals(input.tokenDecimals);
  const tokenAmountBaseUnits = readBaseUnits(input.tokenAmountBaseUnits);
  const source = input.sourceTokenAccountAddress && isBase58ishAddress(input.sourceTokenAccountAddress)
    ? { tokenAccountAddress: input.sourceTokenAccountAddress.trim(), balanceBaseUnits: tokenAmountBaseUnits }
    : await findOwnerTokenAccountForPayment({
      rpcUrl: config.rpcUrl,
      ownerWalletAddress,
      tokenMint,
      requiredBaseUnits: tokenAmountBaseUnits,
      tokenAmount: input.tokenAmount,
      tokenSymbol: input.tokenSymbol,
    });
  const [destinationTokenAccountAddress] = await findAssociatedTokenPda({
    owner: kitAddress(tokenRecipient),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: kitAddress(tokenMint),
  });
  const latestBlockhash = input.latestBlockhash ?? await fetchLatestBlockhash(config.rpcUrl);
  const transaction = new Web3Transaction({
    feePayer: new Web3PublicKey(ownerWalletAddress),
    recentBlockhash: latestBlockhash.blockhash,
  });
  transaction.add(web3CreateAssociatedTokenAccountIdempotentInstruction({
    payer: ownerWalletAddress,
    ata: destinationTokenAccountAddress,
    owner: tokenRecipient,
    mint: tokenMint,
  }));
  transaction.add(web3TransferCheckedInstruction({
    source: source.tokenAccountAddress,
    mint: tokenMint,
    destination: destinationTokenAccountAddress,
    authority: ownerWalletAddress,
    amount: tokenAmountBaseUnits,
    decimals: tokenDecimals,
    reference: paymentReference,
  }));
  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  if (!input.latestBlockhash) {
    await simulateSolanaTransactionForSigning(config.rpcUrl, transactionBase64, "Pack payment");
  }
  return {
    ownerWalletAddress,
    sourceTokenAccountAddress: source.tokenAccountAddress,
    destinationTokenAccountAddress,
    transactionBase64,
    transactionEncoding: "base64",
    chain: "solana:mainnet",
    rpcUrl: config.rpcUrl,
  };
}

export async function verifyCorePackNftMint(input: CorePackNftVerifyInput): Promise<CorePackNftMintResult> {
  if (packVerifierOverride) return packVerifierOverride(input);
  const config = readCoreMintConfig();
  const ownerWalletAddress = cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet");
  const assetAddress = cleanSolanaAddress(input.assetAddress, "Pack asset address");
  const expectedUri = input.metadataUri?.trim() || corePackNftMetadataUri({
    productId: input.productId,
    packCount: input.packCount,
    cardCount: input.cardCount,
    paymentSignature: assetAddress,
  });
  const umi = createUmi(config.rpcUrl).use(mplCore());
  let asset;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(3000, 800 + attempt * 450));
    try {
      asset = await fetchAssetV1(umi, publicKey(assetAddress), { commitment: "confirmed" });
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!asset) {
    const detail = lastError instanceof Error ? lastError.message : "";
    throw new Error(detail ? `Pack NFT was not found on-chain yet. Try again after confirmation. ${detail}` : "Pack NFT was not found on-chain yet. Try again after confirmation.");
  }
  if (String(asset.owner) !== ownerWalletAddress) {
    throw new Error("Pack NFT owner does not match the connected wallet.");
  }
  if (String(asset.uri) !== expectedUri) {
    throw new Error("Pack NFT metadata does not match this checkout.");
  }
  const updateAuthority = asset.updateAuthority as { __kind?: string; fields?: unknown[]; type?: string; address?: unknown };
  const collectionAddress = updateAuthority.type === "Collection" && updateAuthority.address
    ? String(updateAuthority.address)
    : updateAuthority.__kind === "Collection" && Array.isArray(updateAuthority.fields)
      ? String(updateAuthority.fields[0] ?? "")
      : "";
  if (collectionAddress !== config.collectionAddress) {
    throw new Error("Pack NFT is not in the Ruby High collection.");
  }
  return {
    ownerWalletAddress,
    assetAddress,
    mintSignature: input.paymentSignature,
    metadataUri: expectedUri,
  };
}

export async function fetchOwnedCorePackNfts(ownerWalletAddress: string): Promise<OwnedCorePackNft[]> {
  if (packOwnerFetcherOverride) return packOwnerFetcherOverride(ownerWalletAddress);
  const config = readCoreSyncConfig();
  const owner = publicKey(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const das = await tryFetchOwnedCorePackNftsViaDas(config.rpcUrl, config.collectionAddress, String(owner));
  if (das.ok && das.items.length > 0) return das.items;
  try {
    const assets = await fetchOwnedCorePackNftsViaGpa(config.rpcUrl, config.collectionAddress, owner);
    if (assets.length > 0) return assets;
    return das.ok ? das.items : assets;
  } catch (err) {
    if (das.ok) return das.items;
    throw err;
  }
}

async function fetchOwnedCorePackNftsViaGpa(
  rpcUrl: string,
  collectionAddress: string,
  owner: ReturnType<typeof publicKey>,
): Promise<OwnedCorePackNft[]> {
  const umi = createUmi(rpcUrl).use(mplCore());
  const assets = await getAssetV1GpaBuilder(umi)
    .whereField("key", Key.AssetV1)
    .whereField("owner", owner)
    .getDeserialized({ commitment: "confirmed" });
  return assets.flatMap((asset) => {
    const assetCollectionAddress = coreAssetCollectionAddress(asset.updateAuthority);
    if (assetCollectionAddress !== collectionAddress) return [];
    const metadataUri = typeof asset.uri === "string" ? asset.uri.trim() : "";
    if (!metadataUri) return [];
    const parsed = corePackInfoFromMetadataUri(metadataUri, asset.name);
    if (!parsed) return [];
    return [{
      ...parsed,
      ownerWalletAddress: String(owner),
      assetAddress: String(asset.publicKey),
      metadataUri,
      name: typeof asset.name === "string" && asset.name.trim() ? asset.name.trim() : `${FIRST_BELL_SET_NAME} Pack`,
    }];
  });
}

async function tryFetchOwnedCorePackNftsViaDas(
  rpcUrl: string,
  collectionAddress: string,
  ownerWalletAddress: string,
): Promise<{ ok: true; items: OwnedCorePackNft[] } | { ok: false; error: unknown }> {
  try {
    return {
      ok: true,
      items: await fetchOwnedCorePackNftsViaDas(rpcUrl, collectionAddress, ownerWalletAddress),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function fetchOwnedCorePackNftsViaDas(
  rpcUrl: string,
  collectionAddress: string,
  ownerWalletAddress: string,
): Promise<OwnedCorePackNft[]> {
  const items: OwnedCorePackNft[] = [];
  const limit = 1000;
  let page = 1;
  while (true) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ruby-high-pack-sync",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: ownerWalletAddress,
          page,
          limit,
          options: {
            showUnverifiedCollections: true,
            showCollectionMetadata: true,
          },
        },
      }),
    });
    const json = await response.json().catch(() => ({})) as {
      error?: { message?: string; code?: number };
      result?: { items?: unknown[] };
    };
    if (!response.ok) {
      throw new Error(`getAssetsByOwner failed with ${response.status}`);
    }
    if (json?.error) {
      throw new Error(json.error.message || `getAssetsByOwner failed with ${json.error.code ?? "unknown error"}`);
    }
    const pageItems = Array.isArray(json?.result?.items) ? json.result.items : [];
    for (const raw of pageItems) {
      const item = raw as {
        id?: unknown;
        burnt?: boolean;
        content?: { json_uri?: unknown; metadata?: { name?: unknown } };
        ownership?: { owner?: unknown };
        grouping?: Array<{ group_key?: unknown; group_value?: unknown }>;
      };
      if (item?.burnt) continue;
      const grouped = Array.isArray(item?.grouping) ? item.grouping : [];
      const inCollection = grouped.some((group) => (
        String(group?.group_key || "") === "collection"
        && String(group?.group_value || "") === collectionAddress
      ));
      if (!inCollection) continue;
      const metadataUri = typeof item?.content?.json_uri === "string" ? item.content.json_uri.trim() : "";
      if (!metadataUri) continue;
      const parsed = corePackInfoFromMetadataUri(
        metadataUri,
        typeof item?.content?.metadata?.name === "string" ? item.content.metadata.name : undefined,
      );
      if (!parsed) continue;
      const assetAddress = typeof item?.id === "string" ? item.id.trim() : "";
      if (!assetAddress) continue;
      items.push({
        ...parsed,
        ownerWalletAddress: typeof item?.ownership?.owner === "string" && item.ownership.owner.trim()
          ? item.ownership.owner.trim()
          : ownerWalletAddress,
        assetAddress,
        metadataUri,
        name: typeof item?.content?.metadata?.name === "string" && item.content.metadata.name.trim()
          ? item.content.metadata.name.trim()
          : `${FIRST_BELL_SET_NAME} Pack`,
      });
    }
    if (pageItems.length < limit) break;
    page += 1;
  }
  return dedupeOwnedCorePackNfts(items);
}

function dedupeOwnedCorePackNfts(items: OwnedCorePackNft[]): OwnedCorePackNft[] {
  const byAsset = new Map<string, OwnedCorePackNft>();
  for (const item of items) {
    if (!item.assetAddress) continue;
    byAsset.set(item.assetAddress, item);
  }
  return Array.from(byAsset.values()).sort((a, b) => a.serial - b.serial || a.assetAddress.localeCompare(b.assetAddress));
}

export async function createCorePackCollection(): Promise<CoreCollectionCreateResult> {
  const config = readCollectionCreateConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const collection = generateSigner(umi);
  const metadataUri = coreCollectionMetadataUri();
  const sent = await sendAndConfirmCoreTransaction(umi, createCollection(umi, {
    collection,
    updateAuthority: umi.identity.publicKey,
    payer: umi.payer,
    name: PACK_COLLECTION_NAME,
    uri: metadataUri,
    plugins: [
      { type: "ImmutableMetadata" },
      {
        type: "VerifiedCreators",
        signatures: [{ address: umi.identity.publicKey, verified: true }],
      },
    ],
  }));
  return {
    collectionAddress: collection.publicKey,
    signature: base58Encode(sent.signature),
    metadataUri,
  };
}

function readCoreMintConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
  collectionAddress: string;
} {
  const status = corePackNftStatus();
  if (!status.configured || !status.collectionAddress) {
    throw new Error(status.reason || "Pack NFT minting is not configured.");
  }
  return {
    authoritySecret: parseSecretKeyBytes(cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY)),
    rpcUrl: status.rpcUrl,
    symbol: status.symbol,
    collectionAddress: status.collectionAddress,
  };
}

function readCoreSyncConfig(): {
  rpcUrl: string;
  collectionAddress: string;
} {
  const collectionAddress = cleanEnv(process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS);
  if (!collectionAddress) throw new Error("RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS is not set.");
  return {
    rpcUrl: nftRpcUrl(process.env),
    collectionAddress: cleanSolanaAddress(collectionAddress, "Core collection address"),
  };
}

function coreAssetCollectionAddress(updateAuthority: unknown): string {
  const value = updateAuthority as { __kind?: string; fields?: unknown[]; type?: string; address?: unknown };
  if (value?.type === "Collection" && value.address) return String(value.address);
  if (value?.__kind === "Collection" && Array.isArray(value.fields)) return String(value.fields[0] ?? "");
  return "";
}

function corePackInfoFromMetadataUri(metadataUri: string, name?: string): {
  productId: string;
  packCount: number;
  cardCount: number;
  serial: number;
} | null {
  let url: URL;
  try {
    url = new URL(metadataUri);
  } catch (_err) {
    return null;
  }
  const match = url.pathname.match(/\/metadata\/core\/pack\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return null;
  const productId = cleanProductId(decodeURIComponent(match[1] ?? "card-pack-1"));
  const serial = Math.max(1, Math.floor(Number(decodeURIComponent(match[2] ?? "1"))));
  const productPackMatch = productId.match(/^card-pack-(\d+)$/);
  const namedPackMatch = typeof name === "string" ? name.match(/Ruby High\s+(\d+)-Pack/i) : null;
  const inferredPackCount = productPackMatch ? Number(productPackMatch[1]) : namedPackMatch ? Number(namedPackMatch[1]) : 1;
  const packCount = Math.max(1, Math.floor(Number(url.searchParams.get("packs") ?? inferredPackCount)));
  const requestedCardCount = Math.max(1, Math.floor(Number(url.searchParams.get("cards") ?? packCount * CORE_PACK_CARDS_PER_PACK)));
  const cardCount = Math.max(requestedCardCount, packCount * CORE_PACK_CARDS_PER_PACK);
  return {
    productId,
    packCount,
    cardCount,
    serial: Number.isFinite(serial) ? serial : 1,
  };
}

async function sendAndConfirmCoreTransaction(umi: Umi, builder: TransactionBuilder): ReturnType<TransactionBuilder["sendAndConfirm"]> {
  try {
    return await builder.sendAndConfirm(umi, {
      send: { skipPreflight: false, maxRetries: 3 },
      confirm: { commitment: "confirmed" },
    });
  } catch (err) {
    if (!isPreflightUnsupportedError(err)) throw err;
    return builder.sendAndConfirm(umi, {
      send: { skipPreflight: true, maxRetries: 3 },
      confirm: { commitment: "confirmed" },
    });
  }
}

async function fetchLatestBlockhash(rpcUrl: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-pack-payment-blockhash",
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { value?: { blockhash?: string; lastValidBlockHeight?: number } };
  };
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  const blockhash = payload.result?.value?.blockhash;
  const lastValidBlockHeight = Number(payload.result?.value?.lastValidBlockHeight);
  if (!blockhash || !Number.isFinite(lastValidBlockHeight)) {
    throw new Error("Solana RPC did not return a recent blockhash.");
  }
  return { blockhash, lastValidBlockHeight: Math.floor(lastValidBlockHeight) };
}

async function simulateSolanaTransactionForSigning(
  rpcUrl: string,
  transactionBase64: string,
  label: string,
): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-pack-payment-simulate",
      method: "simulateTransaction",
      params: [
        transactionBase64,
        {
          encoding: "base64",
          sigVerify: false,
          commitment: "confirmed",
        },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { err?: unknown; logs?: string[] };
  };
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  if (payload.result?.err != null) {
    const logs = Array.isArray(payload.result.logs) ? ` ${payload.result.logs.slice(-3).join(" ")}` : "";
    throw new Error(`${label} failed Solana preflight simulation.${logs}`.trim());
  }
}

function web3CreateAssociatedTokenAccountIdempotentInstruction(input: {
  payer: string;
  ata: string;
  owner: string;
  mint: string;
}): Web3TransactionInstruction {
  return new Web3TransactionInstruction({
    programId: new Web3PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
    keys: [
      { pubkey: new Web3PublicKey(input.payer), isSigner: true, isWritable: true },
      { pubkey: new Web3PublicKey(input.ata), isSigner: false, isWritable: true },
      { pubkey: new Web3PublicKey(input.owner), isSigner: false, isWritable: false },
      { pubkey: new Web3PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: new Web3PublicKey(SYSTEM_PROGRAM_ADDRESS), isSigner: false, isWritable: false },
      { pubkey: new Web3PublicKey(String(TOKEN_PROGRAM_ADDRESS)), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function web3TransferCheckedInstruction(input: {
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: bigint;
  decimals: number;
  reference: string;
}): Web3TransactionInstruction {
  return new Web3TransactionInstruction({
    programId: new Web3PublicKey(String(TOKEN_PROGRAM_ADDRESS)),
    keys: [
      { pubkey: new Web3PublicKey(input.source), isSigner: false, isWritable: true },
      { pubkey: new Web3PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: new Web3PublicKey(input.destination), isSigner: false, isWritable: true },
      { pubkey: new Web3PublicKey(input.authority), isSigner: true, isWritable: false },
      { pubkey: new Web3PublicKey(input.reference), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(transferCheckedData(input.amount, input.decimals)),
  });
}

function transferCheckedData(amount: bigint, decimals: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = 12;
  const view = new DataView(data.buffer);
  view.setBigUint64(1, amount, true);
  data[9] = decimals;
  return data;
}

async function findOwnerTokenAccountForPayment(input: {
  rpcUrl: string;
  ownerWalletAddress: string;
  tokenMint: string;
  requiredBaseUnits: bigint;
  tokenAmount: string;
  tokenSymbol: string;
}): Promise<{ tokenAccountAddress: string; balanceBaseUnits: bigint }> {
  const response = await fetch(input.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-pack-payment-accounts",
      method: "getTokenAccountsByOwner",
      params: [
        input.ownerWalletAddress,
        { mint: input.tokenMint },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: { value?: Array<{ pubkey?: string; account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> };
  };
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  let best: { tokenAccountAddress: string; balanceBaseUnits: bigint } | null = null;
  for (const account of payload.result?.value ?? []) {
    const tokenAccountAddress = typeof account.pubkey === "string" ? account.pubkey.trim() : "";
    const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (!tokenAccountAddress || typeof amount !== "string" || !/^\d+$/.test(amount)) continue;
    const balanceBaseUnits = BigInt(amount);
    if (balanceBaseUnits < input.requiredBaseUnits) continue;
    if (!best || balanceBaseUnits > best.balanceBaseUnits) {
      best = { tokenAccountAddress, balanceBaseUnits };
    }
  }
  if (!best) {
    const amount = input.tokenAmount.trim() || input.requiredBaseUnits.toString();
    throw new Error(`Need ${amount} ${input.tokenSymbol || DEFAULT_SYMBOL} in this Solana wallet before minting a pack.`);
  }
  return best;
}

function readBaseUnits(value: string): bigint {
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) throw new Error("Solana payment amount is missing.");
  const amount = BigInt(raw);
  if (amount <= 0n) throw new Error("Solana payment amount must be positive.");
  return amount;
}

function readTokenDecimals(value: number): number {
  const decimals = Math.floor(Number(value));
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Solana token decimals are invalid.");
  }
  return decimals;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCollectionCreateConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
} {
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) throw new Error("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.");
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl: nftRpcUrl(process.env),
    symbol: nftSymbol(process.env),
  };
}

function cleanProductId(value: string): string {
  return (typeof value === "string" && value.trim() ? value.trim() : "card-pack-1")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .slice(0, 96);
}

function packSerial(paymentSignature: string): string {
  const digest = createHash("sha256").update(paymentSignature || String(Date.now())).digest("hex");
  return String((Number.parseInt(digest.slice(0, 10), 16) % 900000) + 100000);
}

function normalizeSerial(serial: string): string {
  const parsed = Math.max(1, Math.floor(Number(serial)));
  return Number.isFinite(parsed) ? String(parsed) : "1";
}

function publicBaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_PUBLIC_BASE_URL) || DEFAULT_PUBLIC_BASE_URL);
}

function publicWebsiteUrl(publicBaseUrl: string): string {
  return `${cleanBaseUrl(publicBaseUrl)}/`;
}

function nftRpcUrl(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_SOLANA_NFT_RPC_URL)
    || cleanEnv(env.RUBY_HIGH_SOLANA_RPC_URL)
    || (cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID)
      ? `https://solana-mainnet.rpc.privy.systems?privyAppId=${encodeURIComponent(cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID))}`
      : DEFAULT_SOLANA_RPC_URL);
}

function nftSymbol(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.RUBY_HIGH_SOLANA_NFT_SYMBOL) || DEFAULT_SYMBOL;
}

function rpcHostForPublicStatus(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || "configured";
  } catch {
    return value ? "configured" : "";
  }
}

function cleanBaseUrl(value: string): string {
  const raw = value.trim() || DEFAULT_PUBLIC_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function cleanEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSolanaAddress(value: string, label: string): string {
  const clean = value.trim();
  if (!isBase58ishAddress(clean)) {
    throw new Error(`${label} is invalid.`);
  }
  return clean;
}

function isBase58ishAddress(value: string): boolean {
  const clean = value.trim();
  return clean.length >= 32 && clean.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(clean);
}

function parseSecretKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.");
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error("NFT authority secret JSON must be an array.");
    bytes = Uint8Array.from(parsed.map((n) => {
      const value = Math.floor(Number(n));
      if (!Number.isFinite(value) || value < 0 || value > 255) {
        throw new Error("NFT authority secret JSON contains an invalid byte.");
      }
      return value;
    }));
  } else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    bytes = base58Decode(trimmed);
  } else {
    bytes = Uint8Array.from(Buffer.from(trimmed, "base64"));
  }
  if (bytes.length !== 64) {
    throw new Error("NFT authority secret key must be 64 bytes.");
  }
  return bytes;
}

function base58Decode(value: string): Uint8Array {
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit == null) throw new Error("Invalid base58 secret key.");
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function addressFromPublicKeyBytes(secretBytes: Uint8Array): string {
  const publicKeyBytes = secretBytes.slice(32);
  return base58Encode(publicKeyBytes);
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out || "1";
}

export function deterministicCorePackMintForTest(input: CorePackNftMintInput): CorePackNftMintResult {
  const digest = createHash("sha256").update(`${input.productId}:${input.paymentSignature}:${input.ownerWalletAddress}`).digest("hex");
  return {
    ownerWalletAddress: input.ownerWalletAddress,
    assetAddress: base58Encode(Buffer.from(digest.slice(0, 64), "hex") as unknown as Uint8Array).padEnd(32, "1").slice(0, 32),
    mintSignature: base58Encode(Buffer.from(digest + digest, "hex") as unknown as Uint8Array).padEnd(64, "1").slice(0, 64),
    metadataUri: corePackNftMetadataUri(input),
  };
}
