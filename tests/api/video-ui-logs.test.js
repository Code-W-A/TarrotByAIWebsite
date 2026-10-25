jest.mock('../../lib/requireAuth', () => ({ requireDashboardAccess: jest.fn() }));
jest.mock('../../lib/firebaseAdmin', () => ({ getAdminDb: jest.fn() }));
import handler from '../../pages/api/admin/ui-logs';
import { getAdminDb } from '../../lib/firebaseAdmin';
import { makeVideoRes } from '../helpers/videoCacheDb';
it('persists structured submit errors instead of rejecting their error property as validation failure', async () => {
  const add = jest.fn(async () => ({ id: 'log1' }));
  getAdminDb.mockReturnValue({ collection: () => ({ add }) });
  const res = makeVideoRes();
  await handler({ method: 'POST', headers: {}, body: { source: 'videos.create', event: 'create_submit_error', level: 'error',
    pagePath: '/dashboard/videos', message: 'Save failed', error: { name: 'Error', message: 'Document too large' } } }, res);
  expect(res.statusCode).toBe(201);
  expect(add.mock.calls[0][0].error).toMatchObject({ message: 'Document too large' });
});
