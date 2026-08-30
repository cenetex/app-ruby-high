export interface ViewerApiFetchInit extends RequestInit {
  timeoutMs?: number;
}

export interface ViewerApiResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface ViewerCommandError {
  kind: "http" | "network" | "timeout";
  message: string;
  status?: number;
}

export interface ViewerApiClientDeps {
  sessionUrl: string;
  commandUrl: string;
  commandTimeoutMs: number;
  sessionRefreshTimeoutMs: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<ViewerApiResponse>;
  getApiKey(): string | null;
  getVisitorId?(): string | null;
  clearAuth(): void;
  onAuthCleared(): void;
  onCommandSession(data: unknown): void;
  onCommandError(message: string): void;
  onCommandFailed(message: string): void;
  onNoScheduledQuestion(): void;
  isActiveBoardCommandError(payload: unknown, message: string): boolean;
  onActiveBoardRace(): void;
  onSessionData(data: unknown): void;
  onSessionUnavailable(): void;
}

export interface ViewerApiClient {
  apiFetch(url: string, init?: ViewerApiFetchInit): Promise<ViewerApiResponse>;
  command(payload: unknown): Promise<unknown | null>;
  fetchSession(opts?: { timeoutMs?: number }): Promise<void>;
  commandState(): { commandSeq: number; lastSettledCommandSeq: number };
  lastCommandError(): ViewerCommandError | null;
}

export function withViewerTimeoutSignal(opts: RequestInit, timeoutMs?: number): () => void {
  const ms = Number(timeoutMs || 0);
  if (!(ms > 0) || typeof AbortController === "undefined" || opts.signal) return () => {};
  const ctrl = new AbortController();
  opts.signal = ctrl.signal;
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch { /* ignore */ }
  }, ms);
  return () => clearTimeout(timer);
}

export function createViewerApiClient(deps: ViewerApiClientDeps): ViewerApiClient {
  let commandSeq = 0;
  let lastSettledCommandSeq = 0;
  let commandError: ViewerCommandError | null = null;
  let sessionEtag: string | null = null;
  const fetchImpl = deps.fetchImpl || ((url: string, init?: RequestInit) => fetch(url, init));

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
  }

  function responseErrorMessage(value: unknown, fallback: string | number): string {
    if (isRecord(value) && value.error != null) return String(value.error);
    return String(fallback);
  }

  function apiFetch(url: string, init?: ViewerApiFetchInit): Promise<ViewerApiResponse> {
    const opts: ViewerApiFetchInit = init ? { ...init } : {};
    const headers = new Headers(opts.headers || {});
    const timeoutMs = Number(opts.timeoutMs || 0);
    delete opts.timeoutMs;
    const key = deps.getApiKey();
    if (key && shouldAttachApiKey(url)) headers.set("X-Openrouter-Key", key);
    const visitorId = deps.getVisitorId?.();
    if (visitorId) headers.set("X-Ruby-High-Visitor", visitorId);
    opts.headers = headers;
    if (!opts.credentials) opts.credentials = "same-origin";
    const clearFetchTimeout = withViewerTimeoutSignal(opts, timeoutMs);
    return fetchImpl(url, opts).then((response) => {
      if (response.status === 401 && deps.getApiKey()) {
        deps.clearAuth();
        deps.onAuthCleared();
      }
      return response;
    }).finally(clearFetchTimeout);
  }

  function shouldAttachApiKey(url: string): boolean {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
    if (typeof window === "undefined" || !window.location) return false;
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  async function command(payload: unknown): Promise<unknown | null> {
    const seq = ++commandSeq;
    commandError = null;
    try {
      const response = await apiFetch(deps.commandUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        timeoutMs: deps.commandTimeoutMs,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "request " + response.status }));
        const message = responseErrorMessage(err, response.status);
        commandError = { kind: "http", message, status: response.status };
        if (/no scheduled (question|deck card) is due/i.test(message)) {
          deps.onNoScheduledQuestion();
          return null;
        }
        if (deps.isActiveBoardCommandError(payload, message)) {
          deps.onActiveBoardRace();
          return null;
        }
        deps.onCommandError(message);
        return null;
      }
      const data = await response.json();
      if (isRecord(data) && data.session) deps.onCommandSession(data.session);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      const name = isRecord(err) && typeof err.name === "string" ? err.name : "";
      commandError = { kind: name === "AbortError" ? "timeout" : "network", message };
      deps.onCommandFailed(message);
      return null;
    } finally {
      lastSettledCommandSeq = seq;
    }
  }

  async function fetchSession(opts?: { timeoutMs?: number }): Promise<void> {
    const seqAtStart = commandSeq;
    const settledAtStart = lastSettledCommandSeq;
    const headers = new Headers();
    if (sessionEtag) headers.set("If-None-Match", sessionEtag);
    const visitorId = deps.getVisitorId?.();
    if (visitorId) headers.set("X-Ruby-High-Visitor", visitorId);
    const fetchOpts: RequestInit = { credentials: "same-origin", headers };
    const clearFetchTimeout = withViewerTimeoutSignal(
      fetchOpts,
      opts?.timeoutMs || deps.sessionRefreshTimeoutMs,
    );
    try {
      const response = await fetchImpl(deps.sessionUrl, fetchOpts);
      if (response.status === 304) return;
      if (!response.ok) throw new Error("session " + response.status);
      sessionEtag = response.headers?.get("etag") || sessionEtag;
      const data = await response.json();
      if (commandSeq !== seqAtStart || lastSettledCommandSeq !== settledAtStart) return;
      deps.onSessionData(data);
    } catch {
      deps.onSessionUnavailable();
    } finally {
      clearFetchTimeout();
    }
  }

  return {
    apiFetch,
    command,
    fetchSession,
    commandState() {
      return { commandSeq, lastSettledCommandSeq };
    },
    lastCommandError() {
      return commandError ? { ...commandError } : null;
    },
  };
}
