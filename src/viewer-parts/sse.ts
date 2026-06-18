export interface ViewerSseEvent {
  event: string;
  data: unknown;
  id: string | null;
}

export interface ViewerSseParseResult {
  frames: ViewerSseEvent[];
  rest: string;
}

export interface ViewerSseReader {
  read(): Promise<{ value?: Uint8Array; done?: boolean }>;
  cancel(): void | Promise<void>;
}

export interface ViewerSseResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  } | null;
  body?: {
    getReader(): ViewerSseReader;
  } | null;
  json(): Promise<unknown>;
}

export interface ViewerSseErrorResponse {
  error: unknown;
  status: number;
  retryAfterMs: number | null;
}

export interface ViewerSseHandlers {
  isCurrent(): boolean;
  onErrorResponse(error: unknown, response?: ViewerSseErrorResponse): void;
  onEvent(event: string, data: unknown, id?: string | null): void | Promise<void>;
  watchdogMs?: number;
  maxBufferChars?: number;
}

export function parseViewerSseFrames(buffer: string): ViewerSseParseResult {
  const frames: ViewerSseEvent[] = [];
  let rest = buffer;
  let delimiter = rest.match(/\r?\n\r?\n/);
  while (delimiter?.index !== undefined) {
    const frameEnd = delimiter.index;
    const rawFrame = rest.slice(0, frameEnd);
    rest = rest.slice(frameEnd + delimiter[0].length);
    const lines = rawFrame.split(/\r?\n/);
    let event = "message";
    let id: string | null = null;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("id:")) {
        const value = line.slice(3);
        id = value.startsWith(" ") ? value.slice(1) : value;
      }
      else if (line.startsWith("data:")) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    const data = dataLines.join("\n");
    if (data) {
      try {
        frames.push({ event, data: JSON.parse(data), id });
      } catch {
        // Ignore malformed frames; the stream can continue with later frames.
      }
    }
    delimiter = rest.match(/\r?\n\r?\n/);
  }
  return { frames, rest };
}

export async function consumeViewerSseStream(response: ViewerSseResponse, handlers: ViewerSseHandlers): Promise<void> {
  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => ({ error: response.status }));
    if (handlers.isCurrent()) {
      const message = err && typeof err === "object" && "error" in err
        ? (err as { error?: unknown }).error
        : response.status;
      const retryAfter = response.headers?.get("Retry-After") ?? response.headers?.get("retry-after") ?? "";
      const retryAfterSeconds = Math.floor(Number(retryAfter));
      handlers.onErrorResponse(message ?? response.status, {
        error: message ?? response.status,
        status: response.status,
        retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : null,
      });
    }
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const watchdogMs = Number(handlers.watchdogMs || 45000);
  const maxBufferChars = Math.max(1024, Math.floor(Number(handlers.maxBufferChars || 262144)));
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => { try { void reader.cancel(); } catch { /* ignore */ } }, watchdogMs);
  };
  resetWatchdog();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetWatchdog();
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBufferChars) {
        try { void reader.cancel(); } catch { /* ignore */ }
        throw new Error("SSE stream exceeded buffer limit.");
      }
      const parsed = parseViewerSseFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (!handlers.isCurrent()) {
          try { void reader.cancel(); } catch { /* ignore */ }
          return;
        }
        await handlers.onEvent(frame.event, frame.data, frame.id);
      }
    }
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}
