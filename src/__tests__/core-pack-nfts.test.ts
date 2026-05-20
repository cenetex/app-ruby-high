import { afterEach, describe, expect, it, vi } from "vitest";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { VersionedTransaction } from "@solana/web3.js";
import { buildCorePackPurchaseTransaction } from "../services/core-pack-nfts.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("Core pack NFT checkout transactions", () => {
  it("builds one partially signed transaction with RUBY transfer and Core pack mint", async () => {
    const umi = createUmi("https://rpc.test");
    const authority = umi.eddsa.generateKeypair();
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(authority.secretKey));
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_SOLANA_RPC_URL = "https://rpc.test";
    const ownerWalletAddress = "AEfDYvgUixKzgBGJZ48tPgrW33kz2Gx6qDTXXDNDNX7";
    const sourceTokenAccountAddress = "FNhC7aog7542La3isBvGF5fd1myzahUwAyUWfoNNHhYV";
    const paymentReference = "5zs9ABUJ3bmLCiGTvuk7by7JnaMfqT3QqetdkmFxLXZD";

    const prepared = await buildCorePackPurchaseTransaction({
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 4,
      ownerWalletAddress,
      paymentReference,
      tokenMint: "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump",
      tokenRecipient: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      tokenAmount: "100000",
      tokenAmountBaseUnits: "100000000000",
      tokenDecimals: 6,
      tokenSymbol: "RUBY",
      sourceTokenAccountAddress,
      latestBlockhash: {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 1,
      },
    });
    const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, "base64"));
    const accountKeys = transaction.message.staticAccountKeys.map((key) => key.toBase58());
    const instructions = transaction.message.compiledInstructions.map((ix) => ({
      program: accountKeys[ix.programIdIndex],
      data: Buffer.from(ix.data),
      accounts: ix.accountKeyIndexes.map((index) => accountKeys[index]),
    }));
    const tokenTransfer = instructions.find((ix) => ix.program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && ix.data[0] === 12);

    expect(transaction.signatures[0]?.every((byte) => byte === 0)).toBe(true);
    expect(transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))).toBe(true);
    expect(instructions.map((ix) => ix.program)).toEqual(expect.arrayContaining([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
    ]));
    expect(tokenTransfer).toBeTruthy();
    expect(tokenTransfer?.accounts).toEqual(expect.arrayContaining([
      sourceTokenAccountAddress,
      prepared.destinationTokenAccountAddress,
      ownerWalletAddress,
      paymentReference,
    ]));
    expect(prepared.assetAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
