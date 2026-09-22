import {
  collectAndSortPublishedVideos,
  mapVideoRowToPublicDto,
} from "../videoLibraryPublicMapper";

const ts = (ms) => ({ toMillis: () => ms });

describe("videoLibraryPublicMapper", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME = "cdn.example.com";
  });

  it("blocks premium playback for non-premium users but keeps public embed", () => {
    const row = {
      id: "v1",
      title: "Premium",
      description: "Premium video",
      platform: "youtube",
      videoUrl: "https://youtu.be/abc123",
      isPremium: true,
      createdAt: ts(Date.UTC(2026, 4, 3)),
    };

    const dto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
    });

    expect(dto).toEqual(
      expect.objectContaining({
        id: "v1",
        canPlay: false,
        isPremium: true,
        lockedReason: "premium_required",
        embedSrc: "https://www.youtube.com/embed/abc123",
        videoUrl: "https://youtu.be/abc123",
      })
    );
  });

  it("strips free video playback URLs for web clients (app-only)", () => {
    const row = {
      id: "v-free",
      title: "Free clip",
      platform: "youtube",
      videoUrl: "https://youtu.be/free123",
      isPremium: false,
    };

    const dto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
      webClient: true,
    });

    expect(dto).toEqual(
      expect.objectContaining({
        canPlay: false,
        isPremium: false,
        lockedReason: "app_only",
        embedSrc: null,
        videoUrl: null,
      })
    );
    expect(dto.thumbnailUrl).toBeTruthy();
  });

  it("uses localized metadata and localized video URL when available", () => {
    const dto = mapVideoRowToPublicDto(
      {
        id: "v2",
        title: "Root title",
        description: "Root description",
        platform: "bunny",
        videoUrl: "123/11111111-1111-4111-8111-111111111111",
        locales: {
          ro: {
            title: "Titlu RO",
            description: "Descriere RO",
            videoUrl: "123/22222222-2222-4222-8222-222222222222",
          },
        },
        chapters: [
          { startSeconds: 70, title: "Second" },
          { startSeconds: 10, locales: { ro: { title: "Primul" } } },
          { startSeconds: "bad", title: "Invalid" },
        ],
      },
      { locale: "ro", premiumActive: true }
    );

    expect(dto).toEqual(
      expect.objectContaining({
        title: "Titlu RO",
        description: "Descriere RO",
        platform: "bunny",
        canPlay: true,
        videoUrl: "123/22222222-2222-4222-8222-222222222222",
        embedSrc:
          "https://player.mediadelivery.net/embed/123/22222222-2222-4222-8222-222222222222",
        thumbnailUrl:
          "https://cdn.example.com/22222222-2222-4222-8222-222222222222/thumbnail.jpg",
        hlsSrc:
          "https://cdn.example.com/22222222-2222-4222-8222-222222222222/playlist.m3u8",
        chapters: [
          {
            startSeconds: 10,
            endSeconds: null,
            title: "Primul",
            locales: { ro: { title: "Primul" } },
          },
          {
            startSeconds: 70,
            endSeconds: null,
            title: "Second",
          },
        ],
        locales: {
          ro: {
            title: "Titlu RO",
            description: "Descriere RO",
            videoUrl: "123/22222222-2222-4222-8222-222222222222",
          },
        },
      })
    );
  });

  it("returns both Bunny embed and HLS when using a compatibility locale fallback", () => {
    const dto = mapVideoRowToPublicDto(
      {
        id: "legacy-ios-fallback",
        title: "Fallback",
        platform: "bunny",
        locales: {
          ro: {
            videoUrl: "123/33333333-3333-4333-8333-333333333333",
          },
        },
      },
      { locale: "en", premiumActive: true }
    );

    expect(dto).toEqual(
      expect.objectContaining({
        canPlay: true,
        lockedReason: null,
        videoUrl: "123/33333333-3333-4333-8333-333333333333",
        embedSrc:
          "https://player.mediadelivery.net/embed/123/33333333-3333-4333-8333-333333333333",
        hlsSrc:
          "https://cdn.example.com/33333333-3333-4333-8333-333333333333/playlist.m3u8",
      })
    );
  });

  it("collects only published and currently visible videos newest by publish moment first", () => {
    const now = Date.UTC(2026, 4, 20);
    const docs = [
      { id: "draft", data: () => ({ isPublished: false, createdAt: ts(now + 1) }) },
      { id: "future", data: () => ({ isPublished: true, publishAt: ts(now + 10_000), createdAt: ts(now + 2) }) },
      {
        id: "published-newer",
        data: () => ({ isPublished: true, publishAt: ts(now - 1_000), createdAt: ts(now - 10_000) }),
      },
      {
        id: "published-older",
        data: () => ({ isPublished: true, publishAt: ts(now - 5_000), createdAt: ts(now) }),
      },
      { id: "_meta", data: () => ({ isPublished: true, createdAt: ts(now + 10) }) },
    ];
    const snapshot = {
      forEach: (callback) => docs.forEach(callback),
    };

    expect(collectAndSortPublishedVideos(snapshot, now).map((row) => row.id)).toEqual([
      "published-newer",
      "published-older",
    ]);
  });

  it("turns a dual-release video public in the app but keeps it app-only on web after T2", () => {
    const now = Date.now();
    const row = {
      id: "dual-public",
      title: "Dual",
      platform: "youtube",
      videoUrl: "https://youtu.be/dual123",
      isPremium: true,
      publishAt: ts(now - 10_000),
      publicReleaseAt: ts(now - 1_000),
      createdAt: ts(Date.UTC(2026, 4, 3)),
    };

    const expoDto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
      webClient: false,
    });
    expect(expoDto).toEqual(
      expect.objectContaining({
        isPremium: false,
        canPlay: true,
        lockedReason: null,
        releasePhase: "public",
      })
    );

    const webPublicDto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
      webClient: true,
    });
    expect(webPublicDto).toEqual(
      expect.objectContaining({
        isPremium: false,
        canPlay: false,
        lockedReason: "app_only",
        embedSrc: null,
        videoUrl: null,
      })
    );

    const webPremiumDto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: true,
      webClient: true,
    });
    expect(webPremiumDto).toEqual(
      expect.objectContaining({
        isPremium: false,
        canPlay: false,
        lockedReason: "app_only",
        embedSrc: null,
        videoUrl: null,
      })
    );
  });

  it("strips Bunny playback URLs and localized sources from dual-release web responses after T2", () => {
    const now = Date.now();
    const row = {
      id: "dual-public-bunny",
      title: "Dual Bunny",
      platform: "bunny",
      videoUrl: "123/11111111-1111-4111-8111-111111111111",
      locales: {
        ro: {
          title: "Dual Bunny RO",
          videoUrl: "123/22222222-2222-4222-8222-222222222222",
        },
      },
      isPremium: true,
      publishAt: ts(now - 10_000),
      publicReleaseAt: ts(now - 1_000),
    };

    const appDto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
      webClient: false,
    });
    expect(appDto).toEqual(
      expect.objectContaining({
        canPlay: true,
        lockedReason: null,
        hlsSrc:
          "https://cdn.example.com/22222222-2222-4222-8222-222222222222/playlist.m3u8",
      })
    );

    const webDto = mapVideoRowToPublicDto(row, {
      locale: "ro",
      premiumActive: false,
      webClient: true,
    });
    expect(webDto).toEqual(
      expect.objectContaining({
        isPremium: false,
        canPlay: false,
        lockedReason: "app_only",
        videoUrl: null,
        embedSrc: null,
        hlsSrc: null,
        locales: {
          ro: {
            title: "Dual Bunny RO",
          },
        },
      })
    );
  });
});
