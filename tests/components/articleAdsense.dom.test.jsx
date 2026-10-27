/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ArticleAdSense from "../../components/Ads/ArticleAdSense";

import AdsProviderScripts from "../../components/Ads/AdsProviderScripts";
jest.mock("next/router", () => ({ useRouter: () => ({ pathname: "/news/[slug]" }) }));

let root, container, intersect, push, rectSpy;
const originalEnv = process.env;
const article = { info: { ro: { content: "<p>Text articol</p>" } } };
const render = async (props = {}, key = "a") => {
  await act(async () => root.render(<><AdsProviderScripts /><ArticleAdSense key={key} article={article} locale="ro" {...props} /></>));
};
const approach = async () => act(async () => intersect([{ isIntersecting: true }]));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  process.env = { ...originalEnv, NODE_ENV: "production", NEXT_PUBLIC_ENABLE_ADSENSE: "true",
    NEXT_PUBLIC_GOOGLE_ADSENSE_PUBLIC_SLOT_ID: "", NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID: "", NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID: "test-client",
    NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT_ID: "test-slot", NEXT_PUBLIC_ADS_CONSENT_REQUIRED: "false" };
  global.IntersectionObserver = jest.fn(function (callback) {
    intersect = callback;
    this.observe = jest.fn(); this.disconnect = jest.fn();
  });
  rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 250 });
  push = jest.fn(); window.adsbygoogle = { push };
  // Intercept script insertion: exercise the real loader and banner with zero network traffic.
  const append = document.head.appendChild.bind(document.head);
  jest.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node.id === "google-adsense") {
      node.removeAttribute("src");
      node.dataset.loaded = "true";
    }
    return append(node);
  });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  document.getElementById("google-adsense")?.remove();
  delete window.Cookiebot; delete window.adsbygoogle;
  delete global.IntersectionObserver;
  jest.restoreAllMocks(); process.env = originalEnv;
});

it.each([
  ["NEXT_PUBLIC_ENABLE_ADSENSE", "false"],
  ["NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID", ""],
  ["NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT_ID", ""],
])("hides unconfigured/disabled ads: %s=%s", async (name, value) => {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  await render(); expect(container.innerHTML).toBe(""); expect(push).not.toHaveBeenCalled();
});

it.each([null, { info: {} }, { info: { ro: { content: "<p>&nbsp;<br></p>" } } }])(
  "hides ads for missing article/text: %j", async (value) => {
    await render({ article: value }); expect(container.innerHTML).toBe("");
  }
);

it("reserves space, requests near viewport once, and requests anew on article navigation", async () => {
  await render();
  expect(container.querySelector("aside").style.padding).toBe("32px 0px");
  expect(container.querySelector("ins").style.height).toBe("250px");
  expect(container.textContent).toBe("Publicitate");
  expect(document.getElementById("google-adsense")).not.toBeNull();
  await approach(); expect(push).toHaveBeenCalledTimes(1);
  await render(); await approach(); expect(push).toHaveBeenCalledTimes(1);
  await render({}, "b"); expect(push).toHaveBeenCalledTimes(1);
  await approach(); expect(push).toHaveBeenCalledTimes(2);
});

it("waits for required consent and stays deduplicated after consent changes", async () => {
  process.env.NEXT_PUBLIC_ADS_CONSENT_REQUIRED = "true";
  await render(); await approach(); expect(push).not.toHaveBeenCalled();
  window.Cookiebot = { consent: { marketing: true } };
  await act(async () => window.dispatchEvent(new Event("CookiebotOnAccept")));
  expect(push).toHaveBeenCalledTimes(1);
  window.Cookiebot.consent.marketing = false;
  await act(async () => window.dispatchEvent(new Event("CookiebotOnDecline")));
  window.Cookiebot.consent.marketing = true;
  await act(async () => window.dispatchEvent(new Event("CookiebotOnAccept")));
  expect(push).toHaveBeenCalledTimes(1);
});

it("never requests live ads in development", async () => {
  process.env.NODE_ENV = "development";
  await render(); await approach(); expect(push).not.toHaveBeenCalled();
  expect(document.getElementById("google-adsense")).toBeNull();
});

it("uses the shared slot when no dedicated article slot is configured", async () => {
  process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT_ID = "";
  process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID = "shared-slot";
  await render(); await approach();
  expect(container.querySelector("ins").dataset.adSlot).toBe("shared-slot");
  expect(push).toHaveBeenCalledTimes(1);
});
