import handler from "../../pages/api/premium/video-library";
import { getOptionalAuth } from "../../lib/requireAuth";
import {
  loadPremiumVideoLibraryRows,
  loadPremiumVideoLibraryVideos,
  loadPremiumVideoLibraryVideosByCategory,
} from "../../lib/loadPremiumVideoLibrary";
import {
  resolvePublicVideoLibraryPremiumActive,
  resolveVideoLibraryPremiumAccessForUser,
} from "../../lib/videoLibraryAccess";

jest.mock("../../lib/requireAuth", () => ({ getOptionalAuth: jest.fn() }));
jest.mock("../../lib/loadPremiumVideoLibrary", () => ({
  loadPremiumVideoLibraryRows: jest.fn(),
  loadPremiumVideoLibraryVideos: jest.fn(),
  loadPremiumVideoLibraryVideosByCategory: jest.fn(),
  CATEGORY_VIDEOS_INITIAL_LIMIT: 4,
  CATEGORY_VIDEOS_LOAD_MORE_LIMIT: 2,
}));
jest.mock("../../lib/videoLibraryAccess", () => ({
  resolvePublicVideoLibraryPremiumActive: jest.fn(),
  resolveVideoLibraryPremiumAccessForUser: jest.fn(),
}));
jest.mock("../../lib/globalSettings", () => ({
  isSubscriptionSystemEnabled: jest.fn(async () => true),
}));
jest.mock("../../lib/premiumVideoAccessAudit", () => ({
  auditVideoLibraryResponse: jest.fn(),
  buildClientAccessDebug: jest.fn(() => ({})),
}));
jest.mock("../../lib/videoLibraryPlaybackAudit", () => ({
  auditVideoPlayback: jest.fn(),
  buildVideoRequestTelemetry: jest.fn(() => ({})),
  summarizeVideoPlaybackDtos: jest.fn(() => ({})),
}));
jest.mock("../../lib/firestoreCostLogger", () => ({
  withFirestoreReadTelemetry: (_name, fn) => fn,
}));

function makeRes() {
  const res = { headers: {}, statusCode: 200 };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe("video library list payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOptionalAuth.mockResolvedValue(null);
    resolvePublicVideoLibraryPremiumActive.mockResolvedValue(false);
    resolveVideoLibraryPremiumAccessForUser.mockResolvedValue({ premiumActive: true });
    loadPremiumVideoLibraryRows.mockResolvedValue([]);
  });

  it.each([false, true])("compacts only locale descriptions without mutating shared DTOs (category=%s)", async (category) => {
    const videos = [{
      id: "premium-video", title: "English title", description: "Full English description",
      isPremium: true, canPlay: false, lockedReason: "premium_required",
      videoUrl: "source", embedSrc: "embed", hlsSrc: "hls", category: "Septembrie",
      locales: {
        ro: { title: "Titlu", description: "Descriere completă", videoUrl: "ro-source" },
        en: { title: "English title", description: "Full English description", videoUrl: "en-source" },
      },
    }, { id: "no-locales", description: "Root only", canPlay: true }];
    const original = JSON.parse(JSON.stringify(videos));
    loadPremiumVideoLibraryVideos.mockResolvedValue(videos);
    loadPremiumVideoLibraryVideosByCategory.mockResolvedValue({
      videos, totalCount: 63, hasMore: true, nextCursor: "next-id",
    });
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: {
      locale: "en", ...(category ? { categorySlug: "septembrie", limit: "2" } : {}),
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.videos).toHaveLength(2);
    expect(res.body.videos[0]).toEqual({
      ...original[0], locales: {
        ro: { title: "Titlu", videoUrl: "ro-source" },
        en: { title: "English title", videoUrl: "en-source" },
      },
    });
    expect(res.body.videos[1]).toEqual(original[1]);
    expect(videos).toEqual(original);
    expect(res.body).toMatchObject({ locale: "en", premiumActive: false, loggedIn: false });
    if (category) expect(res.body).toMatchObject({ totalCount: 63, hasMore: true, nextCursor: "next-id" });
  });

  it("preserves authenticated Premium access and private response caching", async () => {
    getOptionalAuth.mockResolvedValue({ uid: "premium-user" });
    const videos = [{ id: "premium-video", isPremium: true, canPlay: true, lockedReason: null }];
    loadPremiumVideoLibraryVideos.mockResolvedValue(videos);
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: { locale: "ro", appPlatform: "ios" } }, res);
    expect(res.statusCode).toBe(200);
    expect(loadPremiumVideoLibraryVideos).toHaveBeenCalledWith(expect.objectContaining({ premiumActive: true, webClient: false }));
    expect(res.body).toMatchObject({ videos, premiumActive: true, loggedIn: true });
    expect(res.headers["Cache-Control"]).toBe("private, no-store, max-age=0");
  });
});
