import handler from '../../pages/api/premium/video-library/[videoId]';
import { createSubtitlePlayback } from '../../lib/bunnySubtitles.cjs';
import { getOptionalAuth } from '../../lib/requireAuth';
import { loadPremiumVideoLibraryRowById } from '../../lib/loadPremiumVideoLibrary';
import { resolvePublicVideoLibraryPremiumActive } from '../../lib/videoLibraryAccess';

jest.mock('../../lib/bunnySubtitles.cjs', () => ({ createSubtitlePlayback: jest.fn() }));
jest.mock('../../lib/videoDescriptionStorage.cjs', () => ({ resolveDescriptions: async rows => rows }));
jest.mock('../../lib/requireAuth', () => ({ getOptionalAuth: jest.fn() }));
jest.mock('../../lib/loadPremiumVideoLibrary', () => ({ loadPremiumVideoLibraryRowById: jest.fn(), loadPremiumVideoRelatedRows: async () => [] }));
jest.mock('../../lib/videoLibraryAccess', () => ({ resolvePublicVideoLibraryPremiumActive: jest.fn(), resolveVideoLibraryPremiumAccessForUser: async () => ({ premiumActive: true }) }));
jest.mock('../../lib/globalSettings', () => ({ isSubscriptionSystemEnabled: async () => true }));
jest.mock('../../lib/firestoreCostLogger', () => ({ withFirestoreReadTelemetry: (_, fn) => fn }));
jest.mock('../../lib/videoLikes', () => ({ getVideoLikeSummary: async () => ({ likesCount: 0 }) }));
jest.mock('../../lib/videoComments', () => ({ getVideoCommentCount: async () => 0 }));
jest.mock('../../lib/videoViews', () => ({ recordVideoLibraryView: async () => {}, resolveClientIpFromRequest: () => null }));
jest.mock('../../lib/premiumVideoAccessAudit', () => ({ auditPremiumVideoAccess: () => {}, buildClientAccessDebug: () => ({}) }));
jest.mock('../../lib/videoLibraryPlaybackAudit', () => ({ auditVideoPlayback: () => {}, buildVideoRequestTelemetry: () => ({}) }));

const SOURCE = '0c2a815a-a138-4c61-985d-de2d70548d79';
const EN = 'dd88ebdf-29c6-4d03-90d3-09a294e8adcb';
const row = { id: 'v', isPublished: true, platform: 'bunny', videoUrl: `651812/${SOURCE}`, title: 'Test', locales: { en: { videoUrl: `651812/${EN}` } } };
const request = async query => {
  const res = { setHeader: jest.fn(), status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', headers: {}, query: { videoId: 'v', locale: 'ro', ...query } }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME = 'cdn.example.com';
  getOptionalAuth.mockResolvedValue(null);
  resolvePublicVideoLibraryPremiumActive.mockResolvedValue(false);
  loadPremiumVideoLibraryRowById.mockResolvedValue(row);
  createSubtitlePlayback.mockResolvedValue('/api/premium/video-subtitles/master.m3u8?grant=test');
});

it('preserves legacy detail payload and enriches only opted-in mobile detail', async () => {
  const old = await request({});
  expect(old.statusCode).toBe(200);
  expect(createSubtitlePlayback).not.toHaveBeenCalled();
  const mobile = await request({ nativeSubtitles: '1' });
  expect(mobile.body.video).toEqual({ ...old.body.video, subtitleHlsSrc: '/api/premium/video-subtitles/master.m3u8?grant=test' });
  expect(mobile.body.related).toEqual(old.body.related);
});

it('uses the resolved localized source rather than the root video', async () => {
  await request({ nativeSubtitles: '1', locale: 'en' });
  expect(createSubtitlePlayback).toHaveBeenCalledWith(expect.anything(), { libraryId: '651812', videoId: EN });
});

it.each(['web', 'premium', 'scheduled'])('does not grant subtitle access to %s restricted playback', async mode => {
  if (mode === 'premium') loadPremiumVideoLibraryRowById.mockResolvedValue({ ...row, isPremium: true });
  if (mode === 'scheduled') loadPremiumVideoLibraryRowById.mockResolvedValue({ ...row, publishAt: { seconds: Math.floor(Date.now() / 1000) + 86400 } });
  await request({ nativeSubtitles: '1', ...(mode === 'web' ? { client: 'web' } : {}) });
  expect(createSubtitlePlayback).not.toHaveBeenCalled();
});

it('keeps playback usable when Bunny is unavailable', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  createSubtitlePlayback.mockRejectedValueOnce(new Error('offline'));
  const result = await request({ nativeSubtitles: '1' });
  expect(result.statusCode).toBe(200);
  expect(result.body.video).toMatchObject({ canPlay: true, subtitlesUnavailable: true });
  expect(result.body.video.hlsSrc).toBeTruthy();
  console.warn.mockRestore();
});
