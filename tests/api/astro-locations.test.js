jest.mock("../../lib/astroLocations", () => ({
  getAstroLocationProvider: jest.fn(), searchAstroLocations: jest.fn(), resolveAstroLocation: jest.fn(), astroTimezone: jest.fn(),
}));
import handler from "../../pages/api/astro/locations";
import { getAstroLocationProvider, searchAstroLocations, resolveAstroLocation, astroTimezone } from "../../lib/astroLocations";

const response = () => ({ setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), end: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); getAstroLocationProvider.mockResolvedValue("geonames"); });
test("uses server setting and ignores client provider override for search", async () => {
  searchAstroLocations.mockResolvedValue([]);
  const res = response();
  await handler({ method: "POST", body: { action: "search", query: "Buc", provider: "google" } }, res);
  expect(searchAstroLocations).toHaveBeenCalledWith("Buc", "geonames");
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(res.status).toHaveBeenCalledWith(200);
});
test("rejects selection from a stale Google dropdown after switch", async () => {
  const res = response();
  await handler({ method: "POST", body: { action: "details", id: "abc", provider: "google" } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(resolveAstroLocation).not.toHaveBeenCalled();
});
test("timezone uses current provider and preserves local birth date/time", async () => {
  getAstroLocationProvider.mockResolvedValue("google");
  astroTimezone.mockResolvedValue({ offset: 2 });
  const res = response();
  await handler({ method: "POST", body: { action: "timezone", lat: 44, lon: 26, localDateTime: "1990-01-15 10:30:00" } }, res);
  expect(astroTimezone).toHaveBeenCalledWith(44, 26, "1990-01-15 10:30:00", "google");
});
test("bounds input and methods before accessing upstream", async () => {
  const res = response();
  await handler({ method: "POST", body: { action: "search", query: "x".repeat(161) } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(getAstroLocationProvider).not.toHaveBeenCalled();
  await handler({ method: "GET" }, res);
  expect(res.status).toHaveBeenCalledWith(405);
});
test("upstream outage is explicit, never a success with default coordinates", async () => {
  searchAstroLocations.mockRejectedValue(new Error("GeoNames nu este disponibil."));
  const res = response();
  await handler({ method: "POST", body: { action: "search", query: "Buc" } }, res);
  expect(res.status).toHaveBeenCalledWith(502);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("GeoNames") });
});
