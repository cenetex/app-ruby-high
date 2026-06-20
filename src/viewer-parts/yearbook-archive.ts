export interface YearbookArchiveRendererDeps {
  document: Pick<Document, "createElement" | "createTextNode">;
  gradeLabels: Record<string, string>;
  gradeShortLabels: Record<string, string>;
  gradeOrder: string[];
  formatSealedDate(value: unknown): string;
  fmtStat(value: number): string;
  renderMarkdownInto(el: HTMLElement, markdown: string, opts?: { inline?: boolean }): void;
  buildPhotoAction?(photo: unknown, entry?: unknown): HTMLElement | null;
}

export interface YearbookArchiveRenderer {
  buildArchive(entries: unknown, liveChar: unknown, livePb: unknown, playbooks: unknown): HTMLElement | null;
  buildEntry(entry: unknown, liveChar: unknown, livePb: unknown, playbooks: unknown): HTMLElement;
  buildDiploma(diploma: unknown): HTMLElement;
  buildGraduationPhoto(photo: unknown, entry?: unknown): HTMLElement;
}

export function createYearbookArchiveRenderer(deps: YearbookArchiveRendererDeps): YearbookArchiveRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function stringValue(value: unknown, fallback = ""): string {
    return value == null || value === "" ? fallback : String(value);
  }

  function numberValue(value: unknown): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function playbookFor(entry: unknown, liveChar: unknown, livePb: unknown, playbooks: unknown): unknown {
    const playbookId = recordValue(entry, "playbookId") || recordValue(liveChar, "playbookId");
    if (Array.isArray(playbooks)) {
      const found = playbooks.find((playbook) => recordValue(playbook, "id") === playbookId);
      if (found) return found;
    }
    return livePb;
  }

  function appendStat(parent: HTMLElement, key: string, value: unknown): void {
    const stat = deps.document.createElement("span");
    const label = deps.document.createElement("b");
    label.textContent = key;
    stat.appendChild(label);
    stat.appendChild(deps.document.createTextNode(" " + deps.fmtStat(numberValue(value))));
    parent.appendChild(stat);
  }

  function buildPortrait(entry: unknown): HTMLElement | null {
    const entryImgUrl = recordValue(entry, "diplomaImageDataUrl") || recordValue(entry, "portraitDataUrl");
    if (!entryImgUrl) return null;
    const photoWrap = deps.document.createElement("div");
    photoWrap.className = "paper-archive-portrait";
    const img = deps.document.createElement("img");
    img.alt = stringValue(recordValue(entry, "name"), "Student") + " photo";
    img.loading = "lazy";
    img.src = String(entryImgUrl);
    photoWrap.appendChild(img);
    return photoWrap;
  }

  function buildPersonFace(person: unknown): HTMLElement {
    const face = deps.document.createElement("span");
    face.className = "paper-archive-photo-face";
    const imageUrl = recordValue(person, "imageUrl");
    const name = stringValue(recordValue(person, "name"), "?");
    if (imageUrl) {
      const img = deps.document.createElement("img");
      img.alt = name === "?" ? "" : name;
      img.loading = "lazy";
      img.src = String(imageUrl);
      face.appendChild(img);
    } else {
      face.textContent = name.slice(0, 1).toUpperCase();
    }
    return face;
  }

  const renderer: YearbookArchiveRenderer = {
    buildArchive(entries, liveChar, livePb, playbooks): HTMLElement | null {
      if (!Array.isArray(entries) || entries.length === 0) return null;
      const archive = deps.document.createElement("details");
      archive.className = "paper-archive";

      const summary = deps.document.createElement("summary");
      summary.className = "paper-archive-summary";
      const stack = deps.document.createElement("span");
      stack.className = "paper-archive-stack";
      for (let i = 0; i < Math.min(3, entries.length); i += 1) {
        const sheet = deps.document.createElement("span");
        sheet.className = "paper-archive-sheet";
        stack.appendChild(sheet);
      }
      const label = deps.document.createElement("span");
      label.className = "paper-archive-label";
      label.textContent = entries.length === 1 ? "1 sealed year" : entries.length + " sealed years";
      const hint = deps.document.createElement("span");
      hint.className = "paper-archive-hint";
      hint.textContent = "open yearbook";
      summary.appendChild(stack);
      summary.appendChild(label);
      summary.appendChild(hint);
      archive.appendChild(summary);

      const list = deps.document.createElement("div");
      list.className = "paper-archive-list";
      entries.forEach((entry) => list.appendChild(renderer.buildEntry(entry, liveChar, livePb, playbooks)));
      archive.appendChild(list);
      return archive;
    },
    buildEntry(entry, liveChar, livePb, playbooks): HTMLElement {
      const grade = stringValue(recordValue(entry, "grade"));
      const gradeLabel = deps.gradeLabels[grade] || "Grade " + grade;
      const shortGrade = deps.gradeShortLabels[grade] || gradeLabel;
      const pb = playbookFor(entry, liveChar, livePb, playbooks);
      const stats = recordValue(entry, "stats") || recordValue(liveChar, "stats") || {};
      const quote = recordValue(entry, "flavorQuote") || recordValue(entry, "arcAnswer") || "";
      const summary = recordValue(entry, "summary") || { correct: 0, total: 0 };
      const gradeIdx = deps.gradeOrder.indexOf(grade);
      const diamondCount = Math.max(1, gradeIdx + 1);
      const item = deps.document.createElement("div");
      item.className = "paper-archive-entry";
      const accent = recordValue(pb, "accent");
      if (accent) item.style.setProperty("--paper-accent", String(accent));

      const top = deps.document.createElement("div");
      top.className = "paper-archive-entry-top";
      const gradeEl = deps.document.createElement("span");
      gradeEl.className = "paper-archive-grade";
      const diamonds = deps.document.createElement("span");
      diamonds.className = "paper-archive-diamonds";
      for (let i = 0; i < diamondCount; i += 1) {
        const diamond = deps.document.createElement("span");
        diamond.textContent = "\u25c6";
        diamonds.appendChild(diamond);
      }
      const gradeText = deps.document.createElement("span");
      gradeText.textContent = shortGrade;
      gradeEl.appendChild(diamonds);
      gradeEl.appendChild(gradeText);
      const meta = deps.document.createElement("span");
      meta.className = "paper-archive-meta";
      meta.textContent = "sealed " + deps.formatSealedDate(recordValue(entry, "completedAt")) + " · "
        + stringValue(recordValue(summary, "correct"), "0") + "/" + stringValue(recordValue(summary, "total"), "0");
      top.appendChild(gradeEl);
      top.appendChild(meta);
      item.appendChild(top);

      const statsLine = deps.document.createElement("div");
      statsLine.className = "paper-archive-stats";
      ["head", "heart", "hustle", "honor"].forEach((key) => appendStat(statsLine, key, recordValue(stats, key)));
      item.appendChild(statsLine);

      if (quote) {
        const quoteEl = deps.document.createElement("div");
        quoteEl.className = "paper-archive-quote";
        deps.renderMarkdownInto(quoteEl, "\u201c" + String(quote) + "\u201d", { inline: true });
        item.appendChild(quoteEl);
      }
      const diploma = recordValue(entry, "diploma");
      if (diploma) item.appendChild(renderer.buildDiploma(diploma));
      const photo = recordValue(entry, "photo");
      if (photo) item.appendChild(renderer.buildGraduationPhoto(photo, entry));
      const portrait = buildPortrait(entry);
      if (portrait) item.appendChild(portrait);
      return item;
    },
    buildDiploma(diploma): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "paper-archive-diploma";
      const imageUrl = recordValue(diploma, "imageUrl");
      const titleText = stringValue(recordValue(diploma, "title"), "Ruby High Diploma");
      if (imageUrl) {
        const img = deps.document.createElement("img");
        img.alt = titleText;
        img.loading = "lazy";
        img.src = String(imageUrl);
        wrap.appendChild(img);
      }
      const copy = deps.document.createElement("div");
      copy.className = "paper-archive-diploma-copy";
      const title = deps.document.createElement("div");
      title.className = "paper-archive-diploma-title";
      title.textContent = titleText;
      const meta = deps.document.createElement("div");
      meta.className = "paper-archive-diploma-meta";
      meta.textContent = "collectible · " + deps.formatSealedDate(recordValue(diploma, "issuedAt"));
      copy.appendChild(title);
      copy.appendChild(meta);
      wrap.appendChild(copy);
      return wrap;
    },
    buildGraduationPhoto(photo, entry): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "paper-archive-photo";
      const imageUrl = recordValue(photo, "imageUrl");
      const titleText = stringValue(recordValue(photo, "title"), "Graduation Photo");
      if (imageUrl) {
        const img = deps.document.createElement("img");
        img.className = "paper-archive-photo-image";
        img.alt = titleText;
        img.loading = "lazy";
        img.src = String(imageUrl);
        wrap.appendChild(img);
      } else {
        const faces = deps.document.createElement("div");
        faces.className = "paper-archive-photo-faces";
        [recordValue(photo, "teacher"), recordValue(photo, "student")].forEach((person) => {
          faces.appendChild(buildPersonFace(person));
        });
        wrap.appendChild(faces);
      }
      const copy = deps.document.createElement("div");
      copy.className = "paper-archive-photo-copy";
      const title = deps.document.createElement("div");
      title.className = "paper-archive-photo-title";
      title.textContent = titleText;
      const meta = deps.document.createElement("div");
      meta.className = "paper-archive-photo-meta";
      const teacherName = stringValue(recordValue(recordValue(photo, "teacher"), "name"), "top teacher");
      const studentName = stringValue(recordValue(recordValue(photo, "student"), "name"), "top classmate");
      meta.textContent = teacherName + " · " + studentName;
      copy.appendChild(title);
      copy.appendChild(meta);
      if (!imageUrl && deps.buildPhotoAction) {
        const action = deps.buildPhotoAction(photo, entry);
        if (action) copy.appendChild(action);
      }
      wrap.appendChild(copy);
      return wrap;
    },
  };
  return renderer;
}
