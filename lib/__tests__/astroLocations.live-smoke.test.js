jest.mock("../firebaseAdmin", () => ({ getAdminDb: jest.fn() }));
import { searchAstroLocations, resolveAstroLocation, astroTimezone } from "../astroLocations";

const live = process.env.RUN_LIVE_GEONAMES === "1" ? describe : describe.skip;
live("GeoNames real search and timezone (no Divine requests)", () => {
  test.each([
    ["Bucur", "București", "Europe/Bucharest", 2, 3],
    ["New York", "New York", "America/New_York", -5, -4],
    ["Kathmandu", "Kathmandu", "Asia/Kathmandu", 5.75, 5.75],
  ])("%s", async (query, name, timezone, winter, summer) => {
    const results = await searchAstroLocations(query, "geonames");
    const selected = results.find((item) => item.label.includes(name));
    expect(selected).toBeDefined();
    expect(typeof selected.lat).toBe("number");
    const jan = await astroTimezone(selected.lat, selected.lon, "1990-01-15 10:30:00", "geonames");
    const jul = await astroTimezone(selected.lat, selected.lon, "1990-07-15 10:30:00", "geonames");
    expect(jan.data.timeZoneId).toBe(timezone);
    expect(jan.offset).toBe(winter); expect(jul.offset).toBe(summer);
    console.log(JSON.stringify({ place: selected.label, lat: selected.lat, lon: selected.lon, timezone, winter: jan.offset, summer: jul.offset }));
  }, 40000);
});

const googleLive = process.env.RUN_LIVE_GOOGLE === "1" ? test : test.skip;
googleLive("Google fallback: real autocomplete, details and birth timezone", async () => {
  const results = await searchAstroLocations("Bucuresti", "google");
  expect(results.length).toBeGreaterThan(0);
  const selected = await resolveAstroLocation(results[0].id, "google");
  expect(selected.lat).toBeGreaterThan(44); expect(selected.lat).toBeLessThan(45);
  const zone = await astroTimezone(selected.lat, selected.lon, "1990-07-15 10:30:00", "google");
  expect(zone.offset).toBe(3);
  expect(zone.data.timeZoneId).toBe("Europe/Bucharest");
}, 40000);
