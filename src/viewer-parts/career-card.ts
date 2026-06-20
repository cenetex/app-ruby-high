export interface CareerMetric {
  label?: string;
  value?: string;
  detail?: string;
  met?: boolean;
}

export interface ProfileCareerCardSpec {
  badgeLabel?: string;
  name?: string;
  subtitle?: string;
  metrics?: CareerMetric[];
  progression?: unknown;
}

export interface CareerCardRendererDeps {
  document: Pick<Document, "createElement">;
  appendProgression(parent: HTMLElement, progression: unknown): void;
}

export interface CareerCardRenderer {
  buildProfileCard(spec: ProfileCareerCardSpec): HTMLElement;
  buildMetrics(rows: CareerMetric[]): HTMLElement;
}

export function createCareerCardRenderer(deps: CareerCardRendererDeps): CareerCardRenderer {
  function text(value: unknown): string {
    return value == null ? "" : String(value);
  }

  const renderer: CareerCardRenderer = {
    buildProfileCard(spec): HTMLElement {
      const card = deps.document.createElement("div");
      card.className = "ccg-card is-career-card";

      const role = deps.document.createElement("span");
      role.className = "ccg-role career";
      role.textContent = spec.badgeLabel || "career";
      card.appendChild(role);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";

      const nameEl = deps.document.createElement("div");
      nameEl.className = "ccg-name";
      nameEl.textContent = spec.name || "School Career";
      body.appendChild(nameEl);

      const sub = deps.document.createElement("div");
      sub.className = "ccg-subtitle";
      sub.textContent = spec.subtitle || "";
      body.appendChild(sub);

      body.appendChild(renderer.buildMetrics(spec.metrics || []));
      deps.appendProgression(body, spec.progression);
      card.appendChild(body);
      return card;
    },
    buildMetrics(rows): HTMLElement {
      const metrics = deps.document.createElement("div");
      metrics.className = "career-metrics";
      rows.forEach((m) => {
        const row = deps.document.createElement("div");
        row.className = "career-metric" + (m.met ? " is-met" : "");
        const k = deps.document.createElement("span");
        k.className = "k";
        k.textContent = text(m.label);
        const v = deps.document.createElement("span");
        v.className = "v";
        v.textContent = text(m.value);
        const d = deps.document.createElement("span");
        d.className = "detail";
        d.textContent = text(m.detail);
        row.appendChild(k);
        row.appendChild(v);
        row.appendChild(d);
        metrics.appendChild(row);
      });
      return metrics;
    },
  };
  return renderer;
}
