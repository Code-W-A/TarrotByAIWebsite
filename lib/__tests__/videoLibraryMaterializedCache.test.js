const { validateManifestRows, digestIds, rebuild } = require('../videoLibraryMaterializedCache.cjs');
import { createVideoCacheDb, videoRow } from '../../tests/helpers/videoCacheDb';
const rows = [{ id: 'one', isPublished: true }, { id: 'two', isPublished: true }];
const manifest = { version: 2, generation: 'test', rowCount: 2, chunkCount: 1,
  chunkDocIds: ['videoLibraryPublic__generation_test_0'], featuredVideoIds: ['two'], idsHash: digestIds(rows) };
const chunk = { version: 2, generation: 'test', index: 0, rowCount: 2, rows };
describe('materialized video catalog integrity', () => {
  test('accepts a complete verified generation', () => expect(validateManifestRows(manifest, [chunk])).toEqual(rows));
  test('rejects missing chunks', () => expect(validateManifestRows(manifest, [])).toBeNull());
  test('rejects truncated rows', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: rows.slice(0, 1) }])).toBeNull());
  test('rejects duplicate video ids', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], rows[0]] }])).toBeNull());
  test('rejects mixed generations', () => expect(validateManifestRows(manifest, [{ ...chunk, generation: 'old' }])).toBeNull());
  test('rejects changed ids even with matching counts', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], { id: 'other', isPublished: true }] }])).toBeNull());
  test('rejects unpublished rows', () => expect(validateManifestRows(manifest, [{ ...chunk, rows: [rows[0], { ...rows[1], isPublished: false }] }])).toBeNull());
  test('rejects featured ids absent from catalog', () => expect(validateManifestRows({ ...manifest, featuredVideoIds: ['absent'] }, [chunk])).toBeNull());
  test('accepts a valid empty catalog', () => expect(validateManifestRows({ version: 2, rowCount: 0, chunkCount: 0, chunkDocIds: [], featuredVideoIds: [] }, [])).toEqual([]));
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
    expect(writes.map(write => write.id)).toEqual(['videoLibraryPublicBuild']);
  });
});

describe('dashboard generations', () => {
  test('create, edit, hide, republish and delete produce the exact published catalog', async () => {
    const model = createVideoCacheDb([videoRow(1), videoRow(2, { isPublished: false })]);
    const verify = async (ids) => {
      const result = await rebuild(model.db);
      expect(result.rows.map(row => row.id).sort()).toEqual(ids.sort());
      expect(result.manifest.rowCount).toBe(ids.length);
      expect(model.caches.get('videoLibraryPublicBuild').status).toBe('success');
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
    const active = model.caches.get('videoLibraryPublic');
    model.source.set('v2', videoRow(2));
    model.onChunkWrite(async () => { throw new Error('unavailable'); });
    await expect(rebuild(model.db)).rejects.toThrow('unavailable');
    expect(model.caches.get('videoLibraryPublic')).toBe(active);
    expect(model.caches.get('videoLibraryPublicBuild').status).toBe('error');
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
    expect(model.caches.get('videoLibraryPublicBuild')).toMatchObject({ sequence: 2, status: 'success' });
  });
});
