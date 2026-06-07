# Ruby High NFT Provable Fairness v1.1

This document defines the current Ruby High pack reveal algorithm. It is an
auditable v1.1 bridge: every recorded pack gets a pre-reveal commitment and
every opened pack/card stores the reveal seed and provenance needed to
recompute the card derivation. It is not yet fully decentralized randomness.
The decentralized target is the Switchboard Solana commit/reveal flow described
below.

## Published Fields

Pack records, pack metadata, card records, card metadata, and relevant receipts
carry these fields when available:

| Field | Meaning |
| --- | --- |
| `packRevealVersion` | Algorithm version. Current value: `ruby-high-pack-reveal-v1.1`. |
| `catalogHash` | SHA-256 hash of the canonical First Bell card catalog and pack shape. |
| `commitment` | Public commitment written when the pack is recorded, before reveal. |
| `entropySource` | Source used for the reveal seed. Current bridge value: `ruby-high-server-commit-v1`. |
| `revealSeed` | Seed disclosed when the pack is opened. Future value should be Switchboard randomness bytes or a verified future slot/oracle value. |
| `revealProof` | Per-card slot proof. |
| `packAssetAddress` | Metaplex Core pack asset that produced the cards. |
| `revealSlot` | Optional Solana slot used by an oracle/slot-hash reveal. |
| `randomnessAccount` | Optional Switchboard randomness account. |
| `revealTransaction` | Transaction or operation id that settled the reveal. |

## Catalog Hash

`catalogHash` is:

```text
sha256(stableJson({
  version: "first-bell-v1",
  cardsPerPack: 5,
  packShape: ["teacher", "student", "student", "student", "utility-or-special"],
  catalog: canonical card entries
}))
```

The canonical entries include card id, name, role, rarity, title, blurb, color,
art sheet, and art position. The implementation is
`src/services/hall-pass-reveal-provenance.ts`.

## Pack Commitment

When a pack is recorded, Ruby High stores:

```text
commitment = sha256(
  packRevealVersion
  + "|commit|"
  + catalogHash
  + "|" + assetAddress
  + "|" + mintSignature
  + "|" + ownerWalletAddress
  + "|" + productId
  + "|" + cardCount
  + "|" + serverNonce
)
```

For v1.1, `serverNonce` is an HMAC derived from
`RUBY_HIGH_PACK_REVEAL_SECRET`, or from the NFT authority secret in dev/server
fallback mode. This proves that a commitment existed before reveal, but it does
not remove server trust by itself.

## Reveal Seed

When a pack is opened, Ruby High stores:

```text
revealSeed = sha256(
  packRevealVersion
  + "|seed|"
  + commitment
  + "|" + assetAddress
  + "|" + openTransactionId
  + "|" + openSignature
  + "|" + serverNonce
)
```

Future Switchboard settlement should replace this server-derived value with the
verified randomness bytes from the Switchboard randomness account, while keeping
the rest of the card derivation stable.

## Card Derivation

The per-slot reveal proof is:

```text
slotProof(slotIndex) = sha256(
  packRevealVersion
  + "|" + commitment
  + "|" + revealSeed
  + "|" + assetAddress
  + "|" + slotIndex
)
```

Pack opening creates groups of five cards:

| Slot | Rule |
| --- | --- |
| 0 | One teacher, with a 1-in-64 super-rare teacher branch. |
| 1-3 | Three students, sorted by hash-derived order. |
| 4 | One item/location, with a 1-in-64 special-card branch. |

For a five-pack purchase, the last pack still forces the special-card branch.
All branch choices for v1.1 pack opens use SHA-256 integer selection from the
published slot proof and salt strings, not a hidden HMAC.

## Switchboard-Native Target

The on-chain v1.2 design should follow Switchboard's Solana randomness pattern:

1. `commit_open`: verify pack/open authority, store the pack asset, user, catalog
   hash, algorithm version, randomness account, and seed slot. Take payment or
   lock open authority at commit time.
2. `settle_open`: parse the same Switchboard randomness account, verify the
   seed slot/randomness account reference, require the random value to be
   resolved, and derive cards from
   `sha256(commitment + randomnessBytes + assetAddress + slotIndex)`.
3. Emit the reveal transaction, randomness account, reveal slot, catalog hash,
   algorithm version, and per-slot proofs so Ruby High can mirror them into
   metadata and receipts.

Switchboard's current Solana docs describe this as a commit, generate, reveal
flow and specifically warn to take collateral at commit time to prevent
selective revelation.

References:

- https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness
- https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness/randomness-tutorial
