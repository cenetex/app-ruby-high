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

      const hint = deps.document.createElement("div");
      hint.className = "ccg-next-step";
      hint.textContent = "Ruby will save this student and start today's class.";
      body.appendChild(hint);
      const portraitStatus = deps.document.createElement("div");
      portraitStatus.className = "creation-portrait-status";
      body.appendChild(portraitStatus);

      const actions = deps.document.createElement("div");
      actions.className = "ccg-card-actions";
      const portraitBtn = deps.document.createElement("button");
      portraitBtn.type = "button";
      portraitBtn.className = "secondary";
      portraitBtn.textContent = "\u2728 Generate AI portrait";
      const saveBtn = deps.document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "primary";
      saveBtn.textContent = "Save Character";
      saveBtn.disabled = true;
      saveBtn.hidden = true;
      actions.appendChild(portraitBtn);
      actions.appendChild(saveBtn);
      body.appendChild(actions);

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
        saveBtn: saveBtn as HTMLButtonElement,
      };
    },
  };
}
