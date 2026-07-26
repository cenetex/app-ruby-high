export interface RubyHighClientOptions {
  baseUrl: string;
  accessToken?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface RubyHighAutonomyConfig {
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

export interface RubyHighAgentIdentity {
  id: string;
  agentName: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number;
}

export interface RubyHighQuestion {
  id: string;
  prompt: string;
  type: string;
  options: Record<string, string> | null;
  subject: string | null;
  difficulty: string | null;
}

export interface RubyHighState {
  version: number;
  phase: string;
  status: string;
  student: {
    name: string;
    playbookId: string;
    currentGrade: string | null;
    publicWorldVisible: boolean;
  } | null;
  faculty: string;
  subject: string | null;
  question: RubyHighQuestion | null;
  reveal: {
    picked: string | null;
    correct: string | null;
    wasCorrect: boolean;
    explanation: string | null;
    answerText: string | null;
  } | null;
  activeGuest: {
    id: string;
    name: string;
    description: string;
  } | null;
  autonomy: RubyHighAutonomyConfig;
  [key: string]: unknown;
}

export interface RubyHighActionResponse {
  ok: boolean;
  action: string;
  result: Record<string, unknown>;
  state: RubyHighState;
  replayed?: boolean;
}

export class RubyHighApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "RubyHighApiError";
  }
}

export class RubyHighClient {
  readonly baseUrl: string;
  private accessToken: string | null;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: RubyHighClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.accessToken = cleanToken(options.accessToken);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get connected(): boolean {
    return this.accessToken != null;
  }

  setAccessToken(token: string): void {
    const cleaned = cleanToken(token);
    if (!cleaned) throw new Error("Ruby High access token is empty.");
    this.accessToken = cleaned;
  }

  clearAccessToken(): void {
    this.accessToken = null;
  }

  async beginDeviceAuthorization(
    agentName: string,
    scopes = ["school:read", "student:play"],
  ): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
    scopes: string[];
  }> {
    return this.request("/device/code", {
      method: "POST",
      body: { agentName, scopes },
      authenticated: false,
    });
  }

  async exchangeDeviceCode(deviceCode: string): Promise<{
    accessToken: string;
    tokenType: string;
    scope: string;
    agent: RubyHighAgentIdentity;
  }> {
    const result = await this.request<{
      accessToken: string;
      tokenType: string;
      scope: string;
      agent: RubyHighAgentIdentity;
    }>("/device/token", {
      method: "POST",
      body: { deviceCode },
      authenticated: false,
    });
    this.setAccessToken(result.accessToken);
    return result;
  }

  me(): Promise<{
    ok: true;
    agent: RubyHighAgentIdentity;
    autonomy: RubyHighAutonomyConfig;
  }> {
    return this.request("/me");
  }

  async state(): Promise<RubyHighState> {
    const response = await this.request<{ ok: true; state: RubyHighState }>("/state");
    return response.state;
  }

  async enroll(
    input: {
      name?: string;
      playbookId?: string;
      arcAnswer?: string;
      personality?: string;
      flavorQuote?: string;
    } = {},
    requestId = createRequestId("enroll"),
  ): Promise<RubyHighActionResponse> {
    return this.request("/enroll", {
      method: "POST",
      body: { requestId, ...input },
    });
  }

  action(
    type: string,
    input: Record<string, unknown> = {},
    options: { requestId?: string; ifVersion?: number } = {},
  ): Promise<RubyHighActionResponse> {
    return this.request("/actions", {
      method: "POST",
      body: {
        requestId: options.requestId ?? createRequestId(type.toLowerCase()),
        ...(options.ifVersion != null ? { ifVersion: options.ifVersion } : {}),
        type,
        input,
      },
    });
  }

  async configureAutonomy(
    input: Partial<RubyHighAutonomyConfig>,
  ): Promise<RubyHighAutonomyConfig> {
    const response = await this.request<{
      ok: true;
      autonomy: RubyHighAutonomyConfig;
    }>("/autonomy", { method: "POST", body: input });
    return response.autonomy;
  }

  async noteAutonomyRun(stopReason: string): Promise<RubyHighAutonomyConfig | null> {
    const response = await this.request<{
      ok: true;
      autonomy: RubyHighAutonomyConfig | null;
    }>("/autonomy/run", { method: "POST", body: { stopReason } });
    return response.autonomy;
  }

  async launch(): Promise<{ launchUrl: string; expiresIn: number }> {
    const response = await this.request<{
      ok: true;
      launchUrl: string;
      expiresIn: number;
    }>("/launch", { method: "POST", body: {} });
    return {
      launchUrl: response.launchUrl,
      expiresIn: response.expiresIn,
    };
  }

  events(after = 0, limit = 50): Promise<{
    ok: true;
    events: Array<Record<string, unknown>>;
  }> {
    const query = new URLSearchParams({
      after: String(Math.max(0, Math.floor(after))),
      limit: String(Math.max(1, Math.min(100, Math.floor(limit)))),
    });
    return this.request(`/events?${query}`);
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      authenticated?: boolean;
    } = {},
  ): Promise<T> {
    if (options.authenticated !== false && !this.accessToken) {
      throw new RubyHighApiError(
        "Ruby High is not connected.",
        401,
        "not_connected",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/apps/ruby-high/agent/v1${path}`, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.authenticated === false || !this.accessToken
            ? {}
            : { Authorization: `Bearer ${this.accessToken}` }),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const code =
          typeof payload.error === "string" ? payload.error : `http_${response.status}`;
        const message =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : `Ruby High request failed (${response.status}).`;
        throw new RubyHighApiError(message, response.status, code, payload);
      }
      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value || "https://ruby-high.fly.dev");
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Ruby High URL must use HTTPS outside local development.");
  }
  return url.origin;
}

function cleanToken(value: string | undefined): string | null {
  const token = value?.trim() ?? "";
  return token ? token : null;
}

export function createRequestId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${cryptoRandomId()}`;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
