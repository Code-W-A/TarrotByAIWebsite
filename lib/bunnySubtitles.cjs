const crypto = require('node:crypto');

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i;
const PREFIX = '/api/premium/video-subtitles';
const cache = new Map();
const pending = new Map();
const TTL = 300000;
let cacheBytes = 0;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

function evict(key) {
  cacheBytes -= cache.get(key)?.size || 0;
  cache.delete(key);
}

function config() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID;
  const host = (process.env.NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  const key = process.env.BUNNY_STREAM_READ_ONLY_KEY;
  const secret = process.env.BUNNY_SUBTITLE_SIGNING_SECRET;
  if (!/^\d+$/.test(libraryId || '') || !/^[a-z\d.-]+$/i.test(host) || !secret || secret.length < 32) {
    throw new Error('subtitle_configuration_missing');
  }
  return { libraryId, host, key, secret };
}

async function cached(key, load) {
  const old = cache.get(key);
  if (old && old.until > Date.now()) return old.value;
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(load).then(value => {
    const size = Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
    evict(key);
    while (cache.size && (cache.size >= 500 || cacheBytes + size > MAX_CACHE_BYTES)) evict(cache.keys().next().value);
    if (size <= MAX_CACHE_BYTES) {
      cache.set(key, { until: Date.now() + TTL, value, size });
      cacheBytes += size;
    }
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

async function download(url, { limit = 2 * 1024 * 1024, headers = {}, range = false, timeout = 8000 } = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('subtitle_upstream_unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (value.length > remaining && !range) throw new Error('subtitle_upstream_too_large');
      chunks.push(Buffer.from(value.subarray(0, remaining)));
      total += Math.min(value.length, remaining);
      if (total >= limit && range) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

function sourceUrl(grant) {
  return `https://${config().host}/${grant.source}/playlist.m3u8`;
}

function safeAsset(raw, base, source) {
  const url = new URL(raw, base);
  if (url.protocol !== 'https:' || url.host !== config().host || url.username || url.password ||
      !url.pathname.startsWith(`/${source}/`)) throw new Error('subtitle_invalid_asset');
  return url.href;
}

function signGrant(payload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + 7200 })).toString('base64url');
  const signature = crypto.createHmac('sha256', config().secret).update(body).digest('base64url');
  const token = `${body}.${signature}`;
  if (token.length > 6000) throw new Error('subtitle_metadata_too_large');
  return token;
}

function verifyGrant(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 16384) throw new Error('subtitle_invalid_grant');
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) throw new Error('subtitle_invalid_grant');
  const expected = crypto.createHmac('sha256', config().secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('subtitle_invalid_grant');
  const grant = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!grant.id || grant.library !== config().libraryId || !UUID.test(grant.source) ||
      !Number.isFinite(grant.exp) || grant.exp <= now / 1000 || grant.exp > now / 1000 + 7201 ||
      !Number.isFinite(grant.duration) || grant.duration <= 0 || !Array.isArray(grant.tracks) ||
      !grant.tracks.length || grant.tracks.length > 100 || grant.tracks.some(t => !LANGUAGE.test(t.language) || typeof t.label !== 'string')) {
    throw new Error('subtitle_invalid_grant');
  }
  return grant;
}

function assetPath(token, asset) { return `${PREFIX}/${asset}?grant=${encodeURIComponent(token)}`; }

async function createSubtitlePlayback(video, parts) {
  if (video?.platform !== 'bunny' || video.canPlay !== true || video.lockedReason || !video.hlsSrc || !parts) return null;
  const cfg = config();
  if (parts.libraryId !== cfg.libraryId || !UUID.test(parts.videoId)) return null;
  if (!cfg.key) throw new Error('subtitle_configuration_missing');
  const metadata = await cached(`meta:${parts.libraryId}:${parts.videoId}`, async () => {
    const data = JSON.parse((await download(`https://video.bunnycdn.com/library/${parts.libraryId}/videos/${parts.videoId}`, {
      headers: { AccessKey: cfg.key }, timeout: 3000,
    })).toString());
    if (data.guid !== parts.videoId || !Number.isFinite(data.length) || data.length <= 0) throw new Error('subtitle_invalid_metadata');
    const tracks = (Array.isArray(data.captions) ? data.captions : []).filter(t => LANGUAGE.test(t.srclang)).slice(0, 100)
      .map(t => ({ language: t.srclang, label: String(t.label || t.srclang).replace(/[\r\n"\\]/g, '').slice(0, 100), version: Number(t.version) || 0 }));
    return { duration: data.length, tracks };
  });
  if (!metadata.tracks.length) return null;
  const token = signGrant({ id: video.id, library: parts.libraryId, source: parts.videoId, ...metadata });
  return assetPath(token, 'master.m3u8');
}

function quote(value) { return String(value).replace(/["\\\r\n]/g, ''); }

function rewriteMaster(text, grant, token) {
  if (!text.replace(/^\uFEFF/, '').startsWith('#EXTM3U')) throw new Error('subtitle_invalid_playlist');
  const base = sourceUrl(grant);
  const tracks = grant.tracks.map((track, index) => `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="bunny-subtitles",NAME="${quote(track.label)} (${index + 1})",LANGUAGE="${track.language.toLowerCase()}",AUTOSELECT=NO,DEFAULT=NO,FORCED=NO,URI="${assetPath(token, `track-${index}.m3u8`)}"`);
  let variants = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => !/^#EXT-X-MEDIA:.*TYPE=SUBTITLES(?:,|$)/.test(l)).map(line => {
    if (line.startsWith('#EXT-X-VERSION:')) return `#EXT-X-VERSION:${Math.max(6, Number(line.slice(15)) || 6)}`;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      variants++;
      const attributes = line.slice('#EXT-X-STREAM-INF:'.length).replace(/(?:^|,)SUBTITLES="[^"]*"/g, '').replace(/^,/, '');
      line = `#EXT-X-STREAM-INF:${attributes},SUBTITLES="bunny-subtitles"`;
    }
    if (line && !line.startsWith('#')) return safeAsset(line, base, grant.source);
    return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${safeAsset(uri, base, grant.source)}"`);
  });
  if (!variants) throw new Error('subtitle_invalid_playlist');
  if (!lines.some(l => l.startsWith('#EXT-X-VERSION:'))) lines.splice(1, 0, '#EXT-X-VERSION:6');
  lines.splice(lines.findIndex(l => l.startsWith('#EXT-X-VERSION:')) + 1, 0, ...tracks);
  return lines.join('\n');
}

// MPEG-TS PES timestamps are 33-bit values. The earliest audio/video PTS is the
// presentation origin; mapping LOCAL=0 to it avoids a ~1.45s offset on Bunny TS.
function firstPresentationTimestamp(bytes) {
  const starts = new Map();
  for (let pos = 0; pos + 188 <= bytes.length; pos += 188) {
    if (bytes[pos] !== 0x47) throw new Error('subtitle_unsupported_transport');
    if (!(bytes[pos + 1] & 0x40)) continue;
    const control = (bytes[pos + 3] >> 4) & 3;
    if (control !== 1 && control !== 3) continue;
    const p = pos + 4 + (control === 3 ? 1 + bytes[pos + 4] : 0);
    if (p + 14 > pos + 188 || bytes[p] !== 0 || bytes[p + 1] !== 0 || bytes[p + 2] !== 1) continue;
    const stream = bytes[p + 3];
    if (stream < 0xc0 || stream > 0xef || !(bytes[p + 7] & 0x80)) continue;
    const pid = ((bytes[pos + 1] & 0x1f) << 8) | bytes[pos + 2];
    if (starts.has(pid)) continue;
    const a = bytes.subarray(p + 9, p + 14);
    const pts = (a[0] & 14) * 536870912 + a[1] * 4194304 + (a[2] & 254) * 16384 + a[3] * 128 + ((a[4] & 254) >> 1);
    starts.set(pid, pts);
  }
  if (!starts.size) throw new Error('subtitle_timing_unavailable');
  return Math.min(...starts.values());
}

async function originalMaster(grant) {
  return cached(`master:${grant.source}`, async () => (await download(sourceUrl(grant), { limit: 256000 })).toString());
}

async function timing(grant) {
  return cached(`timing:${grant.source}`, async () => {
    const master = await originalMaster(grant);
    const variant = master.split(/\r?\n/).find(l => l && !l.startsWith('#'));
    if (!variant) throw new Error('subtitle_invalid_playlist');
    const mediaUrl = safeAsset(variant, sourceUrl(grant), grant.source);
    const media = (await download(mediaUrl, { limit: 1024 * 1024 })).toString();
    if (media.includes('#EXT-X-DISCONTINUITY') || media.includes('#EXT-X-MAP:') || /#EXT-X-KEY:METHOD=(?!NONE)/.test(media)) {
      throw new Error('subtitle_unsupported_timing');
    }
    const segment = media.split(/\r?\n/).find(l => l && !l.startsWith('#'));
    if (!segment) throw new Error('subtitle_invalid_playlist');
    const bytes = await download(safeAsset(segment, mediaUrl, grant.source), {
      limit: 512 * 1024, range: true, headers: { Range: 'bytes=0-524287' },
    });
    return firstPresentationTimestamp(bytes);
  });
}

async function serveSubtitleAsset(asset, token) {
  const grant = verifyGrant(token);
  if (asset === 'master.m3u8') {
    return { type: 'application/vnd.apple.mpegurl', text: rewriteMaster(await originalMaster(grant), grant, token) };
  }
  const match = /^track-(\d+)\.(m3u8|vtt)$/.exec(asset);
  const track = match && grant.tracks[Number(match[1])];
  if (!track) throw new Error('subtitle_asset_not_found');
  if (match[2] === 'm3u8') {
    return { type: 'application/vnd.apple.mpegurl', text: `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:${Math.ceil(grant.duration)}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:${grant.duration.toFixed(3)},\n${assetPath(token, `track-${match[1]}.vtt`)}\n#EXT-X-ENDLIST\n` };
  }
  const text = await cached(`caption:${grant.source}:${track.language}:${track.version}`, async () => {
    const url = `https://${config().host}/${grant.source}/captions/${encodeURIComponent(track.language)}.vtt?v=${track.version}`;
    let vtt = (await download(url)).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!/^WEBVTT(?:[ \t][^\n]*)?\n/.test(vtt)) throw new Error('subtitle_invalid_webvtt');
    if (!vtt.includes('X-TIMESTAMP-MAP=')) {
      const pts = await timing(grant);
      vtt = vtt.replace(/^(WEBVTT[^\n]*\n)/, `$1X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:${pts}\n`);
    }
    return vtt;
  });
  return { type: 'text/vtt; charset=utf-8', text };
}

module.exports = { createSubtitlePlayback, serveSubtitleAsset, signGrant, verifyGrant, rewriteMaster, firstPresentationTimestamp };
