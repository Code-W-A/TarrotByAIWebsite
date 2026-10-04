// Opt-in audit of the locally imported API against its configured Firestore.
// The adapter exposes only reads: even an automatic fallback rebuild cannot write.
jest.mock('../firebaseAdmin', () => {
  const actual = jest.requireActual('../firebaseAdmin');
  function readOnly(ref) {
    const adapter = {};
    for (const method of ['collection', 'doc', 'where', 'orderBy', 'limit', 'select', 'count']) {
      if (typeof ref[method] === 'function') adapter[method] = (...args) => readOnly(ref[method](...args));
    }
    if (typeof ref.get === 'function') adapter.get = (...args) => ref.get(...args);
    adapter.runTransaction = () => { throw new Error('Read-only audit: production writes are prohibited.'); };
    return adapter;
  }
  return { ...actual, getAdminDb: () => readOnly(actual.getAdminDb()) };
});
import handler from '../../pages/api/premium/video-library';
import { getAdminDb } from '../firebaseAdmin';
import { clearPremiumVideoLibraryMemoryCache } from '../loadPremiumVideoLibrary';
import { canViewerSeeVideo } from '../videoReleaseSchedule';
import { rowHasValidEmbedForLocale } from '../videoLibraryPublic';
import { makeVideoRes } from '../../tests/helpers/videoCacheDb';
const materialized = require('../videoLibraryMaterializedCache.cjs');
const { createHash } = require('node:crypto');

const live = process.env.RUN_VIDEO_FIRESTORE_PARITY === '1';
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const ids = rows => rows.map(row => row.id).sort();
const differences = (expected, actual) => ({
  missing: expected.filter(id => !actual.includes(id)),
  extra: actual.filter(id => !expected.includes(id)),
  duplicates: actual.filter((id, index) => actual.indexOf(id) !== index),
});

(live ? describe : describe.skip)('read-only Firestore / local API parity', () => {
  it('matches source, active cache and every eligible API ID on a stable source', async () => {
    process.env.FIRESTORE_READ_TELEMETRY_ENABLED = 'false';
    process.env.FIRESTORE_COST_LOGS = 'false';
    const db = getAdminDb();
    const readSource = async () => {
      const snap = await db.collection('videosVideoModule').where('isPublished', '==', true).get();
      return snap.docs.filter(doc => !['_meta', '_publicCache'].includes(doc.id))
        .map(doc => ({ ...doc.data(), id: doc.id }));
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const source = await readSource();
      const manifestSnap = await db.collection('internalCaches').doc('videoLibraryPublic').get();
      const manifest = manifestSnap.data();
      const cached = await materialized.readSnapshot(db, manifest);
      if (cached === null) throw new Error('Active cache is missing or invalid; audit did not rebuild production.');
      clearPremiumVideoLibraryMemoryCache();
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      const reports = [];
      try {
        for (const client of ['mobile', 'web']) {
          const res = makeVideoRes();
          await handler({ method: 'GET', headers: {}, query: { locale: 'ro', ...(client === 'web' ? { client: 'web' } : { appPlatform: 'android' }) } }, res);
          if (res.statusCode !== 200) throw new Error(`Local API returned ${res.statusCode}: ${res.body?.error}`);
          const eligible = source.filter(row => canViewerSeeVideo(row, res.body.premiumActive, now) && rowHasValidEmbedForLocale(row, 'ro'));
          reports.push({ client, sourceTotal: source.length, cacheTotal: cached.length, eligibleTotal: eligible.length,
            apiTotal: res.body.videos.length, sourceVsCache: differences(ids(source), ids(cached)),
            sourceVsApi: differences(ids(eligible), ids(res.body.videos)),
          });
        }
      } finally { clock.mockRestore(); }
      const after = await readSource();
      const manifestAfter = await db.collection('internalCaches').doc('videoLibraryPublic').get();
      if (digest(source) !== digest(after) || manifestAfter.data()?.generation !== manifest?.generation) continue;
      console.info('VIDEO_FIRESTORE_PARITY', JSON.stringify({ attempt, reports }));
      for (const report of reports) {
        expect(report.sourceVsCache).toEqual({ missing: [], extra: [], duplicates: [] });
        expect(report.sourceVsApi).toEqual({ missing: [], extra: [], duplicates: [] });
        expect(report.cacheTotal).toBe(report.sourceTotal);
        expect(report.apiTotal).toBe(report.eligibleTotal);
      }
      return;
    }
    throw new Error('Source changed during all three attempts; no stable parity result.');
  }, 300000);
});
