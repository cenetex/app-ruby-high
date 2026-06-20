export interface StudentPoolEntry {
  name?: string;
  playbookId?: string;
  diplomaImageDataUrl?: string;
  portraitDataUrl?: string;
  completedAt?: unknown;
  yearbook?: unknown[];
  flavorQuote?: string;
  arcAnswer?: string;
}

export interface StudentPoolPlaybook {
  id?: string;
  name?: string;
  accent?: string;
}

export interface StudentPoolCardRendererDeps {
  document: Pick<Document, "createElement">;
  defaultPortraitFor(playbookId: string | undefined): string;
  formatSealedDate(ts: unknown): string;
  clipEssayText(text: unknown, max: number): string;
}

export interface StudentPoolCardRenderer {
  build(pool: StudentPoolEntry[], playbooks: StudentPoolPlaybook[]): HTMLElement;
}

export function createStudentPoolCardRenderer(deps: StudentPoolCardRendererDeps): StudentPoolCardRenderer {
  function playbookFor(entry: StudentPoolEntry, playbooks: StudentPoolPlaybook[]): StudentPoolPlaybook {
    return playbooks.find((p) => p.id === entry.playbookId)
      || { name: entry.playbookId || "Student", accent: "var(--accent)" };
  }

  return {
    build(pool, playbooks): HTMLElement {
      const card = deps.document.createElement("div");
      card.className = "ccg-card is-student-pool-card";
      const role = deps.document.createElement("span");
      role.className = "ccg-role pool";
      role.textContent = "pool";
      card.appendChild(role);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";

      const nameEl = deps.document.createElement("div");
      nameEl.className = "ccg-name";
      nameEl.textContent = "Student Pool";
      body.appendChild(nameEl);

      const sub = deps.document.createElement("div");
      sub.className = "ccg-subtitle";
      sub.textContent = pool.length + " completed " + (pool.length === 1 ? "student" : "students");
      body.appendChild(sub);

      const list = deps.document.createElement("div");
      list.className = "student-pool-list";
      pool.slice(0, 8).forEach((entry) => {
        const pb = playbookFor(entry, playbooks);
        const item = deps.document.createElement("div");
        item.className = "student-pool-entry";
        if (pb.accent) item.style.setProperty("--pool-accent", pb.accent);

        const portrait = deps.document.createElement("div");
        portrait.className = "student-pool-portrait";
        const imgUrl = entry.diplomaImageDataUrl || entry.portraitDataUrl || deps.defaultPortraitFor(entry.playbookId);
        if (imgUrl) {
          const img = deps.document.createElement("img");
          img.alt = "";
          img.src = imgUrl;
          portrait.appendChild(img);
        } else {
          portrait.textContent = String(entry.name || "?").slice(0, 1).toUpperCase();
        }
        item.appendChild(portrait);

        const copy = deps.document.createElement("div");
        copy.className = "student-pool-copy";
        const title = deps.document.createElement("div");
        title.className = "student-pool-name";
        title.textContent = entry.name || "Student";
        copy.appendChild(title);
        const meta = deps.document.createElement("div");
        meta.className = "student-pool-meta";
        const yearbookCount = Array.isArray(entry.yearbook) ? entry.yearbook.length : 0;
        meta.textContent = (pb.name || entry.playbookId || "Student") + " \u00b7 " + yearbookCount + "/4 years \u00b7 " + deps.formatSealedDate(entry.completedAt);
        copy.appendChild(meta);
        if (entry.flavorQuote || entry.arcAnswer) {
          const quote = deps.document.createElement("div");
          quote.className = "student-pool-quote";
          quote.textContent = "\u201c" + deps.clipEssayText(entry.flavorQuote || entry.arcAnswer, 92) + "\u201d";
          copy.appendChild(quote);
        }
        item.appendChild(copy);
        list.appendChild(item);
      });
      body.appendChild(list);

      if (pool.length > 8) {
        const more = deps.document.createElement("div");
        more.className = "student-pool-more";
        more.textContent = "+" + (pool.length - 8) + " more";
        body.appendChild(more);
      }

      card.appendChild(body);
      return card;
    },
  };
}
