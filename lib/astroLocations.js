import moment from "moment-timezone";
import { getAdminDb } from "./firebaseAdmin";

export const normalizeProvider = (value) => value === "google" ? "google" : "geonames";
// Read the switch directly: the global settings cache is five minutes per instance.
export async function getAstroLocationProvider() {
  const snapshot = await getAdminDb().collection("settings").doc("global").get();
  return normalizeProvider(snapshot.data()?.astroLocationProvider);
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(url.includes("places.googleapis.com")
      ? "Google Places nu este disponibil. Verifică activarea Places API (New) și restricțiile cheii API."
      : "Serviciul de locații nu este disponibil.");
    const data = await response.json();
    if (data.status?.value) {
      throw new Error(data.status.value === 10
        ? "Contul GeoNames nu este activat pentru Web Services."
        : "GeoNames nu este disponibil momentan. Reîncearcă mai târziu.");
    }
    if (typeof data.status === "string" && !["OK", "ZERO_RESULTS"].includes(data.status)) {
      throw new Error("Google nu este disponibil momentan. Reîncearcă mai târziu.");
    }
    return data;
  } finally { clearTimeout(timer); }
}

function geonamesUrl(action, params) {
  return `https://secure.geonames.org/${action}?${new URLSearchParams({
    ...params, username: process.env.GEONAMES_USERNAME || "shikatedo1",
  })}`;
}
function googleUrl(action, params) {
  const key = (action === "timezone" ? process.env.GOOGLE_TIMEZONE_API_KEY : undefined) || process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBRgP4D08BVgzw4oyWfZZ9Rx2mjNouePj4";
  return `https://maps.googleapis.com/maps/api/${action}/json?${new URLSearchParams({ ...params, key })}`;
}

function placesHeaders(fields) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBRgP4D08BVgzw4oyWfZZ9Rx2mjNouePj4",
    "X-Goog-FieldMask": fields,
  };
}

export function validCoordinates(lat, lon) {
  return lat !== null && lon !== null && lat !== undefined && lon !== undefined &&
    String(lat).trim() !== "" && String(lon).trim() !== "" &&
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
}

export async function searchAstroLocations(query, provider) {
  const text = String(query || "").trim();
  if (text.length < 3 || text.length > 160) return [];
  if (provider === "google") {
    const data = await requestJson("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST", headers: placesHeaders("suggestions.placePrediction.placeId,suggestions.placePrediction.text.text"),
      body: JSON.stringify({ input: text, languageCode: "ro" }),
    });
    return (data.suggestions || []).map((item) => item.placePrediction)
      .filter((item) => item?.placeId && item?.text?.text).slice(0, 8)
      .map((item) => ({ id: item.placeId, label: item.text.text, provider }));
  }
  const data = await requestJson(geonamesUrl("searchJSON", {
    ...(text.includes(",") ? { q: text.replace(/,/g, " ") } : { name_startsWith: text }),
    featureClass: "P", maxRows: "8", style: "FULL", lang: "ro", orderby: "population",
  }));
  return (data.geonames || []).filter((item) => validCoordinates(item.lat, item.lng)).map((item) => ({
    id: String(item.geonameId),
    label: [...new Set([item.name, item.adminName1, item.countryName].filter(Boolean))].join(", "),
    lat: Number(item.lat), lon: Number(item.lng), provider,
  }));
}

export async function resolveAstroLocation(id, provider) {
  if (provider !== "google") throw new Error("Selectează din nou localitatea.");
  const data = await requestJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=ro`, {
    headers: placesHeaders("location,formattedAddress"),
  });
  const location = data.location;
  if (!validCoordinates(location?.latitude, location?.longitude)) throw new Error("Localitatea nu are coordonate valide.");
  return { id, label: data.formattedAddress, lat: location.latitude, lon: location.longitude, provider };
}

export function birthOffset(timezoneId, localDateTime) {
  if (!moment.tz.zone(timezoneId)) throw new Error("Fus orar necunoscut.");
  const value = localDateTime
    ? moment.tz(localDateTime, "YYYY-MM-DD HH:mm:ss", true, timezoneId)
    : moment.tz(timezoneId);
  if (!value.isValid()) throw new Error("Data sau ora nașterii este invalidă.");
  // Never silently shift a non-existent local time across a spring DST jump.
  if (localDateTime && value.format("YYYY-MM-DD HH:mm:ss") !== localDateTime) {
    throw new Error("Ora nașterii nu există în această zi din cauza trecerii la ora de vară. Verifică ora.");
  }
  // Repeated fall-back times use Moment's earlier occurrence consistently.
  return value.utcOffset() / 60;
}

export async function astroTimezone(lat, lon, localDateTime, provider) {
  if (!validCoordinates(lat, lon)) throw new Error("Selectează locul nașterii din listă.");
  let timezoneId;
  let name;
  if (provider === "google") {
    const timestamp = localDateTime ? moment.utc(localDateTime, "YYYY-MM-DD HH:mm:ss", true).unix() : Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestamp)) throw new Error("Data nașterii este invalidă.");
    const data = await requestJson(googleUrl("timezone", { location: `${lat},${lon}`, timestamp: String(timestamp) }));
    timezoneId = data.timeZoneId; name = data.timeZoneName;
  } else {
    const data = await requestJson(geonamesUrl("timezoneJSON", { lat: String(lat), lng: String(lon) }));
    timezoneId = data.timezoneId;
  }
  const offset = birthOffset(timezoneId, localDateTime);
  return { offset, data: { timeZoneId: timezoneId, timeZoneName: name || timezoneId }, provider };
}
