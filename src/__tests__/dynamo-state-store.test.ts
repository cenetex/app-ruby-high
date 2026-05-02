import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BatchWriteCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoStateStore, type DynamoDBDocumentClientLike } from "../services/dynamo-state-store.js";
import type { QuizState } from "../types.js";

/**
 * In-memory fake of the DynamoDBDocumentClient. Stores items by primary key,
 * recognizes the three commands DynamoStateStore actually uses, and records
 * every command sent so tests can assert on shape (TableName, TTL, etc.).
 */
class FakeDdbDocClient implements DynamoDBDocumentClientLike {
  /** All items, keyed by pk for fast lookup. */
  private items = new Map<string, Record<string, unknown>>();
  /** Commands the store sent us, in order. */
  public readonly sent: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (command instanceof PutCommand) {
      const { Item } = (command as PutCommand).input;
      if (!Item) throw new Error("PutCommand missing Item");
      this.items.set(String(Item.pk), Item);
      return {};
    }
    if (command instanceof BatchWriteCommand) {
      const req = (command as BatchWriteCommand).input.RequestItems ?? {};
      for (const [, ops] of Object.entries(req)) {
        for (const op of ops as Array<{ PutRequest?: { Item?: Record<string, unknown> } }>) {
          if (op.PutRequest?.Item) {
            this.items.set(String(op.PutRequest.Item.pk), op.PutRequest.Item);
          }
        }
      }
      return {};
    }
    if (command instanceof ScanCommand) {
      // Single-page response — DynamoStateStore.load() handles pagination
      // but we don't bother emulating it for unit tests at this size.
      return { Items: Array.from(this.items.values()) };
    }
    throw new Error(`FakeDdbDocClient: unhandled command ${command?.constructor?.name}`);
  }

  /** Test helper. Direct access to the synthetic table contents. */
  snapshot(): Map<string, Record<string, unknown>> {
    return new Map(this.items);
  }
}

function blankState(sessionId: string, updatedAt = 1): QuizState {
  return {
    sessionId,
    faculty: "ruby",
    subject: null,
    current: null,
    history: [],
    score: { correct: 0, total: 0 },
    lastReveal: null,
    status: "idle",
    askedQuestionIds: [],
    currentGrade: null,
    completedGrades: [],
    gradeProgress: {},
    hasSeenIntro: false,
    character: null,
    npcRosters: {},
    activeRound: null,
    pendingRoll: null,
    updatedAt,
  };
}

describe("DynamoStateStore", () => {
  let fake: FakeDdbDocClient;
  let store: DynamoStateStore;

  beforeEach(() => {
    fake = new FakeDdbDocClient();
    store = new DynamoStateStore({
      tableName: "ruby-high-test",
      region: "us-east-1",
      ttlSeconds: 60 * 60, // 1 hour
      client: fake,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructor rejects an empty tableName", () => {
    expect(() => new DynamoStateStore({ tableName: "", client: fake })).toThrow(/tableName/);
    // @ts-expect-error — runtime check for missing arg
    expect(() => new DynamoStateStore({ client: fake })).toThrow(/tableName/);
  });

  it("describe() returns a stable identifier", () => {
    expect(store.describe()).toBe("dynamodb://us-east-1/ruby-high-test");
  });

  it("saveSession() puts a single item with the right shape", async () => {
    const before = Math.floor(Date.now() / 1000);
    await store.saveSession(blankState("rh:user:abc", 1234));
    const items = fake.snapshot();
    expect(items.size).toBe(1);
    const item = items.get("rh:user:abc")!;
    expect(item.pk).toBe("rh:user:abc");
    expect(item.updatedAt).toBe(1234);
    expect(typeof item.expiresAt).toBe("number");
    // expiresAt must be ~1h ahead of "now" (in seconds).
    const expires = item.expiresAt as number;
    expect(expires).toBeGreaterThanOrEqual(before + 60 * 60 - 5);
    expect(expires).toBeLessThanOrEqual(before + 60 * 60 + 5);
    // The original QuizState is preserved verbatim under `state`.
    expect((item.state as QuizState).sessionId).toBe("rh:user:abc");
  });

  it("saveSession() omits expiresAt when ttlSeconds is 0", async () => {
    const noTtl = new DynamoStateStore({ tableName: "t", client: fake, ttlSeconds: 0 });
    await noTtl.saveSession(blankState("rh:no-ttl"));
    const item = fake.snapshot().get("rh:no-ttl")!;
    expect(item.expiresAt).toBeUndefined();
  });

  it("saveSession() upserts on the same pk", async () => {
    await store.saveSession(blankState("rh:user:abc", 1));
    await store.saveSession(blankState("rh:user:abc", 2));
    expect(fake.snapshot().size).toBe(1);
    const item = fake.snapshot().get("rh:user:abc")!;
    expect(item.updatedAt).toBe(2);
  });

  it("save() chunks a >25-session iterable into multiple BatchWrite calls", async () => {
    const states: QuizState[] = [];
    for (let i = 0; i < 60; i++) states.push(blankState(`rh:bulk:${i}`));
    await store.save(states);
    // 60 / 25 = 3 batches.
    const batches = fake.sent.filter((c) => c instanceof BatchWriteCommand);
    expect(batches.length).toBe(3);
    // All 60 ended up in the table.
    expect(fake.snapshot().size).toBe(60);
  });

  it("save() with an empty iterable is a no-op", async () => {
    await store.save([]);
    expect(fake.sent.length).toBe(0);
    expect(fake.snapshot().size).toBe(0);
  });

  it("load() round-trips items written by saveSession", async () => {
    const a = blankState("rh:a", 100);
    const b = blankState("rh:b", 200);
    await store.saveSession(a);
    await store.saveSession(b);
    const loaded = await store.load();
    expect(loaded.size).toBe(2);
    expect(loaded.get("rh:a")?.updatedAt).toBe(100);
    expect(loaded.get("rh:b")?.updatedAt).toBe(200);
  });

  it("load() ignores items missing a state attribute (defensive)", async () => {
    // Inject a malformed item directly into the fake table.
    (fake as unknown as { items: Map<string, Record<string, unknown>> }).items.set(
      "broken",
      { pk: "broken", updatedAt: 1 }, // no `state` attr
    );
    await store.saveSession(blankState("ok"));
    const loaded = await store.load();
    expect(loaded.has("ok")).toBe(true);
    expect(loaded.has("broken")).toBe(false);
  });

  it("uses the configured TableName on every command", async () => {
    await store.saveSession(blankState("a"));
    await store.save([blankState("b"), blankState("c")]);
    await store.load();
    for (const cmd of fake.sent) {
      const input = (cmd as { input?: { TableName?: string; RequestItems?: Record<string, unknown> } }).input;
      if (input?.TableName) expect(input.TableName).toBe("ruby-high-test");
      if (input?.RequestItems) {
        expect(Object.keys(input.RequestItems)).toEqual(["ruby-high-test"]);
      }
    }
  });

  it("preserves QuizState fields verbatim through round-trip", async () => {
    const rich = blankState("rh:rich", 999);
    rich.score = { correct: 7, total: 12 };
    rich.askedQuestionIds = ["q1", "q2", "q3"];
    rich.character = {
      name: "Pip",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "if i miss one i replay it for a week",
      flavorQuote: "honestly the syllabus is bullying me",
      personality: "—",
      xp: 4,
      strings: { sally: 1 },
      conditions: [],
      yearbook: [],
      createdAt: 555,
    };
    await store.saveSession(rich);
    const loaded = await store.load();
    const back = loaded.get("rh:rich");
    expect(back).toBeDefined();
    expect(back!.score).toEqual({ correct: 7, total: 12 });
    expect(back!.askedQuestionIds).toEqual(["q1", "q2", "q3"]);
    expect(back!.character?.flavorQuote).toBe("honestly the syllabus is bullying me");
    expect(back!.character?.strings.sally).toBe(1);
  });
});
