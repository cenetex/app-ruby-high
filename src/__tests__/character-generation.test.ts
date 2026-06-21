import { describe, it, expect, vi, afterEach } from "vitest";

const GENERATED_PHOTO_HASH = "e68eb7327208097ea3088baab551269c";

describe("generated portrait asset URLs", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in OLD_ENV)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(OLD_ENV)) {
      process.env[k] = v;
    }
    vi.resetModules();
  });

  it("builds app-hosted URLs for generated portrait objects", async () => {
    vi.stubEnv("RUBY_HIGH_PUBLIC_BASE", "https://ruby-high.ai/");
    const { generatedPortraitAssetPath, generatedPortraitAssetUrl } = await import("../services/generated-portrait-assets.js");

    expect(generatedPortraitAssetPath("graduation-photo", GENERATED_PHOTO_HASH, "png")).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(generatedPortraitAssetUrl("graduation-photo", GENERATED_PHOTO_HASH, "png")).toBe(
      `https://ruby-high.ai/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
  });

  it("rewrites private S3 generated portrait URLs to the app asset route", async () => {
    vi.stubEnv("RUBY_HIGH_PORTRAITS_BUCKET", "ruby-high-portraits");
    const {
      rewriteGeneratedPortraitS3Url,
    } = await import("../services/generated-portrait-assets.js");

    expect(rewriteGeneratedPortraitS3Url(
      `https://ruby-high-portraits.s3.us-east-1.amazonaws.com/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    )).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
    expect(rewriteGeneratedPortraitS3Url("https://cdn.example.test/graduation-photo/elsewhere.png")).toBeNull();
  });

  it("normalizes stored private S3 generated portrait URLs", async () => {
    const { normalizeStoredImageRef } = await import("../services/ruby-high/helpers.js");

    expect(normalizeStoredImageRef(
      `https://ruby-high-portraits.s3.us-east-1.amazonaws.com/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
      "graduationPhotoImageUrl",
    )).toBe(
      `/api/apps/ruby-high/assets/generated/graduation-photo/${GENERATED_PHOTO_HASH}.png`,
    );
  });
});
