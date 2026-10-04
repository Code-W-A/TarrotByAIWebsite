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

describe('uncached mobile catalog API', () => {
  beforeEach(() => { process.env.FIRESTORE_READ_TELEMETRY_ENABLED = 'false'; });
  afterEach(() => { delete process.env.FIRESTORE_READ_TELEMETRY_ENABLED; });
  it.each([false, true])('serves the complete source without HTTP or materialized cache (authenticated=%s)', async authenticated => {
    getOptionalAuth.mockResolvedValue(authenticated ? { uid: 'test-account' } : null);
    const rows = Array.from({ length: 60 }, (_, index) => ({ id: `v${index}`, isPublished: true, isPremium: true, category: 'Tarot', platform: 'youtube', videoUrl: 'https://youtu.be/abc123' }));
    const get = jest.fn(async () => ({ forEach: fn => rows.forEach(row => fn({ id: row.id, data: () => row })), size: rows.length }));
    const where = jest.fn(() => ({ get }));
    const collection = jest.fn(() => ({ where }));
    getAdminDb.mockReturnValue({ collection });
    const headers = {}; let payload; let code;
    const res = { setHeader: (key, value) => { headers[key] = value; }, status: value => { code = value; return res; }, json: value => { payload = value; return res; } };
    await handler({ method: 'GET', headers: authenticated ? { authorization: 'Bearer test' } : {}, query: { locale: 'ro', appPlatform: 'android' } }, res);
    expect(code).toBe(200);
    expect(payload.videos).toHaveLength(60);
    expect(payload.loggedIn).toBe(authenticated);
    expect(payload.premiumActive).toBe(authenticated);
    expect(payload.videos.every(video => video.canPlay === authenticated)).toBe(true);
    expect(payload.cacheTtlSec).toBe(0);
    expect(headers['Cache-Control']).toContain('no-store');
    expect(headers['CDN-Cache-Control']).toBe('no-store');
    expect(headers['Vercel-CDN-Cache-Control']).toBe('no-store');
    expect(collection.mock.calls).toEqual([['videosVideoModule']]);
    expect(where).toHaveBeenCalledWith('isPublished', '==', true);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
