// Structured stdout logger. Fly streams stdout/stderr into deploy logs, so a
// single-line JSON record per event is enough to stop being blind in prod. No
// log levels, no deps, no external transports — just events + errors with
// enough metadata to grep on.

const buildId = process.env.RUBY_HIGH_BUILD?.slice(0, 12) ?? "dev";
const quietStdout = truthyEnv(process.env.RUBY_HIGH_QUIET_LOGS);

interface LogMetric {
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface LogSinkRecord {
  ts: string;
  level: "event" | "error";
  build: string;
  name: string;
  data: Record<string, unknown>;
}

const startedAt = new Date().toISOString();
const metrics = new Map<string, LogMetric>();
let logSink: ((record: LogSinkRecord) => void | Promise<void>) | null = null;
const logObservers = new Set<(record: LogSinkRecord) => void | Promise<void>>();
let emittingToSink = false;

function truthyEnv(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function setLogSink(sink: ((record: LogSinkRecord) => void | Promise<void>) | null): () => void {
  const previous = logSink;
  logSink = sink;
  return () => {
    if (logSink === sink) logSink = previous;
  };
}

export function addLogObserver(observer: (record: LogSinkRecord) => void | Promise<void>): () => void {
  logObservers.add(observer);
  return () => {
    logObservers.delete(observer);
  };
}

function recordMetric(level: "event" | "error", name: string, ts: string): void {
  const key = `${level}:${name}`;
  const existing = metrics.get(key);
  if (!existing) {
    metrics.set(key, { count: 1, firstAt: ts, lastAt: ts });
    return;
  }
  existing.count += 1;
  existing.lastAt = ts;
}

function reportSinkFailure(err: unknown): void {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    build: buildId,
    name: "logger.sink-failed",
    message: err instanceof Error ? err.message : String(err),
  }) + "\n");
}

function emit(level: "event" | "error", name: string, data: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  recordMetric(level, name, ts);
  // Stable field order: ts, level, build, name, ...data. Keeps log lines
  // diffable and easy to scan in a tail.
  const { name: payloadName, ...safeData } = data;
  const payload = {
    ts,
    level,
    build: buildId,
    name,
    ...safeData,
    ...(payloadName === undefined ? {} : { payloadName }),
  };
  const line = JSON.stringify({
    ...payload,
  });
  const record: LogSinkRecord = {
    ts,
    level,
    build: buildId,
    name,
    data: payload,
  };
  // Errors → stderr so the platform can split them; events → stdout.
  // Tests can silence terminal noise without disabling metrics or sinks.
  if (!quietStdout) {
    if (level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  }
  if ((!logSink && logObservers.size === 0) || emittingToSink) return;
  emittingToSink = true;
  try {
    const sinks = [
      ...(logSink ? [logSink] : []),
      ...Array.from(logObservers),
    ];
    for (const sink of sinks) {
      try {
        Promise.resolve(sink(record)).catch(reportSinkFailure);
      } catch (err) {
        reportSinkFailure(err);
      }
    }
  } finally {
    emittingToSink = false;
  }
}

export const log = {
  event(name: string, data: Record<string, unknown> = {}): void {
    emit("event", name, data);
  },
  error(name: string, err: unknown, data: Record<string, unknown> = {}): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    emit("error", name, { ...data, message, ...(stack ? { stack } : {}) });
  },
};

export function logMetricsSnapshot(): {
  build: string;
  startedAt: string;
  counters: Array<{ level: "event" | "error"; name: string; count: number; firstAt: string; lastAt: string }>;
} {
  return {
    build: buildId,
    startedAt,
    counters: Array.from(metrics.entries())
      .map(([key, value]) => {
        const [level, ...rest] = key.split(":");
        return {
          level: level === "error" ? "error" as const : "event" as const,
          name: rest.join(":"),
          count: value.count,
          firstAt: value.firstAt,
          lastAt: value.lastAt,
        };
      })
      .sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name)),
  };
}
