import { afterEach, describe, expect, it, vi } from "vitest";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Transaction } from "@solana/web3.js";
import {
  buildCorePackPurchaseTransaction,
  corePackAssetPluginsForMint,
  corePackNftMetadataUri,
  fetchOwnedCorePackNfts,
} from "../services/core-pack-nfts.js";

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
  it("adds creator and attribute plugins to Core pack assets", () => {
    const umi = createUmi("https://rpc.test");
    const authority = umi.eddsa.generateKeypair();

    expect(corePackAssetPluginsForMint({
      authorityAddress: String(authority.publicKey),
      productId: "card-pack-3",
      packCount: 3,
      cardCount: 12,
      serial: "123456",
    })).toEqual([
      {
        type: "VerifiedCreators",
        signatures: [{ address: authority.publicKey, verified: true }],
      },
      {
        type: "Attributes",
        attributeList: [
          { key: "School", value: "Ruby High" },
          { key: "Collection", value: "Ruby High Packs" },
          { key: "Type", value: "Pack" },
          { key: "Product", value: "card-pack-3" },
          { key: "Packs", value: "3" },
          { key: "Cards Inside", value: "15" },
          { key: "Serial", value: "123456" },
        ],
      },
    ]);
  });

  it("normalizes legacy one-pack metadata URLs to five cards", () => {
    process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";
    expect(corePackNftMetadataUri({
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 4,
      paymentSignature: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
    })).toContain("cards=5");
  });

  it("builds one wallet-only transaction with a RUBY transfer", async () => {
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
    expect(transaction.signatures.some((signature) => signature.signature != null)).toBe(false);
    expect(instructions.map((ix) => ix.program)).toEqual(expect.arrayContaining([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    ]));
    expect(instructions.map((ix) => ix.program)).not.toContain("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
    expect(createDestinationAta?.accounts[0]).toBe(ownerWalletAddress);
    expect(tokenTransfer).toBeTruthy();
    expect(tokenTransfer?.accounts).toEqual(expect.arrayContaining([
      sourceTokenAccountAddress,
      prepared.destinationTokenAccountAddress,
      ownerWalletAddress,
      paymentReference,
    ]));
    expect(prepared.assetAddress).toBeUndefined();
  });

  it("syncs owned Core packs from DAS owner lookups", async () => {
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_SOLANA_RPC_URL = "https://beta.helius-rpc.com/?api-key=test";
    const ownerWalletAddress = "57kZQTKZivCKWThxJkFUBD3y5nx9sFXUo8kR7CRkLkMC";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-pack-sync",
      result: {
        items: [
          {
            id: "52soGWdda9qFYBawS89Ho23JPCZuKPmb6N1ZP3bsPmd3",
            burnt: false,
            content: {
              json_uri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5",
              metadata: { name: "Ruby High Pack #570329" },
            },
            ownership: { owner: ownerWalletAddress },
            grouping: [
              { group_key: "collection", group_value: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q" },
            ],
          },
        ],
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const owned = await fetchOwnedCorePackNfts(ownerWalletAddress);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(owned).toEqual([expect.objectContaining({
      ownerWalletAddress,
      assetAddress: "52soGWdda9qFYBawS89Ho23JPCZuKPmb6N1ZP3bsPmd3",
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      serial: 570329,
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5",
    })]);
  });
});
