export interface CcgCardStatBlock {
  head?: unknown;
  heart?: unknown;
  hustle?: unknown;
  honor?: unknown;
}

export interface CcgCardAction {
  label: string;
  secondary?: boolean;
  onClick(event: Event): void;
}

export interface CcgCardSpec {
  role?: string;
  name?: string;
  subtitle?: string;
  portraitUrl?: string;
  accent?: string;
  stats?: CcgCardStatBlock;
  quote?: string;
  nextStepHint?: string;
  progression?: unknown;
  footer?: { title?: string; content?: string };
  actions?: CcgCardAction[];
}

export interface CcgCardRendererDeps {
  document: Pick<Document, "createElement">;
  renderMarkdownInto(el: HTMLElement, markdown: string, opts?: { inline?: boolean }): void;
  appendProgression(parent: HTMLElement, progression: unknown): void;
}

export interface CcgCardRenderer {
  buildCharacterCard(spec: CcgCardSpec): HTMLElement;
}

export function createCcgCardRenderer(deps: CcgCardRendererDeps): CcgCardRenderer {
  function initialFor(name: unknown): string {
    return String(name || "?").slice(0, 1).toUpperCase();
  }

  function statValue(stats: CcgCardStatBlock, key: keyof CcgCardStatBlock): number {
    const n = Number(stats[key] || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function formatStat(n: number): string {
    return (n >= 0 ? "+" : "") + n;
  }

  function applyFallbackArt(art: HTMLElement, name: unknown, large: boolean): void {
    art.innerHTML = "";
    art.style.display = "grid";
    art.style.placeItems = "center";
    if (large) {
      art.style.fontSize = "72px";
      art.style.color = "var(--text-mute)";
    }
    art.textContent = initialFor(name);
  }

  function appendArt(card: HTMLElement, spec: CcgCardSpec): void {
    const art = deps.document.createElement("div");
    art.className = "ccg-art";
    if (spec.portraitUrl) {
      const img = deps.document.createElement("img");
      img.src = spec.portraitUrl;
      img.alt = "";
      img.onerror = () => {
        applyFallbackArt(art, spec.name, false);
      };
      art.appendChild(img);
    } else {
      applyFallbackArt(art, spec.name, true);
    }
    card.appendChild(art);
  }

  function appendStats(body: HTMLElement, statsInput: CcgCardStatBlock): void {
    const stats = deps.document.createElement("div");
    stats.className = "ccg-stats";
    (["head", "heart", "hustle", "honor"] as const).forEach((key) => {
      const wrap = deps.document.createElement("span");
      wrap.className = "stat";
      const label = deps.document.createElement("span");
      label.className = "k";
      label.textContent = key;
      const value = deps.document.createElement("span");
      const n = statValue(statsInput, key);
      value.className = "v" + (n > 0 ? " pos" : n < 0 ? " neg" : "");
      value.textContent = formatStat(n);
      wrap.appendChild(label);
      wrap.appendChild(value);
      stats.appendChild(wrap);
    });
    body.appendChild(stats);
  }

  function appendFooter(body: HTMLElement, footer: NonNullable<CcgCardSpec["footer"]>): void {
    const ft = deps.document.createElement("div");
    ft.className = "ccg-footer";
    const title = deps.document.createElement("strong");
    title.textContent = footer.title || "";
    ft.appendChild(title);
    const content = deps.document.createElement("span");
    content.className = "ccg-footer-content";
    deps.renderMarkdownInto(content, footer.content || "", { inline: true });
    ft.appendChild(content);
    body.appendChild(ft);
  }

  function appendActions(body: HTMLElement, actionsInput: CcgCardAction[]): void {
    const actionsRow = deps.document.createElement("div");
    actionsRow.className = "ccg-card-actions";
    actionsInput.forEach((action) => {
      const btn = deps.document.createElement("button");
      btn.type = "button";
      if (action.secondary) btn.className = "secondary";
      btn.textContent = action.label;
      btn.addEventListener("click", action.onClick);
      actionsRow.appendChild(btn);
    });
    body.appendChild(actionsRow);
  }

  return {
    buildCharacterCard(spec): HTMLElement {
      const card = deps.document.createElement("div");
      card.className = "ccg-card";
      if (spec.accent) card.style.borderColor = spec.accent;
      const role = deps.document.createElement("span");
      role.className = "ccg-role " + spec.role;
      if (spec.accent) role.style.background = spec.accent;
      role.textContent = spec.role || "";
      card.appendChild(role);
      appendArt(card, spec);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";
      const nameEl = deps.document.createElement("div");
      nameEl.className = "ccg-name";
      nameEl.textContent = spec.name || "\u2014";
      body.appendChild(nameEl);
      if (spec.subtitle) {
        const sub = deps.document.createElement("div");
        sub.className = "ccg-subtitle";
        sub.textContent = spec.subtitle;
        body.appendChild(sub);
      }
      if (spec.stats) appendStats(body, spec.stats);
      if (spec.quote) {
        const q = deps.document.createElement("blockquote");
        q.className = "ccg-quote";
        deps.renderMarkdownInto(q, "\u201c" + spec.quote + "\u201d", { inline: true });
        body.appendChild(q);
      }
      if (spec.nextStepHint) {
        const ns = deps.document.createElement("div");
        ns.className = "ccg-next-step";
        ns.textContent = spec.nextStepHint;
        body.appendChild(ns);
      }
      deps.appendProgression(body, spec.progression);
      if (spec.footer) appendFooter(body, spec.footer);
      if (spec.actions && spec.actions.length) appendActions(body, spec.actions);
      card.appendChild(body);
      return card;
    },
  };
}
