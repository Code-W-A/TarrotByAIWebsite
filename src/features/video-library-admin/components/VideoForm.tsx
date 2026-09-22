// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Timestamp } from "firebase/firestore";
import type { VideoCreateInput, VideoDoc, VideoLocales, VideoPlatform } from "../types/video";
import {
  RO_VIDEO_URL_REQUIRED_MESSAGE,
  validateVideoInput,
  validateVideoPublicReleaseDraft,
  type VideoValidationErrors,
} from "../utils/videoValidation";
import { listVideoCategories } from "../services/videos.service";
import { LANGUAGE_LABELS } from "../../../../data/constants";
import { gTranslateFetch } from "../../../../utils/apiUtils";
import {
  deriveRootVideoUrlFromLocales,
  hasAnyLocalizedVideoUrl,
  resolveLibraryEmbedSrc,
} from "../../../../lib/videoLibraryPublic";
import { SITE_LOCALES } from "../utils/siteLocales";
import { mergeLocalesWithVideoUrls, siteLocalesRootPreferredOrder } from "../utils/localeVideoMerge";
import { sortLocalesForVideoAdmin } from "../utils/videoAdminLocaleOrder";
import {
  buildVideoPublicReleaseDate,
  getVideoPublicReleaseInputs,
  resolveVideoAccessMode,
  VIDEO_ACCESS_MODE_DUAL,
  VIDEO_ACCESS_MODE_FREE,
  VIDEO_ACCESS_MODE_PREMIUM,
  VIDEO_PUBLIC_RELEASE_DEFAULT_TIME,
  VIDEO_RELEASE_TIMEZONE,
} from "../../../../lib/videoReleaseSchedule";
import {
  formatChapterTime,
  normalizeVideoChapters,
  parseChapterTime,
} from "../../../../lib/videoChapters";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import ChapterEditorDialog, { type ChapterDraft } from "./ChapterEditorDialog";

type Props = {
  initialValue?: VideoDoc | null;
  onCancel: () => void;
  onSubmit: (data: VideoCreateInput) => Promise<void> | void;
  loading?: boolean;
};

type FormTab = "general" | "links" | "chapters" | "localization";

const ROOT_PREF = siteLocalesRootPreferredOrder(SITE_LOCALES);

const TAB_ORDER: FormTab[] = ["general", "links", "chapters", "localization"];

const TAB_LABELS: Record<FormTab, string> = {
  general: "General",
  links: "Linkuri",
  chapters: "Capitole",
  localization: "Localizare",
};

function buildInitialLocaleVideoUrls(video: VideoDoc | null | undefined): Record<string, string> {
  const next: Record<string, string> = Object.fromEntries(SITE_LOCALES.map((lc) => [lc, ""]));
  if (!video) return next;
  for (const lc of SITE_LOCALES) {
    const u = video.locales?.[lc]?.videoUrl?.trim();
    if (u) next[lc] = u;
  }
  const root = video.videoUrl?.trim();
  if (root && !hasAnyLocalizedVideoUrl(video)) {
    next.ro = root;
  }
  return next;
}

const platformOptions: Array<{ value: VideoPlatform; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "vimeo", label: "Vimeo" },
  { value: "bunny", label: "Bunny Stream" },
];

function buildChapterDrafts(chapters: unknown): ChapterDraft[] {
  return normalizeVideoChapters(chapters, { locale: "ro", includeLocales: true }).map(
    (chapter: any, index: number) => {
      const titles: Record<string, string> = {};
      if (chapter.locales && typeof chapter.locales === "object") {
        for (const [locale, entry] of Object.entries(chapter.locales)) {
          const title =
            entry && typeof entry === "object" && typeof (entry as any).title === "string"
              ? (entry as any).title.trim()
              : "";
          if (title) titles[locale] = title;
        }
      }
      const title = chapter.title || titles.ro || "";
      if (title && !titles.ro) titles.ro = title;
      return {
        id: `${Date.now()}-${index}-${chapter.startSeconds}`,
        title,
        titles,
        startInput: formatChapterTime(chapter.startSeconds),
        endInput:
          typeof chapter.endSeconds === "number" ? formatChapterTime(chapter.endSeconds) : "",
      };
    }
  );
}

function buildChaptersFromDrafts(drafts: ChapterDraft[]) {
  return drafts
    .map((draft) => {
      const titles: Record<string, string> = {};
      for (const [locale, value] of Object.entries(draft.titles || {})) {
        const title = value.trim();
        if (title) titles[locale] = title;
      }
      const title = (titles.ro || draft.title || "").trim();
      const startSeconds = parseChapterTime(draft.startInput);
      const endSeconds = draft.endInput.trim() ? parseChapterTime(draft.endInput) : null;
      if (!title || startSeconds == null) return null;
      if (!titles.ro) titles.ro = title;
      return {
        title,
        startSeconds,
        endSeconds,
        locales: Object.fromEntries(
          Object.entries(titles).map(([locale, localeTitle]) => [locale, { title: localeTitle }])
        ),
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.startSeconds - b.startSeconds);
}

function pickGeneralErrors(all: VideoValidationErrors): VideoValidationErrors {
  const next: VideoValidationErrors = {};
  if (all.title) next.title = all.title;
  if (all.platform) next.platform = all.platform;
  if (all.publicReleaseAt) next.publicReleaseAt = all.publicReleaseAt;
  if (all.thumbnailUrl) next.thumbnailUrl = all.thumbnailUrl;
  if (all.isPublished) next.isPublished = all.isPublished;
  return next;
}

function pickLinksErrors(all: VideoValidationErrors): VideoValidationErrors {
  const next: VideoValidationErrors = {};
  if (all.localizedVideo) next.localizedVideo = all.localizedVideo;
  if (all.localeVideos) next.localeVideos = all.localeVideos;
  return next;
}

function pickChaptersErrors(all: VideoValidationErrors): VideoValidationErrors {
  const next: VideoValidationErrors = {};
  if (all.chapters) next.chapters = all.chapters;
  return next;
}

function hasErrors(errors: VideoValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export default function VideoForm({ initialValue, onCancel, onSubmit, loading = false }: Props) {
  const isEditing = !!initialValue;
  const [activeTab, setActiveTab] = useState<FormTab>("general");
  const [form, setForm] = useState<VideoCreateInput>({
    title: "",
    description: "",
    platform: "youtube",
    category: "",
    thumbnailUrl: "",
    order: undefined,
    isPublished: false,
    isPremium: true,
    featuredOnHome: false,
    publishAt: null,
    publicReleaseAt: null,
  });
  const [localeVideoUrls, setLocaleVideoUrls] = useState<Record<string, string>>(() =>
    buildInitialLocaleVideoUrls(null)
  );
  const [errors, setErrors] = useState<VideoValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [locales, setLocales] = useState<VideoLocales | undefined>(initialValue?.locales);
  const [chapterDrafts, setChapterDrafts] = useState<ChapterDraft[]>(() =>
    buildChapterDrafts(initialValue?.chapters)
  );
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateMessage, setTranslateMessage] = useState("");
  const [showTranslateConfirm, setShowTranslateConfirm] = useState(false);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [editingChapter, setEditingChapter] = useState<ChapterDraft | null>(null);
  const uiLocked = submitting || isTranslating || loading;
  const [publishAtInput, setPublishAtInput] = useState("");
  const [publicReleaseDateInput, setPublicReleaseDateInput] = useState("");
  const [publicReleaseTimeInput, setPublicReleaseTimeInput] = useState(
    VIDEO_PUBLIC_RELEASE_DEFAULT_TIME
  );
  const [accessMode, setAccessMode] = useState<string>(VIDEO_ACCESS_MODE_PREMIUM);
  const roCardRef = useRef<HTMLDivElement>(null);
  const videoFormLocales = useMemo(() => sortLocalesForVideoAdmin(SITE_LOCALES), []);

  const hasLocalePreview = Boolean(locales && Object.keys(locales).length > 0);

  const formatDateTimeLocal = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  };

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await listVideoCategories();
        const names = categories
          .map((item) => item.name)
          .filter((name) => name.trim().length > 0);
        const uniqueNames = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        setExistingCategories(uniqueNames);
      } catch (error) {
        console.error("Failed to load categories:", error);
      }
    };
    loadCategories();
  }, []);

  useEffect(() => {
    if (!initialValue?.category) return;
    const category = initialValue.category.trim();
    if (!category) return;
    const exists = existingCategories.some((item) => item.toLowerCase() === category.toLowerCase());
    if (exists) return;
    setExistingCategories((prev) => [...prev, category].sort((a, b) => a.localeCompare(b)));
  }, [initialValue, existingCategories]);

  useEffect(() => {
    setActiveTab("general");
    if (initialValue) {
      setForm({
        title: initialValue.title || "",
        description: initialValue.description || "",
        platform: initialValue.platform,
        category: initialValue.category || "",
        thumbnailUrl: typeof initialValue.thumbnailUrl === "string" ? initialValue.thumbnailUrl : "",
        order: initialValue.order,
        isPublished: initialValue.isPublished,
        isPremium: initialValue.isPremium === true,
        featuredOnHome: initialValue.featuredOnHome === true,
        publishAt: initialValue.publishAt ?? null,
        publicReleaseAt: initialValue.publicReleaseAt ?? null,
        chapters: initialValue.chapters ?? [],
      });
      setChapterDrafts(buildChapterDrafts(initialValue.chapters));
      setAccessMode(resolveVideoAccessMode(initialValue));
      setLocaleVideoUrls(buildInitialLocaleVideoUrls(initialValue));
      setErrors({});
      setLocales(initialValue.locales);
      setTranslateMessage("");
      if (initialValue.publishAt) {
        setPublishAtInput(formatDateTimeLocal(initialValue.publishAt.toDate()));
      } else {
        setPublishAtInput("");
      }
      const releaseInputs = getVideoPublicReleaseInputs(initialValue.publicReleaseAt);
      setPublicReleaseDateInput(releaseInputs.date);
      setPublicReleaseTimeInput(releaseInputs.time);
    } else {
      setForm({
        title: "",
        description: "",
        platform: "youtube",
        category: "",
        thumbnailUrl: "",
        order: undefined,
        isPublished: false,
        isPremium: true,
        featuredOnHome: false,
        publishAt: null,
        publicReleaseAt: null,
        chapters: [],
      });
      setChapterDrafts([]);
      setAccessMode(VIDEO_ACCESS_MODE_PREMIUM);
      setPublicReleaseDateInput("");
      setPublicReleaseTimeInput(VIDEO_PUBLIC_RELEASE_DEFAULT_TIME);
      setLocaleVideoUrls(buildInitialLocaleVideoUrls(null));
      setLocales(undefined);
      setErrors({});
      setTranslateMessage("");
    }
  }, [initialValue]);

  useEffect(() => {
    if (initialValue) return;
    const now = new Date();
    setPublishAtInput(formatDateTimeLocal(now));
    setForm((prev) => ({ ...prev, publishAt: Timestamp.fromDate(now) }));
  }, [initialValue]);

  const handleChange = (key: keyof VideoCreateInput, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePublishAtChange = (value: string) => {
    setPublishAtInput(value);
    if (!value) {
      setForm((prev) => ({ ...prev, publishAt: null }));
      return;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    setForm((prev) => ({ ...prev, publishAt: Timestamp.fromDate(parsed) }));
  };

  const handleAccessModeChange = (value: string) => {
    setAccessMode(value);
    setErrors((prev) => ({ ...prev, publicReleaseAt: undefined }));
    if (value === VIDEO_ACCESS_MODE_FREE) {
      setForm((prev) => ({ ...prev, isPremium: false, publicReleaseAt: null }));
      return;
    }
    if (value === VIDEO_ACCESS_MODE_PREMIUM) {
      setForm((prev) => ({ ...prev, isPremium: true, publicReleaseAt: null }));
      return;
    }
    const releaseDate = buildVideoPublicReleaseDate(
      publicReleaseDateInput,
      publicReleaseTimeInput
    );
    setForm((prev) => ({
      ...prev,
      isPremium: true,
      publicReleaseAt: releaseDate ? Timestamp.fromDate(releaseDate) : null,
    }));
  };

  const handlePublicReleaseDateChange = (value: string) => {
    setPublicReleaseDateInput(value);
    setErrors((prev) => ({ ...prev, publicReleaseAt: undefined }));
    const releaseDate = buildVideoPublicReleaseDate(value, publicReleaseTimeInput);
    setForm((prev) => ({
      ...prev,
      isPremium: true,
      publicReleaseAt: releaseDate ? Timestamp.fromDate(releaseDate) : null,
    }));
  };

  const handlePublicReleaseTimeChange = (value: string) => {
    setPublicReleaseTimeInput(value);
    setErrors((prev) => ({ ...prev, publicReleaseAt: undefined }));
    const releaseDate = buildVideoPublicReleaseDate(publicReleaseDateInput, value);
    setForm((prev) => ({
      ...prev,
      isPremium: true,
      publicReleaseAt: releaseDate ? Timestamp.fromDate(releaseDate) : null,
    }));
  };

  const buildMergedLocales = (localesDraft?: VideoLocales) =>
    mergeLocalesWithVideoUrls(localesDraft, localeVideoUrls, SITE_LOCALES, form.title.trim());

  const buildValidationInput = (
    mergedLocales: VideoLocales,
    denormUrl: string
  ): VideoCreateInput => ({
    ...form,
    isPremium: accessMode !== VIDEO_ACCESS_MODE_FREE,
    publicReleaseAt:
      accessMode === VIDEO_ACCESS_MODE_DUAL ? form.publicReleaseAt ?? null : null,
    videoUrl: denormUrl || "",
    locales: mergedLocales,
    chapters: buildChaptersFromDrafts(chapterDrafts),
    thumbnailUrl:
      form.platform === "bunny"
        ? typeof form.thumbnailUrl === "string"
          ? form.thumbnailUrl.trim()
          : ""
        : "",
  });

  const runFormValidation = (
    mergedLocales: VideoLocales,
    denormUrl: string
  ): VideoValidationErrors => {
    const validation = validateVideoInput(buildValidationInput(mergedLocales, denormUrl));
    const releaseDraftError = validateVideoPublicReleaseDraft({
      accessMode,
      dateInput: publicReleaseDateInput,
      timeInput: publicReleaseTimeInput,
      publicReleaseAt: form.publicReleaseAt,
    });
    if (releaseDraftError) {
      validation.publicReleaseAt = releaseDraftError;
    }
    return validation;
  };

  const applyValidationResult = (
    validation: VideoValidationErrors,
    tabHint?: FormTab
  ): boolean => {
    setErrors(validation);
    if (!hasErrors(validation)) return true;
    if (tabHint) setActiveTab(tabHint);
    if (validation.localeVideos?.ro || validation.localizedVideo) {
      roCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return false;
  };

  const getFullValidation = (): VideoValidationErrors => {
    const mergedLocales = buildMergedLocales(locales);
    const denormUrl = deriveRootVideoUrlFromLocales(mergedLocales, ROOT_PREF);
    return runFormValidation(mergedLocales, denormUrl);
  };

  const validateGeneralTab = (): boolean => {
    const all = getFullValidation();
    const stepErrors = pickGeneralErrors(all);
    return applyValidationResult(stepErrors, "general");
  };

  const validateLinksTab = (): boolean => {
    const all = getFullValidation();
    const stepErrors = pickLinksErrors(all);
    return applyValidationResult(stepErrors, "links");
  };

  const validateChaptersTab = (): boolean => {
    if (chapterDrafts.length === 0) {
      setErrors((prev) => ({ ...prev, chapters: undefined }));
      return true;
    }
    const all = getFullValidation();
    const stepErrors = pickChaptersErrors(all);
    return applyValidationResult(stepErrors, "chapters");
  };

  const handleLocaleVideoUrlChange = (lc: string, value: string) => {
    setLocaleVideoUrls((prev) => ({ ...prev, [lc]: value }));
    if (lc !== "ro") return;
    const platform =
      form.platform === "bunny" || form.platform === "vimeo" || form.platform === "youtube"
        ? form.platform
        : "youtube";
    const trimmed = value.trim();
    if (!trimmed || !resolveLibraryEmbedSrc(platform, trimmed)) return;
    setErrors((prev) => {
      if (!prev.localeVideos?.ro && prev.localizedVideo !== RO_VIDEO_URL_REQUIRED_MESSAGE) {
        return prev;
      }
      const next: VideoValidationErrors = { ...prev };
      if (next.localeVideos?.ro) {
        const localeVideos = { ...next.localeVideos };
        delete localeVideos.ro;
        next.localeVideos = Object.keys(localeVideos).length > 0 ? localeVideos : undefined;
      }
      if (
        next.localizedVideo === RO_VIDEO_URL_REQUIRED_MESSAGE ||
        next.localizedVideo?.includes("RO")
      ) {
        delete next.localizedVideo;
      }
      return next;
    });
  };

  const openAddChapter = () => {
    setEditingChapter(null);
    setChapterDialogOpen(true);
  };

  const openEditChapter = (chapter: ChapterDraft) => {
    setEditingChapter(chapter);
    setChapterDialogOpen(true);
  };

  const handleSaveChapter = (draft: ChapterDraft) => {
    setChapterDrafts((prev) => {
      const exists = prev.some((item) => item.id === draft.id);
      if (exists) {
        return prev.map((item) => (item.id === draft.id ? draft : item));
      }
      return [...prev, draft];
    });
    setErrors((prev) => ({ ...prev, chapters: undefined }));
  };

  const handleRemoveChapter = (id: string) => {
    setChapterDrafts((prev) => prev.filter((chapter) => chapter.id !== id));
  };

  const generateLocales = async (): Promise<VideoLocales | undefined> => {
    if (!form.title?.trim()) {
      setTranslateMessage("Completează titlul înainte de localizare.");
      return undefined;
    }
    setIsTranslating(true);
    setTranslateMessage("");
    try {
      const result: VideoLocales = {};
      const baseTitle = form.title.trim();
      const baseDescription = form.description?.trim() || "";
      for (const lang of videoFormLocales) {
        const keepVideo = localeVideoUrls[lang]?.trim() || locales?.[lang]?.videoUrl?.trim();
        if (lang === "ro") {
          result[lang] = {
            title: baseTitle,
            description: baseDescription || undefined,
            ...(keepVideo ? { videoUrl: keepVideo } : {}),
          };
          continue;
        }
        const [titleTranslated, descriptionTranslated] = await Promise.all([
          gTranslateFetch(baseTitle, lang),
          baseDescription ? gTranslateFetch(baseDescription, lang) : Promise.resolve(""),
        ]);
        result[lang] = {
          title: titleTranslated || baseTitle,
          description: descriptionTranslated ? descriptionTranslated : undefined,
          ...(keepVideo ? { videoUrl: keepVideo } : {}),
        };
      }
      setLocales(result);
      setTranslateMessage("Localizarea s-a terminat. Poți continua.");
      return result;
    } catch {
      setTranslateMessage("Localizarea a eșuat. Încearcă din nou.");
      return undefined;
    } finally {
      setIsTranslating(false);
    }
  };

  const submitForm = async (localesToSubmit?: VideoLocales) => {
    setSubmitting(true);
    try {
      const mergedLocales = buildMergedLocales(localesToSubmit);
      const denormUrl = deriveRootVideoUrlFromLocales(mergedLocales, ROOT_PREF);
      const chapters = buildChaptersFromDrafts(chapterDrafts);
      await onSubmit({
        ...form,
        isPremium: accessMode !== VIDEO_ACCESS_MODE_FREE,
        publicReleaseAt:
          accessMode === VIDEO_ACCESS_MODE_DUAL ? form.publicReleaseAt ?? null : null,
        title: form.title.trim(),
        description: form.description?.trim() || "",
        videoUrl: denormUrl || "",
        category: form.category?.trim() || "",
        thumbnailUrl:
          form.platform === "bunny"
            ? typeof form.thumbnailUrl === "string"
              ? form.thumbnailUrl.trim()
              : ""
            : "",
        locales: mergedLocales,
        chapters,
      });
    } catch (error) {
      console.error("[VideoForm] Submit failed", error);
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  const confirmTranslateAndSubmit = async () => {
    setShowTranslateConfirm(false);
    const generatedLocales = await generateLocales();
    if (!generatedLocales) return;
    await submitForm(generatedLocales);
  };

  const saveSkipTranslateLocales = async () => {
    setShowTranslateConfirm(false);
    const t = form.title.trim();
    const d = form.description?.trim() || "";
    const baseBare: VideoLocales = {};
    for (const lc of SITE_LOCALES) {
      baseBare[lc] = { title: t, ...(d ? { description: d } : {}) };
    }
    const mergedLocales = mergeLocalesWithVideoUrls(
      baseBare,
      localeVideoUrls,
      SITE_LOCALES,
      form.title.trim()
    );
    const denormUrl = deriveRootVideoUrlFromLocales(mergedLocales, ROOT_PREF);
    const validation = runFormValidation(mergedLocales, denormUrl);
    if (!applyValidationResult(validation, "localization")) return;
    setLocales(baseBare);
    await submitForm(baseBare);
  };

  const goToTab = (tab: FormTab) => setActiveTab(tab);

  const handleOpenTab = (tab: FormTab) => {
    const idx = TAB_ORDER.indexOf(tab);
    const currentIdx = TAB_ORDER.indexOf(activeTab);
    if (idx <= currentIdx) {
      goToTab(tab);
      return;
    }
    if (tab === "links" && !validateGeneralTab()) return;
    if (tab === "chapters") {
      if (!validateGeneralTab()) return;
      if (!validateLinksTab()) return;
    }
    if (tab === "localization") {
      if (!validateGeneralTab()) return;
      if (!validateLinksTab()) return;
      if (!validateChaptersTab()) return;
    }
    goToTab(tab);
  };

  const handleContinue = () => {
    if (activeTab === "general") {
      if (validateGeneralTab()) goToTab("links");
      return;
    }
    if (activeTab === "links") {
      if (validateLinksTab()) goToTab("chapters");
      return;
    }
    if (activeTab === "chapters") {
      if (validateChaptersTab()) goToTab("localization");
    }
  };

  const handleBack = () => {
    const idx = TAB_ORDER.indexOf(activeTab);
    if (idx > 0) goToTab(TAB_ORDER[idx - 1]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab !== "localization") {
      handleContinue();
      return;
    }
    const mergedLocales = buildMergedLocales(locales);
    const denormUrl = deriveRootVideoUrlFromLocales(mergedLocales, ROOT_PREF);
    const validation = runFormValidation(mergedLocales, denormUrl);
    if (!applyValidationResult(validation, "localization")) {
      if (hasErrors(pickGeneralErrors(validation))) setActiveTab("general");
      else if (hasErrors(pickLinksErrors(validation))) setActiveTab("links");
      else if (hasErrors(pickChaptersErrors(validation))) setActiveTab("chapters");
      return;
    }
    const needsLocales = !locales || Object.keys(locales).length === 0;
    if (needsLocales) {
      setShowTranslateConfirm(true);
      return;
    }
    await submitForm(locales);
  };

  const renderLocaleLinks = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <label className="text-sm font-medium text-gray-700">Link video pe limbă (site) *</label>
        {errors.localizedVideo ? (
          <p className="mt-2 text-xs font-medium text-red-600">{errors.localizedVideo}</p>
        ) : null}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-gray-50/80 p-3 [-webkit-overflow-scrolling:touch]">
        <div className="space-y-4">
          {videoFormLocales.map((lc) => {
            const lbl =
              (LANGUAGE_LABELS as Record<string, { denumire?: string }>)?.[lc]?.denumire ??
              lc.toUpperCase();
            const isRo = lc === "ro";
            const hasLink = Boolean(localeVideoUrls[lc]?.trim());
            const rowErr = errors.localeVideos?.[lc];
            const roMissing = isRo && !hasLink;
            return (
              <div
                key={lc}
                ref={isRo ? roCardRef : undefined}
                className={`rounded-md border bg-white p-4 shadow-sm ${
                  isRo
                    ? rowErr
                      ? "border-red-300 ring-1 ring-red-100"
                      : roMissing
                        ? "border-amber-300 ring-1 ring-amber-100"
                        : "border-emerald-200"
                    : "border-gray-200"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label className="text-sm font-semibold text-gray-700">
                    {lbl}{" "}
                    <span className="font-mono text-xs font-normal text-gray-500">({lc})</span>
                  </label>
                  <span
                    className={`text-xs font-medium ${
                      hasLink ? "text-emerald-600" : isRo ? "text-amber-700" : "text-gray-400"
                    }`}
                  >
                    {hasLink
                      ? "link setat"
                      : isRo
                        ? "obligatoriu · lipsește"
                        : "opțional · lipsește"}
                  </span>
                </div>
                {isRo && roMissing && !rowErr ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {RO_VIDEO_URL_REQUIRED_MESSAGE}
                  </p>
                ) : null}
                <input
                  value={localeVideoUrls[lc] ?? ""}
                  onChange={(e) => handleLocaleVideoUrlChange(lc, e.target.value)}
                  disabled={uiLocked}
                  className={`mt-2.5 w-full rounded-md border px-3 py-3 text-sm text-gray-900 shadow-inner focus:outline-none focus:ring-2 ${
                    rowErr
                      ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                      : isRo && roMissing
                        ? "border-amber-300 focus:border-amber-500 focus:ring-amber-500/20"
                        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/25"
                  } disabled:bg-gray-50 disabled:text-gray-500`}
                  placeholder={
                    isRo
                      ? "URL Bunny obligatoriu — ro (ex. player.mediadelivery.net/...)"
                      : `URL sau id clip — ${lc}`
                  }
                  autoComplete="off"
                />
                {rowErr ? <p className="mt-1.5 text-xs text-red-600">{rowErr}</p> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="inline-flex shrink-0 flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-1">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleOpenTab(tab)}
              disabled={uiLocked}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                activeTab === tab
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div
          className={`mt-5 min-h-0 flex-1 pr-1 ${
            activeTab === "links"
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
          {activeTab === "general" ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6">
                <div className="min-w-0 sm:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Titlu *</label>
                  <textarea
                    rows={3}
                    value={form.title}
                    onChange={(e) => handleChange("title", e.target.value)}
                    disabled={uiLocked}
                    className={`mt-1.5 min-h-[88px] w-full resize-y rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                      errors.title
                        ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                    } disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70`}
                    placeholder="Titlul videoclipului"
                  />
                  {errors.title ? <p className="mt-1.5 text-xs text-red-600">{errors.title}</p> : null}
                </div>

                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">Platformă *</label>
                  <select
                    value={form.platform}
                    onChange={(e) => handleChange("platform", e.target.value as VideoPlatform)}
                    disabled={uiLocked}
                    className={`mt-1.5 w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                      errors.platform
                        ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                    } disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70`}
                  >
                    {platformOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {errors.platform ? (
                    <p className="mt-1.5 text-xs text-red-600">{errors.platform}</p>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">Categorie</label>
                  <select
                    value={form.category}
                    onChange={(e) => handleChange("category", e.target.value)}
                    disabled={uiLocked}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70"
                  >
                    <option value="">Selectează categorie</option>
                    {existingCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-gray-500">
                    Adaugă categorii noi din tab-ul Categorii
                  </p>
                </div>

                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">Publică la</label>
                  <input
                    type="datetime-local"
                    value={publishAtInput}
                    onChange={(e) => handlePublishAtChange(e.target.value)}
                    disabled={uiLocked}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70"
                  />
                  <p className="mt-1.5 text-xs text-gray-500">
                    Data/ora locală din browser când videoclipul devine vizibil în aplicație.
                  </p>
                </div>

                <div className="min-w-0">
                  <label className="text-sm font-medium text-gray-700">Mod acces</label>
                  <select
                    value={accessMode}
                    onChange={(e) => handleAccessModeChange(e.target.value)}
                    disabled={uiLocked}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70"
                  >
                    <option value={VIDEO_ACCESS_MODE_FREE}>Gratuit de la T1</option>
                    <option value={VIDEO_ACCESS_MODE_PREMIUM}>Premium permanent</option>
                    <option value={VIDEO_ACCESS_MODE_DUAL}>Premium apoi public</option>
                  </select>
                </div>

                {accessMode === VIDEO_ACCESS_MODE_DUAL ? (
                  <div className="min-w-0 sm:col-span-2">
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6">
                      <div className="min-w-0">
                        <label
                          htmlFor="video-public-release-date"
                          className="text-sm font-medium text-gray-700"
                        >
                          Data publicării generale *
                        </label>
                        <input
                          id="video-public-release-date"
                          type="date"
                          value={publicReleaseDateInput}
                          onChange={(e) => handlePublicReleaseDateChange(e.target.value)}
                          disabled={uiLocked}
                          className={`mt-1.5 w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                            errors.publicReleaseAt
                              ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                              : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                          } disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70`}
                        />
                      </div>
                      <div className="min-w-0">
                        <label
                          htmlFor="video-public-release-time"
                          className="text-sm font-medium text-gray-700"
                        >
                          Ora publicării generale *
                        </label>
                        <input
                          id="video-public-release-time"
                          type="time"
                          step={60}
                          value={publicReleaseTimeInput}
                          onChange={(e) => handlePublicReleaseTimeChange(e.target.value)}
                          disabled={uiLocked}
                          className={`mt-1.5 w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                            errors.publicReleaseAt
                              ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                              : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                          } disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70`}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">
                      Devine gratuit în aplicație la momentul ales. Pe site rămâne disponibil doar ca
                      previzualizare, fus {VIDEO_RELEASE_TIMEZONE}.
                    </p>
                    {errors.publicReleaseAt ? (
                      <p className="mt-1.5 text-xs text-red-600">{errors.publicReleaseAt}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {form.platform === "bunny" ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 shadow-sm">
                  <label className="text-sm font-medium text-gray-800">
                    Thumbnail Bunny{" "}
                    <span className="font-normal text-gray-600">
                      (opțional, același pentru toate limbile)
                    </span>
                  </label>
                  <input
                    type="url"
                    value={typeof form.thumbnailUrl === "string" ? form.thumbnailUrl : ""}
                    onChange={(e) => handleChange("thumbnailUrl", e.target.value)}
                    disabled={uiLocked}
                    className={`mt-1.5 w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                      errors.thumbnailUrl
                        ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                        : "border-violet-200 focus:border-violet-500 focus:ring-violet-500/20"
                    } disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70`}
                    placeholder="https://vz-….b-cdn.net/uuid-video/thumbnail.jpg"
                    autoComplete="off"
                  />
                  {errors.thumbnailUrl ? (
                    <p className="mt-1.5 text-xs text-red-600">{errors.thumbnailUrl}</p>
                  ) : (
                    <p className="mt-1.5 text-xs text-violet-900/80">
                      Din Bunny Stream → thumbnail url → copiază URL-ul imaginii (nu depinde de limbă).
                    </p>
                  )}
                </div>
              ) : null}

              <div>
                <label className="text-sm font-medium text-gray-700">Descriere</label>
                <textarea
                  rows={20}
                  value={form.description}
                  onChange={(e) => handleChange("description", e.target.value)}
                  disabled={uiLocked}
                  className="mt-1.5 min-h-[480px] max-h-[min(70vh,720px)] w-full resize-y overflow-y-auto rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm leading-relaxed text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-70"
                  placeholder="Scurtă descriere..."
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <label className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
                  <input
                    type="checkbox"
                    checked={!!form.isPublished}
                    onChange={(e) => handleChange("isPublished", e.target.checked)}
                    disabled={uiLocked}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 shadow-sm transition-all focus:ring-2 focus:ring-emerald-500/30 focus:ring-offset-0"
                  />
                  <span className="min-w-0 text-xs font-medium leading-snug text-gray-700 transition-colors group-hover:text-blue-800 group-has-[:checked]:text-emerald-800">
                    Publicat în aplicație
                  </span>
                </label>
              </div>
              {errors.isPublished ? (
                <p className="mt-1.5 text-xs text-red-600">{errors.isPublished}</p>
              ) : null}

              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!!form.featuredOnHome}
                    onChange={(e) => handleChange("featuredOnHome", e.target.checked)}
                    disabled={uiLocked}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <span className="block">
                    <span className="text-sm font-medium text-gray-900">
                      Videoclip evidențiat pe homepage
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      Maximum 2 videoclipuri publicate pot fi evidențiate simultan pe homepage.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {activeTab === "links" ? renderLocaleLinks() : null}

          {activeTab === "chapters" ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <label className="text-sm font-semibold text-gray-800">Capitole video</label>
                  <p className="mt-1 text-xs text-gray-500">
                    Adaugă sau editează capitole într-un dialog separat. Click-ul pe capitol face seek
                    în playerul Bunny.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={openAddChapter} disabled={uiLocked}>
                  + Adaugă capitol
                </Button>
              </div>
              {errors.chapters ? (
                <p className="mt-2 text-xs font-medium text-red-600">{errors.chapters}</p>
              ) : null}
              <div className="mt-3">
                {chapterDrafts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    Nu există capitole setate pentru acest video.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Start</th>
                          <th className="px-3 py-2">Final</th>
                          <th className="px-3 py-2">Titlu RO</th>
                          <th className="px-3 py-2 text-right">Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {chapterDrafts.map((chapter, index) => (
                          <tr key={chapter.id}>
                            <td className="px-3 py-2.5 text-gray-500">{index + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-800">
                              {chapter.startInput || "—"}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-600">
                              {chapter.endInput || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-900">
                              {chapter.titles.ro || chapter.title || "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditChapter(chapter)}
                                  disabled={uiLocked}
                                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                >
                                  Editează
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveChapter(chapter.id)}
                                  disabled={uiLocked}
                                  className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                >
                                  Șterge
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "localization" ? (
            <div>
              <label className="text-sm font-medium text-gray-700">Localizare</label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void generateLocales()}
                  disabled={uiLocked}
                >
                  {isTranslating ? "Se localizează..." : "Generează localizări"}
                </Button>
                {translateMessage ? (
                  <p
                    className={`text-sm ${
                      translateMessage.includes("eșuat") || translateMessage.includes("Completează")
                        ? "text-red-600"
                        : "text-emerald-600"
                    }`}
                  >
                    {translateMessage}
                  </p>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                Traducerea folosește titlul și descrierea din pasul General; localizările se salvează
                la salvarea videoclipului.
              </p>
              {hasLocalePreview ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
                  <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                    Localizări generate (titlu / descriere)
                  </div>
                  <div className="max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 z-[1] bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-700">
                        <tr>
                          <th className="px-4 py-2.5">Limbă</th>
                          <th className="px-4 py-2.5">Titlu</th>
                          <th className="px-4 py-2.5">Descriere</th>
                          <th className="px-4 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {videoFormLocales.map((lc) => {
                          const langInfo = (LANGUAGE_LABELS as Record<string, { denumire?: string }>)?.[
                            lc
                          ];
                          const langLabel =
                            typeof langInfo?.denumire === "string" && langInfo.denumire.trim()
                              ? langInfo.denumire
                              : lc;
                          const entry = locales?.[lc];
                          const titleVal =
                            typeof entry?.title === "string" ? entry.title.trim() : "";
                          const descVal =
                            typeof entry?.description === "string" ? entry.description.trim() : "";
                          const isMissing = !titleVal;
                          return (
                            <tr key={lc}>
                              <td className="px-4 py-2.5 font-medium text-gray-900">
                                {langLabel}{" "}
                                <span className="text-xs font-normal text-gray-500">({lc})</span>
                              </td>
                              <td
                                className="max-w-[12rem] truncate px-4 py-2.5 text-gray-700"
                                title={titleVal}
                              >
                                {isMissing ? <span className="text-gray-400">—</span> : titleVal}
                              </td>
                              <td
                                className="max-w-[14rem] truncate px-4 py-2.5 text-gray-700"
                                title={descVal}
                              >
                                {!descVal ? <span className="text-gray-400">—</span> : descVal}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
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
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <div>
            {activeTab !== "general" ? (
              <Button type="button" variant="outline" onClick={handleBack} disabled={uiLocked}>
                Înapoi
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={onCancel} disabled={uiLocked}>
              Renunță
            </Button>
            {activeTab === "localization" ? (
              <Button type="submit" disabled={uiLocked}>
                {isTranslating ? (
                  "Se localizează..."
                ) : submitting || loading ? (
                  "Se salvează..."
                ) : isEditing ? (
                  "Salvează"
                ) : (
                  "Creează"
                )}
              </Button>
            ) : (
              <Button type="button" onClick={handleContinue} disabled={uiLocked}>
                Continuă
              </Button>
            )}
          </div>
        </div>
      </form>

      <ChapterEditorDialog
        open={chapterDialogOpen}
        initialChapter={editingChapter}
        localeIds={videoFormLocales}
        onSave={handleSaveChapter}
        onClose={() => {
          setChapterDialogOpen(false);
          setEditingChapter(null);
        }}
        disabled={uiLocked}
      />

      <Dialog open={showTranslateConfirm} onOpenChange={setShowTranslateConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Traducerile nu au fost create</DialogTitle>
            <DialogDescription>
              Vrei să generezi traducerile automate pentru titlu și descriere înainte de salvare? Poți
              și salva același text RO peste tot, fără traducere automată.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowTranslateConfirm(false)}
            >
              Anulează
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveSkipTranslateLocales()}
              disabled={isTranslating || submitting || loading}
            >
              Aceeași text RO pentru toate limbile
            </Button>
            <Button
              type="button"
              onClick={() => void confirmTranslateAndSubmit()}
              disabled={isTranslating || submitting || loading}
            >
              Adaugă și localizează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
