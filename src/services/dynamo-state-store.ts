import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { QuizState } from "../types.js";
import type {
  AuthSessionRecord,
  AuthStoreSnapshot,
  AuthUserRecord,
  StateStoreLike,
  StoredAccountDeletionResult,
  StoredAccountDeletionTarget,
  StoredContentPackRecord,
  StoredDraftContentPackRecord,
  StoredMetricEventRecord,
  StoredPackInstallationRecord,
  StoredSchoolEventQuery,
  StoredSchoolEventRecord,
  StoredSessionQuery,
  StoredServiceStateRecord,
  StoredTeacherRecord,
} from "./state-store.js";
import {
  emptyStoredAccountDeletionResult,
  isStoredMetricEventName,
  isStoredSchoolEventRecord,
  normalizeStoredAccountDeletionTarget,
  querySchoolEventRecords,
  querySessionRecords,
  storedAccountAuthSessionMatches,
  storedAccountAuthUserMatches,
  storedAccountDeletionResultTotal,
  storedAccountDraftPackMatches,
  storedAccountMetricEventMatches,
  storedAccountPackInstallationMatches,
  storedAccountPackMatches,
  storedAccountSchoolEventMatches,
  storedAccountTeacherMatches,
} from "./state-store.js";

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
 *   - Auth user items:    pk = "auth:user:<provider>:<providerUserHash>", authUser (map)
 *   - Auth session items: pk = "auth:session:<token>", authSession (map), expiresAt (seconds)
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
  /** Per-session debounce window in milliseconds. Multiple saveSession()
   *  calls for the same sessionId within the window collapse into a single
   *  PutItem with the latest payload. Defaults to RUBY_HIGH_DYNAMO_DEBOUNCE_MS
   *  env var or 25ms. Set to 0 to disable (every call writes immediately). */
  debounceMs?: number;
  /** Max retries for BatchWriteCommand UnprocessedItems. Defaults to 5. */
  batchWriteMaxRetries?: number;
  /** Initial retry delay for BatchWriteCommand UnprocessedItems. Defaults to 50ms. */
  batchWriteBaseDelayMs?: number;
}

/** Minimal interface so tests can mock the SDK without depending on the
 *  full DynamoDBDocumentClient surface. */
export interface DynamoDBDocumentClientLike {
  send(command: unknown): Promise<unknown>;
}

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const DEFAULT_BATCH_WRITE_MAX_RETRIES = 5;
const DEFAULT_BATCH_WRITE_BASE_DELAY_MS = 50;
const SCAN_CACHE_MS = 1_000;

type BatchPutRequest = { PutRequest: { Item: Record<string, unknown> } };
type BatchWriteRequestItems = Record<string, BatchPutRequest[]>;

interface PendingSessionWrite {
  pk: string;
  item: Record<string, unknown>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DynamoStateStore implements StateStoreLike {
  private readonly client: DynamoDBDocumentClientLike;
  private readonly tableName: string;
  private readonly ttlSeconds: number;
  private readonly region: string;
  // Per-session debounce. saveSession() during a single round can fire 4-6
  // times (pose / answer / reveal / award / etc); each used to issue its
  // own PutItem. Coalescing within a small window collapses those into one
  // write per session per window. Latest-payload-wins semantics: callers
  // mutate state and call saveSession; we keep the most recent item and
  // share one promise across all coalesced callers.
  private readonly debounceMs: number;
  private readonly batchWriteMaxRetries: number;
  private readonly batchWriteBaseDelayMs: number;
  private readonly pendingSessionWrites = new Map<string, PendingSessionWrite>();
  private readonly sessionWriteChains = new Map<string, Promise<void>>();
  private scanCache: { at: number; promise: Promise<Array<Record<string, unknown>>> } | null = null;

  constructor(opts: DynamoStateStoreOptions) {
    if (!opts.tableName) throw new Error("DynamoStateStore: tableName is required");
    this.tableName = opts.tableName;
    this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.debounceMs = opts.debounceMs ?? readDebounceMsFromEnv();
    this.batchWriteMaxRetries = Math.max(0, Math.floor(opts.batchWriteMaxRetries ?? DEFAULT_BATCH_WRITE_MAX_RETRIES));
    this.batchWriteBaseDelayMs = Math.max(0, Math.floor(opts.batchWriteBaseDelayMs ?? DEFAULT_BATCH_WRITE_BASE_DELAY_MS));
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
    const items = await this.scanAll();
    for (const item of items) {
      const state = item.state as QuizState | undefined;
      if (state && typeof state.sessionId === "string") {
        map.set(state.sessionId, state);
      }
    }
    return map;
  }

  async loadRecentSessions(query: StoredSessionQuery = {}): Promise<Map<string, QuizState>> {
    const states: QuizState[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const state = item.state as QuizState | undefined;
      if (state && typeof state.sessionId === "string") states.push(state);
    }
    return querySessionRecords(states, query);
  }

  async loadAuth(): Promise<AuthStoreSnapshot> {
    const users: AuthUserRecord[] = [];
    const sessions: AuthSessionRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const user = item.authUser as AuthUserRecord | undefined;
      if (
        user &&
        (user.provider === "openrouter" || user.provider === "guest" || user.provider === "privy" || user.provider === "passkey") &&
        typeof user.providerUserHash === "string" &&
        typeof user.userId === "string"
      ) {
        users.push(user);
      }
      const session = item.authSession as AuthSessionRecord | undefined;
      if (
        session &&
        typeof session.token === "string" &&
        typeof session.userId === "string" &&
        typeof session.createdAt === "number" &&
        typeof session.expiresAt === "number"
      ) {
        sessions.push(session);
      }
    }
    return { users, sessions };
  }

  async loadPacks(): Promise<StoredContentPackRecord[]> {
    const records: StoredContentPackRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.contentPack as StoredContentPackRecord | undefined;
      if (
        record &&
        record.pack &&
        typeof record.pack.id === "string" &&
        (typeof record.ownerSessionId === "string" || record.ownerSessionId === null) &&
        typeof record.touchedAt === "number"
      ) {
        records.push(record);
      }
    }
    return records;
  }

  async loadTeachers(): Promise<StoredTeacherRecord[]> {
    const records: StoredTeacherRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.teacherRecord as StoredTeacherRecord | undefined;
      if (
        record &&
        typeof record.id === "string" &&
        typeof record.creatorUserId === "string" &&
        typeof record.creatorSessionId === "string" &&
        typeof record.displayName === "string" &&
        typeof record.packId === "string" &&
        record.pack &&
        record.pack.id === record.packId &&
        (record.status === "draft" || record.status === "published") &&
        (record.visibility === "private" || record.visibility === "unlisted" || record.visibility === "public")
      ) {
        records.push(record);
      }
    }
    return records;
  }

  async loadDraftPacks(): Promise<StoredDraftContentPackRecord[]> {
    const records: StoredDraftContentPackRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.draftPack as StoredDraftContentPackRecord | undefined;
      if (
        record &&
        typeof record.id === "string" &&
        typeof record.ownerUserId === "string" &&
        typeof record.ownerSessionId === "string" &&
        typeof record.name === "string" &&
        (record.visibility === "private" || record.visibility === "unlisted" || record.visibility === "public") &&
        Array.isArray(record.teachers)
      ) {
        records.push(record);
      }
    }
    return records;
  }

  async loadPackInstallations(): Promise<StoredPackInstallationRecord[]> {
    const records: StoredPackInstallationRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.packInstallation as StoredPackInstallationRecord | undefined;
      if (
        record &&
        typeof record.userId === "string" &&
        typeof record.packId === "string" &&
        typeof record.enabled === "boolean" &&
        typeof record.active === "boolean"
      ) {
        records.push(record);
      }
    }
    return records;
  }

  async loadMetricEvents(): Promise<StoredMetricEventRecord[]> {
    const records: StoredMetricEventRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.metricEvent as StoredMetricEventRecord | undefined;
      if (
        record &&
        typeof record.id === "string" &&
        isStoredMetricEventName(record.name) &&
        typeof record.occurredAt === "number" &&
        typeof record.day === "string"
      ) {
        records.push(record);
      }
    }
    return records;
  }

  async loadSchoolEvents(query: StoredSchoolEventQuery = {}): Promise<StoredSchoolEventRecord[]> {
    const records: StoredSchoolEventRecord[] = [];
    const items = await this.scanAll();
    for (const item of items) {
      const record = item.schoolEvent as StoredSchoolEventRecord | undefined;
      if (isStoredSchoolEventRecord(record)) {
        records.push(record);
      }
    }
    return querySchoolEventRecords(records, query);
  }

  async loadServiceState(id: string): Promise<StoredServiceStateRecord | null> {
    const items = await this.scanAll();
    for (const item of items) {
      if (item.pk !== `service-state:${encodeURIComponent(id)}`) continue;
      const record = item.serviceState as StoredServiceStateRecord | undefined;
      if (
        record &&
        record.id === id &&
        typeof record.updatedAt === "number" &&
        record.data &&
        typeof record.data === "object" &&
        !Array.isArray(record.data)
      ) {
        return record;
      }
    }
    return null;
  }

  async takeServiceState(id: string): Promise<StoredServiceStateRecord | null> {
    this.invalidateScanCache();
    const result = await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `service-state:${encodeURIComponent(id)}` },
      ReturnValues: "ALL_OLD",
    })) as { Attributes?: Record<string, unknown> };
    const record = result.Attributes?.serviceState as StoredServiceStateRecord | undefined;
    if (!record || record.id !== id) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) return null;
    return record;
  }

  private async scanAll(): Promise<Array<Record<string, unknown>>> {
    const now = Date.now();
    if (this.scanCache && now - this.scanCache.at <= SCAN_CACHE_MS) {
      return this.scanCache.promise;
    }
    const promise = this.scanAllUncached().catch((err) => {
      if (this.scanCache?.promise === promise) this.scanCache = null;
      throw err;
    });
    this.scanCache = { at: now, promise };
    return promise;
  }

  private async scanAllUncached(): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    const nowSec = Math.floor(Date.now() / 1000);
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      // Scan is fine at this scale (a few thousand sessions); past that,
      // switch to a GSI on updatedAt or move to a real DB.
      const result = (await this.client.send(new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      }))) as { Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> };
      for (const item of result.Items ?? []) {
        if (isExpiredDynamoItem(item, nowSec)) continue;
        items.push(item);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
  }

  private invalidateScanCache(): void {
    this.scanCache = null;
  }

  async saveSession(state: QuizState): Promise<void> {
    this.invalidateScanCache();
    const item = this.toItem(state);
    const pk = state.sessionId;
    if (this.debounceMs <= 0) {
      await this.enqueueSessionPut(pk, item);
      return;
    }
    const existing = this.pendingSessionWrites.get(pk);
    if (existing) {
      // Latest payload wins. The shared promise resolves when whichever
      // PutItem actually fires lands.
      existing.item = item;
      return existing.promise;
    }
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const entry: PendingSessionWrite = {
      pk,
      item,
      promise,
      resolve,
      reject,
      timer: setTimeout(() => this.flushPendingSessionWrite(pk), this.debounceMs),
    };
    if (typeof entry.timer.unref === "function") entry.timer.unref();
    this.pendingSessionWrites.set(pk, entry);
    return promise;
  }

  private flushPendingSessionWrite(pk: string): void {
    const entry = this.pendingSessionWrites.get(pk);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingSessionWrites.delete(pk);
    this.enqueueSessionPut(pk, entry.item)
      .then(() => entry.resolve(), (err) => entry.reject(err));
  }

  private enqueueSessionPut(pk: string, item: Record<string, unknown>): Promise<void> {
    const previous = this.sessionWriteChains.get(pk) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    });
    this.sessionWriteChains.set(pk, write);
    const cleanup = () => {
      if (this.sessionWriteChains.get(pk) === write) this.sessionWriteChains.delete(pk);
    };
    write.then(cleanup, cleanup);
    return write;
  }

  /** Drain every pending debounced session write right now. Called from
   *  RubyHighService.flush() / awaited HTTP paths so a response doesn't
   *  wait for the debounce window. Returns once every pending write has
   *  settled (resolved or rejected). */
  async flush(): Promise<void> {
    const entries = Array.from(this.pendingSessionWrites.values());
    for (const entry of entries) this.flushPendingSessionWrite(entry.pk);
    await Promise.allSettled([
      ...entries.map((e) => e.promise),
      ...Array.from(this.sessionWriteChains.values()),
    ]);
  }

  async saveAuthUser(user: AuthUserRecord): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `auth:user:${user.provider}:${user.providerUserHash}`,
        authUser: user,
        updatedAt: Date.now(),
      },
    }));
  }

  async saveAuthSession(session: AuthSessionRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: `auth:session:${session.token}`,
      authSession: session,
      updatedAt: Date.now(),
      expiresAt: Math.floor(session.expiresAt / 1000),
    };
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async savePack(record: StoredContentPackRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: this.packPk(record.ownerSessionId, record.pack.id),
      contentPack: record,
      updatedAt: record.touchedAt,
    };
    if (this.ttlSeconds > 0) {
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async saveDraftPack(record: StoredDraftContentPackRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: `draft-pack:${encodeURIComponent(record.id)}`,
      draftPack: record,
      updatedAt: record.updatedAt,
    };
    if (this.ttlSeconds > 0) {
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async savePackInstallation(record: StoredPackInstallationRecord): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: this.packInstallationPk(record.userId, record.packId),
        packInstallation: record,
        updatedAt: record.updatedAt,
      },
    }));
  }
  async saveTeacher(record: StoredTeacherRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: "teacher:" + encodeURIComponent(record.id),
      teacherRecord: record,
      updatedAt: record.updatedAt,
    };
    if (this.ttlSeconds > 0) {
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async saveMetricEvent(record: StoredMetricEventRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: `metric-event:${record.day}:${encodeURIComponent(record.id)}`,
      metricEvent: record,
      updatedAt: record.occurredAt,
    };
    if (this.ttlSeconds > 0) {
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async saveSchoolEvent(record: StoredSchoolEventRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: `school-event:${record.day}:${encodeURIComponent(record.id)}`,
      schoolEvent: record,
      updatedAt: record.occurredAt,
    };
    if (this.ttlSeconds > 0) {
      item.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    }
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async saveServiceState(record: StoredServiceStateRecord): Promise<void> {
    this.invalidateScanCache();
    const item: Record<string, unknown> = {
      pk: `service-state:${encodeURIComponent(record.id)}`,
      serviceState: record,
      updatedAt: record.updatedAt,
    };
    if (record.expiresAt) item.expiresAt = Math.floor(record.expiresAt / 1000);
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async deletePack(ownerSessionId: string | null, packId: string): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: this.packPk(ownerSessionId, packId) },
    }));
  }

  async deleteTeacher(teacherId: string): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `teacher:${encodeURIComponent(teacherId)}` },
    }));
  }

  async deleteDraftPack(draftId: string): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `draft-pack:${encodeURIComponent(draftId)}` },
    }));
  }

  async deletePackInstallation(userId: string, packId: string): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: this.packInstallationPk(userId, packId) },
    }));
  }

  async deleteAuthSession(token: string): Promise<void> {
    this.invalidateScanCache();
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `auth:session:${token}` },
    }));
  }

  async deleteAccountData(targetInput: StoredAccountDeletionTarget): Promise<StoredAccountDeletionResult> {
    await this.flush();
    const target = normalizeStoredAccountDeletionTarget(targetInput);
    const result = emptyStoredAccountDeletionResult();
    const items = await this.scanAll();
    const pks: string[] = [];
    for (const item of items) {
      const pk = String(item.pk ?? "");
      if (!pk) continue;
      const state = item.state as QuizState | undefined;
      if (state && (pk === target.sessionId || state.sessionId === target.sessionId)) {
        pks.push(pk);
        result.sessions += 1;
        continue;
      }
      const authUser = item.authUser as AuthUserRecord | undefined;
      if (authUser && storedAccountAuthUserMatches(authUser, target)) {
        pks.push(pk);
        result.authUsers += 1;
        continue;
      }
      const authSession = item.authSession as AuthSessionRecord | undefined;
      if (authSession) {
        const token = pk.startsWith("auth:session:") ? pk.slice("auth:session:".length) : authSession.token;
        if (storedAccountAuthSessionMatches(token, authSession, target)) {
          pks.push(pk);
          result.authSessions += 1;
          continue;
        }
      }
      const pack = item.contentPack as StoredContentPackRecord | undefined;
      if (pack && storedAccountPackMatches(pack, target)) {
        pks.push(pk);
        result.packs += 1;
        continue;
      }
      const teacher = item.teacherRecord as StoredTeacherRecord | undefined;
      if (teacher && storedAccountTeacherMatches(teacher, target)) {
        pks.push(pk);
        result.teachers += 1;
        continue;
      }
      const draft = item.draftPack as StoredDraftContentPackRecord | undefined;
      if (draft && storedAccountDraftPackMatches(draft, target)) {
        pks.push(pk);
        result.draftPacks += 1;
        continue;
      }
      const installation = item.packInstallation as StoredPackInstallationRecord | undefined;
      if (installation && storedAccountPackInstallationMatches(installation, target)) {
        pks.push(pk);
        result.packInstallations += 1;
        continue;
      }
      const metric = item.metricEvent as StoredMetricEventRecord | undefined;
      if (metric && storedAccountMetricEventMatches(metric, target)) {
        pks.push(pk);
        result.metricEvents += 1;
        continue;
      }
      const schoolEvent = item.schoolEvent as StoredSchoolEventRecord | undefined;
      if (schoolEvent && storedAccountSchoolEventMatches(schoolEvent, target)) {
        pks.push(pk);
        result.schoolEvents += 1;
      }
    }
    if (storedAccountDeletionResultTotal(result) <= 0) return result;
    this.invalidateScanCache();
    for (const pk of pks) {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { pk },
      }));
    }
    return result;
  }

  /** Bulk write — used by tests / migrations. Chunks at 25 (BatchWrite cap). */
  async save(states: Iterable<QuizState>): Promise<void> {
    this.invalidateScanCache();
    const items = Array.from(states);
    if (this.pendingSessionWrites.size > 0 || this.sessionWriteChains.size > 0) {
      await this.flush();
    }
    if (items.length === 0) return;
    const CHUNK = 25;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await this.batchWriteAll({
        [this.tableName]: chunk.map((state) => ({
          PutRequest: { Item: this.toItem(state) },
        })),
      });
    }
  }

  private async batchWriteAll(initial: BatchWriteRequestItems): Promise<void> {
    let requestItems = initial;
    for (let attempt = 0; ; attempt++) {
      const result = (await this.client.send(new BatchWriteCommand({
        RequestItems: requestItems,
      }))) as { UnprocessedItems?: BatchWriteRequestItems };
      const unprocessed = nonEmptyRequestItems(result.UnprocessedItems);
      if (!unprocessed) return;
      const remaining = countBatchWriteRequests(unprocessed);
      if (attempt >= this.batchWriteMaxRetries) {
        throw new Error(
          `DynamoStateStore.save: ${remaining} unprocessed BatchWrite item(s) after ${attempt + 1} attempt(s)`,
        );
      }
      await sleep(batchWriteBackoffMs(attempt, this.batchWriteBaseDelayMs));
      requestItems = unprocessed;
    }
  }

  describe(): string {
    return `dynamodb://${this.region}/${this.tableName}`;
  }

  metricEventRetentionMs(): number | null {
    return this.ttlSeconds > 0 ? this.ttlSeconds * 1000 : null;
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

  private packPk(ownerSessionId: string | null, packId: string): string {
    return `pack:${encodeURIComponent(ownerSessionId ?? "public")}:${encodeURIComponent(packId)}`;
  }

  private packInstallationPk(userId: string, packId: string): string {
    return `pack-installation:${encodeURIComponent(userId)}:${encodeURIComponent(packId)}`;
  }
}

function readDebounceMsFromEnv(): number {
  const raw = process.env.RUBY_HIGH_DYNAMO_DEBOUNCE_MS;
  if (raw == null || raw === "") return DEFAULT_DEBOUNCE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DEBOUNCE_MS;
  return Math.floor(n);
}

const DEFAULT_DEBOUNCE_MS = 25;

function isExpiredDynamoItem(item: Record<string, unknown>, nowSec: number): boolean {
  const expiresAt = item.expiresAt;
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt <= nowSec;
}

function nonEmptyRequestItems(items: BatchWriteRequestItems | undefined): BatchWriteRequestItems | null {
  if (!items) return null;
  const out: BatchWriteRequestItems = {};
  for (const [table, requests] of Object.entries(items)) {
    if (requests.length > 0) out[table] = requests;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function countBatchWriteRequests(items: BatchWriteRequestItems): number {
  let n = 0;
  for (const requests of Object.values(items)) n += requests.length;
  return n;
}

function batchWriteBackoffMs(attempt: number, baseDelayMs: number): number {
  if (baseDelayMs <= 0) return 0;
  const capped = Math.min(attempt, 6);
  const exponential = baseDelayMs * (2 ** capped);
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
