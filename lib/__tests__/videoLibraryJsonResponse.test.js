import http from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { sendVideoLibraryJson } from '../videoLibraryJsonResponse';
const hash = value => createHash('sha256').update(value).digest('hex');
const description = 'Paragraf 👨‍👩‍👧‍👦 cu diacritice: îășț.\n\n'.repeat(100000);
const payload = { videos: [{ id: 'large', description }], requestId: 'unchanged' };

it.each(['gzip', 'gzip;q=0', 'identity'])('streams large JSON intact over HTTP with Accept-Encoding %s', async encoding => {
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(4500000);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vary', 'Origin');
    await sendVideoLibraryJson(req, res, payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}`, { headers: { 'Accept-Encoding': encoding } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    const compressed = encoding === 'gzip';
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toBe('Origin, Accept-Encoding');
    expect(response.headers['content-encoding']).toBe(compressed ? 'gzip' : undefined);
    expect(response.headers['content-length']).toBeUndefined();
    const text = (compressed ? gunzipSync(response.bytes) : response.bytes).toString('utf8');
    const actual = JSON.parse(text);
    expect(hash(actual.videos[0].description)).toBe(hash(description));
    expect(actual.requestId).toBe('unchanged');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

it('preserves the normal response helper for small payloads', async () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const small = { videos: [], requestId: 'small' };
  await sendVideoLibraryJson({ headers: {} }, res, small);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(small);
});

it('settles a disconnected stream instead of attempting a second JSON response', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  let finished;
  const complete = new Promise(resolve => { finished = resolve; });
  const server = http.createServer(async (req, res) => {
    try { await sendVideoLibraryJson(req, res, payload); } finally { finished(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}`, { headers: { 'Accept-Encoding': 'identity' } }, res => {
        res.once('data', () => { res.destroy(); resolve(); });
      }).on('error', reject);
    });
    await complete;
  } finally { warning.mockRestore(); await new Promise(resolve => server.close(resolve)); }
});
