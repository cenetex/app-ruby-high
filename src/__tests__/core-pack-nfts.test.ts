import { afterEach, describe, expect, it, vi } from "vitest";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Transaction } from "@solana/web3.js";
import { buildCorePackPurchaseTransaction, corePackNftMetadataUri } from "../services/core-pack-nfts.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
  RUBY_HIGH_PUBLIC_BASE_URL: process.env.RUBY_HIGH_PUBLIC_BASE_URL,
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
  it("normalizes legacy one-pack metadata URLs to five cards", () => {
    process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";
    expect(corePackNftMetadataUri({
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 4,
      paymentSignature: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
    })).toContain("cards=5");
  });

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
      cardCount: 5,
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
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, "base64"));
    const message = transaction.compileMessage();
    const accountKeys = message.accountKeys.map((key) => key.toBase58());
    const instructions = message.instructions.map((ix) => ({
      program: accountKeys[ix.programIdIndex],
      accounts: ix.accounts.map((index) => accountKeys[index]),
    }));
    const createDestinationAta = instructions.find((ix) => ix.program === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const tokenTransfer = instructions.find((ix) => (
      ix.program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
      && ix.accounts.includes(sourceTokenAccountAddress)
      && ix.accounts.includes(ownerWalletAddress)
    ));

    expect(transaction.signatures[0]?.signature).toBeNull();
    expect(transaction.signatures.some((signature) => signature.signature != null)).toBe(true);
    expect(instructions.map((ix) => ix.program)).toEqual(expect.arrayContaining([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
    ]));
    expect(createDestinationAta?.accounts[0]).toBe(ownerWalletAddress);
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
