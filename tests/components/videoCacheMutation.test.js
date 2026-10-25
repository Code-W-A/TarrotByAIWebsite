/** @jest-environment jsdom */
jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: jest.fn(), doc: jest.fn(),
  addDoc: jest.fn(async () => ({ id: 'new-video' })),
  updateDoc: jest.fn(async () => {}), deleteDoc: jest.fn(async () => {}),
  getDoc: jest.fn(async () => ({ exists: () => true, data: () => ({ isPublished: false }) })),
}));
import { addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createVideo, updateVideo, deleteVideo, togglePublish, loadVideoForEdit, rebuildPublicVideoLibraryCache, VideoCacheRefreshError } from '../../src/features/video-library-admin/services/videos.service';

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'offline' }) }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

it.each([
  ['delete', () => deleteVideo('v1'), deleteDoc],
  ['publish', () => togglePublish('v1', true), updateDoc],
])('%s exposes a saved mutation/cache failure and retries only the cache', async (_action, mutate, write) => {
  await expect(mutate()).rejects.toBeInstanceOf(VideoCacheRefreshError);
  expect(write).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue({ ok: true });
  await rebuildPublicVideoLibraryCache();
  expect(write).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url, options]) => url.endsWith('/rebuild') && options.method === 'POST')).toBe(true);
});

it.each([
  ['create', () => createVideo({ title: 'New', mutationId: 'operation-00000001' })],
  ['edit', () => updateVideo('v1', { title: 'Edited', mutationId: 'operation-00000002', editRevision: '1:0' })],
])('%s uses the protected API and exposes committed saves with cache warnings', async (_action, mutate) => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'v1', cacheWarning: 'Saved, cache failed' }) });
  await expect(mutate()).rejects.toBeInstanceOf(VideoCacheRefreshError);
  expect(addDoc).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0][0]).toBe('/api/admin/videos');
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.mutationId).toMatch(/^operation-/);
  expect(body.input).not.toHaveProperty('mutationId');
  fetch.mockResolvedValue({ ok: true });
  await rebuildPublicVideoLibraryCache();
  expect(fetch.mock.calls[1][0]).toContain('/rebuild');
});

it('restores serialized Firestore timestamps before reopening the editor', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ video: { id: 'v1', title: 'Title', description: 'Full Sanity text', editRevision: 'revision',
    publishAt: { _seconds: 1800000000, _nanoseconds: 123000000 }, createdAt: { seconds: 1700000000, nanoseconds: 0 } } }) });
  const video = await loadVideoForEdit('v1');
  expect(video.publishAt.toMillis()).toBe(1800000000123);
  expect(video.createdAt.toDate()).toBeInstanceOf(Date);
  expect(video.description).toBe('Full Sanity text');
});
