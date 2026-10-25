import handler from '../../pages/api/premium/video-subtitles/[asset]';
import { signGrant } from '../../lib/bunnySubtitles.cjs';

const run = async (method, asset, grant) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
    send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  await handler({ method, query: { asset, grant } }, res);
  return res;
};

beforeEach(() => {
  process.env.BUNNY_STREAM_LIBRARY_ID = '651812';
  process.env.NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME = 'cdn.example.com';
  process.env.BUNNY_SUBTITLE_SIGNING_SECRET = 'test-only-secret-with-more-than-32-characters';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('rejects missing/forged grants and unsupported methods', async () => {
  expect((await run('GET', 'master.m3u8', 'forged')).statusCode).toBe(403);
  expect((await run('POST', 'master.m3u8', 'forged')).statusCode).toBe(405);
});

it('serves private subtitle playlists without reading Firestore or Bunny', async () => {
  const token = signGrant({ id: 'v', source: '0c2a815a-a138-4c61-985d-de2d70548d79', library: '651812', duration: 2389,
    tracks: [{ language: 'EN', label: 'English', version: 2 }] });
  const result = await run('GET', 'track-0.m3u8', token);
  expect(result.statusCode).toBe(200);
  expect(result.headers['Cache-Control']).toBe('private, no-store');
  expect(result.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
  expect(result.body).toContain('#EXT-X-ENDLIST');
  expect((await run('GET', 'track-9.vtt', token)).statusCode).toBe(404);
});
