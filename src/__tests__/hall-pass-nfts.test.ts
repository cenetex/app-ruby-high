import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertHallPassMintAuthorityCapacity,
  hallPassCardCollectionForMint,
  hallPassCardOnChainNameForMint,
  setHallPassNftAuthorityBalanceForTest,
  verifyHallPassCardBurn,
} from "../services/hall-pass-nfts.js";

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
  it("uses branded, market-friendly on-chain card names within Token Metadata limits", () => {
    expect(hallPassCardOnChainNameForMint({ characterName: "Mika", serial: 823842 } as any)).toBe("Mika Ruby High Card #823842");
    expect(hallPassCardOnChainNameForMint({ characterName: "Library Card", serial: 254854 } as any)).toBe("Ruby High: Library Card #254854");
    expect(hallPassCardOnChainNameForMint({ characterName: "Professor Edward", serial: 424242 } as any)).toBe("Ruby High: Prof. Edward #424242");

    for (const characterName of ["Mika", "Library Card", "Professor Edward", "Captain Null"]) {
      expect(hallPassCardOnChainNameForMint({ characterName, serial: 424242 } as any).length).toBeLessThanOrEqual(32);
    }
  });

  it("sets an unverified Token Metadata collection at create time for later verification", () => {
    expect(hallPassCardCollectionForMint(undefined)).toBeNull();
    expect(hallPassCardCollectionForMint("Bu43twu7FsZUHVnYLWuAHLGzseSywm6uHTcD6EDAcX8Q")).toMatchObject({
      key: "Bu43twu7FsZUHVnYLWuAHLGzseSywm6uHTcD6EDAcX8Q",
      verified: false,
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
