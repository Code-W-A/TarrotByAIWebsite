import { serveSubtitleAsset } from '../../../../lib/bunnySubtitles.cjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  try {
    const result = await serveSubtitleAsset(req.query.asset, req.query.grant);
    res.setHeader('Content-Type', result.type);
    return res.status(200).send(result.text);
  } catch (error) {
    const code = typeof error?.message === 'string' && /^subtitle_[a-z_]+$/.test(error.message)
      ? error.message : 'subtitle_unavailable';
    const status = code === 'subtitle_invalid_grant' ? 403 : code === 'subtitle_asset_not_found' ? 404 : 503;
    console.warn('[video-subtitles]', { code, status });
    return res.status(status).json({ error: code });
  }
}
