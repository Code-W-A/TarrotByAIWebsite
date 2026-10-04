#!/usr/bin/env node
// Without --apply this is a read-only inventory. Never prints video URLs/tokens.
require('@next/env').loadEnvConfig(require('node:path').resolve(__dirname, '..'));
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const cache = require('../lib/videoLibraryMaterializedCache.cjs');
async function pruneGenerations(db) {
  const manifestRef = db.collection('internalCaches').doc('videoLibraryPublic');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await db.collection('internalCaches').where('createdAt', '<', cutoff)
    .select('createdAt').get();
  const refs = candidates.docs.filter(doc => doc.id.startsWith('videoLibraryPublic__generation_')).map(doc => doc.ref);
  let deleted = 0;
  for (let offset = 0; offset < refs.length; offset += 100) {
    deleted += await db.runTransaction(async tx => {
      const snap = await tx.get(manifestRef);
      if (!snap.exists) throw new Error('No active catalog; refusing cleanup.');
      const manifest = snap.data();
      const protectedIds = new Set([...manifest.chunkDocIds || [], ...manifest.previousManifest?.chunkDocIds || []]);
      const expired = refs.slice(offset, offset + 100).filter(ref => !protectedIds.has(ref.id));
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
    const before = (await db.collection('internalCaches').doc('videoLibraryPublic').get()).data();
    const oldRows = before ? await cache.readSnapshot(db, before) : null;
    const apply = process.argv.includes('--apply');
    let rows, manifest;
    if (apply) {
      ({ rows, manifest } = await cache.rebuild(db, sortVideoDocsForPublic));
    } else {
      const source = await db.collection('videosVideoModule').where('isPublished', '==', true).get();
      rows = source.docs.filter(doc => !['_meta', '_publicCache'].includes(doc.id))
        .map(doc => ({ ...doc.data(), id: doc.id }));
    }
    const categories = rows.reduce((out, row) => {
      const name = row.category || '(fără categorie)'; out[name] = (out[name] || 0) + 1; return out;
    }, {});
    console.log(JSON.stringify({
      mode: apply ? 'rebuilt-and-verified' : 'read-only',
      previousCacheValid: oldRows !== null,
      previousDeclaredCount: before?.rowCount,
      publishedSourceCount: rows.length,
      activeGeneration: manifest?.generation,
      activeChunkCount: manifest?.chunkCount,
      categories,
    }, null, 2));
  } finally { await db.terminate(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
