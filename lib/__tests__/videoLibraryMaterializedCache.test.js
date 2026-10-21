const { validateManifestRows, digestIds, rebuild } = require('../videoLibraryMaterializedCache.cjs');
import { createVideoCacheDb, videoRow } from '../../tests/helpers/videoCacheDb';
const rows = [{ id: 'one', isPublished: true }, { id: 'two', isPublished: true }];
const { prepareGeneration, digest, MANIFEST_ID, BUILD_ID, MAX_BYTES, documentBytes, readSnapshot, readTexts } = require('../videoLibraryMaterializedCache.cjs');
const prepared = prepareGeneration(rows, 'test', new Date(0));
const manifest = { version: 3, generation: 'test', rowCount: 2, ...prepared.metadataSet,
  featuredVideoIds: ['two'], idsHash: digestIds(rows), textSets: prepared.textSets };
const chunk = prepared.documents.find(document => document.data.kind === 'metadata').data;
describe('materialized video catalog integrity', () => {
  test('accepts a complete verified generation', () => expect(validateManifestRows(manifest, [chunk])).toEqual(rows));
  test('rejects missing chunks', () => expect(validateManifestRows(manifest, [])).toBeNull());
  test('rejects truncated rows', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: rows.slice(0, 1) }])).toBeNull());
  test('rejects duplicate video ids', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], rows[0]] }])).toBeNull());
  test('rejects mixed generations', () => expect(validateManifestRows(manifest, [{ ...chunk, generation: 'old' }])).toBeNull());
  test('rejects changed ids even with matching counts', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], { id: 'other', isPublished: true }] }])).toBeNull());
  test('rejects unpublished rows', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], { ...rows[1], isPublished: false }] }])).toBeNull());
  test('rejects featured ids absent from catalog', () => expect(validateManifestRows({ ...manifest, featuredVideoIds: ['absent'] }, [chunk])).toBeNull());
  test('accepts a valid empty catalog', () => expect(validateManifestRows({ ...manifest, rowCount: 0, chunkCount: 0, chunkDocIds: [], chunkHashes: [], idsHash: digestIds([]), featuredVideoIds: [] }, [])).toEqual([]));
  test('a chunk write failure never publishes a new manifest', async () => {
    const writes = [];
    const db = {
      runTransaction: async cb => cb({ get: async () => ({ data: () => undefined }), set: (ref, data) => writes.push({ id: ref.id, data }) }),
      collection: () => ({
        doc: id => ({ id, set: async () => { throw new Error('write failed'); } }),
        where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: 2 }) }) }),
          get: async () => ({ forEach: cb => rows.forEach(row => cb({ id: row.id, data: () => row })) }) }),
        orderBy: () => ({ limit: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }) }),
      }),
    };
    await expect(rebuild(db)).rejects.toThrow('write failed');
    expect(writes.map(write => write.id)).toEqual(['videoLibraryPublicV3Build']);
  });
});

describe('dashboard generations', () => {
  test('create, edit, hide, republish and delete produce the exact published catalog', async () => {
    const model = createVideoCacheDb([videoRow(1), videoRow(2, { isPublished: false })]);
    const verify = async (ids) => {
      const result = await rebuild(model.db);
      expect(result.rows.map(row => row.id).sort()).toEqual(ids.sort());
      expect(result.manifest.rowCount).toBe(ids.length);
      expect(model.caches.get('videoLibraryPublicV3Build').status).toBe('success');
      return result;
    };
    await verify(['v1']);
    model.source.set('v3', videoRow(3));
    await verify(['v1', 'v3']);
    model.source.set('v1', videoRow(1, { title: 'Edited' }));
    expect((await verify(['v1', 'v3'])).rows.find(row => row.id === 'v1').title).toBe('Edited');
    model.source.set('v1', videoRow(1, { isPublished: false }));
    await verify(['v3']);
    model.source.set('v1', videoRow(1));
    await verify(['v1', 'v3']);
    model.source.delete('v3');
    await verify(['v1']);
    model.source.delete('v1');
    await verify([]);
  });

  test('failure retains the active generation and records a retryable error', async () => {
    const model = createVideoCacheDb([videoRow(1)]);
    await rebuild(model.db);
    const active = model.caches.get('videoLibraryPublicV3');
    model.source.set('v2', videoRow(2));
    model.onChunkWrite(async () => { throw new Error('unavailable'); });
    await expect(rebuild(model.db)).rejects.toThrow('unavailable');
    expect(model.caches.get('videoLibraryPublicV3')).toBe(active);
    expect(model.caches.get('videoLibraryPublicV3Build').status).toBe('error');
    model.onChunkWrite(null);
    expect((await rebuild(model.db)).rows.map(row => row.id).sort()).toEqual(['v1', 'v2']);
  });

  test('a slow older rebuild cannot replace a newer publication or its status', async () => {
    const model = createVideoCacheDb([videoRow(1)]);
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const paused = new Promise(resolve => { release = resolve; });
    model.onChunkWrite(async () => { started(); await paused; });
    const older = rebuild(model.db);
    await ready;
    model.onChunkWrite(null);
    model.source.set('v2', videoRow(2));
    const newer = await rebuild(model.db);
    release();
    const result = await older;
    expect(result.published).toBe(false);
    expect(result.manifest.generation).toBe(newer.manifest.generation);
    expect(result.rows.map(row => row.id).sort()).toEqual(['v1', 'v2']);
    expect(model.caches.get('videoLibraryPublicV3Build')).toMatchObject({ sequence: 2, status: 'success' });
  });
});

describe('v3 separated multilingual texts', () => {
  const description = ('Bună! Îți mulțumesc 👨‍👩‍👧‍👦.\n\n"Alineat" \\ final! ').repeat(600);
  const languages = ['ro', 'en', 'fr', 'de', 'es', 'ru', 'ar', 'bg', 'bs', 'cs', 'el', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'mn', 'pl', 'pt', 'sk', 'sq', 'sr', 'tr', 'zh'];
  const large = videoRow(723, { description, locales: Object.fromEntries(languages.map(language => [language, { title: `${language} title`, description: `${language}\n${description}`, videoUrl: 'https://youtu.be/abc123' }])) });

  test('round-trips a video above the old row limit in all 27 languages without changing the source', async () => {
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(MAX_BYTES);
    const original = JSON.stringify(large);
    const model = createVideoCacheDb([large]);
    model.caches.set('videoLibraryPublic', { version: 2, preserved: true });
    const result = await rebuild(model.db);
    const metadata = await readSnapshot(model.db, result.manifest);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].description).toBeUndefined();
    expect(Object.values(metadata[0].locales).every(entry => !Object.hasOwn(entry, 'description'))).toBe(true);
    expect((await readTexts(model.db, result.manifest, 'root')).get(large.id)).toBe(description);
    for (const language of languages) {
      expect((await readTexts(model.db, result.manifest, `locale:${language}`)).get(large.id)).toBe(large.locales[language].description);
    }
    for (const id of require('../videoLibraryMaterializedCache.cjs').allChunkIds(result.manifest)) {
      expect(documentBytes(model.caches.get(id))).toBeLessThanOrEqual(MAX_BYTES);
    }
    expect(JSON.stringify(large)).toBe(original);
    expect(model.caches.get('videoLibraryPublic')).toEqual({ version: 2, preserved: true });
  });

  test('fragments a single escaped Unicode string and preserves empty versus missing descriptions', async () => {
    const text = ('😀\u0306"\\\n').repeat(200000);
    const row = videoRow(1, { description: text, locales: { en: { description: '' }, fr: { title: 'Sans description' } } });
    const model = createVideoCacheDb([row]);
    const { manifest } = await rebuild(model.db);
    expect(manifest.textSets.root.partCount).toBeGreaterThan(1);
    expect((await readTexts(model.db, manifest, 'root')).get(row.id)).toBe(text);
    expect((await readTexts(model.db, manifest, 'locale:en')).get(row.id)).toBe('');
    expect((await readTexts(model.db, manifest, 'locale:fr')).has(row.id)).toBe(false);
    for (const id of manifest.textSets.root.chunkDocIds) {
      const parts = model.caches.get(id).parts;
      expect(documentBytes(model.caches.get(id))).toBeLessThanOrEqual(MAX_BYTES);
      for (const part of parts) expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });

  test.each(['missing', 'corrupt', 'mixed'])('rejects %s text chunks before publication', async failure => {
    const model = createVideoCacheDb([videoRow(1, { description: 'old' })]);
    await rebuild(model.db);
    const active = model.caches.get(MANIFEST_ID);
    model.source.set('v2', videoRow(2, { description: 'new' }));
    model.onChunkWrite(async (id, data) => {
      if (data.kind === 'texts') {
        if (failure === 'missing') { data.parts = []; data.partCount = 0; }
        if (failure === 'corrupt') data.parts[0].text = 'changed';
        if (failure === 'mixed') data.generation = 'older';
      }
    });
    await expect(rebuild(model.db)).rejects.toThrow('texts failed verification');
    expect(model.caches.get(MANIFEST_ID)).toBe(active);
    expect(model.caches.get(BUILD_ID).status).toBe('error');
  });

  test('text write failures preserve the complete active generation', async () => {
    const model = createVideoCacheDb([videoRow(1, { description: 'original' })]);
    await rebuild(model.db);
    const active = model.caches.get(MANIFEST_ID);
    model.onChunkWrite(async (_id, data) => { if (data.kind === 'texts') throw new Error('text write failed'); });
    await expect(rebuild(model.db)).rejects.toThrow('text write failed');
    expect(model.caches.get(MANIFEST_ID)).toBe(active);
    expect((await readTexts(model.db, active, 'root')).get('v1')).toBe('original');
  });

  test('hashes survive Firestore map ordering and Date to Timestamp conversion', () => {
    const { Timestamp } = require('firebase-admin/firestore');
    expect(digest({ b: 2, a: { z: 3, c: new Date(1001) } })).toBe(digest({ a: { c: Timestamp.fromMillis(1001), z: 3 }, b: 2 }));
  });

  test('cleanup protects metadata and text chunks of both current and previous generations and leaves v2 alone', async () => {
    const { allChunkIds, prunableChunkIds } = require('../videoLibraryMaterializedCache.cjs');
    const model = createVideoCacheDb([videoRow(1, { description: 'root', locales: { en: { description: 'English' } } })]);
    const first = await rebuild(model.db);
    const second = await rebuild(model.db);
    const third = await rebuild(model.db);
    const candidates = [...model.caches.keys(), 'videoLibraryPublic__generation_old_0', 'unrelated'];
    expect(prunableChunkIds(third.manifest, candidates).sort()).toEqual(allChunkIds(first.manifest).sort());
    expect(allChunkIds(third.manifest.previousManifest).sort()).toEqual(allChunkIds(second.manifest).sort());
    expect(third.manifest.previousManifest.previousManifest).toBeUndefined();
    expect(() => prunableChunkIds(null, candidates)).toThrow('refusing cleanup');
  });
});
