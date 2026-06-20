export interface CareerTokenSpec {
  streakReq?: unknown;
  streakHere?: unknown;
  streakLastDate?: unknown;
  todayKey?: unknown;
  advantageCap?: unknown;
  advantageRemaining?: unknown;
}

export interface CareerTokensRendererDeps {
  document: Pick<Document, "createElement">;
  streakScoreMultiplier(streak: number): number;
}

export interface CareerTokensRenderer {
  build(spec: CareerTokenSpec): HTMLElement;
}

export function createCareerTokensRenderer(deps: CareerTokensRendererDeps): CareerTokensRenderer {
  function positiveNumber(value: unknown): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function appendLabel(parent: HTMLElement, text: string): void {
    const label = deps.document.createElement("span");
    label.className = "career-token-label";
    label.textContent = text;
    parent.appendChild(label);
  }

  function appendStreakLane(parent: HTMLElement, spec: CareerTokenSpec): void {
    const streak = deps.document.createElement("div");
    streak.className = "career-token-lane";
    appendLabel(streak, "Daily classes");
    const streakTrack = deps.document.createElement("span");
    streakTrack.className = "career-streak-track";
    const streakCap = Math.min(3, positiveNumber(spec.streakReq));
    const currentStreak = positiveNumber(spec.streakHere);
    const sameDay = !!(spec.streakLastDate && spec.todayKey && spec.streakLastDate === spec.todayKey);
    const scoreStreak = sameDay ? Math.max(0, currentStreak - 1) : currentStreak;
    const streakFilled = Math.max(0, Math.min(streakCap, currentStreak));
    const liveMult = deps.streakScoreMultiplier(scoreStreak);
    if (liveMult >= 2) {
      streakTrack.classList.add("is-bonus-only");
      const chip = deps.document.createElement("span");
      chip.className = "career-multiplier is-live is-bonus";
      chip.textContent = "\u00d7" + liveMult + " Bonus!";
      chip.setAttribute("aria-label", "\u00d7" + liveMult + " score bonus active");
      streakTrack.appendChild(chip);
      streak.appendChild(streakTrack);
    } else {
      const diamonds = deps.document.createElement("span");
      diamonds.className = "career-diamonds";
      for (let i = 0; i < streakCap; i += 1) {
        const diamond = deps.document.createElement("span");
        diamond.className = "career-diamond" + (i < streakFilled ? " is-filled" : "");
        diamond.setAttribute("aria-label", i < streakFilled ? "Daily class passed" : "Daily class needed");
        diamonds.appendChild(diamond);
      }
      streakTrack.appendChild(diamonds);
      streak.appendChild(streakTrack);
      const streakCount = deps.document.createElement("span");
      streakCount.className = "career-token-count";
      streakCount.textContent = streakFilled + "/" + streakCap;
      streak.appendChild(streakCount);
    }
    parent.appendChild(streak);
  }

  function appendAdvantageLane(parent: HTMLElement, spec: CareerTokenSpec): void {
    const advantage = deps.document.createElement("div");
    advantage.className = "career-token-lane";
    appendLabel(advantage, "Advantage");
    const dice = deps.document.createElement("span");
    dice.className = "career-dice";
    const dieCap = positiveNumber(spec.advantageCap);
    const remaining = Math.max(0, Math.min(dieCap, positiveNumber(spec.advantageRemaining)));
    for (let i = 0; i < dieCap; i += 1) {
      const die = deps.document.createElement("span");
      die.className = "career-die" + (i < remaining ? " is-live" : "");
      die.setAttribute("aria-label", i < remaining ? "Advantage die available" : "Advantage die spent");
      for (let p = 0; p < 5; p += 1) die.appendChild(deps.document.createElement("span"));
      dice.appendChild(die);
    }
    advantage.appendChild(dice);
    const advantageCount = deps.document.createElement("span");
    advantageCount.className = "career-token-count";
    advantageCount.textContent = dieCap === 0 ? "\u2014" : remaining === 0 ? "Spent" : remaining + "/" + dieCap;
    advantage.appendChild(advantageCount);
    parent.appendChild(advantage);
  }

  return {
    build(spec): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "career-token-strip";
      appendStreakLane(wrap, spec || {});
      appendAdvantageLane(wrap, spec || {});
      return wrap;
    },
  };
}
