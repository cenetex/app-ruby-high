export interface CreationControlCardRefs {
  card: HTMLElement;
  fields: HTMLElement;
  rollBtn: HTMLButtonElement;
  status: HTMLElement;
}

export interface CreationControlCardSpec {
  subtitle?: string;
}

export interface CreationControlCardRendererDeps {
  document: Pick<Document, "createElement">;
}

export interface CreationControlCardRenderer {
  build(spec: CreationControlCardSpec): CreationControlCardRefs;
}

export function createCreationControlCardRenderer(
  deps: CreationControlCardRendererDeps,
): CreationControlCardRenderer {
  return {
    build(spec): CreationControlCardRefs {
      const card = deps.document.createElement("div");
      card.className = "ccg-card is-career-card is-creation-control-card";

      const role = deps.document.createElement("span");
      role.className = "ccg-role career";
      role.textContent = "roll";
      card.appendChild(role);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";
      card.appendChild(body);

      const name = deps.document.createElement("div");
      name.className = "ccg-name";
      name.textContent = "Character Roll";
      body.appendChild(name);

      const sub = deps.document.createElement("div");
      sub.className = "ccg-subtitle";
      sub.textContent = spec.subtitle || "";
      body.appendChild(sub);

      const fields = deps.document.createElement("div");
      fields.className = "creation-fields";
      body.appendChild(fields);

      const actions = deps.document.createElement("div");
      actions.className = "ccg-card-actions creation-roll-actions";
      const rollBtn = deps.document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "primary creation-full-roll";
      rollBtn.textContent = "Roll a student";
      actions.appendChild(rollBtn);
      body.appendChild(actions);

      const status = deps.document.createElement("div");
      status.className = "stat-budget";
      body.appendChild(status);

      return { card, fields, rollBtn: rollBtn as HTMLButtonElement, status };
    },
  };
}
