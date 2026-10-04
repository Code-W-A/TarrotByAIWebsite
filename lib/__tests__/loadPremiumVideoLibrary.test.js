const ts = (ms) => ({ toMillis: () => ms });

const makeDocSnap = (id, data, exists = true) => ({
  id,
  exists,
  data: () => data,
});

const makeQuerySnap = (docs) => ({
  docs, size: docs.length, empty: docs.length === 0,
  forEach: (callback) => docs.forEach(callback),
});

const buildDb = ({ manifest, chunks = {}, rows = [], docRows = {} } = {}) => {
  const setCalls = [];
  const readCalls = [];
  const docsById = new Map();
  rows.forEach((row) => docsById.set(row.id, row));
  Object.entries(docRows).forEach(([id, data]) => docsById.set(id, { id, ...data }));

  const runQuery = (filters, limit = null) => {
    let results = [...docsById.values()];
    for (const [field, op, value] of filters) {
      if (op !== "==") continue;
      results = results.filter((row) => row?.[field] === value);
    }
    if (typeof limit === "number" && limit > 0) {
      results = results.slice(0, limit);
    }
    return makeQuerySnap(results.map((row) => makeDocSnap(row.id, row)));
  };

  // Model aggregate reads, immutable generation writes and transactions.
  const cachedRows = Object.values(chunks).flatMap(chunk => chunk.rows || []);
  if (!rows.length && manifest) cachedRows.forEach(row => docsById.set(row.id, row));
  const signature = () => JSON.stringify([ [...docsById.values()].filter(row => row.isPublished === true).length,
    [...docsById.values()][0]?.id || null, 0, 0 ]);
  if (manifest && manifest.sourceSignature === undefined) manifest.sourceSignature = signature();
  const cacheDocs = new Map(Object.entries(chunks));
  const makeWhereChain = (filters = [], limit = null) => ({
    where: jest.fn((field, op, value) => makeWhereChain([...filters, [field, op, value]], limit)),
    orderBy: jest.fn(() => makeWhereChain(filters, limit)),
    select: jest.fn(() => makeWhereChain(filters, limit)),
    limit: jest.fn(value => makeWhereChain(filters, value)),
    count: jest.fn(() => ({ get: async () => ({ data: () => ({ count: runQuery(filters).size }) }) })),
    get: jest.fn(async () => runQuery(filters, limit)),
  });
  const db = {
    setCalls, readCalls,
    runTransaction: async callback => callback({ get: ref => ref.get(), set: (ref, payload) => ref.set(payload) }),
    collection: jest.fn(name => ({
      ...makeWhereChain(),
      doc: jest.fn(id => ({
        get: jest.fn(async () => {
          readCalls.push({ name, id });
          const data = name === "internalCaches" ? (id === "videoLibraryPublic" ? manifest : cacheDocs.get(id)) : docsById.get(id);
          return makeDocSnap(id, data, !!data);
        }),
        set: jest.fn(async payload => {
          setCalls.push({ name, id, payload });
          if (id === "videoLibraryPublic") manifest = payload;
          else cacheDocs.set(id, payload);
        }),
      })),
    })),
  };
  return db;
};

const loadWithDb = async (db) => {
  jest.resetModules();
  jest.doMock("../firebaseAdmin", () => ({
    getAdminDb: () => db,
  }));
  return import("../loadPremiumVideoLibrary");
};

describe("loadPremiumVideoLibrary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VIDEO_LIBRARY_CACHE_TTL_MS = "1";
  });

  it("keeps all chunks searchable by category and reuses rows until the manifest changes", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 27));
    const previousCap = process.env.VIDEO_LIBRARY_MAX_CHUNKS_TO_LOAD;
    // An old deployment setting must not silently truncate the catalog again.
    process.env.VIDEO_LIBRARY_MAX_CHUNKS_TO_LOAD = "4";
    try {
      const chunkDocIds = Array.from({ length: 7 }, (_, i) => `videoLibraryPublic__chunk_${i}`);
      const chunks = Object.fromEntries(chunkDocIds.map((id, i) => [id, {
        version: 2,
        rows: [{
          id: `video-${i}`,
          title: `Video ${i}`,
          category: i < 4 ? "Septembrie" : "Zilnic",
          platform: "youtube",
          videoUrl: "https://youtu.be/abc123",
          isPublished: true,
          isPremium: true,
          createdAt: ts(Date.UTC(2026, 8, 20 - i)),
        }],
      }]));
      const manifest = {
        version: 2, rowCount: 7, chunkCount: 7, chunkDocIds,
        featuredVideoIds: [], updatedAt: ts(1000),
      };
      const db = buildDb({ manifest, chunks });
      const { loadPremiumVideoLibraryVideos, loadPremiumVideoLibraryVideosByCategory } = await loadWithDb(db);
      const videos = await loadPremiumVideoLibraryVideos({ locale: "ro", premiumActive: false });
      expect(videos.map((v) => v.id)).toEqual(Array.from({ length: 7 }, (_, i) => `video-${i}`));
      expect(videos.every((v) => v.canPlay === false && v.lockedReason === "premium_required")).toBe(true);
      expect(db.readCalls).toHaveLength(8); // One manifest + all seven chunks.

      const page = await loadPremiumVideoLibraryVideosByCategory({
        locale: "ro", premiumActive: true, categorySlug: "zilnic", limit: 2,
      });
      expect(page.videos.map((v) => v.id)).toEqual(["video-4", "video-5"]);
      expect(page.videos.every((v) => v.canPlay)).toBe(true);
      expect(page).toMatchObject({ totalCount: 3, hasMore: true, nextCursor: "video-5" });
      const lastPage = await loadPremiumVideoLibraryVideosByCategory({
        locale: "ro", premiumActive: true, categorySlug: "zilnic", limit: 2, cursor: page.nextCursor,
      });
      expect(lastPage.videos.map((v) => v.id)).toEqual(["video-6"]);
      expect(lastPage).toMatchObject({ totalCount: 3, hasMore: false, nextCursor: null });
      expect(db.readCalls).toHaveLength(8); // Pagination reuses memory.

      clock.mockReturnValue(Date.UTC(2026, 8, 28));
      await loadPremiumVideoLibraryVideos({ locale: "ro", premiumActive: false });
      expect(db.readCalls).toHaveLength(9); // Unchanged manifest: no chunk re-reads.

      manifest.updatedAt = ts(2000);
      chunks[chunkDocIds[6]].rows[0].title = "Updated older video";
      clock.mockReturnValue(Date.UTC(2026, 8, 29));
      const refreshed = await loadPremiumVideoLibraryVideos({ locale: "ro", premiumActive: false });
      expect(refreshed.find((v) => v.id === "video-6").title).toBe("Updated older video");
      expect(db.readCalls).toHaveLength(17);
      expect(db.setCalls).toHaveLength(0);
    } finally {
      clock.mockRestore();
      if (previousCap === undefined) delete process.env.VIDEO_LIBRARY_MAX_CHUNKS_TO_LOAD;
      else process.env.VIDEO_LIBRARY_MAX_CHUNKS_TO_LOAD = previousCap;
    }
  });

  it("reads materialized manifest and chunks when valid", async () => {
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 1,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: [],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            {
              id: "v1",
              title: "Cached",
              platform: "youtube",
              videoUrl: "https://youtu.be/abc123",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 3)),
            },
          ],
        },
      },
    });
    const { loadPremiumVideoLibraryVideos } = await loadWithDb(db);

    const videos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: true,
    });

    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual(expect.objectContaining({ id: "v1", title: "Cached" }));
    expect(db.setCalls).toHaveLength(0);
  });

  it("rebuilds materialized cache when manifest is missing", async () => {
    const db = buildDb({
      rows: [
        {
          id: "v2",
          title: "Fresh",
          platform: "youtube",
          videoUrl: "https://youtu.be/fresh1",
          isPublished: true,
          createdAt: ts(Date.UTC(2026, 4, 4)),
        },
      ],
    });
    const { loadPremiumVideoLibraryVideos } = await loadWithDb(db);

    const videos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: true,
    });

    expect(videos.map((video) => video.id)).toEqual(["v2"]);
    expect(db.setCalls.map((call) => call.id)).toContain("videoLibraryPublic");
    expect(db.setCalls.some(call => /^videoLibraryPublic__generation_.*_0$/.test(call.id))).toBe(true);
    expect(
      db.setCalls.find((call) => call.id === "videoLibraryPublic")?.payload
    ).toEqual(expect.objectContaining({ version: 2, featuredVideoIds: [] }));
  });

  it("filters future publish dates and premium spotlight rows", async () => {
    const now = Date.UTC(2026, 4, 20);
    jest.spyOn(Date, "now").mockReturnValue(now);
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 3,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: [],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            {
              id: "free",
              title: "Free",
              platform: "youtube",
              videoUrl: "https://youtu.be/free1",
              isPublished: true,
              isPremium: false,
              createdAt: ts(now),
            },
            {
              id: "premium-new",
              title: "Premium New",
              platform: "youtube",
              videoUrl: "https://youtu.be/premium1",
              isPublished: true,
              isPremium: true,
              createdAt: ts(Date.UTC(2026, 4, 3)),
            },
            {
              id: "future",
              title: "Future",
              platform: "youtube",
              videoUrl: "https://youtu.be/future1",
              isPublished: true,
              isPremium: true,
              publishAt: ts(now + 10_000),
              createdAt: ts(now + 5),
            },
          ],
        },
      },
    });
    const { loadPremiumVideoLibraryVideos } = await loadWithDb(db);

    const videos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: false,
      premiumSpotlightOnly: true,
    });

    expect(videos.map((video) => video.id)).toEqual(["premium-new"]);
    expect(videos[0]).toEqual(
      expect.objectContaining({
        canPlay: false,
        lockedReason: "premium_required",
      })
    );
    (Date.now).mockRestore();
  });

  it("shows dual-release early access only to premium viewers", async () => {
    const now = Date.UTC(2026, 5, 10, 12);
    jest.spyOn(Date, "now").mockReturnValue(now);
    const dualRow = {
      id: "dual",
      title: "Dual",
      platform: "youtube",
      videoUrl: "https://youtu.be/dual1",
      isPublished: true,
      isPremium: true,
      publishAt: ts(now - 1_000),
      publicReleaseAt: ts(now + 10_000),
      createdAt: ts(now - 20_000),
    };
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 1,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: [],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [dualRow],
        },
      },
    });
    const { loadPremiumVideoLibraryVideos } = await loadWithDb(db);

    const publicVideos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: false,
    });
    const premiumVideos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: true,
    });

    expect(publicVideos).toEqual([]);
    expect(premiumVideos).toHaveLength(1);
    expect(premiumVideos[0]).toEqual(
      expect.objectContaining({
        id: "dual",
        isPremium: true,
        canPlay: true,
        releasePhase: "premium_early_access",
      })
    );
    (Date.now).mockRestore();
  });

  it("loads a single published video row by id without reading internalCaches", async () => {
    const db = buildDb({
      docRows: {
        v1: {
          title: "Direct",
          platform: "youtube",
          videoUrl: "https://youtu.be/direct1",
          isPublished: true,
          category: "Tarot",
          createdAt: ts(Date.UTC(2026, 4, 3)),
        },
      },
    });
    const { loadPremiumVideoLibraryRowById } = await loadWithDb(db);

    const row = await loadPremiumVideoLibraryRowById("v1");
    expect(row).toEqual(
      expect.objectContaining({
        id: "v1",
        title: "Direct",
        isPublished: true,
      })
    );
    expect(db.collection).toHaveBeenCalledWith("videosVideoModule");
  });

  it("loads related videos by category without reading the full materialized cache", async () => {
    const db = buildDb({
      docRows: {
        main: {
          title: "Main",
          platform: "youtube",
          videoUrl: "https://youtu.be/main1",
          isPublished: true,
          category: "Tarot",
          createdAt: ts(Date.UTC(2026, 4, 3)),
        },
        related: {
          title: "Related",
          platform: "youtube",
          videoUrl: "https://youtu.be/related1",
          isPublished: true,
          category: "Tarot",
          createdAt: ts(Date.UTC(2026, 4, 2)),
        },
        other: {
          title: "Other",
          platform: "youtube",
          videoUrl: "https://youtu.be/other1",
          isPublished: true,
          category: "Noroc",
          createdAt: ts(Date.UTC(2026, 4, 1)),
        },
      },
    });
    const { loadPremiumVideoRelatedRows } = await loadWithDb(db);

    const related = await loadPremiumVideoRelatedRows({
      category: "Tarot",
      excludeId: "main",
      locale: "ro",
      limit: 12,
    });

    expect(related.map((row) => row.id)).toEqual(["related"]);
  });

  it("returns featured rows capped at 2", async () => {
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 3,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: ["f1", "f2", "f3"],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            {
              id: "f1",
              featuredOnHome: true,
              title: "Featured 1",
              platform: "youtube",
              videoUrl: "https://youtu.be/f1",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 5)),
            },
            {
              id: "f2",
              featuredOnHome: true,
              title: "Featured 2",
              platform: "youtube",
              videoUrl: "https://youtu.be/f2",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 4)),
            },
            {
              id: "f3",
              featuredOnHome: true,
              title: "Featured 3",
              platform: "youtube",
              videoUrl: "https://youtu.be/f3",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 3)),
            },
          ],
        },
      },
    });
    const { loadFeaturedHomeVideos } = await loadWithDb(db);

    const featured = await loadFeaturedHomeVideos({
      locale: "ro",
      premiumActive: true,
      limit: 2,
    });

    expect(featured).toHaveLength(2);
    expect(featured.every((video) => video.featuredOnHome === true)).toBe(true);
  });

  it("loads an older featured video from the complete catalog", async () => {
    const featuredRow = {
      id: "old-featured",
      featuredOnHome: true,
      title: "Older featured video",
      platform: "youtube",
      videoUrl: "https://youtu.be/oldfeatured1",
      isPublished: true,
      isPremium: true,
      createdAt: ts(Date.UTC(2026, 4, 1)),
    };
    const chunkDocIds = Array.from(
      { length: 5 },
      (_, index) => `videoLibraryPublic__chunk_${index}`
    );
    const chunks = Object.fromEntries(
      chunkDocIds.map((chunkId, index) => [
        chunkId,
        {
          version: 2,
          rows: index === 4
            ? [featuredRow]
            : [{
                id: `recent-${index}`,
                title: `Recent ${index}`,
                platform: "youtube",
                videoUrl: `https://youtu.be/recent${index}`,
                isPublished: true,
                createdAt: ts(Date.UTC(2026, 4, 10 - index)),
              }],
        },
      ])
    );
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 5,
        chunkCount: 5,
        chunkDocIds,
        featuredVideoIds: [featuredRow.id],
      },
      chunks,
      docRows: {
        [featuredRow.id]: featuredRow,
      },
    });
    const { loadFeaturedHomeVideos } = await loadWithDb(db);

    const featured = await loadFeaturedHomeVideos({
      locale: "ro",
      premiumActive: true,
      limit: 2,
    });

    expect(featured.map((video) => video.id)).toEqual(["old-featured"]);
  });

  it("excludes featured ids from preview list", async () => {
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 2,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: ["featured"],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            {
              id: "featured",
              featuredOnHome: true,
              title: "Featured",
              platform: "youtube",
              videoUrl: "https://youtu.be/featured",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 5)),
            },
            {
              id: "recent",
              title: "Recent",
              platform: "youtube",
              videoUrl: "https://youtu.be/recent",
              isPublished: true,
              createdAt: ts(Date.UTC(2026, 4, 4)),
            },
          ],
        },
      },
    });
    const { loadPremiumVideoLibraryVideos } = await loadWithDb(db);

    const videos = await loadPremiumVideoLibraryVideos({
      locale: "ro",
      premiumActive: true,
      previewLimit: 6,
      excludeIds: ["featured"],
    });

    expect(videos.map((video) => video.id)).toEqual(["recent"]);
  });

  it("paginates category videos with initial limit 4 and load-more limit 2", async () => {
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 6,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: [],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            "v6",
            "v5",
            "v4",
            "v3",
            "v2",
            "v1",
          ].map((id, index) => ({
            id,
            title: `Tarot ${id}`,
            platform: "youtube",
            videoUrl: `https://youtu.be/${id}`,
            isPublished: true,
            category: "Tarot",
            createdAt: ts(Date.UTC(2026, 4, 6 - index)),
          })),
        },
      },
    });
    const { loadPremiumVideoLibraryVideosByCategory } = await loadWithDb(db);

    const firstPage = await loadPremiumVideoLibraryVideosByCategory({
      locale: "ro",
      premiumActive: true,
      categorySlug: "tarot",
      limit: 4,
    });

    expect(firstPage.totalCount).toBe(6);
    expect(firstPage.videos).toHaveLength(4);
    expect(firstPage.videos.map((video) => video.id)).toEqual(["v6", "v5", "v4", "v3"]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBe("v3");

    const secondPage = await loadPremiumVideoLibraryVideosByCategory({
      locale: "ro",
      premiumActive: true,
      categorySlug: "tarot",
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(secondPage.videos).toHaveLength(2);
    expect(secondPage.videos.map((video) => video.id)).toEqual(["v2", "v1"]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("returns empty category page when slug does not match", async () => {
    const db = buildDb({
      manifest: {
        version: 2,
        rowCount: 1,
        chunkCount: 1,
        chunkDocIds: ["videoLibraryPublic__chunk_0"],
        featuredVideoIds: [],
      },
      chunks: {
        videoLibraryPublic__chunk_0: {
          version: 2,
          rows: [
            {
              id: "v1",
              title: "Tarot",
              platform: "youtube",
              videoUrl: "https://youtu.be/v1",
              isPublished: true,
              category: "Tarot",
              createdAt: ts(Date.UTC(2026, 4, 1)),
            },
          ],
        },
      },
    });
    const { loadPremiumVideoLibraryVideosByCategory } = await loadWithDb(db);

    const page = await loadPremiumVideoLibraryVideosByCategory({
      locale: "ro",
      premiumActive: true,
      categorySlug: "missing-category",
      limit: 4,
    });

    expect(page.videos).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
