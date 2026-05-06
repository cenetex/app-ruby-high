import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoStateStore, type DynamoDBDocumentClientLike } from "../services/dynamo-state-store.js";
import type { QuizState } from "../types.js";
import type { ContentPack } from "../content/types.js";

/**
 * In-memory fake of the DynamoDBDocumentClient. Stores items by primary key,
 * recognizes the commands DynamoStateStore actually uses, and records
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
    if (command instanceof DeleteCommand) {
      const { Key } = (command as DeleteCommand).input;
      if (Key?.pk) this.items.delete(String(Key.pk));
      return {};
    }
    throw new Error(`FakeDdbDocClient: unhandled command ${command?.constructor?.name}`);
  }

  /** Test helper. Direct access to the synthetic table contents. */
  snapshot(): Map<string, Record<string, unknown>> {
    return new Map(this.items);
  }
}

class ControlledPutDdbClient implements DynamoDBDocumentClientLike {
  private items = new Map<string, Record<string, unknown>>();
  public readonly sent: unknown[] = [];
  public readonly pendingPuts: Array<{ item: Record<string, unknown>; resolve: () => void; reject: (err: unknown) => void }> = [];

  async send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (!(command instanceof PutCommand)) {
      throw new Error(`ControlledPutDdbClient: unhandled command ${command?.constructor?.name}`);
    }
    const { Item } = command.input;
    if (!Item) throw new Error("PutCommand missing Item");
    return new Promise((resolve, reject) => {
      this.pendingPuts.push({
        item: Item,
        resolve: () => {
          this.items.set(String(Item.pk), Item);
          resolve({});
        },
        reject,
      });
    });
  }

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
    phase: "intro",
    phaseToken: 0,
    askedQuestionIds: [],
    currentGrade: null,
    completedGrades: [],
    hasSeenIntro: false,
    activePackId: null,
    character: null,
    npcRosters: {},
    activeRound: null,
    pendingRoll: null,
    updatedAt,
  };
}

function fakePack(id: string): ContentPack {
  return {
    id,
    name: id,
    description: "test pack",
    version: "1.0.0",
    faculty: [{
      id: `${id}-teacher`,
      displayName: "Teacher",
      shortName: "T",
      subjects: ["anki"],
      bio: "test",
      accent: "#123456",
      systemPrompt: "teach this imported deck",
      defaultModel: "anthropic/claude-haiku-4.5",
      questions: [],
    }],
    rooms: [{
      id: `${id}-room`,
      name: "Room",
      channelName: "room",
      teacherId: `${id}-teacher`,
      description: "test",
      teaches: true,
    }],
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

  it("saveSession() coalesces concurrent same-pk writes within the debounce window", async () => {
    // Three concurrent saveSession() calls for the same pk should fold
    // into a single PutCommand carrying the latest payload. This is the
    // hot-path coalesce: a round can fire several saveSession() calls in
    // the same tick (pose / answer / reveal / award), and we don't want
    // each to issue its own Dynamo write.
    const debounced = new DynamoStateStore({ tableName: "t", client: fake, ttlSeconds: 60, debounceMs: 50 });
    await Promise.all([
      debounced.saveSession(blankState("rh:user:burst", 1)),
      debounced.saveSession(blankState("rh:user:burst", 2)),
      debounced.saveSession(blankState("rh:user:burst", 3)),
    ]);
    const puts = fake.sent.filter((c) => c instanceof PutCommand);
    expect(puts.length).toBe(1);
    expect(fake.snapshot().get("rh:user:burst")?.updatedAt).toBe(3);
  });

  it("saveSession() with debounceMs=0 writes immediately (no coalesce)", async () => {
    // The opt-out path: debounce=0 means every call fires its own
    // PutCommand. Useful for scripts or tests that rely on per-call
    // observability.
    const immediate = new DynamoStateStore({ tableName: "t", client: fake, ttlSeconds: 60, debounceMs: 0 });
    await immediate.saveSession(blankState("rh:user:eager", 1));
    await immediate.saveSession(blankState("rh:user:eager", 2));
    const puts = fake.sent.filter((c) => c instanceof PutCommand);
    expect(puts.length).toBe(2);
  });

  it("flush() drains pending debounced writes immediately", async () => {
    // Awaited HTTP paths (RubyHighService.flushSession) call store.flush()
    // so the response doesn't wait the debounce window. Without this, a
    // user-blocking command would always pay the debounce latency.
    const debounced = new DynamoStateStore({ tableName: "t", client: fake, ttlSeconds: 60, debounceMs: 1_000 });
    const inflight = debounced.saveSession(blankState("rh:user:flush", 7));
    // No PutCommand yet — timer hasn't fired.
    expect(fake.sent.filter((c) => c instanceof PutCommand).length).toBe(0);
    await debounced.flush();
    await inflight;
    expect(fake.sent.filter((c) => c instanceof PutCommand).length).toBe(1);
    expect(fake.snapshot().get("rh:user:flush")?.updatedAt).toBe(7);
  });

  it("serializes same-session PutCommands so older writes cannot land after newer state", async () => {
    const controlled = new ControlledPutDdbClient();
    const serial = new DynamoStateStore({ tableName: "t", client: controlled, ttlSeconds: 60, debounceMs: 0 });

    const first = serial.saveSession(blankState("rh:user:serial", 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(controlled.pendingPuts.length).toBe(1);

    const second = serial.saveSession(blankState("rh:user:serial", 2));
    await new Promise((r) => setTimeout(r, 0));
    expect(controlled.pendingPuts.length).toBe(1);

    controlled.pendingPuts[0]!.resolve();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(controlled.pendingPuts.length).toBe(2);

    controlled.pendingPuts[1]!.resolve();
    await second;
    expect(controlled.snapshot().get("rh:user:serial")?.updatedAt).toBe(2);
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

  it("saves and loads auth users/sessions in separate Dynamo items", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.saveAuthUser({
      userId: "usr_1",
      provider: "openrouter",
      providerUserHash: "hash-1",
      createdAt: 100,
      lastLoginAt: 200,
    });
    await store.saveAuthSession({
      token: "token-1",
      userId: "usr_1",
      createdAt: 300,
      expiresAt: 400_000,
    });

    const snapshot = fake.snapshot();
    expect(snapshot.get("auth:user:openrouter:hash-1")?.authUser).toBeDefined();
    const sessionItem = snapshot.get("auth:session:token-1")!;
    expect(sessionItem.authSession).toBeDefined();
    expect(sessionItem.expiresAt).toBe(400);

    const auth = await store.loadAuth();
    expect(auth.users.map((u) => u.userId)).toEqual(["usr_1"]);
    expect(auth.sessions.map((s) => s.token)).toEqual(["token-1"]);
  });

  it("saves and loads imported content packs in separate Dynamo items", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.savePack({
      pack: fakePack("anki:cells"),
      ownerSessionId: "rh:user:test",
      touchedAt: 123,
    });

    const snapshot = fake.snapshot();
    const packItems = Array.from(snapshot.values()).filter((item) => item.contentPack);
    expect(packItems).toHaveLength(1);
    expect(packItems[0]?.pk).toBe("pack:rh%3Auser%3Atest:anki%3Acells");
    expect(packItems[0]?.updatedAt).toBe(123);

    const packs = await store.loadPacks();
    expect(packs.map((p) => p.pack.id)).toEqual(["anki:cells"]);
    const loadedSessions = await store.load();
    expect(loadedSessions.has("rh:user:state")).toBe(true);
    expect(loadedSessions.has("pack:rh%3Auser%3Atest:anki%3Acells")).toBe(false);
  });

  it("deletes auth sessions by opaque token", async () => {
    await store.saveAuthSession({
      token: "token-1",
      userId: "usr_1",
      createdAt: 300,
      expiresAt: 400_000,
    });
    expect(fake.snapshot().has("auth:session:token-1")).toBe(true);
    await store.deleteAuthSession("token-1");
    expect(fake.snapshot().has("auth:session:token-1")).toBe(false);
  });

  it("uses the configured TableName on every command", async () => {
    await store.saveSession(blankState("a"));
    await store.save([blankState("b"), blankState("c")]);
    await store.saveAuthUser({
      userId: "usr_table",
      provider: "openrouter",
      providerUserHash: "hash-table",
      createdAt: 1,
      lastLoginAt: 2,
    });
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
    expect(back!.character?.playbookId).toBe("overachiever");
  });
});
