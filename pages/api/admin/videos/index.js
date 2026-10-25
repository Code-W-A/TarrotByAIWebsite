import { requireDashboardAccess } from '../../../../lib/requireAuth';
import { readVideoForEdit, saveAdminVideo } from '../../../../lib/videoAdminPersistence';
import { rebuildPremiumVideoLibraryMaterializedCache } from '../../../../lib/loadPremiumVideoLibrary';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    requireDashboardAccess(req);
    if (req.method === 'GET') return res.status(200).json({ video: await readVideoForEdit(req.query.id) });
    const result = await saveAdminVideo(req.body || {});
    try { await rebuildPremiumVideoLibraryMaterializedCache(); }
    catch { return res.status(200).json({ ...result, cacheWarning: 'Videoul a fost salvat, dar cache-ul nu a fost actualizat.' }); }
    return res.status(200).json(result);
  } catch (e) {
    console.error('[admin.videos]', e?.message);
    return res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Salvarea în Firebase a eșuat. Poți reîncerca fără a crea un duplicat.' });
  }
}
