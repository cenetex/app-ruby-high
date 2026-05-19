import { createHash } from "node:crypto";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import { TokenStandard, createNft, getBurnV1InstructionAsync } from "@metaplex-foundation/mpl-token-metadata-kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { RubyHighHallPassCard } from "../types.js";

export const HALL_PASS_NFT_PREFIX = "/api/apps/ruby-high/nft";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]));
const DEFAULT_PUBLIC_BASE_URL = "https://ruby-high.ai";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SYMBOL = "RUBY";

export interface HallPassNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcUrl: string;
  symbol: string;
  authorityAddress?: string;
  reason?: string;
}

export interface PublicHallPassNftStatus {
  configured: boolean;
  publicBaseUrl: string;
  rpcConfigured: boolean;
  rpcHost: string;
  symbol: string;
  authorityAddress?: string;
  reason?: string;
}

export interface HallPassNftMintResult {
  ownerWalletAddress: string;
  mintAddress: string;
  mintSignature: string;
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
let burnTransactionBuilderOverride: HallPassNftBurnTransactionBuilder | null = null;
let burnVerifierOverride: HallPassNftBurnVerifier | null = null;

export function setHallPassNftMinterForTest(minter: HallPassNftMinter | null): () => void {
  const previous = minterOverride;
  minterOverride = minter;
  return () => {
    minterOverride = previous;
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

export function hallPassNftStatus(env: NodeJS.ProcessEnv = process.env): HallPassNftStatus {
  const publicBaseUrl = publicBaseUrlFromEnv(env);
  const rpcUrl = nftRpcUrl(env);
  const symbol = nftSymbol(env);
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
    return {
      configured: true,
      publicBaseUrl,
      rpcUrl,
      symbol,
      authorityAddress: addressFromPublicKeyBytes(bytes),
    };
  } catch (err) {
    return {
      configured: false,
      publicBaseUrl,
      rpcUrl,
      symbol,
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
    ...(status.reason ? { reason: status.reason } : {}),
  };
}

export function hallPassNftMetadataUri(card: RubyHighHallPassCard, env: NodeJS.ProcessEnv = process.env): string {
  const base = publicBaseUrlFromEnv(env);
  const characterId = encodeURIComponent(card.characterId || "ruby");
  const serial = encodeURIComponent(String(card.serial || 1));
  return `${base}${HALL_PASS_NFT_PREFIX}/metadata/hall-pass/${characterId}/${serial}.json`;
}

export function hallPassNftMetadataForRoute(args: {
  characterId: string;
  serial: string;
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const publicBaseUrl = cleanBaseUrl(args.publicBaseUrl || publicBaseUrlFromEnv());
  const profile = hallPassNftProfile(args.characterId);
  const serial = normalizeSerial(args.serial);
  return {
    name: `${profile.name} Ruby High Card #${serial}`,
    symbol: nftSymbol(process.env),
    description: profile.description,
    image: `${publicBaseUrl}${profile.imagePath}`,
    external_url: `${publicBaseUrl}/`,
    attributes: [
      { trait_type: "School", value: "Ruby High" },
      { trait_type: "Character", value: profile.name },
      { trait_type: "Role", value: profile.role },
      { trait_type: "Serial", value: serial },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${publicBaseUrl}${profile.imagePath}`, type: profile.imageMime }],
    },
  };
}

export async function mintHallPassCardNft(
  card: RubyHighHallPassCard,
  ownerWalletAddress: string,
): Promise<HallPassNftMintResult> {
  if (minterOverride) return minterOverride(card, ownerWalletAddress);
  const config = readMintConfig();
  const owner = address(cleanSolanaAddress(ownerWalletAddress, "Owner Solana wallet"));
  const authority = await createKeyPairSignerFromBytes(config.authoritySecret);
  const mint = await generateKeyPairSigner();
  const metadataUri = hallPassNftMetadataUri(card);
  const [createInstruction, mintInstruction] = await createNft({
    mint,
    authority,
    payer: authority,
    updateAuthority: authority,
    name: `${card.characterName} Ruby High Card #${card.serial}`,
    symbol: config.symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    creators: null,
    primarySaleHappened: true,
    isMutable: false,
    collection: null,
    uses: null,
    collectionDetails: null,
    ruleSet: null,
    decimals: null,
    printSupply: null,
    tokenOwner: owner,
  });
  const { value: latestBlockhash } = await createSolanaRpc(config.rpcUrl).getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createInstruction, mintInstruction], tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await createSolanaRpc(config.rpcUrl)
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      maxRetries: 3n,
      skipPreflight: false,
    })
    .send();
  return {
    ownerWalletAddress: owner,
    mintAddress: mint.address,
    mintSignature: String(signature),
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
  const { value: latestBlockhash } = await createSolanaRpc(config.rpcUrl).getLatestBlockhash().send();
  const transactionBytes = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(owner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => compileTransaction(tx),
    (tx) => new Uint8Array(getTransactionEncoder().encode(tx)),
  );
  return {
    ownerWalletAddress: owner,
    mintAddress: firstMint,
    tokenAccountAddress: firstTokenAccount,
    transaction: Buffer.from(transactionBytes).toString("base64"),
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
  const signature = cleanSignature(input.burnSignature);
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
} {
  const status = hallPassNftStatus();
  if (!status.configured) throw new Error(status.reason || "Card minting is not configured.");
  const secret = cleanEnv(process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY);
  return {
    authoritySecret: parseSecretKeyBytes(secret),
    rpcUrl: status.rpcUrl,
    symbol: status.symbol,
  };
}

function hallPassNftProfile(characterId: string): {
  name: string;
  role: string;
  rarity: string;
  description: string;
  imagePath: string;
  imageMime: string;
} {
  switch (characterId) {
    case "sally-science":
      return {
        name: "Sally Science",
        role: "Teacher",
        rarity: "Common",
        description: "Good for one escape from sloppy variables.",
        imagePath: "/api/apps/ruby-high/assets/teachers/sally-science-full.png",
        imageMime: "image/png",
      };
    case "professor-edward":
      return {
        name: "Professor Edward",
        role: "Teacher",
        rarity: "Common",
        description: "Please return before the footnotes start breeding.",
        imagePath: "/api/apps/ruby-high/assets/teachers/professor-edward-full.png",
        imageMime: "image/png",
      };
    case "lyra":
    case "sami":
    case "ravi":
    case "indra":
    case "mika":
    case "noor": {
      const name = characterId.slice(0, 1).toUpperCase() + characterId.slice(1);
      return {
        name,
        role: "Student",
        rarity: characterId === "indra" || characterId === "noor" ? "Rare" : "Common",
        description: `${name} slipped this one into the stack.`,
        imagePath: `/api/apps/ruby-high/assets/students/${characterId}-full.png`,
        imageMime: "image/png",
      };
    }
    case "captain-null":
      return {
        name: "Captain Null",
        role: "Special",
        rarity: "Super Rare",
        description: "Find page 10 and the hallway forgets your name.",
        imagePath: "/api/apps/ruby-high/assets/comics/first-bell/page-10.jpg",
        imageMime: "image/jpeg",
      };
    case "eliza":
      return {
        name: "Eliza",
        role: "Teacher",
        rarity: "Super Rare",
        description: "Make the system legible, then make it sing.",
        imagePath: "/api/apps/ruby-high/assets/logo.png",
        imageMime: "image/png",
      };
    case "rati":
      return {
        name: "Rati",
        role: "Teacher",
        rarity: "Super Rare",
        description: "Hold the signal. Build the world.",
        imagePath: "/api/apps/ruby-high/assets/logo.png",
        imageMime: "image/png",
      };
    case "ruby":
    default:
      return {
        name: "Ruby",
        role: "Teacher",
        rarity: "Common",
        description: "Ruby stamped this one before the late bell could object.",
        imagePath: "/api/apps/ruby-high/assets/teachers/ruby-full.png",
        imageMime: "image/png",
      };
  }
}

function normalizeSerial(serial: string): string {
  const parsed = Math.max(1, Math.floor(Number(serial)));
  return Number.isFinite(parsed) ? String(parsed) : "1";
}

function publicBaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return cleanBaseUrl(cleanEnv(env.RUBY_HIGH_PUBLIC_BASE_URL) || DEFAULT_PUBLIC_BASE_URL);
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

function cleanSignature(value: string): string {
  const clean = value.trim();
  if (clean.length < 64 || clean.length > 96) throw new Error("Solana burn signature is invalid.");
  for (const char of clean) {
    if (!BASE58_INDEX.has(char)) throw new Error("Solana burn signature is invalid.");
  }
  return clean;
}

async function fetchParsedTransaction(rpcUrl: string, signature: string): Promise<Record<string, any> | null> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
  });
  if (!response.ok) throw new Error(`Solana RPC failed with ${response.status}.`);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
    result?: Record<string, any> | null;
  };
  if (payload.error) throw new Error(payload.error.message || `Solana RPC error ${payload.error.code ?? ""}`.trim());
  return payload.result ?? null;
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
        : "";
    const tokenAmount = info.tokenAmount && typeof info.tokenAmount === "object"
      ? info.tokenAmount as Record<string, unknown>
      : {};
    const amount = typeof info.amount === "string" || typeof info.amount === "number" || typeof info.amount === "bigint"
      ? String(info.amount)
      : typeof tokenAmount.amount === "string" || typeof tokenAmount.amount === "number" || typeof tokenAmount.amount === "bigint"
        ? String(tokenAmount.amount)
        : "";
    return mint === mintAddress && owner === ownerWalletAddress && amount === "1";
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
