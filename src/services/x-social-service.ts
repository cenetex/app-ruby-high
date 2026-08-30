import { createHash, createHmac, randomBytes } from "node:crypto";
import { fetchSafeImageBuffer } from "./safe-url.js";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import type { IAgentRuntime } from "../runtime.js";
import { Service } from "../runtime.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";
import { log } from "./logger.js";
import { fetchLlmChatCompletions, hasConfiguredLlmCredential } from "./llm-provider.js";
import type { TeacherCharacter } from "../characters/teachers.js";
import { listTeachers, teacherById } from "../characters/teachers.js";
import { listStudents } from "../characters/students.js";
import {
  appendScheduledSchoolUpdateLink,
  buildDeterministicPostText,
  generateScheduledSchoolUpdateText,
  isLowSignalMilestone,
  generateLlmPostText,
  type ScheduledSchoolUpdateEditorialMode,
  type ScheduledSchoolUpdateContext,
} from "./ruby-high/post-types.js";
import { PostAnalytics } from "./ruby-high/post-analytics.js";
import {
  generateScheduledTweetPlan,
  type PlannedTweetSlot,
  type RecentPlannedPost,
  type ScheduledTweetPlan,
} from "./ruby-high/tweet-planner.js";

const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

declare const generatedRubyHighLocationImage: unique symbol;
type GeneratedRubyHighLocationImageUrl = string & {
  readonly [generatedRubyHighLocationImage]: true;
};

function generatedLocationImageUrl(imageUrl: string): GeneratedRubyHighLocationImageUrl {
  return imageUrl as GeneratedRubyHighLocationImageUrl;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface XTokenRecord {
  teacherId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  xUserId: string;
  xScreenName: string;
  connectedAt: number;
  updatedAt: number;
  lastPhotoDate?: string;
  postPausedReason?: string;
  postPausedAt?: number;
  postPausedUntil?: number;
  lastPostFailureStatus?: number;
  lastPostFailureAt?: number;
}

export type XMilestoneKind =
  | "character-created"
  | "class-passed"
  | "grade-advanced"
  | "graduated"
  | "portrait-set"
  | "diploma-earned"
  | "class-photo";

export interface XMilestoneContext {
  kind: XMilestoneKind;
  characterName: string;
  grade?: string;
  teacherName?: string;
  teacherFacultyId?: string;
  className?: string;
  classSubjects?: string[];
  studentImageUrl?: string;
  teacherImageUrl?: string;
  letterGrade?: string;
  arcAnswer?: string;
  flavorQuote?: string;
  imageUrl?: string;
  portraitUrl?: string;
  diplomaUrl?: string;
  reserveDailyPhotoSlot?: boolean;
  yearbookShareUrl?: string;
  fromGrade?: string;
  toGrade?: string;
}

export interface XSocialStatus {
  connected: boolean;
  teacherId: string;
  xScreenName?: string;
  connectedAt?: number;
  hasMediaWrite?: boolean;
  hasTweetWrite?: boolean;
  postPausedReason?: string;
  postPausedAt?: number;
  postPausedUntil?: number;
  lastPostFailureStatus?: number;
  lastPostFailureAt?: number;
}

interface XPostFailureClassification {
  logName: string;
  pauseReason?: string;
  retryAt?: number;
}

interface ScheduledSchoolUpdatePostOptions {
  dryRun?: boolean;
  editorialMode?: ScheduledSchoolUpdateEditorialMode;
  plannedSlot?: PlannedTweetSlot;
  recentPosts?: RecentPlannedPost[];
}

interface ScheduledSchoolUpdatePublishResult {
  tweetId: string;
  text: string;
}

export interface XTokenStore {
  loadAll(): Promise<XTokenRecord[]>;
  save(record: XTokenRecord): Promise<void>;
  delete(teacherId: string): Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const X_API_BASE = "https://api.x.com/2";
const X_OAUTH_AUTHORIZE = "https://x.com/i/oauth2/authorize";
const X_OAUTH_TOKEN = "https://api.x.com/2/oauth2/token";
const X_REVOKE = "https://api.x.com/2/oauth2/revoke";
const X_MEDIA_UPLOAD = "https://api.x.com/2/media/upload";
const X_LEGACY_MEDIA_UPLOAD = "https://upload.x.com/1.1/media/upload.json";
const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // X limit: 5 MB for images
const X_POSTS_PER_24H = 50;
const TOKEN_REFRESH_WINDOW_SEC = 300;
const X_FETCH_TIMEOUT_MS = 15_000;
const X_POST_RATE_LIMIT_RETRY_MS = 60 * 60 * 1000;
const X_POST_TRANSIENT_RETRY_MS = 15 * 60 * 1000;
const X_POST_NETWORK_RETRY_MS = 10 * 60 * 1000;
const X_POST_ERROR_BODY_MAX = 500;
const RUBY_HIGH_ASSET_PREFIX = "/api/apps/ruby-high/assets";
const PLAYBOOK_DEFAULT_POST_IMAGE: Record<string, string> = {
  overachiever: "indra",
  slacker: "sami",
  heart: "mika",
  outsider: "noor",
  "class-clown": "ravi",
  lifer: "lyra",
};
function xClientId(): string { return process.env.RUBY_HIGH_X_CLIENT_ID ?? ""; }
function xClientSecret(): string { return process.env.RUBY_HIGH_X_CLIENT_SECRET ?? ""; }

function xRedirectUri(): string {
  const base = process.env.RUBY_HIGH_PUBLIC_BASE?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
  return `${base}/api/apps/ruby-high/x/callback`;
}

function scheduledSchoolUpdateAcquisitionRef(mode: ScheduledSchoolUpdateEditorialMode): string {
  if (mode === "guest-welcome") return "activation-x-guest-welcome";
  if (mode === "guest-insights") return "activation-x-guest-insights";
  return "activation-x-school-update";
}

function scheduledSchoolUpdateActivationUrl(mode: ScheduledSchoolUpdateEditorialMode): string {
  const base = process.env.RUBY_HIGH_PUBLIC_BASE?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
  const url = new URL("/api/apps/ruby-high/viewer", `${base}/`);
  url.searchParams.set("ref", scheduledSchoolUpdateAcquisitionRef(mode));
  return url.toString();
}

const X_OAUTH_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"].join(" ");

function defaultTeacherPostImageUrl(teacherId: string): string | null {
  if (
    teacherId === "ruby"
    || teacherId === "sally-science"
    || teacherId === "professor-edward"
    || teacherId === "eliza"
    || teacherId === "seraph"
  ) {
    return `${RUBY_HIGH_ASSET_PREFIX}/teachers/${teacherId}-full.png`;
  }
  return null;
}

function defaultStudentPostImageUrl(playbookId: string | undefined): string {
  const studentId = PLAYBOOK_DEFAULT_POST_IMAGE[playbookId || ""] || "indra";
  return `${RUBY_HIGH_ASSET_PREFIX}/students/${studentId}-full.png`;
}

function studentReferenceImageUrl(studentId: string): string {
  return `${RUBY_HIGH_ASSET_PREFIX}/students/${studentId}-full.png`;
}

function normalizeXHandle(value: string | undefined): string {
  const handle = value?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : "";
}

function compactXSourceText(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function scheduledSchoolUpdatePhotoParticipants(
  teacher: TeacherCharacter,
  context: ScheduledSchoolUpdateContext,
): Array<{ role: "teacher" | "student"; id: string; name: string; imageUrl: string }> {
  const teacherImageUrl = defaultTeacherPostImageUrl(teacher.id);
  const featuredGuest = context.featuredGuest?.imageUrl &&
      context.featuredGuest.facultyId !== teacher.id
    ? {
        role: "teacher" as const,
        id: `guest:${context.featuredGuest.facultyId}`,
        name: context.featuredGuest.displayName,
        imageUrl: context.featuredGuest.imageUrl,
      }
    : null;
  const loungeActive = context.activeRooms.some((room) => room.area === "teacher-lounge");
  if (loungeActive) {
    const baseTeachers = [teacher, ...listTeachers().filter((candidate) => candidate.id !== teacher.id)]
      .flatMap((candidate) => {
        const imageUrl = defaultTeacherPostImageUrl(candidate.id);
        return imageUrl
          ? [{ role: "teacher" as const, id: candidate.id, name: candidate.displayName, imageUrl }]
          : [];
      });
    return [
      ...baseTeachers.slice(0, 1),
      ...(featuredGuest ? [featuredGuest] : []),
      ...baseTeachers.slice(1),
    ].slice(0, 3);
  }

  const students = listStudents();
  const seed = createHash("sha256")
    .update(`${context.date}:${JSON.stringify(context.recentEvents)}`)
    .digest()
    .readUInt32BE(0);
  const selectedStudents = students.length > 0
    ? [students[seed % students.length], students[(seed + 1) % students.length]].filter(Boolean)
    : [];
  return [
    ...(teacherImageUrl
      ? [{ role: "teacher" as const, id: teacher.id, name: teacher.displayName, imageUrl: teacherImageUrl }]
      : []),
    ...(featuredGuest ? [featuredGuest] : []),
    ...selectedStudents.map((student) => ({
      role: "student" as const,
      id: student.id,
      name: student.name,
      imageUrl: studentReferenceImageUrl(student.id),
    })),
  ].slice(0, 4);
}

function milestoneUsesDailyPhotoSlot(kind: XMilestoneKind): boolean {
  return kind === "portrait-set" || kind === "diploma-earned" || kind === "class-photo";
}

// ── Token Store Implementations ─────────────────────────────────────────────

function isDynamoBackend(): boolean {
  return process.env.RUBY_HIGH_STORE_BACKEND === "dynamodb";
}

class JsonXTokenStore implements XTokenStore {
  private filePath: string;

  constructor() {
    // RUBY_HIGH_STATE_PATH may be a file (SQLite .db) or a directory.
    // Use RUBY_HIGH_DATA_DIR when set, otherwise check if the path has a
    // file extension (e.g. .db, .json) — if so, take the parent directory.
    const rawPath = process.env.RUBY_HIGH_STATE_PATH;
    const dir = process.env.RUBY_HIGH_DATA_DIR
      ?? (rawPath
        ? (/\.[a-z]{2,6}$/i.test(rawPath) ? dirname(rawPath) : rawPath)
        : resolve(homedir(), ".ruby-high"));
    this.filePath = resolve(dir, "x-tokens.json");
  }

  private async read(): Promise<Record<string, XTokenRecord>> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as Record<string, XTokenRecord>;
    } catch {
      return {};
    }
  }

  private async write(data: Record<string, XTokenRecord>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  async loadAll(): Promise<XTokenRecord[]> {
    return Object.values(await this.read());
  }

  async save(record: XTokenRecord): Promise<void> {
    const data = await this.read();
    data[record.teacherId] = record;
    await this.write(data);
  }

  async delete(teacherId: string): Promise<void> {
    const data = await this.read();
    delete data[teacherId];
    await this.write(data);
  }
}

function createTokenStore(): XTokenStore {
  return isDynamoBackend() ? new LazyDynamoXTokenStore() : new JsonXTokenStore();
}

class LazyDynamoXTokenStore implements XTokenStore {
  private delegatePromise: Promise<XTokenStore> | null = null;

  private delegate(): Promise<XTokenStore> {
    if (!this.delegatePromise) {
      this.delegatePromise = import("./x-social-dynamo-token-store.js")
        .then(({ createDynamoXTokenStore }) => createDynamoXTokenStore());
    }
    return this.delegatePromise;
  }

  async loadAll(): Promise<XTokenRecord[]> {
    return (await this.delegate()).loadAll();
  }

  async save(record: XTokenRecord): Promise<void> {
    return (await this.delegate()).save(record);
  }

  async delete(teacherId: string): Promise<void> {
    return (await this.delegate()).delete(teacherId);
  }
}

// ── PKCE helpers ────────────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(sha256(verifier));
  return { verifier, challenge };
}

// ── XSocialService ──────────────────────────────────────────────────────────


// ── OAuth 1.0a helpers ─────────────────────────────────────────────────────
// Used for media upload via X API v1.1 which requires OAuth 1.0a.


function oauth1Nonce(): string {
  return randomBytes(12).toString("hex");
}

function oauth1Signature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const allParams = { ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(allParams[k]!))
    .join("&");
  const base = method.toUpperCase() + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(paramString);
  const key = encodeURIComponent(consumerSecret) + "&" + encodeURIComponent(tokenSecret);
  return createHmac("sha1", key).update(base).digest("base64");
}

function oauth1AuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauth1Nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const sig = oauth1Signature(method, url, oauthParams, consumerSecret, accessSecret);
  oauthParams["oauth_signature"] = sig;
  const header = "OAuth " + Object.keys(oauthParams)
    .sort()
    .map((k) => encodeURIComponent(k) + '="' + encodeURIComponent(oauthParams[k]!) + '"')
    .join(", ");
  return header;
}

function hasOAuth1Credentials(): boolean {
  return !!(
    process.env.RUBY_HIGH_X_CONSUMER_KEY
    && process.env.RUBY_HIGH_X_CONSUMER_SECRET
    && process.env.RUBY_HIGH_X_ACCESS_TOKEN
    && process.env.RUBY_HIGH_X_ACCESS_SECRET
  );
}

function tokenHasScope(token: XTokenRecord, scope: string): boolean {
  return (token.scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .includes(scope);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizePhotoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function responseHeader(res: Response, name: string): string | null {
  try {
    const headers = (res as Response & { headers?: { get?: (name: string) => string | null } }).headers;
    return typeof headers?.get === "function" ? headers.get(name) : null;
  } catch {
    return null;
  }
}

function retryAtFromResponse(res: Response, now = Date.now()): number | null {
  const retryAfter = responseHeader(res, "retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return now + Math.max(1, seconds) * 1000;
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs) && dateMs > now) return dateMs;
  }

  const rateLimitReset = responseHeader(res, "x-rate-limit-reset");
  if (rateLimitReset) {
    const epochSeconds = Number(rateLimitReset);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) return epochSeconds * 1000;
  }

  return null;
}

function clippedPostErrorBody(status: number, body: string): string {
  const clipped = body.trim().slice(0, X_POST_ERROR_BODY_MAX);
  return clipped || `X rejected tweet with status ${status}`;
}

export class XSocialService extends Service {
  static override readonly serviceType = "x-social";

  private tokenStore: XTokenStore;
  private tokens = new Map<string, XTokenRecord>();
  private postCounts = new Map<string, { count: number; resetAt: number }>();
  private pendingVerifiers = new Map<string, { verifier: string; teacherId: string; createdAt: number }>();
  private analytics: PostAnalytics;
  /** Per-teacher last photo tweet date (UTC YYYY-MM-DD). Mirrored onto the
   *  token record so deploys cannot reopen the same day's photo slot. */
  private lastPhotoDate = new Map<string, string>();
  private guestXPostsCache = new Map<
    string,
    {
      fetchedAt: number;
      posts: NonNullable<
        NonNullable<ScheduledSchoolUpdateContext["featuredGuest"]>["recentXPosts"]
      >;
    }
  >();

  constructor(runtime?: IAgentRuntime | null) {
    super(runtime);
    this.tokenStore = createTokenStore();
    this.analytics = new PostAnalytics(null);
  }

  static async start(runtime: IAgentRuntime): Promise<XSocialService> {
    const svc = new XSocialService(runtime);
    try {
      await svc.start();
    } catch (err) {
      log.error("x-social.start-failed", err, {});
    }
    return svc;
  }

  async start(): Promise<void> {
    try {
      const records = await this.tokenStore.loadAll();
      for (const r of records) {
        if (r.expiresAt > Date.now() || r.refreshToken) {
          const lastPhotoDate = normalizePhotoDate(r.lastPhotoDate);
          if (lastPhotoDate) this.lastPhotoDate.set(r.teacherId, lastPhotoDate);
          this.tokens.set(r.teacherId, r);
        } else {
          await this.tokenStore.delete(r.teacherId).catch(() => {});
        }
      }
      log.event("x-social.started", { teacherCount: this.tokens.size });
      void this.analytics.hydrate();
    } catch (err) {
      log.error("x-social.start-failed", err, {});
      // Service stays running with empty token cache — OAuth flows and
      // posting will still work for newly-connected teachers once
      // the token store issue is resolved.
    }
  }

  // ── OAuth flow ──────────────────────────────────────────────────────────

  beginConnect(teacherId: string): { url: string; state: string } {
    if (!xClientId()) {
      throw new Error("RUBY_HIGH_X_CLIENT_ID is not configured.");
    }
    const { verifier, challenge } = generatePkce();
    const state = `rh-x-${base64UrlEncode(randomBytes(16))}-${teacherId}`;
    this.pendingVerifiers.set(state, { verifier, teacherId, createdAt: Date.now() });
    for (const [k, v] of this.pendingVerifiers) {
      if (Date.now() - v.createdAt > 600_000) this.pendingVerifiers.delete(k);
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: xClientId(),
      redirect_uri: xRedirectUri(),
      scope: X_OAUTH_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      // Force consent so X always returns a refresh token. Without this,
      // re-authorizing the same app returns an access token without a
      // refresh token, causing the connection to die after ~2 hours.
      prompt: "consent",
    });
    return { url: `${X_OAUTH_AUTHORIZE}?${params.toString()}`, state };
  }

  async handleCallback(code: string, state: string): Promise<XTokenRecord> {
    const pending = this.pendingVerifiers.get(state);
    if (!pending) throw new Error("Unknown or expired OAuth state. Please try connecting again.");
    this.pendingVerifiers.delete(state);

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: xClientId(),
      redirect_uri: xRedirectUri(),
      code_verifier: pending.verifier,
    });

    const authHeader: Record<string, string> = {};
    if (xClientSecret()) {
      authHeader["Authorization"] = `Basic ${Buffer.from(`${xClientId()}:${xClientSecret()}`).toString("base64")}`;
    }

    let res: Response;
    try {
      res = await fetch(X_OAUTH_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeader },
        body: body.toString(),
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      log.error("x-social.token-exchange-failed", err, { teacherId: pending.teacherId });
      throw new Error("Failed to reach X. Please try again.");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error("x-social.token-exchange-error", new Error(text), {
        teacherId: pending.teacherId,
        status: res.status,
      });
      throw new Error(`X rejected the authorization (${res.status}). Please try connecting again.`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const user = await this.fetchXUser(data.access_token);

    const record: XTokenRecord = {
      teacherId: pending.teacherId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
      scope: data.scope,
      xUserId: user.id,
      xScreenName: user.username,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tokens.set(pending.teacherId, record);
    await this.tokenStore.save(record);
    log.event("x-social.connected", { teacherId: pending.teacherId, xScreenName: user.username });
    return record;
  }

  async disconnect(teacherId: string): Promise<void> {
    const token = this.tokens.get(teacherId);
    if (token) {
      try {
        await fetch(X_REVOKE, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: token.accessToken,
            client_id: xClientId(),
          }).toString(),
          signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
        });
      } catch { /* best-effort */ }
    }
    this.tokens.delete(teacherId);
    this.postCounts.delete(teacherId);
    this.lastPhotoDate.delete(teacherId);
    await this.tokenStore.delete(teacherId);

    // Reassign any pending photos assigned to this teacher over to Ruby.
    // Uses the runtime's getService to avoid circular imports.
    if (teacherId !== "ruby" && this.runtime) {
      try {
        const rubySvc = (this.runtime as any).getService?.("ruby-high") as { reassignPendingPhotos?: (from: string, to: string) => number } | undefined;
        if (rubySvc?.reassignPendingPhotos) {
          const count = rubySvc.reassignPendingPhotos(teacherId, "ruby");
          if (count > 0) {
            log.event("x-social.photos-reassigned", { fromTeacher: teacherId, toTeacher: "ruby", count });
          }
        }
      } catch { /* reassignment is best-effort */ }
    }
    log.event("x-social.disconnected", { teacherId });
  }

  /** Import pre-existing tokens (admin debug; bypasses OAuth/PKCE flow). */
  async importToken(params: {
    teacherId: string;
    accessToken: string;
    refreshToken: string;
    xUserId?: string;
    xScreenName?: string;
  }): Promise<{ xUserId: string; xScreenName: string }> {
    if (!params.accessToken || !params.refreshToken || !params.teacherId) {
      throw new Error("teacherId, accessToken, and refreshToken are required.");
    }
    const record: XTokenRecord = {
      teacherId: params.teacherId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      expiresAt: Date.now() + 7200 * 1000,
      scope: "tweet.read tweet.write users.read offline.access media.write",
      xUserId: params.xUserId ?? "imported",
      xScreenName: params.xScreenName ?? "imported",
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.tokenStore.save(record);
    this.tokens.set(params.teacherId, record);
    try {
      const user = await this.fetchXUser(params.accessToken);
      record.xUserId = user.id;
      record.xScreenName = user.username;
      await this.tokenStore.save(record);
    } catch { /* keep fallback values */ }
    return { xUserId: record.xUserId, xScreenName: record.xScreenName };
  }

  getStatus(teacherId: string): XSocialStatus {
    const token = this.tokens.get(teacherId);
    return {
      connected: !!token,
      teacherId,
      xScreenName: token?.xScreenName,
      connectedAt: token?.connectedAt,
      ...(token ? {
        hasMediaWrite: tokenHasScope(token, "media.write"),
        hasTweetWrite: tokenHasScope(token, "tweet.write"),
        ...(token.postPausedReason ? { postPausedReason: token.postPausedReason } : {}),
        ...(token.postPausedAt ? { postPausedAt: token.postPausedAt } : {}),
        ...(token.postPausedUntil ? { postPausedUntil: token.postPausedUntil } : {}),
        ...(token.lastPostFailureStatus ? { lastPostFailureStatus: token.lastPostFailureStatus } : {}),
        ...(token.lastPostFailureAt ? { lastPostFailureAt: token.lastPostFailureAt } : {}),
      } : {}),
    };
  }

  listConnected(): XSocialStatus[] {
    return Array.from(this.tokens.keys()).map((id) => this.getStatus(id));
  }

  // ── Posting ─────────────────────────────────────────────────────────────

  async maybePostMilestone(
    teacher: TeacherCharacter,
    ctx: XMilestoneContext,
    opts?: { dryRun?: boolean },
  ): Promise<string | null> {
    const isDryRun = opts?.dryRun ?? process.env.RUBY_HIGH_X_DRY_RUN === "1";
    const token = this.tokens.get(teacher.id);
    if (!token) return null;

    const referenceImageUrl = ctx.imageUrl ?? ctx.portraitUrl ?? ctx.diplomaUrl ?? null;
    const reserveDailyPhotoSlot = !!referenceImageUrl && (ctx.reserveDailyPhotoSlot ?? milestoneUsesDailyPhotoSlot(ctx.kind));
    let reservedPhotoSlot = false;
    if (reserveDailyPhotoSlot) {
      if (this.photoAlreadyPostedToday(teacher.id)) {
        log.event("x-social.photo-already-today", { teacherId: teacher.id, kind: ctx.kind });
        return null;
      }
      // Reserve the photo slot before async work so concurrent photo posts do
      // not both pass the one-photo-per-day gate.
      await this.reservePhotoSlot(teacher.id);
      reservedPhotoSlot = true;
    }

    const releasePhotoSlot = async () => {
      if (reservedPhotoSlot) {
        await this.releasePhotoSlot(teacher.id);
        reservedPhotoSlot = false;
      }
    };

    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) {
      await releasePhotoSlot();
      return null;
    }
    const postToken = await this.ensurePostAllowed(freshToken);
    if (!postToken) {
      await releasePhotoSlot();
      return null;
    }

    const text = await this.generatePostText(teacher, ctx);

    // Content safety: validate the generated text before posting.
    if (!text || text.trim().length === 0) {
      log.event("x-social.text-rejected", { reason: "empty" });
      await releasePhotoSlot();
      return null;
    }
    if (text.length > 280) {
      log.event("x-social.text-rejected", { reason: "too-long", length: text.length });
      await releasePhotoSlot();
      return null;
    }
    // Guard against LLM hallucinating the system prompt into the tweet.
    // Use a longer slice (80 chars) of the system prompt to avoid false
    // positives from common English phrases like "You are running the".
    if (teacher.systemPrompt && teacher.systemPrompt.length >= 80 && text.includes(teacher.systemPrompt.slice(20, 100))) {
      log.event("x-social.text-rejected", { reason: "system-prompt-leak" });
      await releasePhotoSlot();
      return null;
    }
    // Guard against tweets missing the student's name.
    if (ctx.characterName && !text.includes(ctx.characterName)) {
      log.event("x-social.text-rejected", { reason: "missing-name", characterName: ctx.characterName });
      // Don't reject — the fallback template will handle it. Just log.
    }

    if (!isDryRun && !this.checkPostRateLimit(teacher.id)) {
      log.event("x-social.rate-limited", { teacherId: teacher.id, kind: ctx.kind });
      await releasePhotoSlot();
      return null;
    }

    // Public X media is fail-closed: raw portraits, diplomas, class photos,
    // and configured fallback art may be identity references, but never the
    // final upload. Every real post must first render a new campus scene.
    let mediaId: string | null = null;
    if (!isDryRun) {
      const locationImage = ctx.kind === "class-passed"
        && ctx.className
        && ctx.studentImageUrl
        && ctx.teacherImageUrl
        ? await this.generateClassPassedPhoto(ctx)
        : await this.generateRubyHighLocationPhoto({
            teacher,
            kind: ctx.kind,
            storyBeat: text,
            grade: ctx.grade ?? ctx.toGrade,
            sourceImageUrl: referenceImageUrl ?? ctx.studentImageUrl,
            sourceName: ctx.kind === "class-photo" ? `${ctx.characterName}'s class` : ctx.characterName,
            sourceRole: ctx.kind === "class-photo" ? "group" : "student",
          });
      if (!locationImage) {
        log.event("x-social.location-photo-required", { teacherId: teacher.id, kind: ctx.kind });
        await releasePhotoSlot();
        return null;
      }
      mediaId = await this.uploadRequiredMedia(postToken, locationImage, ctx.kind);
      if (!mediaId) {
        await releasePhotoSlot();
        return null;
      }
    }

    if (isDryRun) {
      log.event("x-social.dry-run", {
        teacherId: teacher.id,
        xScreenName: token.xScreenName,
        kind: ctx.kind,
        text: text.slice(0, 200),
        ...(mediaId ? { mediaId } : {}),
      });
      await releasePhotoSlot();
      return `dry-run:${ctx.kind}`;
    }

    const tweetId = await this.postTweet(postToken, text, mediaId);

    if (tweetId) {
      this.recordPost(teacher.id);
      // The photo slot was already reserved optimistically above.
      log.event("x-social.posted", {
        teacherId: teacher.id,
        xScreenName: token.xScreenName,
        kind: ctx.kind,
        tweetId,
        ...(mediaId ? { mediaId } : {}),
      });
      this.analytics.enqueueFetch(tweetId, Date.now());
    }

    if (!tweetId) await releasePhotoSlot();
    return tweetId;
  }

  // ── Media upload ────────────────────────────────────────────────────────

  private async uploadRequiredMedia(token: XTokenRecord, imageUrl: GeneratedRubyHighLocationImageUrl | null | undefined, kind: string): Promise<string | null> {
    if (!imageUrl) {
      log.event("x-social.media-required", { teacherId: token.teacherId, kind });
      return null;
    }
    try {
      const imageBytes = await this.resolveImageToBuffer(imageUrl);
      return await this.uploadMedia(token, imageBytes);
    } catch (err) {
      log.error("x-social.media-upload-failed", err, { teacherId: token.teacherId, kind });
      return null;
    }
  }

  private async generateClassPassedPhoto(ctx: XMilestoneContext): Promise<GeneratedRubyHighLocationImageUrl | null> {
    const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";
    if (!apiKey || !ctx.className || !ctx.studentImageUrl || !ctx.teacherImageUrl) {
      log.event("x-social.class-passed-composition-unavailable", {
        hasApiKey: !!apiKey,
        hasClassName: !!ctx.className,
        hasStudentImage: !!ctx.studentImageUrl,
        hasTeacherImage: !!ctx.teacherImageUrl,
      });
      return null;
    }
    const { renderClassPassedPhoto } = await import("./character-generation.js");
    try {
      const imageUrl = await renderClassPassedPhoto({
        apiKey,
        student: {
          name: ctx.characterName,
          imageUrl: ctx.studentImageUrl,
        },
        teacher: {
          name: ctx.teacherName || "Ruby High teacher",
          imageUrl: ctx.teacherImageUrl,
        },
        className: ctx.className,
        subjects: ctx.classSubjects ?? [],
        grade: ctx.grade,
        letterGrade: ctx.letterGrade,
      });
      return generatedLocationImageUrl(imageUrl);
    } catch (err) {
      log.error("x-social.class-passed-composition-failed", err, {
        className: ctx.className,
        teacherFacultyId: ctx.teacherFacultyId,
      });
      return null;
    }
  }

  private async generateRubyHighLocationPhoto(args: {
    teacher: TeacherCharacter;
    kind: string;
    storyBeat: string;
    grade?: string;
    area?: "classroom" | "teacher-lounge";
    sourceImageUrl?: string | null;
    sourceName?: string;
    sourceRole?: "student" | "group";
  }): Promise<GeneratedRubyHighLocationImageUrl | null> {
    const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";
    if (!apiKey) {
      log.event("x-social.location-photo-skipped", {
        teacherId: args.teacher.id,
        kind: args.kind,
        reason: "no-image-credential",
      });
      return null;
    }
    const references: Array<{
      role: "teacher" | "student" | "group";
      id: string;
      name: string;
      imageUrl: string;
    }> = [];
    if (args.sourceImageUrl) {
      references.push({
        role: args.sourceRole ?? "student",
        id: `source:${args.sourceName ?? args.kind}`,
        name: args.sourceName ?? "Featured Ruby High student",
        imageUrl: args.sourceImageUrl,
      });
    }
    const teacherImageUrl = defaultTeacherPostImageUrl(args.teacher.id);
    if (teacherImageUrl && !references.some((reference) => reference.imageUrl === teacherImageUrl)) {
      references.push({
        role: "teacher",
        id: args.teacher.id,
        name: args.teacher.displayName,
        imageUrl: teacherImageUrl,
      });
    }
    if (references.length === 0) {
      log.event("x-social.location-photo-skipped", {
        teacherId: args.teacher.id,
        kind: args.kind,
        reason: "no-visual-reference",
      });
      return null;
    }
    const { renderRubyHighSocialPhoto } = await import("./character-generation.js");
    try {
      const result = await renderRubyHighSocialPhoto({
        apiKey,
        kind: args.kind,
        storyBeat: args.storyBeat,
        grade: args.grade,
        area: args.area,
        references: references.slice(0, 4),
      });
      log.event("x-social.location-photo-generated", {
        teacherId: args.teacher.id,
        kind: args.kind,
        sceneId: result.sceneId,
        roomName: result.roomName,
      });
      return generatedLocationImageUrl(result.imageUrl);
    } catch (err) {
      log.error("x-social.location-photo-failed", err, {
        teacherId: args.teacher.id,
        kind: args.kind,
      });
      return null;
    }
  }

  /** Upload an image to X and return a media ID for tweet attachment. */
  private async uploadMedia(token: XTokenRecord, imageBytes: Buffer): Promise<string | null> {
    if (imageBytes.length > MAX_MEDIA_BYTES) {
      log.event("x-social.media-too-large", { bytes: imageBytes.length });
      return null;
    }

    // Determine MIME type from magic bytes.
    const mimeType = this.detectImageMime(imageBytes);
    const v2MediaId = await this.uploadMediaV2(token, imageBytes, mimeType);
    if (v2MediaId) return v2MediaId;
    return this.uploadMediaLegacy(imageBytes, mimeType);
  }

  private async uploadMediaV2(token: XTokenRecord, imageBytes: Buffer, mimeType: string): Promise<string | null> {
    if (!tokenHasScope(token, "media.write")) {
      log.event("x-social.media-upload-skipped", {
        teacherId: token.teacherId,
        reason: "missing-media-write-scope",
      });
      return null;
    }
    try {
      const res = await fetch(X_MEDIA_UPLOAD, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          media: imageBytes.toString("base64"),
          media_category: "tweet_image",
          media_type: mimeType,
          shared: false,
        }),
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        log.error("x-social.media-upload-rejected", new Error(errText), {
          status: res.status,
          endpoint: "v2",
          teacherId: token.teacherId,
        });
        return null;
      }
      const data = (await res.json()) as { data?: { id?: string; media_id_string?: string } };
      return data.data?.id ?? data.data?.media_id_string ?? null;
    } catch (err) {
      log.error("x-social.media-upload-failed", err, { endpoint: "v2", teacherId: token.teacherId });
      return null;
    }
  }

  private async uploadMediaLegacy(imageBytes: Buffer, mimeType: string): Promise<string | null> {
    if (!hasOAuth1Credentials()) {
      log.event("x-social.media-upload-skipped", { reason: "missing-oauth1-credentials" });
      return null;
    }
    // X media upload v1.1 uses multipart form data.
    const boundary = "----RubyHighXUpload" + Date.now();
    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="media"; filename="ruby-high.${mimeType.split("/")[1] ?? "png"}"`,
      `Content-Type: ${mimeType}`,
      "",
      "",
    ].join("\r\n");
    const footer = `\r\n--${boundary}--\r\n`;

    const headerBytes = Buffer.from(header, "utf-8");
    const footerBytes = Buffer.from(footer, "utf-8");
    const body = Buffer.concat([headerBytes, imageBytes, footerBytes]);

    try {
      const headers: Record<string, string> = {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Authorization": oauth1AuthHeader(
          "POST", X_LEGACY_MEDIA_UPLOAD,
          process.env.RUBY_HIGH_X_CONSUMER_KEY!,
          process.env.RUBY_HIGH_X_CONSUMER_SECRET!,
          process.env.RUBY_HIGH_X_ACCESS_TOKEN!,
          process.env.RUBY_HIGH_X_ACCESS_SECRET!,
        ),
      };
      const res = await fetch(X_LEGACY_MEDIA_UPLOAD, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        log.error("x-social.media-upload-rejected", new Error(errText), { status: res.status, endpoint: "legacy" });
        return null;
      }
      const data = (await res.json()) as { media_id_string: string };
      return data.media_id_string;
    } catch (err) {
      log.error("x-social.media-upload-failed", err, { endpoint: "legacy" });
      return null;
    }
  }

  /** Resolve a portrait/diploma image reference to raw bytes.
   *  Handles data: URLs, relative /api/assets paths, and absolute https URLs. */
  private async resolveImageToBuffer(imageUrl: string): Promise<Buffer> {
    // Data URL: decode base64 directly.
    if (imageUrl.startsWith("data:")) {
      const comma = imageUrl.indexOf(",");
      if (comma === -1) throw new Error("Invalid data URL");
      const bytes = Buffer.from(imageUrl.slice(comma + 1), "base64");
      if (bytes.length > MAX_REMOTE_IMAGE_BYTES) throw new Error("Image is too large.");
      return bytes;
    }

    // Relative path: resolve against the public base.
    let url = imageUrl;
    if (url.startsWith("/")) {
      const base = process.env.RUBY_HIGH_PUBLIC_BASE?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
      url = `${base}${url}`;
    }

    return await fetchSafeImageBuffer(url, { maxBytes: MAX_REMOTE_IMAGE_BYTES });
  }

  /** Detect image MIME type from magic bytes. Defaults to image/png. */
  private detectImageMime(bytes: Buffer): string {
    if (bytes.length < 12) return "image/png";
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
    // GIF: 47 49 46
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return "image/png";
  }

  // ── Internal helpers ────────────────────────────────────────────────────


  private async fetchXUser(accessToken: string): Promise<{ id: string; username: string }> {
    const res = await fetch(`${X_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to fetch X user: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { data: { id: string; username: string } };
    return data.data;
  }

  private async ensureFreshToken(record: XTokenRecord): Promise<XTokenRecord | null> {
    const latest = this.tokens.get(record.teacherId) ?? record;
    if (latest.expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_SEC * 1000) {
      return latest;
    }
    if (!latest.refreshToken) {
      await this.disconnect(latest.teacherId);
      return null;
    }
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: latest.refreshToken,
        client_id: xClientId(),
      });
      const authHeader: Record<string, string> = {};
      if (xClientSecret()) {
        authHeader["Authorization"] = `Basic ${Buffer.from(`${xClientId()}:${xClientSecret()}`).toString("base64")}`;
      }
      const res = await fetch(X_OAUTH_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeader },
        body: body.toString(),
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Only disconnect on auth failures (400/401); retry on transient errors.
        if (res.status === 400 || res.status === 401) {
          await this.disconnect(record.teacherId);
        }
        return null;
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };
      const updated: XTokenRecord = {
        ...latest,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? latest.refreshToken,
        expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
        updatedAt: Date.now(),
      };
      this.tokens.set(latest.teacherId, updated);
      await this.tokenStore.save(updated);
      return updated;
    } catch (err) {
      log.error("x-social.token-refresh-failed", err, { teacherId: latest.teacherId });
      return null;
    }
  }

  private async ensurePostAllowed(token: XTokenRecord): Promise<XTokenRecord | null> {
    let latest = this.tokens.get(token.teacherId) ?? token;
    if (latest.postPausedReason) {
      if (!latest.postPausedUntil || latest.postPausedUntil > Date.now()) {
        log.event("x-social.post-suppressed", {
          teacherId: latest.teacherId,
          reason: latest.postPausedReason,
          ...(latest.postPausedUntil ? { retryAt: latest.postPausedUntil } : {}),
          ...(latest.lastPostFailureStatus ? { status: latest.lastPostFailureStatus } : {}),
        });
        return null;
      }
      latest = await this.clearPostPause(latest);
    }

    if (!tokenHasScope(latest, "tweet.write")) {
      await this.markPostPaused(latest, "missing-tweet-write-scope");
      log.event("x-social.post-suppressed", {
        teacherId: latest.teacherId,
        reason: "missing-tweet-write-scope",
      });
      return null;
    }

    return latest;
  }

  private async markPostPaused(
    token: XTokenRecord,
    reason: string,
    opts: { status?: number; retryAt?: number } = {},
  ): Promise<XTokenRecord> {
    const now = Date.now();
    const latest = this.tokens.get(token.teacherId) ?? token;
    const updated: XTokenRecord = {
      ...latest,
      postPausedReason: reason,
      postPausedAt: now,
      lastPostFailureAt: now,
      updatedAt: now,
    };
    if (opts.retryAt) updated.postPausedUntil = opts.retryAt;
    else delete updated.postPausedUntil;
    if (opts.status) updated.lastPostFailureStatus = opts.status;
    else delete updated.lastPostFailureStatus;

    this.tokens.set(updated.teacherId, updated);
    await this.tokenStore.save(updated);
    return updated;
  }

  private async recordPostRejection(token: XTokenRecord, status?: number): Promise<XTokenRecord> {
    const now = Date.now();
    const latest = this.tokens.get(token.teacherId) ?? token;
    const updated: XTokenRecord = {
      ...latest,
      lastPostFailureAt: now,
      updatedAt: now,
    };
    delete updated.postPausedReason;
    delete updated.postPausedAt;
    delete updated.postPausedUntil;
    if (status) updated.lastPostFailureStatus = status;
    else delete updated.lastPostFailureStatus;

    this.tokens.set(updated.teacherId, updated);
    await this.tokenStore.save(updated);
    return updated;
  }

  private async clearPostPause(token: XTokenRecord): Promise<XTokenRecord> {
    const latest = this.tokens.get(token.teacherId) ?? token;
    if (
      !latest.postPausedReason &&
      !latest.postPausedAt &&
      !latest.postPausedUntil &&
      !latest.lastPostFailureStatus &&
      !latest.lastPostFailureAt
    ) {
      return latest;
    }
    const updated: XTokenRecord = { ...latest, updatedAt: Date.now() };
    delete updated.postPausedReason;
    delete updated.postPausedAt;
    delete updated.postPausedUntil;
    delete updated.lastPostFailureStatus;
    delete updated.lastPostFailureAt;

    this.tokens.set(updated.teacherId, updated);
    await this.tokenStore.save(updated);
    return updated;
  }

  private classifyPostFailure(status: number, body: string, res: Response): XPostFailureClassification {
    const lower = body.toLowerCase();
    if (
      (status === 400 || status === 403) &&
      (lower.includes("duplicate") || lower.includes("already been posted") || lower.includes("already tweeted"))
    ) {
      return { logName: "x-social.post-duplicate" };
    }
    if (status === 401) return { logName: "x-social.post-auth-failed", pauseReason: "unauthorized" };
    if (status === 403) return { logName: "x-social.post-forbidden", pauseReason: "forbidden" };
    if (status === 429) {
      return {
        logName: "x-social.post-rate-limited",
        pauseReason: "rate-limited",
        retryAt: retryAtFromResponse(res) ?? Date.now() + X_POST_RATE_LIMIT_RETRY_MS,
      };
    }
    if (status >= 500) {
      return {
        logName: "x-social.post-transient-failed",
        pauseReason: "x-unavailable",
        retryAt: Date.now() + X_POST_TRANSIENT_RETRY_MS,
      };
    }
    return { logName: "x-social.post-rejected" };
  }

  private async postTweet(token: XTokenRecord, text: string, mediaId: string | null): Promise<string | null> {
    const postToken = await this.ensurePostAllowed(token);
    if (!postToken) return null;
    if (!mediaId) {
      log.event("x-social.media-required", { teacherId: postToken.teacherId, kind: "post" });
      return null;
    }

    try {
      const body: Record<string, unknown> = { text };
      body.media = { media_ids: [mediaId] };
      const res = await fetch(`${X_API_BASE}/tweets`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${postToken.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const classification = this.classifyPostFailure(res.status, errText, res);
        log.error(classification.logName, new Error(clippedPostErrorBody(res.status, errText)), {
          teacherId: postToken.teacherId,
          status: res.status,
          ...(classification.pauseReason ? { reason: classification.pauseReason } : {}),
          ...(classification.retryAt ? { retryAt: classification.retryAt } : {}),
        });
        if (classification.pauseReason) {
          await this.markPostPaused(postToken, classification.pauseReason, {
            status: res.status,
            retryAt: classification.retryAt,
          });
        } else {
          await this.recordPostRejection(postToken, res.status);
        }
        return null;
      }
      const data = (await res.json()) as { data: { id: string } };
      await this.clearPostPause(postToken);
      return data.data.id;
    } catch (err) {
      const retryAt = Date.now() + X_POST_NETWORK_RETRY_MS;
      log.error("x-social.post-network-failed", err, { teacherId: postToken.teacherId, retryAt });
      await this.markPostPaused(postToken, "network", { retryAt });
      return null;
    }
  }

  private checkPostRateLimit(teacherId: string): boolean {
    const now = Date.now();
    const entry = this.postCounts.get(teacherId);
    if (!entry || now >= entry.resetAt) {
      return true;
    }
    if (entry.count >= X_POSTS_PER_24H) return false;
    return true;
  }

  private recordPost(teacherId: string): void {
    const now = Date.now();
    const entry = this.postCounts.get(teacherId);
    if (!entry || now >= entry.resetAt) {
      this.postCounts.set(teacherId, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
      return;
    }
    entry.count += 1;
  }

  private photoAlreadyPostedToday(teacherId: string): boolean {
    return this.lastPhotoDate.get(teacherId) === todayKey();
  }

  private async reservePhotoSlot(teacherId: string): Promise<void> {
    const token = this.tokens.get(teacherId);
    const date = todayKey();
    this.lastPhotoDate.set(teacherId, date);
    if (!token) return;
    const updated: XTokenRecord = { ...token, lastPhotoDate: date, updatedAt: Date.now() };
    this.tokens.set(teacherId, updated);
    await this.tokenStore.save(updated);
  }

  private async releasePhotoSlot(teacherId: string): Promise<void> {
    this.lastPhotoDate.delete(teacherId);
    const token = this.tokens.get(teacherId);
    if (!token) return;
    const { lastPhotoDate: _lastPhotoDate, ...rest } = token;
    const updated: XTokenRecord = { ...rest, updatedAt: Date.now() };
    this.tokens.set(teacherId, updated);
    await this.tokenStore.save(updated);
  }

  /** Generate post text — deterministic templates for low-signal milestones,
   *  LLM for high-signal ones (graduations, portraits, diplomas, etc.).
   *  This cuts ~60-70% of LLM API calls with zero quality loss. */
  private async generatePostText(teacher: TeacherCharacter, ctx: XMilestoneContext): Promise<string> {
    if (isLowSignalMilestone(ctx.kind)) {
      return buildDeterministicPostText(teacher, ctx);
    }
    return generateLlmPostText(teacher, ctx);
  }

  /** Try posting with the assigned teacher. If that teacher can't post,
   *  walk the connected teacher list and try the next one. Returns the
   *  tweetId and the teacher that actually posted (or null). */
  async maybePostMilestoneWithFallback(
    teacher: TeacherCharacter,
    ctx: XMilestoneContext,
    opts?: { dryRun?: boolean },
  ): Promise<{ tweetId: string; teacherId: string } | null> {
    // Try assigned teacher first.
    const result = await this.maybePostMilestone(teacher, ctx, opts);
    if (result) return { tweetId: result, teacherId: teacher.id };

    // Walk through connected teachers looking for a working fallback.
    const connected = this.listConnected().filter(
      (s) => s.teacherId !== teacher.id && s.connected && s.hasTweetWrite,
    );
    for (const status of connected) {
      const fallback = teacherById(status.teacherId);
      if (!fallback) continue;
      const fbResult = await this.maybePostMilestone(fallback, ctx, opts);
      if (fbResult) {
        log.event("x-social.fallback-posted", {
          assignedTeacher: teacher.id,
          fallbackTeacher: fallback.id,
          kind: ctx.kind,
        });
        return { tweetId: fbResult, teacherId: fallback.id };
      }
    }
    return null;
  }

  /** Fetch pending metrics for all teachers. Called periodically by the scheduler. */
  async fetchAllPendingMetrics(): Promise<number> {
    let total = 0;
    for (const [, token] of this.tokens) {
      try {
        const freshToken = await this.ensureFreshToken(token);
        if (!freshToken) continue;
        total += await this.analytics.fetchPendingMetrics(freshToken.accessToken);
      } catch {
        // Best-effort — token may be stale.
      }
    }
    return total;
  }

  /** Get analytics for content optimization. */
  getPostAnalytics(): PostAnalytics {
    return this.analytics;
  }

  /** Ask the social editor agent for a durable seven-day calendar. Guest
   *  source posts are fetched before planning so the plan can reserve distinct,
   *  source-grounded angles instead of rediscovering one theme every day. */
  async planScheduledSchoolUpdates(
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    recentPosts: RecentPlannedPost[],
    now = Date.now(),
  ): Promise<ScheduledTweetPlan | null> {
    const token = this.tokens.get(teacher.id);
    if (!token) return null;
    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;
    const sourcedContext = context.featuredGuest?.xHandle
      ? await this.withRecentFeaturedGuestXPosts(freshToken, context)
      : context;
    return generateScheduledTweetPlan(teacher, sourcedContext, recentPosts, now);
  }

  /** Publish an LLM-written update from aggregate, privacy-filtered school
   *  activity. Unlike milestone posting, this accepts the generated copy as
   *  the source of truth instead of regenerating unrelated milestone text. */
  async postScheduledSchoolUpdate(
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    opts?: ScheduledSchoolUpdatePostOptions,
  ): Promise<string | null> {
    const result = await this.postScheduledSchoolUpdateDetailed(teacher, context, opts);
    return result?.tweetId ?? null;
  }

  private async postScheduledSchoolUpdateDetailed(
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    opts?: ScheduledSchoolUpdatePostOptions,
  ): Promise<ScheduledSchoolUpdatePublishResult | null> {
    const token = this.tokens.get(teacher.id);
    if (!token) return null;
    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;
    const postToken = await this.ensurePostAllowed(freshToken);
    if (!postToken) return null;
    const postKind = opts?.plannedSlot?.pillar === "guest-spotlight"
      ? "guest-insights"
      : opts?.editorialMode ?? "school-update";

    const sourcedContext = postKind === "guest-insights"
      ? await this.withRecentFeaturedGuestXPosts(postToken, context)
      : context;
    const generatedText = await generateScheduledSchoolUpdateText(teacher, sourcedContext, {
      editorialMode: opts?.editorialMode,
      plannedSlot: opts?.plannedSlot,
      recentPosts: opts?.recentPosts,
    });
    if (!generatedText) {
      log.event("x-social.scheduled-text-skipped", { teacherId: teacher.id });
      return null;
    }
    const acquisitionRef = scheduledSchoolUpdateAcquisitionRef(postKind);
    const text = appendScheduledSchoolUpdateLink(
      generatedText,
      scheduledSchoolUpdateActivationUrl(postKind),
    );
    if (!text) {
      log.event("x-social.scheduled-text-skipped", { teacherId: teacher.id, reason: "activation-link" });
      return null;
    }
    if (
      teacher.systemPrompt &&
      teacher.systemPrompt.length >= 80 &&
      text.includes(teacher.systemPrompt.slice(20, 100))
    ) {
      log.event("x-social.text-rejected", { reason: "system-prompt-leak", kind: "school-update" });
      return null;
    }

    const isDryRun = opts?.dryRun ?? process.env.RUBY_HIGH_X_DRY_RUN === "1";
    if (isDryRun) {
      log.event("x-social.dry-run", {
        teacherId: teacher.id,
        xScreenName: token.xScreenName,
        kind: postKind,
        acquisitionRef,
        text: text.slice(0, 200),
      });
      return { tweetId: "dry-run:school-update", text };
    }
    if (!this.checkPostRateLimit(teacher.id)) {
      log.event("x-social.rate-limited", { teacherId: teacher.id, kind: postKind });
      return null;
    }

    const generatedImageUrl = await this.generateScheduledSchoolUpdatePhoto(
      teacher,
      sourcedContext,
      generatedText,
    );
    if (!generatedImageUrl) {
      log.event("x-social.location-photo-required", { teacherId: teacher.id, kind: postKind });
      return null;
    }
    const mediaId = await this.uploadRequiredMedia(postToken, generatedImageUrl, postKind);
    if (!mediaId) return null;

    const tweetId = await this.postTweet(postToken, text, mediaId);
    if (tweetId) {
      this.recordPost(teacher.id);
      log.event("x-social.posted", {
        teacherId: teacher.id,
        xScreenName: token.xScreenName,
        kind: postKind,
        tweetId,
        mediaId,
        acquisitionRef,
      });
      this.analytics.enqueueFetch(tweetId, Date.now());
    }
    return tweetId ? { tweetId, text } : null;
  }

  private async withRecentFeaturedGuestXPosts(
    token: XTokenRecord,
    context: ScheduledSchoolUpdateContext,
  ): Promise<ScheduledSchoolUpdateContext> {
    const guest = context.featuredGuest;
    const handle = normalizeXHandle(guest?.xHandle);
    if (!guest || !handle) return context;

    const cacheKey = handle.toLowerCase();
    const cached = this.guestXPostsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 6 * 60 * 60 * 1000) {
      return {
        ...context,
        featuredGuest: { ...guest, recentXPosts: cached.posts },
      };
    }

    try {
      const userResponse = await fetch(
        `${X_API_BASE}/users/by/username/${encodeURIComponent(handle)}`,
        {
          headers: { Authorization: `Bearer ${token.accessToken}` },
          signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
        },
      );
      if (!userResponse.ok) {
        log.event("x-social.featured-guest-read-skipped", {
          handle,
          stage: "user",
          status: userResponse.status,
        });
        return context;
      }
      const userData = await userResponse.json() as { data?: { id?: string } };
      const userId = userData.data?.id;
      if (!userId) return context;

      const postsResponse = await fetch(
        `${X_API_BASE}/users/${encodeURIComponent(userId)}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at`,
        {
          headers: { Authorization: `Bearer ${token.accessToken}` },
          signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
        },
      );
      if (!postsResponse.ok) {
        log.event("x-social.featured-guest-read-skipped", {
          handle,
          stage: "posts",
          status: postsResponse.status,
        });
        return context;
      }
      const postsData = await postsResponse.json() as {
        data?: Array<{ id?: string; created_at?: string; text?: string }>;
      };
      const contextTime = Date.parse(`${context.date}T23:59:59.999Z`);
      const cutoff = (Number.isFinite(contextTime) ? contextTime : now) - 8 * 24 * 60 * 60 * 1000;
      const posts = (postsData.data ?? [])
        .flatMap((post) => {
          const id = typeof post.id === "string" ? post.id : "";
          const createdAt = typeof post.created_at === "string" ? post.created_at : "";
          const createdAtMs = Date.parse(createdAt);
          const text = compactXSourceText(post.text);
          return id && text && Number.isFinite(createdAtMs) && createdAtMs >= cutoff
            ? [{ id, createdAt, text }]
            : [];
        })
        .slice(0, 5);
      this.guestXPostsCache.set(cacheKey, { fetchedAt: now, posts });
      log.event("x-social.featured-guest-read", { handle, postCount: posts.length });
      return {
        ...context,
        featuredGuest: { ...guest, xHandle: handle, recentXPosts: posts },
      };
    } catch (err) {
      log.error("x-social.featured-guest-read-failed", err, { handle });
      return context;
    }
  }

  private async generateScheduledSchoolUpdatePhoto(
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    postText: string,
  ): Promise<GeneratedRubyHighLocationImageUrl | null> {
    const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";
    if (!apiKey) {
      log.event("x-social.scheduled-photo-skipped", { teacherId: teacher.id, reason: "no-image-credential" });
      return null;
    }
    const participants = scheduledSchoolUpdatePhotoParticipants(teacher, context);
    if (participants.length < 2) {
      log.event("x-social.scheduled-photo-skipped", { teacherId: teacher.id, reason: "insufficient-cast" });
      return null;
    }
    try {
      const { renderScheduledSchoolUpdatePhoto } = await import("./character-generation.js");
      const imageUrl = await renderScheduledSchoolUpdatePhoto({
        apiKey,
        postText,
        context,
        participants,
      });
      log.event("x-social.scheduled-photo-generated", {
        teacherId: teacher.id,
        participantCount: participants.length,
        area: context.activeRooms.some((room) => room.area === "teacher-lounge")
          ? "teacher-lounge"
          : "classroom",
      });
      return generatedLocationImageUrl(imageUrl);
    } catch (err) {
      log.error("x-social.scheduled-photo-failed", err, { teacherId: teacher.id });
      return null;
    }
  }

  async postScheduledSchoolUpdateWithFallback(
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    opts?: ScheduledSchoolUpdatePostOptions,
  ): Promise<{ tweetId: string; teacherId: string; text: string } | null> {
    const result = await this.postScheduledSchoolUpdateDetailed(teacher, context, opts);
    if (result) return { ...result, teacherId: teacher.id };

    const connected = this.listConnected().filter(
      (status) => status.teacherId !== teacher.id && status.connected && status.hasTweetWrite,
    );
    for (const status of connected) {
      const fallback = teacherById(status.teacherId);
      if (!fallback) continue;
      const fallbackResult = await this.postScheduledSchoolUpdateDetailed(fallback, context, opts);
      if (!fallbackResult) continue;
      log.event("x-social.fallback-posted", {
        assignedTeacher: teacher.id,
        fallbackTeacher: fallback.id,
        kind: "school-update",
      });
      return { ...fallbackResult, teacherId: fallback.id };
    }
    return null;
  }

  /** Post a teacher's reflection on today's school memories. Admin-triggered
   *  via the admin panel "Post" button. Generates a tweet in the teacher's
   *  voice based on what happened at school today. */
  async postReflection(
    teacher: TeacherCharacter,
    memories: { date: string; charactersCreated: string[]; classesPassed: Array<{ studentName: string; facultyId?: string; letterGrade?: string }>; gradesAdvanced: Array<{ studentName: string; fromGrade?: string; toGrade?: string }>; graduations: string[]; totalStudents: number; totalQuestionsAnswered: number },
    opts?: { dryRun?: boolean; imageUrl?: string },
  ): Promise<string | null> {
    const token = this.tokens.get(teacher.id);
    if (!token) return null;
    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;

    const isDryRun = opts?.dryRun ?? process.env.RUBY_HIGH_X_DRY_RUN === "1";
    const text = await this.generateReflectionText(teacher, memories);

    if (!text || text.trim().length === 0) {
      log.event("x-social.text-rejected", { reason: "empty" });
      return null;
    }
    if (text.length > 280) {
      log.event("x-social.text-rejected", { reason: "too-long", length: text.length });
      return null;
    }

    if (isDryRun) {
      log.event("x-social.dry-run", { teacherId: teacher.id, kind: "reflection", text: text.slice(0, 200) });
      return "dry-run:reflection";
    }

    const locationImage = await this.generateRubyHighLocationPhoto({
      teacher,
      kind: "reflection",
      storyBeat: text,
      area: "teacher-lounge",
      sourceImageUrl: opts?.imageUrl,
      sourceName: "Featured Ruby High school moment",
      sourceRole: "group",
    });
    if (!locationImage) return null;
    const mediaId = await this.uploadRequiredMedia(freshToken, locationImage, "reflection");
    if (!mediaId) return null;

    const tweetId = await this.postTweet(freshToken, text, mediaId);
    if (tweetId) {
      log.event("x-social.posted", { teacherId: teacher.id, xScreenName: token.xScreenName, kind: "reflection", tweetId, mediaId });
      this.analytics.enqueueFetch(tweetId, Date.now());
    }
    return tweetId;
  }

  private async generateReflectionText(
    teacher: TeacherCharacter,
    memories: { date: string; charactersCreated: string[]; classesPassed: Array<{ studentName: string; facultyId?: string; letterGrade?: string }>; gradesAdvanced: Array<{ studentName: string; fromGrade?: string; toGrade?: string }>; graduations: string[]; totalStudents: number; totalQuestionsAnswered: number },
  ): Promise<string> {
    const lines: string[] = [
      `You are ${teacher.displayName}, a teacher at Ruby High. Here's what happened at school today:`,
      "",
    ];
    if (memories.charactersCreated.length > 0) {
      lines.push(`New students: ${memories.charactersCreated.join(", ")}`);
    }
    if (memories.classesPassed.length > 0) {
      const classLines = memories.classesPassed.map((c) => `${c.studentName} passed ${c.facultyId ?? "class"} (${c.letterGrade})`);
      lines.push(`Classes passed: ${classLines.join("; ")}`);
    }
    if (memories.gradesAdvanced.length > 0) {
      const advLines = memories.gradesAdvanced.map((g) => `${g.studentName} advanced to ${g.toGrade}`);
      lines.push(`Grade advancements: ${advLines.join("; ")}`);
    }
    if (memories.graduations.length > 0) {
      lines.push(`Graduations: ${memories.graduations.join(", ")}`);
    }
    if (memories.totalQuestionsAnswered > 0) {
      lines.push(`Total questions answered: ${memories.totalQuestionsAnswered}`);
    }
    lines.push(`${memories.totalStudents} students enrolled.`);
    lines.push("");
    lines.push(`Write a single tweet (max 270 chars) reflecting on today at Ruby High. Sound like yourself — warm, in character. Mention standout students by name if any. End with #RubyHigh.`);
    lines.push("");
    lines.push("Tweet:");

    const prompt = lines.join("\n");

    if (hasConfiguredLlmCredential()) {
      try {
        const response = await fetchLlmChatCompletions({
          body: {
            model: DEFAULT_OPENROUTER_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.7,
          },
          timeoutMs: 15_000,
          label: "x-social-reflection",
        });
        if (response.ok) {
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
          if (text && text.length <= 280) return text;
          if (text) return text.slice(0, 277) + "...";
        }
      } catch (err) {
        log.error("x-social.llm-failed", err, { kind: "reflection" });
      }
    }

    // Fallback
    const parts: string[] = [];
    if (memories.charactersCreated.length > 0) {
      parts.push(`Welcome to our new student${memories.charactersCreated.length > 1 ? "s" : ""}, ${memories.charactersCreated.join(", ")}!`);
    }
    if (memories.classesPassed.length > 0) {
      const names = [...new Set(memories.classesPassed.map((c) => c.studentName))];
      parts.push(`${names.join(", ")} put in solid work today.`);
    }
    if (memories.graduations.length > 0) {
      parts.push(`Congratulations to our graduate${memories.graduations.length > 1 ? "s" : ""}, ${memories.graduations.join(", ")}!`);
    }
    if (parts.length === 0) {
      parts.push(`Another day at Ruby High. ${memories.totalStudents} students, ${memories.totalQuestionsAnswered} questions answered.`);
    }
    parts.push("#RubyHigh");
    return parts.join(" ");
  }

  /** Post a student's report card in the teacher's voice. Includes stats,
   *  class grades, and yearbook progress. */
  async postReportCard(
    teacher: TeacherCharacter,
    student: { name: string; playbookId: string; grade: string; stats: Record<string, number>; classGrades: Record<string, string>; yearbookCount: number; portraitUrl?: string },
  ): Promise<string | null> {
    const token = this.tokens.get(teacher.id);
    if (!token) return null;
    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;

    const gradeLabel: Record<string, string> = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" };
    const gradeName = gradeLabel[student.grade] ?? `Grade ${student.grade}`;
    const statsLine = Object.entries(student.stats)
      .map(([k, v]) => `${k}: ${v >= 0 ? "+" : ""}${v}`)
      .join(" · ");
    const gradesLine = Object.entries(student.classGrades)
      .map(([fac, g]) => `${fac}: ${g}`)
      .join(" · ") || "no classes yet";

    const prompt = [
      `You are ${teacher.displayName}, a teacher at Ruby High. Post a single tweet (max 270 chars) about this student's report card. Sound like yourself — warm, in character. Use their name.`,
      "",
      `Student: ${student.name}`,
      `${gradeName} · ${student.playbookId}`,
      `Stats: ${statsLine}`,
      `Class grades: ${gradesLine}`,
      `Yearbook: ${student.yearbookCount}/4 years sealed`,
      "",
      "Tweet:",
    ].join("\n");

    let text = "";
    if (hasConfiguredLlmCredential()) {
      try {
        const response = await fetchLlmChatCompletions({
          body: {
            model: DEFAULT_OPENROUTER_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.6,
          },
          timeoutMs: 15_000,
          label: "x-social-report-card",
        });
        if (response.ok) {
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          text = data?.choices?.[0]?.message?.content?.trim() ?? "";
        }
      } catch (err) {
        log.error("x-social.llm-failed", err, { kind: "report-card" });
      }
    }

    if (!text || text.length > 280) {
      // Fallback
      text = `${student.name}'s ${gradeName} report — ${gradesLine || "just getting started"}. ${statsLine}. ${student.yearbookCount}/4 years sealed. #RubyHigh`;
      if (text.length > 280) text = text.slice(0, 277) + "...";
    }

    const locationImage = await this.generateRubyHighLocationPhoto({
      teacher,
      kind: "report-card",
      storyBeat: text,
      grade: student.grade,
      sourceImageUrl: student.portraitUrl ?? defaultStudentPostImageUrl(student.playbookId),
      sourceName: student.name,
      sourceRole: "student",
    });
    if (!locationImage) return null;
    const mediaId = await this.uploadRequiredMedia(freshToken, locationImage, "report-card");
    if (!mediaId) return null;

    const tweetId = await this.postTweet(freshToken, text, mediaId);
    if (tweetId) {
      log.event("x-social.posted", { teacherId: teacher.id, xScreenName: token.xScreenName, kind: "report-card", tweetId, mediaId });
      this.analytics.enqueueFetch(tweetId, Date.now());
    }
    return tweetId;
  }

  /** Generate a class photo composite image. Returns the image URL.
   *  The caller enqueues it into the daily photo pool — Ruby posts it
   *  on her one-per-day rhythm. */
  async generateClassPhoto(
    teacher: TeacherCharacter,
    studentImages: Array<{ name: string; imageUrl: string }>,
  ): Promise<string | null> {
    const token = this.tokens.get(teacher.id);
    if (!token) return null;
    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;

    // Check the one-photo-per-day limit, but do not reserve it here. The
    // actual post path owns reservation so generated photos can still tweet.
    if (this.photoAlreadyPostedToday(teacher.id)) {
      log.event("x-social.photo-already-today", { teacherId: teacher.id, kind: "class-photo" });
      return null;
    }

    const apiKey = process.env.RUBY_HIGH_OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";
    if (!apiKey) {
      log.event("x-social.class-photo-no-key", { teacherId: teacher.id });
      return null;
    }

    const { renderClassPhoto } = await import("./character-generation.js");
    try {
      const imageUrl = await renderClassPhoto({ apiKey, studentImages });
      log.event("x-social.class-photo-generated", { teacherId: teacher.id, count: studentImages.length });
      return imageUrl;
    } catch (err) {
      log.error("x-social.class-photo-failed", err, { teacherId: teacher.id });
      return null;
    }
  }
}
