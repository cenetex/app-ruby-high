import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../services/x-social-service.ts",
);
const src = readFileSync(srcPath, "utf8");

// Test #2: OAuth 1.0a nonce uses Math.random() — cryptographically weak.
describe("oauth1Nonce — cryptographic strength", () => {
  it("does not use Math.random for nonce generation", () => {
    const fnMatch = src.match(/function oauth1Nonce\(\)[^{]*\{([^}]+)\}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![1];
    // FAILS: currently uses Math.random().
    expect(fnBody).not.toContain("Math.random");
  });

  it("uses crypto.randomBytes for nonce generation", () => {
    const fnMatch = src.match(/function oauth1Nonce\(\)[^{]*\{([^}]+)\}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![1];
    const usesCrypto = /randomBytes|crypto\.random(?:Bytes|UUID|Fill)/.test(fnBody);
    // FAILS: currently Math.random, not crypto.randomBytes.
    expect(usesCrypto).toBe(true);
  });
});
