jest.mock('../../lib/requireAuth', () => ({ requireDashboardAccess: jest.fn() }));
jest.mock('../../lib/firebaseAdmin', () => ({ getAdminDb: jest.fn() }));
import status from '../../pages/api/admin/video-library-cache/status';
import rebuildHandler from '../../pages/api/admin/video-library-cache/rebuild';
import { getAdminDb } from '../../lib/firebaseAdmin';
import { requireDashboardAccess } from '../../lib/requireAuth';
import { createVideoCacheDb, videoRow, makeVideoRes } from '../helpers/videoCacheDb';

describe('protected video cache controls', () => {
  let model;
  beforeEach(() => {
    jest.clearAllMocks();
    requireDashboardAccess.mockImplementation(() => {});
    model = createVideoCacheDb([videoRow(1)]);
    getAdminDb.mockReturnValue(model.db);
  });
  it.each([status, rebuildHandler])('rejects an unauthorized dashboard', async handler => {
    requireDashboardAccess.mockImplementation(() => { throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }); });
    const res = makeVideoRes();
    await handler({ method: handler === status ? 'GET' : 'POST' }, res);
    expect(res.statusCode).toBe(401);
    expect(model.reads).toHaveLength(0);
  });
  it('reads only two metadata documents and reports empty, successful and failed states', async () => {
    let res = makeVideoRes();
    await status({ method: 'GET' }, res);
    expect(res.body).toMatchObject({ available: false, rowCount: null, lastRebuild: null });
    expect(model.reads).toHaveLength(2);
    res = makeVideoRes();
    await rebuildHandler({ method: 'POST' }, res);
    expect(res.body).toMatchObject({ ok: true, rowCount: 1 });
    res = makeVideoRes();
    await status({ method: 'GET' }, res);
    expect(res.body).toMatchObject({ available: true, rowCount: 1, lastRebuild: { status: 'success' } });
    expect(res.body.updatedAt).toMatch(/^\d{4}-/);
    model.onChunkWrite(async () => { throw new Error('offline'); });
    await rebuildHandler({ method: 'POST' }, makeVideoRes());
    res = makeVideoRes();
    await status({ method: 'GET' }, res);
    expect(res.body).toMatchObject({ available: true, rowCount: 1, lastRebuild: { status: 'error' } });
  });
  it.each([[status, 'POST'], [rebuildHandler, 'GET']])('rejects unsupported methods', async (handler, method) => {
    const res = makeVideoRes();
    await handler({ method }, res);
    expect(res.statusCode).toBe(405);
  });
});
