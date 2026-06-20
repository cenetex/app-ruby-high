import type { GuestSpotlightView } from "./client-pure.js";

export interface GuestSpotlightRendererDeps {
  document: Pick<Document, "createElement">;
  viewFor(guest: unknown): GuestSpotlightView;
  isUnlocked(telemetry: unknown): boolean;
  markSeen(packId: string): void;
  startPack(pack: unknown): void;
}

export interface GuestSpotlightRenderer {
  build(telemetry: unknown): HTMLElement | null;
}

export function createGuestSpotlightRenderer(deps: GuestSpotlightRendererDeps): GuestSpotlightRenderer {
  const seenKeys = new Set<string>();

  function guestPack(guest: unknown): unknown {
    if (!guest || typeof guest !== "object") return null;
    const pack = (guest as { auto?: unknown }).auto;
    return pack && typeof pack === "object" ? pack : null;
  }

  function weekKeyFor(guest: unknown): string {
    if (!guest || typeof guest !== "object") return "";
    return String((guest as { weekKey?: unknown }).weekKey || "");
  }

  return {
    build(telemetry: unknown): HTMLElement | null {
      if (!deps.isUnlocked(telemetry)) return null;
      const record = telemetry && typeof telemetry === "object" ? telemetry as { guest_pack?: unknown } : {};
      const guest = record.guest_pack || {};
      const pack = guestPack(guest);
      const view = deps.viewFor(guest);
      if (!view.visible) return null;
      const key = weekKeyFor(guest) + ":" + view.packId;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deps.markSeen(view.packId);
      }
      const wrap = deps.document.createElement("div");
      wrap.className = "guest-spotlight";
      const copy = deps.document.createElement("div");
      copy.className = "guest-spotlight-copy";
      const title = deps.document.createElement("div");
      title.className = "guest-spotlight-title";
      title.textContent = view.titleText;
      const meta = deps.document.createElement("div");
      meta.className = "guest-spotlight-meta";
      meta.textContent = view.metaText;
      copy.appendChild(title);
      copy.appendChild(meta);
      const action = deps.document.createElement("button");
      action.type = "button";
      action.className = "guest-spotlight-action";
      action.textContent = view.actionText;
      action.disabled = view.actionDisabled;
      action.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deps.startPack(pack);
      });
      wrap.appendChild(copy);
      wrap.appendChild(action);
      return wrap;
    },
  };
}
