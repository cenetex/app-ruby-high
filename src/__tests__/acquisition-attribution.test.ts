import { describe, expect, it } from "vitest";
import {
  ACQUISITION_METADATA_KEYS,
  EXPERIMENT_174_CANONICAL_PATH,
  acquisitionAttributionFromMetadata,
  acquisitionAttributionMetadata,
  normalizeAcquisitionAttribution,
} from "../services/acquisition-attribution.js";

describe("privacy-bounded acquisition attribution", () => {
  it.each(["friend", "x", "discord", "telegram", "hn", "reddit", "partner"])("accepts the outreach campaign for %s", (source) => {
    const attribution = normalizeAcquisitionAttribution({ source, campaignId: "outreach-v1" });
    expect(attribution).toMatchObject({ source, campaignId: "outreach-v1" });
    expect(acquisitionAttributionFromMetadata(acquisitionAttributionMetadata(attribution))).toEqual(attribution);
  });

  it("keeps direct traffic explicit when no campaign values are supplied", () => {
    expect(normalizeAcquisitionAttribution({}, "dev")).toEqual({
      source: "direct",
      campaignId: "none",
      landingVariant: "default",
      entrypoint: "viewer",
      releaseMarker: "dev",
    });
  });

  it("accepts only fixed campaign vocabularies and a bounded server release", () => {
    expect(normalizeAcquisitionAttribution({
      source: "X",
      campaignId: "issue-174-v1",
      landingVariant: "quick-roll-v1",
      entrypoint: "viewer",
    }, "2D537D2EC19D416307BA6BC61B45F7346C435063")).toEqual({
      source: "x",
      campaignId: "issue-174-v1",
      landingVariant: "quick-roll-v1",
      entrypoint: "viewer",
      releaseMarker: "2D537D2EC19D",
    });
  });

  it("fails high-cardinality and sensitive-looking client values closed", () => {
    const raw = {
      source: "https://example.com/private?email=person@example.com",
      campaignId: "wallet:4Nd1mYTokenAndArbitraryCampaignText",
      landingVariant: "../../admin?token=secret",
      entrypoint: "free form label that is deliberately much too long",
    };
    const normalized = normalizeAcquisitionAttribution(raw, "bad release value with spaces");
    expect(normalized).toEqual({
      source: "unknown",
      campaignId: "unknown",
      landingVariant: "unknown",
      entrypoint: "unknown",
      releaseMarker: "unknown",
    });
    const metadata = acquisitionAttributionMetadata(normalized);
    expect(Object.keys(metadata).sort()).toEqual(Object.values(ACQUISITION_METADATA_KEYS).sort());
    expect(JSON.stringify(metadata)).not.toContain("example.com");
    expect(JSON.stringify(metadata)).not.toContain("person@");
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(acquisitionAttributionFromMetadata({ ...metadata, acquisitionSource: "arbitrary" })).toBeNull();
  });

  it("publishes one stable canonical experiment path", () => {
    expect(EXPERIMENT_174_CANONICAL_PATH).toBe(
      "/api/apps/ruby-high/viewer?rh_source=x&rh_campaign=issue-174-v1&rh_landing=quick-roll-v1&rh_entry=viewer",
    );
  });
});
