import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import PublicVideoThumbnail from "../../../components/VideoLibrary/PublicVideoThumbnail";
import VideoPremiumThumbBadge from "../../../components/VideoLibrary/VideoPremiumThumbBadge";
import { useAuth } from "../../../context/AuthContext";
import { isVideoPlayableForUser, isVideoAppOnlyLocked } from "../../../lib/videoLibraryClientUtils";
import { resolveUiLocale } from "../../../lib/siteLocales";
import { getFirebaseBearerHeader } from "../../../utils/firebaseAuthHeaders";
import GoogleAdSenseBanner from "../../../components/Ads/GoogleAdSenseBanner";
import { isAdsenseEnabled } from "../../../lib/ads/config";
import VideoLibraryFiltersToolbar from "../../../components/VideoLibrary/VideoLibraryFiltersToolbar";
import { buildVideoLibraryCategoryNavItems } from "../../../lib/videoLibraryCategoryNav";
import { loadVideoCategories } from "../../../lib/mobilePublicData";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cristinazurba.com";
const SOCIAL_IMAGE = `${SITE_URL}/images/social-share.jpg`;

export async function getStaticPaths() {
  try {
    const categories = await loadVideoCategories();
    const paths = categories
      .filter((c) => c.name && c.slug)
      .flatMap((c) => [
        { params: { slug: c.slug }, locale: "ro" },
        { params: { slug: c.slug }, locale: "en" },
      ]);
    return { paths, fallback: "blocking" };
  } catch (e) {
    console.error("[videouri/categorie] getStaticPaths failed", e);
    return { paths: [], fallback: "blocking" };
  }
}

export async function getStaticProps({ params, locale }) {
  const uiLocale = resolveUiLocale(locale);
  const { slug } = params;

  try {
    const categories = await loadVideoCategories();
    const category = categories.find((c) => c.slug === slug);
    
    if (!category) {
      return { notFound: true };
    }

    return {
      props: {
        ...(await serverSideTranslations(uiLocale, ["common"])),
        category: {
          name: category.name,
          slug: category.slug,
          locales: category.locales || {},
        },
      },
      revalidate: 3600,
    };
  } catch (e) {
    console.error("[videouri/categorie] getStaticProps failed", e);
    return { notFound: true };
  }
}

function formatDuration(seconds, fallback) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) return fallback;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const skeletonBg = "bg-skeleton-shine bg-[length:200%_100%] animate-skeleton-shine";
const CATEGORY_VIDEOS_INITIAL_LIMIT = 4;
const CATEGORY_VIDEOS_LOAD_MORE_LIMIT = 2;

function VideoLibrarySkeletonGrid({ loadingLabel }) {
  const placeholders = Array.from({ length: CATEGORY_VIDEOS_INITIAL_LIMIT }, (_, i) => `sk-${i}`);
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

function CategoryAdBanner() {
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

function ShareButton({ url, title, description, t }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareData = { title, text: description, url };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 active:scale-95"
      aria-label={t("shareCategory")}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
      {copied ? t("linkCopied") : t("shareCategory")}
    </button>
  );
}

export default function VideoCategoryPage({ category }) {
  const router = useRouter();
  const { t } = useTranslation("common");
  const { currentUser, isGuestUser, userData } = useAuth();
  const [videos, setVideos] = useState([]);
  const [categoryDocs, setCategoryDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const listTopRef = useRef(null);

  const categoryName = category?.name || "";
  const categorySlug = category?.slug || "";
  const localizedCategoryName = category?.locales?.[router.locale] || category?.locales?.ro || categoryName;
  const canonicalUrl = `${SITE_URL}/videouri/categorie/${categorySlug}`;
  const pageTitle = `${localizedCategoryName} - ${t("videoLibrarySeoTitle")}`;
  const pageDesc = `${t("videoCategoryMetaDesc")} ${localizedCategoryName}`;
  const shareMsg = t("shareCategoryMessage").replace("{category}", localizedCategoryName);

  const fetchCategoryPage = useCallback(
    async ({ cursor = null, limit = CATEGORY_VIDEOS_INITIAL_LIMIT, append = false } = {}) => {
      const locale = router.locale || "ro";
      const params = new URLSearchParams({
        locale,
        client: "web",
        categorySlug,
        limit: String(limit),
      });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const authHeaders = await getFirebaseBearerHeader({ required: false });
      const res = await fetch(`/api/premium/video-library?${params.toString()}`, {
        headers: { Accept: "application/json", ...authHeaders },
      });
      const requestId = res.headers.get("x-request-id");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.error || "load_failed");
        err.requestId = data?.requestId || requestId || null;
        throw err;
      }

      const pageVideos = Array.isArray(data?.videos) ? data.videos : [];
      setVideos((current) => {
        if (!append) {
          return pageVideos;
        }
        const seen = new Set(current.map((video) => video.id));
        const merged = [...current];
        pageVideos.forEach((video) => {
          if (!seen.has(video.id)) {
            merged.push(video);
          }
        });
        return merged;
      });
      setNextCursor(typeof data?.nextCursor === "string" ? data.nextCursor : null);
      setHasMore(data?.hasMore === true);
      setTotalCount(
        typeof data?.totalCount === "number" && Number.isFinite(data.totalCount)
          ? data.totalCount
          : pageVideos.length
      );
    },
    [categorySlug, router.locale]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const categoriesRes = await fetch("/api/public/video-categories", {
        headers: { Accept: "application/json" },
      }).catch(() => null);
      if (categoriesRes?.ok) {
        const categoriesData = await categoriesRes.json().catch(() => ({}));
        setCategoryDocs(Array.isArray(categoriesData?.categories) ? categoriesData.categories : []);
      } else {
        setCategoryDocs([]);
      }
      await fetchCategoryPage({
        cursor: null,
        limit: CATEGORY_VIDEOS_INITIAL_LIMIT,
        append: false,
      });
    } catch (e) {
      const requestLabel = e?.requestId ? ` (ref: ${e.requestId})` : "";
      setError(`${t("videoLibraryLoadError")}${requestLabel}`);
      setVideos([]);
      setNextCursor(null);
      setHasMore(false);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [fetchCategoryPage, t]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMoreRef.current || !nextCursor) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await fetchCategoryPage({
        cursor: nextCursor,
        limit: CATEGORY_VIDEOS_LOAD_MORE_LIMIT,
        append: true,
      });
    } catch (e) {
      console.error("[videouri/categorie] loadMore failed", e);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchCategoryPage, hasMore, loading, nextCursor]);

  useEffect(() => {
    if (categoryName) {
      load();
    }
  }, [load, currentUser?.uid, categoryName]);

  const categoryNavItems = useMemo(() => {
    const locale = router.locale || "ro";
    return buildVideoLibraryCategoryNavItems(categoryDocs, locale);
  }, [categoryDocs, router.locale]);

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
      return title.includes(normalizedSearch) || desc.includes(normalizedSearch);
    });
  }, [accessFilteredVideos, normalizedSearch]);

  const loadedCount = filteredVideos.length;

  useEffect(() => {
    if (!hasMore || loading || loadingMore || normalizedSearch) {
      return undefined;
    }
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, loadingMore, normalizedSearch]);

  const gridClass = "mx-auto grid w-full max-w-[1920px] grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
    [currentUser, isGuestUser, router, userData]
  );

  const channelName = t("videoLibraryChannelName");

  const filtersToolbar = (
    <VideoLibraryFiltersToolbar
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      loading={loading}
      searchInputId="category-video-search"
      accessFilter={accessFilter}
      onAccessFilterChange={setAccessFilter}
      categories={categoryNavItems}
      activeCategorySlug={categorySlug}
      t={t}
    />
  );

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <link rel="canonical" href={canonicalUrl} />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={shareMsg} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={SOCIAL_IMAGE} />
        <meta property="og:site_name" content="Cristina Zurba" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={shareMsg} />
        <meta name="twitter:image" content={SOCIAL_IMAGE} />
      </Head>
      <div className="min-h-screen bg-white">
        <Header />
        <div className="pb-12 pt-24 px-4 sm:px-6 sm:pt-28 lg:px-8 xl:px-12 lg:pt-24">
          <div className="mx-auto w-full max-w-[1920px]">
            <nav className="mb-4 flex items-center justify-between text-sm text-slate-500">
              <div className="flex items-center gap-2">
                <Link href="/videouri" className="hover:text-slate-800 hover:underline">
                  {t("videoLibraryHeroTitle")}
                </Link>
                <span aria-hidden>/</span>
                <span className="text-slate-900 font-medium">{localizedCategoryName}</span>
              </div>
              <ShareButton url={canonicalUrl} title={pageTitle} description={shareMsg} t={t} />
            </nav>
            <main className="min-w-0">
              {loading ? (
                <>
                  <div className="mb-6 flex flex-col gap-4 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {localizedCategoryName}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <VideoLibrarySkeletonGrid loadingLabel={t("videoLibraryLoading")} />
                </>
              ) : error ? (
                <>
                  <div className="mb-6 flex flex-col gap-4 lg:mb-7">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                      {localizedCategoryName}
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
                      {localizedCategoryName}
                    </h1>
                    {filtersToolbar}
                  </div>
                  <p className="py-12 text-center text-slate-600">{t("videoCategoryEmpty")}</p>
                  <div className="text-center">
                    <Link href="/videouri" className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
                      ← {t("videoCategoryBackLabel")}
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 lg:mb-7">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                        {localizedCategoryName}
                      </h1>
                      {totalCount > 0 ? (
                        <p className="text-sm tabular-nums text-slate-600">
                          {t("videoLibraryPaginationRange", {
                            from: loadedCount > 0 ? 1 : 0,
                            to: loadedCount,
                            total: totalCount,
                          })}
                        </p>
                      ) : null}
                    </div>
                    {filtersToolbar}
                  </div>
                  <CategoryAdBanner />
                  {filteredVideos.length === 0 ? (
                    <p className="py-12 text-center text-slate-600">
                      {normalizedSearch ? t("videoLibrarySearchNoResults") : t("videoCategoryEmpty")}
                    </p>
                  ) : (
                    <>
                      <div ref={listTopRef} className="-mt-px h-px w-px shrink-0 scroll-mt-28" aria-hidden />
                      <div className={gridClass}>
                        {filteredVideos.map((v) => {
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
                                disabled={!isVideoPlayableForUser(v, userData) && v.lockedReason === "source_invalid"}
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
                                        {v.platform === "bunny" ? "Bunny" : v.platform === "vimeo" ? "Vimeo" : "YouTube"}
                                      </span>
                                    </div>
                                  }
                                />
                                {v.isPremium && <VideoPremiumThumbBadge label={t("videoLibraryPremiumCornerBadge")} />}
                                {durationLabel && (
                                  <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                                    {durationLabel}
                                  </span>
                                )}
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
                                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200" aria-hidden>
                                  <Image src="/LogoPngTransparent.png" alt="" width={36} height={36} className="object-contain p-1" />
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
                                    <h2 className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{v.title}</h2>
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
                                    {[channelName, accessLabel].filter(Boolean).join(" • ")}
                                  </p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                      {!normalizedSearch && hasMore ? (
                        <div ref={loadMoreRef} className="mt-8 flex justify-center py-4" aria-hidden={!loadingMore}>
                          {loadingMore ? (
                            <p className="text-sm text-slate-600">{t("videoLibraryLoading")}</p>
                          ) : null}
                        </div>
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
