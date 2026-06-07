#!/usr/bin/env node

import { createHallPassCardCollection } from "../dist/services/hall-pass-nfts.js";

try {
  const result = await createHallPassCardCollection();
  console.log(JSON.stringify({
    ok: true,
    collectionAddress: result.collectionAddress,
    signature: result.signature,
    metadataUri: result.metadataUri,
    env: `RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS=${result.collectionAddress}`,
  }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
