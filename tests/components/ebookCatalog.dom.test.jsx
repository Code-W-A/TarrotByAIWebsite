/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
let mockUser, mockLocale;
jest.mock("next/router", () => ({ useRouter: () => ({ locale: mockLocale, asPath: "/ebooks/mine" }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...props }) => <a href={typeof href === "string" ? href : `${href.pathname}?returnUrl=${href.query.returnUrl}`} {...props}>{children}</a> }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ currentUser: mockUser }) }));
jest.mock("../../components/Ebooks/Layout", () => ({ __esModule: true, default: ({ children }) => <main>{children}</main> }));
jest.mock("../../components/Ebooks/api", () => ({ ebookRequest: jest.fn(), ebookText: (locale, ro, en) => locale === "ro" ? ro : en }));
import Catalog from "../../components/Ebooks/Catalog";
import { ebookRequest } from "../../components/Ebooks/api";
const books = [
  { id: "astro", title: "Astrologie și autocunoaștere", description: "Jurnal al cerului", price: 3.63, currency: "RON", coverUrl: "/cover.png", availableLanguages: ["ro", "en", "es", "fr", "de", "it", "ar", "he"] },
  { id: "tarot", title: "Tarotul ca oglindă", description: "Reflecție personală", price: 10, currency: "EUR", availableLanguages: ["ro", "fr"] },
];
let root, container;
async function render(mine = false) { await act(async () => root.render(<Catalog mine={mine} />)); }
async function change(element, value, event = "input") {
  await act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set.call(element, value); element.dispatchEvent(new Event(event, { bubbles: true })); });
}
const titles = () => [...container.querySelectorAll("article h2")].map(n => n.textContent);
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks(); mockUser = null; mockLocale = "ro";
  ebookRequest.mockResolvedValue({ enabled: true, books });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("renders real prices, cover fallback, capped languages, and separate detail/buy links", async () => {
  await render();
  expect(titles()).toEqual(books.map(b => b.title));
  expect(container.textContent).toContain("3,63");
  expect(container.textContent).toContain("+2");
  expect(container.querySelectorAll("article img")).toHaveLength(1);
  expect(container.querySelector('a[href="/ebooks/astro?buy=1"]')).toBeTruthy();
  expect(container.querySelector('a[href="/ebooks/astro"]')).toBeTruthy();
  expect(container.textContent).not.toMatch(/PDF|MOBI|recenzii/);
});
it("filters locally by title/description without accents and by published language", async () => {
  await render();
  await change(container.querySelector('input[type="search"]'), "reflectie");
  expect(titles()).toEqual([books[1].title]);
  await change(container.querySelector('input[type="search"]'), "");
  await change(container.querySelector("select"), "en", "change");
  expect(titles()).toEqual([books[0].title]);
  expect(ebookRequest).toHaveBeenCalledTimes(1);
  await change(container.querySelector('input[type="search"]'), "inexistent");
  expect(container.textContent).toContain("Nicio carte găsită");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Resetează filtrele").click());
  expect(titles()).toHaveLength(2);
});
it("renders loading, then handles a request failure and successful retry", async () => {
  let reject;
  ebookRequest.mockImplementationOnce(() => new Promise((resolve, rej) => { reject = rej; }));
  await render();
  expect(container.textContent).toContain("Se încarcă biblioteca");
  await act(async () => reject(new Error("Eroare server")));
  expect(container.querySelector('[role="alert"]').textContent).toContain("Eroare server");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent.includes("Reîncearcă")).click());
  expect(titles()).toHaveLength(2);
});
it("distinguishes empty catalog and disabled feature", async () => {
  ebookRequest.mockResolvedValueOnce({ enabled: true, books: [] }); await render();
  expect(container.textContent).toContain("Pregătim primele cărți");
  mockLocale = "en"; ebookRequest.mockResolvedValueOnce({ enabled: false, books: [] }); await render();
  expect(container.textContent).toContain("Coming soon");
});
it("requires a real account for the library and offers reader links after login", async () => {
  mockUser = { uid: "anonymous", isAnonymous: true }; await render(true);
  expect(ebookRequest).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Autentifică-te");
  mockUser = { uid: "customer" }; await render(true);
  expect(ebookRequest).toHaveBeenCalledWith("/purchased?locale=ro", mockUser, { timeoutMs: 20000 });
  expect(container.querySelector('a[href="/ebooks/astro/read"]')).toBeTruthy();
  expect(container.textContent).toContain("Biblioteca mea");
});
it("ignores responses from an earlier locale and supports RTL", async () => {
  let resolveOld;
  ebookRequest.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })); await render();
  mockLocale = "ar"; ebookRequest.mockResolvedValueOnce({ enabled: true, books: [books[1]] }); await render();
  await act(async () => resolveOld({ enabled: true, books }));
  expect(titles()).toEqual([books[1].title]);
  expect(container.querySelector('section[dir="rtl"]')).toBeTruthy();
});
