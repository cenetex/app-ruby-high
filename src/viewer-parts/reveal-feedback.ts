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
  mashTickStory(event: RevealFeedbackRelationshipEvent): string;
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

  function primaryRelationshipEvent(events: RevealFeedbackRelationshipEvent[]): RevealFeedbackRelationshipEvent | null {
    if (events.length === 0) return null;
    return events.find((event) => event.circled || event.scratched)
      || events.find((event) => Number(event.delta || 0) !== 0)
      || events[0]!
      || null;
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
    chip.textContent = "roll " + left + "+" + right + fmt(mod) + " " + deps.statLabel(roll.stat) + " = " + total;
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
    return "Class note Q" + questionCounter + " · " + (reveal.forfeit ? "timed out" : reveal.wasCorrect ? "correct" : "missed");
  }

  return {
    buildSocialSummary(events): HTMLElement | null {
      const primaryEvent = primaryRelationshipEvent(events);
      if (!primaryEvent) return null;
      const wrap = deps.document.createElement("div");
      wrap.className = "msg social-summary";
      const avatar = deps.document.createElement("div");
      avatar.className = "avatar social-summary-avatar";
      avatar.textContent = "S";

      const head = deps.document.createElement("div");
      head.className = "head";
      const name = deps.document.createElement("span");
      name.className = "name";
      name.textContent = "Classmate Note";
      head.appendChild(name);
      const stamp = deps.document.createElement("span");
      stamp.className = "stamp";
      stamp.textContent = timestamp();
      head.appendChild(stamp);

      const body = deps.document.createElement("div");
      body.className = "body";
      const list = deps.document.createElement("div");
      list.className = "social-summary-list";
      const row = deps.document.createElement("div");
      row.className = "social-summary-row " + deltaClass(primaryEvent.delta, "is-") + " is-primary";
      const dot = deps.document.createElement("span");
      dot.className = "social-summary-dot";
      dot.style.background = deps.studentColorById(primaryEvent.studentId);
      row.appendChild(dot);
      const story = deps.document.createElement("span");
      story.className = "social-summary-story";
      story.textContent = deps.mashTickStory(primaryEvent);
      row.appendChild(story);
      const delta = deps.document.createElement("span");
      delta.className = "social-summary-delta";
      delta.textContent = signed(Number(primaryEvent.delta || 0));
      row.appendChild(delta);
      list.appendChild(row);
      body.appendChild(list);
      wrap.appendChild(avatar);
      wrap.appendChild(head);
      wrap.appendChild(body);
      return wrap;
    },
    buildResult(reveal, questionCounter, _events): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "msg result class-note-result";
      const body = deps.document.createElement("div");
      body.className = "body class-note-body";
      const main = deps.document.createElement("div");
      main.className = "class-note-main";
      const badge = deps.document.createElement("span");
      badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");
      badge.textContent = resultBadgeText(reveal);
      main.appendChild(badge);
      const title = deps.document.createElement("span");
      title.className = "class-note-title";
      title.textContent = resultSummaryText(reveal, questionCounter);
      main.appendChild(title);
      body.appendChild(main);

      const receipts = deps.document.createElement("div");
      receipts.className = "class-note-receipts";
      if (reveal.playerRoll) receipts.appendChild(buildRollChip(reveal.playerRoll));
      if (reveal.scoreAward || Number(reveal.scoreMultiplier || 1) > 1) {
        const mult = deps.document.createElement("span");
        mult.className = "score-multiplier-chip";
        const scoreMult = Number(reveal.scoreMultiplier || 1);
        mult.textContent = reveal.scoreAward
          ? deps.scoreAwardLabel(reveal.scoreAward)
          : (scoreMult >= 5 ? "◆ Daily Class ×5" : "◆ ×" + scoreMult + " Merit Stars");
        receipts.appendChild(mult);
      }
      if (receipts.children.length > 0) body.appendChild(receipts);
      wrap.appendChild(body);
      return wrap;
    },
  };
}
