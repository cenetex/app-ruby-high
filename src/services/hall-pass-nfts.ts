import { createHash } from "node:crypto";
import {
  PublicKey as Web3PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createSolanaRpc,
} from "@solana/kit";
import {
  burn as coreBurn,
  collectionAddress as coreAssetCollectionAddress,
  create as coreCreate,
  createCollection as coreCreateCollection,
  fetchAssetV1,
  fetchCollectionV1,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  createNoopSigner as createUmiNoopSigner,
  createSignerFromKeypair,
  generateSigner as generateUmiSigner,
  keypairIdentity,
  publicKey,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { toWeb3JsInstruction, toWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import type { RubyHighHallPassCard } from "../types.js";
import {
  FIRST_BELL_SET_CODE,
  FIRST_BELL_SET_FAMILY,
  FIRST_BELL_SET_LIVE_PROFILE_COUNT,
  FIRST_BELL_SET_NAME,
  FIRST_BELL_SET_TOTAL_PROFILES,
  hallPassCardCatalogEntry,
  hallPassCardAspectClass,
  hallPassCardImageDimensions,
  hallPassCardImagePath,
  hallPassCardMetadataDescription,
  hallPassCardMediaType,
  hallPassCardName,
  hallPassCardProfileId,
  hallPassCardRarityLabel,
  hallPassCardRoleLabel,
  hallPassCardSetNumber,
  hallPassCardSourceArtVersion,
  hallPassCardSubject,
} from "./hall-pass-card-catalog.js";
import { isPreflightUnsupportedError } from "./solana-errors.js";
import { log } from "./logger.js";
import {
  type HallPassRevealProvenance,
  HALL_PASS_PACK_REVEAL_ALGORITHM,
  revealProvenanceProperties,
} from "./hall-pass-reveal-provenance.js";
import { nftImageUri } from "./nft-arweave-assets.js";
import { durableNftMetadataUri, publicNftMetadataStorageStatus } from "./nft-metadata-storage.js";

type LatestBlockhash = { blockhash: string; lastValidBlockHeight?: number | bigint };

export const HALL_PASS_NFT_PREFIX = "/api/apps/ruby-high/nft";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]));
const CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const DEFAULT_PUBLIC_BASE_URL = "https://ruby-high.ai";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SYMBOL = "RUBY";
const CARD_IMAGE_VERSION = "card-v2";
const NFT_SELLER_FEE_BASIS_POINTS = 0;
const CARD_COLLECTION_NAME = FIRST_BELL_SET_NAME;
const CARD_COLLECTION_FAMILY = FIRST_BELL_SET_FAMILY;
const CARD_COLLECTION_SERIES = "First Bell";
const CARD_COLLECTION_EDITION = "First Bell Set";
const CARD_COLLECTION_IMAGE_ASSET_PATH = "/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1";
const CARD_COLLECTION_METADATA_URI_PATH = `${HALL_PASS_NFT_PREFIX}/metadata/hall-pass/collection.json`;
const CARD_BACK_IMAGE_ASSET_PATH = "/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAM_IDS = new Set([
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);
const ESTIMATED_CARD_MINT_LAMPORTS = 20_000_000n;
const MINT_AUTHORITY_RESERVE_LAMPORTS = 20_000_000n;
const SOLANA_RPC_TIMEOUT_MS = 12_000;

export interface HallPassNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcUrl: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  reason?: string;
}

export interface PublicHallPassNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcConfigured: boolean;
  rpcHost: string;
  symbol: string;
  authorityAddress?: string;
  collectionAddress?: string;
  metadataStorage?: ReturnType<typeof publicNftMetadataStorageStatus>;
  reason?: string;
}

export interface HallPassNftMintResult {
  ownerWalletAddress: string;
  mintAddress: string;
  mintSignature: string;
  metadataUri: string;
}

export interface HallPassCardMintTransaction {
  cardId: string;
  ownerWalletAddress: string;
  mintAddress: string;
  metadataUri: string;
  transactionBase64: string;
  transactionMessageHash: string;
  transactionEncoding: "base64";
  chain: "solana:mainnet";
  rpcUrl: string;
}

export interface HallPassCardMintVerification {
  signature: string;
  ownerWalletAddress: string;
  mintAddress: string;
  metadataUri: string;
  slot?: number;
  blockTime?: number;
}

export interface HallPassCollectionCreateResult {
  collectionAddress: string;
  signature: string;
  metadataUri: string;
}

export interface HallPassNftBurnTransaction {
  ownerWalletAddress: string;
  mintAddress: string;
  tokenAccountAddress: string;
  transaction: string;
  transactionEncoding: "base64";
  rpcUrl: string;
}

export interface HallPassNftBurnVerification {
  signature: string;
  ownerWalletAddress: string;
  mintAddress: string;
  slot?: number;
  blockTime?: number;
}

type HallPassNftMinter = (
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
) => Promise<HallPassNftMintResult>;
type HallPassNftMintTransactionBuilder = (
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
) => Promise<HallPassCardMintTransaction>;
type HallPassNftMintSubmitter = (signedTransactionBase64: string) => Promise<string>;
type HallPassNftMintVerifier = (input: {
  ownerWalletAddress: string;
  mintAddress: string;
  mintSignature: string;
  metadataUri: string;
}) => Promise<HallPassCardMintVerification>;
type HallPassNftBurnTransactionBuilder = (
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
) => Promise<HallPassNftBurnTransaction>;
type HallPassNftBurnVerifier = (input: {
  ownerWalletAddress: string;
  mintAddress: string;
  burnSignature: string;
}) => Promise<HallPassNftBurnVerification>;

let minterOverride: HallPassNftMinter | null = null;
let mintTransactionBuilderOverride: HallPassNftMintTransactionBuilder | null = null;
let mintSubmitterOverride: HallPassNftMintSubmitter | null = null;
let mintVerifierOverride: HallPassNftMintVerifier | null = null;
let burnTransactionBuilderOverride: HallPassNftBurnTransactionBuilder | null = null;
let burnVerifierOverride: HallPassNftBurnVerifier | null = null;
let authorityBalanceOverride: (() => Promise<bigint>) | null = null;

export function setHallPassNftMinterForTest(minter: HallPassNftMinter | null): () => void {
  const previous = minterOverride;
  minterOverride = minter;
  return () => {
    minterOverride = previous;
  };
}

export function setHallPassNftMintTransactionBuilderForTest(
  builder: HallPassNftMintTransactionBuilder | null,
): () => void {
  const previous = mintTransactionBuilderOverride;
  mintTransactionBuilderOverride = builder;
  return () => {
    mintTransactionBuilderOverride = previous;
  };
}

export function setHallPassNftMintSubmitterForTest(submitter: HallPassNftMintSubmitter | null): () => void {
  const previous = mintSubmitterOverride;
  mintSubmitterOverride = submitter;
  return () => {
    mintSubmitterOverride = previous;
  };
}

export function setHallPassNftMintVerifierForTest(verifier: HallPassNftMintVerifier | null): () => void {
  const previous = mintVerifierOverride;
  mintVerifierOverride = verifier;
  return () => {
    mintVerifierOverride = previous;
  };
}

export function setHallPassNftBurnTransactionBuilderForTest(
  builder: HallPassNftBurnTransactionBuilder | null,
): () => void {
  const previous = burnTransactionBuilderOverride;
  burnTransactionBuilderOverride = builder;
  return () => {
    burnTransactionBuilderOverride = previous;
  };
}

export function setHallPassNftBurnVerifierForTest(verifier: HallPassNftBurnVerifier | null): () => void {
  const previous = burnVerifierOverride;
  burnVerifierOverride = verifier;
  return () => {
    burnVerifierOverride = previous;
  };
}

export function setHallPassNftAuthorityBalanceForTest(fetcher: (() => Promise<bigint>) | null): () => void {
  const previous = authorityBalanceOverride;
  authorityBalanceOverride = fetcher;
  return () => {
    authorityBalanceOverride = previous;
  };
}

export function hallPassNftStatus(env: NodeJS.ProcessEnv = process.env): HallPassNftStatus {
  const publicBaseUrl = publicBaseUrlFromEnv(env);
  const rpcUrl = nftRpcUrl(env);
  const symbol = nftSymbol(env);
  const collectionAddress = cleanEnv(env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS);
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
      reason: "RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS is not set.",
    };
  }
  try {
    const bytes = parseSecretKeyBytes(secret);
    cleanSolanaAddress(collectionAddress, "Core card collection address");
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

export function publicHallPassNftStatus(env: NodeJS.ProcessEnv = process.env): PublicHallPassNftStatus {
  const status = hallPassNftStatus(env);
  return {
    configured: status.configured,
    publicBaseUrl: status.publicBaseUrl,
    rpcConfigured: !!status.rpcUrl,
    rpcHost: rpcHostForPublicStatus(status.rpcUrl),
    symbol: status.symbol,
    ...(status.authorityAddress ? { authorityAddress: status.authorityAddress } : {}),
    ...(status.collectionAddress ? { collectionAddress: status.collectionAddress } : {}),
    metadataStorage: publicNftMetadataStorageStatus(env),
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

function revealProvenanceFromCard(card: RubyHighHallPassCard): HallPassRevealProvenance {
  return {
    ...(card.packRevealVersion ? { packRevealVersion: card.packRevealVersion } : {}),
    ...(card.catalogHash ? { catalogHash: card.catalogHash } : {}),
    ...(card.commitment ? { commitment: card.commitment } : {}),
    ...(card.entropySource ? { entropySource: card.entropySource } : {}),
    ...(card.revealSeed ? { revealSeed: card.revealSeed } : {}),
    ...(card.revealProof ? { revealProof: card.revealProof } : {}),
    ...(card.packAssetAddress ? { packAssetAddress: card.packAssetAddress } : {}),
    ...(typeof card.revealSlot === "number" ? { revealSlot: card.revealSlot } : {}),
    ...(card.randomnessAccount ? { randomnessAccount: card.randomnessAccount } : {}),
    ...(card.revealTransaction ? { revealTransaction: card.revealTransaction } : {}),
  };
}

function createHallPassCardAssetSigner(
  umi: Pick<Umi, "eddsa">,
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
  authoritySecret: Uint8Array,
) {
  const seed = createHash("sha256")
    .update("ruby-high-core-card-asset-v1\0")
    .update(authoritySecret)
    .update("\0")
    .update(cleanCardId(card.id))
    .update("\0")
    .update(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"))
    .digest();
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSeed(seed));
}

function hashTransactionMessageBytes(messageBytes: ArrayLike<number>): string {
  return createHash("sha256").update(Buffer.from(messageBytes)).digest("hex");
}

function hashWeb3TransactionMessage(transaction: Transaction | VersionedTransaction): string {
  const messageBytes = transaction instanceof Transaction
    ? transaction.serializeMessage()
    : transaction.message.serialize();
  return hashTransactionMessageBytes(messageBytes);
}

export function hallPassNftMetadataUri(card: RubyHighHallPassCard, env: NodeJS.ProcessEnv = process.env): string {
  const finalUri = hallPassRevealedNftMetadataUri(card, env);
  if (finalUri) return finalUri;
  return legacyHallPassNftMetadataUri(card, env);
}

export function hallPassNftMetadataUris(card: RubyHighHallPassCard, env: NodeJS.ProcessEnv = process.env): string[] {
  return Array.from(new Set([
    hallPassNftMetadataUri(card, env),
    legacyHallPassNftMetadataUri(card, env),
    ...(typeof card.metadataUri === "string" && card.metadataUri.trim()
      ? [card.metadataUri.trim()]
      : []),
  ]));
}

function legacyHallPassNftMetadataUri(card: RubyHighHallPassCard, env: NodeJS.ProcessEnv = process.env): string {
  const base = publicBaseUrlFromEnv(env);
  const cardId = encodeURIComponent(cleanCardId(card.id));
  return `${base}${HALL_PASS_NFT_PREFIX}/metadata/hall-pass/card/${cardId}.json`;
}

function hallPassRevealedNftMetadataUri(card: RubyHighHallPassCard, env: NodeJS.ProcessEnv = process.env): string | null {
  const characterId = typeof card.characterId === "string" ? card.characterId.trim() : "";
  if (!characterId || !hallPassCardCatalogEntry(characterId)) return null;
  const serial = normalizeSerial(String(card.serial || ""));
  if (!serial) return null;
  const base = publicBaseUrlFromEnv(env);
  return `${base}${HALL_PASS_NFT_PREFIX}/metadata/hall-pass/${encodeURIComponent(characterId)}/${encodeURIComponent(serial)}.json`;
}

async function hallPassNftMetadataUriForMint(card: RubyHighHallPassCard): Promise<string> {
  const fallbackUri = hallPassNftMetadataUri(card);
  const metadata = hallPassNftMetadataForRoute({
    characterId: card.characterId,
    serial: String(card.serial),
    ...revealProvenanceFromCard(card),
  });
  if (!metadata) return fallbackUri;
  return durableNftMetadataUri({
    fallbackUri,
    metadata,
    assetKey: `api/apps/ruby-high/nft/metadata/hall-pass/${encodeURIComponent(card.characterId)}/${encodeURIComponent(String(card.serial))}.json`,
  });
}

export function hallPassCollectionMetadataForRoute(args: {
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const website = publicWebsiteUrl(publicBaseUrl);
  const image = nftImageUri(publicBaseUrl, CARD_COLLECTION_IMAGE_ASSET_PATH);
  const collection = {
    name: CARD_COLLECTION_NAME,
    family: CARD_COLLECTION_FAMILY,
  };
  return {
    name: CARD_COLLECTION_NAME,
    symbol: nftSymbol(process.env),
    description: "Official First Bell collectible set for Ruby High: student, teacher, location, and item cards earned through Ruby High gameplay.",
    image,
    category: "image",
    external_url: website,
    seller_fee_basis_points: NFT_SELLER_FEE_BASIS_POINTS,
    collection,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Set", value: CARD_COLLECTION_SERIES },
      { trait_type: "Set Code", value: FIRST_BELL_SET_CODE },
      { trait_type: "Type", value: "Collection" },
      { trait_type: "Series", value: CARD_COLLECTION_SERIES },
      { trait_type: "Edition", value: CARD_COLLECTION_EDITION },
      { trait_type: "Live Profiles", value: String(FIRST_BELL_SET_LIVE_PROFILE_COUNT) },
      { trait_type: "Draft Profiles", value: String(FIRST_BELL_SET_TOTAL_PROFILES) },
      { trait_type: "Website", value: website },
    ],
    properties: {
      category: "image",
      files: [{ uri: image, type: "image/png" }],
      website,
      collection,
      ...metadataCreatorProperties(),
    },
  };
}

export function coreCardAssetPluginsForMint(args: {
  authorityAddress: string;
  card: Pick<RubyHighHallPassCard, "characterId" | "characterName" | "serial"> & Partial<RubyHighHallPassCard>;
}) {
  const profile = hallPassCardCatalogEntry(args.card.characterId);
  const serial = normalizeSerial(String(args.card.serial || "1"));
  const attributeList = [
    { key: "School", value: "Ruby High" },
    { key: "Collection", value: CARD_COLLECTION_NAME },
    { key: "Set", value: CARD_COLLECTION_SERIES },
    { key: "Set Code", value: FIRST_BELL_SET_CODE },
    { key: "NFT Type", value: "Card" },
    { key: "State", value: "Revealed" },
    { key: "Serial", value: serial },
  ];
  if (profile) {
    attributeList.push(
      { key: "Set Number", value: hallPassCardSetNumber(profile) },
      { key: "Card Profile ID", value: hallPassCardProfileId(profile) },
      { key: "Card Name", value: hallPassCardName(profile) },
      { key: "Character", value: profile.characterName },
      { key: "Role", value: hallPassCardRoleLabel(profile.role) },
      { key: "Rarity", value: hallPassCardRarityLabel(profile.rarity) },
      { key: "Subject", value: hallPassCardSubject(profile) },
    );
  } else if (args.card.characterName) {
    attributeList.push({ key: "Character", value: args.card.characterName });
  }
  return [
    {
      type: "VerifiedCreators" as const,
      signatures: [{ address: publicKey(args.authorityAddress), verified: true }],
    },
    {
      type: "Attributes" as const,
      attributeList,
    },
  ];
}

export function hallPassCardBackMetadataForRoute(args: {
  cardId?: string;
  serial?: string;
  publicBaseUrl?: string;
} & HallPassRevealProvenance): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const website = publicWebsiteUrl(publicBaseUrl);
  const serial = normalizeSerial(args.serial || "1");
  const image = nftImageUri(publicBaseUrl, CARD_BACK_IMAGE_ASSET_PATH);
  return {
    name: `Ruby High Mystery Card #${serial}`,
    symbol: nftSymbol(process.env),
    description: "A sealed Ruby High card. Mint confirmation reveals the card.",
    image,
    category: "image",
    external_url: website,
    seller_fee_basis_points: NFT_SELLER_FEE_BASIS_POINTS,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Collection", value: CARD_COLLECTION_NAME },
      { trait_type: "Set", value: CARD_COLLECTION_SERIES },
      { trait_type: "Set Code", value: FIRST_BELL_SET_CODE },
      { trait_type: "NFT Type", value: "Card" },
      { trait_type: "State", value: "Face Down" },
      { trait_type: "Serial", value: serial },
      { trait_type: "Website", value: website },
      ...(args.cardId ? [{ trait_type: "Card Id", value: args.cardId }] : []),
    ],
    properties: {
      category: "image",
      files: [{ uri: image, type: "image/png" }],
      website,
      ...metadataCreatorProperties(),
      provenance: {
        algorithm: HALL_PASS_PACK_REVEAL_ALGORITHM,
        ...(revealProvenanceProperties(args) ?? {}),
      },
    },
  };
}

export function hallPassNftMetadataForRoute(args: {
  characterId: string;
  serial: string;
  publicBaseUrl?: string;
} & HallPassRevealProvenance): Record<string, unknown> | null {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const website = publicWebsiteUrl(publicBaseUrl);
  const profile = hallPassCardCatalogEntry(args.characterId);
  if (!profile) return null;
  const serial = normalizeSerial(args.serial);
  const cardName = hallPassCardName(profile);
  const image = nftImageUri(publicBaseUrl, versionedImagePath(hallPassCardImagePath(profile)));
  const collection = {
    name: CARD_COLLECTION_NAME,
    family: CARD_COLLECTION_FAMILY,
  };
  return {
    name: hallPassCardNftName(profile.characterName, serial),
    symbol: nftSymbol(process.env),
    description: `${hallPassCardMetadataDescription(profile)} Part of the ${CARD_COLLECTION_NAME} set.`,
    image,
    category: "image",
    external_url: website,
    seller_fee_basis_points: NFT_SELLER_FEE_BASIS_POINTS,
    collection,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Collection", value: CARD_COLLECTION_NAME },
      { trait_type: "Set", value: CARD_COLLECTION_SERIES },
      { trait_type: "Set Code", value: FIRST_BELL_SET_CODE },
      { trait_type: "Set Number", value: hallPassCardSetNumber(profile) },
      { trait_type: "Card Profile ID", value: hallPassCardProfileId(profile) },
      { trait_type: "NFT Type", value: "Card" },
      { trait_type: "State", value: "Revealed" },
      { trait_type: "Edition", value: CARD_COLLECTION_EDITION },
      { trait_type: "Card Name", value: cardName },
      { trait_type: "Title", value: profile.title },
      { trait_type: "Character", value: profile.characterName },
      { trait_type: "Role", value: hallPassCardRoleLabel(profile.role) },
      { trait_type: "Rarity", value: hallPassCardRarityLabel(profile.rarity) },
      { trait_type: "Subject", value: hallPassCardSubject(profile) },
      { trait_type: "Media Type", value: hallPassCardMediaType(profile) },
      { trait_type: "Aspect Class", value: hallPassCardAspectClass(profile) },
      { trait_type: "Image Dimensions", value: hallPassCardImageDimensions(profile) },
      { trait_type: "Source Art Version", value: hallPassCardSourceArtVersion(profile) },
      { trait_type: "Serial", value: serial },
      { trait_type: "Website", value: website },
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

export async function buildHallPassCardMintTransaction(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
): Promise<HallPassCardMintTransaction> {
  if (mintTransactionBuilderOverride) return mintTransactionBuilderOverride(card, ownerWalletAddress);
  const config = readMintConfig();
  const latestBlockhash = await fetchLatestBlockhash(config.rpcUrl, "Card mint");
  const { owner, asset, metadataUri, transaction: unsigned } = await compileHallPassCardMintTransaction(
    card,
    ownerWalletAddress,
    latestBlockhash,
    config,
  );
  const transactionBase64 = unsigned
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  await simulateBase64TransactionForSigning(config.rpcUrl, transactionBase64, "Card mint");
  return {
    cardId: card.id,
    ownerWalletAddress: String(owner),
    mintAddress: String(asset.publicKey),
    metadataUri,
    transactionBase64,
    transactionMessageHash: hashWeb3TransactionMessage(unsigned),
    transactionEncoding: "base64",
    chain: "solana:mainnet",
    rpcUrl: config.rpcUrl,
  };
}

async function compileHallPassCardMintTransaction(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
  latestBlockhash: LatestBlockhash,
  config: ReturnType<typeof readMintConfig>,
  options: { metadataUri?: string } = {},
) {
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const owner = publicKey(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const ownerSigner = createUmiNoopSigner(owner);
  const asset = createHallPassCardAssetSigner(umi, card, String(owner), config.authoritySecret);
  const metadataUri = typeof options.metadataUri === "string" && options.metadataUri.trim()
    ? options.metadataUri.trim()
    : await hallPassNftMetadataUriForMint(card);
  const collection = { publicKey: publicKey(config.collectionAddress) } as Awaited<ReturnType<typeof fetchCollectionV1>>;
  const builder = coreCreate(umi, {
    asset,
    collection,
    authority: umi.identity,
    payer: ownerSigner,
    owner,
    name: hallPassCardOnChainNameForMint(card),
    uri: metadataUri,
    plugins: coreCardAssetPluginsForMint({
      authorityAddress: String(umi.identity.publicKey),
      card,
    }),
  });
  const transaction = new Transaction({
    feePayer: new Web3PublicKey(String(owner)),
    recentBlockhash: String(latestBlockhash.blockhash),
  });
  for (const instruction of builder.getInstructions()) {
    transaction.add(toWeb3JsInstruction(instruction));
  }
  return { owner, asset, metadataUri, transaction };
}

export async function verifyHallPassCardMint(input: {
  ownerWalletAddress: string;
  mintAddress: string;
  mintSignature: string;
  metadataUri: string;
}): Promise<HallPassCardMintVerification> {
  if (mintVerifierOverride) return mintVerifierOverride(input);
  const config = readMintConfig();
  const ownerWalletAddress = cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet");
  const mintAddress = cleanSolanaAddress(input.mintAddress, "Card asset");
  const signature = cleanSignature(input.mintSignature, "Solana card mint signature");
  const metadataUri = input.metadataUri.trim();
  if (!metadataUri) throw new Error("Card metadata URI is required.");
  let transaction: Record<string, any> | null = null;
  let asset: any = null;
  let lastError: unknown = null;
  const umi = createUmi(config.rpcUrl).use(mplCore());
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(3000, 650 + attempt * 400));
    try {
      transaction = await fetchParsedTransaction(config.rpcUrl, signature);
      asset = await fetchAssetV1(umi, publicKey(mintAddress), { commitment: "confirmed" });
      if (transaction && asset) break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!transaction) {
    const detail = lastError instanceof Error ? lastError.message : "";
    throw new Error(detail ? `Card mint transaction was not found yet. ${detail}` : "Card mint transaction was not found yet.");
  }
  if (transaction.meta?.err != null) throw new Error("Solana card mint transaction failed on-chain.");
  const signatures = Array.isArray(transaction.transaction?.signatures) ? transaction.transaction.signatures : [];
  if (!signatures.includes(signature)) throw new Error("Solana RPC returned a different card mint transaction.");
  if (!asset) throw new Error("Card NFT was not found on-chain yet. Try again after confirmation.");
  if (String(asset.publicKey ?? "") !== mintAddress) throw new Error("Card NFT asset does not match this reveal.");
  const actualUri = String(asset.uri ?? "").trim();
  if (actualUri !== metadataUri) throw new Error("Card NFT metadata does not match this reveal.");
  if (String(asset.owner ?? "").trim() !== ownerWalletAddress) throw new Error("Card NFT owner does not match the connected wallet.");
  const collection = coreAssetCollectionAddress(asset);
  if (String(collection ?? "") !== config.collectionAddress) {
    throw new Error("Card NFT is not in the Ruby High Core collection.");
  }
  return {
    signature,
    ownerWalletAddress,
    mintAddress,
    metadataUri,
    ...(typeof transaction.slot === "number" ? { slot: transaction.slot } : {}),
    ...(typeof transaction.blockTime === "number" ? { blockTime: transaction.blockTime } : {}),
  };
}

export async function submitSignedHallPassCardMintTransaction(
  signedTransactionBase64: string,
  requiredAccounts: string[] = [],
  prepared?: {
    card: RubyHighHallPassCard;
    ownerWalletAddress: string;
    mintAddress: string;
    metadataUri?: string;
    transactionMessageHash?: string;
  },
): Promise<string> {
  const clean = signedTransactionBase64.trim();
  if (!clean) throw new Error("Signed card mint transaction is missing.");
  if (mintSubmitterOverride) return mintSubmitterOverride(clean);
  requireSignedTransactionAccounts(clean, requiredAccounts);
  const config = readMintConfig();
  const transactionBase64 = prepared
    ? await completeHallPassCardMintTransactionWithServerSigners(clean, prepared, config)
    : clean;
  const signature = await sendBase64TransactionWithPreflightFallback(
    createSolanaRpc(config.rpcUrl),
    transactionBase64,
  );
  await confirmSubmittedTransaction(config.rpcUrl, String(signature), "Card mint");
  return String(signature);
}

async function completeHallPassCardMintTransactionWithServerSigners(
  signedTransactionBase64: string,
  prepared: {
    card: RubyHighHallPassCard;
    ownerWalletAddress: string;
    mintAddress: string;
    metadataUri?: string;
    transactionMessageHash?: string;
  },
  config: ReturnType<typeof readMintConfig>,
): Promise<string> {
  const ownerWalletAddress = cleanSolanaAddress(prepared.ownerWalletAddress, "Owner Solana wallet");
  const mintAddress = cleanSolanaAddress(prepared.mintAddress, "Card asset");
  const expectedHash = typeof prepared.transactionMessageHash === "string"
    ? prepared.transactionMessageHash.trim()
    : "";
  if (!expectedHash) throw new Error("Card mint transaction was not prepared. Refresh and try again.");

  const actualHash = hashSignedTransactionMessage(signedTransactionBase64, "Signed card mint transaction");
  if (actualHash !== expectedHash && !(await signedHallPassCardMintMatchesPreparedTransaction(
    signedTransactionBase64,
    prepared,
    config,
  ))) {
    throw new Error("Signed card mint transaction does not match this Ruby High card.");
  }
  if (!signedTransactionHasSignatureForAddress(signedTransactionBase64, ownerWalletAddress)) {
    throw new Error("Signed card mint transaction is missing the owner signature.");
  }

  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authority = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  const asset = createHallPassCardAssetSigner(umi, prepared.card, ownerWalletAddress, config.authoritySecret);
  if (String(asset.publicKey) !== mintAddress) {
    throw new Error("Signed card mint transaction does not match this Ruby High card.");
  }
  const completed = VersionedTransaction.deserialize(decodeBase64TransactionBytes(
    signedTransactionBase64,
    "Signed card mint transaction",
  ));
  completed.sign([toWeb3JsKeypair(authority), toWeb3JsKeypair(asset)]);
  if (!signedVersionedTransactionHasSignatureForAddress(completed, ownerWalletAddress) ||
      !signedVersionedTransactionHasSignatureForAddress(completed, String(authority.publicKey)) ||
      !signedVersionedTransactionHasSignatureForAddress(completed, String(asset.publicKey))) {
    throw new Error("Signed card mint transaction is missing a required signature.");
  }
  const transactionBase64 = Buffer.from(completed.serialize()).toString("base64");
  await simulateBase64TransactionForSigning(config.rpcUrl, transactionBase64, "Card mint");
  return transactionBase64;
}

async function signedHallPassCardMintMatchesPreparedTransaction(
  signedTransactionBase64: string,
  prepared: {
    card: RubyHighHallPassCard;
    ownerWalletAddress: string;
    mintAddress: string;
    metadataUri?: string;
  },
  config: ReturnType<typeof readMintConfig>,
): Promise<boolean> {
  const actual = parseSolanaTransactionForInstructionMatch(signedTransactionBase64);
  if (!actual) return false;
  const ownerWalletAddress = cleanSolanaAddress(prepared.ownerWalletAddress, "Owner Solana wallet");
  const recentBlockhash = signedSolanaTransactionRecentBlockhash(signedTransactionBase64);
  if (!recentBlockhash) return false;
  const expected = await compileHallPassCardMintTransaction(
    prepared.card,
    ownerWalletAddress,
    { blockhash: recentBlockhash, lastValidBlockHeight: 0 },
    config,
    {
      metadataUri: prepared.metadataUri ||
        prepared.card.pendingMintMetadataUri ||
        prepared.card.metadataUri,
    },
  );
  const mintAddress = cleanSolanaAddress(prepared.mintAddress, "Card asset");
  if (String(expected.asset.publicKey) !== mintAddress) return false;
  const expectedShape = parseSolanaTransactionForInstructionMatch(
    expected.transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  );
  if (!expectedShape) return false;
  const actualInstructions = withoutWalletOnlyInstructions(actual.instructions);
  const matches = instructionListContainsExpectedSubsequence(
    actualInstructions,
    expectedShape.instructions,
    new Set([addressFromPublicKeyBytes(config.authoritySecret), mintAddress]),
  );
  if (!matches) {
    log.event("nft.card-mint-transaction-mismatch", {
      ownerWalletAddress,
      mintAddress,
      feePayerMatchesOwner: actual.feePayer === ownerWalletAddress,
      feePayerPreview: previewSolanaAddress(actual.feePayer),
      actualInstructionCount: actualInstructions.length,
      expectedInstructionCount: expectedShape.instructions.length,
      actualPrograms: actualInstructions.map((ix) => ix.programId),
      expectedPrograms: expectedShape.instructions.map((ix) => ix.programId),
      ownerSigned: signedTransactionHasSignatureForAddress(signedTransactionBase64, ownerWalletAddress),
    });
  }
  return matches;
}

function decodeBase64TransactionBytes(transactionBase64: string, label: string): Buffer {
  const raw = transactionBase64.trim();
  if (!raw) throw new Error(`${label} is missing.`);
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) throw new Error(`${label} is invalid.`);
  return bytes;
}

function hashSignedTransactionMessage(transactionBase64: string, label: string): string {
  const bytes = decodeBase64TransactionBytes(transactionBase64, label);
  try {
    return hashWeb3TransactionMessage(VersionedTransaction.deserialize(bytes));
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function signedTransactionHasSignatureForAddress(transactionBase64: string, signerAddress: string): boolean {
  try {
    return signedVersionedTransactionHasSignatureForAddress(
      VersionedTransaction.deserialize(decodeBase64TransactionBytes(transactionBase64, "Signed card mint transaction")),
      signerAddress,
    );
  } catch {
    return false;
  }
}

function signedVersionedTransactionHasSignatureForAddress(transaction: VersionedTransaction, signerAddress: string): boolean {
  const accountKeys = transaction.message.getAccountKeys().staticAccountKeys.map((key) => key.toBase58());
  const index = accountKeys.indexOf(signerAddress);
  const signature = index >= 0 ? transaction.signatures[index] : null;
  return !!signature && signature.some((byte) => byte !== 0);
}

function signedSolanaTransactionAccountKeys(transactionBase64: string): string[] {
  const raw = transactionBase64.trim();
  if (!raw) throw new Error("Signed card mint transaction is missing.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) throw new Error("Signed card mint transaction is invalid.");
  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    return transaction.message.getAccountKeys().staticAccountKeys.map((key) => key.toBase58());
  } catch {
    const transaction = Transaction.from(bytes);
    return transaction.compileMessage().accountKeys.map((key) => key.toBase58());
  }
}

type ParsedInstructionShape = {
  programId: string;
  accounts: string[];
  dataBase64: string;
};

type ParsedTransactionShape = {
  feePayer: string;
  instructions: ParsedInstructionShape[];
};

function parseSolanaTransactionForInstructionMatch(transactionBase64: string): ParsedTransactionShape | null {
  const raw = transactionBase64.trim();
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) return null;
  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    const accountKeys = transaction.message.getAccountKeys().staticAccountKeys.map((key) => key.toBase58());
    return {
      feePayer: accountKeys[0] ?? "",
      instructions: transaction.message.compiledInstructions.map((ix) => ({
        programId: accountKeys[ix.programIdIndex] ?? "",
        accounts: ix.accountKeyIndexes.map((index) => accountKeys[index] ?? ""),
        dataBase64: Buffer.from(ix.data).toString("base64"),
      })),
    };
  } catch {
    try {
      const transaction = Transaction.from(bytes);
      return {
        feePayer: transaction.feePayer?.toBase58() ?? transaction.compileMessage().accountKeys[0]?.toBase58() ?? "",
        instructions: transaction.instructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          accounts: ix.keys.map((key) => key.pubkey.toBase58()),
          dataBase64: Buffer.from(ix.data).toString("base64"),
        })),
      };
    } catch {
      return null;
    }
  }
}

function withoutWalletOnlyInstructions(instructions: ParsedInstructionShape[]): ParsedInstructionShape[] {
  return instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM_ID && !MEMO_PROGRAM_IDS.has(ix.programId));
}

function instructionListContainsExpectedSubsequence(
  actual: ParsedInstructionShape[],
  expected: ParsedInstructionShape[],
  serverSignerAccounts: Set<string>,
): boolean {
  let expectedIndex = 0;
  for (const ix of actual) {
    if (expectedIndex < expected.length && instructionMatches(ix, expected[expectedIndex])) {
      expectedIndex += 1;
      continue;
    }
    if (ix.programId === CORE_PROGRAM_ID || ix.accounts.some((account) => serverSignerAccounts.has(account))) {
      return false;
    }
  }
  return expectedIndex === expected.length;
}

function instructionMatches(actual: ParsedInstructionShape, expected: ParsedInstructionShape | undefined): boolean {
  return !!expected &&
    actual.programId === expected.programId &&
    actual.dataBase64 === expected.dataBase64 &&
    actual.accounts.length === expected.accounts.length &&
    actual.accounts.every((account, accountIndex) => account === expected.accounts[accountIndex]);
}

function previewSolanaAddress(address: string): string {
  const clean = address.trim();
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-6)}`;
}

function signedSolanaTransactionRecentBlockhash(transactionBase64: string): string {
  const raw = transactionBase64.trim();
  if (!raw) return "";
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) return "";
  try {
    return VersionedTransaction.deserialize(bytes).message.recentBlockhash;
  } catch {
    try {
      return Transaction.from(bytes).recentBlockhash || "";
    } catch {
      return "";
    }
  }
}

function requireSignedTransactionAccounts(transactionBase64: string, accounts: string[]): void {
  const required = accounts.filter(Boolean);
  if (required.length <= 0) return;
  const present = new Set(signedSolanaTransactionAccountKeys(transactionBase64));
  const missing = required.filter((account) => !present.has(account));
  if (missing.length > 0) {
    throw new Error("Signed card mint transaction does not match this Ruby High card.");
  }
}

export async function mintHallPassCardNft(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
): Promise<HallPassNftMintResult> {
  if (minterOverride) return minterOverride(card, ownerWalletAddress);
  const config = readMintConfig();
  await assertHallPassMintAuthorityCapacity(1);
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const owner = publicKey(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const collection = await fetchCollectionV1(umi, publicKey(config.collectionAddress));
  const asset = generateUmiSigner(umi);
  const metadataUri = await hallPassNftMetadataUriForMint(card);
  const sent = await sendAndConfirmCoreTransaction(umi, coreCreate(umi, {
    asset,
    collection,
    authority: umi.identity,
    payer: umi.payer,
    owner,
    name: hallPassCardOnChainNameForMint(card),
    uri: metadataUri,
    plugins: coreCardAssetPluginsForMint({
      authorityAddress: String(umi.identity.publicKey),
      card,
    }),
  }));
  return {
    ownerWalletAddress: String(owner),
    mintAddress: String(asset.publicKey),
    mintSignature: base58Encode(sent.signature),
    metadataUri,
  };
}

async function sendBase64TransactionWithPreflightFallback(
  rpc: ReturnType<typeof createSolanaRpc>,
  transactionBase64: string,
): Promise<string> {
  try {
    return String(await withSolanaRpcTimeout(rpc.sendTransaction(transactionBase64 as any, {
      encoding: "base64",
      maxRetries: 3n,
      skipPreflight: false,
    }).send(), "Solana timed out while submitting the card mint."));
  } catch (err) {
    if (!isPreflightUnsupportedError(err)) throw err;
    return String(await withSolanaRpcTimeout(rpc.sendTransaction(transactionBase64 as any, {
      encoding: "base64",
      maxRetries: 3n,
      skipPreflight: true,
    }).send(), "Solana timed out while submitting the card mint."));
  }
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

async function fetchLatestBlockhash(
  rpcUrl: string,
  label: string,
) {
  const { value } = await withSolanaRpcTimeout(
    createSolanaRpc(rpcUrl).getLatestBlockhash().send(),
    `${label} timed out while checking Solana.`,
  );
  return value;
}

async function withSolanaRpcTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), SOLANA_RPC_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchSolanaRpc(rpcUrl: string, body: Record<string, unknown>, label: string): Promise<Response> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = ctrl
    ? setTimeout(() => ctrl.abort(), SOLANA_RPC_TIMEOUT_MS)
    : null;
  try {
    return await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(ctrl ? { signal: ctrl.signal } : {}),
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out while checking Solana.`);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function simulateBase64TransactionForSigning(
  rpcUrl: string,
  transactionBase64: string,
  label: string,
): Promise<void> {
  const response = await fetchSolanaRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: "ruby-high-card-transaction-simulate",
    method: "simulateTransaction",
    params: [
      transactionBase64,
      {
        encoding: "base64",
        sigVerify: false,
        commitment: "confirmed",
      },
    ],
  }, label);
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

async function confirmSubmittedTransaction(
  rpcUrl: string,
  signature: string,
  label: string,
): Promise<Record<string, any>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(2500, 700 + attempt * 300));
    try {
      const transaction = await fetchParsedTransaction(rpcUrl, signature);
      if (!transaction) continue;
      if (transaction.meta?.err != null) {
        throw new Error(`${label} failed on-chain. ${transactionFailureDetail(transaction)}`.trim());
      }
      return transaction;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /failed on-chain/i.test(err.message)) throw err;
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`${label} transaction was not confirmed yet.${detail}`.trim());
}

export async function ensureHallPassCardCollectionVerified(mintAddress: string): Promise<boolean> {
  const config = readMintConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const asset = await fetchAssetV1(umi, publicKey(cleanSolanaAddress(mintAddress, "Card asset")), { commitment: "confirmed" });
  if (String(coreAssetCollectionAddress(asset) ?? "") !== config.collectionAddress) {
    throw new Error("Card NFT is not in the Ruby High Core collection.");
  }
  return true;
}

export async function assertHallPassMintAuthorityCapacity(cardCount: number): Promise<void> {
  const normalized = Math.max(0, Math.floor(Number(cardCount || 0)));
  if (normalized <= 0) return;
  const balanceLamports = await mintAuthorityBalanceLamports();
  const requiredLamports = MINT_AUTHORITY_RESERVE_LAMPORTS + BigInt(normalized) * ESTIMATED_CARD_MINT_LAMPORTS;
  if (balanceLamports >= requiredLamports) return;
  throw new Error(
    `Card mint authority balance is ${formatLamportsAsSol(balanceLamports)} SOL but needs at least ${formatLamportsAsSol(requiredLamports)} SOL to mint ${normalized} card NFT${normalized === 1 ? "" : "s"}.`,
  );
}

export async function createHallPassCardCollection(): Promise<HallPassCollectionCreateResult> {
  const config = readMintAuthorityConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(config.authoritySecret);
  umi.use(keypairIdentity(authorityKeypair, true));
  const collection = generateUmiSigner(umi);
  const metadataUri = await hallPassCollectionMetadataUriForMint();
  const sent = await sendAndConfirmCoreTransaction(umi, coreCreateCollection(umi, {
    collection,
    name: CARD_COLLECTION_NAME,
    uri: metadataUri,
    plugins: [
      {
        type: "VerifiedCreators" as const,
        signatures: [{ address: publicKey(String(umi.identity.publicKey)), verified: true }],
      },
      {
        type: "Attributes" as const,
        attributeList: [
          { key: "School", value: "Ruby High" },
          { key: "Collection", value: CARD_COLLECTION_NAME },
          { key: "Set", value: CARD_COLLECTION_SERIES },
          { key: "Set Code", value: FIRST_BELL_SET_CODE },
          { key: "NFT Type", value: "Card Collection" },
        ],
      },
    ],
  }));
  return {
    collectionAddress: String(collection.publicKey),
    signature: base58Encode(sent.signature),
    metadataUri,
  };
}

export async function buildHallPassCardBurnTransaction(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
): Promise<HallPassNftBurnTransaction> {
  return buildHallPassCardsBurnTransaction([card], ownerWalletAddress);
}

export async function buildHallPassCardsBurnTransaction(
  cards: RubyHighHallPassCard[],
  ownerWalletAddress: string,
): Promise<HallPassNftBurnTransaction> {
  const firstCard = cards[0];
  if (!firstCard) throw new Error("No card was selected for burning.");
  if (burnTransactionBuilderOverride) return burnTransactionBuilderOverride(firstCard, ownerWalletAddress);
  const config = readMintConfig();
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const owner = publicKey(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const ownerSigner = createUmiNoopSigner(owner);
  const collection = { publicKey: publicKey(config.collectionAddress) } as Awaited<ReturnType<typeof fetchCollectionV1>>;
  const builders: TransactionBuilder[] = [];
  let firstMint = "";
  for (const card of cards) {
    const mint = publicKey(cleanSolanaAddress(card.mintAddress || "", "Card asset"));
    if (!firstMint) firstMint = String(mint);
    builders.push(coreBurn(umi, {
      asset: { publicKey: mint, owner },
      collection,
      authority: ownerSigner,
      payer: ownerSigner,
    }));
  }
  const latestBlockhash = await fetchLatestBlockhash(config.rpcUrl, "Card burn");
  const burnTransaction = new Transaction({
    feePayer: new Web3PublicKey(String(owner)),
    recentBlockhash: String(latestBlockhash.blockhash),
  });
  for (const builder of builders) {
    for (const instruction of builder.getInstructions()) {
      burnTransaction.add(toWeb3JsInstruction(instruction));
    }
  }
  const transaction = burnTransaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  await simulateBase64TransactionForSigning(config.rpcUrl, transaction, "Card burn");
  return {
    ownerWalletAddress: String(owner),
    mintAddress: firstMint,
    tokenAccountAddress: "",
    transaction,
    transactionEncoding: "base64",
    rpcUrl: config.rpcUrl,
  };
}

export async function verifyHallPassCardBurn(input: {
  ownerWalletAddress: string;
  mintAddress: string;
  burnSignature: string;
}): Promise<HallPassNftBurnVerification> {
  if (burnVerifierOverride) return burnVerifierOverride(input);
  const config = readMintConfig();
  const ownerWalletAddress = cleanSolanaAddress(input.ownerWalletAddress, "Owner Solana wallet");
  const mintAddress = cleanSolanaAddress(input.mintAddress, "Card asset");
  const signature = cleanSignature(input.burnSignature, "Solana burn signature");
  let transaction: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(1000 + attempt * 500);
    transaction = await fetchParsedTransaction(config.rpcUrl, signature);
    if (transaction) break;
  }
  if (!transaction) throw new Error("Solana burn transaction was not found yet. Try again after confirmation.");
  if (transaction.meta?.err != null) throw new Error("Solana burn transaction failed on-chain.");
  const signatures = Array.isArray(transaction.transaction?.signatures) ? transaction.transaction.signatures : [];
  if (!signatures.includes(signature)) throw new Error("Solana RPC returned a different burn transaction.");
  if (!transactionBurnsCoreAssetFromOwner(transaction, mintAddress, ownerWalletAddress, config.collectionAddress)) {
    throw new Error("Solana transaction does not burn this Ruby High card.");
  }
  return {
    signature,
    ownerWalletAddress,
    mintAddress,
    ...(typeof transaction.slot === "number" ? { slot: transaction.slot } : {}),
    ...(typeof transaction.blockTime === "number" ? { blockTime: transaction.blockTime } : {}),
  };
}

function readMintConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
  collectionAddress: string;
} {
  const status = hallPassNftStatus();
  if (!status.configured) throw new Error(status.reason || "Card minting is not configured.");
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl: status.rpcUrl,
    symbol: status.symbol,
    collectionAddress: status.collectionAddress!,
  };
}

function readMintAuthorityConfig(): {
  authoritySecret: Uint8Array;
  rpcUrl: string;
  symbol: string;
} {
  const rpcUrl = nftRpcUrl(process.env);
  const symbol = nftSymbol(process.env);
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  if (!secret) throw new Error("RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY is not set.");
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl,
    symbol,
  };
}

function versionedImagePath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}v=${CARD_IMAGE_VERSION}`;
}

function hallPassCardNftName(characterName: string, serial: string): string {
  return `Ruby High: ${characterName} #${serial}`;
}

export function hallPassCardOnChainNameForMint(card: Pick<RubyHighHallPassCard, "characterName" | "serial">): string {
  const serial = normalizeSerial(String(card.serial || "1"));
  const characterName = (card.characterName || "Card").trim() || "Card";
  const historicalStyle = `${characterName} Ruby High Card #${serial}`;
  if (historicalStyle.length <= 32) return historicalStyle;
  const brandedStyle = `Ruby High: ${characterName} #${serial}`;
  if (brandedStyle.length <= 32) return brandedStyle;
  const compactCharacterName = characterName
    .replace(/^Professor\s+/i, "Prof. ")
    .replace(/\s+/g, " ")
    .trim();
  const compactStyle = `Ruby High: ${compactCharacterName} #${serial}`;
  if (compactStyle.length <= 32) return compactStyle;
  return `Ruby High Card #${serial}`;
}

export function hallPassCardCollectionForMint(collectionAddress?: string): { publicKey: ReturnType<typeof publicKey> } | null {
  if (!collectionAddress) return null;
  return {
    publicKey: publicKey(cleanSolanaAddress(collectionAddress, "Core card collection address")),
  };
}

function hallPassCollectionMetadataUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${publicBaseUrlFromEnv(env)}${CARD_COLLECTION_METADATA_URI_PATH}`;
}

export async function hallPassCollectionMetadataUriForMint(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const fallbackUri = hallPassCollectionMetadataUri(env);
  return durableNftMetadataUri({
    fallbackUri,
    metadata: hallPassCollectionMetadataForRoute({
      publicBaseUrl: publicBaseUrlFromEnv(env),
    }),
    assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/collection.json",
    env,
  });
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
  if (!clean || clean.length < 32 || clean.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(clean)) {
    throw new Error(`${label} is invalid.`);
  }
  return clean;
}

function cleanCardId(value: string): string {
  const clean = value.trim().slice(0, 96);
  if (!clean || !/^[a-zA-Z0-9:_-]+$/.test(clean)) throw new Error("Card id is invalid.");
  return clean;
}

function cleanSignature(value: string, label = "Solana signature"): string {
  const clean = value.trim();
  if (clean.length < 64 || clean.length > 96) throw new Error(`${label} is invalid.`);
  for (const char of clean) {
    if (!BASE58_INDEX.has(char)) throw new Error(`${label} is invalid.`);
  }
  return clean;
}

async function fetchParsedTransaction(rpcUrl: string, signature: string): Promise<Record<string, any> | null> {
  const response = await fetchSolanaRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: "ruby-high-card-burn",
    method: "getTransaction",
    params: [
      signature,
      {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      },
    ],
  }, "Card transaction lookup");
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: Record<string, any> | null;
  };
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  return payload.result ?? null;
}

function transactionFailureDetail(transaction: Record<string, any>): string {
  const logs: string[] = Array.isArray(transaction.meta?.logMessages)
    ? transaction.meta.logMessages.filter((line: unknown): line is string => typeof line === "string")
    : [];
  const insufficientLamports = logs.find((line) => /insufficient lamports|Attempt to debit/i.test(line));
  if (insufficientLamports) return insufficientLamports;
  const tail = logs.slice(-4).join(" ");
  if (tail) return tail;
  try {
    return `Solana error ${JSON.stringify(transaction.meta?.err)}`;
  } catch {
    return "Solana transaction failed.";
  }
}

async function mintAuthorityBalanceLamports(): Promise<bigint> {
  if (authorityBalanceOverride) return authorityBalanceOverride();
  const config = readMintAuthorityConfig();
  const authorityAddress = addressFromPublicKeyBytes(config.authoritySecret);
  const { value } = await createSolanaRpc(config.rpcUrl).getBalance(authorityAddress as any).send();
  return BigInt(value);
}

function formatLamportsAsSol(value: bigint): string {
  return (Number(value) / 1_000_000_000).toFixed(6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transactionBurnsCoreAssetFromOwner(
  transaction: Record<string, any>,
  assetAddress: string,
  ownerWalletAddress: string,
  collectionAddress: string,
): boolean {
  const instructions = [
    ...readInstructions(transaction.transaction?.message?.instructions),
    ...readInstructions(transaction.meta?.innerInstructions),
  ];
  return instructions.some((instruction) => {
    const programId = typeof instruction?.programId === "string"
      ? instruction.programId
      : typeof instruction?.programId?.toBase58 === "function"
        ? instruction.programId.toBase58()
        : "";
    if (programId !== CORE_PROGRAM_ID) return false;
    const accounts = Array.isArray(instruction.accounts)
      ? instruction.accounts.filter((account: unknown): account is string => typeof account === "string")
      : [];
    if (accounts[0] !== assetAddress || accounts[1] !== collectionAddress) return false;
    if (!accounts.includes(ownerWalletAddress)) return false;
    const data = typeof instruction.data === "string" ? instruction.data : "";
    if (!data) return false;
    try {
      return base58Decode(data)[0] === 12;
    } catch {
      return false;
    }
  });
}

function readInstructions(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  const out: any[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).instructions)) {
      out.push(...readInstructions((entry as Record<string, unknown>).instructions));
    } else {
      out.push(entry);
    }
  }
  return out;
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
  const publicKey = secretBytes.slice(32);
  return base58Encode(publicKey);
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

export function deterministicMintSignatureForTest(card: RubyHighHallPassCard, ownerWalletAddress: string): HallPassNftMintResult {
  const digest = createHash("sha256").update(`${card.id}:${ownerWalletAddress}`).digest("hex");
  return {
    ownerWalletAddress,
    mintAddress: base58Encode(Buffer.from(digest.slice(0, 64), "hex") as unknown as Uint8Array).padEnd(32, "1").slice(0, 32),
    mintSignature: base58Encode(Buffer.from(digest + digest, "hex") as unknown as Uint8Array).padEnd(64, "1").slice(0, 64),
    metadataUri: hallPassNftMetadataUri(card),
  };
}
