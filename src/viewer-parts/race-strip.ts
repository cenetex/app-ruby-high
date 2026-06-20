import type { RaceStripCardView } from "./client-pure.js";

export interface RaceStripPanelView {
  timer: { label: string; warn: boolean; danger: boolean; locked: boolean };
  cards: RaceStripCardView[];
}

export interface RaceStripRendererDeps {
  document: Pick<Document, "createElement">;
  timerLabel?: HTMLElement | null;
  timerPill?: HTMLElement | null;
  row?: HTMLElement | null;
  viewFor(
    telemetry: unknown,
    students: unknown,
    visibleStudentIds: unknown,
    playerName: unknown,
  ): RaceStripPanelView | null;
}

export interface RaceStripRendererRenderOptions {
  students: unknown;
  visibleStudentIds: unknown;
  playerName: unknown;
}

export interface RaceStripRenderer {
  render(telemetry: unknown, opts: RaceStripRendererRenderOptions): void;
}

export function createRaceStripRenderer(deps: RaceStripRendererDeps): RaceStripRenderer {
  function setTimer(view: RaceStripPanelView): void {
    if (deps.timerLabel) deps.timerLabel.textContent = view.timer.label;
    if (deps.timerPill) {
      deps.timerPill.classList.toggle("is-warn", view.timer.warn);
      deps.timerPill.classList.toggle("is-danger", view.timer.danger);
      deps.timerPill.classList.toggle("is-locked", view.timer.locked);
    }
  }

  function appendThinkingDots(parent: HTMLElement): void {
    const dots = deps.document.createElement("span");
    dots.className = "thinking-dots";
    dots.appendChild(deps.document.createElement("span"));
    dots.appendChild(deps.document.createElement("span"));
    dots.appendChild(deps.document.createElement("span"));
    parent.appendChild(dots);
  }

  function appendCard(parent: HTMLElement, view: RaceStripCardView): void {
    const card = deps.document.createElement("span");
    card.className = "race-card" + (view.isLocked ? " is-locked" : "");
    if (view.isCorrect === true) card.classList.add("is-correct");
    else if (view.isCorrect === false) card.classList.add("is-wrong");
    if (view.isFirstCorrect) card.classList.add("is-first-correct");
    const avatar = deps.document.createElement("span");
    avatar.className = "race-avatar";
    avatar.style.background = view.color;
    avatar.style.color = "#fff";
    avatar.textContent = view.avatarText;
    card.appendChild(avatar);
    const name = deps.document.createElement("span");
    name.textContent = view.name;
    card.appendChild(name);
    if (view.pickText) {
      const pick = deps.document.createElement("span");
      pick.className = "pick-letter";
      pick.textContent = view.pickText;
      if (view.isTimedOut) pick.title = "Timed out";
      card.appendChild(pick);
    } else if (view.showThinking) {
      appendThinkingDots(card);
    }
    parent.appendChild(card);
  }

  return {
    render(telemetry: unknown, opts: RaceStripRendererRenderOptions): void {
      const row = deps.row;
      const view = deps.viewFor(telemetry, opts.students, opts.visibleStudentIds, opts.playerName);
      if (!view) {
        if (row) row.replaceChildren();
        return;
      }
      setTimer(view);
      if (!row) return;
      row.replaceChildren();
      view.cards.forEach((card) => appendCard(row, card));
    },
  };
}
