import { create, createCollection, update, burn } from '@metaplex-foundation/mpl-core';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { writeFileSync } from 'fs';

const umi = createUmi('http://localhost:8899');
umi.use(keypairIdentity(generateSigner(umi)));

function ixToVector(txBuilder, desc) {
  const insts = txBuilder.getInstructions(umi);
  const ix = insts[0];
  return {
    desc,
    programId: ix.programId,
    disc: Buffer.from(ix.data.slice(0, 8)).toString('hex'),
    data: Buffer.from(ix.data).toString('hex'),
    keys: ix.keys.map(k => ({
      pubkey: k.pubkey, signer: k.isSigner, writable: k.isWritable,
    })),
  };
}

const asset = generateSigner(umi);
const collection = generateSigner(umi);
const owner = generateSigner(umi);
const authority = generateSigner(umi);

const vectors = {};

vectors.createAsset = ixToVector(
  create(umi, { asset, collection: collection.publicKey, owner: owner.publicKey,
    name: 'Test NFT', uri: 'https://example.com/metadata.json' }),
  'CreateAsset with name, uri, collection');
vectors.createAsset.asset = asset.publicKey;
vectors.createAsset.collection = collection.publicKey;
vectors.createAsset.owner = owner.publicKey;

vectors.createAssetNC = ixToVector(
  create(umi, { asset: generateSigner(umi), owner: owner.publicKey,
    name: 'NoColl NFT', uri: 'https://example.com/nc.json' }),
  'CreateAsset without collection');

const cs = generateSigner(umi);
vectors.createCollection = ixToVector(
  createCollection(umi, { collection: cs, name: 'Test Collection',
    uri: 'https://example.com/coll.json' }),
  'CreateCollection');
vectors.createCollection.collection = cs.publicKey;

vectors.burn = ixToVector(
  burn(umi, { asset: asset.publicKey, collection: collection.publicKey }),
  'Burn asset');

vectors.update = ixToVector(
  update(umi, { asset: asset.publicKey, collection: collection.publicKey,
    authority, newName: 'Updated Name', newUri: 'https://example.com/updated.json' }),
  'Update asset name + uri');

writeFileSync('scripts/core-vectors.json', JSON.stringify(vectors, null, 2));
console.log('Vectors written.');

for (const [k, v] of Object.entries(vectors)) {
  const b = v.disc.match(/.{2}/g).map(x => '0x' + x).join(', ');
  console.log(`  ${k}: {${b}}  // ${v.desc}`);
}
