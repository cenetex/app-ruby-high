# Ruby High NFT Metadata Catalog

This catalog reflects the current source tree, not a live-chain snapshot. The
metadata service is implemented by:

- `src/routes/nft.ts`
- `src/services/hall-pass-nfts.ts`
- `src/services/core-pack-nfts.ts`
- `src/services/ruby-high-service.ts`
- `src/routes/assets.ts`

Default public base URL is `https://ruby-high.ai` unless
`RUBY_HIGH_PUBLIC_BASE` is set (`RUBY_HIGH_PUBLIC_BASE_URL` remains a legacy
fallback). Default NFT symbol is `RUBY` unless
`RUBY_HIGH_SOLANA_NFT_SYMBOL` is set.

The proposed production set expansion lives in
[`NFT_FIRST_BELL_SET_DRAFT.md`](./NFT_FIRST_BELL_SET_DRAFT.md). The runtime
manifest in `src/services/hall-pass-card-catalog.ts` now carries the 36-profile
First Bell draft: 24 currently mintable cards and 12 alternate-art expansion
profiles.

## Summary

| Surface | Count | Notes |
| --- | ---: | --- |
| Hall Pass card metadata profiles | 24 live / 36 draft | All live profiles use plain `assets/nft/market-cards/*.png` media generated from source portraits or Grok-regenerated source art. |
| Card collection metadata | 1 | Metaplex Core collection, `Ruby High: First Bell`. |
| Core pack collection metadata | 1 | Metaplex Core collection, `Ruby High: First Bell Packs`. |
| Core pack metadata state variants | 2 | Sealed and opened art served from the same metadata URL based on app state. |
| Face-down card metadata | Dynamic | Served for unminted card ids through the card-id metadata route. |

## Review Notes

1. **Captain Null is intentionally special.**
   Captain Null is cataloged as role `Special` with rarity `Ultra Rare`, not as
   a teacher. Pack generation now has a special-card slot so Captain Null can
   appear without weakening the normal one-teacher structure.

2. **Revealed card names are unique.**
   Revealed card metadata uses `Ruby High: <Character> #<serial>`, and the
   in-game card title is included as an attribute.

3. **Unknown metadata ids are strict.**
   Unknown direct character metadata and unknown card-id metadata return `404`
   instead of falling back to Ruby or a generic serial-1 Mystery Card.

4. **Mutable metadata is marked no-cache.**
   Pack metadata can switch from sealed to opened art, and card-id metadata can
   switch from face-down to revealed. NFT metadata routes now emit
   `Cache-Control: no-cache`.

5. **Website links are explicit on every NFT metadata shape.**
   Collection, pack, face-down card, and revealed card metadata all include the
   public Ruby High site as top-level `external_url`, `properties.website`, and
   a visible `Website` trait.

6. **Pack reveal provenance is explicit and versioned.**
   Pack/card records, dynamic metadata, and receipts can expose
   `packRevealVersion`, `catalogHash`, `commitment`, `entropySource`,
   `revealSeed`, pack asset, reveal transaction, and per-card `revealProof`.
   New packs use the algorithm in `NFT_PROVABLY_FAIR_V1_2.md`; unopened v1.1
   packs keep the legacy algorithm in `NFT_PROVABLY_FAIR_V1_1.md`.

7. **Revealed card media uses plain aspect-specific crops.**
   Wallet-facing revealed card metadata now points to plain market crops instead
   of generated frames. Student, teacher, and special portraits are normalized
   to tall crops; item art is square, and location art is wide. Items,
   locations, Eliza, Rati, and Captain Null use
   Grok-regenerated source art, while the checked-in special-teacher card crops
   remain tight card-edge fallbacks from the original sheet.

8. **Marketplace fields are explicit.**
   Collection, pack, face-down card, and revealed card metadata all include
   top-level `category: "image"`, `seller_fee_basis_points: 0`,
   `properties.files`, and authority-derived `properties.creators` when
   `RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY` is configured.

9. **Revealed metadata exposes media-class traits.**
   Revealed card attributes include `Media Type`, `Aspect Class`,
   `Image Dimensions`, and `Source Art Version` so wallets and marketplaces can
   distinguish square items, wide locations, tall avatar portraits, and source
   provenance without parsing image URLs.

10. **First Bell set fields are explicit.**
    Collection, pack, face-down card, and revealed card metadata expose
    `Set`, `Set Code`, and `NFT Type`. Revealed cards also expose `Set Number`,
    `Card Profile ID`, `Card Name`, and `Subject`.

## Public Metadata Routes

| Route | Purpose | Metadata function |
| --- | --- | --- |
| `/api/apps/ruby-high/nft/metadata/hall-pass/collection.json` | Card collection JSON | `hallPassCollectionMetadataForRoute` |
| `/api/apps/ruby-high/nft/metadata/hall-pass/card/:cardId.json` | Dynamic face-down or revealed card JSON | `hallPassCardBackMetadataForRoute` or `hallPassNftMetadataForRoute` |
| `/api/apps/ruby-high/nft/metadata/hall-pass/:characterId/:serial.json` | Direct revealed card JSON | `hallPassNftMetadataForRoute` |
| `/api/apps/ruby-high/nft/metadata/core/collection.json` | Pack collection JSON | `corePackCollectionMetadataForRoute` |
| `/api/apps/ruby-high/nft/metadata/core/pack/:productId/:serial.json?packs=:n&cards=:n` | Pack NFT JSON | `corePackNftMetadataForRoute` |
| `/api/apps/ruby-high/nft/status` | Public config/status payload | `publicHallPassNftStatus` plus `publicCorePackNftStatus` |

## Metadata Schema

### Card Collection

| Field | Current value |
| --- | --- |
| `name` | `Ruby High: First Bell` |
| `symbol` | `RUBY` by default |
| `description` | `Official First Bell collectible set for Ruby High.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1` |
| `category` / `properties.category` | `image` |
| `seller_fee_basis_points` | `0` |
| `external_url` / `properties.website` | Public base URL root |
| `properties.files` | Primary image URI with `image/png` MIME type |
| `properties.creators` | Mint authority address, share `100`, verified `true` when authority secret is configured |
| `collection.name` | `Ruby High: First Bell` |
| `collection.family` | `Ruby High` |
| Attributes | School `Ruby High`, Set `First Bell`, Set Code `FB`, Type `Collection`, Series `First Bell`, Edition `First Bell Set`, Live Profiles, Draft Profiles, Website |
| Image dimensions | `1024 x 1024` |

### Face-Down Card

| Field | Current value |
| --- | --- |
| `name` | `Ruby High Mystery Card #<serial>` before reveal; `Ruby High: <Character> #<serial>` after reveal |
| `description` | `A sealed Ruby High card. Mint confirmation reveals the card.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1` |
| `category` / `properties.category` | `image` |
| `seller_fee_basis_points` | `0` |
| `external_url` / `properties.website` | Public base URL root |
| `properties.files` | Primary image URI with `image/png` MIME type |
| `properties.creators` | Mint authority address, share `100`, verified `true` when authority secret is configured |
| Attributes | School, Collection, Set `First Bell`, Set Code `FB`, NFT Type `Card`, State `Face Down`, Serial, Website, optional Card Id |
| Reveal provenance | Pack Reveal Version, Catalog Hash, Commitment, Entropy Source, Reveal Seed, Reveal Proof, Pack Asset, optional Reveal Slot, Randomness Account, Reveal Transaction |
| Image dimensions | `1060 x 1484` |

Revealed card metadata includes the same provenance fields when Ruby High can
match the `characterId` and `serial` route back to a known card record. Direct
revealed metadata also includes media traits: `Media Type`, `Aspect Class`,
`Image Dimensions`, `Source Art Version`, `Set Number`, `Card Profile ID`,
`Card Name`, and `Subject`.

### Core Pack Collection

| Field | Current value |
| --- | --- |
| `name` | `Ruby High: First Bell Packs` |
| `symbol` | `RUBY` by default |
| `description` | `Ruby High: First Bell card packs.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1` |
| `category` / `properties.category` | `image` |
| `seller_fee_basis_points` | `0` |
| `external_url` / `properties.website` | Public base URL root |
| `properties.files` | Primary image URI with `image/png` MIME type |
| `properties.creators` | Mint authority address, share `100`, verified `true` when authority secret is configured |
| Attributes | School `Ruby High`, Collection, Set `First Bell`, Set Code `FB`, Type `Pack Collection`, Website |
| Image dimensions | `1448 x 1086` |

### Core Pack

| Field | Current value |
| --- | --- |
| `name` | `Ruby High: First Bell Pack #<serial>` or `Ruby High: First Bell <packCount>-Pack #<serial>` |
| `description` | `<packCount> Ruby High: First Bell pack(s) with <cardCount> cards inside.` |
| Sealed image | `/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2` |
| Opened image | `/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2` |
| `category` / `properties.category` | `image` |
| `seller_fee_basis_points` | `0` |
| `external_url` / `properties.website` | Public base URL root |
| `properties.files` | Current primary image URI with `image/png` MIME type |
| `properties.creators` | Mint authority address, share `100`, verified `true` when authority secret is configured |
| Attributes | School, Collection, Set `First Bell`, Set Code `FB`, NFT Type `Pack`, Product, Packs, Cards Inside, State, Serial, Website, optional reveal provenance |
| Reveal provenance | Pack Reveal Version, Catalog Hash, Commitment, Entropy Source, optional Reveal Seed, Pack Asset, Reveal Slot, Randomness Account, Reveal Transaction |
| Minimum cards | `max(requested cards, packCount * 5)` |
| Pack art dimensions | `1122 x 1402` |

## Revealed Card Catalog

| ID | Name | Metadata role | Rarity | Image | Dimensions | Metadata description |
| --- | --- | --- | --- | --- | --- | --- |
| `lyra` | Lyra | Student | Common | `assets/nft/market-cards/lyra.png` | `1024 x 1365` | Lyra slipped this one into the stack. |
| `sami` | Sami | Student | Common | `assets/nft/market-cards/sami.png` | `1024 x 1365` | Sami slipped this one into the stack. |
| `ravi` | Ravi | Student | Common | `assets/nft/market-cards/ravi.png` | `1024 x 1365` | Ravi slipped this one into the stack. |
| `indra` | Indra | Student | Rare | `assets/nft/market-cards/indra.png` | `1024 x 1365` | Indra noticed the pattern before anyone clapped. |
| `mika` | Mika | Student | Rare | `assets/nft/market-cards/mika.png` | `1024 x 1365` | Mika says you are absolutely cleared for this. |
| `noor` | Noor | Student | Rare | `assets/nft/market-cards/noor.png` | `1024 x 1365` | Noor called it a plot hole and walked through it. |
| `ruby` | Ruby | Teacher | Common | `assets/nft/market-cards/ruby.png` | `1024 x 1365` | Ruby stamped this one before the late bell could object. |
| `sally-science` | Sally Science | Teacher | Common | `assets/nft/market-cards/sally-science.png` | `1024 x 1365` | Good for one escape from sloppy variables. |
| `professor-edward` | Professor Edward | Teacher | Common | `assets/nft/market-cards/professor-edward.png` | `1024 x 1365` | Please return before the footnotes start breeding. |
| `captain-null` | Captain Null | Special | Ultra Rare | `assets/nft/market-cards/captain-null.png` | `1024 x 1365` | Find page 10 and the hallway forgets your name. |
| `eliza` | Eliza | Teacher | Super Rare | `assets/nft/market-cards/eliza.png` | `1024 x 1365` | Make the system legible, then make it sing. |
| `rati` | Rati | Teacher | Super Rare | `assets/nft/market-cards/rati.png` | `1024 x 1365` | Hold the signal. Build the world. |
| `item-hall-pass` | Hall Pass | Item | Common | `assets/nft/market-cards/item-hall-pass.png` | `1024 x 1024` | Sometimes the smartest move is stepping out and coming back better. |
| `item-flashcards` | Flashcards | Item | Common | `assets/nft/market-cards/item-flashcards.png` | `1024 x 1024` | Shuffle. Repeat. Survive. |
| `item-library-card` | Library Card | Item | Common | `assets/nft/market-cards/item-library-card.png` | `1024 x 1024` | If the answer exists, this helps you find it. |
| `item-lab-flask` | Lab Flask | Item | Rare | `assets/nft/market-cards/item-lab-flask.png` | `1024 x 1024` | Observe first. Guess later. |
| `item-lunch-tray` | Lunch Tray | Item | Rare | `assets/nft/market-cards/item-lunch-tray.png` | `1024 x 1024` | Half the social game happens between bites. |
| `item-notebook` | Notebook | Item | Rare | `assets/nft/market-cards/item-notebook.png` | `1024 x 1024` | Messy notes still count as evidence of life. |
| `location-homeroom` | Homeroom | Location | Common | `assets/nft/market-cards/location-homeroom.png` | `1536 x 864` | Where every day begins, and every question gets a room. |
| `location-science-lab` | Science Lab | Location | Common | `assets/nft/market-cards/location-science-lab.png` | `1536 x 864` | Observe. Test. Explain. Repeat. |
| `location-library` | Library | Location | Common | `assets/nft/market-cards/location-library.png` | `1536 x 864` | If it matters, someone wrote it down. |
| `location-cafeteria` | Cafeteria | Location | Rare | `assets/nft/market-cards/location-cafeteria.png` | `1536 x 864` | Half the school day happens between bites. |
| `location-greenhouse` | Greenhouse | Location | Rare | `assets/nft/market-cards/location-greenhouse.png` | `1536 x 864` | Some lessons grow slowly. |
| `location-courtyard` | Courtyard | Location | Rare | `assets/nft/market-cards/location-courtyard.png` | `1536 x 864` | Every hallway leads somewhere. Every path leads to someone. |

## Alternate-Art Expansion

These 12 profiles are generated and served as market-card assets, but are not
currently mintable by the live pack algorithm until the drop plan is updated.

| ID | Name | Metadata role | Rarity | Image | Dimensions | Variant of |
| --- | --- | --- | --- | --- | --- | --- |
| `homeroom-snow-day` | Homeroom: Snow Day Bell | Location | Rare | `assets/nft/market-cards/homeroom-snow-day.png` | `1536 x 864` | `location-homeroom` |
| `science-lab-fair-night` | Science Lab: Fair Night | Location | Rare | `assets/nft/market-cards/science-lab-fair-night.png` | `1536 x 864` | `location-science-lab` |
| `library-after-hours` | Library: After Hours | Location | Rare | `assets/nft/market-cards/library-after-hours.png` | `1536 x 864` | `location-library` |
| `cafeteria-holiday-lunch` | Cafeteria: Holiday Lunch | Location | Rare | `assets/nft/market-cards/cafeteria-holiday-lunch.png` | `1536 x 864` | `location-cafeteria` |
| `greenhouse-spring-bloom` | Greenhouse: Spring Bloom | Location | Rare | `assets/nft/market-cards/greenhouse-spring-bloom.png` | `1536 x 864` | `location-greenhouse` |
| `courtyard-lantern-festival` | Courtyard: Lantern Festival | Location | Super Rare | `assets/nft/market-cards/courtyard-lantern-festival.png` | `1536 x 864` | `location-courtyard` |
| `hall-pass-gold-stamp` | Hall Pass: Gold Stamp | Item | Rare | `assets/nft/market-cards/hall-pass-gold-stamp.png` | `1024 x 1024` | `item-hall-pass` |
| `flashcards-finals-week` | Flashcards: Finals Week | Item | Rare | `assets/nft/market-cards/flashcards-finals-week.png` | `1024 x 1024` | `item-flashcards` |
| `library-card-midnight` | Library Card: Midnight Loan | Item | Rare | `assets/nft/market-cards/library-card-midnight.png` | `1024 x 1024` | `item-library-card` |
| `lab-flask-holiday-reaction` | Lab Flask: Holiday Reaction | Item | Rare | `assets/nft/market-cards/lab-flask-holiday-reaction.png` | `1024 x 1024` | `item-lab-flask` |
| `notebook-spring-notes` | Notebook: Spring Notes | Item | Rare | `assets/nft/market-cards/notebook-spring-notes.png` | `1024 x 1024` | `item-notebook` |
| `captain-null-eclipse` | Captain Null: Eclipse Pass | Special | Ultra Rare | `assets/nft/market-cards/captain-null-eclipse.png` | `1024 x 1365` | `captain-null-page-10-shadow` |

## Pack Generation Catalog

Normal pack opening creates cards in groups of five:

| Slot | Current selection rule |
| --- | --- |
| 1 | One common teacher, with a 1-in-64 chance of a super-rare teacher. |
| 2-4 | Three students, selected by deterministic HMAC ordering. |
| 5 | One item/location, with a 1-in-64 chance of an ultra-rare special card. |

For purchases of at least five packs, the last pack forces the special-card
branch. In the current v1 catalog, that means Captain Null is guaranteed in the
bundle while Eliza and Rati remain reachable through the super-rare teacher
branch.

For v1.1 pack opens, the card branch seeds are derived from the public
`commitment`, reveal-time `revealSeed`, pack asset address, and slot index:

```text
slotProof = sha256(packRevealVersion + "|" + commitment + "|" + revealSeed + "|" + assetAddress + "|" + slotIndex)
```

The current entropy source is `ruby-high-server-commit-v1`. It is auditable and
commit-first, but it is not decentralized. The intended Solana-native upgrade is
to use a Switchboard randomness account and settle the same derivation from the
verified oracle bytes.

## Asset Inventory

| Asset | Dimensions | Use |
| --- | --- | --- |
| `assets/nft/ruby-high-first-bell-collection.png` | `1024 x 1024` | Hall Pass card collection |
| `assets/nft/ruby-high-card-back.png` | `1060 x 1484` | Face-down Mystery Card |
| `assets/nft/ruby-high-pack.png` | `1122 x 1402` | Sealed Core pack |
| `assets/nft/ruby-high-pack-opened.png` | `1122 x 1402` | Opened Core pack |
| `assets/nft/ruby-high-pack-promo.png` | `1448 x 1086` | Core pack collection |
| `assets/nft/market-cards/*.png` | Mixed | Wallet-facing revealed card crops |
| `assets/nft/grok-sources/*.<hash>.jpg` | Mixed | Grok-generated source art for items, locations, and rare-teacher avatars; `manifest.json` selects the current hash-stamped source while older hashes retain generation history |
| `assets/nft/cards/*.png` | Mixed | Source card art for plain crop generation |
| `assets/nft/ruby-high-student-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-teacher-cards.png` | `1536 x 1024` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-special-teacher-cards.png` | `1536 x 1024` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-item-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-location-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |

## Operational Notes

- Card collection creation uses `npm run nft:create-card-collection`.
- Core pack collection creation uses `npm run nft:create-core-collection`.
- Plain market-card crops are regenerated with `npm run nft:crop-cards`.
- Grok source art can be regenerated with `node scripts/generate-nft-grok-art.mjs --parallel 3 --ids <comma-separated-card-ids>`. The script reads `OPENROUTER_KEY` from `.env`, writes hash-stamped history, updates `manifest.json` to select the current source, and preserves the aspect policy: items square, locations wide, rare-teacher avatars tall.
- Card NFTs use Metaplex Core assets, require
  `RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS`, store durable revealed
  metadata URIs on chain, and include verified creator and attribute plugins.
- Core pack NFTs use Metaplex Core assets, require
  `RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS`, store the dynamic HTTP metadata
  URI on chain, and create new pack collections with immutable metadata plus
  verified creator plugins.
- Assets are served with ETags and static asset caching. The JSON metadata
  routes are dynamic and emit `Cache-Control: no-cache` because pack and card
  metadata can change after opening or reveal.
