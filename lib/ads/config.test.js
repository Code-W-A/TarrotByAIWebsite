import {
  isAdsterraRouteEligible,
  isAdsenseRouteEligible,
  getAdsterraPlacementKey,
  getAdsterraPlacementConfig,
} from "./config";

describe("ads config", () => {
  describe("isAdsterraRouteEligible", () => {
    it("allows public content and reading routes", () => {
      expect(isAdsterraRouteEligible("/")).toBe(true);
      expect(isAdsterraRouteEligible("/about")).toBe(true);
      expect(isAdsterraRouteEligible("/news")).toBe(true);
      expect(isAdsterraRouteEligible("/news/some-slug")).toBe(false);
      expect(isAdsterraRouteEligible("/citire-personalizata")).toBe(true);
      expect(isAdsterraRouteEligible("/numar-norocos")).toBe(true);
      expect(isAdsterraRouteEligible("/cartea-ta")).toBe(true);
    });

    it("blocks videouri (now uses AdSense)", () => {
      expect(isAdsterraRouteEligible("/videouri")).toBe(false);
      expect(isAdsterraRouteEligible("/videouri/abc123")).toBe(false);
    });

    it("blocks subscription and admin routes", () => {
      expect(isAdsterraRouteEligible("/abonament")).toBe(false);
      expect(isAdsterraRouteEligible("/meeting")).toBe(false);
      expect(isAdsterraRouteEligible("/settings")).toBe(false);
      expect(isAdsterraRouteEligible("/administrare/ads-orchestration")).toBe(false);
      expect(isAdsterraRouteEligible("/courses/xyz")).toBe(false);
    });
  });

  describe("isAdsenseRouteEligible", () => {
    it("matches main-dashboard and videouri", () => {
      expect(isAdsenseRouteEligible("/main-dashboard")).toBe(true);
      expect(isAdsenseRouteEligible("/main-dashboard/")).toBe(true);
      expect(isAdsenseRouteEligible("/videouri")).toBe(true);
      expect(isAdsenseRouteEligible("/videouri/")).toBe(true);
      expect(isAdsenseRouteEligible("/videouri/abc123")).toBe(true);
      expect(isAdsenseRouteEligible("/news/article-id")).toBe(true);
      expect(isAdsenseRouteEligible("/news/article-id/extra")).toBe(false);
      expect(isAdsenseRouteEligible("/news")).toBe(false);
      expect(isAdsenseRouteEligible("/")).toBe(false);
    });
  });

  describe("getAdsterraPlacementKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("resolves banner2 via article fallback chain", () => {
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2 = "";
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_ARTICLE = "article-key";
      expect(getAdsterraPlacementKey("banner2")).toBe("article-key");
      expect(getAdsterraPlacementKey("article")).toBe("article-key");
    });

    it("resolves banner3 from BANNER_3 or default", () => {
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_BANNER_3 = "banner3-key";
      expect(getAdsterraPlacementKey("banner3")).toBe("banner3-key");
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_BANNER_3 = "";
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT = "default-key";
      expect(getAdsterraPlacementKey("banner3")).toBe("default-key");
    });

    it("maps legacy video id to banner2 chain", () => {
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2 = "";
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_ARTICLE = "";
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_VIDEO = "video-key";
      expect(getAdsterraPlacementKey("video")).toBe("video-key");
    });

    it("uses iframe format when BANNER_1_FORMAT=iframe", () => {
      process.env.NEXT_PUBLIC_ADSTERRA_KEY_BANNER_1 = "hpf-key";
      process.env.NEXT_PUBLIC_ADSTERRA_BANNER_1_FORMAT = "iframe";
      process.env.NEXT_PUBLIC_ADSTERRA_BANNER_1_HOST =
        "https://www.highperformanceformat.com";
      process.env.NEXT_PUBLIC_ADSTERRA_BANNER_1_WIDTH = "300";
      process.env.NEXT_PUBLIC_ADSTERRA_BANNER_1_HEIGHT = "250";
      const cfg = getAdsterraPlacementConfig("banner1");
      expect(cfg.format).toBe("iframe");
      expect(cfg.key).toBe("hpf-key");
      expect(cfg.width).toBe(300);
      expect(cfg.height).toBe(250);
    });
  });
});
