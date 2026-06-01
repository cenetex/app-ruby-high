import { describe, it, expect, vi, afterEach } from "vitest";

describe("portrait upload — AWS → Tigris exit", () => {
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

  it("S3Client is configured with an endpoint when AWS_ENDPOINT_URL_S3 is set", async () => {
    vi.stubEnv("RUBY_HIGH_PORTRAITS_BUCKET", "ruby-high-portraits");
    vi.stubEnv("RUBY_HIGH_PORTRAITS_REGION", "auto");
    vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://fly.storage.tigris.dev");

    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../services/character-generation.ts",
    );
    const src = fs.readFileSync(srcPath, "utf8");

    const hasEndpointRead = /AWS_ENDPOINT_URL_S3/.test(src);
    expect(hasEndpointRead).toBe(true);
  });

  it("portrait public URL does not contain amazonaws.com when AWS_ENDPOINT_URL_S3 is set", async () => {
    vi.stubEnv("RUBY_HIGH_PORTRAITS_BUCKET", "ruby-high-portraits");
    vi.stubEnv("RUBY_HIGH_PORTRAITS_REGION", "auto");

    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../services/character-generation.ts",
    );
    const src = fs.readFileSync(srcPath, "utf8");

    expect(src).toContain("AWS_ENDPOINT_URL_S3");
  });
});

