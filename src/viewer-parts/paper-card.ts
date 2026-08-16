export interface PaperCardEntry {
  grade?: string | number;
  playbookId?: string;
  name?: string;
  stats?: unknown;
  portraitDataUrl?: string;
  flavorQuote?: string;
  arcAnswer?: string;
  completedAt?: unknown;
  summary?: {
    correct?: number;
    total?: number;
  };
}

export interface PaperCardCharacter {
  playbookId?: string;
  name?: string;
  stats?: unknown;
  portraitDataUrl?: string;
}

export interface PaperCardPlaybook {
  id?: string;
  accent?: string;
}

export interface PaperCardCharacterCardSpec {
  role: string;
  name?: string;
  subtitle: string;
  portraitUrl?: string;
  accent?: string;
  stats?: unknown;
  quote?: string;
}

export interface PaperCardRendererDeps {
  gradeLabels: Record<string, string>;
  buildCharacterCard(spec: PaperCardCharacterCardSpec): HTMLElement;
  defaultPortraitFor(playbookId: string | undefined): string;
  formatSealedDate(ts: unknown): string;
}

export interface PaperCardRenderer {
  build(
    entry: PaperCardEntry,
    liveChar: PaperCardCharacter,
    livePb: PaperCardPlaybook,
    playbooks: PaperCardPlaybook[] | unknown,
  ): HTMLElement;
}

export function createPaperCardRenderer(deps: PaperCardRendererDeps): PaperCardRenderer {
  return {
    build(entry, liveChar, livePb, playbooks): HTMLElement {
      const grade = entry.grade;
      const gradeLabel = deps.gradeLabels[String(grade)] || ("Grade " + grade);
      const playbookId = entry.playbookId || liveChar.playbookId;
      const pb = (Array.isArray(playbooks) && playbooks.find((p) => p.id === playbookId)) || livePb;
      const name = entry.name || liveChar.name;
      const stats = entry.stats || liveChar.stats;
      const portraitUrl = entry.portraitDataUrl
        || liveChar.portraitDataUrl
        || deps.defaultPortraitFor(playbookId);
      const quote = entry.flavorQuote || entry.arcAnswer || "";
      const summary = entry.summary || { correct: 0, total: 0 };
      const sealedSubtitle = "\u2713 " + gradeLabel + " \u00b7 completed " + deps.formatSealedDate(entry.completedAt)
        + " \u00b7 " + summary.correct + "/" + summary.total + " correct";

      const card = deps.buildCharacterCard({
        role: "player",
        name,
        subtitle: sealedSubtitle,
        portraitUrl,
        accent: pb.accent,
        stats,
        quote,
      });
      card.classList.add("is-paper-card");
      return card;
    },
  };
}
