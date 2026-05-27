import { createHash } from "node:crypto";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  assertIsFullySignedTransaction,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { Instruction, TransactionSigner } from "@solana/kit";
import {
  TokenStandard,
  createNft,
  fetchDigitalAsset,
  fetchDigitalAssetWithAssociatedToken,
  findMasterEditionPda,
  findMetadataPda,
  getBurnV1InstructionAsync,
  getSetAndVerifySizedCollectionItemInstruction,
} from "@metaplex-foundation/mpl-token-metadata-kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
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
import {
  type HallPassRevealProvenance,
  HALL_PASS_PACK_REVEAL_ALGORITHM,
  revealProvenanceProperties,
} from "./hall-pass-reveal-provenance.js";
import { nftImageUri } from "./nft-arweave-assets.js";
import { durableNftMetadataUri, publicNftMetadataStorageStatus } from "./nft-metadata-storage.js";

type LatestBlockhash = Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0];

export const HALL_PASS_NFT_PREFIX = "/api/apps/ruby-high/nft";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]));
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
  const collectionAddress = cleanEnv(env.RUBY_HIGH_SOLANA_CARD_COLLECTION_ADDRESS);
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
  try {
    const bytes = parseSecretKeyBytes(secret);
    if (collectionAddress) cleanSolanaAddress(collectionAddress, "Card collection address");
    return {
      configured: true,
      publicBaseUrl,
      rpcUrl,
      symbol,
      authorityAddress: addressFromPublicKeyBytes(bytes),
      ...(collectionAddress ? { collectionAddress } : {}),
    };
  } catch (err) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
      ...(collectionAddress ? { collectionAddress } : {}),
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

function verifiedCreatorArgs(addressValue: string) {
  return [{ address: address(addressValue), verified: true, share: 100 }];
}

async function createHallPassCardMintSigner(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
  authoritySecret: Uint8Array,
) {
  const seed = createHash("sha256")
    .update("ruby-high-card-mint-v1\0")
    .update(authoritySecret)
    .update("\0")
    .update(cleanCardId(card.id))
    .update("\0")
    .update(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"))
    .digest();
  return createKeyPairSignerFromPrivateKeyBytes(seed);
}

function hashTransactionMessageBytes(messageBytes: ArrayLike<number>): string {
  return createHash("sha256").update(Buffer.from(messageBytes)).digest("hex");
}

function transactionSignatureForAddress(
  transaction: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>,
  signerAddress: string,
) {
  return (transaction.signatures as Record<string, Uint8Array | null | undefined>)[signerAddress] ?? null;
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
      { trait_type: "Live Profiles", value: FIRST_BELL_SET_LIVE_PROFILE_COUNT },
      { trait_type: "Draft Profiles", value: FIRST_BELL_SET_TOTAL_PROFILES },
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
  const { owner, mint, metadataUri, transaction: unsigned } = await compileHallPassCardMintTransaction(
    card,
    ownerWalletAddress,
    latestBlockhash,
    config,
  );
  const transactionBase64 = getBase64EncodedWireTransaction(unsigned);
  await simulateBase64TransactionForSigning(config.rpcUrl, transactionBase64, "Card mint");
  return {
    cardId: card.id,
    ownerWalletAddress: owner,
    mintAddress: mint.address,
    metadataUri,
    transactionBase64,
    transactionMessageHash: hashTransactionMessageBytes(unsigned.messageBytes),
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
) {
  const owner = address(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const ownerSigner = createNoopSigner(owner);
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = await createHallPassCardMintSigner(card, owner, config.authoritySecret);
  const metadataUri = await hallPassNftMetadataUriForMint(card);
  const [createInstruction, mintInstruction] = await createNft({
    mint,
    authority,
    payer: ownerSigner,
    updateAuthority: authority,
    name: hallPassCardOnChainNameForMint(card),
    symbol: config.symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    creators: verifiedCreatorArgs(authority.address),
    primarySaleHappened: true,
    isMutable: false,
    collection: hallPassCardCollectionForMint(config.collectionAddress),
    uses: null,
    collectionDetails: null,
    ruleSet: null,
    decimals: null,
    printSupply: null,
    tokenOwner: owner,
  });
  const instructions: Instruction[] = [createInstruction, mintInstruction];
  if (config.collectionAddress) {
    instructions.push(await collectionVerificationInstruction({
      authority,
      payer: ownerSigner,
      collectionAddress: config.collectionAddress,
      mintAddress: mint.address,
    }));
  }
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(ownerSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  return { owner, mint, metadataUri, transaction: compileTransaction(message) };
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
  const mintAddress = cleanSolanaAddress(input.mintAddress, "Card mint");
  const signature = cleanSignature(input.mintSignature, "Solana card mint signature");
  const metadataUri = input.metadataUri.trim();
  if (!metadataUri) throw new Error("Card metadata URI is required.");
  let transaction: Record<string, any> | null = null;
  let asset: any = null;
  let lastError: unknown = null;
  const rpc = createSolanaRpc(config.rpcUrl);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(3000, 650 + attempt * 400));
    try {
      transaction = await fetchParsedTransaction(config.rpcUrl, signature);
      asset = await fetchDigitalAssetWithAssociatedToken(rpc, address(mintAddress), address(ownerWalletAddress));
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
  if (String(asset.metadata?.mint ?? "") !== mintAddress) throw new Error("Card NFT metadata mint does not match this reveal.");
  const actualUri = String(asset.metadata?.uri ?? "").trim();
  if (actualUri !== metadataUri) throw new Error("Card NFT metadata does not match this reveal.");
  const expectedAuthority = addressFromPublicKeyBytes(config.authoritySecret);
  if (String(asset.metadata?.updateAuthority ?? "") !== expectedAuthority) {
    throw new Error("Card NFT was not minted by Ruby High.");
  }
  const tokenOwner = String(asset.token?.owner ?? "").trim();
  if (tokenOwner !== ownerWalletAddress) throw new Error("Card NFT owner does not match the connected wallet.");
  if (typeof asset.token?.amount === "bigint" && asset.token.amount !== 1n) {
    throw new Error("Card NFT token balance is invalid.");
  }
  if (config.collectionAddress) {
    const collection = optionValue(asset.metadata?.collection);
    if (!collection || String(collection.key ?? "") !== config.collectionAddress || !collection.verified) {
      throw new Error("Card NFT is not verified into the Ruby High collection.");
    }
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
    transactionBase64 as ReturnType<typeof getBase64EncodedWireTransaction>,
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
    transactionMessageHash?: string;
  },
  config: ReturnType<typeof readMintConfig>,
): Promise<string> {
  const ownerWalletAddress = cleanSolanaAddress(prepared.ownerWalletAddress, "Owner Solana wallet");
  const mintAddress = cleanSolanaAddress(prepared.mintAddress, "Card mint");
  const expectedHash = typeof prepared.transactionMessageHash === "string"
    ? prepared.transactionMessageHash.trim()
    : "";
  if (!expectedHash) throw new Error("Card mint transaction was not prepared. Refresh and try again.");

  const transaction = decodeBase64Transaction(signedTransactionBase64, "Signed card mint transaction");
  const actualHash = hashTransactionMessageBytes(transaction.messageBytes);
  if (actualHash !== expectedHash && !(await signedHallPassCardMintMatchesPreparedTransaction(
    signedTransactionBase64,
    prepared,
    config,
  ))) {
    throw new Error("Signed card mint transaction does not match this Ruby High card.");
  }
  if (!transactionSignatureForAddress(transaction, ownerWalletAddress)) {
    throw new Error("Signed card mint transaction is missing the owner signature.");
  }

  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = await createHallPassCardMintSigner(prepared.card, ownerWalletAddress, config.authoritySecret);
  if (String(mint.address) !== mintAddress) {
    throw new Error("Signed card mint transaction does not match this Ruby High card.");
  }
  const completed = await partiallySignTransaction([authority.keyPair, mint.keyPair], transaction);
  assertIsFullySignedTransaction(completed);
  const transactionBase64 = getBase64EncodedWireTransaction(completed);
  await simulateBase64TransactionForSigning(config.rpcUrl, transactionBase64, "Card mint");
  return transactionBase64;
}

async function signedHallPassCardMintMatchesPreparedTransaction(
  signedTransactionBase64: string,
  prepared: {
    card: RubyHighHallPassCard;
    ownerWalletAddress: string;
    mintAddress: string;
  },
  config: ReturnType<typeof readMintConfig>,
): Promise<boolean> {
  const actual = parseSolanaTransactionForInstructionMatch(signedTransactionBase64);
  if (!actual) return false;
  if (actual.feePayer !== cleanSolanaAddress(prepared.ownerWalletAddress, "Owner Solana wallet")) return false;
  const recentBlockhash = signedSolanaTransactionRecentBlockhash(signedTransactionBase64);
  if (!recentBlockhash) return false;
  const expected = await compileHallPassCardMintTransaction(
    prepared.card,
    prepared.ownerWalletAddress,
    { blockhash: blockhash(recentBlockhash), lastValidBlockHeight: 0n },
    config,
  );
  if (String(expected.mint.address) !== cleanSolanaAddress(prepared.mintAddress, "Card mint")) return false;
  const expectedShape = parseSolanaTransactionForInstructionMatch(
    getBase64EncodedWireTransaction(expected.transaction),
  );
  if (!expectedShape) return false;
  return sameInstructionList(
    withoutWalletOnlyInstructions(actual.instructions),
    expectedShape.instructions,
  );
}

function decodeBase64Transaction(transactionBase64: string, label: string) {
  const raw = transactionBase64.trim();
  if (!raw) throw new Error(`${label} is missing.`);
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length <= 0 || bytes.length > 1232) throw new Error(`${label} is invalid.`);
  try {
    return getTransactionDecoder().decode(bytes);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
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
  return instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM_ID);
}

function sameInstructionList(actual: ParsedInstructionShape[], expected: ParsedInstructionShape[]): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((ix, index) => {
    const expectedIx = expected[index];
    return !!expectedIx &&
      ix.programId === expectedIx.programId &&
      ix.dataBase64 === expectedIx.dataBase64 &&
      ix.accounts.length === expectedIx.accounts.length &&
      ix.accounts.every((account, accountIndex) => account === expectedIx.accounts[accountIndex]);
  });
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
  const owner = address(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = await generateKeyPairSigner();
  const metadataUri = await hallPassNftMetadataUriForMint(card);
  const instructions: Instruction[] = [];
  const [createInstruction, mintInstruction] = await createNft({
    mint,
    authority,
    payer: authority,
    updateAuthority: authority,
    name: hallPassCardOnChainNameForMint(card),
    symbol: config.symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    creators: verifiedCreatorArgs(authority.address),
    primarySaleHappened: true,
    isMutable: false,
    collection: hallPassCardCollectionForMint(config.collectionAddress),
    uses: null,
    collectionDetails: null,
    ruleSet: null,
    decimals: null,
    printSupply: null,
    tokenOwner: owner,
  });
  instructions.push(createInstruction, mintInstruction);
  if (config.collectionAddress) {
    instructions.push(await collectionVerificationInstruction({
      authority,
      payer: authority,
      collectionAddress: config.collectionAddress,
      mintAddress: mint.address,
    }));
  }
  const latestBlockhash = await fetchLatestBlockhash(config.rpcUrl, "Card mint");
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await sendBase64TransactionWithPreflightFallback(
    createSolanaRpc(config.rpcUrl),
    getBase64EncodedWireTransaction(signed),
  );
  await confirmSubmittedTransaction(config.rpcUrl, String(signature), "Card mint");
  return {
    ownerWalletAddress: owner,
    mintAddress: mint.address,
    mintSignature: String(signature),
    metadataUri,
  };
}

async function sendBase64TransactionWithPreflightFallback(
  rpc: ReturnType<typeof createSolanaRpc>,
  transactionBase64: ReturnType<typeof getBase64EncodedWireTransaction>,
): Promise<string> {
  try {
    return String(await withSolanaRpcTimeout(rpc.sendTransaction(transactionBase64, {
      encoding: "base64",
      maxRetries: 3n,
      skipPreflight: false,
    }).send(), "Solana timed out while submitting the card mint."));
  } catch (err) {
    if (!isPreflightUnsupportedError(err)) throw err;
    return String(await withSolanaRpcTimeout(rpc.sendTransaction(transactionBase64, {
      encoding: "base64",
      maxRetries: 3n,
      skipPreflight: true,
    }).send(), "Solana timed out while submitting the card mint."));
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
  if (!config.collectionAddress) return false;
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = address(cleanSolanaAddress(mintAddress, "Card mint"));
  const rpc = createSolanaRpc(config.rpcUrl);
  const asset = await fetchDigitalAsset(rpc, mint);
  const currentCollection = (() => {
    const raw = asset.metadata.collection as any;
    if (!raw || typeof raw !== "object") return null;
    if ("__option" in raw) return raw.__option === "Some" ? raw.value ?? null : null;
    return raw;
  })();
  if (
    currentCollection &&
    currentCollection.verified &&
    String(currentCollection.key) === config.collectionAddress
  ) {
    return false;
  }
  const instruction = await collectionVerificationInstruction({
    authority,
    collectionAddress: config.collectionAddress,
    mintAddress: mint,
  });
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction], tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
    encoding: "base64",
    maxRetries: 3n,
    skipPreflight: true,
  }).send();
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
  const config = readMintConfig();
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = await generateKeyPairSigner();
  const metadataUri = await hallPassCollectionMetadataUriForMint();
  const [createInstruction, mintInstruction] = await createNft({
    mint,
    authority,
    payer: authority,
    updateAuthority: authority,
    name: CARD_COLLECTION_NAME,
    symbol: config.symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    creators: verifiedCreatorArgs(authority.address),
    primarySaleHappened: true,
    isMutable: true,
    collection: null,
    uses: null,
    collectionDetails: { __kind: "V1", size: 0n },
    ruleSet: null,
    decimals: null,
    printSupply: null,
    tokenOwner: authority.address,
    isCollection: true,
  });
  const rpc = createSolanaRpc(config.rpcUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createInstruction, mintInstruction], tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
    encoding: "base64",
    maxRetries: 3n,
    skipPreflight: true,
  }).send();
  return {
    collectionAddress: mint.address,
    signature: String(signature),
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
  const owner = address(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const ownerSigner = createNoopSigner(owner);
  const instructions: Instruction[] = [];
  let firstMint = "";
  let firstTokenAccount = "";
  for (const card of cards) {
    const mint = address(cleanSolanaAddress(card.mintAddress || "", "Card mint"));
    if (!firstMint) firstMint = mint;
    const [tokenAccount] = await findAssociatedTokenPda({
      owner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint,
    });
    if (!firstTokenAccount) firstTokenAccount = tokenAccount;
    instructions.push(await getBurnV1InstructionAsync({
      authority: ownerSigner,
      mint,
      token: tokenAccount,
      tokenOwner: owner,
      tokenStandard: TokenStandard.NonFungible,
      amount: 1n,
    }));
  }
  const latestBlockhash = await fetchLatestBlockhash(config.rpcUrl, "Card burn");
  const transactionBytes = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(owner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => compileTransaction(tx),
    (tx) => new Uint8Array(getTransactionEncoder().encode(tx)),
  );
  const transaction = Buffer.from(transactionBytes).toString("base64");
  await simulateBase64TransactionForSigning(config.rpcUrl, transaction, "Card burn");
  return {
    ownerWalletAddress: owner,
    mintAddress: firstMint,
    tokenAccountAddress: firstTokenAccount,
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
  const mintAddress = cleanSolanaAddress(input.mintAddress, "Card mint");
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
  if (!transactionBurnsMintFromOwner(transaction, mintAddress, ownerWalletAddress)) {
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
  collectionAddress?: string;
} {
  const status = hallPassNftStatus();
  if (!status.configured) throw new Error(status.reason || "Card minting is not configured.");
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl: status.rpcUrl,
    symbol: status.symbol,
    ...(status.collectionAddress ? { collectionAddress: status.collectionAddress } : {}),
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

export function hallPassCardCollectionForMint(collectionAddress?: string): { key: ReturnType<typeof address>; verified: false } | null {
  if (!collectionAddress) return null;
  return {
    key: address(cleanSolanaAddress(collectionAddress, "Card collection address")),
    verified: false,
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

function optionValue<T = any>(value: unknown): T | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if ("__option" in record) return record.__option === "Some" ? (record.value as T) ?? null : null;
  return value as T;
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

async function collectionVerificationInstruction(input: {
  authority: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;
  payer?: TransactionSigner;
  collectionAddress: string;
  mintAddress: string;
}): Promise<Instruction> {
  const mint = address(input.mintAddress);
  const collectionMint = address(cleanSolanaAddress(input.collectionAddress, "Card collection address"));
  const [metadata] = await findMetadataPda({ mint });
  const [collectionMetadata] = await findMetadataPda({ mint: collectionMint });
  const [collectionMasterEdition] = await findMasterEditionPda({ mint: collectionMint });
  return getSetAndVerifySizedCollectionItemInstruction({
    metadata,
    collectionAuthority: input.authority,
    payer: input.payer ?? input.authority,
    updateAuthority: input.authority.address,
    collectionMint,
    collection: collectionMetadata,
    collectionMasterEditionAccount: collectionMasterEdition,
  });
}

async function mintAuthorityBalanceLamports(): Promise<bigint> {
  if (authorityBalanceOverride) return authorityBalanceOverride();
  const config = readMintConfig();
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const { value } = await createSolanaRpc(config.rpcUrl).getBalance(authority.address).send();
  return BigInt(value);
}

function formatLamportsAsSol(value: bigint): string {
  return (Number(value) / 1_000_000_000).toFixed(6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transactionBurnsMintFromOwner(
  transaction: Record<string, any>,
  mintAddress: string,
  ownerWalletAddress: string,
): boolean {
  const instructions = [
    ...readInstructions(transaction.transaction?.message?.instructions),
    ...readInstructions(transaction.meta?.innerInstructions),
  ];
  return instructions.some((instruction) => {
    const parsed = instruction?.parsed;
    if (!parsed || typeof parsed !== "object") return false;
    const type = typeof parsed.type === "string" ? parsed.type.toLowerCase() : "";
    if (type !== "burn" && type !== "burnchecked" && type !== "burn_checked") return false;
    const info = parsed.info && typeof parsed.info === "object" ? parsed.info as Record<string, unknown> : {};
    const mint = typeof info.mint === "string" ? info.mint : "";
    const owner = typeof info.owner === "string"
      ? info.owner
      : typeof info.authority === "string"
        ? info.authority
        : typeof info.multisigAuthority === "string"
          ? info.multisigAuthority
          : "";
    const signers = Array.isArray(info.signers) ? info.signers.filter((signer): signer is string => typeof signer === "string") : [];
    const tokenAmount = info.tokenAmount && typeof info.tokenAmount === "object"
      ? info.tokenAmount as Record<string, unknown>
      : {};
    const amount = typeof info.amount === "string" || typeof info.amount === "number" || typeof info.amount === "bigint"
      ? String(info.amount)
      : typeof tokenAmount.amount === "string" || typeof tokenAmount.amount === "number" || typeof tokenAmount.amount === "bigint"
        ? String(tokenAmount.amount)
        : "";
    return mint === mintAddress && (owner === ownerWalletAddress || signers.includes(ownerWalletAddress)) && amount === "1";
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
