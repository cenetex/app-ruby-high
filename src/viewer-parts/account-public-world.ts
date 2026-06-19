import type { AccountPublicWorldView } from "./client-pure.js";

export interface AccountPublicWorldElements {
  summary?: HTMLElement | null;
  status?: HTMLElement | null;
  toggle?: HTMLButtonElement | null;
}

export interface AccountPublicWorldControllerDeps {
  elements: AccountPublicWorldElements;
  getCharacter(): unknown;
  isAuthed(): boolean;
  isBusy(): boolean;
  setBusy(busy: boolean): void;
  viewFor(character: unknown, opts: { authed: boolean; busy: boolean }): AccountPublicWorldView;
  command(payload: { type: "set-public-presence"; publicWorldVisible: boolean }): Promise<{ session?: unknown } | null | undefined>;
  notify(message: string, ok: boolean): void;
  setStatus(message: string, isError: boolean): void;
  onUpdated(): void;
}

export interface AccountPublicWorldController {
  render(): void;
  toggle(): Promise<void>;
}

export function createAccountPublicWorldController(deps: AccountPublicWorldControllerDeps): AccountPublicWorldController {
  function currentView(): AccountPublicWorldView {
    return deps.viewFor(deps.getCharacter(), {
      authed: deps.isAuthed(),
      busy: deps.isBusy(),
    });
  }

  function render(): void {
    const view = currentView();
    if (deps.elements.summary) {
      deps.elements.summary.textContent = view.summaryText;
    }
    if (deps.elements.status) {
      deps.elements.status.textContent = view.statusText;
      deps.elements.status.classList.toggle("is-visible", view.visible);
    }
    if (deps.elements.toggle) {
      deps.elements.toggle.textContent = view.toggleText;
      deps.elements.toggle.disabled = view.toggleDisabled;
      deps.elements.toggle.title = view.toggleTitle;
    }
  }

  async function toggle(): Promise<void> {
    const view = currentView();
    if (view.toggleDisabled) return;
    deps.setBusy(true);
    render();
    try {
      const data = await deps.command({
        type: "set-public-presence",
        publicWorldVisible: view.nextVisible,
      });
      if (data && data.session) {
        deps.notify(view.nextVisible ? "Public world presence enabled" : "Public world presence hidden", true);
        deps.onUpdated();
      } else {
        deps.setStatus("Could not update public world presence.", true);
      }
    } finally {
      deps.setBusy(false);
      render();
    }
  }

  return {
    render,
    toggle,
  };
}
