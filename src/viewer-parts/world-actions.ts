type WorldActionKind = "hide" | "report";
type LooseRecord = Record<string, any>;

export interface ViewerWorldActionsCommandResult {
  message?: unknown;
}

export interface ViewerWorldActionsControllerDeps {
  root?: HTMLElement | null;
  command(payload: unknown): Promise<ViewerWorldActionsCommandResult | unknown | null>;
  removeEvent(eventId: string): void;
  refreshWorld(opts?: { force?: boolean; silent?: boolean }): Promise<void> | void;
  notify(message: string, ok: boolean): void;
}

export interface ViewerWorldActionsController {
  attach(): void;
  handleClick(event: Event): Promise<void>;
}

export function createViewerWorldActionsController(deps: ViewerWorldActionsControllerDeps): ViewerWorldActionsController {
  let attached = false;
  const busy = new Set<string>();

  function actionButton(target: EventTarget | null): HTMLElement | null {
    if (!target || typeof (target as HTMLElement).closest !== "function") return null;
    const found = (target as HTMLElement).closest("[data-world-event-action]");
    return found && typeof (found as HTMLElement).dataset === "object" ? found as HTMLElement : null;
  }

  function actionFromButton(button: HTMLElement): { action: WorldActionKind; eventId: string } | null {
    const action = button.dataset.worldEventAction === "report" ? "report" : button.dataset.worldEventAction === "hide" ? "hide" : "";
    const eventId = typeof button.dataset.worldEventId === "string" ? button.dataset.worldEventId.trim() : "";
    if (!action || !eventId) return null;
    return { action, eventId };
  }

  function commandPayload(action: WorldActionKind, eventId: string): LooseRecord {
    return action === "report"
      ? { type: "report-public-world-event", eventId, reason: "player-report" }
      : { type: "hide-public-world-event", eventId };
  }

  function successMessage(action: WorldActionKind, result: unknown): string {
    if (result && typeof result === "object" && (result as LooseRecord).message) {
      return String((result as LooseRecord).message);
    }
    return action === "report" ? "Public world event reported" : "Public world event hidden";
  }

  async function handleClick(event: Event): Promise<void> {
    const button = actionButton(event.target);
    if (!button) return;
    const parsed = actionFromButton(button);
    if (!parsed) return;
    event.preventDefault();
    const key = parsed.action + ":" + parsed.eventId;
    if (busy.has(key)) return;
    busy.add(key);
    button.setAttribute("disabled", "");
    try {
      const result = await deps.command(commandPayload(parsed.action, parsed.eventId));
      if (!result) {
        button.removeAttribute("disabled");
        return;
      }
      deps.removeEvent(parsed.eventId);
      deps.notify(successMessage(parsed.action, result), true);
      await deps.refreshWorld({ force: true, silent: true });
    } catch (err) {
      button.removeAttribute("disabled");
      deps.notify(err instanceof Error ? err.message : "World action failed", false);
    } finally {
      busy.delete(key);
    }
  }

  function attach(): void {
    if (attached || !deps.root) return;
    attached = true;
    deps.root.addEventListener("click", (event) => {
      void handleClick(event);
    });
  }

  return {
    attach,
    handleClick,
  };
}
