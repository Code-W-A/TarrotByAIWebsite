const { validateManifestRows, digestIds, rebuild } = require('../videoLibraryMaterializedCache.cjs');
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
