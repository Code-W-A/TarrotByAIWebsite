jest.mock("../firebaseAdmin", () => ({ getAdminDb: jest.fn() }));
import { getAdminDb } from "../firebaseAdmin";
import { searchAstroLocations } from "../astroLocations";
import { buildManualAstrologyAnalysis, buildManualSynastryAnalysis } from "../adminPdf/astroData";

let divinePayloads;
beforeEach(() => {
  divinePayloads = [];
  getAdminDb.mockReturnValue({ collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ astroLocationProvider: "geonames" }) }) }) }) });
  global.fetch = jest.fn(async (url, options) => {
    let payload;
    if (url.includes("/searchJSON")) payload = { geonames: [{ geonameId: 683506, name: "București", countryName: "România", lat: "44.43225", lng: "26.10626" }] };
    else if (url.includes("/timezoneJSON")) payload = { timezoneId: url.includes("lat=40.7") ? "America/New_York" : "Europe/Bucharest" };
    else if (url.includes("divineapi.com")) {
      divinePayloads.push(Object.fromEntries(options.body.entries()));
      payload = { success: true, data: {} };
    } else throw new Error(`Unexpected request: ${url}`);
    return { ok: true, json: async () => payload };
  });
});
const person = (location) => ({ full_name: "Test Person", gender: "female", day: "15", month: "7", year: "1990", selectedTime: "10:30", place: location.label, lat: location.lat, lon: location.lon });
test("GeoNames selection reaches every natal Divine request with unchanged wire fields", async () => {
  const [selected] = await searchAstroLocations("Bucur", "geonames");
  await buildManualAstrologyAnalysis(person(selected));
  expect(divinePayloads.length).toBeGreaterThan(1);
  for (const payload of divinePayloads) {
    expect(payload).toMatchObject({ full_name: "Test Person", day: "15", month: "7", year: "1990", hour: "10", min: "30", sec: "0", gender: "female", place: "București, România", lat: "44.43225", lon: "26.10626", tzone: "3" });
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("timezoneId");
  }
});
test("synastry serializes each person's own coordinates and historical offset", async () => {
  const [selected] = await searchAstroLocations("Bucur", "geonames");
  await buildManualSynastryAnalysis(person(selected), person({ label: "New York", lat: 40.7, lon: -74 }));
  expect(divinePayloads.length).toBeGreaterThan(1);
  for (const payload of divinePayloads) expect(payload).toMatchObject({ p1_place: "București, România", p1_lat: "44.43225", p1_lon: "26.10626", p1_tzone: "3", p2_place: "New York", p2_lat: "40.7", p2_lon: "-74", p2_tzone: "-4" });
});
