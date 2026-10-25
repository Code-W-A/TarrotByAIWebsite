jest.mock('../requireAuth', () => ({ getOptionalAuth: jest.fn(async () => null) }));
jest.mock('../globalSettings', () => ({ isSubscriptionSystemEnabled: async () => true }));
jest.mock('../videoLibraryAccess', () => ({
  resolvePublicVideoLibraryPremiumActive: async () => false,
  resolveVideoLibraryPremiumAccessForUser: async () => ({ premiumActive: true, userDocExists: true, accessExplain: { hasAccess: true } }),
}));
jest.mock('../firebaseAdmin', () => ({ getAdminDb: jest.fn() }));
jest.mock('../videoLikes', () => ({ getVideoLikeSummary: async () => ({ likesCount: 0, likedByCurrentUser: false }) }));
jest.mock('../videoComments', () => ({ getVideoCommentCount: async () => 0 }));
jest.mock('../videoViews', () => ({ recordVideoLibraryView: async () => {}, resolveClientIpFromRequest: () => null }));
import listHandler from '../../pages/api/premium/video-library';
import detailHandler from '../../pages/api/premium/video-library/[videoId]';
import { getOptionalAuth } from '../requireAuth';
import { getAdminDb } from '../firebaseAdmin';
import { clearPremiumVideoLibraryMemoryCache, loadFreshPremiumVideoLibraryRows, loadFeaturedHomeVideos } from '../loadPremiumVideoLibrary';
import { createVideoCacheDb, videoRow, makeVideoRes } from '../../tests/helpers/videoCacheDb';
const { rebuild } = require('../videoLibraryMaterializedCache.cjs');
const { prepareDescriptions, makeDocument, clearDescriptionMemoryCache } = require('../videoDescriptionStorage.cjs');
const locales = require('../../next-i18next.config').i18n.locales;
const originalEnv = { ...process.env };
const first = videoRow(1, { description: 'Original integral\n🙂', featuredOnHome: true,
  locales: Object.fromEntries(locales.map(locale => [locale, { title: `Title ${locale}`, description: `Full ${locale}\n${'Text Unicode 🌍 '.repeat(30)}END_${locale}`, videoUrl: 'https://youtu.be/abc123' }])) });
const second = videoRow(2, { isPremium: false, category: first.category, description: 'Second complete text' });
let model, documents;
beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { SANITY_PROJECT_ID: 'test', SANITY_DATASET: 'private', SANITY_READ_TOKEN: 'read-test', FIRESTORE_READ_TELEMETRY_ENABLED: 'false' });
  clearPremiumVideoLibraryMemoryCache(); clearDescriptionMemoryCache(); documents = new Map();
  model = createVideoCacheDb([first, second]); getAdminDb.mockReturnValue(model.db);
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/datasets')) return { ok: true, json: async () => [{ name: 'private', aclMode: 'private' }] };
    return { ok: true, json: async () => ({ result: JSON.parse(options.body).params.ids.flatMap(id => documents.has(id) ? [documents.get(id)] : []) }) };
  });
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...originalEnv }; delete global.fetch; });
function toStored(row, mode) {
  const sources = { version: 1, root: mode === 'sanity' ? 'sanity' : 'firebase',
    locales: Object.fromEntries(locales.map((locale, n) => [locale, mode === 'sanity' || n % 2 ? 'sanity' : 'firebase'])) };
  const { fields, storage, external } = prepareDescriptions({ ...row, descriptionStorage: sources });
  const document = makeDocument(row.id, external); documents.set(document._id, document);
  return { ...fields, descriptionStorage: { ...storage, sanityId: document._id } };
}
async function response(handler, query) {
  const res = makeVideoRes(); await handler({ method: 'GET', headers: {}, query }, res);
  expect(res.statusCode).toBe(200);
  return handler === listHandler ? { videos: res.body.videos, featuredVideoIds: res.body.featuredVideoIds } : { video: res.body.video, related: res.body.related, availableLocales: res.body.availableLocales };
}
it.each(['sanity', 'mixed'])('%s returns identical list/detail/related DTOs for all languages and web/iOS/Android', async mode => {
  await rebuild(model.db);
  model.reads.length = 0;
  const expected = [];
  for (const premium of [false, true]) for (const client of [{ client: 'web' }, { appPlatform: 'ios' }, { appPlatform: 'android' }]) for (const locale of locales) {
    getOptionalAuth.mockResolvedValue(premium ? { uid: 'premium-user' } : null);
    const query = { ...client, locale };
    expected.push({ query, premium, list: await response(listHandler, query), detail: await response(detailHandler, { ...query, videoId: first.id }) });
  }
  const normalizeReads = reads => reads.map(read => ({ ...read, ...(read.id ? { id: read.id.replace(/__generation_[\w-]+_(\d+)$/, '__generation_VERSION_$1') } : {}) }));
  const originalReads = normalizeReads(model.reads);
  model.source.set(first.id, toStored(first, mode));
  await rebuild(model.db); clearPremiumVideoLibraryMemoryCache();
  model.reads.length = 0;
  const requests = fetch.mock.calls.length;
  for (const item of expected) {
    getOptionalAuth.mockResolvedValue(item.premium ? { uid: 'premium-user' } : null);
    expect(await response(listHandler, item.query)).toEqual(item.list);
    expect(await response(detailHandler, { ...item.query, videoId: first.id })).toEqual(item.detail);
  }
  expect(fetch).toHaveBeenCalledTimes(requests);
  expect(normalizeReads(model.reads)).toEqual(originalReads);
  const fresh = await loadFreshPremiumVideoLibraryRows();
  expect(fresh.find(row => row.id === first.id)).toMatchObject(first);
  const home = await loadFeaturedHomeVideos({ locale: 'en', premiumActive: true });
  expect(home[0].description).toBe(first.locales.en.description);
});
it('retains the durable previous catalog on a cold start when the new Sanity version is unavailable', async () => {
  await rebuild(model.db);
  const expected = await response(listHandler, { locale: 'en' });
  const stored = toStored({ ...first, description: 'Unpublished new root', updatedAt: new Date().toISOString() }, 'sanity');
  model.source.set(first.id, stored); documents.clear();
  clearPremiumVideoLibraryMemoryCache(); clearDescriptionMemoryCache();
  expect(await response(listHandler, { locale: 'en' })).toEqual(expected);
});
