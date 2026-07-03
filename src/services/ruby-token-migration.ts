import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_SOURCE_RUBY_MINT = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
const DEFAULT_CANONICAL_RUBY_MINT = "2hJY16WZgTQXXo6qBoWoBtZM7fz556cw3qdLgtntRuby";
const DEFAULT_BURN_TO_MINT_PROGRAM_ID = "2q5xELTGky988Lz1oLZLpBoQv7DzB7bBxoUdQGRmRATi";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

export interface PublicRubyMigrationStatus {
  configured: boolean;
  enabled: boolean;
  sourceMint: string;
  destinationMint: string;
  programId: string;
  sourceSymbol: string;
  destinationSymbol: string;
  decimals: number;
  rpcHost: string;
  reason?: string;
}

export interface RubyMigrationTransactionInput {
  ownerWalletAddress: string;
  amountBaseUnits?: string;
  maxSourceAmountBaseUnits?: string;
  sourceTokenAccountAddress?: string;
  userNonce?: string | number | bigint;
  latestBlockhash?: { blockhash: string; lastValidBlockHeight: number };
}

export interface RubyMigrationTransactionResult {
  ownerWalletAddress: string;
  sourceMint: string;
  destinationMint: string;
  programId: string;
  sourceTokenAccountAddress: string;
  destinationTokenAccountAddress: string;
  amountBaseUnits: string;
  maxSourceAmountBaseUnits: string;
  userNonce: string;
  transactionBase64: string;
  transactionEncoding: "base64";
  chain: "solana:mainnet";
  rpcUrl: string;
}

interface RubyMigrationConfig {
  enabledFlag: boolean;
  sourceMint: string;
  destinationMint: string;
  programId: string;
  sourceSymbol: string;
  destinationSymbol: string;
  decimals: number;
  rpcUrl: string;
  reason?: string;
}

function envTrim(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readBooleanEnv(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = envTrim(name, env);
  if (!raw) return fallback;
  return /^(1|true|yes|on|enabled)$/i.test(raw);
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number, env: NodeJS.ProcessEnv): number {
  const raw = envTrim(name, env);
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function solanaRpcUrl(env: NodeJS.ProcessEnv): string {
  const explicit = envTrim("RUBY_HIGH_RUBY_MIGRATION_RPC_URL", env) || envTrim("RUBY_HIGH_SOLANA_RPC_URL", env);
  if (explicit) return explicit;
  const privyAppId = envTrim("RUBY_HIGH_PRIVY_APP_ID", env);
  if (privyAppId) {
    return `https://solana-mainnet.rpc.privy.systems?privyAppId=${encodeURIComponent(privyAppId)}`;
  }
  return DEFAULT_SOLANA_RPC_URL;
}

function rpcHostForPublicStatus(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || "configured";
  } catch {
    return value ? "configured" : "";
  }
}

function isSolanaAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function readRubyMigrationConfig(env: NodeJS.ProcessEnv = process.env): RubyMigrationConfig {
  const enabledFlag = readBooleanEnv("RUBY_HIGH_RUBY_MIGRATION_ENABLED", false, env);
  const sourceMint = envTrim("RUBY_HIGH_RUBY_MIGRATION_SOURCE_MINT", env) ?? DEFAULT_SOURCE_RUBY_MINT;
  const destinationMint = envTrim("RUBY_HIGH_RUBY_MIGRATION_DESTINATION_MINT", env) ?? DEFAULT_CANONICAL_RUBY_MINT;
  const programId = envTrim("RUBY_HIGH_RUBY_MIGRATION_PROGRAM_ID", env) ?? DEFAULT_BURN_TO_MINT_PROGRAM_ID;
  const sourceSymbol = envTrim("RUBY_HIGH_RUBY_MIGRATION_SOURCE_SYMBOL", env) ?? "RUBY";
  const destinationSymbol = envTrim("RUBY_HIGH_RUBY_MIGRATION_DESTINATION_SYMBOL", env) ?? "Ruby";
  const decimals = readBoundedIntEnv("RUBY_HIGH_RUBY_MIGRATION_DECIMALS", 6, 0, 18, env);
  const invalid = [
    isSolanaAddress(sourceMint) ? "" : "source mint",
    isSolanaAddress(destinationMint) ? "" : "destination mint",
    isSolanaAddress(programId) ? "" : "program id",
  ].filter(Boolean);
  return {
    enabledFlag,
    sourceMint,
    destinationMint,
    programId,
    sourceSymbol,
    destinationSymbol,
    decimals,
    rpcUrl: solanaRpcUrl(env),
    reason: enabledFlag
      ? invalid.length > 0 ? `Ruby token migration has invalid ${invalid.join(", ")} configuration.` : undefined
      : "Ruby token migration is disabled.",
  };
}

export function publicRubyMigrationStatus(env: NodeJS.ProcessEnv = process.env): PublicRubyMigrationStatus {
  const config = readRubyMigrationConfig(env);
  const configured = config.enabledFlag && !config.reason;
  return {
    configured,
    enabled: configured,
    sourceMint: config.sourceMint,
    destinationMint: config.destinationMint,
    programId: config.programId,
    sourceSymbol: config.sourceSymbol,
    destinationSymbol: config.destinationSymbol,
    decimals: config.decimals,
    rpcHost: rpcHostForPublicStatus(config.rpcUrl),
    ...(config.reason ? { reason: config.reason } : {}),
  };
}

export async function buildRubyMigrationTransaction(
  input: RubyMigrationTransactionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RubyMigrationTransactionResult> {
  const config = readRubyMigrationConfig(env);
  if (!config.enabledFlag || config.reason) {
    throw new Error(config.reason || "Ruby token migration is not enabled.");
  }
  const owner = readPublicKey(input.ownerWalletAddress, "Owner Solana wallet");
  const sourceMint = readPublicKey(config.sourceMint, "Ruby migration source mint");
  const destinationMint = readPublicKey(config.destinationMint, "Ruby migration destination mint");
  const programId = readPublicKey(config.programId, "Ruby migration program id");
  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ADDRESS);
  const requestedAmount = input.amountBaseUnits
    ? readU64(input.amountBaseUnits, "Ruby migration amount")
    : null;
  const source = input.sourceTokenAccountAddress && requestedAmount
    ? {
      tokenAccountAddress: readPublicKey(input.sourceTokenAccountAddress, "Source Ruby token account").toBase58(),
      balanceBaseUnits: requestedAmount,
    }
    : await findOwnerTokenAccountForMigration({
      rpcUrl: config.rpcUrl,
      ownerWalletAddress: owner.toBase58(),
      sourceMint: sourceMint.toBase58(),
      requiredBaseUnits: requestedAmount,
      sourceSymbol: config.sourceSymbol,
    });
  const amountBaseUnits = requestedAmount ?? source.balanceBaseUnits;
  if (amountBaseUnits <= 0n) throw new Error(`This Solana wallet does not have ${config.sourceSymbol} to migrate.`);
  if (source.balanceBaseUnits < amountBaseUnits) {
    throw new Error(`This Solana wallet does not have enough ${config.sourceSymbol} to migrate.`);
  }
  const maxSourceAmountBaseUnits = input.maxSourceAmountBaseUnits
    ? readU64(input.maxSourceAmountBaseUnits, "Ruby migration max source amount")
    : amountBaseUnits;
  if (maxSourceAmountBaseUnits < amountBaseUnits) {
    throw new Error("Ruby migration max source amount is smaller than the migration amount.");
  }
  const userNonce = input.userNonce == null
    ? BigInt(Date.now())
    : readU64(String(input.userNonce), "Ruby migration nonce");
  const destinationTokenAccountAddress = associatedTokenAddress(owner, destinationMint, tokenProgram).toBase58();
  const latestBlockhash = input.latestBlockhash ?? await fetchLatestBlockhash(config.rpcUrl);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latestBlockhash.blockhash,
  });
  transaction.add(createAssociatedTokenAccountIdempotentInstruction({
    payer: owner,
    ata: new PublicKey(destinationTokenAccountAddress),
    owner,
    mint: destinationMint,
    tokenProgram,
  }));
  transaction.add(createMigrateInstruction({
    programId,
    owner,
    sourceMint,
    destinationMint,
    sourceTokenAccount: new PublicKey(source.tokenAccountAddress),
    destinationTokenAccount: new PublicKey(destinationTokenAccountAddress),
    tokenProgram,
    amountBaseUnits,
    maxSourceAmountBaseUnits,
    userNonce,
  }));
  return {
    ownerWalletAddress: owner.toBase58(),
    sourceMint: sourceMint.toBase58(),
    destinationMint: destinationMint.toBase58(),
    programId: programId.toBase58(),
    sourceTokenAccountAddress: source.tokenAccountAddress,
    destinationTokenAccountAddress,
    amountBaseUnits: amountBaseUnits.toString(),
    maxSourceAmountBaseUnits: maxSourceAmountBaseUnits.toString(),
    userNonce: userNonce.toString(),
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64"),
    transactionEncoding: "base64",
    chain: "solana:mainnet",
    rpcUrl: config.rpcUrl,
  };
}

function readPublicKey(value: string, label: string): PublicKey {
  const clean = value.trim();
  try {
    return new PublicKey(clean);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function readU64(value: string, label: string): bigint {
  const clean = value.trim();
  if (!/^\d+$/.test(clean)) throw new Error(`${label} must be an unsigned integer.`);
  const parsed = BigInt(clean);
  if (parsed > (1n << 64n) - 1n) throw new Error(`${label} exceeds u64.`);
  return parsed;
}

function writeU64(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value, offset);
}

function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([
    owner.toBuffer(),
    tokenProgram.toBuffer(),
    mint.toBuffer(),
  ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS))[0];
}

function createAssociatedTokenAccountIdempotentInstruction(input: {
  payer: PublicKey;
  ata: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.ata, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_ADDRESS), isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function createMigrateInstruction(input: {
  programId: PublicKey;
  owner: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  sourceTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  tokenProgram: PublicKey;
  amountBaseUnits: bigint;
  maxSourceAmountBaseUnits: bigint;
  userNonce: bigint;
}): TransactionInstruction {
  const [configPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("burn-to-mint"),
    Buffer.from("config"),
    Buffer.from("v1"),
  ], input.programId);
  const [sourceConfigPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("source"),
    input.sourceMint.toBuffer(),
    input.destinationMint.toBuffer(),
  ], input.programId);
  const [destinationConfigPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("destination"),
    input.destinationMint.toBuffer(),
  ], input.programId);
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([
    Buffer.from("rati"),
    Buffer.from("mint-authority"),
    input.destinationMint.toBuffer(),
  ], input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.owner, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: sourceConfigPda, isSigner: false, isWritable: true },
      { pubkey: destinationConfigPda, isSigner: false, isWritable: true },
      { pubkey: input.sourceTokenAccount, isSigner: false, isWritable: true },
      { pubkey: input.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: input.sourceMint, isSigner: false, isWritable: true },
      { pubkey: input.destinationMint, isSigner: false, isWritable: true },
      { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: encodeMigrateInstruction(input.amountBaseUnits, input.maxSourceAmountBaseUnits, input.userNonce),
  });
}

function encodeMigrateInstruction(
  desiredDestinationAmount: bigint,
  maxSourceAmount: bigint,
  userNonce: bigint,
): Buffer {
  const out = Buffer.alloc(26);
  out[0] = 4;
  writeU64(out, 1, desiredDestinationAmount);
  writeU64(out, 9, maxSourceAmount);
  writeU64(out, 17, userNonce);
  out[25] = 0;
  return out;
}

async function findOwnerTokenAccountForMigration(input: {
  rpcUrl: string;
  ownerWalletAddress: string;
  sourceMint: string;
  requiredBaseUnits: bigint | null;
  sourceSymbol: string;
}): Promise<{ tokenAccountAddress: string; balanceBaseUnits: bigint }> {
  const response = await fetch(input.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-ruby-migration-accounts",
      method: "getTokenAccountsByOwner",
      params: [
        input.ownerWalletAddress,
        { mint: input.sourceMint },
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
    if (balanceBaseUnits <= 0n) continue;
    if (input.requiredBaseUnits != null && balanceBaseUnits < input.requiredBaseUnits) continue;
    if (!best || balanceBaseUnits > best.balanceBaseUnits) {
      best = { tokenAccountAddress, balanceBaseUnits };
    }
  }
  if (!best) {
    throw new Error(input.requiredBaseUnits == null
      ? `This Solana wallet does not have ${input.sourceSymbol} to migrate.`
      : `This Solana wallet does not have enough ${input.sourceSymbol} to migrate.`);
  }
  return best;
}

async function fetchLatestBlockhash(rpcUrl: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-ruby-migration-blockhash",
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
