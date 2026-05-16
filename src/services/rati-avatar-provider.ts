import type { ConnectedTeacherCandidate } from "./teacher-providers.js";

export interface RatiUserAvatar {
  id: string;
  model: string;
  name: string;
  description: string;
  profileImage?: string | null;
  supportsTools: boolean;
}

export interface RatiTeacherGrant {
  grantId?: string | null;
}

export interface RatiTeacherAvatarProvider {
  configured(): boolean;
  listUserAvatars(walletAddress: string): Promise<RatiUserAvatar[]>;
  createTeacherAvatar(input: {
    walletAddress: string;
    name: string;
    description?: string;
    persona?: string;
    profileImageUrl?: string | null;
  }): Promise<RatiUserAvatar>;
  updateTeacherAvatar(input: {
    walletAddress: string;
    avatarId: string;
    name?: string;
    description?: string;
    persona?: string;
    profileImageUrl?: string | null;
  }): Promise<RatiUserAvatar>;
  createTeacherGrant(input: {
    walletAddress: string;
    avatarId: string;
    visibility: "public" | "unlisted";
  }): Promise<RatiTeacherGrant>;
}

export class HttpRatiTeacherAvatarProvider implements RatiTeacherAvatarProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl?: string; apiKey?: string; timeoutMs?: number } = {}) {
    this.baseUrl = normalizeBaseUrl(
      opts.baseUrl ??
      process.env.RUBY_HIGH_RATI_INTERNAL_BASE_URL ??
      inferInternalBaseUrl(process.env.RUBY_HIGH_RATI_BASE_URL) ??
      "",
    );
    this.apiKey = (opts.apiKey ?? process.env.RUBY_HIGH_RATI_INTERNAL_API_KEY ?? "").trim();
    this.timeoutMs = opts.timeoutMs ?? readPositiveInt(process.env.RUBY_HIGH_RATI_TIMEOUT_MS, 60_000);
  }

  configured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  async listUserAvatars(walletAddress: string): Promise<RatiUserAvatar[]> {
    this.assertConfigured();
    const wallet = normalizeWalletAddress(walletAddress);
    const data = await this.request<{ avatars?: unknown; data?: unknown }>(
      `/internal/ruby-high/avatars?walletAddress=${encodeURIComponent(wallet)}`,
      { method: "GET" },
    );
    const raw = Array.isArray(data.avatars) ? data.avatars : Array.isArray(data.data) ? data.data : [];
    return raw.map(parseAvatar).filter((avatar): avatar is RatiUserAvatar => !!avatar);
  }

  async createTeacherAvatar(input: {
    walletAddress: string;
    name: string;
    description?: string;
    persona?: string;
    profileImageUrl?: string | null;
  }): Promise<RatiUserAvatar> {
    this.assertConfigured();
    const data = await this.request<{ avatar?: unknown; data?: unknown }>("/internal/ruby-high/avatars", {
      method: "POST",
      body: {
        walletAddress: normalizeWalletAddress(input.walletAddress),
        name: input.name,
        description: input.description ?? "",
        persona: input.persona ?? input.description ?? "",
        profileImageUrl: input.profileImageUrl ?? null,
      },
    });
    return requiredAvatar(data.avatar ?? data.data);
  }

  async updateTeacherAvatar(input: {
    walletAddress: string;
    avatarId: string;
    name?: string;
    description?: string;
    persona?: string;
    profileImageUrl?: string | null;
  }): Promise<RatiUserAvatar> {
    this.assertConfigured();
    const data = await this.request<{ avatar?: unknown; data?: unknown }>(
      `/internal/ruby-high/avatars/${encodeURIComponent(input.avatarId)}`,
      {
        method: "PATCH",
        body: {
          walletAddress: normalizeWalletAddress(input.walletAddress),
          name: input.name,
          description: input.description,
          persona: input.persona,
          profileImageUrl: input.profileImageUrl,
        },
      },
    );
    return requiredAvatar(data.avatar ?? data.data);
  }

  async createTeacherGrant(input: {
    walletAddress: string;
    avatarId: string;
    visibility: "public" | "unlisted";
  }): Promise<RatiTeacherGrant> {
    this.assertConfigured();
    const data = await this.request<{ grantId?: unknown; grant?: { id?: unknown } }>("/internal/ruby-high/teacher-grants", {
      method: "POST",
      body: {
        walletAddress: normalizeWalletAddress(input.walletAddress),
        avatarId: input.avatarId,
        visibility: input.visibility,
      },
    });
    const grantId = typeof data.grantId === "string"
      ? data.grantId
      : typeof data.grant?.id === "string"
        ? data.grant.id
        : null;
    return { grantId };
  }

  private async request<T>(path: string, opts: { method: "GET" | "POST" | "PATCH"; body?: Record<string, unknown> }): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: opts.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        ...(opts.body ? { body: JSON.stringify(stripUndefined(opts.body)) } : {}),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`RATi avatar provider ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 300)}` : ""}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertConfigured(): void {
    if (!this.configured()) throw new Error("RATi avatar provider is not configured.");
  }
}

let defaultProvider: RatiTeacherAvatarProvider | null = null;

export function getDefaultRatiTeacherAvatarProvider(): RatiTeacherAvatarProvider {
  if (!defaultProvider) defaultProvider = new HttpRatiTeacherAvatarProvider();
  return defaultProvider;
}

export function ratiAvatarToConnectedTeacherCandidate(avatar: RatiUserAvatar): ConnectedTeacherCandidate {
  return {
    id: avatar.model,
    model: avatar.model,
    root: avatar.id,
    name: avatar.name,
    description: avatar.description,
    provider: "rati-openai-compatible",
    supportsTools: avatar.supportsTools,
    profileImage: avatar.profileImage ?? null,
  };
}

export function normalizeWalletAddress(value: string): string {
  const wallet = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error("A valid wallet address is required.");
  }
  return wallet.toLowerCase();
}

function requiredAvatar(value: unknown): RatiUserAvatar {
  const avatar = parseAvatar(value);
  if (!avatar) throw new Error("RATi avatar provider returned an invalid avatar.");
  return avatar;
}

function parseAvatar(value: unknown): RatiUserAvatar | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const avatar = record.avatar && typeof record.avatar === "object" ? record.avatar as Record<string, unknown> : null;
  const id = firstString(record.id, record.avatarId, record.root);
  const model = firstString(record.model, record.modelId) || (id ? `avatar:${id}` : "");
  if (!id || !model) return null;
  const name = firstString(record.name, avatar?.name) || id.replace(/[-_]+/g, " ");
  const description = firstString(record.description, avatar?.description) || "";
  const profileImage = firstString(record.profileImageUrl, record.profileImage, record.profile_image, avatar?.profileImage, avatar?.profile_image);
  return {
    id,
    model,
    name,
    description,
    profileImage: profileImage || null,
    supportsTools: readBoolean(record.supportsTools, true),
  };
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function inferInternalBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/api\/v1\/?$/, "/api").replace(/\/v1\/?$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}
