import { afterEach, describe, expect, it, vi } from "vitest";
import {
  durableNftMetadataUri,
  setNftMetadataUploaderForTest,
} from "../services/nft-metadata-storage.js";

let restoreUploader: (() => void) | null = null;

afterEach(() => {
  restoreUploader?.();
  restoreUploader = null;
});

describe("NFT metadata storage", () => {
  it("keeps app-hosted metadata unless durable storage is enabled", async () => {
    const uploader = vi.fn(async () => "https://arweave.net/uploaded-json");
    restoreUploader = setNftMetadataUploaderForTest(uploader);

    await expect(durableNftMetadataUri({
      fallbackUri: "https://ruby-high.ai/card.json",
      assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/lyra/1.json",
      metadata: { name: "Ruby High: Lyra #1" },
      env: {},
    })).resolves.toBe("https://ruby-high.ai/card.json");
    expect(uploader).not.toHaveBeenCalled();
  });

  it("uploads stable JSON when durable storage is enabled", async () => {
    const uploader = vi.fn(async () => "https://arweave.net/uploaded-json");
    restoreUploader = setNftMetadataUploaderForTest(uploader);

    await expect(durableNftMetadataUri({
      fallbackUri: "https://ruby-high.ai/card.json",
      assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/lyra/1.json",
      metadata: { symbol: "RUBY", name: "Ruby High: Lyra #1" },
      env: { RUBY_HIGH_NFT_METADATA_STORAGE: "irys-solana" },
    })).resolves.toBe("https://arweave.net/uploaded-json");

    expect(uploader).toHaveBeenCalledWith(expect.objectContaining({
      assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/lyra/1.json",
      fallbackUri: "https://ruby-high.ai/card.json",
      metadataJson: "{\"name\":\"Ruby High: Lyra #1\",\"symbol\":\"RUBY\"}",
      metadataHash: expect.any(String),
    }));
  });

  it("supports direct Arweave as a durable metadata mode", async () => {
    const uploader = vi.fn(async () => "https://arweave.net/direct-arweave-json");
    restoreUploader = setNftMetadataUploaderForTest(uploader);

    await expect(durableNftMetadataUri({
      fallbackUri: "https://ruby-high.ai/pack.json",
      assetKey: "api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.opened.json",
      metadata: { name: "Ruby High: First Bell Pack #123456", symbol: "RUBY" },
      env: { RUBY_HIGH_NFT_METADATA_STORAGE: "arweave" },
    })).resolves.toBe("https://arweave.net/direct-arweave-json");

    expect(uploader).toHaveBeenCalledWith(expect.objectContaining({
      assetKey: "api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.opened.json",
      fallbackUri: "https://ruby-high.ai/pack.json",
      metadataJson: "{\"name\":\"Ruby High: First Bell Pack #123456\",\"symbol\":\"RUBY\"}",
    }));
  });
});
