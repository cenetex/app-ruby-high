export interface CreationCandidateCardRefs {
  card: HTMLElement;
  role: HTMLElement;
  portraitImg: HTMLImageElement;
  name: HTMLElement;
  subtitle: HTMLElement;
  stats: HTMLElement;
  quote: HTMLElement;
  moveTitle: HTMLElement;
  moveContent: HTMLElement;
  portraitStatus: HTMLElement;
  portraitBtn: HTMLButtonElement;
  customizeBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
}

export interface CreationCandidateCardRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface CreationCandidateCardRenderer {
  build(): CreationCandidateCardRefs;
}

export function createCreationCandidateCardRenderer(
  deps: CreationCandidateCardRendererDeps,
): CreationCandidateCardRenderer {
  return {
    build(): CreationCandidateCardRefs {
      const card = deps.document.createElement("div");
      card.className = "ccg-card is-character-card is-creation-candidate-card";
      const role = deps.document.createElement("span");
      role.className = "ccg-role player";
      role.textContent = "player";
      card.appendChild(role);

      const art = deps.document.createElement("div");
      art.className = "ccg-art";
      const portraitImg = deps.document.createElement("img");
      portraitImg.alt = "";
      art.appendChild(portraitImg);
      card.appendChild(art);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";
      card.appendChild(body);

      const name = deps.document.createElement("div");
      name.className = "ccg-name";
      body.appendChild(name);
      const subtitle = deps.document.createElement("div");
      subtitle.className = "ccg-subtitle";
      body.appendChild(subtitle);

      const hint = deps.document.createElement("div");
      hint.className = "ccg-next-step";
      hint.textContent = "Free · no signup · your first class starts immediately.";
      body.appendChild(hint);

      // Put the decision immediately after the identity. On a small phone,
      // the player can customize or start class before reading the optional
      // stats, quote, and move details below.
      const actions = deps.document.createElement("div");
      actions.className = "ccg-card-actions";
      const portraitBtn = deps.document.createElement("button");
      portraitBtn.type = "button";
      portraitBtn.className = "secondary";
      portraitBtn.textContent = "\u2728 Generate AI portrait";
      const customizeBtn = deps.document.createElement("button");
      customizeBtn.type = "button";
      customizeBtn.className = "secondary creation-customize-btn";
      customizeBtn.textContent = "Customize";
      const saveBtn = deps.document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "primary";
      saveBtn.textContent = "Take my seat \u00b7 start class";
      saveBtn.disabled = true;
      saveBtn.hidden = true;
      actions.appendChild(portraitBtn);
      actions.appendChild(customizeBtn);
      actions.appendChild(saveBtn);
      body.appendChild(actions);

      const stats = deps.document.createElement("div");
      stats.className = "ccg-stats";
      body.appendChild(stats);
      const quote = deps.document.createElement("blockquote");
      quote.className = "ccg-quote";
      body.appendChild(quote);

      const move = deps.document.createElement("div");
      move.className = "ccg-footer";
      const moveTitle = deps.document.createElement("strong");
      const moveContent = deps.document.createElement("span");
      moveContent.className = "ccg-footer-content";
      move.appendChild(moveTitle);
      move.appendChild(moveContent);
      body.appendChild(move);

      const portraitStatus = deps.document.createElement("div");
      portraitStatus.className = "creation-portrait-status";
      body.appendChild(portraitStatus);

      return {
        card,
        role,
        portraitImg: portraitImg as HTMLImageElement,
        name,
        subtitle,
        stats,
        quote,
        moveTitle,
        moveContent,
        portraitStatus,
        portraitBtn: portraitBtn as HTMLButtonElement,
        customizeBtn: customizeBtn as HTMLButtonElement,
        saveBtn: saveBtn as HTMLButtonElement,
      };
    },
  };
}
