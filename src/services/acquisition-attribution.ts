export const ACQUISITION_SOURCES = [
  "direct",
  "x",
  "discord",
  "telegram",
  "hn",
  "reddit",
  "friend",
  "moltbook",
  "partner",
  "internal",
  "unknown",
] as const;

export const ACQUISITION_CAMPAIGNS = [
  "none",
  "issue-174-v1",
  "outreach-v1",
  "unknown",
] as const;

export const ACQUISITION_LANDING_VARIANTS = [
  "default",
  "quick-roll-v1",
  "share",
  "unknown",
] as const;

export const ACQUISITION_ENTRYPOINTS = [
  "viewer",
  "quick-roll",
  "customize",
  "shared",
  "internal-qa",
  "unknown",
] as const;

export type AcquisitionSource = typeof ACQUISITION_SOURCES[number];
export type AcquisitionCampaign = typeof ACQUISITION_CAMPAIGNS[number];
export type AcquisitionLandingVariant = typeof ACQUISITION_LANDING_VARIANTS[number];
export type AcquisitionEntrypoint = typeof ACQUISITION_ENTRYPOINTS[number];

export interface AcquisitionAttributionInput {
  source?: unknown;
  campaignId?: unknown;
  landingVariant?: unknown;
  entrypoint?: unknown;
}

export interface AcquisitionAttribution {
  source: AcquisitionSource;
  campaignId: AcquisitionCampaign;
  landingVariant: AcquisitionLandingVariant;
  entrypoint: AcquisitionEntrypoint;
  releaseMarker: string;
}

export const ACQUISITION_METADATA_KEYS = {
  source: "acquisitionSource",
  campaignId: "acquisitionCampaign",
  landingVariant: "acquisitionLanding",
  entrypoint: "acquisitionEntrypoint",
  releaseMarker: "acquisitionRelease",
} as const;

export const EXPERIMENT_174_PROPOSITION = "Roll a student. Complete one class. Get your report.";
export const EXPERIMENT_174_ATTRIBUTION: Omit<AcquisitionAttribution, "releaseMarker"> = {
  source: "x",
  campaignId: "issue-174-v1",
  landingVariant: "quick-roll-v1",
  entrypoint: "viewer",
};
export const EXPERIMENT_174_CANONICAL_PATH =
  "/api/apps/ruby-high/viewer?rh_source=x&rh_campaign=issue-174-v1&rh_landing=quick-roll-v1&rh_entry=viewer";

const SOURCE_SET = new Set<string>(ACQUISITION_SOURCES);
const CAMPAIGN_SET = new Set<string>(ACQUISITION_CAMPAIGNS);
const LANDING_SET = new Set<string>(ACQUISITION_LANDING_VARIANTS);
const ENTRYPOINT_SET = new Set<string>(ACQUISITION_ENTRYPOINTS);
const RELEASE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

export function normalizeAcquisitionAttribution(
  input: AcquisitionAttributionInput = {},
  releaseValue: unknown = process.env.RUBY_HIGH_BUILD,
): AcquisitionAttribution {
  return {
    source: boundedValue(input.source, SOURCE_SET, "direct") as AcquisitionSource,
    campaignId: boundedValue(input.campaignId, CAMPAIGN_SET, "none") as AcquisitionCampaign,
    landingVariant: boundedValue(input.landingVariant, LANDING_SET, "default") as AcquisitionLandingVariant,
    entrypoint: boundedValue(input.entrypoint, ENTRYPOINT_SET, "viewer") as AcquisitionEntrypoint,
    releaseMarker: normalizeReleaseMarker(releaseValue),
  };
}

export function acquisitionAttributionMetadata(
  attribution: AcquisitionAttribution,
): Record<string, string> {
  return {
    [ACQUISITION_METADATA_KEYS.source]: attribution.source,
    [ACQUISITION_METADATA_KEYS.campaignId]: attribution.campaignId,
    [ACQUISITION_METADATA_KEYS.landingVariant]: attribution.landingVariant,
    [ACQUISITION_METADATA_KEYS.entrypoint]: attribution.entrypoint,
    [ACQUISITION_METADATA_KEYS.releaseMarker]: attribution.releaseMarker,
  };
}

export function acquisitionAttributionFromMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): AcquisitionAttribution | null {
  if (!metadata || typeof metadata[ACQUISITION_METADATA_KEYS.source] !== "string") return null;
  const source = String(metadata[ACQUISITION_METADATA_KEYS.source]);
  const campaignId = String(metadata[ACQUISITION_METADATA_KEYS.campaignId] ?? "");
  const landingVariant = String(metadata[ACQUISITION_METADATA_KEYS.landingVariant] ?? "");
  const entrypoint = String(metadata[ACQUISITION_METADATA_KEYS.entrypoint] ?? "");
  const releaseMarker = String(metadata[ACQUISITION_METADATA_KEYS.releaseMarker] ?? "");
  if (
    !SOURCE_SET.has(source)
    || !CAMPAIGN_SET.has(campaignId)
    || !LANDING_SET.has(landingVariant)
    || !ENTRYPOINT_SET.has(entrypoint)
    || !RELEASE_RE.test(releaseMarker)
  ) {
    return null;
  }
  return {
    source: source as AcquisitionSource,
    campaignId: campaignId as AcquisitionCampaign,
    landingVariant: landingVariant as AcquisitionLandingVariant,
    entrypoint: entrypoint as AcquisitionEntrypoint,
    releaseMarker: releaseMarker.slice(0, 12),
  };
}

export function isDefaultAcquisitionCohort(attribution: AcquisitionAttribution): boolean {
  return attribution.source !== "internal" && attribution.entrypoint !== "internal-qa";
}

function boundedValue(value: unknown, allowed: ReadonlySet<string>, missing: string): string {
  if (value == null || value === "") return missing;
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return missing;
  if (normalized.length > 32 || !allowed.has(normalized)) return "unknown";
  return normalized;
}

function normalizeReleaseMarker(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "dev";
  if (!RELEASE_RE.test(normalized)) return "unknown";
  return normalized.slice(0, 12);
}
