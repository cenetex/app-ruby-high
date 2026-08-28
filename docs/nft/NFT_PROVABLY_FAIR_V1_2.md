# Ruby High NFT Provable Fairness v1.2

This document defines the current Ruby High pack reveal algorithm. It is an
auditable server-commit bridge. Each pack gets a commitment before it opens,
and each opened pack and card stores enough provenance to recompute its card
selection. It is not decentralized randomness.

Existing `ruby-high-pack-reveal-v1.1` packs keep the legacy algorithm in
[`NFT_PROVABLY_FAIR_V1_1.md`](./NFT_PROVABLY_FAIR_V1_1.md).

## Published fields

Pack records, card records, metadata, and receipts carry these fields when
available:

| Field | Meaning |
| --- | --- |
| `packRevealVersion` | Algorithm version. New packs use `ruby-high-pack-reveal-v1.2`. |
| `catalogHash` | SHA-256 hash of the First Bell catalog, pack shape, and student-selection rule. |
| `commitment` | Commitment stored when the pack is recorded, before reveal. |
| `entropySource` | Current bridge value: `ruby-high-server-commit-v1`. |
| `revealSeed` | Seed disclosed when the pack opens. |
| `revealProof` | Per-card slot proof. |
| `packAssetAddress` | Metaplex Core pack asset that produced the cards. |
| `revealSlot` | Optional oracle or Solana slot. |
| `randomnessAccount` | Optional Switchboard randomness account. |
| `revealTransaction` | Operation or transaction that settled the reveal. |

## Commitment and reveal

The catalog hash includes `three-unique-static-students-v1`. Commitment, reveal
seed, and per-slot proof use the same formulas as v1.1, with
`ruby-high-pack-reveal-v1.2` as the version prefix:

```text
commitment = sha256(version | "commit" | catalogHash | assetAddress
  | mintSignature | ownerWalletAddress | productId | cardCount | serverNonce)

revealSeed = sha256(version | "seed" | commitment | assetAddress
  | openTransactionId | openSignature | serverNonce)

slotProof(i) = sha256(version | commitment | revealSeed | assetAddress | i)
```

`serverNonce` is an HMAC derived from `RUBY_HIGH_PACK_REVEAL_SECRET`, or from
the NFT authority secret in development fallback mode. This proves that the
commitment existed before opening, but it does not remove server trust.

## Pack shape and odds

Opening a pack reveals these five in-app cards immediately:

| Slot | Rule |
| --- | --- |
| 0 | One teacher. The Super Rare teacher branch is 1 in 64. |
| 1-3 | Three different students in hash-derived order. |
| 4 | One campus item/location. The Ultra Rare special branch is 1 in 64. |

Every complete block of five packs forces the fifth pack's final slot into the
Ultra Rare special branch. A ten-pack therefore has guarantees in packs 5 and
10. Random Ultra Rare pulls can still occur in other packs.

Live player-created cards are not part of v1.2 committed pack selection because
changing session data would make a published reveal impossible to verify.

## Minting and destruction

Pack opening reveals card identities inside Ruby High. Minting each revealed
card on Solana is optional and does not reroll it. Destroying a minted card is
permanent and returns 5 Hall Passes regardless of rarity. The UI requires a
second confirmation for Rare, Super Rare, and Ultra Rare cards.

## Decentralized target

A future version should commit the pack open on Solana, lock the required
authority or payment, and settle from verified Switchboard randomness. It must
publish the randomness account, reveal slot, transaction, version, catalog
hash, and per-slot proofs.
