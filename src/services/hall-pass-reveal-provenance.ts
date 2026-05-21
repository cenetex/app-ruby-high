import { createHash } from "node:crypto";
import { HALL_PASS_CARD_CATALOG } from "./hall-pass-card-catalog.js";

export const HALL_PASS_PACK_REVEAL_VERSION = "ruby-high-pack-reveal-v1.1";
export const HALL_PASS_PACK_REVEAL_ENTROPY_SOURCE = "ruby-high-server-commit-v1";
export const HALL_PASS_PACK_REVEAL_ALGORITHM =
  "sha256(version + commitment + revealSeed + assetAddress + slotIndex)";

export interface HallPassRevealProvenance {
  packRevealVersion?: string;
  catalogHash?: string;
  commitment?: string;
  entropySource?: string;
  revealSeed?: string;
  revealProof?: string;
  packAssetAddress?: string;
  revealSlot?: number;
  randomnessAccount?: string;
  revealTransaction?: string;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hallPassCatalogHash(): string {
  return sha256Hex(stableJson({
    version: "first-bell-v1",
    cardsPerPack: 5,
    packShape: ["teacher", "student", "student", "student", "utility-or-special"],
    catalog: HALL_PASS_CARD_CATALOG.map((entry) => ({
      characterId: entry.characterId,
      characterName: entry.characterName,
      role: entry.role,
      rarity: entry.rarity,
      title: entry.title,
      blurb: entry.blurb,
      color: entry.color,
      artSheet: entry.artSheet ?? null,
      artPosition: entry.artPosition ?? null,
    })),
  }));
}

export function packRevealCommitment(input: {
  catalogHash: string;
  assetAddress: string;
  mintSignature: string;
  ownerWalletAddress: string;
  productId: string;
  cardCount: number;
  nonce: string;
}): string {
  return sha256Hex([
    HALL_PASS_PACK_REVEAL_VERSION,
    "commit",
    input.catalogHash,
    input.assetAddress,
    input.mintSignature,
    input.ownerWalletAddress,
    input.productId,
    String(input.cardCount),
    input.nonce,
  ].join("|"));
}

export function packRevealSeed(input: {
  commitment: string;
  assetAddress: string;
  transactionId: string;
  nonce: string;
  openSignature?: string;
}): string {
  return sha256Hex([
    HALL_PASS_PACK_REVEAL_VERSION,
    "seed",
    input.commitment,
    input.assetAddress,
    input.transactionId,
    input.openSignature ?? "",
    input.nonce,
  ].join("|"));
}

export function packSlotRevealProof(input: {
  commitment: string;
  revealSeed: string;
  assetAddress: string;
  slotIndex: number;
}): string {
  return sha256Hex([
    HALL_PASS_PACK_REVEAL_VERSION,
    input.commitment,
    input.revealSeed,
    input.assetAddress,
    String(Math.max(0, Math.floor(input.slotIndex))),
  ].join("|"));
}

export function revealProvenanceAttributes(
  provenance: HallPassRevealProvenance,
): Array<{ trait_type: string; value: string | number }> {
  const attributes: Array<{ trait_type: string; value: string | number }> = [];
  if (provenance.packRevealVersion) {
    attributes.push({ trait_type: "Pack Reveal Version", value: provenance.packRevealVersion });
  }
  if (provenance.catalogHash) attributes.push({ trait_type: "Catalog Hash", value: provenance.catalogHash });
  if (provenance.commitment) attributes.push({ trait_type: "Commitment", value: provenance.commitment });
  if (provenance.entropySource) attributes.push({ trait_type: "Entropy Source", value: provenance.entropySource });
  if (provenance.revealSeed) attributes.push({ trait_type: "Reveal Seed", value: provenance.revealSeed });
  if (provenance.revealProof) attributes.push({ trait_type: "Reveal Proof", value: provenance.revealProof });
  if (provenance.packAssetAddress) attributes.push({ trait_type: "Pack Asset", value: provenance.packAssetAddress });
  if (typeof provenance.revealSlot === "number") attributes.push({ trait_type: "Reveal Slot", value: provenance.revealSlot });
  if (provenance.randomnessAccount) {
    attributes.push({ trait_type: "Randomness Account", value: provenance.randomnessAccount });
  }
  if (provenance.revealTransaction) {
    attributes.push({ trait_type: "Reveal Transaction", value: provenance.revealTransaction });
  }
  return attributes;
}

export function revealProvenanceProperties(
  provenance: HallPassRevealProvenance,
): Record<string, string | number> | undefined {
  const out: Record<string, string | number> = {};
  if (provenance.packRevealVersion) out.packRevealVersion = provenance.packRevealVersion;
  if (provenance.catalogHash) out.catalogHash = provenance.catalogHash;
  if (provenance.commitment) out.commitment = provenance.commitment;
  if (provenance.entropySource) out.entropySource = provenance.entropySource;
  if (provenance.revealSeed) out.revealSeed = provenance.revealSeed;
  if (provenance.revealProof) out.revealProof = provenance.revealProof;
  if (provenance.packAssetAddress) out.packAssetAddress = provenance.packAssetAddress;
  if (typeof provenance.revealSlot === "number") out.revealSlot = provenance.revealSlot;
  if (provenance.randomnessAccount) out.randomnessAccount = provenance.randomnessAccount;
  if (provenance.revealTransaction) out.revealTransaction = provenance.revealTransaction;
  return Object.keys(out).length > 0 ? out : undefined;
}
