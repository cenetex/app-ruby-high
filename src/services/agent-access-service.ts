import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Service, type IAgentRuntime } from "../runtime.js";
import {
  getDefaultStateStore,
  type StateStoreLike,
} from "./state-store.js";

export const AGENT_ACCESS_STATE_ID = "ruby-high:agent-access:v1";
export const AGENT_VIEWER_COOKIE = "rh_agent_session";
const DEVICE_TTL_MS = 10 * 60 * 1000;
const VIEWER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LAUNCH_TTL_MS = 2 * 60 * 1000;
const MAX_EVENTS = 1_000;
const MAX_IDEMPOTENCY_RECORDS = 512;

export const AGENT_SCOPES = [
  "school:read",
  "student:play",
  "world:participate",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export interface AgentAutonomyConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxClassesPerRun: number;
  maxActionsPerRun: number;
  maxModelCallsPerRun: number;
  facultyAllowlist: string[];
  publicPresence: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStopReason: string | null;
}

interface AgentCredentialRecord {
  id: string;
  agentName: string;
  stateKey: string;
  tokenHash: string;
  scopes: AgentScope[];
  approvedByStateKey: string;
  createdAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
  autonomy: AgentAutonomyConfig;
}

interface PendingDeviceRecord {
  deviceCodeHash: string;
  userCode: string;
  agentName: string;
  scopes: AgentScope[];
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  approvedByStateKey: string | null;
  credentialId: string | null;
  consumedAt: number | null;
}

interface AgentEventRecord {
  id: string;
  credentialId: string;
  type: string;
  at: number;
  data: Record<string, string | number | boolean | null>;
}

interface IdempotencyRecord {
  credentialId: string;
  requestId: string;
  fingerprint: string;
  createdAt: number;
  response: Record<string, unknown>;
}

interface LaunchRecord {
  codeHash: string;
  credentialId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

interface ViewerSessionRecord {
  tokenHash: string;
  credentialId: string;
  createdAt: number;
  expiresAt: number;
}

interface AgentAccessSnapshot {
  credentials: AgentCredentialRecord[];
  devices: PendingDeviceRecord[];
  events: AgentEventRecord[];
  idempotency: IdempotencyRecord[];
  launches: LaunchRecord[];
  viewerSessions: ViewerSessionRecord[];
}

export interface AgentCredential {
  id: string;
  agentName: string;
  stateKey: string;
  scopes: AgentScope[];
  createdAt: number;
  lastUsedAt: number;
  autonomy: AgentAutonomyConfig;
}

export interface AgentDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
  scopes: AgentScope[];
}

export type AgentDeviceTokenResult =
  | { status: "authorization_pending" }
  | { status: "expired_token" }
  | {
      status: "approved";
      accessToken: string;
      tokenType: "Bearer";
      scope: string;
      credential: AgentCredential;
    };

export class AgentAccessService extends Service {
  static override readonly serviceType = "ruby-high-agent-access";
  override readonly capabilityDescription =
    "Scoped device authorization, agent credentials, idempotency, events, autonomy settings, and one-time viewer launches.";

  private readonly store: StateStoreLike;
  private readonly tokenSecret: Buffer;
  private readonly credentials = new Map<string, AgentCredentialRecord>();
  private readonly devicesByUserCode = new Map<string, PendingDeviceRecord>();
  private readonly devicesByHash = new Map<string, PendingDeviceRecord>();
  private readonly events: AgentEventRecord[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly launches = new Map<string, LaunchRecord>();
  private readonly viewerSessions = new Map<string, ViewerSessionRecord>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(runtime?: IAgentRuntime, store?: StateStoreLike) {
    super(runtime);
    this.store = store ?? getDefaultStateStore();
    const configuredSecret =
      runtime?.getSetting?.("RUBY_HIGH_AGENT_TOKEN_SECRET") ??
      process.env.RUBY_HIGH_AGENT_TOKEN_SECRET;
    this.tokenSecret = Buffer.from(
      typeof configuredSecret === "string" && configuredSecret.trim()
        ? configuredSecret.trim()
        : randomBytes(32).toString("base64url"),
    );
  }

  static async start(runtime: IAgentRuntime): Promise<AgentAccessService> {
    const service = new AgentAccessService(runtime);
    await service.hydrate();
    return service;
  }

  async hydrate(): Promise<void> {
    const stored = await this.store.loadServiceState?.(AGENT_ACCESS_STATE_ID).catch(() => null);
    const snapshot = stored?.data as Partial<AgentAccessSnapshot> | undefined;
    for (const credential of snapshot?.credentials ?? []) {
      if (!validCredentialRecord(credential)) continue;
      this.credentials.set(credential.id, normalizeCredentialRecord(credential));
    }
    for (const device of snapshot?.devices ?? []) {
      if (!validDeviceRecord(device)) continue;
      this.devicesByUserCode.set(device.userCode, device);
      this.devicesByHash.set(device.deviceCodeHash, device);
    }
    for (const event of snapshot?.events ?? []) {
      if (validEventRecord(event)) this.events.push(event);
    }
    for (const record of snapshot?.idempotency ?? []) {
      if (!validIdempotencyRecord(record)) continue;
      this.idempotency.set(idempotencyKey(record.credentialId, record.requestId), record);
    }
    for (const launch of snapshot?.launches ?? []) {
      if (validLaunchRecord(launch)) this.launches.set(launch.codeHash, launch);
    }
    for (const viewer of snapshot?.viewerSessions ?? []) {
      if (validViewerSessionRecord(viewer)) this.viewerSessions.set(viewer.tokenHash, viewer);
    }
    this.prune(Date.now());
  }

  async stop(): Promise<void> {
    await this.flush();
    this.credentials.clear();
    this.devicesByUserCode.clear();
    this.devicesByHash.clear();
    this.events.length = 0;
    this.idempotency.clear();
    this.launches.clear();
    this.viewerSessions.clear();
  }

  async issueDeviceCode(input: {
    agentName: string;
    scopes?: string[];
    now?: number;
  }): Promise<AgentDeviceAuthorization> {
    const now = input.now ?? Date.now();
    this.prune(now);
    const agentName = cleanAgentName(input.agentName);
    const scopes = normalizeScopes(input.scopes);
    const deviceCode = `rhd_${randomBytes(32).toString("base64url")}`;
    const userCode = uniqueUserCode(this.devicesByUserCode);
    const record: PendingDeviceRecord = {
      deviceCodeHash: hashSecret(deviceCode),
      userCode,
      agentName,
      scopes,
      createdAt: now,
      expiresAt: now + DEVICE_TTL_MS,
      approvedAt: null,
      approvedByStateKey: null,
      credentialId: null,
      consumedAt: null,
    };
    this.devicesByUserCode.set(userCode, record);
    this.devicesByHash.set(record.deviceCodeHash, record);
    await this.persist();
    return {
      deviceCode,
      userCode,
      expiresIn: Math.floor(DEVICE_TTL_MS / 1000),
      interval: 5,
      scopes,
    };
  }

  async approveDeviceCode(
    userCodeInput: string,
    approvedByStateKey: string,
    now = Date.now(),
  ): Promise<AgentCredential> {
    this.prune(now);
    const userCode = normalizeUserCode(userCodeInput);
    const device = this.devicesByUserCode.get(userCode);
    if (!device || device.expiresAt <= now || device.consumedAt) {
      throw new AgentAccessError("Device code is invalid or expired.", 404, "invalid_device_code");
    }
    if (device.credentialId) {
      const existing = this.credentials.get(device.credentialId);
      if (existing) return publicCredential(existing);
    }
    const id = `agt_${randomBytes(12).toString("base64url")}`;
    const credential: AgentCredentialRecord = {
      id,
      agentName: device.agentName,
      stateKey: `rh:agent-player:${id}`,
      tokenHash: hashSecret(this.tokenForDeviceHash(device.deviceCodeHash)),
      scopes: device.scopes,
      approvedByStateKey,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      autonomy: defaultAutonomyConfig(),
    };
    this.credentials.set(id, credential);
    device.approvedAt = now;
    device.approvedByStateKey = approvedByStateKey;
    device.credentialId = id;
    this.recordEvent(id, "agent.connected", {
      agentName: credential.agentName,
      scopes: credential.scopes.join(" "),
    }, now);
    await this.persist();
    return publicCredential(credential);
  }

  async exchangeDeviceCode(deviceCode: string, now = Date.now()): Promise<AgentDeviceTokenResult> {
    this.prune(now);
    const deviceHash = hashSecret(deviceCode.trim());
    const device = this.devicesByHash.get(deviceHash);
    if (!device || device.expiresAt <= now || device.consumedAt) {
      return { status: "expired_token" };
    }
    if (!device.credentialId || !device.approvedAt) return { status: "authorization_pending" };
    const credential = this.credentials.get(device.credentialId);
    if (!credential || credential.revokedAt) return { status: "expired_token" };
    device.consumedAt = now;
    const token = this.tokenForDeviceHash(device.deviceCodeHash);
    await this.persist();
    return {
      status: "approved",
      accessToken: token,
      tokenType: "Bearer",
      scope: credential.scopes.join(" "),
      credential: publicCredential(credential),
    };
  }

  authenticateBearer(value: string | string[] | null | undefined, now = Date.now()): AgentCredential | null {
    const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
    const match = raw.trim().match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const candidateHash = hashSecret(match[1]!.trim());
    for (const record of this.credentials.values()) {
      if (record.revokedAt || !safeEqual(record.tokenHash, candidateHash)) continue;
      record.lastUsedAt = now;
      void this.persist();
      return publicCredential(record);
    }
    return null;
  }

  requireScope(credential: AgentCredential, scope: AgentScope): void {
    if (!credential.scopes.includes(scope)) {
      throw new AgentAccessError(`Missing required scope: ${scope}.`, 403, "insufficient_scope");
    }
  }

  getCredential(id: string): AgentCredential | null {
    const record = this.credentials.get(id);
    return record && !record.revokedAt ? publicCredential(record) : null;
  }

  async revokeCredential(id: string, now = Date.now()): Promise<boolean> {
    const record = this.credentials.get(id);
    if (!record || record.revokedAt) return false;
    record.revokedAt = now;
    record.autonomy = { ...record.autonomy, enabled: false, nextRunAt: null };
    this.recordEvent(id, "agent.revoked", {}, now);
    await this.persist();
    return true;
  }

  cachedAction(
    credentialId: string,
    requestId: string,
    fingerprint: string,
  ): Record<string, unknown> | null {
    const record = this.idempotency.get(idempotencyKey(credentialId, requestId));
    if (!record) return null;
    if (record.fingerprint !== fingerprint) {
      throw new AgentAccessError(
        "requestId was already used for a different action.",
        409,
        "idempotency_conflict",
      );
    }
    return record.response;
  }

  async rememberAction(
    credentialId: string,
    requestId: string,
    fingerprint: string,
    response: Record<string, unknown>,
    now = Date.now(),
  ): Promise<void> {
    this.idempotency.set(idempotencyKey(credentialId, requestId), {
      credentialId,
      requestId,
      fingerprint,
      response,
      createdAt: now,
    });
    while (this.idempotency.size > MAX_IDEMPOTENCY_RECORDS) {
      const oldest = this.idempotency.keys().next().value as string | undefined;
      if (!oldest) break;
      this.idempotency.delete(oldest);
    }
    await this.persist();
  }

  listEvents(credentialId: string, after = 0, limit = 50): AgentEventRecord[] {
    return this.events
      .filter((event) => event.credentialId === credentialId && event.at > after)
      .slice(-Math.max(1, Math.min(100, Math.floor(limit))))
      .map((event) => ({ ...event, data: { ...event.data } }));
  }

  async appendEvent(
    credentialId: string,
    type: string,
    data: Record<string, string | number | boolean | null> = {},
    now = Date.now(),
  ): Promise<void> {
    this.recordEvent(credentialId, type, data, now);
    await this.persist();
  }

  async setAutonomy(
    credentialId: string,
    input: Partial<AgentAutonomyConfig>,
    now = Date.now(),
  ): Promise<AgentAutonomyConfig> {
    const record = this.credentials.get(credentialId);
    if (!record || record.revokedAt) {
      throw new AgentAccessError("Unknown agent credential.", 404, "unknown_agent");
    }
    const enabled = input.enabled === true;
    const intervalMinutes = boundedInteger(input.intervalMinutes, 15, 24 * 60, record.autonomy.intervalMinutes);
    const facultyAllowlist = Array.isArray(input.facultyAllowlist)
      ? input.facultyAllowlist
          .map((faculty) => String(faculty).trim())
          .filter(Boolean)
          .slice(0, 8)
      : record.autonomy.facultyAllowlist;
    record.autonomy = {
      ...record.autonomy,
      enabled,
      intervalMinutes,
      maxClassesPerRun: boundedInteger(input.maxClassesPerRun, 1, 2, record.autonomy.maxClassesPerRun),
      maxActionsPerRun: boundedInteger(input.maxActionsPerRun, 1, 8, record.autonomy.maxActionsPerRun),
      maxModelCallsPerRun: boundedInteger(input.maxModelCallsPerRun, 1, 2, record.autonomy.maxModelCallsPerRun),
      facultyAllowlist: facultyAllowlist.length ? facultyAllowlist : ["guest"],
      publicPresence: input.publicPresence === true && record.scopes.includes("world:participate"),
      nextRunAt: enabled ? now + intervalMinutes * 60_000 : null,
      lastStopReason: enabled ? null : "disabled-by-owner",
    };
    this.recordEvent(credentialId, enabled ? "autonomy.enabled" : "autonomy.disabled", {
      intervalMinutes,
    }, now);
    await this.persist();
    return { ...record.autonomy, facultyAllowlist: [...record.autonomy.facultyAllowlist] };
  }

  async noteAutonomyRun(
    credentialId: string,
    stopReason: string,
    now = Date.now(),
  ): Promise<void> {
    const record = this.credentials.get(credentialId);
    if (!record) return;
    record.autonomy.lastRunAt = now;
    record.autonomy.lastStopReason = stopReason.slice(0, 160);
    record.autonomy.nextRunAt = record.autonomy.enabled
      ? now + record.autonomy.intervalMinutes * 60_000
      : null;
    this.recordEvent(credentialId, "autonomy.run", { stopReason }, now);
    await this.persist();
  }

  async createLaunch(credentialId: string, now = Date.now()): Promise<string> {
    const record = this.credentials.get(credentialId);
    if (!record || record.revokedAt) {
      throw new AgentAccessError("Unknown agent credential.", 404, "unknown_agent");
    }
    this.prune(now);
    const code = `rhl_${randomBytes(24).toString("base64url")}`;
    const launch: LaunchRecord = {
      codeHash: hashSecret(code),
      credentialId,
      createdAt: now,
      expiresAt: now + LAUNCH_TTL_MS,
      usedAt: null,
    };
    this.launches.set(launch.codeHash, launch);
    await this.persist();
    return code;
  }

  async consumeLaunch(code: string, now = Date.now()): Promise<{
    viewerToken: string;
    credential: AgentCredential;
  }> {
    this.prune(now);
    const launch = this.launches.get(hashSecret(code.trim()));
    if (!launch || launch.expiresAt <= now || launch.usedAt) {
      throw new AgentAccessError("Launch code is invalid, expired, or already used.", 404, "invalid_launch");
    }
    const credential = this.credentials.get(launch.credentialId);
    if (!credential || credential.revokedAt) {
      throw new AgentAccessError("Agent credential is unavailable.", 404, "unknown_agent");
    }
    launch.usedAt = now;
    const viewerToken = `rhv_agent_${randomBytes(24).toString("base64url")}`;
    const viewer: ViewerSessionRecord = {
      tokenHash: hashSecret(viewerToken),
      credentialId: credential.id,
      createdAt: now,
      expiresAt: now + VIEWER_SESSION_TTL_MS,
    };
    this.viewerSessions.set(viewer.tokenHash, viewer);
    this.recordEvent(credential.id, "viewer.launched", {}, now);
    await this.persist();
    return { viewerToken, credential: publicCredential(credential) };
  }

  stateKeyForViewerCookie(cookieHeader: string | null | undefined, now = Date.now()): string | null {
    const token = parseCookie(cookieHeader, AGENT_VIEWER_COOKIE);
    if (!token) return null;
    const viewer = this.viewerSessions.get(hashSecret(token));
    if (!viewer || viewer.expiresAt <= now) return null;
    const credential = this.credentials.get(viewer.credentialId);
    return credential && !credential.revokedAt ? credential.stateKey : null;
  }

  buildViewerCookie(token: string, secure: boolean): string {
    return [
      `${AGENT_VIEWER_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(VIEWER_SESSION_TTL_MS / 1000)}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  async flush(): Promise<void> {
    await this.writeChain;
    await this.store.flush?.();
  }

  private tokenForDeviceHash(deviceCodeHash: string): string {
    return `rh_agent_${createHmac("sha256", this.tokenSecret)
      .update(deviceCodeHash)
      .digest("base64url")}`;
  }

  private recordEvent(
    credentialId: string,
    type: string,
    data: Record<string, string | number | boolean | null>,
    at: number,
  ): void {
    this.events.push({
      id: `age_${randomBytes(10).toString("base64url")}`,
      credentialId,
      type: type.slice(0, 80),
      at,
      data,
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  private prune(now: number): void {
    for (const [userCode, device] of this.devicesByUserCode) {
      const doneLongAgo = device.consumedAt != null && device.consumedAt < now - 60_000;
      if (device.expiresAt > now && !doneLongAgo) continue;
      this.devicesByUserCode.delete(userCode);
      this.devicesByHash.delete(device.deviceCodeHash);
    }
    for (const [hash, launch] of this.launches) {
      if (launch.expiresAt <= now || launch.usedAt != null) this.launches.delete(hash);
    }
    for (const [hash, viewer] of this.viewerSessions) {
      if (viewer.expiresAt <= now) this.viewerSessions.delete(hash);
    }
  }

  private persist(): Promise<void> {
    if (!this.store.saveServiceState) return Promise.resolve();
    const record = {
      id: AGENT_ACCESS_STATE_ID,
      updatedAt: Date.now(),
      data: {
        credentials: Array.from(this.credentials.values()),
        devices: Array.from(this.devicesByHash.values()),
        events: this.events,
        idempotency: Array.from(this.idempotency.values()),
        launches: Array.from(this.launches.values()),
        viewerSessions: Array.from(this.viewerSessions.values()),
      } as unknown as Record<string, unknown>,
    };
    const save = this.writeChain.then(() => this.store.saveServiceState!(record));
    this.writeChain = save.catch(() => {});
    return save;
  }
}

export class AgentAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AgentAccessError";
  }
}

function publicCredential(record: AgentCredentialRecord): AgentCredential {
  return {
    id: record.id,
    agentName: record.agentName,
    stateKey: record.stateKey,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    autonomy: {
      ...record.autonomy,
      facultyAllowlist: [...record.autonomy.facultyAllowlist],
    },
  };
}

function defaultAutonomyConfig(): AgentAutonomyConfig {
  return {
    enabled: false,
    intervalMinutes: 60,
    maxClassesPerRun: 1,
    maxActionsPerRun: 6,
    maxModelCallsPerRun: 1,
    facultyAllowlist: ["guest"],
    publicPresence: false,
    nextRunAt: null,
    lastRunAt: null,
    lastStopReason: "not-enabled",
  };
}

function normalizeCredentialRecord(record: AgentCredentialRecord): AgentCredentialRecord {
  return {
    ...record,
    scopes: normalizeScopes(record.scopes),
    revokedAt: typeof record.revokedAt === "number" ? record.revokedAt : null,
    autonomy: {
      ...defaultAutonomyConfig(),
      ...(record.autonomy ?? {}),
      enabled: record.autonomy?.enabled === true,
      publicPresence:
        record.autonomy?.publicPresence === true &&
        record.scopes.includes("world:participate"),
      facultyAllowlist:
        Array.isArray(record.autonomy?.facultyAllowlist) &&
        record.autonomy.facultyAllowlist.length
          ? record.autonomy.facultyAllowlist.slice(0, 8)
          : ["guest"],
    },
  };
}

function normalizeScopes(scopes: string[] | undefined): AgentScope[] {
  const requested = new Set((scopes ?? ["school:read", "student:play"]).map(String));
  const granted = AGENT_SCOPES.filter((scope) => requested.has(scope));
  if (!granted.includes("school:read")) granted.unshift("school:read");
  return granted;
}

function cleanAgentName(value: string): string {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
  if (!cleaned) throw new AgentAccessError("agentName is required.", 400, "invalid_request");
  return cleaned;
}

function uniqueUserCode(existing: Map<string, PendingDeviceRecord>): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    if (!existing.has(code)) return code;
  }
  throw new Error("Unable to allocate a unique device code.");
}

function normalizeUserCode(value: string): string {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-F0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function idempotencyKey(credentialId: string, requestId: string): string {
  return `${credentialId}:${requestId}`;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function parseCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator) !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function validCredentialRecord(value: unknown): value is AgentCredentialRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AgentCredentialRecord>;
  return (
    typeof row.id === "string" &&
    typeof row.agentName === "string" &&
    typeof row.stateKey === "string" &&
    typeof row.tokenHash === "string" &&
    Array.isArray(row.scopes) &&
    typeof row.approvedByStateKey === "string" &&
    typeof row.createdAt === "number" &&
    typeof row.lastUsedAt === "number"
  );
}

function validDeviceRecord(value: unknown): value is PendingDeviceRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingDeviceRecord>;
  return (
    typeof row.deviceCodeHash === "string" &&
    typeof row.userCode === "string" &&
    typeof row.agentName === "string" &&
    Array.isArray(row.scopes) &&
    typeof row.createdAt === "number" &&
    typeof row.expiresAt === "number"
  );
}

function validEventRecord(value: unknown): value is AgentEventRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AgentEventRecord>;
  return (
    typeof row.id === "string" &&
    typeof row.credentialId === "string" &&
    typeof row.type === "string" &&
    typeof row.at === "number" &&
    !!row.data &&
    typeof row.data === "object"
  );
}

function validIdempotencyRecord(value: unknown): value is IdempotencyRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<IdempotencyRecord>;
  return (
    typeof row.credentialId === "string" &&
    typeof row.requestId === "string" &&
    typeof row.fingerprint === "string" &&
    typeof row.createdAt === "number" &&
    !!row.response &&
    typeof row.response === "object"
  );
}

function validLaunchRecord(value: unknown): value is LaunchRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LaunchRecord>;
  return (
    typeof row.codeHash === "string" &&
    typeof row.credentialId === "string" &&
    typeof row.createdAt === "number" &&
    typeof row.expiresAt === "number"
  );
}

function validViewerSessionRecord(value: unknown): value is ViewerSessionRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ViewerSessionRecord>;
  return (
    typeof row.tokenHash === "string" &&
    typeof row.credentialId === "string" &&
    typeof row.createdAt === "number" &&
    typeof row.expiresAt === "number"
  );
}
