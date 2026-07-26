import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { BankedQuestion, CharacterStats, QuizState, SchoolEvent } from "../types.js";
import type { ContentPack, PackSourceCard } from "../content/types.js";

export interface AuthUserRecord {
  userId: string;
  provider: "openrouter" | "guest" | "privy";
  providerUserHash: string;
  createdAt: number;
  lastLoginAt: number;
  label?: string;
  visitorHash?: string;
  visitorFirstSeenAt?: number;
  visitorLastSeenAt?: number;
  walletAddress?: string;
  walletChainType?: "ethereum" | "solana";
}

export interface AuthSessionRecord {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthStoreSnapshot {
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
}

export interface StoredContentPackRecord {
  pack: ContentPack;
  /** null = globally visible public pack. The legacy built-in active pack
   *  uses RubyHighService's private sentinel string instead. */
  ownerSessionId: string | null;
  /** User who authored a globally visible pack, when known. */
  creatorUserId?: string;
  /** Durable creator slot backing an authored pack, when the pack was
   *  published through the draft studio. */
  courseSlot?: StoredCourseSlotRecord;
  /** Player reviews for this pack. */
  reviews?: StoredPackReview[];
  touchedAt: number;
}

export interface StoredPackReview {
  id: string;
  packId: string;
  userId: string;
  rating: number; // 1-5
  comment?: string;
  createdAt: number;
}

export type StoredTeacherVisibility = "private" | "unlisted" | "public";
export type StoredTeacherStatus = "draft" | "published";

export interface StoredTeacherRecord {
  id: string;
  creatorUserId: string;
  creatorSessionId: string;
  displayName: string;
  description: string;
  profileImageUrl?: string;
  socialsUrl?: string;
  materials: string;
  subjects: string[];
  questionCount: number;
  packId: string;
  visibility: StoredTeacherVisibility;
  status: StoredTeacherStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  pack: ContentPack;
}

export type StoredPackVisibility = "private" | "unlisted" | "public";
export type StoredCourseSlotStatus = "reserved" | "published";

export interface StoredCourseSlotRecord {
  id: string;
  ownerUserId: string;
  ownerSessionId: string;
  draftId: string;
  shareSlug: string;
  visibility: StoredPackVisibility;
  status: StoredCourseSlotStatus;
  walletTransactionId: string;
  createdAt: number;
  updatedAt: number;
  packId?: string;
  publishedAt?: number;
}

export interface StoredDraftTeacherRecord {
  id: string;
  clientRequestId?: string;
  displayName: string;
  subject?: string;
  description: string;
  quote?: string;
  assetTeacherId?: string;
  profileImageUrl?: string;
  stats?: CharacterStats;
  socialsUrl?: string;
  materials: string;
  materialSourceUrl?: string;
  sourceCards: PackSourceCard[];
  questions: BankedQuestion[];
  generationCount: number;
  generationDay?: string;
  generatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredDraftContentPackRecord {
  id: string;
  ownerUserId: string;
  ownerSessionId: string;
  name: string;
  description: string;
  visibility: StoredPackVisibility;
  derivedFrom?: string;
  courseSlot?: StoredCourseSlotRecord;
  teachers: StoredDraftTeacherRecord[];
  curriculumReviewApproval?: {
    approvedAt: number;
    approvedBy: string;
    questionCount: number;
    fingerprint: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface StoredPackInstallationRecord {
  userId: string;
  packId: string;
  enabled: boolean;
  active: boolean;
  installedAt: number;
  updatedAt: number;
}

export type StoredMetricEventName =
  | "visitor_seen"
  | "app_open"
  | "session_resume"
  | "funnel_step"
  | "yearbook_open"
  | "yearbook_copy"
  | "share_artifact_created"
  | "share_initiated"
  | "share_link_visited"
  | "guest_spotlight_seen"
  | "guest_spotlight_started"
  | "guest_pack_override_set"
  | "daily_class_started"
  | "evidence_card_completed"
  | "take_card_presented"
  | "take_card_started"
  | "take_card_submitted"
  | "teacher_response_viewed"
  | "room_reaction_viewed"
  | "class_result_completed"
  | "class_result_viewed"
  | "class_record_saved"
  | "commerce"
  | "llm_usage"
  | "error"
  | "balance_sample";

export type MetricClientSurface =
  | "viewer"
  | "agent"
  | "smoke"
  | "api"
  | "unknown";

export interface StoredMetricEventRecord {
  id: string;
  name: StoredMetricEventName;
  occurredAt: number;
  day: string;
  sessionId?: string;
  userId?: string;
  visitorHash?: string;
  clientSurface?: MetricClientSurface;
  source?: string;
  feature?: string;
  step?: string;
  provider?: string;
  model?: string;
  status?: "success" | "error" | "started" | "skipped";
  durationMs?: number;
  httpStatus?: number;
  hallPassesDelta?: number;
  meritStarsDelta?: number;
  photoDayCreditsDelta?: number;
  amountCents?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface StoredSchoolEventRecord {
  id: string;
  sessionId: string;
  event: SchoolEvent;
  occurredAt: number;
  day: string;
}

export interface StoredSchoolEventQuery {
  /** Inclusive lower bound on occurredAt. */
  since?: number;
  /** Maximum number of newest records to return. */
  limit?: number;
}

export interface StoredSessionQuery {
  /** Inclusive lower bound on updatedAt. */
  since?: number;
  /** Maximum number of newest sessions to return. */
  limit?: number;
}

export interface StoredServiceStateRecord {
  id: string;
  updatedAt: number;
  data: Record<string, unknown>;
}

export interface StoredAccountDeletionTarget {
  userId: string;
  sessionId: string;
  publicSessionId?: string;
  authSessionTokens?: string[];
  authUsers?: AuthUserRecord[];
  visitorHashes?: string[];
}

export interface StoredAccountDeletionResult {
  sessions: number;
  authUsers: number;
  authSessions: number;
  packs: number;
  teachers: number;
  draftPacks: number;
  packInstallations: number;
  metricEvents: number;
  schoolEvents: number;
}

/**
 * Common shape every state-store backend implements. RubyHighService talks
 * to this abstraction; the JSON-file backend (this file) and the DynamoDB
 * backend (dynamo-state-store.ts) both fit the same surface, so the rest
 * of the app doesn't care which is mounted.
 *
 * Two save paths:
 *   - saveSession(state)   — persist one session. Preferred — DynamoDB only
 *                             writes one item, JSON file rewrites the full
 *                             snapshot (it has no other choice).
 *   - save(states)         — persist all sessions at once. Used for full
 *                             snapshots and tests; the DynamoDB backend
 *                             chunks via BatchWrite.
 *
 * Backends MAY debounce per-mutation writes (the JSON backend does, since
 * one round can fire multiple `void saveSession()` calls in quick succession
 * and they all rewrite the same file). `flush()` drains any pending writes
 * synchronously — call it from awaited HTTP paths so the response doesn't
 * wait for the debounce window.
 */
export interface StateStoreLike {
  load(): Promise<Map<string, QuizState>>;
  loadRecentSessions?(query?: StoredSessionQuery): Promise<Map<string, QuizState>>;
  loadAuth(): Promise<AuthStoreSnapshot>;
  loadPacks(): Promise<StoredContentPackRecord[]>;
  loadTeachers(): Promise<StoredTeacherRecord[]>;
  loadDraftPacks(): Promise<StoredDraftContentPackRecord[]>;
  loadPackInstallations(): Promise<StoredPackInstallationRecord[]>;
  loadMetricEvents?(): Promise<StoredMetricEventRecord[]>;
  loadSchoolEvents?(query?: StoredSchoolEventQuery): Promise<StoredSchoolEventRecord[]>;
  loadServiceState?(id: string): Promise<StoredServiceStateRecord | null>;
  saveSession(state: QuizState): Promise<void>;
  saveAuthUser(user: AuthUserRecord): Promise<void>;
  saveAuthSession(session: AuthSessionRecord): Promise<void>;
  savePack(record: StoredContentPackRecord): Promise<void>;
  saveDraftPack(record: StoredDraftContentPackRecord): Promise<void>;
  savePackInstallation(record: StoredPackInstallationRecord): Promise<void>;
  saveTeacher(record: StoredTeacherRecord): Promise<void>;
  saveMetricEvent?(record: StoredMetricEventRecord): Promise<void>;
  saveSchoolEvent?(record: StoredSchoolEventRecord): Promise<void>;
  saveServiceState?(record: StoredServiceStateRecord): Promise<void>;
  deletePack(ownerSessionId: string | null, packId: string): Promise<void>;
  deleteTeacher(teacherId: string): Promise<void>;
  deleteDraftPack(draftId: string): Promise<void>;
  deletePackInstallation(userId: string, packId: string): Promise<void>;
  deleteAuthSession(token: string): Promise<void>;
  deleteAccountData?(target: StoredAccountDeletionTarget): Promise<StoredAccountDeletionResult>;
  save(states: Iterable<QuizState>): Promise<void>;
  describe(): string;
  /** Optional: drain any debounced writes immediately. No-op for backends
   *  that don't debounce. Returning the writeChain lets callers `await` it
   *  to know all in-flight writes have landed. */
  flush?(): Promise<void>;
}

/**
 * JSON-file persistence: a single ~/.ruby-high/state.json snapshot, written
 * atomically via tmp-file + rename. Default backend for local dev. Behind
 * the same StateStoreLike interface as DynamoStateStore so RubyHighService
 * doesn't need to know which it's talking to.
 *
 * Limitations:
 *  - Single-process. Concurrent processes would race on the file.
 *  - Single-machine. The container's filesystem is the storage.
 *  - saveSession() rewrites the whole file — fine for small session counts,
 *    but DynamoStateStore is the right choice once state matters across
 *    deploys or instances.
 */
export class StateStore implements StateStoreLike {
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();
  /** Newest snapshot we know about, kept in memory so saveSession() can
   *  rewrite the full file without forcing the caller to pass everything.
   *  Updated on load() and on every save()/saveSession(). */
  private snapshot = new Map<string, QuizState>();
  private authUsers = new Map<string, AuthUserRecord>();
  private authSessions = new Map<string, AuthSessionRecord>();
  private importedPacks = new Map<string, StoredContentPackRecord>();
  private teachers = new Map<string, StoredTeacherRecord>();
  private draftPacks = new Map<string, StoredDraftContentPackRecord>();
  private packInstallations = new Map<string, StoredPackInstallationRecord>();
  private metricEvents = new Map<string, StoredMetricEventRecord>();
  private schoolEvents = new Map<string, StoredSchoolEventRecord>();
  private serviceStates = new Map<string, StoredServiceStateRecord>();

  // Debounced-write batching. Per-mutation calls (saveSession, saveAuthUser,
  // savePack, deleteAuthSession) all rewrite the same file, so we coalesce
  // them: the first call schedules a timer, subsequent calls within the
  // window join the same pending promise, and the timer flushes one write.
  // `save()` and `flush()` short-circuit the timer to issue the write now.
  private readonly debounceMs: number;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPromise: Promise<void> | null = null;
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;

  constructor(path?: string, opts?: { debounceMs?: number }) {
    this.path =
      path ??
      process.env.RUBY_HIGH_STATE_PATH ??
      resolve(homedir(), ".ruby-high", "state.json");
    this.debounceMs = opts?.debounceMs ?? readDebounceMsFromEnv();
  }

  async load(): Promise<Map<string, QuizState>> {
    const parsed = await this.readFileSnapshot();
    if (!parsed) return new Map();
    this.applyParsedSnapshot(parsed);
    return new Map(this.snapshot);
  }

  async loadRecentSessions(query: StoredSessionQuery = {}): Promise<Map<string, QuizState>> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return querySessionRecords(this.snapshot.values(), query);
  }

  async loadAuth(): Promise<AuthStoreSnapshot> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return {
      users: Array.from(this.authUsers.values()),
      sessions: Array.from(this.authSessions.values()),
    };
  }

  async loadPacks(): Promise<StoredContentPackRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.importedPacks.values());
  }

  async loadTeachers(): Promise<StoredTeacherRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.teachers.values());
  }

  async loadDraftPacks(): Promise<StoredDraftContentPackRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.draftPacks.values());
  }

  async loadPackInstallations(): Promise<StoredPackInstallationRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.packInstallations.values());
  }

  async loadMetricEvents(): Promise<StoredMetricEventRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return Array.from(this.metricEvents.values());
  }

  async loadSchoolEvents(query: StoredSchoolEventQuery = {}): Promise<StoredSchoolEventRecord[]> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return querySchoolEventRecords(this.schoolEvents.values(), query);
  }

  async loadServiceState(id: string): Promise<StoredServiceStateRecord | null> {
    const parsed = await this.readFileSnapshot();
    if (parsed) this.applyParsedSnapshot(parsed);
    return this.serviceStates.get(id) ?? null;
  }

  private async readFileSnapshot(): Promise<{
    sessions?: QuizState[];
    authUsers?: AuthUserRecord[];
    authSessions?: AuthSessionRecord[];
    packs?: StoredContentPackRecord[];
    teachers?: StoredTeacherRecord[];
    draftPacks?: StoredDraftContentPackRecord[];
    packInstallations?: StoredPackInstallationRecord[];
    metricEvents?: StoredMetricEventRecord[];
    schoolEvents?: StoredSchoolEventRecord[];
    serviceStates?: StoredServiceStateRecord[];
  } | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as {
          sessions?: QuizState[];
          authUsers?: AuthUserRecord[];
          authSessions?: AuthSessionRecord[];
          packs?: StoredContentPackRecord[];
          teachers?: StoredTeacherRecord[];
          draftPacks?: StoredDraftContentPackRecord[];
          packInstallations?: StoredPackInstallationRecord[];
          metricEvents?: StoredMetricEventRecord[];
          schoolEvents?: StoredSchoolEventRecord[];
          serviceStates?: StoredServiceStateRecord[];
        };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.snapshot = new Map();
        this.authUsers = new Map();
        this.authSessions = new Map();
        this.importedPacks = new Map();
        this.teachers = new Map();
        this.draftPacks = new Map();
        this.packInstallations = new Map();
        this.metricEvents = new Map();
        this.schoolEvents = new Map();
        this.serviceStates = new Map();
        return null;
      }
      throw err;
    }
  }

  private applyParsedSnapshot(parsed: {
    sessions?: QuizState[];
    authUsers?: AuthUserRecord[];
    authSessions?: AuthSessionRecord[];
    packs?: StoredContentPackRecord[];
    teachers?: StoredTeacherRecord[];
    draftPacks?: StoredDraftContentPackRecord[];
    packInstallations?: StoredPackInstallationRecord[];
    metricEvents?: StoredMetricEventRecord[];
    schoolEvents?: StoredSchoolEventRecord[];
    serviceStates?: StoredServiceStateRecord[];
  }): void {
    const sessions = new Map<string, QuizState>();
    for (const s of parsed.sessions ?? []) {
      if (s && typeof s.sessionId === "string") sessions.set(s.sessionId, s);
    }
    const authUsers = new Map<string, AuthUserRecord>();
    for (const u of parsed.authUsers ?? []) {
      if (
        u &&
        (u.provider === "openrouter" || u.provider === "guest" || u.provider === "privy") &&
        typeof u.providerUserHash === "string" &&
        typeof u.userId === "string"
      ) {
        authUsers.set(authUserKey(u.provider, u.providerUserHash), u);
      }
    }
    const authSessions = new Map<string, AuthSessionRecord>();
    for (const s of parsed.authSessions ?? []) {
      if (
        s &&
        typeof s.token === "string" &&
        typeof s.userId === "string" &&
        typeof s.createdAt === "number" &&
        typeof s.expiresAt === "number"
      ) {
        authSessions.set(s.token, s);
      }
    }
    const importedPacks = new Map<string, StoredContentPackRecord>();
    for (const r of parsed.packs ?? []) {
      if (
        r &&
        r.pack &&
        typeof r.pack.id === "string" &&
        (typeof r.ownerSessionId === "string" || r.ownerSessionId === null) &&
        typeof r.touchedAt === "number"
      ) {
        importedPacks.set(packRecordKey(r.ownerSessionId, r.pack.id), r);
      }
    }
    const teachers = new Map<string, StoredTeacherRecord>();
    for (const r of parsed.teachers ?? []) {
      if (
        r &&
        typeof r.id === "string" &&
        typeof r.creatorUserId === "string" &&
        typeof r.creatorSessionId === "string" &&
        typeof r.displayName === "string" &&
        typeof r.packId === "string" &&
        r.pack &&
        r.pack.id === r.packId &&
        (r.status === "draft" || r.status === "published") &&
        (r.visibility === "private" || r.visibility === "unlisted" || r.visibility === "public")
      ) {
        teachers.set(r.id, r);
      }
    }
    const draftPacks = new Map<string, StoredDraftContentPackRecord>();
    for (const r of parsed.draftPacks ?? []) {
      if (
        r &&
        typeof r.id === "string" &&
        typeof r.ownerUserId === "string" &&
        typeof r.ownerSessionId === "string" &&
        typeof r.name === "string" &&
        (r.visibility === "private" || r.visibility === "unlisted" || r.visibility === "public") &&
        Array.isArray(r.teachers)
      ) {
        draftPacks.set(r.id, r);
      }
    }
    const packInstallations = new Map<string, StoredPackInstallationRecord>();
    for (const r of parsed.packInstallations ?? []) {
      if (
        r &&
        typeof r.userId === "string" &&
        typeof r.packId === "string" &&
        typeof r.enabled === "boolean" &&
        typeof r.active === "boolean"
      ) {
        packInstallations.set(packInstallationKey(r.userId, r.packId), r);
      }
    }
    const metricEvents = new Map<string, StoredMetricEventRecord>();
    for (const r of parsed.metricEvents ?? []) {
      if (
        r &&
        typeof r.id === "string" &&
        isStoredMetricEventName(r.name) &&
        typeof r.occurredAt === "number" &&
        typeof r.day === "string"
      ) {
        metricEvents.set(r.id, r);
      }
    }
    const serviceStates = new Map<string, StoredServiceStateRecord>();
    for (const r of parsed.serviceStates ?? []) {
      if (
        r &&
        typeof r.id === "string" &&
        typeof r.updatedAt === "number" &&
        r.data &&
        typeof r.data === "object" &&
        !Array.isArray(r.data)
      ) {
        serviceStates.set(r.id, r);
      }
    }
    const schoolEvents = new Map<string, StoredSchoolEventRecord>();
    for (const r of parsed.schoolEvents ?? []) {
      if (isStoredSchoolEventRecord(r)) {
        schoolEvents.set(r.id, r);
      }
    }
    this.snapshot = sessions;
    this.authUsers = authUsers;
    this.authSessions = authSessions;
    this.importedPacks = importedPacks;
    this.teachers = teachers;
    this.draftPacks = draftPacks;
    this.packInstallations = packInstallations;
    this.metricEvents = metricEvents;
    this.schoolEvents = schoolEvents;
    this.serviceStates = serviceStates;
  }

  /**
   * Serializes writes through a single promise chain so concurrent saves
   * don't tear the file. Each save replaces the file atomically.
   *
   * The `.catch` before `.then` is load-bearing: without it, a single failed
   * write would poison `writeChain` forever (every subsequent `.then(...)`
   * inherits the rejection), and since callers `void` the returned promise
   * the failure becomes an unhandled rejection rather than a logged error.
   * The catch lets the chain recover so the next save tries again, and we
   * surface the error to stderr so operators have something to find.
   */
  save(states: Iterable<QuizState>): Promise<void> {
    const snapshot = Array.from(states);
    // Update our in-memory snapshot before scheduling the write so
    // saveSession() that lands later sees the right baseline.
    this.snapshot = new Map(snapshot.map((s) => [s.sessionId, s]));
    // save() is the explicit "write everything now" path — supersede any
    // pending debounced write and resolve its waiters from this same write.
    return this.writeNow();
  }

  /** JSON-file mode: rewriting one session means rewriting the whole file
   *  (it's a single document). We use the in-memory snapshot updated by
   *  prior load()/save() calls, replace the one entry, and write the lot.
   *  For DynamoDB this same method writes only one item.
   *
   *  Calls within the debounce window coalesce into one file write — every
   *  caller gets a promise that resolves when that write completes. */
  saveSession(state: QuizState): Promise<void> {
    this.snapshot.set(state.sessionId, state);
    return this.scheduleWrite();
  }

  saveAuthUser(user: AuthUserRecord): Promise<void> {
    this.authUsers.set(authUserKey(user.provider, user.providerUserHash), user);
    return this.scheduleWrite();
  }

  saveAuthSession(session: AuthSessionRecord): Promise<void> {
    this.authSessions.set(session.token, session);
    return this.scheduleWrite();
  }

  savePack(record: StoredContentPackRecord): Promise<void> {
    this.importedPacks.set(packRecordKey(record.ownerSessionId, record.pack.id), record);
    return this.scheduleWrite();
  }

  saveDraftPack(record: StoredDraftContentPackRecord): Promise<void> {
    this.draftPacks.set(record.id, record);
    return this.scheduleWrite();
  }

  savePackInstallation(record: StoredPackInstallationRecord): Promise<void> {
    this.packInstallations.set(packInstallationKey(record.userId, record.packId), record);
    return this.scheduleWrite();
  }
  saveTeacher(record: StoredTeacherRecord): Promise<void> {
    this.teachers.set(record.id, record);
    return this.scheduleWrite();
  }

  saveMetricEvent(record: StoredMetricEventRecord): Promise<void> {
    this.metricEvents.set(record.id, record);
    return this.scheduleWrite();
  }

  saveSchoolEvent(record: StoredSchoolEventRecord): Promise<void> {
    this.schoolEvents.set(record.id, record);
    return this.scheduleWrite();
  }

  saveServiceState(record: StoredServiceStateRecord): Promise<void> {
    this.serviceStates.set(record.id, record);
    return this.scheduleWrite();
  }

  deletePack(ownerSessionId: string | null, packId: string): Promise<void> {
    if (!this.importedPacks.has(packRecordKey(ownerSessionId, packId))) return Promise.resolve();
    this.importedPacks.delete(packRecordKey(ownerSessionId, packId));
    return this.scheduleWrite();
  }

  deleteTeacher(teacherId: string): Promise<void> {
    if (!this.teachers.has(teacherId)) return Promise.resolve();
    this.teachers.delete(teacherId);
    return this.scheduleWrite();
  }

  deleteDraftPack(draftId: string): Promise<void> {
    if (!this.draftPacks.has(draftId)) return Promise.resolve();
    this.draftPacks.delete(draftId);
    return this.scheduleWrite();
  }

  deletePackInstallation(userId: string, packId: string): Promise<void> {
    const key = packInstallationKey(userId, packId);
    if (!this.packInstallations.has(key)) return Promise.resolve();
    this.packInstallations.delete(key);
    return this.scheduleWrite();
  }

  deleteAuthSession(token: string): Promise<void> {
    if (!this.authSessions.has(token)) return Promise.resolve();
    this.authSessions.delete(token);
    return this.scheduleWrite();
  }

  deleteAccountData(target: StoredAccountDeletionTarget): Promise<StoredAccountDeletionResult> {
    const normalized = normalizeStoredAccountDeletionTarget(target);
    const result = emptyStoredAccountDeletionResult();
    if (this.snapshot.delete(normalized.sessionId)) result.sessions += 1;

    for (const [key, user] of Array.from(this.authUsers.entries())) {
      if (!storedAccountAuthUserMatches(user, normalized)) continue;
      this.authUsers.delete(key);
      result.authUsers += 1;
    }
    for (const [token, session] of Array.from(this.authSessions.entries())) {
      if (!storedAccountAuthSessionMatches(token, session, normalized)) continue;
      this.authSessions.delete(token);
      result.authSessions += 1;
    }
    for (const [key, record] of Array.from(this.importedPacks.entries())) {
      if (!storedAccountPackMatches(record, normalized)) continue;
      this.importedPacks.delete(key);
      result.packs += 1;
    }
    for (const [id, record] of Array.from(this.teachers.entries())) {
      if (!storedAccountTeacherMatches(record, normalized)) continue;
      this.teachers.delete(id);
      result.teachers += 1;
    }
    for (const [id, record] of Array.from(this.draftPacks.entries())) {
      if (!storedAccountDraftPackMatches(record, normalized)) continue;
      this.draftPacks.delete(id);
      result.draftPacks += 1;
    }
    for (const [key, record] of Array.from(this.packInstallations.entries())) {
      if (!storedAccountPackInstallationMatches(record, normalized)) continue;
      this.packInstallations.delete(key);
      result.packInstallations += 1;
    }
    for (const [id, record] of Array.from(this.metricEvents.entries())) {
      if (!storedAccountMetricEventMatches(record, normalized)) continue;
      this.metricEvents.delete(id);
      result.metricEvents += 1;
    }
    for (const [id, record] of Array.from(this.schoolEvents.entries())) {
      if (!storedAccountSchoolEventMatches(record, normalized)) continue;
      this.schoolEvents.delete(id);
      result.schoolEvents += 1;
    }

    return storedAccountDeletionResultTotal(result) > 0 ? this.scheduleWrite().then(() => result) : Promise.resolve(result);
  }

  describe(): string {
    return this.path;
  }

  /** Drain any pending debounced write right now and wait for everything
   *  on the writeChain to land. Awaited HTTP paths (flushSession) call this
   *  so the response doesn't wait for the debounce window. */
  flush(): Promise<void> {
    if (this.pendingTimer || this.pendingPromise) {
      return this.writeNow();
    }
    return this.writeChain;
  }

  /** Schedule a debounced write. Multiple callers within the window share
   *  one promise + one file write. */
  private scheduleWrite(): Promise<void> {
    if (!this.pendingPromise) {
      this.pendingPromise = new Promise<void>((resolve, reject) => {
        this.pendingResolve = resolve;
        this.pendingReject = reject;
      });
    }
    if (this.debounceMs <= 0) {
      // Effectively immediate but still coalesces synchronous bursts:
      // queueMicrotask drains the current sync stack first, so multiple
      // void saveSession() in the same tick fold into one write.
      if (!this.pendingTimer) {
        this.pendingTimer = setTimeout(() => this.writeNow(), 0);
        if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
      }
    } else if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => this.writeNow(), this.debounceMs);
      if (typeof this.pendingTimer.unref === "function") this.pendingTimer.unref();
    }
    return this.pendingPromise;
  }

  /** Force the pending (or no) debounced write through writeChain now and
   *  return a promise that observes its outcome. Adopts any pending resolvers
   *  so debounce-batched callers see this write's success/failure. */
  private writeNow(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const resolve = this.pendingResolve;
    const reject = this.pendingReject;
    this.pendingPromise = null;
    this.pendingResolve = null;
    this.pendingReject = null;

    const next = this.writeChain.catch(() => {}).then(async () => {
      await this.writeCurrentSnapshot();
    });
    // Log + swallow on the chain so a fire-and-forget caller can't silently
    // accumulate unhandled rejections; return a fresh handle to the same
    // work so explicit awaiters (tests, stop()) still see the failure.
    this.writeChain = next.catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[ruby-high] state-store save failed (${this.path}):`, err);
    });
    if (resolve && reject) next.then(resolve, reject);
    return next;
  }

  private async writeCurrentSnapshot(): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
    const tmp = resolve(dir, `.${basename(this.path)}.${process.pid}.${nextStateStoreWriteSeq()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify({
        sessions: Array.from(this.snapshot.values()),
        authUsers: Array.from(this.authUsers.values()),
        authSessions: Array.from(this.authSessions.values()),
        packs: Array.from(this.importedPacks.values()),
        teachers: Array.from(this.teachers.values()),
        draftPacks: Array.from(this.draftPacks.values()),
        packInstallations: Array.from(this.packInstallations.values()),
        metricEvents: Array.from(this.metricEvents.values()),
        schoolEvents: Array.from(this.schoolEvents.values()),
        serviceStates: Array.from(this.serviceStates.values()),
      }, null, 2), "utf8");
      await rename(tmp, this.path);
    } catch (err) {
      try { await unlink(tmp); } catch {}
      throw err;
    }
  }
}

let stateStoreWriteSeq = 0;
function nextStateStoreWriteSeq(): number {
  stateStoreWriteSeq = (stateStoreWriteSeq + 1) % Number.MAX_SAFE_INTEGER;
  return stateStoreWriteSeq;
}

function readDebounceMsFromEnv(): number {
  const raw = process.env.RUBY_HIGH_STATE_DEBOUNCE_MS;
  if (raw == null || raw === "") return DEFAULT_DEBOUNCE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DEBOUNCE_MS;
  return Math.floor(n);
}

const DEFAULT_DEBOUNCE_MS = 25;

export function isStoredMetricEventName(value: unknown): value is StoredMetricEventName {
  return (
    value === "visitor_seen" ||
    value === "app_open" ||
    value === "session_resume" ||
    value === "funnel_step" ||
    value === "yearbook_open" ||
    value === "yearbook_copy" ||
    value === "share_artifact_created" ||
    value === "share_initiated" ||
    value === "share_link_visited" ||
    value === "guest_spotlight_seen" ||
    value === "guest_spotlight_started" ||
    value === "guest_pack_override_set" ||
    value === "daily_class_started" ||
    value === "evidence_card_completed" ||
    value === "take_card_presented" ||
    value === "take_card_started" ||
    value === "take_card_submitted" ||
    value === "teacher_response_viewed" ||
    value === "room_reaction_viewed" ||
    value === "class_result_completed" ||
    value === "class_result_viewed" ||
    value === "class_record_saved" ||
    value === "commerce" ||
    value === "llm_usage" ||
    value === "error" ||
    value === "balance_sample"
  );
}

export function isStoredSchoolEventRecord(value: unknown): value is StoredSchoolEventRecord {
  const record = value as Partial<StoredSchoolEventRecord> | null | undefined;
  return !!(
    record &&
    typeof record.id === "string" &&
    record.id &&
    typeof record.sessionId === "string" &&
    record.sessionId &&
    record.event &&
    typeof record.event.id === "string" &&
    record.event.id &&
    typeof record.event.kind === "string" &&
    Number.isFinite(record.occurredAt) &&
    Math.floor(record.occurredAt as number) >= 0 &&
    typeof record.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.day)
  );
}

export function querySchoolEventRecords(
  records: Iterable<StoredSchoolEventRecord>,
  query: StoredSchoolEventQuery = {},
): StoredSchoolEventRecord[] {
  const since = Number.isFinite(query.since) ? Math.floor(Number(query.since)) : null;
  const limit = Number.isFinite(query.limit)
    ? Math.max(0, Math.floor(Number(query.limit)))
    : null;
  const rows = Array.from(records)
    .filter(isStoredSchoolEventRecord)
    .filter((record) => since === null || record.occurredAt >= since)
    .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
  return limit === null ? rows : rows.slice(0, limit);
}

export function querySessionRecords(
  records: Iterable<QuizState>,
  query: StoredSessionQuery = {},
): Map<string, QuizState> {
  const since = Number.isFinite(query.since) ? Math.floor(Number(query.since)) : null;
  const limit = Number.isFinite(query.limit)
    ? Math.max(0, Math.floor(Number(query.limit)))
    : null;
  const rows = Array.from(records)
    .filter((state): state is QuizState =>
      !!state &&
      typeof state.sessionId === "string" &&
      state.sessionId.length > 0 &&
      Number.isFinite(Number(state.updatedAt ?? 0))
    )
    .filter((state) => since === null || Number(state.updatedAt ?? 0) >= since)
    .sort((a, b) =>
      Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0) ||
      b.sessionId.localeCompare(a.sessionId)
    );
  const selected = limit === null ? rows : rows.slice(0, limit);
  return new Map(selected.map((state) => [state.sessionId, state]));
}

export function emptyStoredAccountDeletionResult(): StoredAccountDeletionResult {
  return {
    sessions: 0,
    authUsers: 0,
    authSessions: 0,
    packs: 0,
    teachers: 0,
    draftPacks: 0,
    packInstallations: 0,
    metricEvents: 0,
    schoolEvents: 0,
  };
}

export function storedAccountDeletionResultTotal(result: StoredAccountDeletionResult): number {
  return result.sessions +
    result.authUsers +
    result.authSessions +
    result.packs +
    result.teachers +
    result.draftPacks +
    result.packInstallations +
    result.metricEvents +
    result.schoolEvents;
}

export function normalizeStoredAccountDeletionTarget(target: StoredAccountDeletionTarget): StoredAccountDeletionTarget {
  const userId = String(target.userId || "").trim();
  const sessionId = String(target.sessionId || "").trim();
  const authSessionTokens = Array.from(new Set((target.authSessionTokens ?? [])
    .map((token) => String(token || "").trim())
    .filter(Boolean)));
  const authUsers = (target.authUsers ?? []).filter((user): user is AuthUserRecord =>
    !!user &&
    typeof user.userId === "string" &&
    typeof user.providerUserHash === "string" &&
    (user.provider === "openrouter" || user.provider === "guest" || user.provider === "privy"));
  const visitorHashes = Array.from(new Set([
    ...(target.visitorHashes ?? []),
    ...authUsers.map((user) => user.visitorHash),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  return {
    userId,
    sessionId,
    ...(target.publicSessionId ? { publicSessionId: String(target.publicSessionId).trim() } : {}),
    authSessionTokens,
    authUsers,
    visitorHashes,
  };
}

export function storedAccountAuthUserMatches(user: AuthUserRecord, target: StoredAccountDeletionTarget): boolean {
  if (user.userId === target.userId) return true;
  return (target.authUsers ?? []).some((candidate) =>
    candidate.provider === user.provider && candidate.providerUserHash === user.providerUserHash);
}

export function storedAccountAuthSessionMatches(
  token: string,
  session: AuthSessionRecord,
  target: StoredAccountDeletionTarget,
): boolean {
  return session.userId === target.userId || (target.authSessionTokens ?? []).includes(token);
}

export function storedAccountPackMatches(record: StoredContentPackRecord, target: StoredAccountDeletionTarget): boolean {
  return record.ownerSessionId === target.sessionId || record.creatorUserId === target.userId;
}

export function storedAccountTeacherMatches(record: StoredTeacherRecord, target: StoredAccountDeletionTarget): boolean {
  return record.creatorUserId === target.userId || record.creatorSessionId === target.sessionId;
}

export function storedAccountDraftPackMatches(record: StoredDraftContentPackRecord, target: StoredAccountDeletionTarget): boolean {
  return record.ownerUserId === target.userId || record.ownerSessionId === target.sessionId;
}

export function storedAccountPackInstallationMatches(record: StoredPackInstallationRecord, target: StoredAccountDeletionTarget): boolean {
  return record.userId === target.userId;
}

export function storedAccountMetricEventMatches(record: StoredMetricEventRecord, target: StoredAccountDeletionTarget): boolean {
  return record.userId === target.userId ||
    record.sessionId === target.sessionId ||
    ((target.visitorHashes ?? []).length > 0 && !!record.visitorHash && target.visitorHashes!.includes(record.visitorHash));
}

export function storedAccountSchoolEventMatches(record: StoredSchoolEventRecord, target: StoredAccountDeletionTarget): boolean {
  return record.sessionId === target.sessionId;
}

export function authUserKey(provider: AuthUserRecord["provider"], providerUserHash: string): string {
  return `${provider}:${providerUserHash}`;
}

export function packRecordKey(ownerSessionId: string | null, packId: string): string {
  return `${ownerSessionId ?? "public"}:${packId}`;
}

export function packInstallationKey(userId: string, packId: string): string {
  return `${userId}:${packId}`;
}

let defaultStateStore: StateStore | null = null;
export function getDefaultStateStore(): StateStore {
  if (!defaultStateStore) defaultStateStore = new StateStore();
  return defaultStateStore;
}
