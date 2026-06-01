import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Test #5: Dynamo→SQLite migration must round-trip before backend flip.
//
// scripts/migrate-dynamo-to-sqlite.mjs now exists but is untested.
// A sample Dynamo dump must migrate and every record kind must reload
// identically. This is a data-loss gate — red until the script is proven.

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/migrate-dynamo-to-sqlite.mjs",
);
const src = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";

describe("Dynamo→SQLite migration", () => {
  it("migration script exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("migration script exports a testable function", () => {
    // FAILS: the script is CLI-only with no exported migrate() function.
    const hasExport = /export\s+(?:async\s+)?function\s+migrate/i.test(src);
    expect(hasExport).toBe(true);
  });

  it("migration script has a round-trip verification step", () => {
    // The script must verify data integrity after migration.
    const hasVerify = /verif|round.?trip|reload|compare|assert/i.test(src);
    expect(hasVerify).toBe(true);
  });
});
