import {
  hasAnyLocalizedVideoUrl,
  resolveLibraryEmbedSrc,
} from "../../../../lib/videoLibraryPublic";
import { validateVideoChapters } from "../../../../lib/videoChapters";
import {
  VIDEO_ACCESS_MODE_DUAL,
  VIDEO_RELEASE_TIMEZONE,
} from "../../../../lib/videoReleaseSchedule";
import type { VideoCreateInput } from "../types/video";

export const RO_VIDEO_URL_REQUIRED_MESSAGE =
  "Linkul video RO este obligatoriu — fără el videoclipul nu apare în app și pe site.";

export type VideoValidationErrors = {
  description?: string;
  localeDescriptions?: Partial<Record<string, string>>;
  title?: string;
  platform?: string;
  localizedVideo?: string;
  localeVideos?: Partial<Record<string, string>>;
  thumbnailUrl?: string;
  isPublished?: string;
  publicReleaseAt?: string;
  chapters?: string;
};

const toMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
};

function embedHintForPlatform(platform: string | undefined): string {
  if (platform === "bunny") {
    return "Introdu link play/embed Bunny (player.mediadelivery.net), bibliotecă/id-video sau UUID video dacă NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID e setat în mediu.";
  }
  return "Link invalid pentru platforma aleasă.";
}

export function validateVideoPublicReleaseDraft(input: {
  accessMode: string;
  dateInput: string;
  timeInput: string;
  publicReleaseAt: unknown;
}): string | undefined {
  if (input.accessMode !== VIDEO_ACCESS_MODE_DUAL) return undefined;
  if (!input.dateInput.trim()) return "Alege data publicării generale.";
  if (!input.timeInput.trim()) return "Alege ora publicării generale.";
  if (!input.publicReleaseAt) {
    return `Data sau ora publicării generale nu este validă în fusul ${VIDEO_RELEASE_TIMEZONE}.`;
  }
  return undefined;
}

/** Mirrors `resolveRowVideoSource(row, "ro")` used by the public video library API. */
export function resolveRoVideoUrlForValidation(input: VideoCreateInput): string {
  const root = typeof input.videoUrl === "string" ? input.videoUrl.trim() : "";
  if (!hasAnyLocalizedVideoUrl(input)) {
    return root;
  }
  const roBlob = input.locales?.ro;
  return typeof roBlob?.videoUrl === "string" ? roBlob.videoUrl.trim() : "";
}

export function validateVideoInput(input: VideoCreateInput): VideoValidationErrors {
  const errors: VideoValidationErrors = {};
  const platform =
    input.platform === "bunny" || input.platform === "vimeo" || input.platform === "youtube"
      ? input.platform
      : "youtube";

  if (!input.title || !input.title.trim()) {
    errors.title = "Titlul este obligatoriu";
  }
  if (!input.platform) {
    errors.platform = "Platforma este obligatorie";
  }

  if (input.publishAt && input.isPublished !== true) {
    errors.isPublished =
      "Pentru publicare programată, activează \"Publicat în aplicație\"; altfel videoclipul rămâne ascuns.";
  }

  if (input.publicReleaseAt) {
    const publishAtMs = toMillis(input.publishAt);
    const publicReleaseAtMs = toMillis(input.publicReleaseAt);
    if (input.isPublished !== true) {
      errors.publicReleaseAt =
        "Pentru acces Premium anticipat, activează „Publicat în aplicație”.";
    } else if (input.isPremium !== true) {
      errors.publicReleaseAt =
        "Accesul Premium anticipat necesită modul „Premium apoi public”.";
    } else if (
      publishAtMs == null ||
      publicReleaseAtMs == null ||
      publicReleaseAtMs <= publishAtMs
    ) {
      errors.publicReleaseAt =
        "Momentul publicării generale trebuie să fie după începutul accesului Premium.";
    }
  }

  const localeVideos: Partial<Record<string, string>> = {};
  const roUrl = resolveRoVideoUrlForValidation(input);
  if (!roUrl) {
    localeVideos.ro = RO_VIDEO_URL_REQUIRED_MESSAGE;
    errors.localizedVideo = RO_VIDEO_URL_REQUIRED_MESSAGE;
  } else {
    const roEmbed = resolveLibraryEmbedSrc(platform, roUrl);
    if (!roEmbed) {
      localeVideos.ro = embedHintForPlatform(platform);
      errors.localizedVideo =
        platform === "bunny"
          ? "Linkul Bunny pentru RO este invalid. Verifică câmpul marcat mai jos."
          : "Linkul video pentru RO este invalid. Verifică câmpul marcat mai jos.";
    }
  }

  const pairs: Array<{ lc: string; url: string }> = [];
  if (input.locales && typeof input.locales === "object") {
    for (const [lc, blob] of Object.entries(input.locales)) {
      const u = typeof blob?.videoUrl === "string" ? blob.videoUrl.trim() : "";
      if (u) pairs.push({ lc, url: u });
    }
  }

  if (pairs.length === 0 && !roUrl) {
    if (!errors.localizedVideo) {
      errors.localizedVideo = "Completează cel puțin un link video pentru o limbă a site‑ului.";
    }
  } else {
    for (const { lc, url } of pairs) {
      if (lc === "ro" && localeVideos.ro) continue;
      const embed = resolveLibraryEmbedSrc(platform, url);
      if (!embed) {
        localeVideos[lc] = embedHintForPlatform(platform);
      }
    }
    if (Object.keys(localeVideos).length > 0) {
      if (!errors.localizedVideo) {
        errors.localizedVideo =
          platform === "bunny"
            ? "Un sau mai multe linkuri Bunny sunt invalide. Verifică câmpurile marcate mai jos."
            : "Un sau mai multe linkuri video sunt invalide. Verifică câmpurile marcate mai jos.";
      }
    }
  }

  if (Object.keys(localeVideos).length > 0) {
    errors.localeVideos = localeVideos;
  }

  const chapterError = validateVideoChapters(input.chapters);
  if (chapterError) {
    errors.chapters = chapterError;
  }

  const bunnyThumb =
    platform === "bunny" && typeof input.thumbnailUrl === "string"
      ? input.thumbnailUrl.trim()
      : "";
  if (bunnyThumb) {
    try {
      const u = new URL(bunnyThumb);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        errors.thumbnailUrl = "Thumbnail-ul trebuie să fie un URL http(s) valid.";
      }
    } catch {
      errors.thumbnailUrl = "Thumbnail-ul nu este un URL valid.";
    }
  }

  return errors;
}
