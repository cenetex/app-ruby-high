import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  isFullySignedTransaction,
  partiallySignTransaction,
} from "@solana/kit";
import {
  assertHallPassMintAuthorityCapacity,
  buildHallPassCardMintTransaction,
  hallPassCardCollectionForMint,
  hallPassCardOnChainNameForMint,
  setHallPassNftAuthorityBalanceForTest,
  submitSignedHallPassCardMintTransaction,
  verifyHallPassCardBurn,
} from "../services/hall-pass-nfts.js";
import { setNftMetadataUploaderForTest } from "../services/nft-metadata-storage.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_NFT_RPC_URL: process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL,
  RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS,
  RUBY_HIGH_NFT_METADATA_STORAGE: process.env.RUBY_HIGH_NFT_METADATA_STORAGE,
};

const OWNER = "57kZQTKZivCKWThxJkFUBD3y5nx9sFXUo8kR7CRkLkMC";
const MINT = "BgVZqawE7eBunbwHh7r9NNtaftRo3FHeqcFFZoteBhSh";
const SIGNATURE = "5UYZSy27Jo9Fca56cxga1ZqRiPMZYAFt5HeTT9qbmSWRxWqukQiEAJFKRpX9HzzPj1GAFih42hLSZJKynr9Z3MEr";
const SUBMITTED_SIGNATURE = "5mSubmittedCardMintSignature222222222222222222222222222222222";

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("verifyHallPassCardBurn", () => {
  it("uses branded, market-friendly on-chain card names within wallet limits", () => {
    expect(hallPassCardOnChainNameForMint({ characterName: "Mika", serial: 823842 } as any)).toBe("Mika Ruby High Card #823842");
    expect(hallPassCardOnChainNameForMint({ characterName: "Library Card", serial: 254854 } as any)).toBe("Ruby High: Library Card #254854");
    expect(hallPassCardOnChainNameForMint({ characterName: "Professor Edward", serial: 424242 } as any)).toBe("Ruby High: Prof. Edward #424242");

    for (const characterName of ["Mika", "Library Card", "Professor Edward", "Captain Null"]) {
      expect(hallPassCardOnChainNameForMint({ characterName, serial: 424242 } as any).length).toBeLessThanOrEqual(32);
    }
  });

  it("normalizes the Core card collection account for minting", () => {
    expect(hallPassCardCollectionForMint(undefined)).toBeNull();
    expect(hallPassCardCollectionForMint("Bu43twu7FsZUHVnYLWuAHLGzseSywm6uHTcD6EDAcX8Q")).toMatchObject({
      publicKey: "Bu43twu7FsZUHVnYLWuAHLGzseSywm6uHTcD6EDAcX8Q",
    });
  });

  it("requires enough authority SOL before server-side card mints", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
    const restore = setHallPassNftAuthorityBalanceForTest(async () => 39_999_999n);
    await expect(assertHallPassMintAuthorityCapacity(1)).rejects.toThrow(/needs at least 0.040000 SOL/);
    restore();

    const restoreFunded = setHallPassNftAuthorityBalanceForTest(async () => 40_000_000n);
    await expect(assertHallPassMintAuthorityCapacity(1)).resolves.toBeUndefined();
    restoreFunded();
  });

  it("prepares an unsigned wallet-first mint, then completes server signatures after owner signing", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const sentTransactions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      if (request.method === "sendTransaction") {
        sentTransactions.push(String(request.params?.[0] ?? ""));
        return rpcResponse(request.id, SUBMITTED_SIGNATURE);
      }
      if (request.method === "getTransaction") {
        return rpcResponse(request.id, {
          meta: { err: null },
          transaction: { signatures: [SUBMITTED_SIGNATURE] },
        });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    const owner = await generateKeyPairSigner();
    const card = {
      id: "unit-card-wallet-first",
      characterId: "ruby",
      characterName: "Ruby",
      serial: 17,
    } as any;
    const prepared = await buildHallPassCardMintTransaction(card, owner.address);
    const decoder = getTransactionDecoder();
    const unsigned = decoder.decode(Buffer.from(prepared.transactionBase64, "base64"));

    expect(testSignatureForAddress(unsigned, owner.address)).toBeNull();
    expect(testSignatureForAddress(unsigned, prepared.mintAddress)).toBeNull();
    expect(isFullySignedTransaction(unsigned)).toBe(false);

    const ownerSigned = await partiallySignTransaction([owner.keyPair], unsigned);
    expect(testSignatureForAddress(ownerSigned, owner.address)).not.toBeNull();
    expect(testSignatureForAddress(ownerSigned, prepared.mintAddress)).toBeNull();
    expect(isFullySignedTransaction(ownerSigned)).toBe(false);

    const signature = await submitSignedHallPassCardMintTransaction(
      getBase64EncodedWireTransaction(ownerSigned),
      [owner.address, prepared.mintAddress],
      {
        card,
        ownerWalletAddress: owner.address,
        mintAddress: prepared.mintAddress,
        transactionMessageHash: prepared.transactionMessageHash,
      },
    );

    expect(signature).toBe(SUBMITTED_SIGNATURE);
    expect(sentTransactions).toHaveLength(1);
    const submitted = decoder.decode(Buffer.from(sentTransactions[0]!, "base64"));
    expect(isFullySignedTransaction(submitted)).toBe(true);
  });

  it("accepts owner signatures returned by standard Solana browser wallets with refreshed blockhashes", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const sentTransactions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      if (request.method === "sendTransaction") {
        sentTransactions.push(String(request.params?.[0] ?? ""));
        return rpcResponse(request.id, SUBMITTED_SIGNATURE);
      }
      if (request.method === "getTransaction") {
        return rpcResponse(request.id, {
          meta: { err: null },
          transaction: { signatures: [SUBMITTED_SIGNATURE] },
        });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    const owner = Keypair.generate();
    const ownerAddress = owner.publicKey.toBase58();
    const card = {
      id: "unit-card-wallet-standard",
      characterId: "ruby",
      characterName: "Ruby",
      serial: 19,
    } as any;
    const prepared = await buildHallPassCardMintTransaction(card, ownerAddress);
    const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, "base64"));
    const refreshedBlockhash = Keypair.generate().publicKey.toBase58();

    transaction.message.recentBlockhash = refreshedBlockhash;
    transaction.sign([owner]);
    const signature = await submitSignedHallPassCardMintTransaction(
      Buffer.from(transaction.serialize()).toString("base64"),
      [ownerAddress, prepared.mintAddress],
      {
        card,
        ownerWalletAddress: ownerAddress,
        mintAddress: prepared.mintAddress,
        transactionMessageHash: prepared.transactionMessageHash,
      },
    );

    expect(signature).toBe(SUBMITTED_SIGNATURE);
    expect(sentTransactions).toHaveLength(1);
    const submitted = VersionedTransaction.deserialize(Buffer.from(sentTransactions[0]!, "base64"));
    expect(submitted.message.recentBlockhash).toBe(refreshedBlockhash);
  });

  it("accepts equivalent browser wallet transactions reserialized with wallet-only instructions", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const sentTransactions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      if (request.method === "sendTransaction") {
        sentTransactions.push(String(request.params?.[0] ?? ""));
        return rpcResponse(request.id, SUBMITTED_SIGNATURE);
      }
      if (request.method === "getTransaction") {
        return rpcResponse(request.id, {
          meta: { err: null },
          transaction: { signatures: [SUBMITTED_SIGNATURE] },
        });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    const owner = Keypair.generate();
    const ownerAddress = owner.publicKey.toBase58();
    const card = {
      id: "unit-card-wallet-reserialized",
      characterId: "ruby",
      characterName: "Ruby",
      serial: 20,
    } as any;
    const prepared = await buildHallPassCardMintTransaction(card, ownerAddress);
    const preparedTransaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, "base64"));
    const accountKeys = preparedTransaction.message.getAccountKeys().staticAccountKeys;
    const message = preparedTransaction.message as any;
    const walletTransaction = new Transaction({
      feePayer: owner.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    });
    walletTransaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    walletTransaction.add(new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [],
      data: Buffer.from("ruby-high-wallet-sign"),
    }));
    for (const ix of preparedTransaction.message.compiledInstructions) {
      walletTransaction.add(new TransactionInstruction({
        programId: accountKeys[ix.programIdIndex]!,
        keys: ix.accountKeyIndexes.map((index) => ({
          pubkey: accountKeys[index]!,
          isSigner: Boolean(message.isAccountSigner(index)),
          isWritable: Boolean(message.isAccountWritable(index)),
        })),
        data: Buffer.from(ix.data),
      }));
    }
    walletTransaction.partialSign(owner);

    const signature = await submitSignedHallPassCardMintTransaction(
      walletTransaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      [ownerAddress, prepared.mintAddress],
      {
        card,
        ownerWalletAddress: ownerAddress,
        mintAddress: prepared.mintAddress,
        transactionMessageHash: prepared.transactionMessageHash,
      },
    );

    expect(signature).toBe(SUBMITTED_SIGNATURE);
    expect(sentTransactions).toHaveLength(1);
    const submitted = Transaction.from(Buffer.from(sentTransactions[0]!, "base64"));
    expect(submitted.instructions[0]?.programId.toBase58()).toBe(ComputeBudgetProgram.programId.toBase58());
  });

  it("accepts matching wallet transactions when a signer layer changes the fee payer", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    const sentTransactions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      if (request.method === "sendTransaction") {
        sentTransactions.push(String(request.params?.[0] ?? ""));
        return rpcResponse(request.id, SUBMITTED_SIGNATURE);
      }
      if (request.method === "getTransaction") {
        return rpcResponse(request.id, {
          meta: { err: null },
          transaction: { signatures: [SUBMITTED_SIGNATURE] },
        });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    const owner = Keypair.generate();
    const feePayer = Keypair.generate();
    const ownerAddress = owner.publicKey.toBase58();
    const card = {
      id: "unit-card-sponsored-fee-payer",
      characterId: "ruby",
      characterName: "Ruby",
      serial: 22,
    } as any;
    const prepared = await buildHallPassCardMintTransaction(card, ownerAddress);
    const preparedTransaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, "base64"));
    const accountKeys = preparedTransaction.message.getAccountKeys().staticAccountKeys;
    const message = preparedTransaction.message as any;
    const walletTransaction = new Transaction({
      feePayer: feePayer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    });
    walletTransaction.add(SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: owner.publicKey,
      lamports: 1,
    }));
    for (const ix of preparedTransaction.message.compiledInstructions) {
      walletTransaction.add(new TransactionInstruction({
        programId: accountKeys[ix.programIdIndex]!,
        keys: ix.accountKeyIndexes.map((index) => ({
          pubkey: accountKeys[index]!,
          isSigner: Boolean(message.isAccountSigner(index)),
          isWritable: Boolean(message.isAccountWritable(index)),
        })),
        data: Buffer.from(ix.data),
      }));
    }
    walletTransaction.partialSign(feePayer, owner);

    const signature = await submitSignedHallPassCardMintTransaction(
      walletTransaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      [ownerAddress, prepared.mintAddress],
      {
        card,
        ownerWalletAddress: ownerAddress,
        mintAddress: prepared.mintAddress,
        transactionMessageHash: prepared.transactionMessageHash,
      },
    );

    expect(signature).toBe(SUBMITTED_SIGNATURE);
    expect(sentTransactions).toHaveLength(1);
    const submitted = Transaction.from(Buffer.from(sentTransactions[0]!, "base64"));
    expect(submitted.feePayer?.toBase58()).toBe(feePayer.publicKey.toBase58());
  });

  it("reuses the prepared card metadata URI when matching refreshed wallet transactions", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_NFT_METADATA_STORAGE = "irys-solana";
    const sentTransactions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      if (request.method === "sendTransaction") {
        sentTransactions.push(String(request.params?.[0] ?? ""));
        return rpcResponse(request.id, SUBMITTED_SIGNATURE);
      }
      if (request.method === "getTransaction") {
        return rpcResponse(request.id, {
          meta: { err: null },
          transaction: { signatures: [SUBMITTED_SIGNATURE] },
        });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    let uploadCount = 0;
    let restoreUploader = setNftMetadataUploaderForTest(async (payload) => {
      uploadCount += 1;
      return `https://gateway.irys.xyz/prepared-${payload.metadataHash.slice(0, 12)}`;
    });
    try {
      const owner = Keypair.generate();
      const ownerAddress = owner.publicKey.toBase58();
      const card = {
        id: "unit-card-prepared-metadata-uri",
        characterId: "ruby",
        characterName: "Ruby",
        serial: 21,
      } as any;
      const prepared = await buildHallPassCardMintTransaction(card, ownerAddress);
      expect(uploadCount).toBe(1);

      restoreUploader();
      restoreUploader = setNftMetadataUploaderForTest(async () => {
        throw new Error("submit should not re-upload card metadata");
      });

      const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, "base64"));
      transaction.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      transaction.sign([owner]);
      const signature = await submitSignedHallPassCardMintTransaction(
        Buffer.from(transaction.serialize()).toString("base64"),
        [ownerAddress, prepared.mintAddress],
        {
          card: {
            ...card,
            pendingMintMetadataUri: prepared.metadataUri,
          },
          ownerWalletAddress: ownerAddress,
          mintAddress: prepared.mintAddress,
          metadataUri: prepared.metadataUri,
          transactionMessageHash: prepared.transactionMessageHash,
        },
      );

      expect(signature).toBe(SUBMITTED_SIGNATURE);
      expect(sentTransactions).toHaveLength(1);
      expect(uploadCount).toBe(1);
    } finally {
      restoreUploader();
    }
  });

  it("rejects owner-signed mint transactions whose mint instructions changed", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
      if (request.method === "getLatestBlockhash") {
        return rpcResponse(request.id, {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        });
      }
      if (request.method === "simulateTransaction") {
        return rpcResponse(request.id, { err: null, logs: [] });
      }
      throw new Error(`Unexpected Solana RPC method ${request.method}`);
    }));

    const owner = Keypair.generate();
    const ownerAddress = owner.publicKey.toBase58();
    const card = {
      id: "unit-card-hash-mismatch",
      characterId: "ruby",
      characterName: "Ruby",
      serial: 18,
    } as any;
    const prepared = await buildHallPassCardMintTransaction(card, ownerAddress);
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, "base64"));
    const instruction = transaction.instructions.find((ix) => ix.data.length > 0);
    if (!instruction) throw new Error("prepared transaction has no instruction data");
    instruction.data = Buffer.from(instruction.data);
    instruction.data[0] = instruction.data[0]! ^ 1;
    transaction.partialSign(owner);

    await expect(submitSignedHallPassCardMintTransaction(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      [ownerAddress, prepared.mintAddress],
      {
        card,
        ownerWalletAddress: ownerAddress,
        mintAddress: prepared.mintAddress,
        transactionMessageHash: prepared.transactionMessageHash,
      },
    )).rejects.toThrow(/does not match this Ruby High card/);
  });

  it("accepts Core burn instructions for the connected wallet", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
    process.env.RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          slot: 421054905,
          blockTime: 1779307749,
          meta: { err: null },
          transaction: {
            signatures: [SIGNATURE],
            message: {
              instructions: [{
                programId: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
                accounts: [
                  MINT,
                  "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
                  OWNER,
                  OWNER,
                  "11111111111111111111111111111111",
                ],
                data: "uy",
              }],
            },
          },
        },
      }),
    })));

    await expect(verifyHallPassCardBurn({
      ownerWalletAddress: OWNER,
      mintAddress: MINT,
      burnSignature: SIGNATURE,
    })).resolves.toMatchObject({
      signature: SIGNATURE,
      ownerWalletAddress: OWNER,
      mintAddress: MINT,
      slot: 421054905,
    });
  });
});

function rpcResponse(id: unknown, result: unknown) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function testSignatureForAddress(transaction: { signatures: unknown }, signerAddress: string) {
  return ((transaction.signatures as Record<string, Uint8Array | null | undefined>)[signerAddress]) ?? null;
}
