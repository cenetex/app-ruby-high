export interface ViewerSseEvent {
  event: string;
  data: unknown;
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
  body?: {
    getReader(): ViewerSseReader;
  } | null;
  json(): Promise<unknown>;
}

export interface ViewerSseHandlers {
  isCurrent(): boolean;
  onErrorResponse(error: unknown): void;
  onEvent(event: string, data: unknown): void | Promise<void>;
  watchdogMs?: number;
}

export function parseViewerSseFrames(buffer: string): ViewerSseParseResult {
  const frames: ViewerSseEvent[] = [];
  let rest = buffer;
  let frameEnd = rest.indexOf("\n\n");
  while (frameEnd !== -1) {
    const rawFrame = rest.slice(0, frameEnd);
    rest = rest.slice(frameEnd + 2);
    const lines = rawFrame.split(/\r?\n/);
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) {
      try {
        frames.push({ event, data: JSON.parse(data) });
      } catch {
        // Ignore malformed frames; the stream can continue with later frames.
      }
    }
    frameEnd = rest.indexOf("\n\n");
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
      handlers.onErrorResponse(message ?? response.status);
    }
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const watchdogMs = Number(handlers.watchdogMs || 45000);
  const watchdog = setTimeout(() => { try { void reader.cancel(); } catch { /* ignore */ } }, watchdogMs);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseViewerSseFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (!handlers.isCurrent()) {
          try { void reader.cancel(); } catch { /* ignore */ }
          return;
        }
        await handlers.onEvent(frame.event, frame.data);
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
}
