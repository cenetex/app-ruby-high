export interface ViewerWorldLifecycleLoadOptions {
  force?: boolean;
  initial?: boolean;
  silent?: boolean;
}

export interface ViewerWorldLifecycleControllerDeps {
  document: Pick<Document, "visibilityState" | "addEventListener">;
  window: Pick<Window, "addEventListener">;
  refreshButton?: HTMLElement | null;
  authKeys: readonly string[];
  now(): number;
  loadWorldFeed(opts?: ViewerWorldLifecycleLoadOptions): void | Promise<void>;
  pauseWorldFeedPoll(): void;
  resumeWorldFeedPoll(delayMs?: number): void;
  deriveAuth(): void | Promise<void>;
  initializePrivyFromStoredSession(): void;
  postViewerMetricEvent(name: string, payload: Record<string, unknown>): void;
}

export interface ViewerWorldLifecycleController {
  attach(): void;
  maybePostSessionResume(reason?: string): void;
}

export function createViewerWorldLifecycleController(deps: ViewerWorldLifecycleControllerDeps): ViewerWorldLifecycleController {
  const resumeThresholdMs = 5 * 60 * 1000;
  let attached = false;
  let hiddenAt = deps.document.visibilityState === "hidden" ? deps.now() : 0;
  let lastResumeMetricAt = 0;

  function maybePostSessionResume(reason?: string): void {
    if (hiddenAt <= 0) return;
    const now = deps.now();
    const inactiveMs = now - hiddenAt;
    if (inactiveMs < resumeThresholdMs) return;
    if (lastResumeMetricAt > 0 && now - lastResumeMetricAt < resumeThresholdMs) return;
    lastResumeMetricAt = now;
    hiddenAt = 0;
    deps.postViewerMetricEvent("session_resume", {
      inactiveMs: Math.max(0, Math.floor(inactiveMs || 0)),
      reason: reason || "visible",
    });
  }

  function refreshAuthAndResume(reason: string): void {
    void deps.deriveAuth();
    deps.initializePrivyFromStoredSession();
    maybePostSessionResume(reason);
  }

  function attach(): void {
    if (attached) return;
    attached = true;
    deps.refreshButton?.addEventListener("click", () => {
      void deps.loadWorldFeed({ force: true });
    });
    deps.resumeWorldFeedPoll(20000);
    deps.window.addEventListener("storage", (event: StorageEvent) => {
      if (event.key === null || deps.authKeys.includes(event.key)) void deps.deriveAuth();
    });
    deps.window.addEventListener("focus", () => {
      refreshAuthAndResume("focus");
    });
    deps.window.addEventListener("pageshow", () => {
      refreshAuthAndResume("pageshow");
    });
    deps.document.addEventListener("visibilitychange", () => {
      if (deps.document.visibilityState === "hidden") {
        hiddenAt = deps.now();
        deps.pauseWorldFeedPoll();
        return;
      }
      if (deps.document.visibilityState === "visible") {
        refreshAuthAndResume("visibilitychange");
        void deps.loadWorldFeed({ silent: true });
        deps.resumeWorldFeedPoll(20000);
      }
    });
  }

  return { attach, maybePostSessionResume };
}
