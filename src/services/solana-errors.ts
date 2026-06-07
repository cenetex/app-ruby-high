export function isPreflightUnsupportedError(err: unknown): boolean {
  return solanaErrorMessages(err).some((message) => (
    /running preflight check is not supported|preflight check is not supported/i.test(message)
  ));
}

export function solanaErrorMessages(err: unknown): string[] {
  const messages: string[] = [];
  collectSolanaErrorMessages(err, messages, new Set());
  return messages;
}

function collectSolanaErrorMessages(err: unknown, messages: string[], seen: Set<unknown>): void {
  if (err == null || seen.has(err)) return;
  seen.add(err);
  if (typeof err === "string") {
    pushSolanaErrorMessage(messages, err);
    return;
  }
  if (err instanceof Error) {
    pushSolanaErrorMessage(messages, err.message);
    collectSolanaErrorMessages((err as Error & { cause?: unknown }).cause, messages, seen);
  }
  if (typeof err !== "object") return;
  const record = err as Record<string, unknown>;
  for (const key of ["message", "errorMessage", "serverMessage", "__serverMessage"]) {
    const value = record[key];
    if (typeof value === "string") pushSolanaErrorMessage(messages, value);
  }
  for (const key of ["context", "cause", "data", "error"]) {
    collectSolanaErrorMessages(record[key], messages, seen);
  }
}

function pushSolanaErrorMessage(messages: string[], message: string): void {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean || messages.includes(clean)) return;
  messages.push(clean);
  for (const decoded of decodeSolanaErrorPayloads(clean)) {
    if (decoded && !messages.includes(decoded)) messages.push(decoded);
  }
}

function decodeSolanaErrorPayloads(message: string): string[] {
  const decoded: string[] = [];
  const pattern = /decode -- -?\d+ ['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const raw = match[1] || "";
    try {
      const text = Buffer.from(raw, "base64").toString("utf8");
      if (text) decoded.push(text);
      const params = new URLSearchParams(text);
      const serverMessage = params.get("__serverMessage") || params.get("serverMessage");
      if (serverMessage) decoded.push(serverMessage);
    } catch (_err) {
      // Ignore malformed SDK decode hints and keep the original error message.
    }
  }
  return decoded.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
}
