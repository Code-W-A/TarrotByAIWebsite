jest.mock('../../lib/requireAuth', () => ({ requireDashboardAccess: jest.fn() }));
jest.mock('../../lib/videoAdminPersistence', () => ({ readVideoForEdit: jest.fn(), saveAdminVideo: jest.fn() }));
jest.mock('../../lib/loadPremiumVideoLibrary', () => ({ rebuildPremiumVideoLibraryMaterializedCache: jest.fn() }));
import handler from '../../pages/api/admin/videos';
import { requireDashboardAccess } from '../../lib/requireAuth';
import { readVideoForEdit, saveAdminVideo } from '../../lib/videoAdminPersistence';
import { rebuildPremiumVideoLibraryMaterializedCache } from '../../lib/loadPremiumVideoLibrary';
import { makeVideoRes } from '../helpers/videoCacheDb';

beforeEach(() => {
  jest.resetAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => {});
  saveAdminVideo.mockResolvedValue({ id: 'v1' });
});
afterEach(() => jest.restoreAllMocks());
it.each(['GET', 'POST'])('authenticates %s before reading or writing', async method => {
  requireDashboardAccess.mockImplementation(() => { throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }); });
  const res = makeVideoRes(); await handler({ method, query: { id: 'v1' } }, res);
  expect(res.statusCode).toBe(401); expect(readVideoForEdit).not.toHaveBeenCalled(); expect(saveAdminVideo).not.toHaveBeenCalled();
});
it('returns a hydrated administrative edit model without caching it publicly', async () => {
  readVideoForEdit.mockResolvedValue({ id: 'v1', description: 'Full text', editRevision: '12:0' });
  const res = makeVideoRes(); await handler({ method: 'GET', query: { id: 'v1' } }, res);
  expect(res.body.video.description).toBe('Full text'); expect(res.headers['Cache-Control']).toContain('no-store');
});
it('distinguishes a committed write/cache failure from a failed save', async () => {
  rebuildPremiumVideoLibraryMaterializedCache.mockRejectedValue(new Error('Sanity offline'));
  const res = makeVideoRes(); await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({ id: 'v1', cacheWarning: expect.stringContaining('salvat') });
  saveAdminVideo.mockRejectedValue(Object.assign(new Error('Conflict'), { statusCode: 409 }));
  const failed = makeVideoRes(); await handler({ method: 'POST', body: {} }, failed);
  expect(failed.statusCode).toBe(409); expect(failed.body.error).toBe('Conflict');
});
