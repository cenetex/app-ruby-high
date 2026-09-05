type RequestFailure = { name?: string; kind?: string; message?: string; status?: number };

export function viewerRequestFailureKind(error: unknown, status?: number): "timeout" | "network" | "other" {
  const failure = error && typeof error === "object" ? error as RequestFailure : {};
  const code = status ?? failure.status;
  if (failure.name === "AbortError" || failure.name === "TimeoutError" || failure.kind === "timeout" || code === 408 || code === 504) {
    return "timeout";
  }
  if (failure.kind === "network" || /failed to fetch|load failed|networkerror|network error/i.test(failure.message || "")) {
    return "network";
  }
  return "other";
}

// Action names come from the viewer. Server bodies stay out of player copy.
export function viewerRequestError(action: string, error: unknown, status?: number): string {
  const failure = error && typeof error === "object" ? error as RequestFailure : {};
  const code = status ?? failure.status;
  const kind = viewerRequestFailureKind(error, code);
  if (kind === "timeout") return action + " took too long. Try again in a moment.";
  if (kind === "network") return action + " lost its connection. Check your connection and try again.";
  if (code === 401) return "Sign in again from Account, then try " + action.toLowerCase() + " again.";
  if (code === 403) return "Open Account to check your access, then try " + action.toLowerCase() + " again.";
  if (code === 402) return "Open Account to check your balance, then try " + action.toLowerCase() + " again.";
  if (code === 429) return action + " is busy. Wait a moment and try again.";
  return action + " is unavailable right now. Try again in a moment.";
}

export function studentRemixFallbackMessage(error: unknown): string {
  const kind = viewerRequestFailureKind(error);
  const reason = kind === "timeout"
    ? "The AI remix took too long."
    : kind === "network"
      ? "The AI remix lost its connection."
      : "The AI remix is unavailable right now.";
  return reason + " Ruby created your student on this device. You can start class.";
}
