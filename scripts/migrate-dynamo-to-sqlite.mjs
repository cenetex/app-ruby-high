#!/usr/bin/env node
/**
 * DynamoDB → SQLite migration for Ruby High state.
 *
 * Reads every record from the DynamoDB table specified by
 * RUBY_HIGH_DYNAMO_TABLE / AWS_REGION, writes them into a new SQLite
 * database at RUBY_HIGH_STATE_PATH (default: /data/ruby-high.db), and
 * runs a round-trip verification before reporting success.
 *
 * Usage:
 *   RUBY_HIGH_DYNAMO_TABLE=ruby-high-state \
 *   AWS_REGION=us-east-1 \
 *   RUBY_HIGH_STATE_PATH=/data/ruby-high.db \
 *   node scripts/migrate-dynamo-to-sqlite.mjs
 *
 * Optional:
 *   DRY_RUN=1               Scan + report, don't write.
 *   RUBY_HIGH_STATE_TTL_SECONDS=7776000   TTL override (default: 90 days).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "1";

const DYNAMO_TABLE = process.env.RUBY_HIGH_DYNAMO_TABLE;
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const SQLITE_PATH = process.env.RUBY_HIGH_STATE_PATH ?? "/data/ruby-high.db";
const TTL_SECONDS = readTtl(process.env.RUBY_HIGH_STATE_TTL_SECONDS);

if (!DYNAMO_TABLE) {
  console.error("RUBY_HIGH_DYNAMO_TABLE is required.");
  process.exit(1);
}

// ── DynamoDB scan ───────────────────────────────────────────────────────────

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: AWS_REGION }),
);

async function scanAll() {
  const items = [];
  let lastEvaluatedKey;
  let pages = 0;
  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: DYNAMO_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    const chunk = result.Items ?? [];
    items.push(...chunk);
    lastEvaluatedKey = result.LastEvaluatedKey;
    pages++;
    console.error(`  scanned page ${pages}: ${chunk.length} items (total ${items.length})`);
  } while (lastEvaluatedKey);
  return items;
}

// ── SQLite schema ───────────────────────────────────────────────────────────

function openSqlite() {
  if (DRY_RUN) return null;
  mkdirSync(dirname(SQLITE_PATH), { recursive: true });
  const db = new DatabaseSync(SQLITE_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      pk         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS kv_kind ON kv(kind);");
  db.exec("CREATE INDEX IF NOT EXISTS kv_expires ON kv(expires_at);");
  return db;
}

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function defaultExpiry() {
  const ttl = TTL_SECONDS ?? DEFAULT_TTL_SECONDS;
  return ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : null;
}

function put(db, pk, kind, data, updatedAt, expiresAt) {
  db.prepare(
    "INSERT OR REPLACE INTO kv (pk, kind, data, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(pk, kind, JSON.stringify(data), updatedAt ?? Date.now(), expiresAt);
}

// ── record mapping ──────────────────────────────────────────────────────────

function classifyItem(item) {
  const pk = item.pk ?? "";
  if (pk.startsWith("auth:user:")) return { kind: "authUser", data: item.authUser };
  if (pk.startsWith("auth:session:")) return { kind: "authSession", data: item.authSession };
  if (pk.startsWith("pack-installation:")) return { kind: "packInstallation", data: item.packInstallation };
  if (pk.startsWith("pack:")) return { kind: "contentPack", data: item.contentPack };
  if (pk.startsWith("draft-pack:")) return { kind: "draftPack", data: item.draftPack };
  if (pk.startsWith("teacher:")) return { kind: "teacherRecord", data: item.teacherRecord };
  if (pk.startsWith("metric-event:")) return { kind: "metricEvent", data: item.metricEvent };
  if (item.state) return { kind: "session", data: item.state };
  return null;
}

function expiresFor(kind, item, expiry) {
  // Auth sessions have their own TTL from the record.
  if (kind === "authSession" && item?.expiresAt) {
    return Math.floor(item.expiresAt / 1000);
  }
  // Auth users and pack installations don't expire.
  if (kind === "authUser" || kind === "packInstallation") return null;
  return expiry;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  return migrate();
}

export async function migrate() {
  console.error("DynamoDB → SQLite migration");
  console.error(`  source:  dynamodb://${AWS_REGION}/${DYNAMO_TABLE}`);
  console.error(`  target:  ${DRY_RUN ? "(dry run)" : `sqlite://${SQLITE_PATH}`}`);
  console.error("");

  // 1. Scan DynamoDB
  console.error("Scanning DynamoDB…");
  const items = await scanAll();
  console.error(`  total items: ${items.length}`);

  // 2. Classify
  const stats = {};
  const rows = [];
  for (const item of items) {
    const classified = classifyItem(item);
    if (!classified || !classified.data) {
      stats["skipped"] = (stats["skipped"] ?? 0) + 1;
      continue;
    }
    stats[classified.kind] = (stats[classified.kind] ?? 0) + 1;
    rows.push({
      pk: item.pk,
      kind: classified.kind,
      data: classified.data,
      updatedAt: item.updatedAt ?? Date.now(),
      expiresAt: expiresFor(classified.kind, classified.data, defaultExpiry()),
    });
  }

  console.error("\nRecord counts by kind:");
  for (const [kind, count] of Object.entries(stats).sort()) {
    console.error(`  ${kind}: ${count}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. Set DRY_RUN=0 to write.");
    return;
  }

  // 3. Write to SQLite
  console.error("\nWriting to SQLite…");
  const db = openSqlite();
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      put(db, row.pk, row.kind, row.data, row.updatedAt, row.expiresAt);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  console.error(`  wrote ${rows.length} rows`);

  // 4. Round-trip verify
  console.error("\nVerifying round-trip…");
  let ok = 0;
  let missing = 0;
  for (const row of rows) {
    const found = db
      .prepare("SELECT data FROM kv WHERE pk = ?")
      .get(row.pk);
    if (found) {
      ok++;
    } else {
      missing++;
      console.error(`  MISSING: ${row.pk}`);
    }
  }
  console.error(`  verified: ${ok} / ${rows.length} rows present`);
  if (missing > 0) {
    console.error(`  WARNING: ${missing} rows missing after write!`);
    process.exit(1);
  }

  db.close();
  console.error("\nMigration complete.");
  console.error(`\nNext: set RUBY_HIGH_STORE_BACKEND=sqlite and RUBY_HIGH_STATE_PATH=${SQLITE_PATH} in your .env, then deploy.`);
}

function readTtl(raw) {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

