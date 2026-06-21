export interface ChatMessageSpec {
  kind?: string;
  name?: string;
  body?: string;
  color?: string;
  avatarUrl?: string | null;
}

export interface ChatEmptyStateSpec {
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaAction?: ((event: Event) => void) | null;
  heroSrc?: string | null;
}

export interface ChatMessageRendererDeps {
  document: Pick<Document, "createElement">;
  sanitizeVisibleChatText(input: string): string;
  renderMarkdownInto(el: HTMLElement, markdown: string): void;
}

export interface ChatRenderedMessage {
  wrap: HTMLElement;
  body: HTMLElement;
}

export interface ChatMessageRenderer {
  buildMessage(spec: ChatMessageSpec): ChatRenderedMessage;
  buildSystem(text: string): HTMLElement;
  buildTool(text: string): HTMLElement;
  buildEmptyState(spec: ChatEmptyStateSpec): HTMLElement;
}

export function createChatMessageRenderer(deps: ChatMessageRendererDeps): ChatMessageRenderer {
  function text(value: unknown, fallback = ""): string {
    const str = value == null ? "" : String(value);
    return str || fallback;
  }

  function initialFor(name: unknown): string {
    return text(name, "?").slice(0, 1).toUpperCase() || "?";
  }

  function roleTag(kind: string): HTMLElement | null {
    if (kind !== "teacher" && kind !== "you" && kind !== "student" && kind !== "player") return null;
    const tag = deps.document.createElement("span");
    tag.className = "role-tag " + (kind === "teacher" ? "bot" : kind);
    tag.textContent = kind === "teacher" ? "Teacher" : kind === "you" ? "you" : "Student";
    return tag;
  }

  function applyAvatarImageAspectClass(avatar: HTMLElement, img: HTMLImageElement): void {
    const update = () => {
      const width = Number(img.naturalWidth || 0);
      const height = Number(img.naturalHeight || 0);
      avatar.classList.remove("is-tall-avatar", "is-square-avatar");
      if (!width || !height) return;
      const ratio = width / height;
      if (ratio < 0.82) avatar.classList.add("is-tall-avatar");
      else if (ratio >= 0.9 && ratio <= 1.1) avatar.classList.add("is-square-avatar");
    };
    img.onload = () => update();
    if (img.complete) update();
  }

  function appendAvatarImage(avatar: HTMLElement, spec: ChatMessageSpec, src: string): void {
    avatar.style.background = "#fff";
    const img = deps.document.createElement("img") as HTMLImageElement;
    img.src = src;
    img.alt = spec.name || "";
    img.onerror = () => {
      avatar.classList.remove("is-tall-avatar", "is-square-avatar");
      if (img.parentNode === avatar) avatar.removeChild(img);
      avatar.style.background = spec.color || "var(--bg-elev)";
      avatar.textContent = initialFor(spec.name);
    };
    applyAvatarImageAspectClass(avatar, img);
    avatar.appendChild(img);
  }

  function buildAvatar(spec: ChatMessageSpec, kind: string): HTMLElement {
    const avatar = deps.document.createElement("div");
    avatar.className = "avatar" + (kind === "teacher" ? " is-teacher" : "");
    const src = spec.avatarUrl ? String(spec.avatarUrl) : "";
    if (src) {
      appendAvatarImage(avatar, spec, src);
    } else {
      avatar.style.background = spec.color || "var(--bg-elev)";
      avatar.textContent = initialFor(spec.name);
    }
    return avatar;
  }

  function buildHead(spec: ChatMessageSpec, kind: string): HTMLElement {
    const head = deps.document.createElement("div");
    head.className = "head";
    const nameEl = deps.document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = spec.name || "—";
    head.appendChild(nameEl);
    const tag = roleTag(kind);
    if (tag) head.appendChild(tag);
    const stamp = deps.document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    head.appendChild(stamp);
    return head;
  }

  function buildSimple(kind: "system" | "tool", value: unknown): HTMLElement {
    const wrap = deps.document.createElement("div");
    wrap.className = "msg " + kind;
    const body = deps.document.createElement("div");
    body.className = "body";
    body.textContent = text(value);
    wrap.appendChild(body);
    return wrap;
  }

  return {
    buildMessage(spec): ChatRenderedMessage {
      const kind = spec.kind || "bot";
      const wrap = deps.document.createElement("div");
      wrap.className = "msg " + kind;
      const body = deps.document.createElement("div");
      body.className = "body";
      body.dataset.markdownRaw = deps.sanitizeVisibleChatText(spec.body || "");
      deps.renderMarkdownInto(body, body.dataset.markdownRaw);
      wrap.appendChild(buildAvatar(spec, kind));
      wrap.appendChild(buildHead(spec, kind));
      wrap.appendChild(body);
      return { wrap, body };
    },
    buildSystem(text): HTMLElement {
      return buildSimple("system", text);
    },
    buildTool(text): HTMLElement {
      return buildSimple("tool", text);
    },
    buildEmptyState(spec): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "empty-state";
      const hero = deps.document.createElement("img");
      hero.className = "logo";
      hero.src = spec.heroSrc || "";
      hero.alt = "";
      wrap.appendChild(hero);
      const title = deps.document.createElement("h2");
      title.textContent = spec.title || "";
      wrap.appendChild(title);
      const body = deps.document.createElement("p");
      body.textContent = spec.body || "";
      wrap.appendChild(body);
      if (spec.ctaLabel) {
        const btn = deps.document.createElement("button");
        btn.type = "button";
        btn.className = "cta";
        btn.textContent = spec.ctaLabel;
        if (spec.ctaAction) btn.addEventListener("click", spec.ctaAction);
        wrap.appendChild(btn);
      }
      return wrap;
    },
  };
}
