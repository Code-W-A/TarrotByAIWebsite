#!/usr/bin/env node
// Without --apply this is a read-only inventory. Never prints video URLs/tokens.
require('@next/env').loadEnvConfig(require('node:path').resolve(__dirname, '..'));
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const cache = require('../lib/videoLibraryMaterializedCache.cjs');
async function pruneGenerations(db) {
  const manifestRef = db.collection('internalCaches').doc(cache.MANIFEST_ID);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await db.collection('internalCaches').where('createdAt', '<', cutoff)
    .select('createdAt').get();
  const refs = candidates.docs.filter(doc => doc.id.startsWith(`${cache.MANIFEST_ID}__generation_`)).map(doc => doc.ref);
  let deleted = 0;
  for (let offset = 0; offset < refs.length; offset += 100) {
    deleted += await db.runTransaction(async tx => {
      const snap = await tx.get(manifestRef);
      if (!snap.exists || !cache.validateManifestHeader(snap.data())) throw new Error('No valid active catalog; refusing cleanup.');
      const manifest = snap.data();
      const batch = refs.slice(offset, offset + 100);
      const removableIds = new Set(cache.prunableChunkIds(manifest, batch.map(ref => ref.id)));
      const expired = batch.filter(ref => removableIds.has(ref.id));
      expired.forEach(ref => tx.delete(ref));
      return expired.length;
    });
  }
  console.log(JSON.stringify({ mode: 'cleanup-old-generations', deleted, graceHours: 24 }));
}

async function main() {
  initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }) });
  const db = getFirestore();
  try {
    if (process.argv.includes('--prune')) {
      await pruneGenerations(db);
      return;
    }
    // This dependency-free ES module is the same ordering used by the API.
    const code = fs.readFileSync(path.join(__dirname, '../lib/videoLibrarySort.js'), 'utf8');
    const { sortVideoDocsForPublic } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const before = (await db.collection('internalCaches').doc(cache.MANIFEST_ID).get()).data();
    const oldRows = before ? await cache.readSnapshot(db, before) : null;
    const apply = process.argv.includes('--apply');
    let rows, manifest, dryRun;
    if (apply) {
      ({ rows, manifest } = await cache.rebuild(db, sortVideoDocsForPublic));
    } else {
      const source = await db.collection('videosVideoModule').where('isPublished', '==', true).get();
      rows = source.docs.filter(doc => !['_meta', '_publicCache'].includes(doc.id))
        .map(doc => ({ ...doc.data(), id: doc.id }));
      rows = await require('../lib/videoDescriptionStorage.cjs').resolveDescriptions(rows);
      const sorted = sortVideoDocsForPublic(rows);
      const generation = require('node:crypto').randomUUID();
      const prepared = cache.prepareGeneration(sorted, generation, new Date());
      const candidate = { version: cache.VERSION, generation, rowCount: sorted.length,
        ...prepared.metadataSet, textSets: prepared.textSets,
        idsHash: cache.digestIds(sorted), featuredVideoIds: sorted.filter(row => row.featuredOnHome === true).map(row => row.id) };
      const documents = new Map(prepared.documents.map(document => [document.id, document.data]));
      if (!cache.validateManifestRows(candidate, candidate.chunkDocIds.map(id => documents.get(id)))) throw new Error('Dry-run metadata verification failed.');
      for (const [language, set] of Object.entries(candidate.textSets)) {
        const actual = cache.validateTexts(candidate, language, set.chunkDocIds.map(id => documents.get(id)));
        const expected = sorted.flatMap(row => {
          const value = language === cache.ROOT_TEXT_KEY ? row.description : row.locales?.[language.slice('locale:'.length)]?.description;
          return typeof value === 'string' ? [[row.id, value]] : [];
        });
        if (!actual || cache.digest([...actual]) !== cache.digest(expected)) throw new Error(`Dry-run text round-trip failed: ${language}`);
      }
      dryRun = {
        formatVersion: cache.VERSION, metadataChunks: candidate.chunkCount,
        textChunks: Object.values(candidate.textSets).reduce((total, set) => total + set.chunkCount, 0),
        textSets: Object.keys(candidate.textSets).length,
        maxDocumentBytes: Math.max(0, ...prepared.documents.map(document => cache.documentBytes(document.data))),
        oversizedSourceRows: rows.filter(row => Buffer.byteLength(JSON.stringify(row), 'utf8') > cache.MAX_BYTES).map(row => row.id),
        exactIdsAndTextRoundTrip: true,
      };
    }
    const categories = rows.reduce((out, row) => {
      const name = row.category || '(fără categorie)'; out[name] = (out[name] || 0) + 1; return out;
    }, {});
    console.log(JSON.stringify({
      mode: apply ? 'rebuilt-and-verified' : 'read-only',
      previousCacheValid: oldRows !== null,
      previousDeclaredCount: before?.rowCount,
      publishedSourceCount: rows.length,
      dryRun,
      activeGeneration: manifest?.generation,
      activeChunkCount: manifest?.chunkCount,
      activeTextChunkCount: manifest ? Object.values(manifest.textSets).reduce((total, set) => total + set.chunkCount, 0) : undefined,
      categories,
    }, null, 2));
  } finally { await db.terminate(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
