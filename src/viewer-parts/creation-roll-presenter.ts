export interface CreationRollCandidateRefs {
  card: HTMLElement;
  role: HTMLElement;
  portraitImg: HTMLImageElement;
  name: HTMLElement;
  subtitle: HTMLElement;
  stats: HTMLElement;
  quote: HTMLElement;
  moveTitle: HTMLElement;
  moveContent: HTMLElement;
}

export interface CreationRollRowRefs {
  val: HTMLElement;
  input?: HTMLInputElement;
  select?: HTMLSelectElement;
}

export interface CreationRollRows {
  nameRow: CreationRollRowRefs;
  playbookRow: CreationRollRowRefs;
  statsRow: CreationRollRowRefs;
  personalityRow: CreationRollRowRefs;
  quoteRow: CreationRollRowRefs;
}

export interface CreationRollPlaybook {
  id?: string;
  name?: string;
  accent?: string;
  startingMove?: {
    name?: string;
    description?: string;
  };
}

export interface CreationRollCharacter {
  name?: string;
  playbookId?: string;
  stats?: Record<string, unknown>;
  personality?: string;
  flavorQuote?: string;
  arcAnswer?: string;
}

export interface CreationRollPresenterDeps {
  renderMarkdownInto(parent: HTMLElement, markdown: string, opts?: unknown): void;
  renderCreationStatsInto(parent: HTMLElement, stats: unknown): void;
  defaultPortraitFor(playbookId: string | undefined): string;
}

export interface CreationRollPresenter {
  renderRolled(
    c: CreationRollCharacter,
    playbooks: CreationRollPlaybook[],
    candidate: CreationRollCandidateRefs,
    rows: CreationRollRows,
    hasAiPortrait: boolean,
  ): void;
}

export function createCreationRollPresenter(deps: CreationRollPresenterDeps): CreationRollPresenter {
  function fmt(n: unknown): string {
    const value = Number(n || 0);
    return (value >= 0 ? "+" : "") + value;
  }

  function quoteText(c: CreationRollCharacter): string {
    return c.flavorQuote ? "\u201c" + c.flavorQuote + "\u201d" : (c.arcAnswer ? "\u201c" + c.arcAnswer + "\u201d" : "\u2014");
  }

  function setRowText(row: CreationRollRowRefs, value: string): void {
    if (row.input) {
      row.input.value = value;
      return;
    }
    if (row.select) {
      row.select.value = value;
      return;
    }
    row.val.textContent = value;
  }

  return {
    renderRolled(c, playbooks, candidate, rows, hasAiPortrait): void {
      const pb = playbooks.find((p) => p.id === c.playbookId)
        || { name: c.playbookId, startingMove: { name: "\u2014", description: "" } };
      candidate.name.textContent = c.name || "\u2014";
      candidate.subtitle.textContent = (pb.name || c.playbookId || "Student") + " \u00b7 Grade 9 student";
      if (pb.accent) {
        candidate.card.style.borderColor = pb.accent;
        candidate.role.style.background = pb.accent;
      }
      deps.renderCreationStatsInto(candidate.stats, c.stats);
      deps.renderMarkdownInto(candidate.quote, quoteText(c), { inline: true });
      candidate.moveTitle.textContent = pb.startingMove && pb.startingMove.name ? pb.startingMove.name : "Starting strength";
      deps.renderMarkdownInto(candidate.moveContent, pb.startingMove && pb.startingMove.description ? pb.startingMove.description : "No starting strength yet.", { inline: true });
      setRowText(rows.nameRow, c.name || "");
      setRowText(rows.playbookRow, rows.playbookRow.select ? (c.playbookId || "") : (pb.name || ""));
      const stats = c.stats || {};
      rows.statsRow.val.textContent = "HEAD " + fmt(stats.head) + " \u00b7 HEART " + fmt(stats.heart) + " \u00b7 HUSTLE " + fmt(stats.hustle) + " \u00b7 HONOR " + fmt(stats.honor);
      rows.personalityRow.val.textContent = c.personality || "";
      deps.renderMarkdownInto(rows.quoteRow.val, quoteText(c), { inline: true });
      if (!hasAiPortrait) {
        candidate.portraitImg.src = deps.defaultPortraitFor(c.playbookId);
      }
    },
  };
}
