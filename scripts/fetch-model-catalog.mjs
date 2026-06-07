// @ts-check
/** Fetch the full OpenRouter model catalog, filter to text-capable
 *  models, and write a lean JSON catalog for the app to consume.
 *
 *  Usage:  node scripts/fetch-model-catalog.mjs
 *  Env:    OPENROUTER_API_KEY (required)
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "src", "model-catalog.json");

const API_KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

const OR_MODELS = "https://openrouter.ai/api/v1/models";

async function main() {
  console.error("Fetching OpenRouter model catalog...");
  const r = await fetch(OR_MODELS, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("OpenRouter returned", r.status, body.slice(0, 400));
    process.exit(1);
  }

  /** @type {{ data: any[] }} */
  const raw = await r.json();
  const all = raw.data ?? [];
  console.error("Fetched", all.length, "models");

  // filter: text-capable models only
  const textModels = all.filter((m) => {
    const arch = m.architecture ?? {};
    const inputs = arch.input_modalities ?? [];
    const outputs = arch.output_modalities ?? [];
    return inputs.includes("text") && outputs.includes("text");
  });

  console.error("Text-capable models:", textModels.length);

  // transform to a compact shape
  const catalog = textModels.map((m) => {
    const p = m.pricing ?? {};
    const tp = m.top_provider ?? {};
    const arch = m.architecture ?? {};
    return {
      id: m.id,
      name: m.name,
      description: (m.description ?? "").slice(0, 280),
      provider: m.id.split("/")[0],
      contextLength: m.context_length ?? 0,
      promptPrice: String(p.prompt ?? "0"),
      completionPrice: String(p.completion ?? "0"),
      free: String(p.prompt ?? "0") === "0" && String(p.completion ?? "0") === "0",
      moderated: Boolean(tp.is_moderated),
      modalities: arch.modality ?? "text->text",
      maxCompletionTokens: tp.max_completion_tokens ?? null,
      supportedParameters: m.supported_parameters ?? [],
      knowledgeCutoff: m.knowledge_cutoff ?? null,
    };
  });

  // sort: free first, then provider, then cheapest prompt price
  catalog.sort((a, b) => {
    const freeA = a.free ? 0 : 1;
    const freeB = b.free ? 0 : 1;
    if (freeA !== freeB) return freeA - freeB;
    const prov = a.provider.localeCompare(b.provider);
    if (prov !== 0) return prov;
    return parseFloat(a.promptPrice) - parseFloat(b.promptPrice);
  });

  const meta = {
    fetched: new Date().toISOString(),
    totalModels: all.length,
    textModels: catalog.length,
  };

  const out = { meta, models: catalog };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.error("Wrote", catalog.length, "models to", OUT);
  console.log(OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
