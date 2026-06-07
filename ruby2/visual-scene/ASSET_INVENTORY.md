# Ruby High Visual Asset Inventory

Date: 2026-05-21

## Best Current Scene Assets

### Location Backgrounds

Use the 16:9 Grok source images for full-screen rooms. They are already wide
enough for a visual-novel / pointcrawl scene surface.

| Location | Preferred Background | Size | Notes |
| --- | --- | ---: | --- |
| Hallway | `../../assets/nft/grok-sources/location-hallway.png` | 1672 x 941 | generated native pointcrawl hallway |
| Homeroom | `../../assets/nft/grok-sources/location-homeroom.jpg` | 1360 x 768 | best first classroom background |
| Science Lab | `../../assets/nft/grok-sources/location-science-lab.jpg` | 1360 x 768 | usable for Sally scenes |
| Library | `../../assets/nft/grok-sources/location-library.jpg` | 1360 x 768 | usable for Edward / Indra / Signal Rise |
| Cafeteria | `../../assets/nft/grok-sources/location-cafeteria.jpg` | 1360 x 768 | usable for social pressure |
| Greenhouse | `../../assets/nft/grok-sources/location-greenhouse.jpg` | 1360 x 768 | usable for recovery |
| Courtyard | `../../assets/nft/grok-sources/location-courtyard.jpg` | 1360 x 768 | usable for chance events |

Other useful background/reference assets:

- `../../assets/ruby-classroom.png` - square classroom hero/reference image.
- `../../ruby2/map.png` - campus map concept/reference image.
- `../../assets/nft/cards/location-*.png` - transparent card artifacts, better
  for inventory/map UI than scene backgrounds.

### Avatars / Paper Dolls

Use the generated cutouts in `./generated/*-cutout.png` for the first dialogue
scene. They were derived from the existing full-body assets by removing the flat
pastel backdrop. Keep these as prototype assets until the art pipeline exports
official transparent dialogue cutouts.

| Character | Best Layer Asset | Size | Alpha | Notes |
| --- | --- | ---: | --- | --- |
| Ruby | `./generated/ruby-cutout.png` | 367 x 1251 | yes | tall teacher standee |
| Sally Science | `./generated/sally-science-cutout.png` | 545 x 1170 | yes | tall teacher standee |
| Professor Edward | `./generated/professor-edward-cutout.png` | 439 x 1190 | yes | tall teacher standee |
| Lyra | `./generated/lyra-cutout.png` | 417 x 1263 | yes | student standee |
| Mika | `./generated/mika-cutout.png` | 567 x 1321 | yes | student standee |
| Ravi | `./generated/ravi-cutout.png` | 683 x 1169 | yes | student standee |
| Indra | `./generated/indra-cutout.png` | 417 x 1256 | yes | student standee |
| Noor | `./generated/noor-cutout.png` | 347 x 1101 | yes | student standee |
| Sami | `./generated/sami-cutout.png` | 571 x 1277 | yes | student standee |

Secondary avatar assets:

- `../../assets/students/*-full.png` and `../../assets/teachers/*-full.png`
  are the source paper-doll images, but most are not transparent.
- `../../assets/teachers/*-full-sticker.png` are transparent sticker cuts, but
  smaller than the NFT card standees. They are useful for UI badges or map pins.
- `../../assets/students/*-face.png` and `../../assets/teachers/*-face.png` are
  non-alpha portrait tiles. Use them for rosters, dialogue chips, or sheets.
- `../../assets/nft/cards/*.png` are collectible card crops. They are useful for
  card/Yearbook/inventory screens, but not as room standees because the card
  frame is part of the transparent asset.

### Items

Use item cards as interactable desk/hand items in the first scene. They are
transparent and consistent.

| Item | Asset | Size | Alpha |
| --- | --- | ---: | --- |
| Notebook | `../../assets/nft/cards/item-notebook.png` | 483 x 543 | yes |
| Flashcards | `../../assets/nft/cards/item-flashcards.png` | 482 x 543 | yes |
| Hall / Office Pass | `../../assets/nft/cards/item-hall-pass.png` | 483 x 543 | yes |
| Library Card | `../../assets/nft/cards/item-library-card.png` | 483 x 543 | yes |
| Lab Flask | `../../assets/nft/cards/item-lab-flask.png` | 483 x 543 | yes |
| Lunch Tray | `../../assets/nft/cards/item-lunch-tray.png` | 482 x 543 | yes |

## Current Gaps

- The generated cutouts need visual QA per asset. Flat-background removal works
  well enough for the prototype, but official alpha exports would be cleaner.
- Captain Null, Eliza, and Rati card assets are not consistently transparent.
  Use them as card/portrait panels for now, not layered standees.
- Items are cards, not separate entity types. That is acceptable for the first
  visual language if we treat them as school artifacts on the desk.
- No expression/pose variants yet. Current cutouts need scale, cropping,
  witness reads, and speech bubbles to carry scene emotion.
- No reliable depth/occlusion masks yet. The active prototype should use the
  close-up dialogue layout instead of trying to place characters on the floor.
