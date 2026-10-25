const storage = require('../videoDescriptionStorage.cjs');
const { prepareDescriptions, makeDocument, writeDescriptions, resolveDescriptions, clearDescriptionMemoryCache } = storage;
const functionStorage = require('../../../expo-mobile-app/functions/lib/videoDescriptionStorage.cjs');
const { resolveVideoNotificationCopy } = require('../../../expo-mobile-app/functions/lib/videoNotificationCopy');
import { mapVideoRowToPublicDto } from '../videoLibraryPublicMapper';
import { videoRow } from '../../tests/helpers/videoCacheDb';

let documents, calls;
const previousEnv = { ...process.env };
beforeEach(() => {
  clearDescriptionMemoryCache(); functionStorage.clearDescriptionMemoryCache(); documents = new Map(); calls = [];
  Object.assign(process.env, { SANITY_PROJECT_ID: 'test-project', SANITY_DATASET: 'private', SANITY_READ_TOKEN: 'test-read', SANITY_WRITE_TOKEN: 'test-write' });
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/datasets')) return { ok: true, json: async () => [{ name: 'private', aclMode: 'private' }] };
    if (url.includes('/mutate/')) {
      const d = body.mutations[0].createIfNotExists;
      if (!documents.has(d._id)) documents.set(d._id, d);
      return { ok: true, json: async () => ({}) };
    }
    expect(url).toContain('?perspective=published');
    expect(body).not.toHaveProperty('perspective');
    return { ok: true, json: async () => ({ result: body.params.ids.flatMap(id => documents.has(id) ? [documents.get(id)] : []) }) };
  });
});
afterEach(() => { process.env = { ...previousEnv }; delete global.fetch; });
async function externalize(row, source) {
  const prepared = prepareDescriptions({ ...row, descriptionStorage: source });
  const document = makeDocument(row.id, prepared.external);
  await writeDescriptions(document);
  return { ...prepared.fields, descriptionStorage: { ...prepared.storage, sanityId: document._id } };
}
it('reads legacy data without contacting Sanity', async () => {
  delete process.env.SANITY_PROJECT_ID;
  const row = videoRow(1, { description: 'legacy' });
  expect(await resolveDescriptions([row])).toEqual([row]);
  expect(fetch).not.toHaveBeenCalled();
});
it('preserves the difference between missing text and explicitly empty text', async () => {
  const row = videoRow(1, { description: 'Root fallback', locales: { en: { title: 'Missing' }, fr: { title: 'Empty', description: '' } } });
  const stored = await externalize(row, { root: 'sanity', locales: { en: 'sanity', fr: 'sanity' } });
  const [resolved] = await resolveDescriptions([stored]);
  expect(resolved.locales.en).not.toHaveProperty('description');
  expect(resolved.locales.fr.description).toBe('');
  for (const locale of ['en', 'fr']) expect(mapVideoRowToPublicDto(resolved, { locale, premiumActive: true })).toEqual(mapVideoRowToPublicDto(row, { locale, premiumActive: true }));
});
it('round trips mixed sources and produces deeply identical public DTOs for every access/client/locale', async () => {
  const original = videoRow(1, { description: 'RO 🌍\n\nFull root', locales: {
    ro: { title: 'Română', description: 'Română originală' },
    en: { title: 'English', description: 'Complete English\nEND', videoUrl: 'https://youtu.be/abc123' },
    fr: { title: 'Vide', description: '' },
  } });
  const stored = await externalize(original, { root: 'sanity', locales: { ro: 'firebase', en: 'sanity', fr: 'sanity' } });
  expect(stored).not.toHaveProperty('description');
  expect(stored.locales.en).not.toHaveProperty('description');
  expect(stored.locales.ro.description).toBe(original.locales.ro.description);
  const [resolved] = await resolveDescriptions([stored]);
  for (const locale of ['ro', 'en', 'fr', 'de']) for (const premiumActive of [false, true]) for (const webClient of [false, true]) {
    const context = { locale, premiumActive, webClient };
    expect(mapVideoRowToPublicDto(resolved, context)).toEqual(mapVideoRowToPublicDto(original, context));
  }
  expect(resolved.locales.fr.description).toBe('');
  const requests = fetch.mock.calls.length;
  await resolveDescriptions([stored]);
  expect(fetch).toHaveBeenCalledTimes(requests);
});
it('preserves more than 1 MiB of exact Unicode text without extra Firestore documents', async () => {
  const text = 'Română 👨‍👩‍👧‍👦\n'.repeat(10000);
  const row = videoRow(1, { description: text, locales: Object.fromEntries(['ro', 'en', 'fr', 'de'].map(lc => [lc, { title: lc, description: text + lc }])) });
  const stored = await externalize(row, { root: 'sanity', locales: Object.fromEntries(Object.keys(row.locales).map(lc => [lc, 'sanity'])) });
  expect(Buffer.byteLength(JSON.stringify(row))).toBeGreaterThan(1048576);
  expect((await resolveDescriptions([stored]))[0]).toMatchObject(row);
  expect(documents.size).toBe(1);
});
it('reconstructs the same notification copy in the separately deployed Functions backend', async () => {
  const row = videoRow(1, { description: 'Original notification root', locales: {
    ro: { title: 'Română', description: 'Corp română' }, en: { title: 'English', description: 'English body' },
  } });
  const stored = await externalize(row, { root: 'sanity', locales: { ro: 'firebase', en: 'sanity' } });
  const [complete] = await functionStorage.resolveDescriptions([stored]);
  for (const language of ['ro', 'en', 'de']) expect(resolveVideoNotificationCopy(complete, language)).toEqual(resolveVideoNotificationCopy(row, language));
});
it('serves a verified immutable version from memory during a Sanity outage', async () => {
  const stored = await externalize(videoRow(1, { description: 'Verified root' }), { root: 'sanity' });
  await resolveDescriptions([stored]);
  const requests = fetch.mock.calls.length;
  const now = Date.now(); const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 120000);
  fetch.mockRejectedValue(new Error('Sanity offline'));
  try {
    expect((await resolveDescriptions([stored]))[0].description).toBe('Verified root');
    expect(fetch).toHaveBeenCalledTimes(requests);
  } finally { clock.mockRestore(); }
});
it('resolves a catalog larger than its bounded memo and batches queries', async () => {
  const rows = [];
  for (let n = 0; n < 65; n++) rows.push(await externalize(videoRow(n, { description: `Text ${n}` }), { root: 'sanity' }));
  clearDescriptionMemoryCache(); calls.length = 0;
  const resolved = await resolveDescriptions(rows);
  expect(resolved.map(r => r.description)).toEqual(rows.map((_, n) => `Text ${n}`));
  expect(calls.filter(url => url.includes('/query/'))).toHaveLength(4);
});
it('rejects missing, changed or cross-video versions instead of silently returning an old Firebase value', async () => {
  const stored = await externalize(videoRow(1, { description: 'Correct' }), { root: 'sanity' });
  const d = documents.get(stored.descriptionStorage.sanityId);
  documents.set(d._id, { ...d, root: 'Changed outside dashboard' });
  await expect(resolveDescriptions([stored])).rejects.toThrow('modificat');
  documents.delete(d._id);
  await expect(resolveDescriptions([stored])).rejects.toThrow('lipsește');
  documents.set(d._id, d);
  await expect(resolveDescriptions([{ ...stored, id: 'someone-else' }])).rejects.toThrow('aparține');
});
it('rejects oversized Sanity writes and non-private datasets without mutating data', async () => {
  await expect(writeDescriptions(makeDocument('v1', { root: 'x'.repeat(4000000), locales: {} }))).rejects.toMatchObject({ statusCode: 413 });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValue({ ok: true, json: async () => [{ name: 'private', aclMode: 'public' }] });
  await expect(writeDescriptions(makeDocument('v1', { root: '', locales: {} }))).rejects.toMatchObject({ statusCode: 503 });
  expect(documents.size).toBe(0);
});
