# Ruby High NFT Metadata Catalog

This catalog reflects the current source tree, not a live-chain snapshot. The
metadata service is implemented by:

- `src/routes/nft.ts`
- `src/services/hall-pass-nfts.ts`
- `src/services/core-pack-nfts.ts`
- `src/services/ruby-high-service.ts`
- `src/routes/assets.ts`

Default public base URL is `https://ruby-high.ai` unless
`RUBY_HIGH_PUBLIC_BASE_URL` is set. Default NFT symbol is `RUBY` unless
`RUBY_HIGH_SOLANA_NFT_SYMBOL` is set.

## Summary

| Surface | Count | Notes |
| --- | ---: | --- |
| Hall Pass card metadata profiles | 24 | All have matching `assets/nft/cards/*.png` files and asset routes. |
| Card collection metadata | 1 | Token Metadata collection, `Ruby High`. |
| Core pack collection metadata | 1 | Metaplex Core collection, `Ruby High Packs`. |
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

6. **Art dimensions are acceptable for v1.**
   Teacher and special cards are taller than student, item, and location cards.
   That is treated as a v1 art-class distinction rather than a metadata defect.

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
| `name` | `Ruby High` |
| `symbol` | `RUBY` by default |
| `description` | `Official collectible card collection for Ruby High.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-first-bell-collection.png?v=collection-v1` |
| `external_url` / `properties.website` | Public base URL root |
| `collection.name` | `Ruby High` |
| `collection.family` | `Ruby High` |
| Attributes | School `Ruby High`, Type `Card Collection`, Series `First Bell`, Edition `Student & Faculty Edition`, Website |
| Image dimensions | `1122 x 1402` |

### Face-Down Card

| Field | Current value |
| --- | --- |
| `name` | `Ruby High Mystery Card #<serial>` before reveal; `Ruby High: <Character> #<serial>` after reveal |
| `description` | `A sealed Ruby High card. Mint confirmation reveals the card.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-card-back.png?v=card-back-v1` |
| `external_url` / `properties.website` | Public base URL root |
| Attributes | School, Collection, State `Face Down`, Serial, Website, optional Card Id |
| Image dimensions | `1060 x 1484` |

### Core Pack Collection

| Field | Current value |
| --- | --- |
| `name` | `Ruby High Packs` |
| `symbol` | `RUBY` by default |
| `description` | `Ruby High card packs.` |
| `image` | `/api/apps/ruby-high/assets/nft/ruby-high-pack-promo.png?v=collection-v1` |
| `external_url` / `properties.website` | Public base URL root |
| Attributes | School `Ruby High`, Type `Pack Collection`, Website |
| Image dimensions | `1448 x 1086` |

### Core Pack

| Field | Current value |
| --- | --- |
| `name` | `Ruby High Pack #<serial>` or `Ruby High <packCount>-Pack #<serial>` |
| `description` | `<packCount> Ruby High pack(s) with <cardCount> cards inside.` |
| Sealed image | `/api/apps/ruby-high/assets/nft/ruby-high-pack.png?v=pack-nft-v2` |
| Opened image | `/api/apps/ruby-high/assets/nft/ruby-high-pack-opened.png?v=opened-v2` |
| `external_url` / `properties.website` | Public base URL root |
| Attributes | School, Type `Pack`, Product, Packs, Cards Inside, State, Serial, Website |
| Minimum cards | `max(requested cards, packCount * 5)` |
| Pack art dimensions | `1122 x 1402` |

## Revealed Card Catalog

| ID | Name | Metadata role | Rarity | Image | Dimensions | Metadata description |
| --- | --- | --- | --- | --- | --- | --- |
| `lyra` | Lyra | Student | Common | `assets/nft/cards/lyra.png` | `425 x 520` | Lyra slipped this one into the stack. |
| `sami` | Sami | Student | Common | `assets/nft/cards/sami.png` | `439 x 518` | Sami slipped this one into the stack. |
| `ravi` | Ravi | Student | Common | `assets/nft/cards/ravi.png` | `432 x 518` | Ravi slipped this one into the stack. |
| `indra` | Indra | Student | Rare | `assets/nft/cards/indra.png` | `425 x 514` | Indra noticed the pattern before anyone clapped. |
| `mika` | Mika | Student | Rare | `assets/nft/cards/mika.png` | `441 x 515` | Mika says you are absolutely cleared for this. |
| `noor` | Noor | Student | Rare | `assets/nft/cards/noor.png` | `432 x 516` | Noor called it a plot hole and walked through it. |
| `ruby` | Ruby | Teacher | Common | `assets/nft/cards/ruby.png` | `512 x 1024` | Ruby stamped this one before the late bell could object. |
| `sally-science` | Sally Science | Teacher | Common | `assets/nft/cards/sally-science.png` | `512 x 1024` | Good for one escape from sloppy variables. |
| `professor-edward` | Professor Edward | Teacher | Common | `assets/nft/cards/professor-edward.png` | `512 x 1024` | Please return before the footnotes start breeding. |
| `captain-null` | Captain Null | Special | Ultra Rare | `assets/nft/cards/captain-null.png` | `512 x 1024` | Find page 10 and the hallway forgets your name. |
| `eliza` | Eliza | Teacher | Super Rare | `assets/nft/cards/eliza.png` | `512 x 1024` | Make the system legible, then make it sing. |
| `rati` | Rati | Teacher | Super Rare | `assets/nft/cards/rati.png` | `512 x 1024` | Hold the signal. Build the world. |
| `item-hall-pass` | Hall Pass | Item | Common | `assets/nft/cards/item-hall-pass.png` | `483 x 543` | Sometimes the smartest move is stepping out and coming back better. |
| `item-flashcards` | Flashcards | Item | Common | `assets/nft/cards/item-flashcards.png` | `482 x 543` | Shuffle. Repeat. Survive. |
| `item-library-card` | Library Card | Item | Common | `assets/nft/cards/item-library-card.png` | `483 x 543` | If the answer exists, this helps you find it. |
| `item-lab-flask` | Lab Flask | Item | Rare | `assets/nft/cards/item-lab-flask.png` | `483 x 543` | Observe first. Guess later. |
| `item-lunch-tray` | Lunch Tray | Item | Rare | `assets/nft/cards/item-lunch-tray.png` | `482 x 543` | Half the social game happens between bites. |
| `item-notebook` | Notebook | Item | Rare | `assets/nft/cards/item-notebook.png` | `483 x 543` | Messy notes still count as evidence of life. |
| `location-homeroom` | Homeroom | Location | Common | `assets/nft/cards/location-homeroom.png` | `483 x 543` | Where every day begins, and every question gets a room. |
| `location-science-lab` | Science Lab | Location | Common | `assets/nft/cards/location-science-lab.png` | `482 x 543` | Observe. Test. Explain. Repeat. |
| `location-library` | Library | Location | Common | `assets/nft/cards/location-library.png` | `483 x 543` | If it matters, someone wrote it down. |
| `location-cafeteria` | Cafeteria | Location | Rare | `assets/nft/cards/location-cafeteria.png` | `483 x 543` | Half the school day happens between bites. |
| `location-greenhouse` | Greenhouse | Location | Rare | `assets/nft/cards/location-greenhouse.png` | `482 x 543` | Some lessons grow slowly. |
| `location-courtyard` | Courtyard | Location | Rare | `assets/nft/cards/location-courtyard.png` | `483 x 543` | Every hallway leads somewhere. Every path leads to someone. |

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

## Asset Inventory

| Asset | Dimensions | Use |
| --- | --- | --- |
| `assets/nft/ruby-high-first-bell-collection.png` | `1122 x 1402` | Hall Pass card collection |
| `assets/nft/ruby-high-card-back.png` | `1060 x 1484` | Face-down Mystery Card |
| `assets/nft/ruby-high-pack.png` | `1122 x 1402` | Sealed Core pack |
| `assets/nft/ruby-high-pack-opened.png` | `1122 x 1402` | Opened Core pack |
| `assets/nft/ruby-high-pack-promo.png` | `1448 x 1086` | Core pack collection |
| `assets/nft/ruby-high-student-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-teacher-cards.png` | `1536 x 1024` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-special-teacher-cards.png` | `1536 x 1024` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-item-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |
| `assets/nft/ruby-high-location-cards.png` | `1448 x 1086` | Promo/sheet art, not directly used by metadata |

## Operational Notes

- Card collection creation uses `npm run nft:create-card-collection`.
- Core pack collection creation uses `npm run nft:create-core-collection`.
- Card NFTs use Metaplex Token Metadata, seller fee `0`, immutable
  on-chain metadata, and optional collection verification through
  `RUBY_HIGH_SOLANA_CARD_COLLECTION_ADDRESS`.
- Core pack NFTs use Metaplex Core assets, require
  `RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS`, and store the dynamic HTTP
  metadata URI on chain.
- Assets are served with ETags and static asset caching. The JSON metadata
  routes are dynamic and should get an explicit cache policy before relying on
  opened/revealed metadata refreshes in marketplaces.
