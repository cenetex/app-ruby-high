/** Typed access to the OpenRouter model catalog.
 *  The catalog is fetched by scripts/fetch-model-catalog.mjs and
 *  stored as src/model-catalog.json.
 *
 *  Import this module once at startup; it's a JSON import that Node
 *  caches in the module graph.
 */

import catalogData from "./model-catalog.json" with { type: "json" };

// ── types ────────────────────────────────────────────────────────────

export interface ModelEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly provider: string;
  readonly contextLength: number;
  readonly promptPrice: string;
  readonly completionPrice: string;
  readonly free: boolean;
  readonly moderated: boolean;
  readonly modalities: string;
  readonly maxCompletionTokens: number | null;
  readonly supportedParameters: readonly string[];
  readonly knowledgeCutoff: string | null;
}

export interface CatalogMeta {
  readonly fetched: string;
  readonly totalModels: number;
  readonly textModels: number;
}

export interface ModelCatalog {
  readonly meta: CatalogMeta;
  readonly models: readonly ModelEntry[];
}

// ── catalog ──────────────────────────────────────────────────────────

const catalog: ModelCatalog = catalogData as ModelCatalog;

/** Full model list sorted free-first, then provider, then price. */
export function allModels(): readonly ModelEntry[] {
  return catalog.models;
}

/** Look up a model by its exact OpenRouter id. */
export function findModel(id: string): ModelEntry | undefined {
  return catalog.models.find((m) => m.id === id);
}

/** Whether the given model id exists in the catalog. */
export function isKnownModel(id: string): boolean {
  return catalog.models.some((m) => m.id === id);
}

/** All free models. */
export function freeModels(): readonly ModelEntry[] {
  return catalog.models.filter((m) => m.free);
}

/** Models from a specific provider (case-sensitive). */
export function providerModels(provider: string): readonly ModelEntry[] {
  return catalog.models.filter((m) => m.provider === provider);
}

/** Unique provider names found in the catalog. */
export function providers(): readonly string[] {
  const seen = new Set(catalog.models.map((m) => m.provider));
  return [...seen].sort();
}

/** Catalog freshness metadata. */
export function catalogMeta(): CatalogMeta {
  return catalog.meta;
}
