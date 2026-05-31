import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { IAgentRuntime } from "../runtime.js";
import { Service } from "../runtime.js";
import { log } from "./logger.js";
import {
  fetchLlmChatCompletions,
  hasConfiguredLlmCredential,
} from "./llm-provider.js";
import type { TeacherCharacter } from "../characters/teachers.js";

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
  letterGrade?: string;
  arcAnswer?: string;
  flavorQuote?: string;
  portraitUrl?: string;
  diplomaUrl?: string;
  yearbookShareUrl?: string;
  fromGrade?: string;
  toGrade?: string;
}

export interface XSocialStatus {
  connected: boolean;
  teacherId: string;
  xScreenName?: string;
  connectedAt?: number;
}

interface XTokenStore {
  loadAll(): Promise<XTokenRecord[]>;
  save(record: XTokenRecord): Promise<void>;
  delete(teacherId: string): Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const X_API_BASE = "https://api.x.com/2";
const X_OAUTH_AUTHORIZE = "https://x.com/i/oauth2/authorize";
const X_OAUTH_TOKEN = "https://api.x.com/2/oauth2/token";
const X_REVOKE = "https://api.x.com/2/oauth2/revoke";
const X_MEDIA_UPLOAD = "https://upload.x.com/1.1/media/upload.json";
const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // X limit: 5 MB for images
const X_POSTS_PER_24H = 50;
const TOKEN_REFRESH_WINDOW_SEC = 300;
const X_FETCH_TIMEOUT_MS = 15_000;
function xClientId(): string { return process.env.RUBY_HIGH_X_CLIENT_ID ?? ""; }
function xClientSecret(): string { return process.env.RUBY_HIGH_X_CLIENT_SECRET ?? ""; }

function xRedirectUri(): string {
  const base = process.env.RUBY_HIGH_PUBLIC_BASE?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
  return `${base}/api/apps/ruby-high/x/callback`;
}

const X_OAUTH_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"].join(" ");

// ── Token Store Implementations ─────────────────────────────────────────────

function isDynamoBackend(): boolean {
  return process.env.RUBY_HIGH_STORE_BACKEND === "dynamodb";
}

function xTokenPk(teacherId: string): string {
  return `x:token:${teacherId}`;
}

class JsonXTokenStore implements XTokenStore {
  private filePath: string;

  constructor() {
    const dir = process.env.RUBY_HIGH_STATE_PATH ?? resolve(homedir(), ".ruby-high");
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
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf-8");
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

class DynamoXTokenStore implements XTokenStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const region = process.env.AWS_REGION ?? "us-east-1";
    this.tableName = process.env.RUBY_HIGH_DYNAMO_TABLE ?? "ruby-high-state";
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async loadAll(): Promise<XTokenRecord[]> {
    const records: XTokenRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :prefix)",
        ExpressionAttributeValues: { ":prefix": "x:token:" },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }));
      const items = (result.Items ?? []) as Array<Record<string, unknown>>;
      for (const item of items) {
        if (item.token && typeof item.token === "object") {
          records.push(item.token as unknown as XTokenRecord);
        }
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return records;
  }

  async save(record: XTokenRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: xTokenPk(record.teacherId),
        token: record,
        updatedAt: Date.now(),
      },
    }));
  }

  async delete(teacherId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: xTokenPk(teacherId) },
    }));
  }
}

function createTokenStore(): XTokenStore {
  return isDynamoBackend() ? new DynamoXTokenStore() : new JsonXTokenStore();
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
  return Math.random().toString(36).substring(2, 17);
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
  return !!(process.env.RUBY_HIGH_X_CONSUMER_KEY && process.env.RUBY_HIGH_X_ACCESS_TOKEN);
}

export class XSocialService extends Service {
  static override readonly serviceType = "x-social";

  private tokenStore: XTokenStore;
  private tokens = new Map<string, XTokenRecord>();
  private postCounts = new Map<string, { count: number; resetAt: number }>();
  private pendingVerifiers = new Map<string, { verifier: string; teacherId: string; createdAt: number }>();
  private stateCounter = 0;
  /** Per-teacher last photo tweet date (UTC YYYY-MM-DD). Enforces one
   *  photo-reveal tweet per teacher per day. In-memory only — resets on
   *  deploy, which is acceptable (at most one extra photo leaks). */
  private lastPhotoDate = new Map<string, string>();

  constructor(runtime?: IAgentRuntime | null) {
    super(runtime);
    this.tokenStore = createTokenStore();
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
          this.tokens.set(r.teacherId, r);
        } else {
          await this.tokenStore.delete(r.teacherId).catch(() => {});
        }
      }
      log.event("x-social.started", { teacherCount: this.tokens.size });
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

    if (!this.checkPostRateLimit(teacher.id)) {
      log.event("x-social.rate-limited", { teacherId: teacher.id, kind: ctx.kind });
      return null;
    }

    const freshToken = await this.ensureFreshToken(token);
    if (!freshToken) return null;

    const text = await this.generatePostText(teacher, ctx);

    // Content safety: validate the generated text before posting.
    if (!text || text.trim().length === 0) {
      log.event("x-social.text-rejected", { reason: "empty" });
      return null;
    }
    if (text.length > 280) {
      log.event("x-social.text-rejected", { reason: "too-long", length: text.length });
      return null;
    }
    // Guard against LLM hallucinating the system prompt into the tweet.
    // Use a longer slice (80 chars) of the system prompt to avoid false
    // positives from common English phrases like "You are running the".
    if (teacher.systemPrompt && teacher.systemPrompt.length >= 80 && text.includes(teacher.systemPrompt.slice(20, 100))) {
      log.event("x-social.text-rejected", { reason: "system-prompt-leak" });
      return null;
    }
    // Guard against tweets missing the student's name.
    if (ctx.characterName && !text.includes(ctx.characterName)) {
      log.event("x-social.text-rejected", { reason: "missing-name", characterName: ctx.characterName });
      // Don't reject — the fallback template will handle it. Just log.
    }

    // Resolve and upload an image if the milestone carries one.
    // One photo-reveal tweet per teacher per UTC day.
    const imageUrl = ctx.portraitUrl ?? ctx.diplomaUrl ?? null;
    let mediaId: string | null = null;
    if (imageUrl) {
      const today = new Date().toISOString().slice(0, 10);
      if (this.lastPhotoDate.get(teacher.id) === today) {
        log.event("x-social.photo-already-today", { teacherId: teacher.id, kind: ctx.kind });
        return null;
      }
      // Reserve the photo slot optimistically to prevent concurrent posts.
      this.lastPhotoDate.set(teacher.id, today);
      try {
        const imageBytes = await this.resolveImageToBuffer(imageUrl);
        mediaId = await this.uploadMedia(freshToken.accessToken, imageBytes);
      } catch (err) {
        // Release the reserved slot on failure so another attempt can retry.
        this.lastPhotoDate.delete(teacher.id);
        log.error("x-social.media-upload-failed", err, { kind: ctx.kind });
        // Fall through — post text-only.
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
      return `dry-run:${ctx.kind}`;
    }

    const tweetId = await this.postTweet(freshToken.accessToken, text, mediaId);

    if (tweetId) {
      this.recordPost(teacher.id);
      // lastPhotoDate was already set optimistically above.
      log.event("x-social.posted", {
        teacherId: teacher.id,
        xScreenName: token.xScreenName,
        kind: ctx.kind,
        tweetId,
        ...(mediaId ? { mediaId } : {}),
      });
    }

    return tweetId;
  }

  // ── Media upload ────────────────────────────────────────────────────────

  /** Upload an image to X and return the media_id_string for tweet attachment. */
  private async uploadMedia(accessToken: string, imageBytes: Buffer): Promise<string | null> {
    if (imageBytes.length > MAX_MEDIA_BYTES) {
      log.event("x-social.media-too-large", { bytes: imageBytes.length });
      return null;
    }

    // Determine MIME type from magic bytes.
    const mimeType = this.detectImageMime(imageBytes);

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
      // Use OAuth 1.0a for media upload if credentials are available.
      // OAuth 2.0 bearer tokens often get 403 on the v1.1 media endpoint.
      let headers: Record<string, string> = {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      };
      if (hasOAuth1Credentials()) {
        headers["Authorization"] = oauth1AuthHeader(
          "POST", X_MEDIA_UPLOAD,
          process.env.RUBY_HIGH_X_CONSUMER_KEY!,
          process.env.RUBY_HIGH_X_CONSUMER_SECRET!,
          process.env.RUBY_HIGH_X_ACCESS_TOKEN!,
          process.env.RUBY_HIGH_X_ACCESS_SECRET!,
        );
      } else {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }
      const res = await fetch(X_MEDIA_UPLOAD, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        log.error("x-social.media-upload-rejected", new Error(errText), { status: res.status });
        return null;
      }
      const data = (await res.json()) as { media_id_string: string };
      return data.media_id_string;
    } catch (err) {
      log.error("x-social.media-upload-failed", err, {});
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
      return Buffer.from(imageUrl.slice(comma + 1), "base64");
    }

    // Relative path: resolve against the public base.
    let url = imageUrl;
    if (url.startsWith("/")) {
      const base = process.env.RUBY_HIGH_PUBLIC_BASE?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
      url = `${base}${url}`;
    }

    // Validate URL safety to prevent SSRF.
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Image URL must use https");
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) throw new Error("Image URL has no hostname");
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      throw new Error("Image URL host not allowed: localhost");
    }
    if (isIP(hostname)) {
      if (this.isBlockedAddress(hostname)) {
        throw new Error("Image URL resolves to a private/reserved address");
      }
    } else {
      // For hostnames, check known blocked suffixes as a coarse filter.
      if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("Image URL host not allowed: " + hostname);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed to fetch image: ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
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

  /** Block private, link-local, loopback, and reserved IPv4/IPv6 addresses. */
  private isBlockedAddress(address: string): boolean {
    const v = isIP(address);
    if (v === 4) {
      const parts = address.split(".").map((p) => Number(p));
      const [a = 0, b = 0, c = 0] = parts;
      return (
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
      );
    }
    if (v === 6) {
      const normalized = address.toLowerCase();
      const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped?.[1]) return this.isBlockedAddress(mapped[1]);
      return (
        normalized === "::" || normalized === "::1" ||
        normalized.startsWith("fc") || normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith("ff") ||
        normalized === "2001:db8::" ||
        normalized.startsWith("2001:db8:")
      );
    }
    return false;
  }

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
    if (record.expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_SEC * 1000) {
      return record;
    }
    if (!record.refreshToken) {
      await this.disconnect(record.teacherId);
      return null;
    }
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
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
        ...record,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? record.refreshToken,
        expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
        updatedAt: Date.now(),
      };
      this.tokens.set(record.teacherId, updated);
      await this.tokenStore.save(updated);
      return updated;
    } catch (err) {
      log.error("x-social.token-refresh-failed", err, { teacherId: record.teacherId });
      return null;
    }
  }

  private async postTweet(accessToken: string, text: string, mediaId?: string | null): Promise<string | null> {
    try {
      const body: Record<string, unknown> = { text };
      if (mediaId) {
        body.media = { media_ids: [mediaId] };
      }
      const res = await fetch(`${X_API_BASE}/tweets`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(X_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        log.error("x-social.post-failed", new Error(errText), { status: res.status });
        return null;
      }
      const data = (await res.json()) as { data: { id: string } };
      return data.data.id;
    } catch (err) {
      log.error("x-social.post-failed", err, {});
      return null;
    }
  }

  private checkPostRateLimit(teacherId: string): boolean {
    const now = Date.now();
    let entry = this.postCounts.get(teacherId);
    if (!entry || now >= entry.resetAt) {
      this.postCounts.set(teacherId, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
      return true;
    }
    if (entry.count >= X_POSTS_PER_24H) return false;
    entry.count += 1;
    return true;
  }

  private recordPost(teacherId: string): void {
    // Slot was pre-reserved in checkPostRateLimit; no-op here.
  }

  private async generatePostText(teacher: TeacherCharacter, ctx: XMilestoneContext): Promise<string> {
    const prompt = this.buildPostPrompt(teacher, ctx);

    if (hasConfiguredLlmCredential()) {
      try {
        const response = await fetchLlmChatCompletions({
          body: {
            model: process.env.RUBY_HIGH_COURSE_MODEL ?? "qwen/qwen3.7-max",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.6,
          },
          timeoutMs: 15_000,
          label: "x-social-post",
        });
        let text = "";
        if (response.ok) {
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          text = data?.choices?.[0]?.message?.content?.trim() ?? "";
        }
        if (text && text.length > 0 && text.length <= 280) return text;
        if (text) return text.slice(0, 277) + "...";
      } catch (err) {
        log.error("x-social.llm-failed", err, { kind: ctx.kind });
      }
    }

    return this.buildFallbackPostText(ctx);
  }

  private buildPostPrompt(teacher: TeacherCharacter, ctx: XMilestoneContext): string {
    const lines: string[] = [
      `You are ${teacher.displayName}, a teacher at Ruby High school.`,
      `Your voice: ${teacher.systemPrompt.slice(0, 300)}`,
      "",
      `Write a single tweet (max 270 chars, leave room for #RubyHigh) about this milestone.`,
      `Sound like yourself — warm, in character, proud of the student. Use their name.`,
      "",
      `Milestone: ${ctx.kind}`,
      `Student: ${ctx.characterName}`,
    ];
    if (ctx.letterGrade) lines.push(`Grade: ${ctx.letterGrade}`);
    if (ctx.fromGrade && ctx.toGrade) lines.push(`Advanced: ${ctx.fromGrade} → ${ctx.toGrade}`);
    if (ctx.arcAnswer) lines.push(`Arc: ${ctx.arcAnswer}`);
    if (ctx.flavorQuote) lines.push(`Quote: "${ctx.flavorQuote}"`);
    lines.push("", "Tweet:");
    return lines.join("\n");
  }

  private buildFallbackPostText(ctx: XMilestoneContext): string {
    const name = ctx.characterName;
    switch (ctx.kind) {
      case "character-created":
        return `A new student has arrived at Ruby High. Welcome, ${name}! #RubyHigh`;
      case "class-passed":
        return `${name} just passed ${ctx.teacherName ?? "today's"} class with a ${ctx.letterGrade ?? "passing grade"}. Well done! #RubyHigh`;
      case "grade-advanced":
        return `${name} is moving up — now a ${ctx.toGrade ?? "new grade"} at Ruby High. Keep going! #RubyHigh`;
      case "graduated":
        return `${name} has graduated from Ruby High${ctx.arcAnswer ? ` — "${ctx.arcAnswer}"` : ""}. Congratulations! #RubyHigh`;
      case "portrait-set":
        return `${name} is officially on the Ruby High roster — school photo day complete! #RubyHigh`;
      case "diploma-earned":
        return `${name} just earned their diploma from Ruby High. Another milestone! #RubyHigh`;
      case "class-photo":
        return `Class photo day at Ruby High! #RubyHigh`;
      default:
        return `${name} hit a new milestone at Ruby High! #RubyHigh`;
    }
  }

  /** Post a teacher's reflection on today's school memories. Admin-triggered
   *  via the admin panel "Post" button. Generates a tweet in the teacher's
   *  voice based on what happened at school today. */
  async postReflection(
    teacher: TeacherCharacter,
    memories: { date: string; charactersCreated: string[]; classesPassed: Array<{ studentName: string; facultyId?: string; letterGrade?: string }>; gradesAdvanced: Array<{ studentName: string; fromGrade?: string; toGrade?: string }>; graduations: string[]; totalStudents: number; totalQuestionsAnswered: number },
    opts?: { dryRun?: boolean },
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

    const tweetId = await this.postTweet(freshToken.accessToken, text);
    if (tweetId) {
      log.event("x-social.posted", { teacherId: teacher.id, xScreenName: token.xScreenName, kind: "reflection", tweetId });
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
            model: process.env.RUBY_HIGH_COURSE_MODEL ?? "qwen/qwen3.7-max",
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
    student: { name: string; playbookId: string; grade: string; stats: Record<string, number>; classGrades: Record<string, string>; yearbookCount: number },
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
            model: process.env.RUBY_HIGH_COURSE_MODEL ?? "qwen/qwen3.7-max",
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

    const tweetId = await this.postTweet(freshToken.accessToken, text);
    if (tweetId) {
      log.event("x-social.posted", { teacherId: teacher.id, xScreenName: token.xScreenName, kind: "report-card", tweetId });
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

    // Check and reserve one-photo-per-day limit.
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPhotoDate.get(teacher.id) === today) {
      log.event("x-social.photo-already-today", { teacherId: teacher.id, kind: "class-photo" });
      return null;
    }
    this.lastPhotoDate.set(teacher.id, today);

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
