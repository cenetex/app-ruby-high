/**
 * Content pack registry. The active pack is the single source of truth
 * for which faculty + rooms + question banks the system serves.
 *
 * Today: hardcoded to "ruby-high-original" — there's only one pack. The
 * surface is shaped as if there were many so future work (pack store,
 * Anki imports, paid packs) doesn't have to thread a new abstraction
 * back through every consumer.
 */

import type { ContentPack } from "./types.js";
import { getRubyHighOriginal } from "./packs/ruby-high-original.js";

let active: Promise<ContentPack> | null = null;

/** Returns the currently active pack. Cached after first call. */
export function getActivePack(): Promise<ContentPack> {
  if (!active) active = getRubyHighOriginal();
  return active;
}

/** Override the active pack. For tests + future runtime pack switching. */
export function setActivePack(pack: ContentPack): void {
  active = Promise.resolve(pack);
}

/** Reset the cache so the next getActivePack() reloads fresh. Test-only. */
export function resetActivePack(): void {
  active = null;
}
