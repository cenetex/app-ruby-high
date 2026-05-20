import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyHallPassCardBurn } from "../services/hall-pass-nfts.js";

const ORIGINAL_ENV = {
  RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY: process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY,
  RUBY_HIGH_SOLANA_NFT_RPC_URL: process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL,
};

const OWNER = "57kZQTKZivCKWThxJkFUBD3y5nx9sFXUo8kR7CRkLkMC";
const MINT = "BgVZqawE7eBunbwHh7r9NNtaftRo3FHeqcFFZoteBhSh";
const SIGNATURE = "5UYZSy27Jo9Fca56cxga1ZqRiPMZYAFt5HeTT9qbmSWRxWqukQiEAJFKRpX9HzzPj1GAFih42hLSZJKynr9Z3MEr";

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("verifyHallPassCardBurn", () => {
  it("accepts parsed burn instructions whose wallet is in multisigAuthority/signers", async () => {
    process.env.RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY = JSON.stringify(new Array(64).fill(1));
    process.env.RUBY_HIGH_SOLANA_NFT_RPC_URL = "https://rpc.example";
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
                parsed: {
                  type: "burn",
                  info: {
                    account: "3fefo5FWgu4h1YsCyJsyzvRbwUuTLPXKCMzhvhnRnT7c",
                    amount: "1",
                    mint: MINT,
                    multisigAuthority: OWNER,
                    signers: [OWNER],
                  },
                },
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
