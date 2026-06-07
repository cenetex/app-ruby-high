import { StateStore, type StateStoreLike } from "./state-store.js";
import { DynamoStateStore } from "./dynamo-state-store.js";

/**
 * Pick a state-store backend based on env vars (or explicit opts in tests).
 *
 * Default: JSON file at ~/.ruby-high/state.json — preserves existing local
 * dev behavior.
 *
 * To use SQLite (recommended for Fly; no AWS):
 *   RUBY_HIGH_STORE_BACKEND=sqlite
 *   RUBY_HIGH_STATE_PATH=/data/ruby-high.db   (MUST be on a mounted Fly Volume)
 *   RUBY_HIGH_STATE_TTL_SECONDS=7776000       (optional; default 90 days)
 *
 * To use DynamoDB (legacy; being retired — see docs/aws-exit-migration.md):
 *   RUBY_HIGH_STORE_BACKEND=dynamodb
 *   RUBY_HIGH_DYNAMO_TABLE=ruby-high-state
 *   AWS_REGION=us-east-1
 */
export interface CreateStateStoreOptions {
  /** Override env-var detection. "json" | "sqlite" | "dynamodb". */
  backend?: "json" | "sqlite" | "dynamodb";
  /** JSON-file backend: state.json path. */
  jsonPath?: string;
  /** SQLite backend: database file path. */
  sqlitePath?: string;
  /** DynamoDB backend: table name. */
  dynamoTable?: string;
  /** DynamoDB backend: region. */
  region?: string;
  /** TTL seconds (SQLite + DynamoDB). 0 disables. */
  ttlSeconds?: number;
}

export async function createStateStore(opts: CreateStateStoreOptions = {}): Promise<StateStoreLike> {
  const backend = opts.backend ?? readBackend(process.env.RUBY_HIGH_STORE_BACKEND);
  if (backend === "sqlite") {
    const path = opts.sqlitePath ?? process.env.RUBY_HIGH_STATE_PATH;
    if (!path) {
      throw new Error(
        "RUBY_HIGH_STORE_BACKEND=sqlite requires RUBY_HIGH_STATE_PATH (e.g. /data/ruby-high.db on a Fly Volume).",
      );
    }
    const { SqliteStateStore } = await import("./sqlite-state-store.js");
    return new SqliteStateStore({
      path,
      ttlSeconds: opts.ttlSeconds ?? readTtl(process.env.RUBY_HIGH_STATE_TTL_SECONDS),
    });
  }
  if (backend === "dynamodb") {
    const tableName = opts.dynamoTable ?? process.env.RUBY_HIGH_DYNAMO_TABLE;
    if (!tableName) {
      throw new Error(
        "RUBY_HIGH_STORE_BACKEND=dynamodb requires RUBY_HIGH_DYNAMO_TABLE to be set.",
      );
    }
    return new DynamoStateStore({
      tableName,
      region: opts.region ?? process.env.AWS_REGION,
      ttlSeconds: opts.ttlSeconds ?? readTtl(process.env.RUBY_HIGH_STATE_TTL_SECONDS),
    });
  }
  return new StateStore(opts.jsonPath);
}

function readBackend(raw: string | undefined): "json" | "sqlite" | "dynamodb" {
  if (!raw) return "json";
  const v = raw.trim().toLowerCase();
  if (v === "dynamodb" || v === "dynamo" || v === "ddb") return "dynamodb";
  if (v === "sqlite" || v === "sqlite3") return "sqlite";
  if (v === "json" || v === "file") return "json";
  // Unknown values fall back to json so misconfiguration doesn't take down
  // the host. Log so operators can spot the typo.
  // eslint-disable-next-line no-console
  console.warn(`[ruby-high] unknown RUBY_HIGH_STORE_BACKEND="${raw}", defaulting to json.`);
  return "json";
}

function readTtl(raw: string | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    // eslint-disable-next-line no-console
    console.warn(`[ruby-high] invalid RUBY_HIGH_STATE_TTL_SECONDS="${raw}", using default.`);
    return undefined;
  }
  return n;
}
