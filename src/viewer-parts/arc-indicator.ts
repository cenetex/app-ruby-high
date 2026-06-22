import type { ArcIndicatorView } from "./client-pure.js";

export interface ArcIndicatorRendererDeps {
  root?: HTMLElement | null;
  year?: HTMLElement | null;
  streak?: HTMLElement | null;
  subject?: HTMLElement | null;
  viewFor(telemetry: unknown, subjects: unknown): ArcIndicatorView;
}

export interface ArcIndicatorRendererRenderOptions {
  subjects: unknown;
}

export interface ArcIndicatorRenderer {
  render(telemetry: unknown, opts: ArcIndicatorRendererRenderOptions): void;
}

export function createArcIndicatorRenderer(deps: ArcIndicatorRendererDeps): ArcIndicatorRenderer {
  return {
    render(telemetry: unknown, opts: ArcIndicatorRendererRenderOptions): void {
      const root = deps.root;
      if (!root) return;
      const view = deps.viewFor(telemetry, opts.subjects);
      if (view.hidden) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      root.classList.toggle("is-graduated", view.graduated);
      if (deps.year) deps.year.textContent = view.yearText;
      if (deps.streak) {
        deps.streak.textContent = view.streakText;
        deps.streak.classList.toggle("is-met", view.streakMet);
      }
      if (deps.subject) {
        deps.subject.textContent = view.subjectText;
        deps.subject.classList.toggle("is-met", view.subjectMet);
      }
    },
  };
}
