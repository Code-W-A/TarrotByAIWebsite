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
import { createVideo, updateVideo, deleteVideo, togglePublish, rebuildPublicVideoLibraryCache, VideoCacheRefreshError } from '../../src/features/video-library-admin/services/videos.service';

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'offline' }) }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

it.each([
  ['create', () => createVideo({ title: 'New', order: 1, isPublished: false }), addDoc],
  ['edit', () => updateVideo('v1', { title: 'Edited' }), updateDoc],
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
