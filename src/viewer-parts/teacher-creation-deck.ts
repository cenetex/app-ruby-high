export interface TeacherCreationRoll {
  displayName?: string;
  subject?: string;
  quote?: string;
  description?: string;
  stats?: unknown;
}

export interface TeacherCreationDeckInput {
  roll: TeacherCreationRoll;
  portraitUrl: string;
  accent: string;
  importBusy: boolean;
  imageBusy: boolean;
  questionGenerationBusy: boolean;
  controls: HTMLElement;
  onSave: () => void;
}

export interface TeacherCreationDeckRendererDeps {
  document: Pick<Document, "createElement">;
  buildCharacterCard: (spec: {
    role: string;
    name: string | undefined;
    subtitle: string;
    portraitUrl: string;
    accent: string;
    stats: unknown;
    quote: string | undefined;
    nextStepHint: string;
    footer: { title: string; content: string | undefined };
  }) => HTMLElement;
}

export interface TeacherCreationDeckRenderer {
  build(input: TeacherCreationDeckInput): HTMLElement;
}

export function createTeacherCreationDeckRenderer(
  deps: TeacherCreationDeckRendererDeps,
): TeacherCreationDeckRenderer {
  return {
    build(input): HTMLElement {
      const candidateCard = deps.buildCharacterCard({
        role: "teacher",
        name: input.roll.displayName,
        subtitle: String(input.roll.subject || "") + " · teacher candidate",
        portraitUrl: input.portraitUrl,
        accent: input.accent,
        stats: input.roll.stats,
        quote: input.roll.quote,
        nextStepHint: "Add this teacher to the pack, then paste materials or generate questions.",
        footer: { title: "Teaching Style", content: input.roll.description },
      });
      candidateCard.classList.add("is-creation-candidate-card");
      const body = candidateCard.querySelector(".ccg-body");
      const actionsRow = deps.document.createElement("div");
      actionsRow.className = "ccg-card-actions";
      const saveBtn = deps.document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "primary teacher-save-button";
      saveBtn.textContent = "Save";
      saveBtn.disabled = input.importBusy || input.imageBusy || input.questionGenerationBusy;
      saveBtn.title = input.imageBusy ? "Cancel teacher image generation before saving." : "";
      saveBtn.addEventListener("click", input.onSave);
      actionsRow.appendChild(saveBtn);
      if (body) {
        body.appendChild(actionsRow);
      }
      const wrap = deps.document.createElement("div");
      wrap.className = "pack-teacher-roll-deck";
      wrap.appendChild(candidateCard);
      wrap.appendChild(input.controls);
      return wrap;
    },
  };
}
