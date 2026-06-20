import type { WelcomeHallPassPopupView } from "./client-pure.js";

export interface WelcomeHallPassPopupRendererDeps {
  document: Pick<Document, "createElement" | "addEventListener" | "removeEventListener"> & {
    body: HTMLElement;
  };
  artUrl: string;
  viewFor(
    grant: unknown,
    opts: {
      fromBilling: boolean;
      portraitConfigured: boolean;
      hasCharacter: boolean;
    },
  ): WelcomeHallPassPopupView;
  portraitConfigured(): boolean;
  hasCharacter(): boolean;
  markSeen(grant: unknown): void;
  setOpen(open: boolean): void;
  openAccount(): void | Promise<void>;
  openCharacterCreation(): void;
}

export interface WelcomeHallPassPopupShowOptions {
  source?: string;
}

export interface WelcomeHallPassPopupRenderer {
  show(grant: unknown, opts?: WelcomeHallPassPopupShowOptions): void;
}

export function createWelcomeHallPassPopupRenderer(
  deps: WelcomeHallPassPopupRendererDeps,
): WelcomeHallPassPopupRenderer {
  return {
    show(grant: unknown, opts?: WelcomeHallPassPopupShowOptions): void {
      deps.setOpen(true);
      const fromBilling = opts?.source === "billing";
      const hasCharacter = deps.hasCharacter();
      const view = deps.viewFor(grant, {
        fromBilling,
        portraitConfigured: deps.portraitConfigured(),
        hasCharacter,
      });
      const overlay = deps.document.createElement("div");
      overlay.className = "welcome-hall-pass-popup";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");

      const panel = deps.document.createElement("div");
      panel.className = "welcome-hall-pass-panel";
      const art = deps.document.createElement("img");
      art.className = "welcome-hall-pass-art";
      art.alt = "";
      art.hidden = true;
      art.addEventListener("load", () => {
        art.hidden = false;
        panel.classList.add("has-art");
      });
      art.addEventListener("error", () => {
        art.remove();
      }, { once: true });
      art.src = deps.artUrl;
      const copy = deps.document.createElement("div");
      copy.className = "welcome-hall-pass-copy";
      const title = deps.document.createElement("h2");
      title.textContent = view.titleText;
      const body = deps.document.createElement("p");
      body.textContent = view.bodyText;
      const actions = deps.document.createElement("div");
      actions.className = "welcome-hall-pass-actions";
      const later = deps.document.createElement("button");
      later.type = "button";
      later.className = "secondary";
      later.textContent = "Later";
      const create = deps.document.createElement("button");
      create.type = "button";
      create.textContent = view.primaryText;
      if (view.showLater) actions.appendChild(later);
      actions.appendChild(create);
      copy.appendChild(title);
      copy.appendChild(body);
      copy.appendChild(actions);
      panel.appendChild(art);
      panel.appendChild(copy);
      overlay.appendChild(panel);

      const close = (): void => {
        deps.markSeen(grant);
        deps.setOpen(false);
        deps.document.removeEventListener("keydown", onKey);
        overlay.remove();
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") close();
      };
      later.addEventListener("click", close);
      create.addEventListener("click", () => {
        close();
        if (fromBilling) return;
        if (hasCharacter) {
          void deps.openAccount();
        } else {
          deps.openCharacterCreation();
        }
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close();
      });
      deps.document.addEventListener("keydown", onKey);
      deps.document.body.appendChild(overlay);
    },
  };
}
