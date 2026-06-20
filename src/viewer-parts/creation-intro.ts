export interface CreationIntroRefs {
  explanation: HTMLElement;
  loading: HTMLElement;
}

export interface CreationIntroRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface CreationIntroRenderer {
  renderInto(parent: HTMLElement): CreationIntroRefs;
}

export function createCreationIntroRenderer(deps: CreationIntroRendererDeps): CreationIntroRenderer {
  return {
    renderInto(parent): CreationIntroRefs {
      const loading = deps.document.createElement("div");
      loading.className = "creation-loading";
      const explanation = deps.document.createElement("div");
      explanation.className = "creation-explanation";
      explanation.innerHTML =
        '<p>You are about to enroll at Ruby High as a student.</p>'
        + '<p>Your character gets a <strong>playbook</strong> \u2014 a personality template with stats (HEAD, HEART, HUSTLE, HONOR) and a unique move. Think of it as your role in the school story.</p>'
        + "<p>You can reroll anything you don't like. Your character sticks with you for all four years.</p>";
      parent.appendChild(explanation);

      loading.innerHTML =
        '<div class="creation-loading-spinner" aria-hidden="true"></div>'
        + '<div class="creation-loading-title">Rolling your student\u2026</div>'
        + '<div class="creation-loading-sub">Ruby is looking up your file. One moment.</div>';
      parent.appendChild(loading);
      return { explanation, loading };
    },
  };
}
