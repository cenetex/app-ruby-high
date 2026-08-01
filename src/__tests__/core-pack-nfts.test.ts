import { afterEach, describe, expect, it, vi } from "vitest";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Transaction } from "@solana/web3.js";
import {
  buildCorePackPurchaseTransaction,
  corePackAssetPluginsForMint,
  corePackOpenedNftMetadataUri,
  corePackNftMetadataUri,
  fetchOwnedCorePackNfts,
} from "../services/core-pack-nfts.js";
import { FIRST_BELL_SET_CODE, FIRST_BELL_SET_NAME } from "../services/hall-pass-card-catalog.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS: process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS,
  RUBY_HIGH_SOLANA_RPC_URL: process.env.RUBY_HIGH_SOLANA_RPC_URL,
  RUBY_HIGH_PUBLIC_BASE_URL: process.env.RUBY_HIGH_PUBLIC_BASE_URL,
  RUBY_HIGH_NFT_METADATA_STORAGE: process.env.RUBY_HIGH_NFT_METADATA_STORAGE,
  RUBY_HIGH_NFT_METADATA_ARWEAVE_JWK: process.env.RUBY_HIGH_NFT_METADATA_ARWEAVE_JWK,
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
          { key: "Collection", value: `${FIRST_BELL_SET_NAME} Packs` },
          { key: "Set", value: "First Bell" },
          { key: "Set Code", value: FIRST_BELL_SET_CODE },
          { key: "NFT Type", value: "Pack" },
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

  it("builds an opened pack metadata URL that forces opened imagery", () => {
    process.env.RUBY_HIGH_PUBLIC_BASE_URL = "https://ruby-high.ai";

    expect(corePackOpenedNftMetadataUri({
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 4,
      serial: 570329,
    })).toBe("https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5&opened=1");
  });

  it("builds one wallet-paid transaction with a native SOL transfer and Core pack mint", async () => {
    const umi = createUmi("https://rpc.test");
    const authority = umi.eddsa.generateKeypair();
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(authority.secretKey));
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_SOLANA_RPC_URL = "https://rpc.test";
    const ownerWalletAddress = "AEfDYvgUixKzgBGJZ48tPgrW33kz2Gx6qDTXXDNDNX7";
    const solRecipient = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const paymentReference = "5zs9ABUJ3bmLCiGTvuk7by7JnaMfqT3QqetdkmFxLXZD";

    const prepared = await buildCorePackPurchaseTransaction({
      productId: "card-pack-1",
      packCount: 1,
      cardCount: 5,
      ownerWalletAddress,
      paymentReference,
      solRecipient,
      solAmount: "0.01",
      priceLamports: "10000000",
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
    const solTransfer = instructions.find((ix) => (
      ix.program === "11111111111111111111111111111111"
      && ix.accounts.includes(ownerWalletAddress)
      && ix.accounts.includes(solRecipient)
    ));

    expect(transaction.signatures[0]?.signature).toBeNull();
    expect(transaction.signatures.some((signature) => signature.signature != null)).toBe(true);
    expect(instructions.map((ix) => ix.program)).toEqual(expect.arrayContaining([
      "11111111111111111111111111111111",
      "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
    ]));
    expect(instructions.map((ix) => ix.program)).not.toContain("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(solTransfer).toBeTruthy();
    expect(solTransfer?.accounts).toEqual(expect.arrayContaining([
      ownerWalletAddress,
      solRecipient,
      paymentReference,
    ]));
    expect(prepared.assetAddress).toEqual(expect.any(String));
    expect(prepared.metadataUri).toContain("/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/");
    expect(prepared.metadataUri).toContain("cards=5");
    expect(accountKeys).toContain(prepared.assetAddress);
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
      opened: false,
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5",
    })]);
  });

  it("marks already-opened Core packs from their on-chain metadata", async () => {
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_SOLANA_RPC_URL = "https://beta.helius-rpc.com/?api-key=test";
    const ownerWalletAddress = "57kZQTKZivCKWThxJkFUBD3y5nx9sFXUo8kR7CRkLkMC";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "ruby-high-pack-sync-opened",
      result: {
        items: [
          {
            id: "52soGWdda9qFYBawS89Ho23JPCZuKPmb6N1ZP3bsPmd3",
            burnt: false,
            content: {
              json_uri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/570329.json?packs=1&cards=5&opened=1",
              metadata: {
                name: "Ruby High Pack #570329",
                attributes: [{ trait_type: "State", value: "Opened" }],
              },
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

    expect(owned).toEqual([expect.objectContaining({
      ownerWalletAddress,
      assetAddress: "52soGWdda9qFYBawS89Ho23JPCZuKPmb6N1ZP3bsPmd3",
      opened: true,
    })]);
  });

  it("skips malformed Core pack metadata URLs during DAS sync", async () => {
    process.env.RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS = "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q";
    process.env.RUBY_HIGH_SOLANA_RPC_URL = "https://beta.helius-rpc.com/?api-key=test";
    const ownerWalletAddress = "57kZQTKZivCKWThxJkFUBD3y5nx9sFXUo8kR7CRkLkMC";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init && typeof init === "object" && init.method === "POST") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: "ruby-high-pack-sync",
          result: {
            items: [
              {
                id: "BadMetadata111111111111111111111111111111",
                burnt: false,
                content: {
                  json_uri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/%E0%A4%A.json?packs=1&cards=5",
                  metadata: { name: "Ruby High Pack #bad" },
                },
                ownership: { owner: ownerWalletAddress },
                grouping: [
                  { group_key: "collection", group_value: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q" },
                ],
              },
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
        });
      }
      return new Response("metadata unavailable", { status: 404 });
    });

    const owned = await fetchOwnedCorePackNfts(ownerWalletAddress);

    expect(fetchMock).toHaveBeenCalled();
    expect(owned).toEqual([expect.objectContaining({
      assetAddress: "52soGWdda9qFYBawS89Ho23JPCZuKPmb6N1ZP3bsPmd3",
      serial: 570329,
    })]);
  });

  it("syncs owned Core packs whose metadata URI is durable Arweave JSON", async () => {
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
              json_uri: "https://arweave.net/ruby-high-pack-json",
              metadata: {
                name: "Ruby High: First Bell 3-Pack #456789",
                attributes: [
                  { trait_type: "Packs", value: "3" },
                  { trait_type: "Cards Inside", value: "15" },
                  { trait_type: "Serial", value: "456789" },
                  { trait_type: "State", value: "Sealed" },
                ],
              },
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
      productId: "card-pack-3",
      packCount: 3,
      cardCount: 15,
      serial: 456789,
      opened: false,
      metadataUri: "https://arweave.net/ruby-high-pack-json",
    })]);
  });
});
