// Structured stdout logger. App Runner forwards stdout to CloudWatch, so a
// single-line JSON record per event is all we need to stop being blind in
// prod. No log levels, no deps, no external transports — just events +
// errors with enough metadata to grep on.

const buildId = process.env.RUBY_HIGH_BUILD?.slice(0, 12) ?? "dev";

function emit(level: "event" | "error", name: string, data: Record<string, unknown>): void {
  // Stable field order: ts, level, build, name, ...data. Keeps log lines
  // diffable and easy to scan in a tail.
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    build: buildId,
    name,
    ...data,
  });
  // Errors → stderr so CloudWatch can split them; events → stdout.
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
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
