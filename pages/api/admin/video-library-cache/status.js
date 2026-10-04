import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireDashboardAccess } from "../../../../lib/requireAuth";
import materializedCache from "../../../../lib/videoLibraryMaterializedCache.cjs";

const toIso = (value) => {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    requireDashboardAccess(req);
    const cache = getAdminDb().collection("internalCaches");
    const [manifestSnap, buildSnap] = await Promise.all([
      cache.doc("videoLibraryPublic").get(), cache.doc("videoLibraryPublicBuild").get(),
    ]);
    const manifest = manifestSnap.data();
    const build = buildSnap.data();
    const available = materializedCache.validateManifestHeader(manifest);
    return res.status(200).json({
      available,
      rowCount: available ? manifest.rowCount : null,
      updatedAt: available ? toIso(manifest.updatedAt) : null,
      lastRebuild: build ? {
        status: build.status || "unknown",
        requestedAt: toIso(build.requestedAt),
        finishedAt: toIso(build.finishedAt),
        error: build.status === "error" ? "Reconstruirea cache-ului video a eșuat." : null,
      } : null,
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ error: "Nu am putut citi starea cache-ului video." });
  }
}
