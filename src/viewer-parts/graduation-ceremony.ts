export interface GraduationChoice {
  label?: string;
  detail?: string;
  reward?: unknown;
}

export interface GraduationChoiceControls {
  status: HTMLElement;
  buttons: HTMLButtonElement[];
}

export interface GraduationCeremonySpec {
  onBoard?: boolean;
  completedGradeLabel?: string;
  finalGradeLetter?: string;
  scoreText?: string;
  targetLabel?: string;
  hasNextGrade?: boolean;
  photoLaterNote?: string;
  choices?: GraduationChoice[];
  onChoice?(reward: unknown, button: HTMLButtonElement, controls: GraduationChoiceControls): void;
}

export interface GraduationCeremonyRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface GraduationCeremonyRenderer {
  build(spec: GraduationCeremonySpec): HTMLElement;
}

export function createGraduationCeremonyRenderer(
  deps: GraduationCeremonyRendererDeps,
): GraduationCeremonyRenderer {
  return {
    build(spec): HTMLElement {
      const wrap = deps.document.createElement(spec.onBoard ? "section" : "div");
      wrap.className = spec.onBoard ? "graduation-board-card" : "graduation-ceremony";
      const status = deps.document.createElement("div");
      status.className = "graduation-status";
      let row: HTMLElement;

      if (spec.onBoard) {
        const hero = deps.document.createElement("div");
        hero.className = "graduation-board-hero";

        const badge = deps.document.createElement("div");
        badge.className = "graduation-board-letter";
        badge.textContent = spec.finalGradeLetter || "";

        const copy = deps.document.createElement("div");
        copy.className = "graduation-board-copy";
        const title = deps.document.createElement("div");
        title.className = "graduation-board-title";
        title.textContent = (spec.completedGradeLabel || "Ruby High") + " complete";
        const subtitle = deps.document.createElement("div");
        subtitle.className = "graduation-board-subtitle";
        subtitle.textContent = (spec.scoreText || "Final grade ready")
          + (spec.hasNextGrade ? " \u00b7 next: " + (spec.targetLabel || "next year") : " \u00b7 diploma ceremony");
        copy.appendChild(title);
        copy.appendChild(subtitle);

        hero.appendChild(badge);
        hero.appendChild(copy);
        wrap.appendChild(hero);

        const prompt = deps.document.createElement("div");
        prompt.className = "graduation-board-prompt";
        prompt.textContent = spec.photoLaterNote || "Choose one yearbook reward.";
        wrap.appendChild(prompt);

        row = deps.document.createElement("div");
        row.className = "graduation-choice-row";
        wrap.appendChild(row);
        wrap.appendChild(status);
      } else {
        const title = deps.document.createElement("div");
        title.className = "graduation-title";
        title.textContent = spec.hasNextGrade
          ? "Advance to " + (spec.targetLabel || "next year")
          : "Graduation Ceremony";
        wrap.appendChild(title);

        const note = deps.document.createElement("div");
        note.className = "graduation-note";
        note.textContent = spec.photoLaterNote || "Pick one keepsake or reward to seal the yearbook.";
        wrap.appendChild(note);

        wrap.appendChild(status);
        row = deps.document.createElement("div");
        row.className = "graduation-choice-row";
        wrap.appendChild(row);
      }

      const buttons: HTMLButtonElement[] = [];
      (spec.choices || []).forEach((choice) => {
        const btn = deps.document.createElement("button") as HTMLButtonElement;
        btn.type = "button";
        btn.className = "graduation-choice";
        const main = deps.document.createElement("span");
        main.className = "main";
        main.textContent = choice.label || "";
        const sub = deps.document.createElement("span");
        sub.className = "sub";
        sub.textContent = choice.detail || "";
        btn.appendChild(main);
        btn.appendChild(sub);
        btn.addEventListener("click", () => {
          if (spec.onChoice) spec.onChoice(choice.reward, btn, { status, buttons });
        });
        row.appendChild(btn);
        buttons.push(btn);
      });

      return wrap;
    },
  };
}
