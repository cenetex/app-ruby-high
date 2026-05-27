import { afterEach, describe, expect, it, vi } from "vitest";
import { coreCollectionMetadataUriForMint } from "../services/core-pack-nfts.js";
import { hallPassCollectionMetadataUriForMint } from "../services/hall-pass-nfts.js";
import {
  durableNftMetadataUri,
  publicNftMetadataStorageStatus,
  setNftMetadataUploaderForTest,
} from "../services/nft-metadata-storage.js";

let restoreUploader: (() => void) | null = null;

afterEach(() => {
  restoreUploader?.();
  restoreUploader = null;
});

describe("NFT metadata storage", () => {
  it("reports app-hosted metadata as non-durable", () => {
    expect(publicNftMetadataStorageStatus({})).toEqual({
      mode: "app-hosted",
      durable: false,
      configured: true,
    });
  });

  it("reports durable metadata configuration problems without exposing secrets", () => {
    expect(publicNftMetadataStorageStatus({ RUBY_HIGH_NFT_METADATA_STORAGE: "arweave" })).toMatchObject({
      mode: "arweave",
      durable: true,
      configured: false,
      gateway: "https://arweave.net",
      reason: expect.stringContaining("no Arweave JWK secret"),
    });
    expect(publicNftMetadataStorageStatus({ RUBY_HIGH_NFT_METADATA_STORAGE: "irys-solana" })).toEqual({
      mode: "irys-solana",
      durable: false,
      configured: false,
      reason: "Unsupported NFT metadata storage mode \"irys-solana\".",
    });
  });

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
      env: { RUBY_HIGH_NFT_METADATA_STORAGE: "arweave" },
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

  it("uploads collection metadata for new canonical collection creation", async () => {
    const uploader = vi.fn(async ({ assetKey }) => `https://arweave.net/${assetKey.replaceAll("/", "-")}`);
    restoreUploader = setNftMetadataUploaderForTest(uploader);
    const env = {
      RUBY_HIGH_NFT_METADATA_STORAGE: "arweave",
      RUBY_HIGH_PUBLIC_BASE_URL: "https://ruby-high.ai",
    };

    await expect(hallPassCollectionMetadataUriForMint(env)).resolves.toBe(
      "https://arweave.net/api-apps-ruby-high-nft-metadata-hall-pass-collection.json",
    );
    await expect(coreCollectionMetadataUriForMint(env)).resolves.toBe(
      "https://arweave.net/api-apps-ruby-high-nft-metadata-core-collection.json",
    );

    expect(uploader).toHaveBeenCalledWith(expect.objectContaining({
      assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/collection.json",
      fallbackUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/hall-pass/collection.json",
      metadata: expect.objectContaining({ name: "Ruby High: First Bell" }),
    }));
    expect(uploader).toHaveBeenCalledWith(expect.objectContaining({
      assetKey: "api/apps/ruby-high/nft/metadata/core/collection.json",
      fallbackUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/collection.json",
      metadata: expect.objectContaining({ name: "Ruby High: First Bell Packs" }),
    }));
  });

  it("rejects unsupported durable metadata modes", async () => {
    await expect(durableNftMetadataUri({
      fallbackUri: "https://ruby-high.ai/card.json",
      assetKey: "api/apps/ruby-high/nft/metadata/hall-pass/lyra/1.json",
      metadata: { name: "Ruby High: Lyra #1" },
      env: { RUBY_HIGH_NFT_METADATA_STORAGE: "irys-solana" },
    })).rejects.toThrow(/Unsupported NFT metadata storage mode/);
  });
});
