import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExchangeTransaction,
  buildSourceSaleTransaction,
  publicExchangeStatus,
} from "../services/token-exchange.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_EXCHANGE_DEFAULT_CLUSTER: process.env.RUBY_HIGH_EXCHANGE_DEFAULT_CLUSTER,
  RUBY_HIGH_EXCHANGE_DEVNET_ENABLED: process.env.RUBY_HIGH_EXCHANGE_DEVNET_ENABLED,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_MINT: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_MINT,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_ENABLED: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_ENABLED,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_TREASURY: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_TREASURY,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_PRICE_SOL: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_PRICE_SOL,
  RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_MINT_AMOUNT: process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_MINT_AMOUNT,
};

const OWNER = "B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP";
const SOURCE_MINT = "Ci6Y1UX8bY4jxn6YiogJmdCxFEu2jmZhCcG65PStpump";
const SOURCE_TOKEN_ACCOUNT = "FNhC7aog7542La3isBvGF5fd1myzahUwAyUWfoNNHhYV";

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

function mockExchangeRpc(balanceBaseUnits: string): void {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { method?: string };
    if (body.method === "getTokenAccountsByOwner") {
      return Response.json({
        jsonrpc: "2.0",
        result: {
          value: [{
            pubkey: SOURCE_TOKEN_ACCOUNT,
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: { amount: balanceBaseUnits },
                  },
                },
              },
            },
          }],
        },
      });
    }
    if (body.method === "getLatestBlockhash") {
      return Response.json({
        jsonrpc: "2.0",
        result: {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        },
      });
    }
    return Response.json({ jsonrpc: "2.0", error: { message: "unexpected method" } }, { status: 500 });
  }));
}

function mockBlockhashRpc(): void {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { method?: string };
    if (body.method === "getLatestBlockhash") {
      return Response.json({
        jsonrpc: "2.0",
        result: {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        },
      });
    }
    return Response.json({ jsonrpc: "2.0", error: { message: "unexpected method" } }, { status: 500 });
  }));
}

describe("token exchange config", () => {
  it("keeps devnet source routes disabled until source mint and enable flag are configured", () => {
    delete process.env.RUBY_HIGH_EXCHANGE_DEVNET_ENABLED;
    delete process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_MINT;

    const devnet = publicExchangeStatus().clusters.find((cluster) => cluster.id === "devnet");
    const rati = devnet?.routes.find((route) => route.id === "rati");

    expect(rati).toMatchObject({
      enabled: false,
      configured: false,
      status: "missing-config",
    });
  });

  it("defaults every route to 1000:1 and RATi OS / RATi compatibility", () => {
    const mainnet = publicExchangeStatus().clusters.find((cluster) => cluster.id === "mainnet-beta");

    expect(mainnet?.routes.map((route) => ({
      id: route.id,
      ratio: route.ratioLabel,
      compatibilityLabel: route.compatibilityLabel,
    }))).toEqual([
      { id: "ruby", ratio: "1000:1", compatibilityLabel: "RATi OS / RATi" },
      { id: "rati", ratio: "1000:1", compatibilityLabel: "RATi OS / RATi" },
      { id: "kyro", ratio: "1000:1", compatibilityLabel: "RATi OS / RATi" },
    ]);
  });

  it("builds a devnet RATi burn-to-mint transaction with fixed 1000:1 math", async () => {
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_ENABLED = "true";
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_MINT = SOURCE_MINT;
    mockExchangeRpc("2500000000");

    const quote = await buildExchangeTransaction({
      cluster: "devnet",
      routeId: "rati",
      ownerWalletAddress: OWNER,
    });

    expect(quote).toMatchObject({
      cluster: "devnet",
      routeId: "rati",
      sourceMint: SOURCE_MINT,
      sourceTokenAccountAddress: SOURCE_TOKEN_ACCOUNT,
      sourceAmountBaseUnits: "2500000000",
      destinationAmountBaseUnits: "2500000",
      chain: "solana:devnet",
    });
    const tx = Transaction.from(Buffer.from(quote.transactionBase64, "base64"));
    expect(tx.instructions).toHaveLength(2);
  });

  it("builds a devnet source-token sale transaction partial-signed by the seller", async () => {
    const seller = Keypair.generate();
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_MINT = SOURCE_MINT;
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_ENABLED = "true";
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_TREASURY = OWNER;
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_AUTHORITY_SECRET_KEY = JSON.stringify(Array.from(seller.secretKey));
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_PRICE_SOL = "0.02";
    process.env.RUBY_HIGH_EXCHANGE_DEVNET_RATI_SOURCE_SELLER_MINT_AMOUNT = "2500";
    mockBlockhashRpc();

    const status = publicExchangeStatus();
    const rati = status.clusters.find((cluster) => cluster.id === "devnet")?.routes.find((route) => route.id === "rati");
    expect(rati?.sourceSeller).toMatchObject({
      configured: true,
      enabled: true,
      sellerAuthority: seller.publicKey.toBase58(),
    });

    const sale = await buildSourceSaleTransaction({
      cluster: "devnet",
      routeId: "rati",
      ownerWalletAddress: OWNER,
    });

    expect(sale).toMatchObject({
      cluster: "devnet",
      routeId: "rati",
      sourceMint: SOURCE_MINT,
      sourceAmountBaseUnits: "2500000000",
      priceLamports: "20000000",
      sellerAuthorityAddress: seller.publicKey.toBase58(),
      chain: "solana:devnet",
    });
    const tx = Transaction.from(Buffer.from(sale.transactionBase64, "base64"));
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[1].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    const sellerSignature = tx.signatures.find((signature) => signature.publicKey.equals(seller.publicKey));
    expect(sellerSignature?.signature).toBeTruthy();
  });
});
