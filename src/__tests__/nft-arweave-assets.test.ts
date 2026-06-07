import { describe, expect, it } from "vitest";
import { nftImageUri, normalizeNftAssetPath } from "../services/nft-arweave-assets.js";

describe("NFT Arweave image resolver", () => {
  it("normalizes Ruby High asset paths before manifest lookup", () => {
    expect(normalizeNftAssetPath("/api/apps/ruby-high/assets/nft/cards/ravi.png?v=card-v2")).toBe(
      "api/apps/ruby-high/assets/nft/cards/ravi.png",
    );
    expect(normalizeNftAssetPath("https://ruby-high.ai/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2")).toBe(
      "api/apps/ruby-high/assets/nft/ruby-high-pack.png",
    );
  });

  it("uses Arweave when the generated manifest has the asset", () => {
    expect(nftImageUri(
      "https://ruby-high.ai/",
      "/api/apps/ruby-high/assets/nft/cards/ravi.png?v=card-v2",
      {
        "api/apps/ruby-high/assets/nft/cards/ravi.png": "https://arweave.net/raviTx",
      },
    )).toBe("https://arweave.net/raviTx");
  });

  it("falls back to app-hosted images while the manifest is empty", () => {
    expect(nftImageUri(
      "https://ruby-high.ai/",
      "/api/apps/ruby-high/assets/nft/cards/ravi.png?v=card-v2",
      {},
    )).toBe("https://ruby-high.ai/api/apps/ruby-high/assets/nft/cards/ravi.png?v=card-v2");
  });
});
