jest.mock("../firebaseAdmin", () => ({ getAdminDb: jest.fn() }));
import { getAdminDb } from "../firebaseAdmin";
import { astroTimezone, birthOffset, getAstroLocationProvider, normalizeProvider, searchAstroLocations, resolveAstroLocation, validCoordinates } from "../astroLocations";

describe("astro location providers", () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  const reply = (data) => global.fetch.mockResolvedValueOnce({ ok: true, json: async () => data });
  test("missing setting defaults to GeoNames and switch is refreshed per request", async () => {
    let provider;
    getAdminDb.mockReturnValue({ collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ astroLocationProvider: provider }) }) }) }) });
    expect(await getAstroLocationProvider()).toBe("geonames");
    provider = "google";
    expect(await getAstroLocationProvider()).toBe("google");
    expect(normalizeProvider("invalid")).toBe("geonames");
  });
  test("normalizes GeoNames coordinates and deduplicates region labels", async () => {
    reply({ geonames: [{ geonameId: 683506, name: "București", adminName1: "București", countryName: "România", lat: "44.43225", lng: "26.10626" }] });
    expect(await searchAstroLocations("Bucur", "geonames")).toEqual([{ id: "683506", label: "București, România", lat: 44.43225, lon: 26.10626, provider: "geonames" }]);
    expect(global.fetch.mock.calls[0][0]).toContain("name_startsWith=Bucur");
  });
  test("Google autocomplete + details produce the same numeric location contract", async () => {
    reply({ suggestions: [{ placePrediction: { placeId: "abc", text: { text: "București" } } }] });
    reply({ formattedAddress: "București", location: { latitude: 44.43, longitude: 26.1 } });
    const [suggestion] = await searchAstroLocations("Bucur", "google");
    expect(await resolveAstroLocation(suggestion.id, "google")).toEqual({ id: "abc", label: "București", lat: 44.43, lon: 26.1, provider: "google" });
    expect(global.fetch.mock.calls[0][0]).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(global.fetch.mock.calls[1][1].headers["X-Goog-FieldMask"]).toBe("location,formattedAddress");
  });
  test("API status errors do not silently use Google or UTC", async () => {
    reply({ status: { value: 10, message: "account disabled" } });
    await expect(searchAstroLocations("Bucur", "geonames")).rejects.toThrow("activat");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  test.each([["", 0, false], [0, 0, true], [91, 0, false], [1, -181, false], [null, 2, false]])("validates coordinates %s/%s", (lat, lon, expected) => {
    expect(validCoordinates(lat, lon)).toBe(expected);
  });
  test.each([
    ["Europe/Bucharest", "1990-01-15 10:30:00", 2],
    ["Europe/Bucharest", "1990-07-15 10:30:00", 3],
    ["Europe/Bucharest", "1970-07-15 10:30:00", 2],
    ["America/New_York", "1990-01-15 10:30:00", -5],
    ["America/New_York", "1990-07-15 10:30:00", -4],
    ["Asia/Kathmandu", "1990-07-15 10:30:00", 5.75],
    ["Europe/London", "1990-01-15 10:30:00", 0],
  ])("historical offset for %s on %s", (zone, date, offset) => expect(birthOffset(zone, date)).toBe(offset));
  test("rejects DST gaps and invalid dates; chooses earlier occurrence for repeated hours", () => {
    expect(() => birthOffset("Europe/Bucharest", "2024-03-31 03:30:00")).toThrow("nu există");
    expect(() => birthOffset("Europe/Bucharest", "1990-02-31 10:00:00")).toThrow("invalidă");
    expect(birthOffset("Europe/Bucharest", "2024-10-27 03:30:00")).toBe(3);
  });
  test.each(["google", "geonames"])("%s resolves historical offset, not current API offset", async (provider) => {
    reply(provider === "google" ? { status: "OK", timeZoneId: "Europe/Bucharest", rawOffset: 7200, dstOffset: 3600 } : { timezoneId: "Europe/Bucharest", rawOffset: 2, dstOffset: 3 });
    expect(await astroTimezone(44.43225, 26.10626, "1970-07-15 10:30:00", provider)).toMatchObject({ offset: 2, data: { timeZoneId: "Europe/Bucharest" }, provider });
  });
});
