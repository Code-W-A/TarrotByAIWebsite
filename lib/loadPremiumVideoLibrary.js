import materializedCache from "./videoLibraryMaterializedCache.cjs";
import { normalizeLocale } from "./courses";
import { getAdminDb } from "./firebaseAdmin";
import { slugify } from "./slugify";
import {
  isVideoCreatedBeforePremiumSpotlightCutoff,
  rowHasValidEmbedForLocale,
} from "./videoLibraryPublic";
import { sortVideoDocsForPublic } from "./videoLibrarySort";
import {
  mapVideoRowToPublicDto,
} from "./videoLibraryPublicMapper";
import {
  canViewerSeeVideo,
  resolveVideoReleasePhase,
} from "./videoReleaseSchedule";
import {
  recordFirestoreCacheHit,
  withFirestoreCostLog,
} from "./firestoreCostLogger";

const COLLECTION = "videosVideoModule";
const CACHE_COLLECTION = "internalCaches";
const PUBLIC_CACHE_DOC_ID = "videoLibraryPublic";
const INTERNAL_DOC_IDS = new Set(["_meta"]);

/**
 * How often (ms) we check Firestore's manifest doc to see if chunks need
 * re-fetching. Default 30s. Backward-compatible alias:
 * `VIDEO_LIBRARY_CACHE_TTL_MS`.
 *
 * Behaviour:
 *  - request within window of last verification → return memory rows (0 reads)
 *  - request after window → read manifest only (1 read); refetch chunks only
 *    if `manifest.updatedAt` changed (rare: dashboard create/update/delete).
 */
const DEFAULT_MANIFEST_VERIFY_INTERVAL_MS = 30 * 1000;
const parsedManifestVerifyMs = Number.parseInt(
  process.env.VIDEO_LIBRARY_MANIFEST_VERIFY_INTERVAL_MS
    || process.env.VIDEO_LIBRARY_CACHE_TTL_MS
    || "",
  10
);
const MANIFEST_VERIFY_INTERVAL_MS =
  Number.isFinite(parsedManifestVerifyMs) && parsedManifestVerifyMs > 0
    ? parsedManifestVerifyMs
    : DEFAULT_MANIFEST_VERIFY_INTERVAL_MS;

// Safety net for failed dashboard rebuild callbacks. This does not query the
// full source on browsing requests; count + latest-edit metadata are enough
// to detect publication/deletion and the admin's timestamped edits.
let sourceAudit = { checkedAt: 0, signature: null };
const SOURCE_AUDIT_INTERVAL_MS = 5 * 60 * 1000;

let publishedRowsCache = {
  manifestUpdatedAtMs: 0,
  lastVerifiedAtMs: 0,
  rows: null,
  promise: null,
};

/**
 * Normalizes the `updatedAt` field on the manifest document (Firestore
 * Timestamp, native Date, or ISO string) into a comparable epoch-ms value.
 * Returns 0 when nothing usable is present so cache comparisons stay safe.
 */
function getManifestUpdatedAtMs(manifest) {
  const updatedAt = manifest?.updatedAt;
  if (!updatedAt) return 0;
  if (typeof updatedAt?.toMillis === "function") {
    const ms = updatedAt.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof updatedAt?.toDate === "function") {
    const ms = updatedAt.toDate()?.getTime?.();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (updatedAt instanceof Date) {
    const ms = updatedAt.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const parsed = new Date(updatedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function rebuildMaterializedRows(db) {
  const { rows, manifest } = await materializedCache.rebuild(db, sortVideoDocsForPublic);
  sourceAudit = { checkedAt: Date.now(), signature: manifest.sourceSignature };
  publishedRowsCache = {
    manifestUpdatedAtMs: getManifestUpdatedAtMs(manifest),
    manifestGeneration: manifest.generation || null,
    lastVerifiedAtMs: Date.now(), rows, promise: null,
  };
  return rows;
}

export async function rebuildPremiumVideoLibraryMaterializedCache() {
  return rebuildMaterializedRows(getAdminDb());
}

export function clearPremiumVideoLibraryMemoryCache() {
  publishedRowsCache = {
    manifestUpdatedAtMs: 0,
    lastVerifiedAtMs: 0,
    rows: null,
    promise: null,
  };
}

function normalizePublishedVideoRow(docSnap) {
  if (!docSnap?.exists) return null;
  if (INTERNAL_DOC_IDS.has(docSnap.id)) return null;
  const row = { id: docSnap.id, ...(docSnap.data() || {}) };
  if (row.isPublished !== true) return null;
  return row;
}

export async function loadPremiumVideoLibraryRowById(videoId) {
  const id = typeof videoId === "string" ? videoId.trim() : "";
  if (!id || INTERNAL_DOC_IDS.has(id)) return null;

  const db = getAdminDb();
  const snap = await withFirestoreCostLog(
    {
      page: "api.video-library.detail",
      queryName: "videos.by_id",
      operationType: "document",
    },
    () => db.collection(COLLECTION).doc(id).get()
  );
  return normalizePublishedVideoRow(snap);
}

export async function loadPremiumVideoRelatedRows({
  category,
  excludeId,
  locale,
  limit = 12,
  nowMs = Date.now(),
  premiumActive = false,
}) {
  const catTrim = typeof category === "string" ? category.trim() : "";
  const exclude = typeof excludeId === "string" ? excludeId.trim() : "";
  if (!catTrim) return [];

  const localeNorm = normalizeLocale(typeof locale === "string" ? locale : undefined, "ro");

  try {
    // Reuse the already-materialized/in-memory published catalog instead of
    // issuing a fresh Firestore query on every video detail view. The catalog
    // is the same `isPublished == true` set, so the related list (same filter,
    // sort and slice below) produces an identical field-level output.
    const allRows = await loadPremiumVideoLibraryRows();
    recordFirestoreCacheHit({
      page: "api.video-library.detail",
      queryName: "videos.related_by_category",
    });

    const rows = allRows.filter((row) => {
      if (!row || row.isPublished !== true) return false;
      if (typeof row.id === "string" && row.id.trim() === exclude) return false;
      const rowCategory = typeof row.category === "string" ? row.category.trim() : "";
      return rowCategory === catTrim;
    });

    return sortVideoDocsForPublic(rows)
      .filter(
        (row) =>
          canViewerSeeVideo(row, premiumActive, nowMs) &&
          rowHasValidEmbedForLocale(row, localeNorm)
      )
      .slice(0, limit);
  } catch (error) {
    console.warn("[video-library] related lookup failed, returning empty", error?.message || error);
    return [];
  }
}

/**
 * Fetches chunk documents from Firestore based on the manifest's
 * `chunkDocIds`. Always loads the complete catalog: byte-sized chunks do not
 * represent pages or categories. Returns rows or null when a
 * chunk is missing / version-mismatched (caller should rebuild).
 */
async function fetchChunkRowsFromManifest(db, manifest) {
  if (!Array.isArray(manifest?.chunkDocIds)) return null;
  const chunkSnaps = await Promise.all(manifest.chunkDocIds.map(chunkId =>
    withFirestoreCostLog(
      { page: "api.video-library", queryName: "internalCaches.video_chunk", operationType: "document" },
      () => db.collection(CACHE_COLLECTION).doc(chunkId).get()
    )
  ));
  const rows = materializedCache.validateManifestRows(
    manifest, chunkSnaps.map(snap => snap.exists ? snap.data() : null)
  );
  return rows === null ? null : sortVideoDocsForPublic(rows);
}

/**
 * Reads only the manifest doc (1 read) and decides whether to reuse the
 * memory rows or refetch chunks. Returns the up-to-date rows and the new
 * `manifestUpdatedAtMs` stamp.
 */
async function verifyManifestAndLoadRows() {
  const db = getAdminDb();
  const manifestSnap = await withFirestoreCostLog(
    {
      page: "api.video-library",
      queryName: "internalCaches.video_manifest",
      operationType: "document",
    },
    () => db.collection(CACHE_COLLECTION).doc(PUBLIC_CACHE_DOC_ID).get()
  );

  if (!manifestSnap.exists) {
    const rows = await rebuildMaterializedRows(db);
    return { rows, manifestUpdatedAtMs: publishedRowsCache.manifestUpdatedAtMs || Date.now(), manifestGeneration: publishedRowsCache.manifestGeneration };
  }

  const manifest = manifestSnap.data() || {};
  const manifestUpdatedAtMs = getManifestUpdatedAtMs(manifest);

  if (!sourceAudit.checkedAt || Date.now() - sourceAudit.checkedAt >= SOURCE_AUDIT_INTERVAL_MS) {
    sourceAudit = { checkedAt: Date.now(), signature: await materializedCache.sourceSignature(db) };
  }
  if (sourceAudit.signature !== manifest.sourceSignature) {
    const rows = await rebuildMaterializedRows(db);
    return { rows, manifestUpdatedAtMs: publishedRowsCache.manifestUpdatedAtMs,
      manifestGeneration: publishedRowsCache.manifestGeneration };
  }

  // Same version stamp + rows in memory: reuse them. Hot path for "API is
  // just being polled, nothing changed" — costs exactly 1 read for the
  // request.
  if (
    publishedRowsCache.rows
    && manifestUpdatedAtMs > 0
    && manifestUpdatedAtMs === publishedRowsCache.manifestUpdatedAtMs
    && (manifest.generation || null) === (publishedRowsCache.manifestGeneration || null)
  ) {
    recordFirestoreCacheHit({
      page: "api.video-library",
      queryName: "memory.video_rows_unchanged",
    });
    return { rows: publishedRowsCache.rows, manifestUpdatedAtMs, manifestGeneration: manifest.generation || null };
  }

  // Empty catalog short-circuit.
  if (materializedCache.validateManifestRows(manifest, []) !== null) {
    return { rows: [], manifestUpdatedAtMs, manifestGeneration: manifest.generation || null };
  }

  const chunkRows = await fetchChunkRowsFromManifest(db, manifest);
  if (chunkRows !== null) {
    return { rows: chunkRows, manifestUpdatedAtMs, manifestGeneration: manifest.generation || null };
  }

  // Manifest looked corrupt (missing chunk / version skew) → full rebuild.
  const rows = await rebuildMaterializedRows(db);
  return {
    rows,
    manifestUpdatedAtMs: publishedRowsCache.manifestUpdatedAtMs || manifestUpdatedAtMs || Date.now(),
    manifestGeneration: publishedRowsCache.manifestGeneration,
  };
}

export async function loadPremiumVideoLibraryRows() {
  const now = Date.now();

  // Fast path: we verified the manifest very recently — skip the read entirely.
  if (
    publishedRowsCache.rows
    && now - publishedRowsCache.lastVerifiedAtMs < MANIFEST_VERIFY_INTERVAL_MS
  ) {
    recordFirestoreCacheHit({
      page: "api.video-library",
      queryName: "memory.video_rows",
    });
    return publishedRowsCache.rows;
  }

  if (!publishedRowsCache.promise) {
    publishedRowsCache.promise = verifyManifestAndLoadRows()
      .then(({ rows, manifestUpdatedAtMs, manifestGeneration }) => {
        publishedRowsCache = {
          manifestUpdatedAtMs,
          manifestGeneration: manifestGeneration || null,
          lastVerifiedAtMs: Date.now(),
          rows,
          promise: null,
        };
        return rows;
      })
      .catch((err) => {
        publishedRowsCache.promise = null;
        // Never replace a verified catalog with a partial result on failure.
        if (publishedRowsCache.rows !== null) {
          console.error("[video-library] Catalog refresh failed; retaining last complete catalog", err?.message);
          publishedRowsCache.lastVerifiedAtMs = Date.now();
          return publishedRowsCache.rows;
        }
        throw err;
      });
  }

  return publishedRowsCache.promise;
}

const DEFAULT_FEATURED_HOME_LIMIT = 2;

function filterPlayableVideoRows(
  sortedRows,
  localeNorm,
  nowMs,
  { excludeIds = null, premiumActive = false } = {}
) {
  const excluded = excludeIds instanceof Set ? excludeIds : null;
  return sortedRows.filter(
    (row) =>
      (!excluded || !excluded.has(row.id)) &&
      canViewerSeeVideo(row, premiumActive, nowMs) &&
      rowHasValidEmbedForLocale(row, localeNorm)
  );
}

function mapRowsToPublicDtos(rows, localeNorm, premiumActive, webClient) {
  return rows.map((row) =>
    mapVideoRowToPublicDto(row, { locale: localeNorm, premiumActive, webClient })
  );
}

/**
 * Homepage featured clips (max 2 by default), same publish/embed rules as public library.
 */
export async function loadFeaturedHomeVideos({
  locale,
  premiumActive,
  webClient = false,
  limit = DEFAULT_FEATURED_HOME_LIMIT,
} = {}) {
  const localeNorm = normalizeLocale(typeof locale === "string" ? locale : undefined, "ro");
  const nowMs = Date.now();
  const sortedRows = await loadPremiumVideoLibraryRows();
  const featuredRows = filterPlayableVideoRows(sortedRows, localeNorm, nowMs, {
    premiumActive,
  }).filter(
    (row) => row.featuredOnHome === true
  );
  const capped =
    limit != null && limit > 0 ? featuredRows.slice(0, limit) : featuredRows;
  return mapRowsToPublicDtos(capped, localeNorm, premiumActive, webClient);
}

/**
 * Published video library as public DTOs (same shape as GET /api/premium/video-library).
 *
 * @param {{ locale?: string; premiumActive: boolean; previewLimit?: number | null; premiumSpotlightOnly?: boolean; webClient?: boolean; excludeIds?: string[] | Set<string> }} opts
 * When previewLimit is a positive number, only that many clips are returned (same newest-first order as /videouri).
 */
export async function loadPremiumVideoLibraryVideos({
  locale,
  premiumActive,
  previewLimit = null,
  premiumSpotlightOnly = false,
  webClient = false,
  excludeIds = null,
}) {
  const localeNorm = normalizeLocale(typeof locale === "string" ? locale : undefined, "ro");
  const nowMs = Date.now();
  const sortedRows = await loadPremiumVideoLibraryRows();
  const excluded =
    excludeIds instanceof Set
      ? excludeIds
      : Array.isArray(excludeIds)
        ? new Set(excludeIds.filter((id) => typeof id === "string" && id.trim()))
        : null;
  let playable = filterPlayableVideoRows(sortedRows, localeNorm, nowMs, {
    excludeIds: excluded,
    premiumActive,
  });

  if (premiumSpotlightOnly) {
    playable = playable.filter(
      (row) =>
        resolveVideoReleasePhase(row, nowMs).requiresPremium === true &&
        !isVideoCreatedBeforePremiumSpotlightCutoff(row),
    );
  }

  if (previewLimit != null && previewLimit > 0) {
    playable = playable.slice(0, previewLimit);
  }

  return mapRowsToPublicDtos(playable, localeNorm, premiumActive, webClient);
}

export const CATEGORY_VIDEOS_INITIAL_LIMIT = 4;
export const CATEGORY_VIDEOS_LOAD_MORE_LIMIT = 2;
export const CATEGORY_VIDEOS_MAX_LIMIT = 50;

function rowMatchesCategory(row, { categorySlug, categoryName }) {
  const cat = typeof row?.category === "string" ? row.category.trim() : "";
  if (!cat) {
    return false;
  }
  const normalizedSlug =
    typeof categorySlug === "string" ? categorySlug.trim().toLowerCase() : "";
  const normalizedName =
    typeof categoryName === "string" ? categoryName.trim() : "";
  if (normalizedSlug && slugify(cat) === normalizedSlug) {
    return true;
  }
  if (normalizedName && cat === normalizedName) {
    return true;
  }
  return false;
}

/**
 * Paginated category feed (newest-first), same DTO shape as full library list.
 */
export async function loadPremiumVideoLibraryVideosByCategory({
  locale,
  premiumActive,
  premiumSpotlightOnly = false,
  webClient = false,
  categorySlug = null,
  categoryName = null,
  limit = CATEGORY_VIDEOS_INITIAL_LIMIT,
  cursor = null,
}) {
  const localeNorm = normalizeLocale(typeof locale === "string" ? locale : undefined, "ro");
  const nowMs = Date.now();
  const sortedRows = await loadPremiumVideoLibraryRows();
  let playable = filterPlayableVideoRows(sortedRows, localeNorm, nowMs, {
    premiumActive,
  });

  if (premiumSpotlightOnly) {
    playable = playable.filter(
      (row) =>
        resolveVideoReleasePhase(row, nowMs).requiresPremium === true &&
        !isVideoCreatedBeforePremiumSpotlightCutoff(row)
    );
  }

  const categoryRows = playable.filter((row) =>
    rowMatchesCategory(row, { categorySlug, categoryName })
  );
  const totalCount = categoryRows.length;

  let startIndex = 0;
  const cursorId = typeof cursor === "string" ? cursor.trim() : "";
  if (cursorId) {
    const cursorIndex = categoryRows.findIndex((row) => row.id === cursorId);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  }

  const parsedLimit = Number.parseInt(String(limit), 10);
  const pageLimit = Math.max(
    1,
    Math.min(
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : CATEGORY_VIDEOS_INITIAL_LIMIT,
      CATEGORY_VIDEOS_MAX_LIMIT
    )
  );

  const pageRows = categoryRows.slice(startIndex, startIndex + pageLimit);
  const videos = mapRowsToPublicDtos(pageRows, localeNorm, premiumActive, webClient);
  const hasMore = startIndex + pageRows.length < totalCount;
  const nextCursor =
    hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null;

  return {
    videos,
    nextCursor,
    hasMore,
    totalCount,
  };
}
