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
  runTransaction,
  serverTimestamp,
  startAfter,
  updateDoc,
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
import { normalizeVideoChapters } from "../../../../lib/videoChapters";

const COLLECTION_NAME = "videosVideoModule";
const CATEGORY_COLLECTION_NAME = "videoCategories";
const INTERNAL_DOC_IDS = new Set(["_meta", "_publicCache"]);
const VIDEO_NOTIFICATION_STATE_PENDING = "pending";
const VIDEO_NOTIFICATION_STATE_SENT = "sent";
const MAX_FEATURED_ON_HOME = 2;
const videosCollection = collection(db, COLLECTION_NAME);
const categoriesCollection = collection(db, CATEGORY_COLLECTION_NAME);
const metaDocRef = doc(db, COLLECTION_NAME, "_meta");

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

const hasOwn = <T extends object, K extends PropertyKey>(obj: T, key: K): obj is T & Record<K, unknown> =>
  Object.prototype.hasOwnProperty.call(obj, key);

const hasNotificationAlreadySent = (video: Partial<VideoDoc>): boolean => {
  if (video.notificationState === VIDEO_NOTIFICATION_STATE_SENT) return true;
  return video.notificationSentAt != null;
};

const shouldResetNotificationStateToPending = (
  current: Partial<VideoDoc>,
  next: VideoUpdateInput,
  nextNotificationAt: unknown
): boolean => {
  const currentPublished = current.isPublished === true;
  const nextPublished = hasOwn(next, "isPublished") ? next.isPublished === true : currentPublished;
  if (!nextPublished) return false;
  if (toMillisOrNull(nextNotificationAt) == null) return false;

  const currentNotificationAtMs = toMillisOrNull(
    current.notificationAt ?? resolveVideoNotificationAt(current)
  );
  const nextNotificationAtMs = toMillisOrNull(nextNotificationAt);
  const scheduleChanged = currentNotificationAtMs !== nextNotificationAtMs;

  // Match articles: never rebroadcast if already sent unless the notify moment moved.
  if (hasNotificationAlreadySent(current) && !scheduleChanged) {
    return false;
  }

  if (nextPublished && !currentPublished) {
    return true;
  }

  if (
    !hasOwn(next, "publishAt") &&
    !hasOwn(next, "publicReleaseAt") &&
    !hasOwn(next, "notificationAt")
  ) {
    return false;
  }

  return scheduleChanged;
};

const getNextOrder = async (): Promise<number> => {
  const metaSnapshot = await getDoc(metaDocRef);
  if (metaSnapshot.exists()) {
    return await runTransaction(db, async (tx) => {
      const metaSnap = await tx.get(metaDocRef);
      const lastOrder = metaSnap.data()?.lastOrder;
      const nextOrder = typeof lastOrder === "number" ? lastOrder + 1 : 1;
      tx.set(metaDocRef, { lastOrder: nextOrder }, { merge: true });
      return nextOrder;
    });
  }

  const lastOrderQuery = query(videosCollection, orderBy("order", "desc"), limit(1));
  const lastSnap = await getDocs(lastOrderQuery);
  const lastDoc = lastSnap.docs[0];
  const lastOrder = lastDoc?.data()?.order;
  const baseOrder = typeof lastOrder === "number" ? lastOrder : 0;

  return await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaDocRef);
    if (metaSnap.exists()) {
      const existingOrder = metaSnap.data()?.lastOrder;
      const nextOrder = typeof existingOrder === "number" ? existingOrder + 1 : baseOrder + 1;
      tx.set(metaDocRef, { lastOrder: nextOrder }, { merge: true });
      return nextOrder;
    }
    const nextOrder = baseOrder + 1;
    tx.set(metaDocRef, { lastOrder: nextOrder }, { merge: true });
    return nextOrder;
  });
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

export async function createVideo(input: VideoCreateInput): Promise<VideoDoc> {
  if (isFeaturedOnHomeSlotCandidate({ ...input, isPublished: input.isPublished === true })) {
    await assertFeaturedOnHomeLimit();
  }
  const nextOrder = input.order ?? (await getNextOrder());
  const isPublished = !!input.isPublished;
  const notificationAt = resolveVideoNotificationAt(input);
  const payload = {
    ...input,
    chapters: normalizeVideoChapters(input.chapters, { locale: "ro", includeLocales: true }),
    isPublished,
    notificationAt,
    notificationState:
      isPublished && notificationAt
        ? VIDEO_NOTIFICATION_STATE_PENDING
        : VIDEO_NOTIFICATION_STATE_SENT,
    notificationSentAt: null,
    order: nextOrder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(videosCollection, payload);
  await rebuildPublicCacheAfterMutation("create");
  return { id: ref.id, ...(payload as Omit<VideoDoc, "id">) } as VideoDoc;
}

export async function updateVideo(id: string, data: VideoUpdateInput): Promise<void> {
  const ref = doc(db, COLLECTION_NAME, id);
  const snapshot = await getDoc(ref);
  const current = snapshot.exists() ? ((snapshot.data() as Partial<VideoDoc>) ?? {}) : {};
  const nextVideo = {
    ...current,
    ...data,
    id,
    isPublished: hasOwn(data, "isPublished") ? data.isPublished === true : current.isPublished === true,
    featuredOnHome: hasOwn(data, "featuredOnHome")
      ? data.featuredOnHome === true
      : current.featuredOnHome === true,
  };
  const notificationAt = resolveVideoNotificationAt(nextVideo);
  if (isFeaturedOnHomeSlotCandidate(nextVideo)) {
    await assertFeaturedOnHomeLimit(id);
  }
  const updatePayload: Record<string, unknown> = {
    ...data,
    ...(hasOwn(data, "chapters")
      ? { chapters: normalizeVideoChapters(data.chapters, { locale: "ro", includeLocales: true }) }
      : {}),
    notificationAt,
    updatedAt: serverTimestamp(),
  };
  if (nextVideo.isPublished === true && toMillisOrNull(notificationAt) == null) {
    updatePayload.notificationState = VIDEO_NOTIFICATION_STATE_SENT;
  } else if (shouldResetNotificationStateToPending(current, data, notificationAt)) {
    updatePayload.notificationState = VIDEO_NOTIFICATION_STATE_PENDING;
    updatePayload.notificationSentAt = null;
  } else if (hasOwn(data, "isPublished") && data.isPublished === false) {
    // Keep notificationSentAt so republish does not rebroadcast.
    updatePayload.notificationState = VIDEO_NOTIFICATION_STATE_SENT;
  }
  await updateDoc(ref, updatePayload);
  await rebuildPublicCacheAfterMutation("update");
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
