// Server only. Immutable Sanity versions let Firestore atomically select a complete text set.
const { createHash } = require('node:crypto');
const memo = new Map();
let privacy = { key: '', until: 0 };
const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const hasSanity = storage => storage?.root === 'sanity' || Object.values(storage?.locales || {}).includes('sanity');

function config(write = false) {
  const project = process.env.SANITY_PROJECT_ID, dataset = process.env.SANITY_DATASET;
  const token = process.env[write ? 'SANITY_WRITE_TOKEN' : 'SANITY_READ_TOKEN'];
  if (!/^[a-z0-9-]+$/.test(project || '') || !/^[a-z0-9_-]+$/.test(dataset || '') || !token) {
    throw fail(`Lipsește configurarea Sanity pentru ${write ? 'scriere' : 'citire'}.`, 503);
  }
  return { base: `https://${project}.api.sanity.io/v2026-10-01`, dataset, token };
}
async function request(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); }
  catch { throw fail('Sanity nu este disponibil. Textele nu au fost înlocuite.'); }
  if (!response.ok) throw fail(`Sanity a respins operația (HTTP ${response.status}).`);
  return response.json();
}
async function assertPrivate() {
  const c = config(), key = `${c.base}/${c.dataset}`;
  if (privacy.key === key && privacy.until > Date.now()) return;
  const datasets = await request(`${c.base}/datasets`, { headers: { Authorization: `Bearer ${c.token}` } });
  if (!Array.isArray(datasets) || datasets.find(d => d.name === c.dataset)?.aclMode !== 'private') {
    throw fail('Descrierile video necesită un dataset Sanity privat.', 503);
  }
  privacy = { key, until: Date.now() + 60000 };
}
function prepareDescriptions(row) {
  const source = row.descriptionStorage || {};
  if (source.version != null && source.version !== 1) throw fail('Versiune de stocare necunoscută.', 400);
  const choose = value => {
    if (value == null) return 'firebase';
    if (!['firebase', 'sanity'].includes(value)) throw fail('Sursa descrierii este invalidă.', 400);
    return value;
  };
  const storage = { version: 1, root: choose(source.root), locales: {}, sanityId: null };
  const external = { root: null, locales: {} };
  const fields = { ...row, locales: { ...(row.locales || {}) } };
  delete fields.descriptionStorage;
  if (storage.root === 'sanity') { external.root = row.description ?? null; delete fields.description; }
  for (const locale of Object.keys(row.locales || {}).sort()) {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(locale)) throw fail('Limba descrierii este invalidă.', 400);
    storage.locales[locale] = choose(source.locales?.[locale]);
    fields.locales[locale] = { ...row.locales[locale] };
    if (storage.locales[locale] === 'sanity') {
      if (Object.hasOwn(row.locales[locale], 'description')) external.locales[locale] = row.locales[locale].description;
      delete fields.locales[locale].description;
    }
  }
  if ([external.root, ...Object.values(external.locales)].some(v => v !== null && typeof v !== 'string')) {
    throw fail('Descrierile trebuie să fie texte.', 400);
  }
  return { fields, storage, external };
}
function makeDocument(videoId, external) {
  const texts = { root: external.root, locales: Object.fromEntries(Object.entries(external.locales).sort(([a], [b]) => a.localeCompare(b))) };
  const hash = createHash('sha256').update(JSON.stringify({ videoId, ...texts })).digest('hex');
  return { _id: `video-description-${hash}`, _type: 'videoDescriptionVersion', videoId, ...texts };
}
async function writeDescriptions(document) {
  const c = config(true);
  const body = JSON.stringify({ mutations: [{ createIfNotExists: document }] });
  if (Buffer.byteLength(body) >= 4000000) throw fail('Descrierile depășesc limita cererii Sanity de 4 MB. Nu au fost scurtate.', 413);
  await assertPrivate();
  await request(`${c.base}/data/mutate/${c.dataset}?visibility=sync`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body,
  });
  // Use the persisted version on reads; never put uncommitted client input into the read cache.
}
async function loadDocuments(ids) {
  if (!ids.length) return new Map();
  const c = config(), prefix = `${c.base}/${c.dataset}/`;
  const found = new Map(ids.filter(id => memo.has(prefix + id)).map(id => [id, memo.get(prefix + id)]));
  const missing = ids.filter(id => !memo.has(prefix + id));
  if (!missing.length) return found;
  await assertPrivate();
  for (let offset = 0; offset < missing.length; offset += 20) {
    const batch = missing.slice(offset, offset + 20);
    const data = await request(`${c.base}/data/query/${c.dataset}?perspective=published`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '*[_type == "videoDescriptionVersion" && _id in $ids]', params: { ids: batch } }),
    });
    const documents = new Map((data.result || []).map(d => [d._id, d]));
    for (const id of batch) {
      if (!documents.has(id)) throw fail('Versiunea descrierii Sanity lipsește.');
      const d = documents.get(id);
      if (!d.locales || typeof d.locales !== 'object' || Array.isArray(d.locales) ||
          !Object.values(d.locales).every(text => typeof text === 'string') ||
          !(d.root === null || typeof d.root === 'string') ||
          makeDocument(d.videoId, { root: d.root, locales: d.locales })._id !== id) {
        throw fail('Conținutul versiunii Sanity a fost modificat în afara dashboardului.');
      }
      memo.set(prefix + id, d);
      found.set(id, d);
    }
    // Bound warm-function memory; Firestore's durable catalog remains the primary cache.
    while (memo.size > 24) memo.delete(memo.keys().next().value);
  }
  // An entire catalog can exceed the memo bound, so keep this call's results separately.
  return found;
}
async function resolveDescriptions(rows) {
  const ids = [...new Set(rows.filter(r => hasSanity(r.descriptionStorage)).map(r => r.descriptionStorage.sanityId))];
  if (ids.some(id => !/^video-description-[a-f0-9]{64}$/.test(id || ''))) throw fail('Referința descrierii Sanity este invalidă.');
  // Resolve bounded batches so catalogs larger than the memory cache remain complete.
  const documents = new Map();
  for (let i = 0; i < ids.length; i += 20) for (const [id, d] of await loadDocuments(ids.slice(i, i + 20))) documents.set(id, d);
  return rows.map(row => {
    const storage = row.descriptionStorage;
    if (!hasSanity(storage)) return row;
    const d = documents.get(storage.sanityId);
    if (!d || d.videoId !== row.id || d._type !== 'videoDescriptionVersion' || storage.version !== 1) throw fail('Versiunea Sanity nu aparține videoclipului.');
    if (!d.locales || makeDocument(d.videoId, { root: d.root, locales: d.locales })._id !== d._id) throw fail('Conținutul versiunii Sanity a fost modificat în afara dashboardului.');
    const requireText = text => { if (typeof text !== 'string') throw fail('Descrierea Sanity este incompletă.'); return text; };
    const result = { ...row, locales: { ...row.locales } };
    if (storage.root === 'sanity') {
      if (d.root === null) delete result.description;
      else result.description = requireText(d.root);
    }
    for (const [locale, source] of Object.entries(storage.locales || {})) {
      if (source === 'sanity') {
        result.locales[locale] = { ...result.locales[locale] };
        if (Object.hasOwn(d.locales, locale)) result.locales[locale].description = requireText(d.locales[locale]);
        else delete result.locales[locale].description;
      }
    }
    return result;
  });
}
function clearDescriptionMemoryCache() { memo.clear(); privacy = { key: '', until: 0 }; }
module.exports = { hasSanity, prepareDescriptions, makeDocument, writeDescriptions, resolveDescriptions, clearDescriptionMemoryCache };
