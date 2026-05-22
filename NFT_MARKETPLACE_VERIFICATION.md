# Ruby High NFT Marketplace Verification

## Goal

Ruby High NFTs should read as one clear, legitimate school collectible set in wallets and marketplaces. A player should see accurate collection names, durable artwork, concise traits, and verified collection grouping without needing to understand whether an item is MPL Core or Token Metadata.

## Canonical Marketplace Copy

Primary card collection:

- Name: `Ruby High: First Bell`
- Symbol: `RUBY`
- Description: `Official First Bell collectible set for Ruby High. Student, teacher, location, and item cards earned through Ruby High gameplay.`
- Website: `https://ruby-high.ai/`
- Collection artwork: `assets/nft/ruby-high-first-bell-collection.png`
- Item artwork policy: plain collectible images, not cards inside cards. Avatars are tall, locations are wide, items are square.

Pack receipt collection:

- Name: `Ruby High: First Bell Packs`
- Symbol: `RUBY`
- Description: `Official Ruby High: First Bell pack receipts. Open packs in Ruby High to reveal collectible cards.`
- Website: `https://ruby-high.ai/`
- Collection artwork: `assets/nft/ruby-high-pack-promo.png`
- Sealed pack artwork: `assets/nft/ruby-high-pack.png`
- Opened pack artwork: `assets/nft/ruby-high-pack-opened.png`

## Current Mainnet Collections

These are the known collection addresses from the current production configuration and wallet audit:

- Card collection: `Bu43twu7FsZUHVnYLWuAHLGzseSywm6uHTcD6EDAcX8Q`
- Core pack collection: `GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q`
- Observed Ruby High authority: `B6r1xnyXsH5b2BTpQEYNtXuQQTdPbJAkFiv9Krh9eCKP`

If either collection was created with immutable metadata and its on-chain name or URI is already wrong, do not keep patching around it forever. Create a fresh canonical collection with the copy above, set the corresponding environment variable, and verify that collection instead.

## Metadata Policy

Visible marketplace traits should stay human-readable:

- `School`
- `Collection`
- `Set`
- `Set Code`
- `Set Number`
- `Card Profile ID`
- `NFT Type`
- `State`
- `Edition`
- `Card Name`
- `Title`
- `Character`
- `Role`
- `Rarity`
- `Subject`
- `Media Type`
- `Aspect Class`
- `Image Dimensions`
- `Source Art Version`
- `Serial`
- `Website`

Provable-fair data must remain available, but it should not clutter wallet trait grids. Store it under `properties.provenance`:

- `algorithm`
- `packRevealVersion`
- `catalogHash`
- `commitment`
- `entropySource`
- `revealSeed`
- `revealProof`
- `packAssetAddress`
- `revealSlot`
- `randomnessAccount`
- `revealTransaction`

Durability requirement:

- Images must resolve through Irys/Arweave gateway URLs.
- Minted metadata JSON should also be uploaded to durable storage before minting. The app-hosted JSON routes are acceptable for previews and emergency backfill, but relying on mutable `ruby-high.ai` metadata is a major marketplace indexing risk.

## Magic Eden Plan

Magic Eden distinguishes listed, unlisted, badged, and blacklisted Solana collection states. Solana collections may auto-list, but if Ruby High does not show up, submit it through Creator Hub and then claim the collection to edit its public profile. Badging is a separate trust signal and, for Solana, currently requires meaningful activity, including `50K+ USD` all-time volume.

Verification path:

1. Use the wallet that controls the collection/update authority.
2. Open Magic Eden Creator Hub and claim/apply for the `Ruby High: First Bell` collection first.
3. Submit the primary card collection address, website, collection artwork, description, and any requested social links.
4. If Magic Eden asks for a hashlist, generate it from Helius/DAS for all assets grouped under the canonical collection.
5. After the card collection is listed, submit `Ruby High: First Bell Packs` as the pack receipt collection or ask Magic Eden support whether pack receipts should be grouped under the same public collection page.
6. Do not apply for a badge until listing works and trading volume is eligible.

References:

- Magic Eden Solana listing guide: https://help.magiceden.io/en/articles/6006558-how-to-list-your-nft-collection-on-magic-eden-using-creator-hub
- Magic Eden collection states: https://help.magiceden.us/en/articles/9994857-understanding-collection-states-and-badge-visibility-on-magic-eden
- Magic Eden badge requirements: https://help.magiceden.us/en/articles/9820826-how-to-apply-for-a-badge-on-magic-eden-a-guide-for-creators

## Acceptance Checks

Before sending users to mint again:

- A newly minted pack appears with `Ruby High: First Bell Packs`, sealed pack artwork, and no generic/unknown collection label.
- Opening a pack updates the pack to the opened artwork.
- A newly minted card appears with `Ruby High: First Bell`, the revealed card artwork, `State = Revealed`, and a verified collection grouping.
- Wallet and marketplace traits do not show proof hashes as normal traits.
- Helius/DAS for the mint returns non-empty `content.files`, a durable image URL, and the expected collection grouping.
- Magic Eden shows the collection as listed before asking users to rely on marketplace discovery.
