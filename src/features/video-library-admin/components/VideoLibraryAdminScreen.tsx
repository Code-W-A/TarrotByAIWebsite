import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import type {
  VideoCategoryDoc,
  VideoCreateInput,
  VideoDoc,
  VideoPlatform,
  VideoSortDirection,
  VideoSortField,
} from "../types/video";
import {
  createVideo,
  deleteVideo,
  listVideosPage,
  listVideoCategories,
  addVideoCategory,
  deleteVideoCategoryByName,
  togglePublish,
  type VideoListCursor,
  updateVideo,
  VideoCacheRefreshError,
  rebuildPublicVideoLibraryCache,
} from "../services/videos.service";
import { flushAdminUiLogQueue, logAdminUiEvent } from "../services/adminUiLogs.client";
import VideoTable from "./VideoTable";
import VideoSheet from "./VideoSheet";
import Modal from "./Modal";
import { LANGUAGE_LABELS } from "../../../../data/constants";
import {
  deriveRootVideoUrlFromLocales,
  resolveLibraryEmbedSrc,
} from "../../../../lib/videoLibraryPublic";
import { gTranslateFetch } from "../../../../utils/apiUtils";
import { SITE_LOCALES } from "../utils/siteLocales";
import { siteLocalesRootPreferredOrder } from "../utils/localeVideoMerge";

type PublishFilter = "all" | "published" | "unpublished";
type PremiumFilter = "all" | "premium" | "nonPremium";
type ScheduleFilter = "all" | "scheduled" | "active";

const DEFAULT_SORT_FIELD: VideoSortField = "createdAt";
const DEFAULT_SORT_DIRECTION: VideoSortDirection = "desc";
const ADMIN_VIDEO_ROOT_PREF = siteLocalesRootPreferredOrder(SITE_LOCALES);

function adminPrimaryVideoUrl(video: VideoDoc): string {
  return (
    deriveRootVideoUrlFromLocales(video.locales ?? {}, ADMIN_VIDEO_ROOT_PREF) ||
    video.videoUrl?.trim() ||
    ""
  );
}

function slugifyText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const CREATE_CLICK_FEEDBACK_MS = 600;
const CREATE_MODAL_OPEN_TIMEOUT_MS = 800;
const DESC_FIRST_FIELDS: ReadonlySet<VideoSortField> = new Set<VideoSortField>([
  "createdAt",
  "publishAt",
  "order",
  "isPublished",
]);

const buildCreateSessionId = (): string =>
  `videos-create-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getStackTop = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const [firstLine] = value.split("\n");
  return firstLine?.trim() || undefined;
};

const timestampToMs = (value?: Timestamp | null): number | null => {
  if (!value) return null;
  try {
    if (typeof value.toDate === "function") return value.toDate().getTime();
    const parsed = value as unknown as { seconds?: number };
    return typeof parsed.seconds === "number" ? parsed.seconds * 1000 : null;
  } catch (_) {
    return null;
  }
};

const compareString = (a: string, b: string, direction: VideoSortDirection): number => {
  const result = a.localeCompare(b, "ro-RO", { sensitivity: "base" });
  if (result === 0) return 0;
  return direction === "asc" ? result : -result;
};

const compareNullableNumber = (
  a: number | null,
  b: number | null,
  direction: VideoSortDirection,
  nullsLast = false
): number => {
  const aMissing = a === null;
  const bMissing = b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing || bMissing) {
    if (!nullsLast) return aMissing ? -1 : 1;
    return aMissing ? 1 : -1;
  }
  if (a === b) return 0;
  if (direction === "asc") return a < b ? -1 : 1;
  return a > b ? -1 : 1;
};

const compareVideosByTieBreakers = (a: VideoDoc, b: VideoDoc): number => {
  const createdComparison = compareNullableNumber(
    timestampToMs(a.createdAt),
    timestampToMs(b.createdAt),
    "desc",
    true
  );
  if (createdComparison !== 0) return createdComparison;

  const orderComparison = compareNullableNumber(a.order ?? null, b.order ?? null, "desc", true);
  if (orderComparison !== 0) return orderComparison;

  const titleComparison = compareString(a.title ?? "", b.title ?? "", "asc");
  if (titleComparison !== 0) return titleComparison;

  return a.id.localeCompare(b.id, "ro-RO");
};

const sortVideosForAdminTable = (
  items: VideoDoc[],
  sortField: VideoSortField,
  sortDirection: VideoSortDirection
): VideoDoc[] => {
  return [...items].sort((a, b) => {
    let primaryComparison = 0;

    switch (sortField) {
      case "createdAt":
        primaryComparison = compareNullableNumber(
          timestampToMs(a.createdAt),
          timestampToMs(b.createdAt),
          sortDirection,
          true
        );
        break;
      case "publishAt":
        primaryComparison = compareNullableNumber(
          timestampToMs(a.publishAt),
          timestampToMs(b.publishAt),
          sortDirection,
          true
        );
        break;
      case "title":
        primaryComparison = compareString(a.title ?? "", b.title ?? "", sortDirection);
        break;
      case "order":
        primaryComparison = compareNullableNumber(
          a.order ?? null,
          b.order ?? null,
          sortDirection,
          true
        );
        break;
      case "platform":
        primaryComparison = compareString(a.platform ?? "", b.platform ?? "", sortDirection);
        break;
      case "category":
        primaryComparison = compareString(a.category ?? "", b.category ?? "", sortDirection);
        break;
      case "isPublished":
        primaryComparison = compareNullableNumber(
          a.isPublished ? 1 : 0,
          b.isPublished ? 1 : 0,
          sortDirection
        );
        break;
      default:
        primaryComparison = 0;
        break;
    }

    if (primaryComparison !== 0) return primaryComparison;
    return compareVideosByTieBreakers(a, b);
  });
};

export default function VideoLibraryAdminScreen() {
  const [videos, setVideos] = useState<VideoDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"videos" | "categories">("videos");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [cacheWarning, setCacheWarning] = useState("");
  const [retryingCache, setRetryingCache] = useState(false);

  const retryCache = async () => {
    setRetryingCache(true);
    try {
      await rebuildPublicVideoLibraryCache();
      setCacheWarning("");
      setSuccessMessage("Cache-ul video a fost actualizat.");
    } catch (_) {
      setCacheWarning("Cache-ul nu a fost actualizat. Reîncearcă reconstruirea.");
    } finally {
      setRetryingCache(false);
    }
  };
  const [searchValue, setSearchValue] = useState("");
  const [platformFilter, setPlatformFilter] = useState<VideoPlatform | "all">("all");
  const [publishFilter, setPublishFilter] = useState<PublishFilter>("all");
  const [premiumFilter, setPremiumFilter] = useState<PremiumFilter>("all");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [sortField, setSortField] = useState<VideoSortField>(DEFAULT_SORT_FIELD);
  const [sortDirection, setSortDirection] = useState<VideoSortDirection>(DEFAULT_SORT_DIRECTION);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [nextCursor, setNextCursor] = useState<VideoListCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<VideoListCursor | null>>([null]);
  const [showForm, setShowForm] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoDoc | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoDoc | null>(null);
  const [categoryDocs, setCategoryDocs] = useState<VideoCategoryDoc[]>([]);
  const [categoryInput, setCategoryInput] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");
  const [categoryLocales, setCategoryLocales] = useState<Record<string, string> | undefined>(
    undefined
  );
  const [isCategoryTranslating, setIsCategoryTranslating] = useState(false);
  const [categoryTranslateMessage, setCategoryTranslateMessage] = useState("");
  const [showCategoryTranslateConfirm, setShowCategoryTranslateConfirm] = useState(false);
  const [pendingCategoryName, setPendingCategoryName] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<VideoCategoryDoc | null>(null);
  const [showCategoryDetails, setShowCategoryDetails] = useState(false);
  const [isCreateOpening, setIsCreateOpening] = useState(false);
  const [createOpenWarning, setCreateOpenWarning] = useState("");

  const createSessionIdRef = useRef<string>(buildCreateSessionId());
  const showFormRef = useRef(showForm);
  const loadingRef = useRef(loading);
  const activeTabRef = useRef(activeTab);
  const previousShowFormRef = useRef(showForm);
  const createClickTimerRef = useRef<number | null>(null);
  const createOpenWatchdogRef = useRef<number | null>(null);

  const clearCreateTimers = () => {
    if (createClickTimerRef.current) {
      window.clearTimeout(createClickTimerRef.current);
      createClickTimerRef.current = null;
    }
    if (createOpenWatchdogRef.current) {
      window.clearTimeout(createOpenWatchdogRef.current);
      createOpenWatchdogRef.current = null;
    }
  };

  const logCreateEvent = (
    event: "create_button_pointerdown" | "create_button_click" | "create_modal_opened" | "create_modal_closed" | "create_modal_open_timeout" | "create_runtime_error" | "create_submit_start" | "create_submit_success" | "create_submit_error",
    level: "info" | "warn" | "error",
    message: string,
    options?: {
      error?: { name?: string; message?: string; stackTop?: string };
      meta?: Record<string, unknown>;
    }
  ) => {
    void logAdminUiEvent({
      source: "videos.create",
      event,
      level,
      message,
      clientTs: Date.now(),
      sessionId: createSessionIdRef.current,
      pagePath: typeof window !== "undefined" ? window.location.pathname : "/dashboard/videos",
      uiState: {
        loading: loadingRef.current,
        activeTab: activeTabRef.current,
        showForm: showFormRef.current,
      },
      ...(options?.error ? { error: options.error } : {}),
      ...(options?.meta ? { meta: options.meta } : {}),
    });
  };

  const refreshVideos = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await listVideosPage(pageSize, null);
      setVideos(result.items);
      setHasNextPage(result.hasNextPage);
      setNextCursor(result.nextCursor);
      setCursorHistory([null]);
      setPage(1);
    } catch (err) {
      setErrorMessage("Nu am putut încărca lista de videoclipuri.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshVideos();
  }, [pageSize]);

  const loadNextVideosPage = async () => {
    if (!hasNextPage || !nextCursor || loading || loadingPage) return;
    setLoadingPage(true);
    setErrorMessage("");
    try {
      const result = await listVideosPage(pageSize, nextCursor);
      setVideos(result.items);
      setHasNextPage(result.hasNextPage);
      setNextCursor(result.nextCursor);
      setCursorHistory((prev) => [...prev, nextCursor]);
      setPage((prev) => prev + 1);
    } catch (_) {
      setErrorMessage("Nu am putut încărca pagina următoare.");
    } finally {
      setLoadingPage(false);
    }
  };

  const loadPrevVideosPage = async () => {
    if (page <= 1 || loading || loadingPage) return;
    const prevStartCursor = cursorHistory[cursorHistory.length - 2] ?? null;
    setLoadingPage(true);
    setErrorMessage("");
    try {
      const result = await listVideosPage(pageSize, prevStartCursor);
      setVideos(result.items);
      setHasNextPage(result.hasNextPage);
      setNextCursor(result.nextCursor);
      setCursorHistory((prev) => prev.slice(0, -1));
      setPage((prev) => Math.max(1, prev - 1));
    } catch (_) {
      setErrorMessage("Nu am putut încărca pagina anterioară.");
    } finally {
      setLoadingPage(false);
    }
  };

  const refreshCategories = async () => {
    setCategoriesLoading(true);
    try {
      const items = await listVideoCategories();
      const clean = items
        .filter((item) => typeof item.name === "string" && item.name.trim().length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCategoryDocs(clean);
    } catch (_) {
      setCategoryMessage("Nu am putut încărca categoriile.");
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    refreshCategories();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const id = window.setTimeout(() => setSuccessMessage(""), 3000);
    return () => window.clearTimeout(id);
  }, [successMessage]);

  useEffect(() => {
    showFormRef.current = showForm;
  }, [showForm]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const previous = previousShowFormRef.current;
    if (showForm && !previous) {
      clearCreateTimers();
      setIsCreateOpening(false);
      setCreateOpenWarning("");
      logCreateEvent("create_modal_opened", "info", "Create video modal opened.");
    } else if (!showForm && previous) {
      logCreateEvent("create_modal_closed", "info", "Create video modal closed.");
    }
    previousShowFormRef.current = showForm;
  }, [showForm]);

  useEffect(() => {
    void flushAdminUiLogQueue(30);

    const onGlobalError = (event: ErrorEvent) => {
      logCreateEvent("create_runtime_error", "error", "window.onerror captured on videos dashboard.", {
        error: {
          name: event.error?.name || "Error",
          message: event.message || event.error?.message || "Unknown runtime error.",
          stackTop: getStackTop(event.error?.stack),
        },
        meta: {
          filename: event.filename || "",
          lineno: event.lineno || null,
          colno: event.colno || null,
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const reasonMessage =
        typeof reason === "string"
          ? reason
          : typeof reason?.message === "string"
            ? reason.message
            : "Unhandled rejection on videos dashboard.";
      logCreateEvent(
        "create_runtime_error",
        "error",
        "unhandledrejection captured on videos dashboard.",
        {
          error: {
            name:
              typeof reason?.name === "string"
                ? reason.name
                : reason?.constructor?.name || "UnhandledRejection",
            message: reasonMessage,
            stackTop: getStackTop(reason?.stack),
          },
        }
      );
    };

    window.addEventListener("error", onGlobalError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      clearCreateTimers();
      window.removeEventListener("error", onGlobalError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const filteredVideos = useMemo(() => {
    const lower = searchValue.trim().toLowerCase();
    const now = new Date();
    return videos.filter((video) => {
      const matchesSearch = lower.length === 0 || video.title.toLowerCase().includes(lower);
      const matchesPlatform = platformFilter === "all" || video.platform === platformFilter;
      const matchesPublish =
        publishFilter === "all" ||
        (publishFilter === "published" ? video.isPublished : !video.isPublished);
      const matchesPremium =
        premiumFilter === "all" ||
        (premiumFilter === "premium" ? !!video.isPremium : !video.isPremium);
      const publishAtDate = video.publishAt?.toDate ? video.publishAt.toDate() : null;
      const isScheduled = publishAtDate ? publishAtDate > now : false;
      const matchesSchedule =
        scheduleFilter === "all" ||
        (scheduleFilter === "scheduled" ? isScheduled : !isScheduled);
      return matchesSearch && matchesPlatform && matchesPublish && matchesPremium && matchesSchedule;
    });
  }, [videos, searchValue, platformFilter, publishFilter, premiumFilter, scheduleFilter]);

  const sortedVideos = useMemo(
    () => sortVideosForAdminTable(filteredVideos, sortField, sortDirection),
    [filteredVideos, sortField, sortDirection]
  );

  const handleCreatePointerDown = () => {
    logCreateEvent("create_button_pointerdown", "info", "Create video button pointerdown.");
  };

  const handleCreateClick = () => {
    logCreateEvent("create_button_click", "info", "Create video button clicked.");
    clearCreateTimers();
    setCreateOpenWarning("");
    setIsCreateOpening(true);

    createClickTimerRef.current = window.setTimeout(() => {
      setIsCreateOpening(false);
      createClickTimerRef.current = null;
    }, CREATE_CLICK_FEEDBACK_MS);

    createOpenWatchdogRef.current = window.setTimeout(() => {
      if (showFormRef.current) return;
      setCreateOpenWarning(
        "A apărut o întârziere la deschiderea formularului. Încearcă din nou sau reîncarcă pagina."
      );
      logCreateEvent(
        "create_modal_open_timeout",
        "warn",
        "Create modal did not open inside watchdog window.",
        {
          meta: { timeoutMs: CREATE_MODAL_OPEN_TIMEOUT_MS },
        }
      );
      createOpenWatchdogRef.current = null;
    }, CREATE_MODAL_OPEN_TIMEOUT_MS);

    setEditingVideo(null);
    setShowForm(true);
  };

  const handleEdit = (video: VideoDoc) => {
    setEditingVideo(video);
    setShowForm(true);
  };

  const closeForm = () => {
    clearCreateTimers();
    setIsCreateOpening(false);
    setShowForm(false);
    setEditingVideo(null);
  };

  const handleDelete = async (video: VideoDoc) => {
    const confirmed = window.confirm(`Ștergi videoclipul "${video.title}"?`);
    if (!confirmed) return;
    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await deleteVideo(video.id);
      setCacheWarning("");
      await refreshVideos();
      setSuccessMessage("Videoclip șters.");
    } catch (error) {
      if (error instanceof VideoCacheRefreshError) {
        setCacheWarning("Videoul a fost șters, dar cache-ul nu a fost actualizat.");
        await refreshVideos();
      } else setErrorMessage("Ștergerea a eșuat.");
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublish = async (video: VideoDoc, nextValue: boolean) => {
    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await togglePublish(video.id, nextValue);
      setCacheWarning("");
      await refreshVideos();
      setSuccessMessage(nextValue ? "Videoclip publicat." : "Videoclip ascuns.");
    } catch (error) {
      if (error instanceof VideoCacheRefreshError) {
        setCacheWarning(error.message);
        await refreshVideos();
      } else setErrorMessage("Actualizarea statusului a eșuat.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (data: VideoCreateInput) => {
    logCreateEvent(
      "create_submit_start",
      "info",
      editingVideo ? "Edit video submit started." : "Create video submit started.",
      {
        meta: {
          mode: editingVideo ? "edit" : "create",
          hasPublishAt: !!data.publishAt,
          platform: data.platform,
        },
      }
    );
    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      console.log("[VideoLibraryAdminScreen] Form submit", {
        mode: editingVideo ? "edit" : "create",
        data,
      });
      if (editingVideo) {
        await updateVideo(editingVideo.id, data);
        setSuccessMessage("Videoclip actualizat.");
      } else {
        await createVideo(data);
        setSuccessMessage("Videoclip creat.");
      }
      setCacheWarning("");
      logCreateEvent(
        "create_submit_success",
        "info",
        editingVideo ? "Edit video submit succeeded." : "Create video submit succeeded.",
        {
          meta: { mode: editingVideo ? "edit" : "create" },
        }
      );
      setShowForm(false);
      setEditingVideo(null);
      await refreshVideos();
      await refreshCategories();
    } catch (error) {
      if (error instanceof VideoCacheRefreshError) {
        setCacheWarning(error.message);
        setShowForm(false);
        setEditingVideo(null);
        await refreshVideos();
        await refreshCategories();
        return;
      }
      console.error("[VideoLibraryAdminScreen] Save failed", error);
      logCreateEvent(
        "create_submit_error",
        "error",
        editingVideo ? "Edit video submit failed." : "Create video submit failed.",
        {
          error: {
            name:
              error && typeof error === "object" && "name" in error && typeof error.name === "string"
                ? error.name
                : "Error",
            message:
              error &&
              typeof error === "object" &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : "Unknown submit error.",
            stackTop:
              error &&
              typeof error === "object" &&
              "stack" in error &&
              typeof error.stack === "string"
                ? getStackTop(error.stack)
                : undefined,
          },
          meta: { mode: editingVideo ? "edit" : "create" },
        }
      );
      setErrorMessage("Salvarea a eșuat.");
    } finally {
      setLoading(false);
    }
  };

  const generateCategoryLocales = async (name: string) => {
    if (!name.trim()) {
      setCategoryTranslateMessage("Completează categoria înainte de localizare.");
      return undefined;
    }
    setIsCategoryTranslating(true);
    setCategoryTranslateMessage("");
    try {
      const result: Record<string, string> = {};
      const languageKeys = Object.keys(LANGUAGE_LABELS);
      for (const lang of languageKeys) {
        if (lang === "ro") {
          result[lang] = name;
          continue;
        }
        const translated = await gTranslateFetch(name, lang);
        result[lang] = translated || name;
      }
      setCategoryLocales(result);
      setCategoryTranslateMessage("Localizarea s-a terminat. Poți continua.");
      return result;
    } catch (_) {
      setCategoryTranslateMessage("Localizarea a eșuat. Încearcă din nou.");
      return undefined;
    } finally {
      setIsCategoryTranslating(false);
    }
  };

  const handleTranslateCategory = async () => {
    const trimmed = categoryInput.trim();
    await generateCategoryLocales(trimmed);
  };

  const addCategory = async (name: string, locales?: Record<string, string>) => {
    try {
      const created = await addVideoCategory(name, locales);
      setCategoryDocs((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryInput("");
      setCategoryLocales(undefined);
      setCategoryTranslateMessage("");
      setCategoryMessage("Categoria a fost adăugată.");
    } catch (_) {
      setCategoryMessage("Nu am putut adăuga categoria.");
    }
  };

  const handleAddCategory = async () => {
    const trimmed = categoryInput.trim();
    setCategoryMessage("");
    if (!trimmed) {
      setCategoryMessage("Introdu o categorie.");
      return;
    }
    const exists = categoryDocs.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setCategoryMessage("Categoria există deja.");
      return;
    }
    const nextSlug = slugifyText(trimmed);
    if (!nextSlug) {
      setCategoryMessage("Categoria nu poate genera un slug valid.");
      return;
    }
    const slugExists = categoryDocs.some((item) => {
      const existingSlug =
        typeof item.slug === "string" && item.slug.trim()
          ? item.slug.trim()
          : slugifyText(item.name);
      return existingSlug === nextSlug;
    });
    if (slugExists) {
      setCategoryMessage("Există deja o categorie cu același slug. Alege un nume mai specific.");
      return;
    }
    if (!categoryLocales || Object.keys(categoryLocales).length === 0) {
      setPendingCategoryName(trimmed);
      setShowCategoryTranslateConfirm(true);
      return;
    }
    await addCategory(trimmed, categoryLocales);
  };

  const handleConfirmCategoryTranslate = async () => {
    if (!pendingCategoryName) return;
    setShowCategoryTranslateConfirm(false);
    const locales = await generateCategoryLocales(pendingCategoryName);
    if (!locales) return;
    await addCategory(pendingCategoryName, locales);
    setPendingCategoryName(null);
  };

  const handleDeleteCategory = async (name: string) => {
    const confirmed = window.confirm(`Ștergi categoria "${name}"?`);
    if (!confirmed) return;
    try {
      await deleteVideoCategoryByName(name);
      setCategoryDocs((prev) => prev.filter((item) => item.name.toLowerCase() !== name.toLowerCase()));
      setCategoryMessage("Categoria a fost ștearsă.");
      if (selectedCategory?.name.toLowerCase() === name.toLowerCase()) {
        setShowCategoryDetails(false);
        setSelectedCategory(null);
      }
    } catch (_) {
      setCategoryMessage("Nu am putut șterge categoria.");
    }
  };

  const openCategoryDetails = (category: VideoCategoryDoc) => {
    setSelectedCategory(category);
    setShowCategoryDetails(true);
  };

  const closeCategoryDetails = () => {
    setShowCategoryDetails(false);
    setSelectedCategory(null);
  };

  const handleOpen = (video: VideoDoc) => {
    const raw = adminPrimaryVideoUrl(video);
    if (raw) {
      window.open(raw, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopy = async (video: VideoDoc) => {
    try {
      const raw = adminPrimaryVideoUrl(video);
      if (!raw) {
        setErrorMessage("Nu există link video de copiat.");
        return;
      }
      await navigator.clipboard.writeText(raw);
      setSuccessMessage("Link copiat.");
    } catch (_) {
      setErrorMessage("Nu am putut copia linkul.");
    }
  };

  const handlePreview = (video: VideoDoc) => {
    setPreviewVideo(video);
  };

  const handleSortChange = (field: VideoSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      setPage(1);
      return;
    }
    setSortField(field);
    setSortDirection(DESC_FIRST_FIELDS.has(field) ? "desc" : "asc");
    setPage(1);
  };

  const getEmbedUrl = (video: VideoDoc) =>
    resolveLibraryEmbedSrc(video.platform, adminPrimaryVideoUrl(video)) || null;

  const stats = useMemo(() => {
    const total = videos.length;
    const published = videos.filter((v) => v.isPublished).length;
    return { total, published, unpublished: total - published };
  }, [videos]);

  return (
    <div className="mx-auto w-full max-w-none space-y-8">
      <div className="flex w-full max-w-md rounded-lg bg-gray-100 p-1 text-sm text-gray-700">
        <button
          type="button"
          onClick={() => setActiveTab("videos")}
          className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
            activeTab === "videos" ? "bg-white text-gray-900 shadow-sm" : "hover:text-gray-900"
          }`}
        >
          Videoclipuri
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("categories")}
          className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
            activeTab === "categories" ? "bg-white text-gray-900 shadow-sm" : "hover:text-gray-900"
          }`}
        >
          Categorii
        </button>
      </div>

      {activeTab === "videos" ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Videoclipuri</h1>
          <p className="mt-2 text-base text-gray-600">
                  Administrează biblioteca video afișată în aplicația mobilă.
                </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-4 py-1.5 font-medium text-gray-700 ring-1 ring-inset ring-gray-300">
              Total: <span className="ml-1 font-semibold text-gray-900">{stats.total}</span>
                  </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-4 py-1.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Publicate: <span className="ml-1 font-semibold text-emerald-800">{stats.published}</span>
                  </span>
            <span className="inline-flex items-center rounded-full bg-amber-50 px-4 py-1.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Nepublicate: <span className="ml-1 font-semibold text-amber-800">{stats.unpublished}</span>
                  </span>
                </div>
              </div>
        <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={refreshVideos}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow"
                >
                  Reîncarcă
                </button>
                <button
                  type="button"
                  onPointerDown={handleCreatePointerDown}
                  onClick={handleCreateClick}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 hover:shadow-md"
                >
                  {isCreateOpening ? "Se deschide..." : "+ Adaugă videoclip"}
                </button>
                {createOpenWarning ? (
                  <div className="max-w-md text-sm font-medium text-amber-700">{createOpenWarning}</div>
                ) : null}
              </div>
            </div>

            {cacheWarning && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
                <p>{cacheWarning}</p>
                <button type="button" disabled={retryingCache || loading} onClick={retryCache}
                  className="mt-2 rounded-lg bg-amber-900 px-4 py-2 text-white disabled:opacity-50">
                  {retryingCache ? "Se reconstruiește..." : "Reîncearcă reconstruirea cache-ului"}
                </button>
              </div>
            )}
            {(errorMessage || successMessage) && (
              <div
          className={`rounded-xl border px-5 py-4 text-sm font-medium shadow-sm ${
                  errorMessage
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {errorMessage || successMessage}
              </div>
            )}

            <VideoSheet
              open={showForm}
              onOpenChange={(open) => {
                if (!open) closeForm();
              }}
              editingVideo={editingVideo}
              onSubmit={handleFormSubmit}
              loading={loading}
              error={errorMessage || undefined}
            />

      <Modal
        open={!!previewVideo}
        onClose={() => setPreviewVideo(null)}
        title={previewVideo ? `Test video: ${previewVideo.title}` : "Test video"}
      >
        {previewVideo && (
          <div className="space-y-4">
            {getEmbedUrl(previewVideo) ? (
              <div className="aspect-video w-full overflow-hidden rounded-xl border border-gray-200 bg-black">
                <iframe
                  className="h-full w-full"
                  src={getEmbedUrl(previewVideo) || undefined}
                  title={previewVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Nu am putut genera un embed. Deschide linkul direct.
              </div>
            )}
            <button
              type="button"
              onClick={() => handleOpen(previewVideo)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50"
            >
              Deschide în tab nou
            </button>
          </div>
        )}
      </Modal>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
                <input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Caută după titlu..."
            className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value as VideoPlatform | "all")}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Toate platformele</option>
                  <option value="youtube">YouTube</option>
                  <option value="vimeo">Vimeo</option>
                  <option value="bunny">Bunny Stream</option>
                </select>
                <select
                  value={publishFilter}
                  onChange={(e) => setPublishFilter(e.target.value as PublishFilter)}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Toate statusurile</option>
                  <option value="published">Publicate</option>
                  <option value="unpublished">Nepublicate</option>
                </select>
                <select
                  value={premiumFilter}
                  onChange={(e) => setPremiumFilter(e.target.value as PremiumFilter)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Toate</option>
                  <option value="premium">Premium</option>
                  <option value="nonPremium">Nepremium</option>
                </select>
                <select
                  value={scheduleFilter}
                  onChange={(e) => setScheduleFilter(e.target.value as ScheduleFilter)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Toate programările</option>
                  <option value="active">Active acum</option>
                  <option value="scheduled">Programate</option>
                </select>
                <button
                  onClick={() => {
                    setSearchValue("");
                    setPlatformFilter("all");
                    setPublishFilter("all");
                    setPremiumFilter("all");
                    setScheduleFilter("all");
                    setSortField(DEFAULT_SORT_FIELD);
                    setSortDirection(DEFAULT_SORT_DIRECTION);
                  }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50"
                >
                  Resetează filtre
                </button>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-sm text-gray-600">
              Afișate pe pagină: <span className="font-semibold text-gray-900">{sortedVideos.length}</span>
                  </div>
            {(loading || loadingPage) && <span className="text-sm text-blue-600">Se încarcă...</span>}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 text-gray-700">
                <span className="font-medium">Documente / pagină:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {[10, 20, 30, 50].map((size) => (
                    <option key={size} value={size}>
                      {size} / pagină
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-gray-600">
                Pagină server: {page}
              </div>
            </div>

            <VideoTable
              videos={sortedVideos}
              loading={loading || loadingPage}
              sortField={sortField}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTogglePublish={handleTogglePublish}
              onOpen={handleOpen}
              onCopy={handleCopy}
            onPreview={handlePreview}
          />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-600">
                Pagina {page} {hasNextPage ? "(mai există rezultate)" : "(ultima pagină încărcată)"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadPrevVideosPage}
                  disabled={page === 1}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Înapoi
                </button>
                <button
                  type="button"
                  onClick={loadNextVideosPage}
                  disabled={!hasNextPage || !nextCursor}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Înainte
                </button>
              </div>
            </div>
        </>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Categorii</h1>
            <p className="mt-2 text-base text-gray-600">
              Adaugă și gestionează categoriile folosite în videoclipuri.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <label className="text-sm font-medium text-gray-700">Categorie nouă</label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                value={categoryInput}
                onChange={(e) => {
                  setCategoryInput(e.target.value);
                  setCategoryLocales(undefined);
                  setCategoryTranslateMessage("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Ex: Meditații, Tarot, Live Sessions"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                disabled={isCategoryTranslating}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 hover:shadow-md"
              >
                + Adaugă
              </button>
              <button
                type="button"
                onClick={handleTranslateCategory}
                disabled={isCategoryTranslating}
                className="rounded-lg border border-blue-600 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition-all hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCategoryTranslating ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    Se localizează...
                  </span>
                ) : (
                  "Generează localizări"
                )}
              </button>
            </div>
            {isCategoryTranslating && (
              <div className="mt-3 inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                Se traduc textele...va rugam asteptati...
              </div>
            )}
            {categoryTranslateMessage && (
              <div
                className={`mt-3 text-sm ${
                  categoryTranslateMessage.includes("eșuat")
                    ? "text-red-600"
                    : "text-emerald-600"
                }`}
              >
                {categoryTranslateMessage}
              </div>
            )}
            {categoryMessage && (
              <div className="mt-3 text-sm text-gray-600">{categoryMessage}</div>
            )}
          </div>
          {showCategoryTranslateConfirm && (
            <div className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-900/60 px-4">
              <div
                className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-lg font-semibold text-gray-900">
                  Textele nu au fost localizate
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  Nu s-au localizat textele pe limbile necesare. Vrei să generezi localizările și să
                  adaugi categoria?
                </p>
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCategoryTranslateConfirm(false)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow"
                  >
                    Anulează
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCategoryTranslate}
                    disabled={isCategoryTranslating}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCategoryTranslating ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/90 border-t-transparent" />
                        Se localizează...
                      </span>
                    ) : (
                      "Localizează și adaugă"
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Categorii existente</div>
            {categoryDocs.length === 0 ? (
              categoriesLoading ? (
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  Se încarcă categoriile...
                </div>
              ) : (
              <p className="mt-2 text-sm text-gray-500">Nu există categorii salvate încă.</p>
              )
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {categoryDocs.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => openCategoryDetails(category)}
                    className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-all hover:bg-gray-200"
                    title="Vezi localizările"
                  >
                    {category.name}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCategory(category.name);
                      }}
                      className="rounded-full px-1 text-gray-500 hover:text-red-600"
                      aria-label={`Șterge categoria ${category.name}`}
                      title="Șterge categoria"
                    >
                      ×
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Modal open={showCategoryDetails} onClose={closeCategoryDetails} title="Detalii categorie">
            {selectedCategory ? (
              <div className="max-h-full min-h-0 space-y-5 overflow-y-auto">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold text-gray-900">{selectedCategory.name}</div>
                    <div className="mt-1 text-sm text-gray-600">
                      Verifică localizările pe limbile necesare.
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Slug:{" "}
                      <span className="font-mono text-gray-700">
                        {selectedCategory.slug || slugifyText(selectedCategory.name)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(selectedCategory.name)}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition-all hover:bg-red-50 hover:shadow"
                      title="Șterge categoria"
                    >
                      <span className="inline-flex h-4 w-4" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                          <path
                            d="M9 3h6m-8 4h10m-1 0-.8 13a2 2 0 0 1-2 2H9.8a2 2 0 0 1-2-2L7 7m3 4v7m4-7v7"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      Șterge
                    </button>
                    <button
                      type="button"
                      onClick={closeCategoryDetails}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow"
                      aria-label="Închide"
                      title="Închide"
                    >
                      <span className="text-lg leading-none">×</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-700">
                      <tr>
                        <th className="px-5 py-3">Limbă</th>
                        <th className="px-5 py-3">Traducere</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {Object.keys(LANGUAGE_LABELS).map((langKey) => {
                        const langInfo = (LANGUAGE_LABELS as Record<string, any>)[langKey];
                        const langLabel =
                          typeof langInfo?.denumire === "string" && langInfo.denumire.trim()
                            ? langInfo.denumire
                            : langKey;
                        const value =
                          selectedCategory.locales?.[langKey] ??
                          (langKey === "ro" ? selectedCategory.name : "");
                        const isMissing = !value || !value.trim();
                        return (
                          <tr key={langKey}>
                            <td className="px-5 py-3 font-medium text-gray-900">
                              {langLabel}{" "}
                              <span className="text-xs font-semibold text-gray-500">({langKey})</span>
                            </td>
                            <td className="px-5 py-3 text-gray-700">
                              {isMissing ? <span className="text-gray-400">—</span> : value}
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                                  isMissing
                                    ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                                    : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                                }`}
                              >
                                {isMissing ? "Lipsește" : "OK"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">Selectează o categorie.</div>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}
