import {
  addDoc,
  collection,
  deleteDoc,
  documentId,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../../firebase";
import type {
  VideoCategoryDoc,
  VideoCategoryLocales,
  VideoCreateInput,
  VideoDoc,
  VideoUpdateInput,
} from "../types/video";
import { sortVideos } from "../utils/videoSorting";
import { resolveVideoNotificationAt } from "../../../../lib/videoReleaseSchedule";

const COLLECTION_NAME = "videosVideoModule";
const CATEGORY_COLLECTION_NAME = "videoCategories";
const INTERNAL_DOC_IDS = new Set(["_meta", "_publicCache"]);
const VIDEO_NOTIFICATION_STATE_PENDING = "pending";
const VIDEO_NOTIFICATION_STATE_SENT = "sent";
const MAX_FEATURED_ON_HOME = 2;
const videosCollection = collection(db, COLLECTION_NAME);
const categoriesCollection = collection(db, CATEGORY_COLLECTION_NAME);

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

function resolveCategorySlug(category: Partial<VideoCategoryDoc>): string {
  const explicit = typeof category.slug === "string" ? category.slug.trim() : "";
  return explicit || slugifyText(category.name || "");
}

export type VideoListCursor = {
  createdAt: VideoDoc["createdAt"] | null;
  id: string;
};

export type VideoListPage = {
  items: VideoDoc[];
  nextCursor: VideoListCursor | null;
  hasNextPage: boolean;
};

export async function rebuildPublicVideoLibraryCache(): Promise<void> {
  if (typeof window === "undefined") throw new Error("Reconstruirea trebuie pornită din dashboard.");
  const dashboardAccessToken = window.localStorage.getItem("dashboard_access_token");
  const res = await fetch("/api/admin/video-library-cache/rebuild", {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(dashboardAccessToken ? { "X-Dashboard-Access": dashboardAccessToken } : {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || data?.message || "Failed to rebuild public video cache.");
  }
}

export class VideoCacheRefreshError extends Error {
  constructor() {
    super("Videoul a fost salvat, dar cache-ul nu a fost actualizat.");
    this.name = "VideoCacheRefreshError";
  }
}

async function rebuildPublicCacheAfterMutation(action: string): Promise<void> {
  try {
    await rebuildPublicVideoLibraryCache();
  } catch (error) {
    console.error(`[videos.service] Failed to rebuild public video cache after ${action}`, error);
    throw new VideoCacheRefreshError();
  }
}

const toMillisOrNull = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return ((value as { toMillis: () => number }).toMillis?.() ?? null) as number | null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return null;
};

const isPublishAtInFuture = (value: unknown, nowMs = Date.now()): boolean => {
  const publishAtMs = toMillisOrNull(value);
  return Number.isFinite(publishAtMs) && Number(publishAtMs) > nowMs;
};

const hasNotificationAlreadySent = (video: Partial<VideoDoc>): boolean => {
  if (video.notificationState === VIDEO_NOTIFICATION_STATE_SENT) return true;
  return video.notificationSentAt != null;
};

export async function listVideos(): Promise<VideoDoc[]> {
  const snapshot = await getDocs(videosCollection);
  const items: VideoDoc[] = snapshot.docs
    .filter((d) => !INTERNAL_DOC_IDS.has(d.id))
    .map((d) => {
      const data = d.data() as Omit<VideoDoc, "id">;
      return { id: d.id, ...data };
    });
  return sortVideos(items);
}

function isFeaturedOnHomeSlotCandidate(video: Partial<VideoDoc>, nowMs = Date.now()): boolean {
  return (
    video.featuredOnHome === true &&
    video.isPublished === true &&
    !isPublishAtInFuture(video.publishAt ?? null, nowMs)
  );
}

export async function assertFeaturedOnHomeLimit(excludeId?: string): Promise<void> {
  const all = await listVideos();
  const nowMs = Date.now();
  const featuredCount = all.filter((video) => {
    if (video.id === excludeId) return false;
    return isFeaturedOnHomeSlotCandidate(video, nowMs);
  }).length;
  if (featuredCount >= MAX_FEATURED_ON_HOME) {
    throw new Error(
      `Poți evidenția maximum ${MAX_FEATURED_ON_HOME} videoclipuri publice pe homepage. Dezactivează evidențierea de la un alt videoclip public înainte de a continua.`
    );
  }
}

export async function listVideosPage(
  pageSize = 20,
  cursor: VideoListCursor | null = null
): Promise<VideoListPage> {
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const constraints = [orderBy("createdAt", "desc"), orderBy(documentId(), "desc")];
  let pageQuery;

  if (cursor?.id) {
    pageQuery = query(
      videosCollection,
      ...constraints,
      startAfter(cursor.createdAt ?? null, cursor.id),
      limit(safePageSize + 1)
    );
  } else {
    pageQuery = query(videosCollection, ...constraints, limit(safePageSize + 1));
  }

  const snapshot = await getDocs(pageQuery);
  const filteredDocs = snapshot.docs.filter((docSnap) => !INTERNAL_DOC_IDS.has(docSnap.id));
  const hasNextPage = filteredDocs.length > safePageSize;
  const pageDocs = hasNextPage ? filteredDocs.slice(0, safePageSize) : filteredDocs;
  const items: VideoDoc[] = pageDocs.map((docSnap) => {
    const data = docSnap.data() as Omit<VideoDoc, "id">;
    return { id: docSnap.id, ...data };
  });
  const last = pageDocs[pageDocs.length - 1];
  const nextCursor = hasNextPage && last
    ? ({
        id: last.id,
        createdAt: (last.data() as Omit<VideoDoc, "id">).createdAt ?? null,
      } as VideoListCursor)
    : null;

  return { items, nextCursor, hasNextPage };
}

async function videoAdminRequest(path: string, options: RequestInit = {}) {
  const token = window.localStorage.getItem("dashboard_access_token");
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { "X-Dashboard-Access": token } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Operația video a eșuat.");
  return body;
}

export async function loadVideoForEdit(id: string): Promise<VideoDoc> {
  const { video } = await videoAdminRequest(`/api/admin/videos?id=${encodeURIComponent(id)}`);
  for (const key of ["createdAt", "updatedAt", "publishAt", "publicReleaseAt", "notificationAt", "notificationSentAt"]) {
    const value = video[key];
    if (value && typeof value === "object") video[key] = new Timestamp(value.seconds ?? value._seconds, value.nanoseconds ?? value._nanoseconds ?? 0);
  }
  return video;
}

async function saveVideoThroughApi(input: VideoUpdateInput, videoId?: string): Promise<string> {
  const { mutationId, editRevision, ...fields } = input;
  const result = await videoAdminRequest("/api/admin/videos", {
    method: "POST",
    body: JSON.stringify({ videoId, input: fields, mutationId: mutationId || crypto.randomUUID(), expectedRevision: editRevision }),
  });
  if (result.cacheWarning) throw new VideoCacheRefreshError();
  return result.id;
}

export async function createVideo(input: VideoCreateInput): Promise<VideoDoc> {
  const id = await saveVideoThroughApi(input);
  return { ...input, id, createdAt: null } as VideoDoc;
}

export async function updateVideo(id: string, data: VideoUpdateInput): Promise<void> {
  await saveVideoThroughApi(data, id);
}

export async function deleteVideo(id: string): Promise<void> {
  const ref = doc(db, COLLECTION_NAME, id);
  await deleteDoc(ref);
  await rebuildPublicCacheAfterMutation("delete");
}

export async function togglePublish(id: string, isPublished: boolean): Promise<void> {
  const ref = doc(db, COLLECTION_NAME, id);
  const snapshot = await getDoc(ref);
  const current: Partial<VideoDoc> = snapshot.exists()
    ? ((snapshot.data() as Partial<VideoDoc>) ?? {})
    : {};
  if (isPublished) {
    if (isFeaturedOnHomeSlotCandidate({ ...current, id, isPublished: true })) {
      await assertFeaturedOnHomeLimit(id);
    }
  }
  const notificationAt = isPublished
    ? resolveVideoNotificationAt(current)
    : current.notificationAt ?? null;
  const alreadySent = hasNotificationAlreadySent(current);
  let notificationState = VIDEO_NOTIFICATION_STATE_SENT;
  let notificationSentAt: VideoDoc["notificationSentAt"] | null =
    current.notificationSentAt ?? null;

  if (isPublished && notificationAt && !alreadySent) {
    notificationState = VIDEO_NOTIFICATION_STATE_PENDING;
    notificationSentAt = null;
  }

  await updateDoc(ref, {
    isPublished,
    notificationAt,
    notificationState,
    notificationSentAt,
    updatedAt: serverTimestamp(),
  });
  await rebuildPublicCacheAfterMutation("togglePublish");
}

export async function listVideoCategories(): Promise<VideoCategoryDoc[]> {
  const snapshot = await getDocs(categoriesCollection);
  const items = snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as Omit<VideoCategoryDoc, "id">;
    return { id: docSnap.id, ...data, slug: resolveCategorySlug(data) };
  });
  return items
    .filter((item) => typeof item.name === "string" && item.name.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveUniqueCategorySlug(name: string): Promise<string> {
  const baseSlug = slugifyText(name);
  if (!baseSlug) {
    throw new Error("Categoria nu poate genera un slug valid.");
  }

  const existing = await listVideoCategories();
  const usedSlugs = new Set(existing.map((category) => resolveCategorySlug(category)).filter(Boolean));
  if (!usedSlugs.has(baseSlug)) return baseSlug;

  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSlug}-${suffix}`;
}

export async function addVideoCategory(
  name: string,
  locales?: VideoCategoryLocales
): Promise<VideoCategoryDoc> {
  const trimmedName = name.trim();
  const slug = await resolveUniqueCategorySlug(trimmedName);
  const payload = {
    name: trimmedName,
    slug,
    locales,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(categoriesCollection, payload);
  return { id: ref.id, ...(payload as Omit<VideoCategoryDoc, "id">) } as VideoCategoryDoc;
}

export async function deleteVideoCategoryByName(name: string): Promise<void> {
  const snapshot = await getDocs(categoriesCollection);
  const target = snapshot.docs.find((docSnap) => {
    const data = docSnap.data() as { name?: string };
    return data.name?.toLowerCase() === name.toLowerCase();
  });
  if (!target) return;
  await deleteDoc(doc(db, CATEGORY_COLLECTION_NAME, target.id));
}
