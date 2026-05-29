# Ruby High Economics and NFTnomics Audit

## Current Economy

- Merit Stars are earned through play and should stay non-purchasable.
- Hall Passes are the paid/entitlement currency for hosted AI, creator slots,
  extra character slots, and hosted image generation.
- Card packs are Solana pack NFTs. Opening a pack creates five face-down cards.
- Revealed card NFTs can be burned into Hall Passes. The live conversion target
  is now `1 Card = 5 Hall Passes`.
- Direct burn-to-use flows now credit the card burn first, then spend the Hall
  Pass cost, so leftover burn value stays in the wallet.

## Ratios

| Flow | Current result | Notes |
| --- | --- | --- |
| 5 Hall Pass top-up | 5 Hall Passes | Stripe/web consumable |
| 1 card pack | 5 cards | Solana pack NFT |
| Burn 1 revealed card | 5 Hall Passes | New floor redemption value |
| Burn all cards from 1 pack | 25 Hall Passes | Important pricing floor |
| Burn all cards from 3 packs | 75 Hall Passes | Important pricing floor |
| Burn all cards from 5 packs | 125 Hall Passes | Includes guaranteed special branch |

## Audit Findings

1. **Burn value creates a real floor.**
   Once a card burns for 5 Hall Passes, a five-card pack has a 25 Hall Pass
   redemption floor. Pack pricing should be treated as at least a 25 Hall Pass
   equivalent unless the goal is intentionally subsidized NFT acquisition.

2. **Pack and Hall Pass storefronts should stay separate.**
   Stripe sells Hall Passes. Solana sells pack NFTs. Mixing them in one product
   list makes the economics unclear, so the UI now separates Buy Hall Passes
   from Buy Card Packs.

3. **Default Solana token prices need production review.**
   The defaults can make different pack sizes cost the same token amount unless
   `RUBY_HIGH_SOLANA_HALL_PASS_*_TOKENS` values are set intentionally. Before a
   larger release, set token prices so 1/3/5/10 pack tiers reflect their burn
   floor and collectible upside.

4. **Captain Null should remain upside, not burn inventory.**
   Captain Null is ultra-rare/special and guaranteed only in larger bundles.
   The UI should keep burn convenient for ordinary cards but should not push
   players to burn rare/special cards blindly.

5. **V1 sink coverage is reasonable.**
   Current Hall Pass sinks are hosted AI access, hosted images, extra character
   slots, creator course slots, and question generation. The system has enough
   sinks for a 5 Hall Pass burn value, but pack pricing must be calibrated to
   avoid undercutting direct Hall Pass purchases.

## Recommended V1 Rules

- Keep `1 burned card = 5 Hall Passes`.
- Price a 1-pack NFT at no less than the 20 Hall Pass tier equivalent unless it
  is a deliberate promo.
- Keep Stripe Hall Pass purchases in the Wallet section.
- Put Card Pack purchase entry points beside the card/pack surfaces.
- Keep direct burn flows value-preserving: burn first, credit Hall Passes, then
  spend from the wallet.
- Add a later confirmation warning for rare, super-rare, and ultra-rare burns.
