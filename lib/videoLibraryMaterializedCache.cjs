const { randomUUID, createHash } = require('node:crypto');
const COLLECTION = 'internalCaches';
const MANIFEST_ID = 'videoLibraryPublic';
const BUILD_ID = 'videoLibraryPublicBuild';
const VERSION = 2; // Keep the existing API/deployment compatible.
const MAX_BYTES = 900000;
const digestIds = rows => createHash('sha256').update(JSON.stringify(rows.map(row => row.id))).digest('hex');

function splitRows(rows) {
  const chunks = [];
  let current = [], bytes = 2;
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || row.isPublished !== true) {
      throw new Error('Invalid or duplicate published video in catalog.');
    }
    ids.add(row.id);
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (size + 2 > MAX_BYTES) throw new Error(`Video exceeds cache document size: ${row.id}`);
    const separator = current.length ? 1 : 0;
    if (bytes + separator + size > MAX_BYTES) {
      chunks.push(current); current = []; bytes = 2;
    }
    bytes += (current.length ? 1 : 0) + size;
    current.push(row);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function validateManifestRows(manifest, documents) {
  const ids = manifest?.chunkDocIds;
  if (manifest?.version !== VERSION || !Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0 ||
      !Array.isArray(ids) || manifest.chunkCount !== ids.length || new Set(ids).size !== ids.length ||
      !Array.isArray(manifest.featuredVideoIds) || documents.length !== ids.length) return null;
  const rows = [], seen = new Set();
  for (let index = 0; index < documents.length; index++) {
    const chunk = documents[index];
    if (!chunk || chunk.version !== VERSION || !Array.isArray(chunk.rows) ||
        (chunk.index !== undefined && chunk.index !== index) ||
        (chunk.rowCount !== undefined && chunk.rowCount !== chunk.rows.length) ||
        (manifest.generation && chunk.generation !== manifest.generation)) return null;
    for (const row of chunk.rows) {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id) || row.isPublished !== true) return null;
      seen.add(row.id); rows.push(row);
    }
  }
  if (rows.length !== manifest.rowCount || (manifest.idsHash && manifest.idsHash !== digestIds(rows)) ||
      manifest.featuredVideoIds.some(id => !seen.has(id))) return null;
  return rows;
}

async function readSnapshot(db, manifest) {
  if (!Array.isArray(manifest?.chunkDocIds)) return null;
  const snaps = await Promise.all(manifest.chunkDocIds.map(id => db.collection(COLLECTION).doc(id).get()));
  return validateManifestRows(manifest, snaps.map(snap => snap.exists ? snap.data() : null));
}

async function sourceSignature(db) {
  // Two small queries, cached by the reader for five minutes. No full scan.
  const [count, latest] = await Promise.all([
    db.collection('videosVideoModule').where('isPublished', '==', true).count().get(),
    db.collection('videosVideoModule').orderBy('updatedAt', 'desc').limit(1).select('updatedAt').get(),
  ]);
  const doc = latest.docs[0];
  const stamp = doc?.data()?.updatedAt;
  return JSON.stringify([count.data().count, doc?.id || null, stamp?.seconds || 0, stamp?.nanoseconds || 0]);
}

async function rebuild(db, sortRows = rows => rows) {
  const manifestRef = db.collection(COLLECTION).doc(MANIFEST_ID);
  const buildRef = db.collection(COLLECTION).doc(BUILD_ID);
  // Order concurrent rebuild requests across server instances. A slower old
  // rebuild cannot overwrite a newer completed publication.
  const sequence = await db.runTransaction(async tx => {
    const snap = await tx.get(buildRef);
    const value = (snap.data()?.sequence || 0) + 1;
    tx.set(buildRef, { sequence: value, requestedAt: new Date() }, { merge: true });
    return value;
  });
  const signature = await sourceSignature(db);
  const source = await db.collection('videosVideoModule').where('isPublished', '==', true).get();
  const rows = [];
  source.forEach(doc => {
    if (doc.id !== '_meta' && doc.id !== '_publicCache') rows.push({ ...doc.data(), id: doc.id });
  });
  const sorted = sortRows(rows);
  const parts = splitRows(sorted);
  const generation = randomUUID();
  const chunkDocIds = parts.map((_, index) => `videoLibraryPublic__generation_${generation}_${index}`);
  const manifest = {
    version: VERSION, generation, buildSequence: sequence, updatedAt: new Date(), sourceSignature: signature,
    rowCount: sorted.length, chunkCount: parts.length, chunkDocIds,
    featuredVideoIds: sorted.filter(row => row.featuredOnHome === true).map(row => row.id),
    idsHash: digestIds(sorted),
  };
  // Each generation owns its documents; the currently served catalog stays
  // intact even if a write fails midway. Bound parallel writes for large data.
  for (let offset = 0; offset < parts.length; offset += 4) {
    await Promise.all(parts.slice(offset, offset + 4).map((part, relative) => {
      const index = offset + relative;
      return db.collection(COLLECTION).doc(chunkDocIds[index]).set({
        version: VERSION, generation, index, rowCount: part.length,
        createdAt: manifest.updatedAt, rows: part,
      });
    }));
  }
  const verified = await readSnapshot(db, manifest);
  if (!verified || verified.length !== sorted.length) throw new Error('New video catalog failed verification; previous catalog retained.');
  const active = await db.runTransaction(async tx => {
    const snap = await tx.get(manifestRef);
    const current = snap.data();
    if ((current?.buildSequence || 0) > sequence) return current;
    if (current && Array.isArray(current.chunkDocIds)) {
      // Keep one rollback descriptor, never nest older descriptors recursively.
      manifest.previousManifest = Object.fromEntries(
        ['version', 'generation', 'buildSequence', 'updatedAt', 'rowCount', 'chunkCount', 'chunkDocIds', 'featuredVideoIds', 'idsHash', 'sourceSignature']
          .filter(key => current[key] !== undefined).map(key => [key, current[key]])
      );
    }
    tx.set(manifestRef, manifest);
    return manifest;
  });
  const activeRows = active.generation === generation ? verified : await readSnapshot(db, active);
  if (!activeRows) throw new Error('Active video catalog is inconsistent.');
  return { rows: activeRows, manifest: active, published: active.generation === generation };
}
module.exports = { rebuild, readSnapshot, validateManifestRows, digestIds, sourceSignature };
