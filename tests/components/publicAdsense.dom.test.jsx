/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdPlacementShell from "../../components/Ads/AdPlacementShell";
import AdsProviderScripts from "../../components/Ads/AdsProviderScripts";
import PublicPageAd from "../../components/Ads/PublicPageAd";
import { isAdsenseRouteEligible, isAdsterraEnabled } from "../../lib/ads/config";

let mockRouter = { pathname: "/", asPath: "/", locale: "ro" };
jest.mock("next/router", () => ({ useRouter: () => mockRouter }));
const originalEnv = process.env;
let root, container, callbacks, push;
const render = async (fallback = false) => act(async () => root.render(<>
  <AdsProviderScripts />
  {fallback ? <PublicPageAd /> : <><AdPlacementShell placementId="banner1" /><AdPlacementShell placementId="banner2" /></>}
</>));
const approach = async (index) => act(async () => callbacks[index]([{ isIntersecting: true }]));
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockRouter = { pathname: "/", asPath: "/", locale: "ro" };
  process.env = { ...originalEnv, NODE_ENV: "production", NEXT_PUBLIC_ENABLE_ADSENSE: "true",
    NEXT_PUBLIC_ENABLE_ADSTERRA: "true", NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID: "test-client",
    NEXT_PUBLIC_GOOGLE_ADSENSE_PUBLIC_SLOT_ID: "", NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID: "shared-slot",
    NEXT_PUBLIC_ADS_CONSENT_REQUIRED: "false" };
  callbacks = [];
  global.IntersectionObserver = jest.fn(function (callback) {
    callbacks.push(callback); this.observe = jest.fn(); this.disconnect = jest.fn();
  });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 250 });
  push = jest.fn(); window.adsbygoogle = { push };
  const append = document.head.appendChild.bind(document.head);
  jest.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node.id === "google-adsense") { node.removeAttribute("src"); node.dataset.loaded = "true"; }
    return append(node);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  document.getElementById("google-adsense")?.remove();
  delete window.adsbygoogle; delete window.Cookiebot; delete global.IntersectionObserver;
  jest.restoreAllMocks(); process.env = originalEnv;
});
it("replaces Adsterra, shares one loader, and requests each visible placement once", async () => {
  await render();
  expect(isAdsterraEnabled()).toBe(false);
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelectorAll("ins")).toHaveLength(2);
  expect(document.querySelectorAll("#google-adsense")).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
  await approach(0); expect(push).toHaveBeenCalledTimes(1);
  await render(); await approach(0); expect(push).toHaveBeenCalledTimes(1);
  await approach(1); expect(push).toHaveBeenCalledTimes(2);
});
it("waits for consent and removes the loader on withdrawal", async () => {
  process.env.NEXT_PUBLIC_ADS_CONSENT_REQUIRED = "true";
  await render(); await approach(0);
  expect(push).not.toHaveBeenCalled(); expect(document.getElementById("google-adsense")).toBeNull();
  window.Cookiebot = { consent: { marketing: true } };
  await act(async () => window.dispatchEvent(new Event("CookiebotOnAccept")));
  expect(push).toHaveBeenCalledTimes(1);
  window.Cookiebot.consent.marketing = false;
  await act(async () => window.dispatchEvent(new Event("CookiebotOnDecline")));
  expect(document.getElementById("google-adsense")).toBeNull();
});
it("remounts placements on navigation and removes ads on private routes", async () => {
  await render(); await approach(0);
  mockRouter = { ...mockRouter, pathname: "/news", asPath: "/news" };
  await render(); await approach(2); expect(push).toHaveBeenCalledTimes(2);
  mockRouter = { ...mockRouter, pathname: "/login", asPath: "/login" };
  await render(); expect(container.querySelector("ins")).toBeNull();
  expect(document.getElementById("google-adsense")).toBeNull();
});
it("adds a fallback only to public pages without existing placements", async () => {
  mockRouter = { ...mockRouter, pathname: "/courses", asPath: "/courses" };
  await render(true); expect(container.querySelectorAll("ins")).toHaveLength(1);
  mockRouter = { ...mockRouter, pathname: "/news/[slug]", asPath: "/news/story" };
  await render(true); expect(container.querySelector("ins")).toBeNull();
});
it.each(["/login", "/signup", "/settings", "/administrare/ads-orchestration", "/dashboard",
  "/abonament", "/premium", "/checkout-conferinta-grup/abc", "/courses/purchased", "/courses/abc",
  "/ebooks/mine", "/ebooks/book/read", "/meeting", "/404", "/privacypolicy"])("excludes %s", (path) => {
  expect(isAdsenseRouteEligible(path)).toBe(false);
});
it("never loads real ads in development", async () => {
  process.env.NODE_ENV = "development";
  await render(); await approach(0);
  expect(push).not.toHaveBeenCalled(); expect(document.getElementById("google-adsense")).toBeNull();
});
