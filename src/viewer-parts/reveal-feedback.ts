export interface RevealFeedbackRoll {
  outcome?: string;
  total?: number;
  dice?: number[];
  stat?: unknown;
}

export interface RevealFeedbackReveal {
  questionId?: unknown;
  wasCorrect?: boolean;
  picked?: unknown;
  correct?: unknown;
  forfeit?: boolean;
  answerText?: unknown;
  expectedAnswer?: unknown;
  answerJudge?: unknown;
  playerRoll?: RevealFeedbackRoll | null;
  scoreAward?: unknown;
  scoreMultiplier?: unknown;
}

export interface RevealFeedbackRelationshipEvent {
  studentId?: string;
  delta?: unknown;
  circled?: boolean;
  scratched?: boolean;
  reason?: string;
}

export interface RevealFeedbackRendererDeps {
  document: Pick<Document, "createElement" | "createTextNode">;
  statLabel(stat: unknown): string;
  scoreAwardLabel(award: unknown): string;
  mashTickLabel(event: RevealFeedbackRelationshipEvent): string;
  mashTickStory(event: RevealFeedbackRelationshipEvent): string;
  studentNameById(studentId: unknown): string;
  studentColorById(studentId: unknown): string;
}

export interface RevealFeedbackRenderer {
  buildSocialSummary(events: RevealFeedbackRelationshipEvent[]): HTMLElement | null;
  buildResult(reveal: RevealFeedbackReveal, questionCounter: number, events: RevealFeedbackRelationshipEvent[]): HTMLElement;
}

export function createRevealFeedbackRenderer(deps: RevealFeedbackRendererDeps): RevealFeedbackRenderer {
  function deltaClass(deltaInput: unknown, prefix: string): string {
    const delta = Number(deltaInput || 0);
    if (delta > 0) return prefix + "up";
    if (delta < 0) return prefix + "down";
    return prefix + "steady";
  }

  function signed(n: number): string {
    return n > 0 ? "+" + n : String(n);
  }

  function timestamp(): string {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function appendMashTickChips(body: HTMLElement, events: RevealFeedbackRelationshipEvent[]): void {
    events.forEach((event) => {
      const chip = deps.document.createElement("span");
      chip.className = "mash-tick-chip " + deltaClass(event.delta, "");
      chip.textContent = deps.mashTickLabel(event);
      if (event.circled) chip.title = deps.studentNameById(event.studentId) + " is circled on your Social card.";
      else if (event.scratched) chip.title = deps.studentNameById(event.studentId) + " is scratched on your Social card.";
      body.appendChild(chip);
    });
  }

  function buildRollChip(roll: RevealFeedbackRoll): HTMLElement {
    const chip = deps.document.createElement("span");
    chip.className = "roll-chip " + (roll.outcome || "");
    const dice = Array.isArray(roll.dice) ? roll.dice : [0, 0];
    const left = Number(dice[0] || 0);
    const right = Number(dice[1] || 0);
    const total = Number(roll.total || 0);
    const mod = total - (left + right);
    const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
    chip.textContent = "🎲 " + left + "+" + right + fmt(mod) + " " + deps.statLabel(roll.stat) + " = " + total;
    return chip;
  }

  function resultBadgeText(reveal: RevealFeedbackReveal): string {
    const isTypedReveal = reveal.answerText != null || reveal.expectedAnswer != null || reveal.answerJudge != null;
    if (isTypedReveal) {
      if (reveal.forfeit) return "⏱ timeout";
      return reveal.wasCorrect ? "✓ typed" : "✗ typed";
    }
    if (reveal.forfeit) return "⏱ timeout";
    return reveal.wasCorrect ? "✓ " + reveal.picked : "✗ " + reveal.picked + " · " + reveal.correct;
  }

  function resultSummaryText(reveal: RevealFeedbackReveal, questionCounter: number): string {
    return "Q" + questionCounter + " — " + (reveal.forfeit ? "timed out" : reveal.wasCorrect ? "correct" : "missed");
  }

  return {
    buildSocialSummary(events): HTMLElement | null {
      if (events.length === 0) return null;
      const wrap = deps.document.createElement("div");
      wrap.className = "msg social-summary";
      const avatar = deps.document.createElement("div");
      avatar.className = "avatar social-summary-avatar";
      avatar.textContent = "S";

      const head = deps.document.createElement("div");
      head.className = "head";
      const name = deps.document.createElement("span");
      name.className = "name";
      name.textContent = "Social Shift";
      head.appendChild(name);
      const stamp = deps.document.createElement("span");
      stamp.className = "stamp";
      stamp.textContent = timestamp();
      head.appendChild(stamp);

      const body = deps.document.createElement("div");
      body.className = "body";
      const list = deps.document.createElement("div");
      list.className = "social-summary-list";
      events.forEach((event) => {
        const row = deps.document.createElement("div");
        row.className = "social-summary-row " + deltaClass(event.delta, "is-");
        const dot = deps.document.createElement("span");
        dot.className = "social-summary-dot";
        dot.style.background = deps.studentColorById(event.studentId);
        row.appendChild(dot);
        const story = deps.document.createElement("span");
        story.className = "social-summary-story";
        story.textContent = deps.mashTickStory(event);
        row.appendChild(story);
        const delta = deps.document.createElement("span");
        delta.className = "social-summary-delta";
        delta.textContent = signed(Number(event.delta || 0));
        row.appendChild(delta);
        list.appendChild(row);
      });
      body.appendChild(list);
      wrap.appendChild(avatar);
      wrap.appendChild(head);
      wrap.appendChild(body);
      return wrap;
    },
    buildResult(reveal, questionCounter, events): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "msg result";
      const body = deps.document.createElement("div");
      body.className = "body";
      const badge = deps.document.createElement("span");
      badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");
      badge.textContent = resultBadgeText(reveal);
      body.appendChild(badge);
      body.appendChild(deps.document.createTextNode(resultSummaryText(reveal, questionCounter)));
      if (reveal.playerRoll) body.appendChild(buildRollChip(reveal.playerRoll));
      if (reveal.scoreAward || Number(reveal.scoreMultiplier || 1) > 1) {
        const mult = deps.document.createElement("span");
        mult.className = "score-multiplier-chip";
        const scoreMult = Number(reveal.scoreMultiplier || 1);
        mult.textContent = reveal.scoreAward
          ? deps.scoreAwardLabel(reveal.scoreAward)
          : (scoreMult >= 5 ? "◆ Daily Class ×5" : "◆ ×" + scoreMult + " Merit Stars");
        body.appendChild(mult);
      }
      appendMashTickChips(body, events);
      wrap.appendChild(body);
      return wrap;
    },
  };
}
