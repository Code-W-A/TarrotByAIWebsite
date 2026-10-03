import SubscriptionRecurringNotice from "../../components/VideoLibrary/SubscriptionRecurringNotice";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import PublicVideoThumbnail from "../../components/VideoLibrary/PublicVideoThumbnail";
import VideoPremiumThumbBadge from "../../components/VideoLibrary/VideoPremiumThumbBadge";
import BunnyHlsPlayer from "../../components/VideoLibrary/BunnyHlsPlayer";
import VideoChapters from "../../components/VideoLibrary/VideoChapters";
import { useAuth } from "../../context/AuthContext";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";
import { isVideoPlayableForUser, isVideoAppOnlyLocked } from "../../lib/videoLibraryClientUtils";
import VideoAppOnlyCta from "../../components/VideoLibrary/VideoAppOnlyCta";
import { LANGUAGE_LABELS } from "../../data/constants";
import { resolveUiLocale } from "../../lib/siteLocales";
import AdPlacementShell from "../../components/Ads/AdPlacementShell";
import VideoPlaybackConsentModal from "../../components/VideoPlayback/VideoPlaybackConsentModal";
import {
  resolveLibraryPlatform,
  useVideoPlaybackConsentGate,
} from "../../lib/videoPlaybackConsent";
import { appendLibraryAutoplayParams } from "../../lib/videoLibraryPublic";
import VideoComments from "../../components/VideoLibrary/VideoComments";

export async function getServerSideProps({ locale }) {
  const uiLocale = resolveUiLocale(locale);
  return {
    props: {
      ...(await serverSideTranslations(uiLocale, ["common"])),
    },
  };
}

function formatDuration(seconds, fallback) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) return fallback;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const skeletonShine =
  "bg-skeleton-shine bg-[length:200%_100%] animate-skeleton-shine";

function VideoDetailSkeleton() {
  return (
    <div className="space-y-6 xl:grid xl:grid-cols-[1fr_340px] xl:gap-10 xl:space-y-0">
      <div className="space-y-4">
        <div className={`aspect-video w-full rounded-xl ${skeletonShine}`} />
        <div className={`h-8 max-w-2xl rounded-lg ${skeletonShine}`} />
        <div className={`h-4 max-w-md rounded ${skeletonShine}`} />
        <div className={`h-24 max-w-3xl rounded-lg ${skeletonShine}`} />
      </div>
      <div className="hidden space-y-4 xl:block">
        <div className={`h-6 w-40 rounded ${skeletonShine}`} />
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="flex gap-3">
            <div className={`aspect-video w-36 shrink-0 rounded-lg ${skeletonShine}`} />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <div className={`h-4 w-full rounded ${skeletonShine}`} />
              <div className={`h-3 w-2/3 rounded ${skeletonShine}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VideoDetailPage() {
  const router = useRouter();
  const { t } = useTranslation("common");
  const { currentUser, isGuestUser, userData } = useAuth();
  const playerWrapRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [availableLocales, setAvailableLocales] = useState([]);
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState("");
  const [chapterSeekRequest, setChapterSeekRequest] = useState(null);
  const [chapterMessage, setChapterMessage] = useState("");
  const {
    consentGranted,
    modalVisible,
    recording,
    requestPlayback,
    handleAccept,
    handleDecline,
  } = useVideoPlaybackConsentGate({
    userData,
    onDecline: () => router.back(),
  });

  const videoIdRaw = router.query.videoId;
  const videoId = useMemo(
    () => (typeof videoIdRaw === "string" ? videoIdRaw : Array.isArray(videoIdRaw) ? videoIdRaw[0] : ""),
    [videoIdRaw]
  );

  const load = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setNotFound(false);
    setLoadError("");
    setVideo(null);
    setRelated([]);
      setAvailableLocales([]);
      setChapterSeekRequest(null);
      setChapterMessage("");
    try {
      const locale = router.locale || "ro";
      const headers = await getFirebaseBearerHeader({ required: false });
      const res = await fetch(
        `/api/premium/video-library/${encodeURIComponent(videoId)}?locale=${encodeURIComponent(locale)}&client=web`,
        {
          headers: {
            Accept: "application/json",
            ...headers,
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error || "load_failed");
      }
      setVideo(data?.video || null);
      setRelated(Array.isArray(data?.related) ? data.related : []);
      setAvailableLocales(Array.isArray(data?.availableLocales) ? data.availableLocales : []);
      setLikeError("");
    } catch (e) {
      console.error("[video-detail]", e?.message || e);
      setLoadError(t("videoLibraryLoadError"));
    } finally {
      setLoading(false);
    }
  }, [router.locale, t, videoId]);

  useEffect(() => {
    if (!router.isReady || !videoId) return;
    load();
  }, [load, router.isReady, videoId, currentUser?.uid]);

  const videoIsPlayable = isVideoPlayableForUser(video, userData);
  const bunnyHlsPlayable =
    videoIsPlayable &&
    video?.platform === "bunny" &&
    typeof video?.hlsSrc === "string" &&
    video.hlsSrc.trim();

  useEffect(() => {
    if (!video?.id || !videoIsPlayable) return;
    void requestPlayback({
      contentType: "library",
      contentId: video.id,
      platform: resolveLibraryPlatform(video),
      title: video.title || "",
      locale: router.locale || "ro",
    });
  }, [
    requestPlayback,
    router.locale,
    video?.id,
    video?.platform,
    video?.title,
    videoIsPlayable,
  ]);

  useEffect(() => {
    const el = playerWrapRef.current;
    const sync = () => {
      setFullscreenActive(Boolean(document.fullscreenElement && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [video?.id]);

  const toggleFullscreen = useCallback(async () => {
    const el = playerWrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* noop */
    }
  }, []);

  const handleChapterSelect = useCallback(
    (chapter) => {
      const seconds = Number(chapter?.startSeconds);
      if (!Number.isFinite(seconds) || seconds < 0) return;
      if (!videoIsPlayable) return;
      if (!bunnyHlsPlayable) {
        setChapterMessage("Saltul este disponibil pentru Bunny după configurarea sursei HLS.");
        return;
      }
      setChapterMessage("");
      setChapterSeekRequest({ seconds, nonce: Date.now() });
      playerWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [bunnyHlsPlayable, videoIsPlayable]
  );

  const handleLockedIntent = useCallback(() => {
    const returnPath = router.asPath || `/videouri/${videoId}`;
    const signedIn = Boolean(currentUser) && !isGuestUser;
    if (!signedIn) {
      router.push(`/login/videoteca?returnUrl=${encodeURIComponent(returnPath)}`);
      return;
    }
    router.push("/abonament");
  }, [currentUser, isGuestUser, router, videoId]);

  const handleToggleLike = useCallback(async () => {
    if (!video?.id || likePending) return;
    const signedIn = Boolean(currentUser) && !isGuestUser;
    if (!signedIn) {
      const returnPath = router.asPath || `/videouri/${videoId}`;
      router.push(`/login/videoteca?returnUrl=${encodeURIComponent(returnPath)}`);
      return;
    }

    const previousLiked = video.likedByCurrentUser === true;
    const previousCount =
      typeof video.likesCount === "number" && Number.isFinite(video.likesCount)
        ? Math.max(0, Math.floor(video.likesCount))
        : 0;
    const nextLiked = !previousLiked;
    const optimisticCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));

    setLikeError("");
    setLikePending(true);
    setVideo((current) =>
      current
        ? {
            ...current,
            likedByCurrentUser: nextLiked,
            likesCount: optimisticCount,
          }
        : current
    );

    try {
      const headers = await getFirebaseBearerHeader({ required: true });
      const response = await fetch(
        `/api/video-likes/${encodeURIComponent(video.id)}?client=web`,
        {
          method: nextLiked ? "PUT" : "DELETE",
          headers: {
            Accept: "application/json",
            ...headers,
          },
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "video_like_failed");
      }
      setVideo((current) =>
        current
          ? {
              ...current,
              likedByCurrentUser: data?.likedByCurrentUser === true,
              likesCount:
                typeof data?.likesCount === "number"
                  ? Math.max(0, Math.floor(data.likesCount))
                  : optimisticCount,
            }
          : current
      );
    } catch (error) {
      console.error("[video-like]", error?.message || error);
      setVideo((current) =>
        current
          ? {
              ...current,
              likedByCurrentUser: previousLiked,
              likesCount: previousCount,
            }
          : current
      );
      setLikeError(t("videoLibraryLikeError"));
    } finally {
      setLikePending(false);
    }
  }, [currentUser, isGuestUser, likePending, router, t, video, videoId]);

  const channelName = t("videoLibraryChannelName");
  const defaultTitle = t("videoLibrarySeoTitle");

  const pageTitle = video?.title ? `${video.title} | ${t("videoLibraryHeroTitle")}` : defaultTitle;
  const pageDesc =
    typeof video?.description === "string" && video.description.trim()
      ? video.description.trim().slice(0, 160)
      : t("videoLibrarySeoDesc");
  const playbackEmbedSrc = useMemo(() => {
    if (!video?.embedSrc) return null;
    return appendLibraryAutoplayParams(
      video.embedSrc,
      resolveLibraryPlatform(video),
      router.locale || "ro"
    );
  }, [router.locale, video]);

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
      </Head>
      <div className="min-h-screen bg-white">
        <Header />
        <div className="pb-14 pt-24 px-4 sm:px-6 sm:pt-28 lg:px-8 xl:px-12 lg:pt-24">
          <div className="mx-auto max-w-[1200px]">
            <Link
              href="/videouri"
              className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <span aria-hidden>←</span>
              {t("videoLibraryBackToLibrary")}
            </Link>

            {loading ? (
              <VideoDetailSkeleton />
            ) : notFound ? (
              <p className="py-16 text-center text-slate-600">{t("videoLibraryNotFound")}</p>
            ) : loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-800">
                {loadError}
                <button
                  type="button"
                  className="mt-4 rounded-full bg-red-900 px-4 py-2 text-xs font-medium text-white hover:bg-red-800"
                  onClick={() => load()}
                >
                  {t("videoLibraryRetry")}
                </button>
              </div>
            ) : video ? (
              <div className="xl:grid xl:grid-cols-[1fr_380px] xl:items-start xl:gap-10">
                <div className="min-w-0">
                  <div
                    ref={playerWrapRef}
                    className="relative aspect-video w-full overflow-hidden rounded-xl bg-black"
                  >
                    {videoIsPlayable ? (
                      consentGranted ? (
                      <>
                        {bunnyHlsPlayable ? (
                          <BunnyHlsPlayer
                            key={video.hlsSrc || video.id}
                            src={video.hlsSrc}
                            title={video.title}
                            poster={video.thumbnailUrl}
                            seekRequest={chapterSeekRequest}
                            className="h-full w-full bg-black"
                            onError={(error) => {
                              console.error("[video-detail] Bunny HLS error", error?.message || error);
                            }}
                          />
                        ) : (
                          <iframe
                            key={playbackEmbedSrc || video.embedSrc || video.id}
                            title={video.title}
                            src={playbackEmbedSrc || video.embedSrc}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                            allowFullScreen
                            className="h-full w-full"
                          />
                        )}
                        {video.isPremium ? (
                          <VideoPremiumThumbBadge label={t("videoLibraryPremiumCornerBadge")} />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleFullscreen()}
                          className="absolute right-3 top-3 z-10 rounded-lg bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                        >
                          {fullscreenActive
                            ? t("videoLibraryExitFullscreen")
                            : t("videoLibraryFullscreen")}
                        </button>
                      </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-300">
                          {t("videoLibraryLoading")}
                        </div>
                      )
                    ) : (
                      <div className="relative flex h-full flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center text-white">
                        {video.isPremium ? (
                          <VideoPremiumThumbBadge label={t("videoLibraryPremiumCornerBadge")} />
                        ) : null}
                        <PublicVideoThumbnail
                          src={video.thumbnailUrl}
                          imgClassName={
                            video.lockedReason === "source_invalid"
                              ? "absolute inset-0 h-full w-full object-cover opacity-30"
                              : "absolute inset-0 h-full w-full object-cover"
                          }
                          fallback={
                            <div
                              className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950"
                              aria-hidden
                            />
                          }
                        />
                        {video.thumbnailUrl && video.lockedReason !== "source_invalid" ? (
                          <div className="absolute inset-0 bg-black/50" aria-hidden />
                        ) : null}
                        <div className="relative z-[1] max-w-md space-y-3">
                          {video.lockedReason === "source_invalid" ? (
                            <p className="text-sm font-medium text-slate-200">
                              {t("videoLibrarySourceMissing")}
                            </p>
                          ) : null}
                          {isVideoAppOnlyLocked(video) ? (
                            <VideoAppOnlyCta />
                          ) : null}
                          {video.lockedReason !== "source_invalid" && !isVideoAppOnlyLocked(video) ? (
                            <div>
                              <SubscriptionRecurringNotice />
                            <div className="flex flex-wrap justify-center gap-2">
                              <button
                                type="button"
                                onClick={handleLockedIntent}
                                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                              >
                                {Boolean(currentUser) && !isGuestUser
                                  ? t("videoLibrarySubscribeCta")
                                  : t("videoLibraryLoginCta")}
                              </button>
                            </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleToggleLike}
                      disabled={likePending}
                      aria-pressed={video.likedByCurrentUser === true}
                      className={`inline-flex min-h-[42px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                        video.likedByCurrentUser
                          ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                          : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill={video.likedByCurrentUser ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-5 w-5"
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M7.5 10.5v9m0-9H5.25A2.25 2.25 0 0 0 3 12.75v4.5a2.25 2.25 0 0 0 2.25 2.25H7.5m0-9 3.38-6.08A1.5 1.5 0 0 1 12.19 3.65h.23a1.5 1.5 0 0 1 1.48 1.75l-.68 4.1h4.53a2.25 2.25 0 0 1 2.18 2.8l-1.35 5.4a2.25 2.25 0 0 1-2.18 1.7H7.5"
                        />
                      </svg>
                      <span>
                        {video.likedByCurrentUser
                          ? t("videoLibraryUnlike")
                          : t("videoLibraryLike")}
                      </span>
                    </button>
                    <span className="text-sm font-medium text-slate-600" aria-live="polite">
                      {t("videoLibraryLikesCount", {
                        count:
                          typeof video.likesCount === "number"
                            ? Math.max(0, Math.floor(video.likesCount))
                            : 0,
                      })}
                    </span>
                    {likeError ? (
                      <span className="text-sm text-red-700" role="alert">
                        {likeError}
                      </span>
                    ) : null}
                  </div>

                  {availableLocales.length > 1 ? (
                    <div className="mt-4 flex max-w-full flex-col gap-2 sm:max-w-xs">
                      <label htmlFor="video-playback-locale" className="text-sm font-medium text-slate-700">
                        {t("videoLibraryPlaybackLanguage")}
                      </label>
                      <select
                        id="video-playback-locale"
                        value={router.locale || "ro"}
                        onChange={(e) => {
                          const nextLocale = e.target.value;
                          if (nextLocale && nextLocale !== router.locale) {
                            router.push(router.asPath, router.asPath, { locale: nextLocale });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                      >
                        {availableLocales.map((lc) => (
                          <option key={lc} value={lc}>
                            {(LANGUAGE_LABELS && LANGUAGE_LABELS[lc]?.denumire) || lc.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <VideoChapters
                    chapters={video.chapters}
                    disabled={!videoIsPlayable}
                    message={chapterMessage}
                    onSelect={handleChapterSelect}
                  />

                  <AdPlacementShell placementId="banner1" className="!my-6" />

                  <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                    {video.title}
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    {[
                      channelName,
                      !video.isPremium
                        ? isVideoAppOnlyLocked(video)
                          ? t("videoLibraryAppOnlyBadge")
                          : t("videoLibraryBadgeFree")
                        : t("videoLibraryBadgeSubscriber"),
                      typeof video.category === "string" && video.category.trim() ? video.category.trim() : null,
                      typeof video.durationSeconds === "number"
                        ? formatDuration(video.durationSeconds, "")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                  {video.description ? (
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {video.description}
                    </p>
                  ) : null}

                  <AdPlacementShell placementId="banner2" className="!my-4" />
                  <VideoComments
                    videoId={video.id}
                    initialCount={video.commentsCount}
                    currentUser={currentUser}
                    isGuestUser={isGuestUser}
                    userData={userData}
                  />
                </div>

                <aside className="mt-10 min-w-0 xl:mt-0 xl:border-l xl:border-slate-200 xl:pl-8">
                  <h2 className="mb-4 text-base font-semibold text-slate-900">{t("videoLibraryRelatedTitle")}</h2>
                  {related.length === 0 ? (
                    <p className="text-sm text-slate-500">{t("videoLibraryRelatedEmpty")}</p>
                  ) : (
                    <ul className="space-y-4">
                      {related.map((rv) => {
                        const thumb = rv.thumbnailUrl;
                        const dur =
                          typeof rv.durationSeconds === "number"
                            ? formatDuration(rv.durationSeconds, "")
                            : "";
                        return (
                          <li key={rv.id}>
                            <Link
                              href={`/videouri/${rv.id}`}
                              className="group flex gap-3 rounded-lg p-1 transition hover:bg-slate-50"
                            >
                              <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-slate-200">
                                <PublicVideoThumbnail
                                  src={thumb}
                                  imgClassName="h-full w-full object-cover transition group-hover:scale-[1.03]"
                                  fallback={
                                    <div className="flex h-full w-full items-center justify-center bg-slate-700 text-[10px] text-slate-400">
                                      {rv.platform || "video"}
                                    </div>
                                  }
                                />
                                {rv.isPremium ? (
                                  <VideoPremiumThumbBadge
                                    compact
                                    label={t("videoLibraryPremiumCornerBadge")}
                                  />
                                ) : null}
                                {dur ? (
                                  <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px text-[10px] text-white">
                                    {dur}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col justify-start pt-0.5">
                                <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-900 group-hover:text-slate-700">
                                  {rv.title}
                                </span>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <AdPlacementShell placementId="banner3" className="!my-6" />
                </aside>
              </div>
            ) : null}
          </div>
        </div>
        <Footer />
      </div>
      <VideoPlaybackConsentModal
        open={modalVisible}
        onAccept={handleAccept}
        onDecline={handleDecline}
        recording={recording}
      />
    </>
  );
}
