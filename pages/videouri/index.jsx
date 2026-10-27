import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import PublicVideoThumbnail from "../../components/VideoLibrary/PublicVideoThumbnail";
import VideoPremiumThumbBadge from "../../components/VideoLibrary/VideoPremiumThumbBadge";
import { useAuth } from "../../context/AuthContext";
import { isVideoPlayableForUser, isVideoAppOnlyLocked } from "../../lib/videoLibraryClientUtils";
import VideoLibraryFiltersToolbar from "../../components/VideoLibrary/VideoLibraryFiltersToolbar";
import { resolveUiLocale } from "../../lib/siteLocales";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";
import GoogleAdSenseBanner from "../../components/Ads/GoogleAdSenseBanner";
import { isAdsenseEnabled } from "../../lib/ads/config";
import {
  buildVideoLibraryCategoryNavItems,
  collectVideoCategoryNames,
} from "../../lib/videoLibraryCategoryNav";

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

const skeletonBg =
  "bg-skeleton-shine bg-[length:200%_100%] animate-skeleton-shine";

const VIDEO_LIBRARY_PAGE_SIZE = 15;

function VideoLibrarySkeletonGrid({ loadingLabel }) {
  const placeholders = Array.from({ length: VIDEO_LIBRARY_PAGE_SIZE }, (_, i) => `sk-${i}`);
  return (
    <div
      className="mx-auto grid w-full max-w-[1920px] grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-busy="true"
      role="status"
    >
      <span className="sr-only">{loadingLabel}</span>
      {placeholders.map((key) => (
        <div key={key} className="flex flex-col">
          <div className={`aspect-video w-full rounded-xl ${skeletonBg}`} />
          <div className="mt-3 flex gap-3">
            <div className={`h-9 w-9 shrink-0 rounded-full ${skeletonBg}`} />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <div className={`h-3.5 w-full rounded-md sm:h-4 ${skeletonBg}`} />
              <div className={`h-3.5 w-[80%] rounded-md sm:h-4 ${skeletonBg}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function VideotecaAdBanner() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID || "";
  const slotId =
    process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_VIDEOTECA_SLOT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID ||
    "";
  const canRequestAd = isAdsenseEnabled() && Boolean(clientId && slotId);

  if (!canRequestAd) return null;

  return (
    <div className="my-6 flex justify-center">
      <div className="w-full max-w-[860px] rounded-2xl border border-slate-100 bg-white/90 p-4 shadow-sm">
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          Publicitate
        </p>
        <GoogleAdSenseBanner
          slot={slotId}
          shouldRequest={canRequestAd}
          className="mx-auto w-full"
          style={{ minHeight: "120px", width: "100%" }}
        />
      </div>
    </div>
  );
}

export default function VideoLibraryPage() {
  const router = useRouter();
  const { t } = useTranslation("common");
  const { currentUser, isGuestUser, userData } = useAuth();
  const [videos, setVideos] = useState([]);
  const [categoryDocs, setCategoryDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [paginationPage, setPaginationPage] = useState(1);
  const listTopRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const locale = router.locale || "ro";
      const authHeaders = await getFirebaseBearerHeader({ required: false });
      const [res, categoriesRes] = await Promise.all([
        fetch(`/api/premium/video-library?locale=${encodeURIComponent(locale)}&client=web`, {
          headers: {
            Accept: "application/json",
            ...authHeaders,
          },
        }),
        fetch("/api/public/video-categories", {
          headers: {
            Accept: "application/json",
          },
        }).catch(() => null),
      ]);
      const requestId = res.headers.get("x-request-id");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[video-library] api_error", {
          requestId: data?.requestId || requestId || null,
          status: res.status,
          statusText: res.statusText,
          locale,
          responseBody: data,
        });
        const err = new Error(data?.error || "load_failed");
        err.requestId = data?.requestId || requestId || null;
        throw err;
      }
      console.info("[video-library] api_success", {
        requestId: data?.requestId || requestId || null,
        locale,
        videosCount: Array.isArray(data?.videos) ? data.videos.length : 0,
      });
      setVideos(Array.isArray(data?.videos) ? data.videos : []);
      if (categoriesRes?.ok) {
        const categoriesData = await categoriesRes.json().catch(() => ({}));
        setCategoryDocs(Array.isArray(categoriesData?.categories) ? categoriesData.categories : []);
      } else {
        setCategoryDocs([]);
      }
    } catch (e) {
      console.error("[video-library] load_failed", {
        message: e?.message || String(e),
        requestId: e?.requestId || null,
      });
      const requestLabel = e?.requestId ? ` (ref: ${e.requestId})` : "";
      setError(`${t("videoLibraryLoadError")}${requestLabel}`);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [router.locale, t]);

  useEffect(() => {
    load();
  }, [load, currentUser?.uid]);

  const categoryNavItems = useMemo(() => {
    const locale = router.locale || "ro";
    const videoCategoryNames = collectVideoCategoryNames(videos);
    return buildVideoLibraryCategoryNavItems(categoryDocs, locale, {
      onlyWithVideos: true,
      videoCategoryNames,
    });
  }, [categoryDocs, router.locale, videos]);

  const accessFilteredVideos = useMemo(() => {
    if (accessFilter === "all") return videos;
    if (accessFilter === "free") return videos.filter((v) => !v.isPremium);
    return videos.filter((v) => v.isPremium);
  }, [videos, accessFilter]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredVideos = useMemo(() => {
    if (!normalizedSearch) return accessFilteredVideos;
    return accessFilteredVideos.filter((v) => {
      const title = (v.title || "").toLowerCase();
      const desc = (typeof v.description === "string" ? v.description : "").toLowerCase();
      const cat = (typeof v.category === "string" ? v.category : "").toLowerCase();
      return title.includes(normalizedSearch) || desc.includes(normalizedSearch) || cat.includes(normalizedSearch);
    });
  }, [accessFilteredVideos, normalizedSearch]);

  const filteredTotal = filteredVideos.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / VIDEO_LIBRARY_PAGE_SIZE));

  useEffect(() => {
    setPaginationPage(1);
  }, [normalizedSearch, accessFilter]);

  useEffect(() => {
    setPaginationPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages, filteredTotal]);

  const paginationPageSafe = Math.min(Math.max(1, paginationPage), totalPages);

  const paginatedVideos = useMemo(() => {
    const start = (paginationPageSafe - 1) * VIDEO_LIBRARY_PAGE_SIZE;
    return filteredVideos.slice(start, start + VIDEO_LIBRARY_PAGE_SIZE);
  }, [filteredVideos, paginationPageSafe]);

  const showPagination = filteredTotal > VIDEO_LIBRARY_PAGE_SIZE;
  const rangeFrom = filteredTotal === 0 ? 0 : (paginationPageSafe - 1) * VIDEO_LIBRARY_PAGE_SIZE + 1;
  const rangeTo = filteredTotal === 0 ? 0 : Math.min(paginationPageSafe * VIDEO_LIBRARY_PAGE_SIZE, filteredTotal);

  const scrollListTop = useCallback(() => {
    const el = listTopRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const gridClass =
    filteredVideos.length === 0 && videos.length > 0
      ? ""
      : "mx-auto grid w-full max-w-[1920px] grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  const handleVideoIntent = useCallback(
    (v) => {
      if (isVideoAppOnlyLocked(v)) {
        router.push(`/videouri/${v.id}`);
        return;
      }
      if (isVideoPlayableForUser(v, userData)) {
        router.push(`/videouri/${v.id}`);
        return;
      }
      if (v.lockedReason === "source_invalid") return;

      const returnPath = router.asPath || "/videouri";
      const signedIn = Boolean(currentUser) && !isGuestUser;
      if (!signedIn) {
        router.push(`/login/videoteca?returnUrl=${encodeURIComponent(returnPath)}`);
        return;
      }
      router.push("/abonament");
    },
    [currentUser, isGuestUser, router, userData],
  );

  const channelName = t("videoLibraryChannelName");

  const filtersToolbar = (
    <VideoLibraryFiltersToolbar
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      loading={loading}
      searchInputId="video-library-search"
      accessFilter={accessFilter}
      onAccessFilterChange={setAccessFilter}
      categories={categoryNavItems}
      activeCategorySlug={null}
      t={t}
    />
  );


  return (
    <>
      <Head>
        <title>{t("videoLibrarySeoTitle")}</title>
        <meta name="description" content={t("videoLibrarySeoDesc")} />
      </Head>
      <div className="min-h-screen bg-white">
        <Header />
        <div className="pb-12 pt-24 px-4 sm:px-6 sm:pt-28 lg:px-8 xl:px-12 lg:pt-24">
          <div className="mx-auto w-full max-w-[1920px]">
            <main className="min-w-0">
              {loading ? (
                <>
                  <div className="mb-6 flex flex-col gap-4 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {t("videoLibraryHeroTitle")}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <VideoLibrarySkeletonGrid loadingLabel={t("videoLibraryLoading")} />
                </>
              ) : error ? (
                <>
                  <div className="mb-6 flex flex-col gap-4 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {t("videoLibraryHeroTitle")}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <div className="max-w-md rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-center text-sm text-red-800">
                    {error}
                    <button
                      type="button"
                      className="mt-4 rounded-full bg-red-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-800"
                      onClick={() => load()}
                    >
                      {t("videoLibraryRetry")}
                    </button>
                  </div>
                </>
              ) : videos.length === 0 ? (
                <>
                  <div className="mb-6 flex flex-col gap-4 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {t("videoLibraryHeroTitle")}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <p className="py-12 text-center text-slate-600">{t("videoLibraryEmpty")}</p>
                </>
              ) : (
                <>
                  <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {t("videoLibraryHeroTitle")}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <VideotecaAdBanner />
                  {filteredVideos.length === 0 ? (
                    <p className="py-12 text-center text-slate-600">
                      {normalizedSearch ? t("videoLibrarySearchNoResults") : t("videoLibraryFilteredEmpty")}
                    </p>
                  ) : (
                    <>
                      <div ref={listTopRef} className="-mt-px h-px w-px shrink-0 scroll-mt-28" aria-hidden />
                      <div className={gridClass}>
                      {paginatedVideos.map((v) => {
                        const durationLabel =
                          typeof v.durationSeconds === "number"
                            ? formatDuration(v.durationSeconds, "")
                            : "";
                        const accessLabel = isVideoAppOnlyLocked(v)
                          ? t("videoLibraryAppOnlyBadge")
                          : !v.isPremium
                            ? t("videoLibraryBadgeFree")
                            : t("videoLibraryBadgeSubscriber");

                        return (
                          <article key={v.id} className="group flex flex-col">
                            <button
                              type="button"
                              disabled={
                                !isVideoPlayableForUser(v, userData) && v.lockedReason === "source_invalid"
                              }
                              className={`relative aspect-video w-full overflow-hidden rounded-xl bg-slate-200 text-left ${
                                isVideoPlayableForUser(v, userData)
                                  ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                                  : v.lockedReason === "source_invalid"
                                    ? "cursor-not-allowed"
                                    : "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                              }`}
                              onClick={() => handleVideoIntent(v)}
                              aria-label={v.title}
                            >
                              <PublicVideoThumbnail
                                src={v.thumbnailUrl}
                                imgClassName={
                                  isVideoPlayableForUser(v, userData)
                                    ? "h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                    : "h-full w-full object-cover"
                                }
                                fallback={
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-700 to-slate-900 text-slate-400">
                                    <svg
                                      className="h-12 w-12 opacity-50"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.25"
                                      aria-hidden
                                    >
                                      <rect x="2" y="4" width="20" height="16" rx="2" />
                                      <path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none" />
                                    </svg>
                                    <span className="text-[10px] uppercase tracking-[0.2em]">
                                      {v.platform === "bunny"
                                        ? "Bunny"
                                        : v.platform === "vimeo"
                                          ? "Vimeo"
                                          : "YouTube"}
                                    </span>
                                  </div>
                                }
                              />
                              {v.isPremium ? (
                                <VideoPremiumThumbBadge label={t("videoLibraryPremiumCornerBadge")} />
                              ) : null}
                              {durationLabel ? (
                                <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                                  {durationLabel}
                                </span>
                              ) : null}
                              {v.lockedReason === "source_invalid" && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/55 px-4 text-center backdrop-blur-[1px]">
                                  <p className="max-w-[12rem] text-xs font-medium text-amber-50">
                                    {t("videoLibrarySourceMissing")}
                                  </p>
                                </div>
                              )}
                              {isVideoAppOnlyLocked(v) && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60 px-3 text-center backdrop-blur-[1px]">
                                  <p className="max-w-[12rem] text-xs font-semibold text-white">
                                    {t("videoLibraryAppOnlyBadge")}
                                  </p>
                                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-900">
                                    {t("videoLibraryAppOnlyViewDetails")}
                                  </span>
                                </div>
                              )}
                              {isVideoPlayableForUser(v, userData) && (
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                                  <span className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900 shadow-lg">
                                    {t("videoLibraryPlay")}
                                  </span>
                                </div>
                              )}
                            </button>

                            <div className="mt-3 flex gap-3">
                              <div
                                className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200"
                                aria-hidden
                              >
                                <Image
                                  src="/LogoPngTransparent.png"
                                  alt=""
                                  width={36}
                                  height={36}
                                  className="object-contain p-1"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                {isVideoPlayableForUser(v, userData) ? (
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/videouri/${v.id}`)}
                                    className="line-clamp-2 block w-full text-left text-sm font-medium leading-snug text-slate-900 hover:text-slate-700"
                                  >
                                    {v.title}
                                  </button>
                                ) : v.lockedReason === "source_invalid" ? (
                                  <h2 className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">
                                    {v.title}
                                  </h2>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleVideoIntent(v)}
                                    className="line-clamp-2 block w-full text-left text-sm font-medium leading-snug text-slate-900 hover:text-slate-700"
                                  >
                                    {v.title}
                                  </button>
                                )}
                                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                                  {[channelName, accessLabel, v.category || null].filter(Boolean).join(" • ")}
                                </p>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                      </div>
                      {showPagination ? (
                        <nav
                          aria-label={t("videoLibraryPaginationAria", { current: paginationPageSafe, total: totalPages })}
                          className="mt-8 flex flex-col gap-4 border-t border-slate-100 pt-8 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <p className="text-sm tabular-nums text-slate-600">
                            {t("videoLibraryPaginationRange", { from: rangeFrom, to: rangeTo, total: filteredTotal })}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={paginationPageSafe <= 1}
                              onClick={() => {
                                setPaginationPage((p) => Math.max(1, p - 1));
                                requestAnimationFrame(() => scrollListTop());
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t("videoLibraryPaginationPrev")}
                            </button>
                            <button
                              type="button"
                              disabled={paginationPageSafe >= totalPages}
                              onClick={() => {
                                setPaginationPage((p) => Math.min(totalPages, p + 1));
                                requestAnimationFrame(() => scrollListTop());
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t("videoLibraryPaginationNext")}
                            </button>
                          </div>
                        </nav>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </main>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}
