import { create, createCollection, burn, update } from '@metaplex-foundation/mpl-core';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';

const umi = createUmi('http://localhost:8899');
umi.use(keypairIdentity(generateSigner(umi)));

const a = generateSigner(umi), c = generateSigner(umi), o = generateSigner(umi);

function dump(label, txBuilder) {
  const ix = txBuilder.getInstructions(umi)[0];
  const data = Buffer.from(ix.data);
  console.log(`\n=== ${label} ===`);
  console.log(`total bytes: ${data.length}`);
  console.log(`hex: ${data.toString('hex')}`);
  console.log(`programId: ${ix.programId}`);
  console.log(`keys (${ix.keys.length}):`);
  for (const k of ix.keys) console.log(`  ${k.pubkey} signer=${k.isSigner} writable=${k.isWritable}`);
}

dump('CreateAsset', create(umi, { asset: a, collection: c.publicKey, owner: o.publicKey, name: 'Test', uri: 'https://x.com/t.json' }));
dump('CreateAsset no coll', create(umi, { asset: generateSigner(umi), owner: o.publicKey, name: 'NC', uri: 'https://x.com/n.json' }));
const cs = generateSigner(umi);
dump('CreateCollection', createCollection(umi, { collection: cs, name: 'Coll', uri: 'https://x.com/c.json' }));
dump('Burn', burn(umi, { asset: a.publicKey, collection: c.publicKey }));
dump('Update', update(umi, { asset: a.publicKey, collection: c.publicKey, authority: o, newName: 'Upd', newUri: 'https://x.com/u.json' }));
