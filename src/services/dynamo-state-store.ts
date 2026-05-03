import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { QuizState } from "../types.js";
import type { StateStoreLike } from "./state-store.js";

/**
 * DynamoDB-backed state store. One item per session, primary key = sessionId.
 *
 * Why DynamoDB over the JSON-file default:
 *  - Survives machine replacement. JSON state is local to one container
 *    filesystem; DynamoDB gives the Fly app hosted persistence without
 *    coupling state to the machine lifecycle.
 *  - Per-session writes. Each mutation touches one item, not the whole
 *    snapshot — a player picking an answer doesn't rewrite every other
 *    player's character.
 *  - Auto-expiry via TTL. Idle sessions roll off the table without manual
 *    cleanup; configure with RUBY_HIGH_STATE_TTL_SECONDS (default: 90 days).
 *
 * Table schema (the deploy provisions this; not created by code):
 *   - PK:   pk (string) — sessionId, e.g. "rh:user:<token>" or "rh:anonymous"
 *   - Attrs: state (map), updatedAt (number, ms), expiresAt (number, seconds)
 *   - TTL attribute: expiresAt (configured on the table)
 *   - On-demand billing recommended (bursty traffic, predictable item size)
 */

export interface DynamoStateStoreOptions {
  /** DynamoDB table name. Required. */
  tableName: string;
  /** AWS region. Defaults to AWS_REGION env. */
  region?: string;
  /** TTL in seconds — items expire this long after the last write. 0 disables. */
  ttlSeconds?: number;
  /** Pre-built doc client — used by tests to inject a fake without touching AWS. */
  client?: DynamoDBDocumentClientLike;
}

/** Minimal interface so tests can mock the SDK without depending on the
 *  full DynamoDBDocumentClient surface. */
export interface DynamoDBDocumentClientLike {
  send(command: unknown): Promise<unknown>;
}

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export class DynamoStateStore implements StateStoreLike {
  private readonly client: DynamoDBDocumentClientLike;
  private readonly tableName: string;
  private readonly ttlSeconds: number;
  private readonly region: string;

  constructor(opts: DynamoStateStoreOptions) {
    if (!opts.tableName) throw new Error("DynamoStateStore: tableName is required");
    this.tableName = opts.tableName;
    this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const ddb = new DynamoDBClient({ region: this.region });
      this.client = DynamoDBDocumentClient.from(ddb, {
        marshallOptions: {
          // Convert undefined → no attribute. Without this, undefined fields
          // (optional schema parts like flavorQuote, pendingRoll on legacy
          // states) make Put fail.
          removeUndefinedValues: true,
          convertEmptyValues: false,
        },
      });
    }
  }

  async load(): Promise<Map<string, QuizState>> {
    const map = new Map<string, QuizState>();
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      // Scan is fine at this scale (a few thousand sessions); past that,
      // switch to a GSI on updatedAt or move to a real DB.
      const result = (await this.client.send(new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      }))) as { Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> };
      for (const item of result.Items ?? []) {
        const state = item.state as QuizState | undefined;
        if (state && typeof state.sessionId === "string") {
          map.set(state.sessionId, state);
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return map;
  }

  async saveSession(state: QuizState): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: this.toItem(state),
    }));
  }

  /** Bulk write — used by tests / migrations. Chunks at 25 (BatchWrite cap). */
  async save(states: Iterable<QuizState>): Promise<void> {
    const items = Array.from(states);
    if (items.length === 0) return;
    const CHUNK = 25;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: chunk.map((state) => ({
            PutRequest: { Item: this.toItem(state) },
          })),
        },
      }));
      // Note: BatchWriteCommand can return UnprocessedItems on throttle.
      // For current scale we accept it; production-grade retry is a future
      // PR if it ever bites.
    }
  }

  describe(): string {
    return `dynamodb://${this.region}/${this.tableName}`;
  }

  private toItem(state: QuizState): Record<string, unknown> {
    const item: Record<string, unknown> = {
      pk: state.sessionId,
      state,
      updatedAt: state.updatedAt ?? Date.now(),
    };
    if (this.ttlSeconds > 0) {
      // DynamoDB TTL expects seconds-since-epoch on the configured attribute.
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    return item;
  }
}
