import type { Timestamp } from "firebase/firestore";

export type VideoPlatform = "bunny" | "vimeo" | "youtube";
export type VideoNotificationState = "pending" | "sent";

export type VideoLocaleFields = {
  title: string;
  description?: string;
  /** Per-language playback URL when platform differs per locale (e.g. Bunny). */
  videoUrl?: string;
};

export type VideoLocales = Record<string, VideoLocaleFields>;
export type VideoChapterLocales = Record<string, { title: string }>;
export type VideoChapter = {
  startSeconds: number;
  endSeconds?: number | null;
  title?: string;
  locales?: VideoChapterLocales;
};
export type VideoCategoryLocales = Record<string, string>;
export type VideoSortField =
  | "createdAt"
  | "publishAt"
  | "title"
  | "order"
  | "platform"
  | "category"
  | "isPublished";

export type VideoSortDirection = "asc" | "desc";

export type VideoDescriptionStorage = {
  version: 1;
  root: "firebase" | "sanity";
  locales: Record<string, "firebase" | "sanity">;
  sanityId?: string | null;
};

export type VideoDoc = {
  descriptionStorage?: VideoDescriptionStorage;
  editRevision?: string;
  id: string;
  title: string;
  description?: string;
  platform: VideoPlatform;
  /** Legacy / denormalized; used when no locales.*.videoUrl exist. */
  videoUrl?: string;
  thumbnailUrl?: string;
  category?: string;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp;
  publishAt?: Timestamp | null;
  publicReleaseAt?: Timestamp | null;
  notificationAt?: Timestamp | null;
  isPublished: boolean;
  notificationState?: VideoNotificationState;
  notificationSentAt?: Timestamp | null;
  isPremium?: boolean;
  order?: number | null;
  durationSeconds?: number | null;
  chapters?: VideoChapter[];
  locales?: VideoLocales;
  featuredOnHome?: boolean;
  /** Detail opens counted by Next.js API (debounced per viewer). */
  viewsCount?: number;
};

export type VideoCategoryDoc = {
  id: string;
  name: string;
  slug?: string;
  createdAt: Timestamp;
  locales?: VideoCategoryLocales;
};

export type VideoCreateInput = {
  descriptionStorage?: VideoDescriptionStorage;
  editRevision?: string;
  mutationId?: string;
  title: string;
  description?: string;
  platform: VideoPlatform;
  /** Denormalized; derived from locales on save when possible. */
  videoUrl?: string;
  thumbnailUrl?: string;
  category?: string;
  publishAt?: Timestamp | null;
  publicReleaseAt?: Timestamp | null;
  notificationAt?: Timestamp | null;
  isPublished?: boolean;
  isPremium?: boolean;
  order?: number;
  durationSeconds?: number;
  chapters?: VideoChapter[];
  locales?: VideoLocales;
  featuredOnHome?: boolean;
};

export type VideoUpdateInput = Partial<VideoCreateInput>;

export interface Video extends VideoDoc {
  id: string;
}
