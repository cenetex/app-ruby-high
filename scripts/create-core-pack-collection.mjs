#!/usr/bin/env node

import { createCorePackCollection } from "../dist/services/core-pack-nfts.js";

try {
  const result = await createCorePackCollection();
  console.log(JSON.stringify({
    ok: true,
    collectionAddress: result.collectionAddress,
    signature: result.signature,
    metadataUri: result.metadataUri,
    env: `RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS=${result.collectionAddress}`,
  }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
