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
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";

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

class RetryBatchDdbClient implements DynamoDBDocumentClientLike {
  private items = new Map<string, Record<string, unknown>>();
  public readonly sent: unknown[] = [];
  public attempts = 0;

  async send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (!(command instanceof BatchWriteCommand)) {
      throw new Error(`RetryBatchDdbClient: unhandled command ${command?.constructor?.name}`);
    }
    const req = command.input.RequestItems ?? {};
    const table = Object.keys(req)[0]!;
    const ops = (req[table] ?? []) as Array<{ PutRequest?: { Item?: Record<string, unknown> } }>;
    this.attempts++;
    if (this.attempts === 1) {
      for (const op of ops.slice(1)) {
        if (op.PutRequest?.Item) this.items.set(String(op.PutRequest.Item.pk), op.PutRequest.Item);
      }
      return { UnprocessedItems: { [table]: ops.slice(0, 1) } };
    }
    for (const op of ops) {
      if (op.PutRequest?.Item) this.items.set(String(op.PutRequest.Item.pk), op.PutRequest.Item);
    }
    return {};
  }

  snapshot(): Map<string, Record<string, unknown>> {
    return new Map(this.items);
  }
}

class AlwaysUnprocessedBatchDdbClient implements DynamoDBDocumentClientLike {
  public readonly sent: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.sent.push(command);
    if (!(command instanceof BatchWriteCommand)) {
      throw new Error(`AlwaysUnprocessedBatchDdbClient: unhandled command ${command?.constructor?.name}`);
    }
    return { UnprocessedItems: command.input.RequestItems };
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
    wallet: { meritStars: 0, hallPasses: 0 },
    lastReveal: null,
    status: "idle",
    phase: "intro",
    phaseToken: 0,
    askedQuestionIds: [],
    currentGrade: null,
    completedGrades: [],
    hasSeenIntro: false,
    activePackId: null,
    guestPackMode: "auto",
    guestPackOverrideId: null,
    character: null,
    comicCollection: { issueId: "first-bell", title: "Ruby High: Book One - First Bell", pageCount: 12, unlockedPages: [] },
    schoolEvents: [],
    essayReports: [],
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
      defaultModel: DEFAULT_OPENROUTER_MODEL,
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

  it("save() retries BatchWrite UnprocessedItems and writes only the leftovers", async () => {
    const retrying = new RetryBatchDdbClient();
    const retryStore = new DynamoStateStore({
      tableName: "ruby-high-test",
      client: retrying,
      ttlSeconds: 60,
      batchWriteBaseDelayMs: 0,
      batchWriteMaxRetries: 2,
    });
    await retryStore.save([
      blankState("rh:retry:1"),
      blankState("rh:retry:2"),
      blankState("rh:retry:3"),
    ]);
    const batches = retrying.sent.filter((c) => c instanceof BatchWriteCommand);
    expect(batches.length).toBe(2);
    const secondReq = (batches[1] as BatchWriteCommand).input.RequestItems?.["ruby-high-test"] ?? [];
    expect(secondReq).toHaveLength(1);
    expect(retrying.snapshot().size).toBe(3);
  });

  it("save() throws when BatchWrite leaves items unprocessed after retries", async () => {
    const blocked = new AlwaysUnprocessedBatchDdbClient();
    const retryStore = new DynamoStateStore({
      tableName: "ruby-high-test",
      client: blocked,
      ttlSeconds: 60,
      batchWriteBaseDelayMs: 0,
      batchWriteMaxRetries: 1,
    });
    await expect(retryStore.save([blankState("rh:retry:stuck")])).rejects.toThrow(/unprocessed BatchWrite/i);
    expect(blocked.sent.filter((c) => c instanceof BatchWriteCommand)).toHaveLength(2);
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
    const expiresAt = Date.now() + 400_000;
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
      expiresAt,
    });

    const snapshot = fake.snapshot();
    expect(snapshot.get("auth:user:openrouter:hash-1")?.authUser).toBeDefined();
    const sessionItem = snapshot.get("auth:session:token-1")!;
    expect(sessionItem.authSession).toBeDefined();
    expect(sessionItem.expiresAt).toBe(Math.floor(expiresAt / 1000));

    const auth = await store.loadAuth();
    expect(auth.users.map((u) => u.userId)).toEqual(["usr_1"]);
    expect(auth.sessions.map((s) => s.token)).toEqual(["token-1"]);
  });

  it("saves and loads durable metric events in separate Dynamo items", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.saveMetricEvent({
      id: "evt-1",
      name: "session_resume",
      occurredAt: 123_000,
      day: "1970-01-01",
      sessionId: "rh:user:state",
      source: "viewer",
      feature: "viewer",
      metadata: { inactiveMs: 600_000 },
    });
    (fake as unknown as { items: Map<string, Record<string, unknown>> }).items.set(
      "metric-event:1970-01-01:bad-event",
      {
        pk: "metric-event:1970-01-01:bad-event",
        metricEvent: {
          id: "bad-event",
          name: "legacy_unknown_event",
          occurredAt: 124_000,
          day: "1970-01-01",
        },
      },
    );

    const snapshot = fake.snapshot();
    const item = snapshot.get("metric-event:1970-01-01:evt-1")!;
    expect(item.metricEvent).toMatchObject({
      id: "evt-1",
      name: "session_resume",
      sessionId: "rh:user:state",
    });
    expect(item.expiresAt).toBeGreaterThan(0);

    const events = await store.loadMetricEvents();
    expect(events).toEqual([expect.objectContaining({
      id: "evt-1",
      name: "session_resume",
    })]);
    const loadedSessions = await store.load();
    expect(loadedSessions.has("rh:user:state")).toBe(true);
    expect(loadedSessions.has("metric-event:1970-01-01:evt-1")).toBe(false);
  });

  it("saves and loads durable school events in separate Dynamo items", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.saveSchoolEvent({
      id: "school:event:dynamo",
      sessionId: "rh:user:state",
      occurredAt: 123_000,
      day: "1970-01-01",
      event: {
        id: "school:event:dynamo",
        kind: "comic.page-unlocked",
        at: 123_000,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-dynamo",
        pageNumber: 6,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Dynamo page",
      },
    });

    const snapshot = fake.snapshot();
    const item = snapshot.get("school-event:1970-01-01:school%3Aevent%3Adynamo")!;
    expect(item.schoolEvent).toMatchObject({
      id: "school:event:dynamo",
      sessionId: "rh:user:state",
      event: expect.objectContaining({ label: "Dynamo page" }),
    });
    expect(item.expiresAt).toBeGreaterThan(0);

    const events = await store.loadSchoolEvents();
    expect(events).toEqual([expect.objectContaining({
      id: "school:event:dynamo",
      sessionId: "rh:user:state",
    })]);
    const loadedSessions = await store.load();
    expect(loadedSessions.has("rh:user:state")).toBe(true);
    expect(loadedSessions.has("school-event:1970-01-01:school%3Aevent%3Adynamo")).toBe(false);
  });

  it("filters expired Dynamo TTL items before loading durable school events", async () => {
    await store.saveSchoolEvent({
      id: "school:event:fresh",
      sessionId: "rh:user:fresh",
      occurredAt: 200,
      day: "1970-01-01",
      event: {
        id: "school:event:fresh",
        kind: "comic.page-unlocked",
        at: 200,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "fresh",
        pageNumber: 7,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Fresh page",
      },
    });
    await fake.send(new PutCommand({
      TableName: "ruby-high-test",
      Item: {
        pk: "school-event:1970-01-01:school%3Aevent%3Aexpired",
        schoolEvent: {
          id: "school:event:expired",
          sessionId: "rh:user:expired",
          occurredAt: Date.now(),
          day: "1970-01-01",
          event: {
            id: "school:event:expired",
            kind: "comic.page-unlocked",
            at: Date.now(),
            faculty: "ruby",
            grade: "10",
            issueId: "first-bell",
            pageId: "expired",
            pageNumber: 8,
            reason: "teacher-class-aced",
            sourceId: "teacher:ruby:grade:10",
            label: "Expired page",
          },
        },
        updatedAt: Date.now(),
        expiresAt: 1,
      },
    }));

    const events = await store.loadSchoolEvents({ since: 0, limit: 10 });

    expect(events.map((event) => event.id)).toEqual(["school:event:fresh"]);
  });

  it("queries durable school events by time and limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.saveSchoolEvent({
        id: `school:event:dynamo:${i}`,
        sessionId: "rh:user:state",
        occurredAt: 100 + i,
        day: "1970-01-01",
        event: {
          id: `school:event:dynamo:${i}`,
          kind: "comic.page-unlocked",
          at: 100 + i,
          faculty: "ruby",
          grade: "10",
          issueId: "first-bell",
          pageId: `first-bell-dynamo-${i}`,
          pageNumber: i + 1,
          reason: "teacher-class-aced",
          sourceId: "teacher:ruby:grade:10",
          label: `Dynamo page ${i}`,
        },
      });
    }

    const events = await store.loadSchoolEvents({ since: 102, limit: 2 });

    expect(events.map((event) => event.id)).toEqual([
      "school:event:dynamo:4",
      "school:event:dynamo:3",
    ]);
  });

  it("saves and loads generic service state in a separate Dynamo item", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.saveServiceState({
      id: "svc:test",
      updatedAt: 456,
      data: {
        version: 1,
        lastRunAt: 123,
      },
    });

    const snapshot = fake.snapshot();
    expect(snapshot.get("service-state:svc%3Atest")?.serviceState).toEqual({
      id: "svc:test",
      updatedAt: 456,
      data: {
        version: 1,
        lastRunAt: 123,
      },
    });

    await expect(store.loadServiceState("svc:test")).resolves.toEqual({
      id: "svc:test",
      updatedAt: 456,
      data: {
        version: 1,
        lastRunAt: 123,
      },
    });
    await expect(store.loadServiceState("svc:missing")).resolves.toBeNull();
    const loadedSessions = await store.load();
    expect(loadedSessions.has("rh:user:state")).toBe(true);
    expect(loadedSessions.has("service-state:svc%3Atest")).toBe(false);
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

    await store.deletePack("rh:user:test", "anki:cells");
    expect(fake.snapshot().has("pack:rh%3Auser%3Atest:anki%3Acells")).toBe(false);
    expect(await store.loadPacks()).toEqual([]);
  });

  it("saves and loads public content packs", async () => {
    await store.savePack({
      pack: fakePack("teacher:public"),
      ownerSessionId: null,
      touchedAt: 456,
    });

    const snapshot = fake.snapshot();
    expect(snapshot.get("pack:public:teacher%3Apublic")?.contentPack).toBeDefined();

    const packs = await store.loadPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.ownerSessionId).toBeNull();

    await store.deletePack(null, "teacher:public");
    expect(fake.snapshot().has("pack:public:teacher%3Apublic")).toBe(false);
  });

  it("loads and deletes legacy teacher records in separate Dynamo items", async () => {
    const pack = fakePack("teacher:stored");
    await fake.send(new PutCommand({
      TableName: "ruby-high-test",
      Item: {
        pk: "teacher:teacher_1",
        teacherRecord: {
          id: "teacher_1",
          creatorUserId: "usr_1",
          creatorSessionId: "rh:user:usr_1",
          displayName: "Stored Teacher",
          description: "A persisted teacher.",
          materials: "# Unit",
          subjects: ["systems"],
          questionCount: 1,
          packId: pack.id,
          visibility: "public",
          status: "published",
          createdAt: 10,
          updatedAt: 20,
          publishedAt: 20,
          pack,
        },
        updatedAt: 20,
      },
    }));

    const snapshot = fake.snapshot();
    expect(snapshot.get("teacher:teacher_1")?.teacherRecord).toBeDefined();

    const teachers = await store.loadTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0]?.displayName).toBe("Stored Teacher");

    await store.deleteTeacher("teacher_1");
    expect(fake.snapshot().has("teacher:teacher_1")).toBe(false);
  });

  it("shares close-together table scans across hydrate calls", async () => {
    await store.saveSession(blankState("rh:user:state"));
    await store.saveAuthUser({
      userId: "usr_1",
      provider: "openrouter",
      providerUserHash: "hash-1",
      createdAt: 100,
      lastLoginAt: 200,
    });
    await store.savePack({
      pack: fakePack("anki:cells"),
      ownerSessionId: "rh:user:test",
      touchedAt: 123,
    });
    fake.sent.length = 0;

    await Promise.all([
      store.loadAuth(),
      store.loadPacks(),
      store.load(),
    ]);

    expect(fake.sent.filter((c) => c instanceof ScanCommand)).toHaveLength(1);
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
