import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Test #7: json/dynamo backends don't require node:sqlite.
//
// state-store-factory.ts line 1 statically imports SqliteStateStore,
// which pulls in node:sqlite. This means ANY import of the factory
// crashes on runtimes without node:sqlite (Cloudflare Workers, older
// Node, edge runtimes), even when backend=json or backend=dynamodb.
//
// The fix is to make SqliteStateStore a dynamic import (lazy-loaded
// only when backend=sqlite).

const srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../services/state-store-factory.ts",
);
const src = readFileSync(srcPath, "utf8");

describe("state-store-factory — no node:sqlite requirement", () => {
  it("does not statically import sqlite-state-store", () => {
    // FAILS: line 3 has `import { SqliteStateStore } from "./sqlite-state-store.js";`
    const hasStaticSqliteImport = /^import\s+.*sqlite-state-store/m.test(src);
    expect(hasStaticSqliteImport).toBe(false);
  });

  it("only loads sqlite-state-store dynamically when backend=sqlite", () => {
    // The dynamic import path must exist for the sqlite backend.
    const hasDynamicImport = /import\(.*sqlite-state-store/.test(src);
    expect(hasDynamicImport).toBe(true);
  });
});
