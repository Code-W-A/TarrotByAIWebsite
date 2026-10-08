/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import text from "../../public/locales/ro/common.json";
let user;
jest.mock("next/router", () => ({ useRouter: () => ({ locale: "ro" }) }));
jest.mock("next-i18next", () => ({
  useTranslation: () => ({
    t: (key, args = {}) => {
      let value =
        key.split(".").reduce((obj, part) => obj?.[part], text) || key;
      for (const [name, arg] of Object.entries(args))
        value = value.replace(`{{${name}}}`, arg);
      return value;
    },
  }),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ currentUser: user }),
}));
jest.mock("../../utils/firebaseAuthHeaders", () => ({
  getFirebaseBearerHeader: async () => ({ Authorization: "Bearer test" }),
}));
import Controls from "../../components/settings/PremiumRenewalControls";
let root, container;
const initial = {
  subscriptions: [
    {
      id: "sub_one",
      stopped: false,
      status: "past_due",
      periodEnd: "2027-01-01T00:00:00.000Z",
    },
  ],
  allStopped: false,
  accessUntil: "2027-01-01T00:00:00.000Z",
};
const stopped = {
  ...initial,
  allStopped: true,
  subscriptions: initial.subscriptions.map((sub) => ({
    ...sub,
    stopped: true,
    canReactivate: true,
  })),
};
const response = (data, ok = true) => ({ ok, json: async () => data });
const button = (label) =>
  [...container.querySelectorAll("button")].find(
    (el) => el.textContent === label,
  );
const click = async (label) => act(async () => button(label).click());
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  user = { uid: "alice" };
  sessionStorage.clear();
  Object.defineProperty(global.crypto, "randomUUID", {
    configurable: true,
    value: () => "request_ui_0000000001",
  });
  global.fetch = jest.fn().mockResolvedValue(response(initial));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async () => act(async () => root.render(<Controls />));
it("shows cancellation for past_due and requires confirmation before any POST", async () => {
  await render();
  await click("Oprește reînnoirea");
  expect(fetch.mock.calls.every(([, args]) => args.method === "GET")).toBe(
    true,
  );
  expect(container.textContent).toContain("tuturor abonamentelor Premium");
  fetch.mockResolvedValueOnce(
    response({
      ok: true,
      requestId: "request_ui_0000000001",
      summary: stopped,
      emailStatus: "sent",
    }),
  );
  await click("Confirmă");
  const posted = JSON.parse(
    fetch.mock.calls.find(([, args]) => args.method === "POST")[1].body,
  );
  expect(posted).toMatchObject({ action: "cancel", confirmed: true });
  expect(container.textContent).toContain("Reînnoirea automată este oprită.");
  expect(container.textContent).toContain("1 ianuarie 2027");
});
it("does not claim success after an HTTP failure and reuses the durable ID", async () => {
  await render();
  await click("Oprește reînnoirea");
  fetch.mockResolvedValueOnce(
    response({ error: "renewal_unavailable" }, false),
  );
  await click("Confirmă");
  expect(container.textContent).toContain("Nu am putut confirma rezultatul");
  expect(container.textContent).not.toContain(
    "Reînnoirea automată este oprită.",
  );
  const first = fetch.mock.calls.find(([, args]) => args.method === "POST")[1]
    .body;
  fetch.mockResolvedValueOnce(response({ ok: true, summary: stopped }));
  await click("Confirmă");
  const posts = fetch.mock.calls.filter(([, args]) => args.method === "POST");
  expect(JSON.parse(posts[1][1].body).requestId).toBe(
    JSON.parse(first).requestId,
  );
});
it("requires selecting one subscription before reactivation", async () => {
  fetch.mockResolvedValue(response(stopped));
  await render();
  await click("Reactivează reînnoirea");
  expect(button("Confirmă").disabled).toBe(true);
  await act(async () => {
    const select = container.querySelector("select");
    select.value = "sub_one";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button("Confirmă").disabled).toBe(false);
});
it("does not show controls for a signed-out user", async () => {
  user = null;
  await render();
  expect(fetch).not.toHaveBeenCalled();
});
it("does not render a late response from the previous account", async () => {
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  user = { uid: "bob" };
  fetch.mockResolvedValue(response({ allStopped: true, subscriptions: [] }));
  await render();
  await act(async () => finish(response(initial)));
  expect(container.textContent).not.toContain(
    "Reînnoirea automată este activă.",
  );
});

it("restores the confirmed request after a reload so a lost response can be reconciled", async () => {
  sessionStorage.setItem(
    "premium-renewal-v1:alice",
    JSON.stringify({
      requestId: "recovered_request_0001",
      action: "cancel",
      subscriptionId: null,
    }),
  );
  fetch.mockResolvedValue(response(stopped));
  await render();
  expect(button("Confirmă")).toBeTruthy();
  fetch.mockResolvedValueOnce(
    response({ ok: true, summary: stopped, syncStatus: "synced" }),
  );
  await click("Confirmă");
  expect(
    JSON.parse(
      fetch.mock.calls.find(([, args]) => args.method === "POST")[1].body,
    ).requestId,
  ).toBe("recovered_request_0001");
  expect(sessionStorage.getItem("premium-renewal-v1:alice")).toBeNull();
});
