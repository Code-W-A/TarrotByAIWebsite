import { normalizeLocale, readSingleQueryValue } from "../../../lib/courses";
import { setDynamicPublicCacheHeaders } from "../../../lib/httpCache";
import { loadPremiumVideoLibraryRows, loadPremiumVideoLibraryVideos, loadPremiumVideoLibraryVideosByCategory, CATEGORY_VIDEOS_INITIAL_LIMIT, CATEGORY_VIDEOS_LOAD_MORE_LIMIT } from "../../../lib/loadPremiumVideoLibrary";
import { getOptionalAuth } from "../../../lib/requireAuth";
import { getNextVideoTransitionAtMs } from "../../../lib/videoReleaseSchedule";
import {
  resolvePublicVideoLibraryPremiumActive,
  resolveVideoLibraryPremiumAccessForUser,
} from "../../../lib/videoLibraryAccess";
import {
  auditVideoLibraryResponse,
  buildClientAccessDebug,
} from "../../../lib/premiumVideoAccessAudit";
import { isSubscriptionSystemEnabled } from "../../../lib/globalSettings";
import { withFirestoreReadTelemetry } from "../../../lib/firestoreCostLogger";
import { resolveRowVideoSourceWithMeta } from "../../../lib/videoLibraryPublic";
import { normalizeAppPlatform } from "../../../lib/appPlatform";
import {
  auditVideoPlayback,
  buildVideoRequestTelemetry,
  summarizeVideoPlaybackDtos,
} from "../../../lib/videoLibraryPlaybackAudit";

function buildRequestId() {
  return `vl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function handler(req, res) {
  const requestId = buildRequestId();
  const requestTelemetry = buildVideoRequestTelemetry(req);
  res.setHeader("X-Request-Id", requestId);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed", requestId });
  }

  const decoded = await getOptionalAuth(req);
  const uid = decoded?.uid || null;

  try {
    const localeRaw = readSingleQueryValue(req.query.locale);
    const locale = normalizeLocale(
      typeof localeRaw === "string" ? localeRaw : undefined,
      "ro"
    );

    const scopeRaw = readSingleQueryValue(req.query.scope);
    const premiumSpotlightOnly = scopeRaw === "premium_zone";

    const clientRaw = readSingleQueryValue(req.query.client);
    const webClient =
      typeof clientRaw === "string" && clientRaw.trim().toLowerCase() === "web";
    const appPlatform = normalizeAppPlatform(req.query.appPlatform);

    const categorySlugRaw = readSingleQueryValue(req.query.categorySlug);
    const categoryNameRaw = readSingleQueryValue(req.query.category);
    const categorySlug =
      typeof categorySlugRaw === "string" && categorySlugRaw.trim()
        ? categorySlugRaw.trim().toLowerCase()
        : null;
    const categoryName =
      typeof categoryNameRaw === "string" && categoryNameRaw.trim()
        ? categoryNameRaw.trim()
        : null;
    const categoryFilterActive = Boolean(categorySlug || categoryName);

    const cursorRaw = readSingleQueryValue(req.query.cursor);
    const cursor =
      typeof cursorRaw === "string" && cursorRaw.trim() ? cursorRaw.trim() : null;

    const limitRaw = readSingleQueryValue(req.query.limit);
    const parsedLimit = Number.parseInt(String(limitRaw || ""), 10);
    const defaultCategoryLimit = cursor ? CATEGORY_VIDEOS_LOAD_MORE_LIMIT : CATEGORY_VIDEOS_INITIAL_LIMIT;
    const categoryLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultCategoryLimit;

    const hasAuthHeader =
      typeof req.headers?.authorization === "string" && req.headers.authorization.trim() !== "";
    const subscriptionSystemEnabled = await isSubscriptionSystemEnabled();

    let premiumActive = false;
    let accessExplain = null;
    let userDocExists = null;

    if (uid) {
      const resolved = await resolveVideoLibraryPremiumAccessForUser(uid, {
        stage: "video_library_list",
        requestId,
        webClient,
        appPlatform,
      });
      premiumActive = resolved.premiumActive;
      accessExplain = resolved.accessExplain;
      userDocExists = resolved.userDocExists;
    } else {
      premiumActive = await resolvePublicVideoLibraryPremiumActive({ webClient, appPlatform });
      if (hasAuthHeader && !uid) {
        accessExplain = {
          hasAccess: false,
          reason: "auth_token_invalid_or_expired",
          snapshot: null,
          now: new Date().toISOString(),
        };
      }
    }

    const [videosResult, rowsForMeta] = await Promise.all([
      categoryFilterActive
        ? loadPremiumVideoLibraryVideosByCategory({
            locale,
            premiumActive,
            premiumSpotlightOnly,
            webClient,
            categorySlug,
            categoryName,
            limit: categoryLimit,
            cursor,
          })
        : loadPremiumVideoLibraryVideos({
            locale,
            premiumActive,
            premiumSpotlightOnly,
            webClient,
          }).then((videos) => ({ videos, nextCursor: null, hasMore: false, totalCount: videos.length })),
      loadPremiumVideoLibraryRows(),
    ]);

    const videos = videosResult.videos;
    const playbackSummary = summarizeVideoPlaybackDtos(videos);
    const returnedVideoIds = new Set(videos.map((video) => video?.id).filter(Boolean));
    const sourceResolution = {
      requestedLocale: 0,
      root: 0,
      roFallback: 0,
      firstLocaleFallback: 0,
      missing: 0,
    };
    rowsForMeta.forEach((row) => {
      if (!returnedVideoIds.has(row?.id)) return;
      const resolved = resolveRowVideoSourceWithMeta(row, locale);
      if (resolved.strategy === "requested_locale") sourceResolution.requestedLocale += 1;
      else if (resolved.strategy === "root") sourceResolution.root += 1;
      else if (resolved.strategy === "ro_fallback") sourceResolution.roFallback += 1;
      else if (resolved.strategy === "first_locale_fallback") {
        sourceResolution.firstLocaleFallback += 1;
      } else sourceResolution.missing += 1;
    });

    const nowMs = Date.now();
    let cacheMeta = { cacheTtlSec: 0 };
    if (uid) {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    } else {
      const nextVideoTransitionAtMs = getNextVideoTransitionAtMs(
        rowsForMeta,
        nowMs
      );
      cacheMeta = setDynamicPublicCacheHeaders(res, {
        nowMs,
        nextPublishAtMs: nextVideoTransitionAtMs,
        maxAgeSeconds: 300,
        staleWhileRevalidateSeconds:
          nextVideoTransitionAtMs != null ? 0 : 600,
      });
    }

    auditVideoLibraryResponse({
      stage: "video_library_list_response",
      requestId,
      uid,
      premiumActive,
      subscriptionSystemEnabled,
      accessExplain,
      videos,
      extra: {
        locale,
        scope: scopeRaw || null,
        hasAuthHeader,
        userDocExists,
        loggedIn: Boolean(uid),
      },
    });

    const hasPlaybackWarning =
      playbackSummary.invalidSource > 0 ||
      playbackSummary.bunnyMissingEmbed > 0 ||
      playbackSummary.bunnyMissingHls > 0 ||
      sourceResolution.missing > 0;
    auditVideoPlayback(
      "list_response",
      {
        requestId,
        uid: uid || null,
        locale,
        scope: scopeRaw || null,
        webClient,
        appPlatform,
        categorySlug,
        category: categoryName,
        cursorPresent: Boolean(cursor),
        requestedLimit: categoryFilterActive ? categoryLimit : null,
        premiumActive,
        loggedIn: Boolean(uid),
        client: requestTelemetry,
        playbackSummary,
        sourceResolution,
      },
      hasPlaybackWarning ? "warn" : "info"
    );

    const responsePayload = {
      // The root description is already resolved for the requested locale.
      // Lists need localized titles/sources, not every translated transcript.
      // Clone the DTOs so detail responses and cached rows remain complete.
      videos: videos.map((video) => ({
        ...video,
        ...(video.locales
          ? {
              locales: Object.fromEntries(
                Object.entries(video.locales).map(([key, entry]) => {
                  const { description, ...metadata } = entry;
                  return [key, metadata];
                })
              ),
            }
          : {}),
      })),
      locale,
      premiumActive,
      loggedIn: Boolean(uid),
      generatedAt: new Date(nowMs).toISOString(),
      cacheTtlSec: cacheMeta.cacheTtlSec,
      requestId,
      ...(categoryFilterActive
        ? {
            nextCursor: videosResult.nextCursor,
            hasMore: videosResult.hasMore,
            totalCount: videosResult.totalCount,
            categorySlug,
            category: categoryName,
          }
        : {}),
      accessDebug: uid
        ? buildClientAccessDebug(accessExplain, {
            userDocExists,
            hasAuthHeader,
            subscriptionSystemEnabled,
          })
        : hasAuthHeader
          ? buildClientAccessDebug(accessExplain, {
              hasAuthHeader: true,
              subscriptionSystemEnabled,
            })
          : undefined,
    };
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("[premium.video-library] failed", {
      requestId,
      message: error?.message || String(error),
      stackTop: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 3).join(" | ") : null,
      uid: uid || null,
      query: req.query || {},
      client: requestTelemetry,
    });
    return res.status(500).json({ error: "Failed to load video library", requestId });
  }
}

export default withFirestoreReadTelemetry("/api/premium/video-library", handler);
