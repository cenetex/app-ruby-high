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
        '<p><strong>Meet your student.</strong> Change their name or student style, or try another version.</p>'
        + '<p>Your student is not saved until you take your seat. Your first class starts right away.</p>';
      parent.appendChild(explanation);

      loading.innerHTML =
        '<div class="creation-loading-spinner" aria-hidden="true"></div>'
        + '<div class="creation-loading-title">Getting your student ready\u2026</div>'
        + '<div class="creation-loading-sub">This should only take a moment.</div>';
      parent.appendChild(loading);
      return { explanation, loading };
    },
  };
}
