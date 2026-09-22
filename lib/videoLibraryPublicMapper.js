import { extractVimeoId } from "./courses";
import { getYoutubeVideoId } from "../utils/youtubeLinkUtils";
import { sortVideoDocsForPublic } from "./videoLibrarySort";
import {
  isVideoCreatedBeforePremiumSpotlightCutoff,
  isVideoPublishScheduled,
  normalizeVideoPlatform,
  resolveBunnyHlsSrcFromVideoUrl,
  resolveBunnyThumbnailFromVideoUrl,
  resolveLibraryEmbedSrc,
  resolveRowVideoSource,
  resolveVideoLocaleStrings,
} from "./videoLibraryPublic";
import { resolveVideoReleasePhase } from "./videoReleaseSchedule";
import { normalizeVideoChapters } from "./videoChapters";

function premiumWorkaroundTreatAsFree(row, platformNorm) {
  if (platformNorm !== "youtube" && platformNorm !== "vimeo") return false;
  return isVideoCreatedBeforePremiumSpotlightCutoff(row);
}

/**
 * Per-locale metadata for clients (Expo / web) — same sources as dashboard video dialog.
 * Only string fields; no Firestore Timestamps or admin-only keys.
 * @param {Record<string, any> | undefined} locales
 * @returns {Record<string, { title?: string; description?: string; videoUrl?: string }> | undefined}
 */
function sanitizeLocalesForPublic(locales) {
  if (!locales || typeof locales !== "object") return undefined;
  const out = {};
  for (const key of Object.keys(locales)) {
    const entry = locales[key];
    if (!entry || typeof entry !== "object") continue;
    const videoUrl = typeof entry.videoUrl === "string" ? entry.videoUrl.trim() : "";
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (!videoUrl && !title && !description) continue;
    const node = {};
    if (videoUrl) node.videoUrl = videoUrl;
    if (title) node.title = title;
    if (description) node.description = description;
    if (Object.keys(node).length) out[key] = node;
  }
  return Object.keys(out).length ? out : undefined;
}

function resolvePublicThumbnailUrl(row, platform, effectiveVideoUrl) {
  const fromDoc = typeof row.thumbnailUrl === "string" ? row.thumbnailUrl.trim() : "";
  if (fromDoc) return fromDoc;

  const url = typeof effectiveVideoUrl === "string" ? effectiveVideoUrl.trim() : "";

  if (platform === "bunny") {
    const bunnyThumb = resolveBunnyThumbnailFromVideoUrl(platform, url);
    return bunnyThumb || null;
  }

  if (platform === "vimeo" && url) {
    const id = extractVimeoId(url);
    if (!id) return null;
    return `https://vumbnail.com/${id}.jpg`;
  }

  if (!url || platform !== "youtube") return null;

  const id = getYoutubeVideoId(url);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * @param {FirebaseFirestore.QuerySnapshot} snapshot
 * @param {number} [nowMs]
 * @returns {object[]} rows with id, sorted for public display
 */
export function collectAndSortPublishedVideos(snapshot, nowMs = Date.now()) {
  const rawList = [];
  snapshot.forEach((docSnap) => {
    if (docSnap.id === "_meta") return;
    const row = docSnap.data() || {};
    if (!row.isPublished) return;
    if (isVideoPublishScheduled(row.publishAt, nowMs)) return;
    rawList.push({
      ...row,
      id: docSnap.id,
    });
  });
  return sortVideoDocsForPublic(rawList);
}

/**
 * @param {object} row Must include id (Firestore doc id).
 * @param {{ locale: string; premiumActive: boolean; webClient?: boolean }} ctx
 */
export function mapVideoRowToPublicDto(row, { locale, premiumActive, webClient = false }) {
  const platform = normalizeVideoPlatform(row.platform);
  const flaggedPremium = row.isPremium === true;
  const release = resolveVideoReleasePhase(row);
  const requiresPremium = release.hasDualRelease
    ? release.requiresPremium
    : flaggedPremium && !premiumWorkaroundTreatAsFree(row, platform);
  let canPlay = !requiresPremium || premiumActive;

  const { title, description } = resolveVideoLocaleStrings(
    row.locales,
    row.title,
    row.description,
    locale
  );

  const rawVideoUrl = resolveRowVideoSource(row, locale);

  /** Always compute embed when source exists so mobile/Web can play after unlock (rewarded ad, purchase) without a second fetch. Public iframe URLs are not secret. */
  let embedSrc = null;
  if (rawVideoUrl) {
    embedSrc = resolveLibraryEmbedSrc(platform, rawVideoUrl);
  }

  let lockedReason = null;
  if (!canPlay) {
    lockedReason = "premium_required";
  } else if (!embedSrc) {
    lockedReason = "source_invalid";
  }

  const thumbnailUrl = resolvePublicThumbnailUrl(row, platform, rawVideoUrl);
  const chapters = normalizeVideoChapters(row.chapters, { locale, includeLocales: true });
  let localesPublic = sanitizeLocalesForPublic(row.locales);
  const rootVideoUrl = typeof row.videoUrl === "string" ? row.videoUrl.trim() : "";
  let publicVideoUrl = rawVideoUrl || rootVideoUrl || null;
  let hlsSrc = resolveBunnyHlsSrcFromVideoUrl(platform, rawVideoUrl || rootVideoUrl);

  /** All free videos are app-only on web, including dual-release videos after T2. */
  if (webClient && !requiresPremium) {
    canPlay = false;
    lockedReason = "app_only";
    embedSrc = null;
    publicVideoUrl = null;
    hlsSrc = null;
    if (localesPublic) {
      localesPublic = Object.fromEntries(
        Object.entries(localesPublic).map(([key, entry]) => {
          const { videoUrl: _removed, ...rest } = entry;
          return [key, rest];
        })
      );
    }
  }

  return {
    id: row.id,
    title: title || "",
    description: typeof description === "string" ? description : "",
    category: typeof row.category === "string" ? row.category : "",
    thumbnailUrl,
    platform,
    durationSeconds: typeof row.durationSeconds === "number" ? row.durationSeconds : null,
    order: typeof row.order === "number" ? row.order : null,
    canPlay,
    isPremium: requiresPremium,
    /** Raw stream URL for request locale (Bunny play URL, YouTube link, etc.) — same as dashboard dialog. */
    videoUrl: publicVideoUrl,
    embedSrc,
    hlsSrc,
    lockedReason,
    chapters,
    /** Localized titles/descriptions/videoUrl keys for multi-language playback (mobile + web). */
    locales: localesPublic,
    featuredOnHome: row.featuredOnHome === true,
    publicReleaseAt:
      Number.isFinite(release.publicReleaseAtMs)
        ? new Date(release.publicReleaseAtMs).toISOString()
        : null,
    releasePhase: release.phase,
  };
}
