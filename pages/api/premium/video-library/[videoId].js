import { resolveDescriptions } from "../../../../lib/videoDescriptionStorage.cjs";
import { getOptionalAuth } from "../../../../lib/requireAuth";
import { normalizeLocale, readSingleQueryValue } from "../../../../lib/courses";
import { setDynamicPublicCacheHeaders } from "../../../../lib/httpCache";
import {
  resolveRowVideoSourceWithMeta,
  rowHasDirectValidEmbedForLocale,
  rowHasValidEmbedForLocale,
} from "../../../../lib/videoLibraryPublic";
import {
  canViewerSeeVideo,
  getNextVideoTransitionAtMs,
} from "../../../../lib/videoReleaseSchedule";
import {
  loadPremiumVideoLibraryRowById,
  loadPremiumVideoRelatedRows,
} from "../../../../lib/loadPremiumVideoLibrary";
import { mapVideoRowToPublicDto } from "../../../../lib/videoLibraryPublicMapper";
import {
  resolvePublicVideoLibraryPremiumActive,
  resolveVideoLibraryPremiumAccessForUser,
} from "../../../../lib/videoLibraryAccess";
import {
  auditPremiumVideoAccess,
  buildClientAccessDebug,
} from "../../../../lib/premiumVideoAccessAudit";
import { isSubscriptionSystemEnabled } from "../../../../lib/globalSettings";
import { withFirestoreReadTelemetry } from "../../../../lib/firestoreCostLogger";
import { getVideoLikeSummary } from "../../../../lib/videoLikes";
import { getVideoCommentCount } from "../../../../lib/videoComments";
import { normalizeAppPlatform } from "../../../../lib/appPlatform";
import {
  auditVideoPlayback,
  buildVideoRequestTelemetry,
} from "../../../../lib/videoLibraryPlaybackAudit";
import {
  recordVideoLibraryView,
  resolveClientIpFromRequest,
} from "../../../../lib/videoViews";

function buildRequestId() {
  return `vld_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const RELATED_LIMIT = 12;
const INTERNAL_VIDEO_DOC_IDS = new Set(["_meta", "_publicCache"]);

// eslint-disable-next-line global-require, import/no-dynamic-require
const nextI18nRoot = require("../../../../next-i18next.config.js");
const SITE_LOCALES =
  Array.isArray(nextI18nRoot.i18n?.locales) && nextI18nRoot.i18n.locales.length > 0
    ? nextI18nRoot.i18n.locales
    : ["ro"];

async function handler(req, res) {
  const requestId = buildRequestId();
  const requestTelemetry = buildVideoRequestTelemetry(req);
  res.setHeader("X-Request-Id", requestId);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed", requestId });
  }

  const rawId = typeof req.query.videoId === "string" ? req.query.videoId.trim() : "";
  if (!rawId || INTERNAL_VIDEO_DOC_IDS.has(rawId)) {
    auditVideoPlayback(
      "detail_rejected",
      {
        requestId,
        videoId: rawId || null,
        reason: "invalid_video_id",
        client: requestTelemetry,
      },
      "warn"
    );
    return res.status(404).json({ error: "Not found", requestId });
  }

  const hasAuthHeader = typeof req.headers?.authorization === "string" && req.headers.authorization.trim() !== "";
  const decoded = await getOptionalAuth(req);
  const uid = decoded?.uid || null;

  try {
    const localeRaw = readSingleQueryValue(req.query.locale);
    const locale = normalizeLocale(
      typeof localeRaw === "string" ? localeRaw : undefined,
      "ro"
    );

    const clientRaw = readSingleQueryValue(req.query.client);
    const webClient =
      typeof clientRaw === "string" && clientRaw.trim().toLowerCase() === "web";
    const appPlatform = normalizeAppPlatform(req.query.appPlatform);

    const subscriptionSystemEnabled = await isSubscriptionSystemEnabled();
    let premiumActive = false;
    let accessExplain = null;
    let userDocExists = null;

    if (uid) {
      const resolved = await resolveVideoLibraryPremiumAccessForUser(uid, {
        stage: "video_library_detail",
        requestId,
        videoId: rawId,
        webClient,
        appPlatform,
      });
      premiumActive = resolved.premiumActive;
      accessExplain = resolved.accessExplain;
      userDocExists = resolved.userDocExists;
    } else if (hasAuthHeader) {
      premiumActive = false;
      accessExplain = {
        hasAccess: false,
        reason: "auth_token_invalid_or_expired",
        snapshot: null,
        now: new Date().toISOString(),
      };
    } else {
      premiumActive = await resolvePublicVideoLibraryPremiumActive({ webClient, appPlatform });
    }

    const nowMs = Date.now();
    const targetRow = await loadPremiumVideoLibraryRowById(rawId);
    const viewerCanSeeVideo =
      Boolean(targetRow) && canViewerSeeVideo(targetRow, premiumActive, nowMs);
    if (!targetRow || !viewerCanSeeVideo) {
      auditVideoPlayback(
        "detail_not_found",
        {
          requestId,
          videoId: rawId,
          reason: targetRow ? "not_visible_for_viewer" : "video_missing",
          premiumActive,
          loggedIn: Boolean(uid),
          locale,
          client: requestTelemetry,
        },
        "warn"
      );
      return res.status(404).json({ error: "Not found", requestId });
    }

    const availableLocales = SITE_LOCALES.filter((lc) =>
      rowHasDirectValidEmbedForLocale(targetRow, lc)
    );
    const sourceResolution = resolveRowVideoSourceWithMeta(targetRow, locale);

    if (!rowHasValidEmbedForLocale(targetRow, locale)) {
      auditVideoPlayback(
        "detail_source_invalid",
        {
          requestId,
          videoId: rawId,
          locale,
          availableLocales,
          sourceStrategy: sourceResolution.strategy,
          sourceLocale: sourceResolution.sourceLocale,
          platform: targetRow?.platform || null,
          hasRootVideoUrl: Boolean(
            typeof targetRow?.videoUrl === "string" && targetRow.videoUrl.trim()
          ),
          localizedVideoUrlKeys: Object.keys(targetRow?.locales || {}).filter(
            (key) =>
              typeof targetRow?.locales?.[key]?.videoUrl === "string" &&
              targetRow.locales[key].videoUrl.trim()
          ),
          client: requestTelemetry,
        },
        "warn"
      );
      return res.status(404).json({ error: "Not found", requestId });
    }

    const ctx = { locale, premiumActive, webClient };
    const [videoLikeSummary, commentsCount] = await Promise.all([
      getVideoLikeSummary(rawId, uid),
      getVideoCommentCount(rawId),
    ]);
    const [completeTarget] = await resolveDescriptions([targetRow]);
    const video = {
      ...mapVideoRowToPublicDto(completeTarget, ctx),
      likesCount: videoLikeSummary.likesCount,
      likedByCurrentUser: videoLikeSummary.likedByCurrentUser,
      commentsCount,
    };

    const catTrim = typeof video.category === "string" ? video.category.trim() : "";
    const relatedRows = catTrim
      ? await loadPremiumVideoRelatedRows({
          category: catTrim,
          excludeId: rawId,
          locale,
          limit: RELATED_LIMIT,
          nowMs,
          premiumActive,
        })
      : [];
    const related = relatedRows.map((row) => mapVideoRowToPublicDto(row, ctx));

    let cacheTtlSec = 0;
    if (uid || hasAuthHeader) {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    } else {
      const nextPublishAtMs = getNextVideoTransitionAtMs(
        [targetRow, ...relatedRows],
        nowMs
      );
      const cacheMeta = setDynamicPublicCacheHeaders(res, {
        nowMs,
        nextPublishAtMs,
        maxAgeSeconds: 30,
        staleWhileRevalidateSeconds: nextPublishAtMs != null ? 0 : 30,
      });
      cacheTtlSec = cacheMeta.cacheTtlSec;
    }

    const mismatch =
      video?.isPremium === true &&
      premiumActive === true &&
      video?.canPlay !== true;

    auditPremiumVideoAccess({
      stage: "video_library_detail_response",
      level: mismatch ? "warn" : "info",
      requestId,
      uid: uid || null,
      videoId: rawId,
      premiumActive,
      subscriptionSystemEnabled,
      hasAccess: accessExplain?.hasAccess,
      accessReason: accessExplain?.reason || null,
      accessSnapshot: accessExplain?.snapshot || null,
      userDocExists,
      hasAuthHeader,
      videoIsPremium: video?.isPremium === true,
      videoCanPlay: video?.canPlay === true,
      videoLockedReason: video?.lockedReason || null,
      mismatch: mismatch ? "premium_user_but_video_dto_locked" : null,
      locale,
    });

    const playbackWarning =
      !video?.embedSrc ||
      (video?.platform === "bunny" && !video?.hlsSrc) ||
      video?.lockedReason === "source_invalid";
    auditVideoPlayback(
      "detail_response",
      {
        requestId,
        uid: uid || null,
        videoId: rawId,
        locale,
        availableLocales,
        loggedIn: Boolean(uid),
        premiumActive,
        platform: video?.platform || null,
        canPlay: video?.canPlay === true,
        isPremium: video?.isPremium === true,
        lockedReason: video?.lockedReason || null,
        hasEmbedSrc: Boolean(video?.embedSrc),
        hasHlsSrc: Boolean(video?.hlsSrc),
        hasVideoUrl: Boolean(video?.videoUrl),
        sourceStrategy: sourceResolution.strategy,
        sourceLocale: sourceResolution.sourceLocale,
        usedCompatibilityFallback:
          sourceResolution.strategy === "ro_fallback" ||
          sourceResolution.strategy === "first_locale_fallback",
        client: requestTelemetry,
      },
      playbackWarning ? "warn" : "info"
    );

    void recordVideoLibraryView({
      videoId: rawId,
      uid,
      clientIp: resolveClientIpFromRequest(req),
      locale,
      nowMs,
    }).catch((error) => {
      console.warn("[premium.video-library.detail] view count failed", {
        requestId,
        videoId: rawId,
        message: error?.message || error,
      });
    });

    return res.status(200).json({
      video,
      related,
      locale,
      availableLocales,
      premiumActive,
      loggedIn: Boolean(uid),
      generatedAt: new Date(nowMs).toISOString(),
      cacheTtlSec,
      requestId,
      accessDebug: uid || hasAuthHeader
        ? buildClientAccessDebug(accessExplain, {
            userDocExists,
            hasAuthHeader,
            subscriptionSystemEnabled,
            videoId: rawId,
            videoIsPremium: video?.isPremium === true,
            videoCanPlay: video?.canPlay === true,
            videoLockedReason: video?.lockedReason || null,
          })
        : undefined,
    });
  } catch (error) {
    console.error("[premium.video-library.detail] failed", {
      requestId,
      message: error?.message || error,
      videoId: rawId,
      uid: uid || null,
      client: requestTelemetry,
    });
    return res.status(500).json({ error: "Failed to load video", requestId });
  }
}

export default withFirestoreReadTelemetry("/api/premium/video-library/[videoId]", handler);
