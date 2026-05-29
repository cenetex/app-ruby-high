# Ruby High: First Bell NFT Set Draft

## Why

Ruby High needs NFTs that feel legitimate before a player ever reads the app.
If a pack or card does not show cleanly in Phantom and marketplaces, the user
experiences the mint as broken even if the chain record is technically valid.
The First Bell set is therefore a product-quality artifact first: recognizable
collection identity, durable media, clear card taxonomy, verified Token
Metadata, and provenance that makes every reveal inspectable.

The set should also make Ruby High easier to understand. A holder should see a
school, not a pile of receipts: students, faculty, items, locations, special
events, and a sealed pack that opens into a coherent five-card school-day pull.

## Product Position

- Collection name: `Ruby High: First Bell`
- Public family: `Ruby High`
- NFT standard: Solana Token Metadata, not Core, for maximum wallet and
  marketplace compatibility.
- Collection authority: Ruby High mint authority, with verified collection and
  verified creator on every pack and card.
- Royalties: `0` for v1, unless a later market strategy deliberately changes
  this.
- Visual rule: the NFT image is the art, not a card frame around existing art.
  Items are square, locations are wide, and character/avatar cards are tall.
- Metadata rule: final mint metadata and media should point to durable static
  storage. Ruby High app routes can remain preview/proxy routes, but on-chain
  URIs should not depend on mutable app-only JSON for final production mints.

## On-Chain Shape

### Collection

Create one Token Metadata collection NFT:

| Field | Value |
| --- | --- |
| Name | `Ruby High: First Bell` |
| Symbol | `RUBY` |
| Type | Token Metadata collection NFT |
| Master edition | Yes, non-printable |
| Update authority | Ruby High mint authority |
| Metadata | Immutable after final upload |
| Image | First Bell collection art |

### Packs

Each pack should be its own unique Token Metadata NFT, verified into the
`Ruby High: First Bell` collection.

| Field | Value |
| --- | --- |
| Name | `Ruby High: First Bell Pack #<serial>` |
| Symbol | `RUBY` |
| Master edition | Yes, max supply `0` / non-printable |
| Collection | Verified `Ruby High: First Bell` |
| Creator | Verified Ruby High authority |
| Metadata mutability | Prefer immutable sealed metadata |
| Opening behavior | Consume/burn pack or lock it in an opening program before cards mint |

The pack metadata should include pre-reveal provenance: `packRevealVersion`,
`catalogHash`, `commitment`, `entropySource`, pack serial, card count, pack
product, and website. Because immutable pack metadata is better for wallet
confidence, reveal-time fields such as `revealSeed`, `randomnessAccount`,
`revealSlot`, and `revealTransaction` should be recorded in the reveal receipt
and on the revealed card metadata. If a wallet-visible opened pack is required,
mint a separate immutable `Opened Pack Receipt` NFT rather than mutating the
sealed pack.

### Cards

Each revealed card should be a unique Token Metadata NFT, verified into the same
collection.

| Field | Value |
| --- | --- |
| Name | `Ruby High: <Card Name> #<serial>` |
| Symbol | `RUBY` |
| Master edition | Yes, max supply `0` / non-printable |
| Collection | Verified `Ruby High: First Bell` |
| Creator | Verified Ruby High authority |
| Metadata mutability | Immutable after reveal |
| Image | Durable final art crop |

Printed editions are not a good fit for packs or cards in this set. Metaplex
print editions are copies of a master edition and inherit the master metadata,
but Ruby High cards need unique serials, pack provenance, reveal proofs, and
sometimes unique player-facing state. Use master editions to make each NFT
non-printable. Enforce pack and set supply through the mint/reveal authority or
future on-chain pack-opening program, not through printed editions.

## Pack Product

Default pack:

| Property | Value |
| --- | --- |
| Cards per pack | 5 |
| Pack cap draft | 5,000 production packs after a smaller pilot |
| Pilot cap draft | 500 packs |
| Bundle products | 1-pack, 3-pack, 5-pack, 10-pack |
| Redemption floor | Keep current `1 revealed card = 5 Hall Passes` unless pricing changes |

Pack slot draft:

| Slot | Contents |
| --- | --- |
| 1 | Faculty card, mostly common faculty, with rare/super-rare faculty upside |
| 2 | Student card |
| 3 | Student card |
| 4 | Student card |
| 5 | Campus card: item, location, or special event |

The current v1 shape already teaches this product well: one teacher, three
students, and one item/location/special. Keep that shape. Exact weights should
be finalized in code after the card list is approved, but the public set page
should publish the algorithm and the catalog hash used for each drop window.

## Visual Standards

| Class | Target image | Notes |
| --- | --- | --- |
| Student | Tall, `1024 x 1365` | Recrop current student portraits from source art before final mint. |
| Faculty | Tall, `1024 x 1365` | Core teachers and rare teachers should share the avatar standard. |
| Special | Tall, `1024 x 1365` | Character-like special cards use avatar treatment. |
| Item | Square, `1024 x 1024` | Object-centered, no border frame. |
| Location | Wide, `1536 x 864` | Environmental art, no fake card frame. |
| Pack | Tall, `1122 x 1402` or production replacement | Should read as a sealed collectible pack in wallet thumbnails. |

## Required Metadata Traits

Every pack:

- `School`: `Ruby High`
- `Set`: `First Bell`
- `Set Code`: `FB`
- `NFT Type`: `Pack`
- `Pack Serial`
- `Cards Inside`: `5`
- `Pack Reveal Version`
- `Catalog Hash`
- `Commitment`
- `Entropy Source`
- `Website`

Every revealed card:

- `School`: `Ruby High`
- `Set`: `First Bell`
- `Set Code`: `FB`
- `Set Number`
- `Card Profile ID`
- `NFT Type`: `Card`
- `Role`: `Student`, `Teacher`, `Item`, `Location`, or `Special`
- `Rarity`: `Common`, `Rare`, `Super Rare`, or `Ultra Rare`
- `Subject` or `Campus Zone`
- `Aspect Class`: `Tall`, `Square`, or `Wide`
- `Image Dimensions`
- `Source Art Version`
- `Pack Asset`
- `Reveal Slot`
- `Pack Reveal Version`
- `Catalog Hash`
- `Commitment`
- `Entropy Source`
- `Reveal Seed`
- `Reveal Proof`
- `Reveal Transaction`
- `Website`

## Set List Draft

This is the proposed `36` profile First Bell set. The first `24` profiles are
the live mintable catalog. The last `12` are alternate-art expansion cards
based on existing locations, items, and Captain Null, so the set grows in
quality without inventing unsupported characters or mechanics.

### Live Base Set

| No. | Profile ID | Card name | Rarity | Subject/zone | Art |
| --- | --- | --- | --- | --- | --- |
| FB-001 | `lyra-color-coded-spare` | Lyra: Color-Coded Spare | Common | Homeroom | Source portrait tall crop |
| FB-002 | `sami-side-door-whatever` | Sami: Side Door Whatever | Common | Homeroom | Source portrait tall crop |
| FB-003 | `ravi-field-trip-fact-slip` | Ravi: Field Trip Fact Slip | Common | Field Trip | Source portrait tall crop |
| FB-004 | `indra-quiet-perfect-exit` | Indra: Quiet Perfect Exit | Rare | Strategy | Source portrait tall crop |
| FB-005 | `mika-locker-room-shortcut` | Mika: Locker Room Shortcut | Rare | Social | Source portrait tall crop |
| FB-006 | `noor-deadpan-detour` | Noor: Deadpan Detour | Rare | Literature | Source portrait tall crop |
| FB-007 | `ruby-homeroom-card` | Ruby: Homeroom Card | Common | Homeroom | Source portrait tall crop |
| FB-008 | `sally-lab-sink-shortcut` | Sally Science: Lab Sink Shortcut | Common | Science | Source portrait tall crop |
| FB-009 | `professor-edward-library-corridor` | Professor Edward: Library Corridor Pass | Common | Literature | Source portrait tall crop |
| FB-010 | `eliza-systems-lab-override` | Eliza: Systems Lab Override | Super Rare | Systems | Grok tall source art |
| FB-011 | `rati-signal-studies-pass` | Rati: Signal Studies Pass | Super Rare | Signal Studies | Grok tall source art |
| FB-012 | `captain-null-page-10-shadow` | Captain Null: Page 10 Shadow Pass | Ultra Rare | First Bell | Grok tall source art |
| FB-013 | `item-hall-pass` | Hall Pass: Front Office Reset | Common | Administration | Grok square source art |
| FB-014 | `item-flashcards` | Flashcards: Study Kit | Common | Study | Grok square source art |
| FB-015 | `item-library-card` | Library Card: Quiet Wing Access | Common | Library | Grok square source art |
| FB-016 | `item-lab-flask` | Lab Flask: Science Lab Evidence | Rare | Science | Grok square source art |
| FB-017 | `item-lunch-tray` | Lunch Tray: Commons Diplomacy | Rare | Cafeteria | Grok square source art |
| FB-018 | `item-notebook` | Notebook: Daily Carry | Rare | Homeroom | Grok square source art |
| FB-019 | `location-homeroom` | Homeroom: Front Door | Common | Homeroom | Grok wide source art |
| FB-020 | `location-science-lab` | Science Lab: STEM Wing | Common | Science | Grok wide source art |
| FB-021 | `location-library` | Library: Quiet Wing | Common | Literature | Grok wide source art |
| FB-022 | `location-cafeteria` | Cafeteria: Commons | Rare | Cafeteria | Grok wide source art |
| FB-023 | `location-greenhouse` | Greenhouse: Garden Annex | Rare | Science | Grok wide source art |
| FB-024 | `location-courtyard` | Courtyard: Central Grounds | Rare | Campus | Grok wide source art |

### Alternate-Art Expansion

| No. | Profile ID | Card name | Rarity | Variant of | Art |
| --- | --- | --- | --- | --- | --- |
| FB-025 | `homeroom-snow-day` | Homeroom: Snow Day Bell | Rare | `location-homeroom` | Wide location alternate |
| FB-026 | `science-lab-fair-night` | Science Lab: Fair Night | Rare | `location-science-lab` | Wide location alternate |
| FB-027 | `library-after-hours` | Library: After Hours | Rare | `location-library` | Wide location alternate |
| FB-028 | `cafeteria-holiday-lunch` | Cafeteria: Holiday Lunch | Rare | `location-cafeteria` | Wide location alternate |
| FB-029 | `greenhouse-spring-bloom` | Greenhouse: Spring Bloom | Rare | `location-greenhouse` | Wide location alternate |
| FB-030 | `courtyard-lantern-festival` | Courtyard: Lantern Festival | Super Rare | `location-courtyard` | Wide location alternate |
| FB-031 | `hall-pass-gold-stamp` | Hall Pass: Gold Stamp | Rare | `item-hall-pass` | Square item alternate |
| FB-032 | `flashcards-finals-week` | Flashcards: Finals Week | Rare | `item-flashcards` | Square item alternate |
| FB-033 | `library-card-midnight` | Library Card: Midnight Loan | Rare | `item-library-card` | Square item alternate |
| FB-034 | `lab-flask-holiday-reaction` | Lab Flask: Holiday Reaction | Rare | `item-lab-flask` | Square item alternate |
| FB-035 | `notebook-spring-notes` | Notebook: Spring Notes | Rare | `item-notebook` | Square item alternate |
| FB-036 | `captain-null-eclipse` | Captain Null: Eclipse Pass | Ultra Rare | `captain-null-page-10-shadow` | Tall special alternate |

## Reveal And Provenance Model

For v1.2 Token Metadata packs, keep the v1.1 commit-first reveal model:

1. Mint or record the sealed pack with `packRevealVersion`, `catalogHash`, and
   `commitment`.
2. Opening commits the pack authority/payment before randomness is known.
3. Settle each slot from:

```text
sha256(commitment + randomness + assetAddress + slotIndex)
```

4. Mint revealed Token Metadata cards with immutable metadata containing the
   card profile, serial, pack asset, reveal slot, catalog hash, reveal proof,
   randomness account or entropy source, and reveal transaction.

When the Solana-native opening program lands, replace server entropy with
Switchboard randomness and keep the same public derivation shape.

## Implementation Notes

- The live runtime catalog currently has `24` mintable profiles and carries a
  `12` profile alternate-art expansion, for `36` draft profiles total.
- Student and core-teacher market crops now use the tall avatar standard.
- Existing item and location art already matches the square/wide product rule.
- The pack flow should move away from Metaplex Core and into Token Metadata
  packs with verified creator and verified collection.
- The production set page should publish the final catalog JSON, `catalogHash`,
  pack slot algorithm, and drop window/cap before sales start.
