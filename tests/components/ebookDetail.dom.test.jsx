/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
let mockUser;
const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({
    query: { ebookId: "book" },
    asPath: "/ebooks/book",
    locale: "ro",
    push: mockPush,
  }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }) => (
    <a href={typeof href === "string" ? href : href.pathname} {...props}>
      {children}
    </a>
  ),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ currentUser: mockUser }),
}));
jest.mock("next-i18next/serverSideTranslations", () => ({
  serverSideTranslations: jest.fn(),
}));
jest.mock("../../components/BillingDetailsForm", () => () => (
  <div>Formular facturare</div>
));
jest.mock("../../components/Ebooks/api", () => ({
  ebookRequest: jest.fn(),
  ebookText: (_l, ro) => ro,
}));
import Detail from "../../pages/ebooks/[ebookId]/index";
import { ebookRequest } from "../../components/Ebooks/api";
const book = {
  id: "book",
  title: "Cartea mea",
  description: "Descriere",
  price: 20,
  currency: "RON",
  chapters: [{ _key: "one", title: "Primul capitol" }],
};
let root, container;
async function render() {
  await act(async () => root.render(<Detail />));
}
function button(label) {
  return [...container.querySelectorAll("button")].find(
    (el) => el.textContent === label,
  );
}
async function code(value = "example") {
  const input = container.querySelector("#ebook-promo");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  mockUser = { uid: "alice" };
  ebookRequest.mockImplementation(async (path) =>
    path === "/config"
      ? { enabled: true, websiteBilling: true, promoEnabled: true }
      : path.includes("redeem")
        ? { owned: true }
        : book,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("shows compact book layout, TOC and billing only after buying", async () => {
  await render();
  expect(container.textContent).toContain("01Primul capitol");
  expect(container.textContent).not.toContain("Formular facturare");
  await act(async () => button("Cumpără ebookul").click());
  expect(container.textContent).toContain("Formular facturare");
  expect(container.querySelector('a[href="/ebooks/mine"]')).toBeTruthy();
});
it("activates only on server confirmation and replaces promo with reader link", async () => {
  await render();
  await code();
  await submit();
  expect(ebookRequest).toHaveBeenCalledWith(
    "/book/redeem?locale=ro",
    mockUser,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: "example" }),
    }),
  );
  expect(container.textContent).toContain("Acces activat");
  expect(container.querySelector('a[href="/ebooks/book/read"]')).toBeTruthy();
  expect(container.querySelector("form")).toBeNull();
});
it("keeps access locked on server errors or missing confirmation", async () => {
  await render();
  ebookRequest.mockRejectedValueOnce(new Error("Cod invalid"));
  await code();
  await submit();
  expect(container.textContent).toContain("Cod invalid");
  expect(container.querySelector('a[href$="/read"]')).toBeNull();
  ebookRequest.mockResolvedValueOnce({ owned: false });
  await submit();
  expect(container.textContent).toContain("Accesul nu a fost confirmat");
});
it.each([null, { uid: "anon", isAnonymous: true }])(
  "requires real login and return URL",
  async (user) => {
    mockUser = user;
    await render();
    expect(container.querySelector("#ebook-promo")).toBeNull();
    await act(async () =>
      button("Autentifică-te pentru a introduce codul").click(),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/login/videoteca",
      query: { returnUrl: "/ebooks/book" },
    });
  },
);
it("blocks repeated submission and ignores a previous account's late grant", async () => {
  await render();
  let resolve;
  ebookRequest.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await code();
  await submit();
  await submit();
  expect(
    ebookRequest.mock.calls.filter(([p]) => p.includes("redeem")),
  ).toHaveLength(1);
  mockUser = { uid: "bob" };
  await render();
  await act(async () => resolve({ owned: true }));
  expect(container.querySelector('a[href$="/read"]')).toBeNull();
  expect(container.textContent).not.toContain("Acces activat");
});
it("hides promo when disabled and shows existing owned book", async () => {
  ebookRequest.mockImplementation(async (path) =>
    path === "/config"
      ? { enabled: true, websiteBilling: true, promoEnabled: false }
      : { ...book, owned: true },
  );
  await render();
  expect(container.querySelector('a[href$="/read"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Ai un cod");
});
it("ignores an ownership response started before the promo grant", async () => {
  await render(); let resolve;
  ebookRequest.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => window.dispatchEvent(new Event("focus")));
  await code(); await submit(); await act(async () => resolve({ ...book, owned: false }));
  expect(container.querySelector('a[href$="/read"]')).toBeTruthy();
});
