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
import handler from '../../pages/api/premium/video-library';
import detailHandler from '../../pages/api/premium/video-library/[videoId]';
import { getOptionalAuth } from '../requireAuth';
import { getAdminDb } from '../firebaseAdmin';
import { clearPremiumVideoLibraryMemoryCache, loadFeaturedHomeVideos, loadPremiumVideoLibraryVideos, loadPremiumVideoRelatedRows } from '../loadPremiumVideoLibrary';
import { createVideoCacheDb, videoRow, makeVideoRes } from '../../tests/helpers/videoCacheDb';
import { mapVideoRowToPublicDto } from '../videoLibraryPublicMapper';
const { rebuild, MANIFEST_ID } = require('../videoLibraryMaterializedCache.cjs');
const languages = ['en', 'fr', 'de', 'es', 'ru'];
const root = 'Original română.\n\n' + 'Paragraf lung 👨‍👩‍👧‍👦. '.repeat(1400);
const row = videoRow(723, { description: root, featuredOnHome: true,
  locales: Object.fromEntries(languages.map(language => [language, { title: `Title ${language}`, description: `${language}\n${root}\nUNIQUE_END_${language}`, videoUrl: 'https://youtu.be/abc123' }])) });
let model;
beforeEach(async () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.FIRESTORE_READ_TELEMETRY_ENABLED = 'false';
  clearPremiumVideoLibraryMemoryCache();
  model = createVideoCacheDb([row, videoRow(1)]);
  getAdminDb.mockReturnValue(model.db);
  getOptionalAuth.mockResolvedValue(null);
  await rebuild(model.db);
  model.reads.length = 0;
});
afterEach(() => { delete process.env.FIRESTORE_READ_TELEMETRY_ENABLED; jest.restoreAllMocks(); });

it.each(languages)('preserves full list and detail descriptions in %s for web/iOS/Android', async locale => {
  for (const client of [{ client: 'web' }, { appPlatform: 'ios' }, { appPlatform: 'android' }]) {
    getOptionalAuth.mockResolvedValue({ uid: 'premium-account' });
    const list = makeVideoRes();
    await handler({ method: 'GET', headers: {}, query: { locale, ...client } }, list);
    expect(list.statusCode).toBe(200);
    const video = list.body.videos.find(video => video.id === row.id);
    expect(video.description).toBe(row.locales[locale].description);
    // The current UI search must still find words at the very end of the text.
    expect(list.body.videos.filter(video => video.description.includes(`UNIQUE_END_${locale}`)).map(video => video.id)).toEqual([row.id]);
    expect(Object.values(video.locales).every(entry => !Object.hasOwn(entry, 'description'))).toBe(true);
    const detail = makeVideoRes();
    await detailHandler({ method: 'GET', headers: {}, query: { videoId: row.id, locale, ...client } }, detail);
    expect(detail.statusCode).toBe(200);
    expect(detail.body.video.description).toBe(row.locales[locale].description);
    expect(detail.body.video.locales).toEqual(row.locales);
  }
});

it('loads only root plus requested language and reuses their verified maps', async () => {
  await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  const manifest = model.caches.get(MANIFEST_ID);
  const readIds = model.reads.map(read => read.id);
  expect(readIds).toEqual(expect.arrayContaining([...manifest.textSets.root.chunkDocIds, ...manifest.textSets['locale:en'].chunkDocIds]));
  for (const language of ['fr', 'de', 'es', 'ru']) for (const id of manifest.textSets[`locale:${language}`].chunkDocIds) expect(readIds).not.toContain(id);
  const firstCount = model.reads.length;
  await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  expect(model.reads).toHaveLength(firstCount);
  const french = await loadPremiumVideoLibraryVideos({ locale: 'fr', premiumActive: true });
  expect(french.find(video => video.id === row.id).description).toBe(row.locales.fr.description);
  expect(model.reads.slice(firstCount).map(read => read.id)).toEqual(manifest.textSets['locale:fr'].chunkDocIds);
});

it('hydrates featured homepage and related videos without loading other translated transcripts', async () => {
  const featured = await loadFeaturedHomeVideos({ locale: 'fr', premiumActive: true });
  const preview = await loadPremiumVideoLibraryVideos({ locale: 'fr', premiumActive: true, previewLimit: 1 });
  const related = await loadPremiumVideoRelatedRows({ locale: 'fr', premiumActive: true, category: 'Tarot', excludeId: 'v1' });
  for (const videos of [featured, preview]) expect(videos[0].description).toBe(row.locales.fr.description);
  expect(mapVideoRowToPublicDto(related[0], { locale: 'fr', premiumActive: true }).description).toBe(row.locales.fr.description);
});

it('retains explicit empty translations and falls back only when the localized description is missing', async () => {
  model.source.set(row.id, { ...row, locales: { en: { title: 'Empty', description: '' }, fr: { title: 'Missing' } } });
  await rebuild(model.db); clearPremiumVideoLibraryMemoryCache();
  const en = await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  const fr = await loadPremiumVideoLibraryVideos({ locale: 'fr', premiumActive: true });
  expect(en.find(video => video.id === row.id).description).toBe('');
  expect(fr.find(video => video.id === row.id).description).toBe(root);
});

it('switches generations without reusing a translation from the previous generation', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
  await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  model.source.set(row.id, { ...row, locales: { ...row.locales, en: { ...row.locales.en, description: 'Updated complete English' } } });
  await rebuild(model.db);
  clock.mockReturnValue(1800000030001);
  const result = await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  expect(result.find(video => video.id === row.id).description).toBe('Updated complete English');
});

it('rejects a corrupted requested text and rebuilds it on the next request', async () => {
  const manifest = model.caches.get(MANIFEST_ID);
  model.caches.get(manifest.textSets['locale:en'].chunkDocIds[0]).parts[0].text = 'corruption';
  await expect(loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true })).rejects.toThrow('integrity');
  const result = await loadPremiumVideoLibraryVideos({ locale: 'en', premiumActive: true });
  expect(model.caches.get(MANIFEST_ID).generation).not.toBe(manifest.generation);
  expect(result.find(video => video.id === row.id).description).toBe(row.locales.en.description);
});
