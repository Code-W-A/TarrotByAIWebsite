const SOURCE = '0c2a815a-a138-4c61-985d-de2d70548d79';
const MASTER = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1000,CLOSED-CAPTIONS=NONE\n240p/video.m3u8\n';
const payload = () => ({ id: 'app-video', library: '651812', source: SOURCE, duration: 2389, tracks: [{ language: 'EN', label: 'English', version: 2 }] });
const response = text => ({ ok: true, body: new ReadableStream({ start(c) { c.enqueue(Buffer.from(text)); c.close(); } }) });

describe('Bunny subtitle bridge', () => {
  let api;
  beforeEach(() => {
    jest.resetModules();
    process.env.BUNNY_STREAM_LIBRARY_ID = '651812';
    process.env.NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME = 'cdn.example.com';
    process.env.BUNNY_SUBTITLE_SIGNING_SECRET = 'test-only-secret-with-more-than-32-characters';
    process.env.BUNNY_STREAM_READ_ONLY_KEY = 'test-only-read-key';
    api = require('../bunnySubtitles.cjs');
    global.fetch = jest.fn();
  });

  it('binds grants to the source and expires after two hours', () => {
    const now = Date.now();
    const token = api.signGrant(payload(), now);
    expect(api.verifyGrant(token, now)).toMatchObject(payload());
    expect(() => api.verifyGrant(token, now + 7200000)).toThrow('subtitle_invalid_grant');
    const [body, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), source: 'other' })).toString('base64url');
    expect(() => api.verifyGrant(`${changed}.${signature}`, now)).toThrow();
    expect(() => api.verifyGrant(`${token}.extra`, now)).toThrow();
  });

  it('rewrites variant/tag URLs, preserves audio and quality, adds default-off subtitle groups', () => {
    const original = MASTER.replace('#EXT-X-VERSION:3', '#EXT-X-VERSION:3\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/list.m3u8"');
    const result = api.rewriteMaster(original, payload(), 'token');
    expect(result).toContain(`https://cdn.example.com/${SOURCE}/240p/video.m3u8`);
    expect(result).toContain(`URI="https://cdn.example.com/${SOURCE}/audio/list.m3u8"`);
    expect(result).toContain('BANDWIDTH=1000,CLOSED-CAPTIONS=NONE,SUBTITLES="bunny-subtitles"');
    expect(result).toContain('LANGUAGE="en",AUTOSELECT=NO,DEFAULT=NO');
    expect(result).toContain('track-0.m3u8?grant=token');
    expect(() => api.rewriteMaster(MASTER.replace('240p/video.m3u8', 'https://evil.example/file'), payload(), 't')).toThrow('subtitle_invalid_asset');
  });

  it('groups metadata reads, caches no-caption results, and performs no calls for locked videos', async () => {
    const video = { id: 'v', platform: 'bunny', canPlay: true, hlsSrc: 'hls' };
    const parts = { libraryId: '651812', videoId: SOURCE };
    global.fetch.mockImplementation(async () => response(JSON.stringify({ guid: SOURCE, length: 100, captions: [] })));
    expect(await api.createSubtitlePlayback({ ...video, canPlay: false }, parts)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await Promise.all([api.createSubtitlePlayback(video, parts), api.createSubtitlePlayback(video, parts)])).toEqual([null, null]);
    await api.createSubtitlePlayback(video, parts);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('issues metadata for the requested source only and safely filters invalid tracks', async () => {
    global.fetch.mockResolvedValue(response(JSON.stringify({ guid: SOURCE, length: 2389, captions: [
      { srclang: 'EN', label: 'English', version: 2 }, { srclang: '../private', label: 'bad' },
    ] })));
    const url = await api.createSubtitlePlayback({ id: 'v', platform: 'bunny', canPlay: true, hlsSrc: 'hls' }, { libraryId: '651812', videoId: SOURCE });
    expect(api.verifyGrant(new URL(url, 'https://local.test').searchParams.get('grant')).tracks).toHaveLength(1);
    expect(global.fetch.mock.calls[0][0]).toContain(`/videos/${SOURCE}`);
  });

  it('recovers after upstream failure rather than caching errors', async () => {
    const v = { id: 'v', platform: 'bunny', canPlay: true, hlsSrc: 'hls' };
    const p = { libraryId: '651812', videoId: SOURCE };
    global.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(JSON.stringify({ guid: SOURCE, length: 100, captions: [] })));
    await expect(api.createSubtitlePlayback(v, p)).rejects.toThrow();
    await expect(api.createSubtitlePlayback(v, p)).resolves.toBeNull();
  });

  it('discovers newly uploaded captions after the five-minute metadata cache expires', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const v = { id: 'v', platform: 'bunny', canPlay: true, hlsSrc: 'hls' };
    const p = { libraryId: '651812', videoId: SOURCE };
    global.fetch.mockImplementationOnce(async () => response(JSON.stringify({ guid: SOURCE, length: 100, captions: [] })))
      .mockImplementationOnce(async () => response(JSON.stringify({ guid: SOURCE, length: 100, captions: [{ srclang: 'EN', label: 'English' }] })));
    try {
      expect(await api.createSubtitlePlayback(v, p)).toBeNull();
      clock.mockReturnValue(now + 300001);
      expect(await api.createSubtitlePlayback(v, p)).toContain('master.m3u8');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('keeps multiple subtitle languages and replaces an existing subtitle group without duplicates', () => {
    const grant = payload();
    grant.tracks.push({ language: 'ro', label: 'Română 🌕', version: 1 });
    const original = MASTER.replace('BANDWIDTH=1000', 'SUBTITLES="old",BANDWIDTH=1000');
    const result = api.rewriteMaster(original, grant, 'token');
    expect(result.match(/TYPE=SUBTITLES/g)).toHaveLength(2);
    expect(result).toContain('LANGUAGE="ro"');
    expect(result).toContain('Română 🌕');
    expect(result).not.toContain('SUBTITLES="old"');
    expect(result).toContain('#EXT-X-VERSION:6');
  });

  it('generates VOD subtitle playlists and rejects unknown/expired assets', async () => {
    const token = api.signGrant(payload());
    const result = await api.serveSubtitleAsset('track-0.m3u8', token);
    expect(result.text).toContain('#EXT-X-TARGETDURATION:2389');
    expect(result.text).toContain('#EXTINF:2389.000,');
    expect(result.text).toContain('#EXT-X-ENDLIST');
    await expect(api.serveSubtitleAsset('track-99.vtt', token)).rejects.toThrow('subtitle_asset_not_found');
    await expect(api.serveSubtitleAsset('master.m3u8', 'bad')).rejects.toThrow('subtitle_invalid_grant');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles BOM/Unicode and preserves existing timestamp maps', async () => {
    const vtt = '\uFEFFWEBVTT\r\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:130080\r\n\r\n00:00:01.000 --> 00:00:03.000\r\nȘtiință 🌕\r\n';
    global.fetch.mockResolvedValue(response(vtt));
    const result = await api.serveSubtitleAsset('track-0.vtt', api.signGrant(payload()));
    expect(result.text).toContain('Știință 🌕');
    expect(result.text.startsWith('WEBVTT')).toBe(true);
    expect(result.text.match(/X-TIMESTAMP-MAP/g)).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('extracts the earliest PES timestamp once per PID, including timestamps above 32 bits', () => {
    const packet = (pid, pts) => {
      const b = Buffer.alloc(188, 0xff);
      b.set([0x47, 0x40 | (pid >> 8), pid & 255, 0x10, 0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5]);
      b.set([0x21 | ((Math.floor(pts / 1073741824) & 7) << 1), Math.floor(pts / 4194304) & 255,
        ((Math.floor(pts / 32768) & 127) << 1) | 1, Math.floor(pts / 128) & 255, ((pts & 127) << 1) | 1], 13);
      return b;
    };
    expect(api.firstPresentationTimestamp(Buffer.concat([packet(256, 132000), packet(257, 130080), packet(256, 100)]))).toBe(130080);
    expect(api.firstPresentationTimestamp(packet(256, 7000000000))).toBe(7000000000);
  });
});
