const { randomUUID, createHash } = require('node:crypto');
const COLLECTION = 'internalCaches';
const MANIFEST_ID = 'videoLibraryPublicV3';
const BUILD_ID = 'videoLibraryPublicV3Build';
const VERSION = 3;
const MAX_BYTES = 900000;
const ROOT_TEXT_KEY = 'root';
function canonical(value) {
  if (value instanceof Date) return { timestamp: [Math.floor(value.getTime() / 1000), (value.getTime() % 1000) * 1000000] };
  if (value && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') return { timestamp: [value.seconds, value.nanoseconds] };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const digestIds = rows => digest(rows.map(row => row.id));
// Firestore converts Date envelopes to Timestamp on read. Reserve space for that
// representation as well as the complete JSON document, not only its rows.
const documentBytes = document => Buffer.byteLength(JSON.stringify(document), 'utf8') + 256;
const allChunkIds = manifest => [...(manifest?.chunkDocIds || []), ...Object.values(manifest?.textSets || {}).flatMap(set => set.chunkDocIds || [])];
const validIds = ids => Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && /^videoLibraryPublicV3__generation_[\w-]+_\d+$/.test(id));
const hashesValid = (ids, hashes) => Array.isArray(hashes) && ids.length === hashes.length && hashes.every(hash => /^[a-f0-9]{64}$/.test(hash));

function validateManifestHeader(manifest) {
  if (!manifest || manifest.version !== VERSION || typeof manifest.generation !== 'string' || !manifest.generation ||
      !Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0 || !validIds(manifest.chunkDocIds) ||
      manifest.chunkCount !== manifest.chunkDocIds.length || !hashesValid(manifest.chunkDocIds, manifest.chunkHashes) ||
      !Array.isArray(manifest.featuredVideoIds) || !manifest.textSets || typeof manifest.textSets !== 'object' || Array.isArray(manifest.textSets) ||
      !Object.hasOwn(manifest.textSets, ROOT_TEXT_KEY)) return false;
  for (const [language, set] of Object.entries(manifest.textSets)) {
    if ((language !== ROOT_TEXT_KEY && !language.startsWith('locale:')) || !set || !validIds(set.chunkDocIds) ||
        set.chunkCount !== set.chunkDocIds.length || !hashesValid(set.chunkDocIds, set.chunkHashes) ||
        !Number.isSafeInteger(set.entryCount) || set.entryCount < 0 || !Number.isSafeInteger(set.partCount) || set.partCount < set.entryCount ||
        !/^[a-f0-9]{64}$/.test(set.hash)) return false;
  }
  const ids = allChunkIds(manifest);
  return new Set(ids).size === ids.length;
}

function validateManifestRows(manifest, documents) {
  if (!validateManifestHeader(manifest) || documents.length !== manifest.chunkDocIds.length) return null;
  const rows = [], seen = new Set();
  for (let index = 0; index < documents.length; index++) {
    const chunk = documents[index];
    if (!chunk || chunk.version !== VERSION || chunk.kind !== 'metadata' || chunk.generation !== manifest.generation ||
        chunk.index !== index || !Array.isArray(chunk.rows) || chunk.rowCount !== chunk.rows.length ||
        documentBytes(chunk) > MAX_BYTES || digest(chunk.rows) !== manifest.chunkHashes[index]) return null;
    for (const row of chunk.rows) {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id) || row.isPublished !== true ||
          Object.hasOwn(row, 'description') || Object.values(row.locales || {}).some(entry => entry && Object.hasOwn(entry, 'description'))) return null;
      seen.add(row.id); rows.push(row);
    }
  }
  if (rows.length !== manifest.rowCount || manifest.idsHash !== digestIds(rows) || manifest.featuredVideoIds.some(id => !seen.has(id))) return null;
  return rows;
}

async function readDocuments(db, ids) {
  const result = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    const snaps = await Promise.all(ids.slice(offset, offset + 4).map(id => db.collection(COLLECTION).doc(id).get()));
    result.push(...snaps.map(snap => snap.exists ? snap.data() : null));
  }
  return result;
}
async function readSnapshot(db, manifest) {
  if (!validateManifestHeader(manifest)) return null;
  return validateManifestRows(manifest, await readDocuments(db, manifest.chunkDocIds));
}
function prunableChunkIds(manifest, candidates) {
  if (!validateManifestHeader(manifest)) throw new Error('No valid active catalog; refusing cleanup.');
  const protectedIds = new Set([...allChunkIds(manifest), ...allChunkIds(manifest.previousManifest)]);
  return candidates.filter(id => id.startsWith(`${MANIFEST_ID}__generation_`) && !protectedIds.has(id));
}
function validateTexts(manifest, language, documents) {
  const set = manifest?.textSets?.[language];
  if (!validateManifestHeader(manifest) || !set || documents.length !== set.chunkCount) return null;
  const entries = new Map(); let count = 0, previousId = null, nextPart = 0;
  for (let index = 0; index < documents.length; index++) {
    const chunk = documents[index];
    if (!chunk || chunk.version !== VERSION || chunk.kind !== 'texts' || chunk.generation !== manifest.generation ||
        chunk.language !== language || chunk.index !== index || !Array.isArray(chunk.parts) ||
        chunk.partCount !== chunk.parts.length || documentBytes(chunk) > MAX_BYTES || digest(chunk.parts) !== set.chunkHashes[index]) return null;
    for (const part of chunk.parts) {
      if (!part || typeof part.id !== 'string' || !part.id || typeof part.text !== 'string') return null;
      if (part.id !== previousId) {
        if (entries.has(part.id)) return null;
        previousId = part.id; nextPart = 0;
      }
      if (part.index !== nextPart++) return null;
      entries.set(part.id, (entries.get(part.id) || '') + part.text); count++;
    }
  }
  return entries.size === set.entryCount && count === set.partCount && digest([...entries]) === set.hash ? entries : null;
}
async function readTexts(db, manifest, language) {
  if (!validateManifestHeader(manifest)) return null;
  if (!Object.hasOwn(manifest.textSets, language)) return new Map();
  return validateTexts(manifest, language, await readDocuments(db, manifest.textSets[language].chunkDocIds));
}

function prepareGeneration(sourceRows, generation, createdAt) {
  const texts = new Map([[ROOT_TEXT_KEY, []]]);
  const rows = sourceRows.map(row => {
    if (typeof row.description === 'string') texts.get(ROOT_TEXT_KEY).push([row.id, row.description]);
    const { description, ...metadata } = row;
    if (row.locales && typeof row.locales === 'object') {
      metadata.locales = Object.fromEntries(Object.entries(row.locales).map(([locale, entry]) => {
        if (!entry || typeof entry !== 'object') return [locale, entry];
        const { description: localized, ...fields } = entry;
        if (typeof localized === 'string') {
          const key = `locale:${locale}`;
          if (!texts.has(key)) texts.set(key, []);
          texts.get(key).push([row.id, localized]);
        }
        return [locale, fields];
      }));
    }
    return metadata;
  });
  const documents = [];
  const newDocument = (kind, index, language) => ({ version: VERSION, generation, kind, index, createdAt,
    ...(kind === 'metadata' ? { rowCount: 0, rows: [] } : { language, partCount: 0, parts: [] }) });
  function pack(items, kind, language) {
    const packed = []; let document = newDocument(kind, 0, language);
    const field = kind === 'metadata' ? 'rows' : 'parts', count = kind === 'metadata' ? 'rowCount' : 'partCount';
    const finish = () => { if (document[field].length) { packed.push(document); document = newDocument(kind, packed.length, language); } };
    const fits = item => documentBytes({ ...document, [field]: [...document[field], item], [count]: document[count] + 1 }) <= MAX_BYTES;
    const add = item => { document[field].push(item); document[count]++; };
    for (const item of items) {
      if (kind === 'metadata') {
        if (!fits(item)) finish();
        if (!fits(item)) throw new Error(`Video metadata exceeds cache document size: ${item.id}`);
        add(item); continue;
      }
      const [id, text] = item;
      const chars = Array.from(text); let offset = 0, index = 0;
      do {
        const remaining = chars.slice(offset).join('');
        const part = { id, index, text: remaining };
        if (fits(part)) { add(part); offset = chars.length; break; }
        if (document.parts.length) { finish(); continue; }
        let low = 0, high = chars.length - offset;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (fits({ id, index, text: chars.slice(offset, offset + mid).join('') })) low = mid;
          else high = mid - 1;
        }
        if (!low) throw new Error(`Video text metadata exceeds cache document size: ${id}`);
        add({ id, index: index++, text: chars.slice(offset, offset + low).join('') }); offset += low; finish();
      } while (offset < chars.length);
    }
    finish();
    const chunkDocIds = packed.map(document => {
      const id = `${MANIFEST_ID}__generation_${generation}_${documents.length}`;
      documents.push({ id, data: document }); return id;
    });
    return { chunkDocIds, chunkCount: packed.length, chunkHashes: packed.map(document => digest(document[field])) };
  }
  const metadataSet = pack(rows, 'metadata');
  const textSets = Object.fromEntries([...texts].map(([language, entries]) => {
    const descriptor = pack(entries, 'texts', language);
    const partCount = descriptor.chunkDocIds.reduce((total, id) => total + documents.find(document => document.id === id).data.partCount, 0);
    return [language, { ...descriptor, entryCount: entries.length, partCount, hash: digest(entries) }];
  }));
  return { rows, documents, metadataSet, textSets };
}

async function sourceSignature(db) {
  const [count, latest] = await Promise.all([
    db.collection('videosVideoModule').where('isPublished', '==', true).count().get(),
    db.collection('videosVideoModule').orderBy('updatedAt', 'desc').limit(1).select('updatedAt').get(),
  ]);
  const doc = latest.docs[0], stamp = doc?.data()?.updatedAt;
  return JSON.stringify([count.data().count, doc?.id || null, stamp?.seconds || 0, stamp?.nanoseconds || 0]);
}
async function rebuild(db, sortRows = rows => rows) {
  const buildRef = db.collection(COLLECTION).doc(BUILD_ID);
  const sequence = await db.runTransaction(async tx => {
    const snap = await tx.get(buildRef), value = (snap.data()?.sequence || 0) + 1;
    tx.set(buildRef, { sequence: value, requestedAt: new Date(), finishedAt: null, status: 'running', error: null }, { merge: true }); return value;
  });
  async function finish(status, error = null) {
    await db.runTransaction(async tx => {
      const snap = await tx.get(buildRef); if (snap.data()?.sequence !== sequence) return;
      tx.set(buildRef, { status, finishedAt: new Date(), error }, { merge: true });
    });
  }
  try {
    const result = await rebuildGeneration(db, sortRows, sequence);
    await finish('success').catch(error => console.warn('[video-cache] Status update failed', error.message)); return result;
  } catch (error) { await finish('error', 'Reconstruirea cache-ului video a eșuat.').catch(() => {}); throw error; }
}
async function rebuildGeneration(db, sortRows, sequence) {
  const manifestRef = db.collection(COLLECTION).doc(MANIFEST_ID);
  const signature = await sourceSignature(db);
  const source = await db.collection('videosVideoModule').where('isPublished', '==', true).get();
  const rows = [];
  source.forEach(doc => { if (!['_meta', '_publicCache'].includes(doc.id)) rows.push({ ...doc.data(), id: doc.id }); });
  const sorted = sortRows(rows), generation = randomUUID(), updatedAt = new Date();
  const prepared = prepareGeneration(sorted, generation, updatedAt);
  const manifest = { version: VERSION, generation, buildSequence: sequence, updatedAt, sourceSignature: signature,
    rowCount: sorted.length, ...prepared.metadataSet, textSets: prepared.textSets,
    featuredVideoIds: sorted.filter(row => row.featuredOnHome === true).map(row => row.id), idsHash: digestIds(sorted) };
  if (documentBytes(manifest) > MAX_BYTES) throw new Error('Video catalog manifest exceeds cache document size.');
  for (let offset = 0; offset < prepared.documents.length; offset += 4) {
    await Promise.all(prepared.documents.slice(offset, offset + 4).map(({ id, data }) => db.collection(COLLECTION).doc(id).set(data)));
  }
  const verified = await readSnapshot(db, manifest);
  if (!verified || verified.length !== sorted.length) throw new Error('New video catalog failed verification; previous catalog retained.');
  const sourceIds = new Set(verified.map(row => row.id));
  for (const language of Object.keys(manifest.textSets)) {
    const text = await readTexts(db, manifest, language);
    if (!text || [...text.keys()].some(id => !sourceIds.has(id))) throw new Error('New video texts failed verification; previous catalog retained.');
  }
  const active = await db.runTransaction(async tx => {
    const snap = await tx.get(manifestRef), current = snap.data();
    if ((current?.buildSequence || 0) > sequence) return current;
    if (current && validateManifestHeader(current)) {
      const { previousManifest, ...previous } = current;
      manifest.previousManifest = previous;
    }
    if (documentBytes(manifest) > MAX_BYTES) throw new Error('Video catalog manifest exceeds cache document size.');
    tx.set(manifestRef, manifest); return manifest;
  });
  const activeRows = active.generation === generation ? verified : await readSnapshot(db, active);
  if (!activeRows) throw new Error('Active video catalog is inconsistent.');
  return { rows: activeRows, manifest: active, published: active.generation === generation };
}
module.exports = { COLLECTION, MANIFEST_ID, BUILD_ID, VERSION, MAX_BYTES, ROOT_TEXT_KEY, documentBytes,
  digest, digestIds, allChunkIds, prepareGeneration, validateManifestHeader, validateManifestRows, validateTexts,
  readSnapshot, readTexts, sourceSignature, rebuild, prunableChunkIds };
