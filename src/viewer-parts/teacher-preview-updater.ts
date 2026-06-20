export interface TeacherPreviewRoll {
  displayName?: string;
  subject?: string;
  quote?: string;
  description?: string;
}

export interface TeacherPreviewUpdaterDeps {
  renderMarkdownInto: (target: Element, source: string, opts?: { inline?: boolean }) => void;
}

export interface TeacherPreviewUpdater {
  refresh(root: ParentNode | null | undefined, roll: TeacherPreviewRoll | null | undefined): void;
}

export function createTeacherPreviewUpdater(deps: TeacherPreviewUpdaterDeps): TeacherPreviewUpdater {
  return {
    refresh(root, roll): void {
      if (!root || !roll) return;
      const card = root.querySelector(".is-creation-candidate-card");
      if (!card) return;
      const nameEl = card.querySelector(".ccg-name");
      if (nameEl) nameEl.textContent = roll.displayName || "New Teacher";
      const subtitleEl = card.querySelector(".ccg-subtitle");
      if (subtitleEl) subtitleEl.textContent = (roll.subject || "Custom class") + " · teacher candidate";
      const quoteEl = card.querySelector(".ccg-quote");
      if (quoteEl) deps.renderMarkdownInto(quoteEl, roll.quote ? "“" + roll.quote + "”" : "", { inline: true });
      const footerEl = card.querySelector(".ccg-footer-content");
      if (footerEl) deps.renderMarkdownInto(footerEl, roll.description || "", { inline: true });
    },
  };
}
