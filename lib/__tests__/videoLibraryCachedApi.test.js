jest.mock('../requireAuth', () => ({ getOptionalAuth: jest.fn() }));
jest.mock('../globalSettings', () => ({ isSubscriptionSystemEnabled: async () => true }));
jest.mock('../videoLibraryAccess', () => ({
  resolvePublicVideoLibraryPremiumActive: async () => false,
  resolveVideoLibraryPremiumAccessForUser: async () => ({ premiumActive: true, userDocExists: true, accessExplain: { hasAccess: true, reason: 'test_active' } }),
}));
jest.mock('../firebaseAdmin', () => ({ getAdminDb: jest.fn() }));
import handler from '../../pages/api/premium/video-library';
import { getOptionalAuth } from '../requireAuth';
import { getAdminDb } from '../firebaseAdmin';
import { clearPremiumVideoLibraryMemoryCache } from '../loadPremiumVideoLibrary';
import { createVideoCacheDb, videoRow, makeVideoRes } from '../../tests/helpers/videoCacheDb';
const { rebuild } = require('../videoLibraryMaterializedCache.cjs');

describe('complete cached catalog API', () => {
  let model;
  beforeEach(async () => {
    process.env.FIRESTORE_READ_TELEMETRY_ENABLED = 'false';
    clearPremiumVideoLibraryMemoryCache();
    // More than four real byte-sized chunks, not an artificial page limit.
    model = createVideoCacheDb(Array.from({ length: 60 }, (_, index) => videoRow(index, { description: 'x'.repeat(80000) })));
    getAdminDb.mockReturnValue(model.db);
    await rebuild(model.db);
    expect(model.caches.get('videoLibraryPublic').chunkCount).toBeGreaterThan(4);
    model.reads.length = 0;
  });
  afterEach(() => { delete process.env.FIRESTORE_READ_TELEMETRY_ENABLED; jest.restoreAllMocks(); });

  it.each([false, true])('matches every source ID and avoids repeated source reads (authenticated=%s)', async authenticated => {
    getOptionalAuth.mockResolvedValue(authenticated ? { uid: 'test-account' } : null);
    const req = { method: 'GET', headers: {}, query: { locale: 'ro', appPlatform: 'android' } };
    const res = makeVideoRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.videos.map(video => video.id).sort()).toEqual([...model.source.keys()].sort());
    expect(res.body.videos.every(video => video.canPlay === authenticated)).toBe(true);
    expect(res.body.cacheTtlSec).toBe(0); // HTTP responses are still personalized.
    expect(res.headers['Cache-Control']).toContain('no-store');
    const reads = model.reads.length;
    await handler(req, makeVideoRes());
    expect(model.reads).toHaveLength(reads);
    expect(model.reads.some(read => read.name === 'videosVideoModule' && read.kind === 'query' && !read.order)).toBe(false);
  });

  it('paginates through all category IDs, including the last chunk', async () => {
    getOptionalAuth.mockResolvedValue({ uid: 'test-account' });
    const ids = [];
    let cursor;
    do {
      const res = makeVideoRes();
      await handler({ method: 'GET', headers: {}, query: { locale: 'ro', categorySlug: 'tarot', limit: '7', ...(cursor ? { cursor } : {}) } }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.totalCount).toBe(60);
      ids.push(...res.body.videos.map(video => video.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(ids.sort()).toEqual([...model.source.keys()].sort());
    expect(new Set(ids).size).toBe(60);
  });

  it('a separate reader detects a dashboard generation after 30 seconds', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
    getOptionalAuth.mockResolvedValue(null);
    const req = { method: 'GET', headers: {}, query: { locale: 'ro' } };
    await handler(req, makeVideoRes());
    model.source.set('v60', videoRow(60));
    await rebuild(model.db); // Another dashboard/server instance, no local invalidation.
    const readsAfterDashboard = model.reads.length;
    const before = makeVideoRes();
    await handler(req, before);
    expect(before.body.videos).toHaveLength(60);
    clock.mockReturnValue(1800000030001);
    const after = makeVideoRes();
    await handler(req, after);
    expect(after.body.videos.map(video => video.id).sort()).toEqual([...model.source.keys()].sort());
    expect(model.reads.slice(readsAfterDashboard).some(read => read.name === 'videosVideoModule' && read.kind === 'query' && !read.order)).toBe(false);
  });

  it('recomputes scheduled visibility, locale and web playback on cached rows', async () => {
    const now = 1800000000000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    model.source.set('scheduled', videoRow(70, {
      id: 'scheduled', isPremium: false, publishAt: new Date(now + 1000).toISOString(),
      locales: { en: { title: 'English scheduled', videoUrl: 'https://youtu.be/english' } },
    }));
    await rebuild(model.db);
    clearPremiumVideoLibraryMemoryCache();
    getOptionalAuth.mockResolvedValue(null);
    const call = async query => {
      const res = makeVideoRes();
      await handler({ method: 'GET', headers: {}, query }, res);
      expect(res.statusCode).toBe(200);
      return res.body.videos;
    };
    expect((await call({ locale: 'en' })).some(video => video.id === 'scheduled')).toBe(false);
    const readCount = model.reads.length;
    clock.mockReturnValue(now + 2000); // Still inside the same cache window.
    const mobile = (await call({ locale: 'en' })).find(video => video.id === 'scheduled');
    expect(mobile).toMatchObject({ title: 'English scheduled', canPlay: true });
    const web = (await call({ locale: 'en', client: 'web' })).find(video => video.id === 'scheduled');
    expect(web).toMatchObject({ title: 'English scheduled', canPlay: false, lockedReason: 'app_only', videoUrl: null });
    expect(model.reads).toHaveLength(readCount);
  });

  it('a failed refresh keeps the last complete catalog', async () => {
    const now = 1800000000000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    getOptionalAuth.mockResolvedValue(null);
    const req = { method: 'GET', headers: {}, query: { locale: 'ro' } };
    const first = makeVideoRes();
    await handler(req, first);
    getAdminDb.mockReturnValue({ collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) });
    clock.mockReturnValue(now + 30001);
    const after = makeVideoRes();
    await handler(req, after);
    expect(after.statusCode).toBe(200);
    expect(after.body.videos.map(video => video.id)).toEqual(first.body.videos.map(video => video.id));
  });
});
