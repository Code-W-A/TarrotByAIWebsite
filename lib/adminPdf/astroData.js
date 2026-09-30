/**
 * Server-side port of the Expo `adminPdfData.ts` logic, used by the dashboard
 * "Astrograme PDF" safety-net tool. No React Native / AsyncStorage here.
 *
 * Builds astrology (natal) and synastry analyses straight from DivineAPI,
 * resolves the timezone via the selected location provider, geocodes a place name, and
 * translates the resulting reports server-side (RapidAPI primary, Google
 * Translate fallback). Output objects mirror the shapes used by the mobile app
 * so the existing PDF templates can render them unchanged.
 */

import moment from "moment-timezone";
import { astroTimezone, getAstroLocationProvider, searchAstroLocations, resolveAstroLocation } from "../astroLocations";

// DivineAPI credentials. These already ship inside the public mobile bundle, so
// env overrides are optional; the fallbacks keep the tool working out of the box.
const DIVINE_API_TOKEN =
  process.env.DIVINE_API_TOKEN ||
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2FzdHJvYXBpLTEuZGl2aW5lYXBpLmNvbS9hcGkvYXV0aC1hcGktdXNlciIsImlhdCI6MTcxODc3ODk3NSwibmJmIjoxNzE4Nzc4OTc1LCJqdGkiOiJLZHpoeDhVTzA1SGx5YXY0Iiwic3ViIjoiMTk3NSIsInBydiI6ImU2ZTY0YmIwYjYxMjZkNzNjNmI5N2FmYzNiNDY0ZDk4NWY0NmM5ZDcifQ.XJbNhwPAWKVMm7XlgYDATnpWbSjXu4IgSx-yr_fbfMo";
const DIVINE_API_KEY =
  process.env.DIVINE_API_KEY || "7d2b92b6726c241134dae6cd3fb8c182";

const ASTRO_CELESTIAL_BODIES = [
  "Sun",
  "Moon",
  "Mars",
  "Mercury",
  "Venus",
  "Jupiter",
  "Saturn",
  "NorthNode",
  "SouthNode",
  "Uranus",
  "Neptune",
  "Pluto",
  "MC",
  "Chiron",
];

const SYNASTRY_CATEGORIES = [
  "harmoniousAspectReading",
  "conflictingAspectReading",
  "contrastingAspectReading",
  "intenseCompatibility",
  "physicalCompatibility",
  "emotionalCompatibility",
  "sexualCompatibility",
  "spiritualCompatibility",
  "financialCompatibility",
];

const ASTRO_ENDPOINTS = {
  natalWheelChart:
    "https://astroapi-4.divineapi.com/western-api/v1/natal-wheel-chart",
  aspectTable: "https://astroapi-4.divineapi.com/western-api/v2/aspect-table",
  planetaryPositions:
    "https://astroapi-4.divineapi.com/western-api/v1/planetary-positions",
  houseCusps: "https://astroapi-4.divineapi.com/western-api/v1/house-cusps",
  moonPhases: "https://astroapi-4.divineapi.com/western-api/v2/moon-phases",
  ascendantReport:
    "https://astroapi-4.divineapi.com/western-api/v1/ascendant-report",
  generalHouseReports: ASTRO_CELESTIAL_BODIES.map(
    (body) =>
      `https://astroapi-4.divineapi.com/western-api/v1/general-house-report/${body}`
  ),
  generalSignReports: ASTRO_CELESTIAL_BODIES.map(
    (body) =>
      `https://astroapi-4.divineapi.com/western-api/v1/general-sign-report/${body}`
  ),
};

const SYNASTRY_ENDPOINTS = {
  natalWheelChart:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/natal-wheel-chart",
  houseCusps:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/house-cusps",
  planetaryPositions:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/planetary-positions",
  aspect: "https://astroapi-4.divineapi.com/western-api/v1/synastry/aspect",
  harmoniousAspectReading:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/harmonious-aspect-reading",
  conflictingAspectReading:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/conflicting-aspect-reading",
  contrastingAspectReading:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/contrasting-aspect-reading",
  intenseCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/intense-aspect-reading",
  physicalCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/physical-compatibility",
  emotionalCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/emotional-compatibility",
  sexualCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/sexual-compatibility",
  spiritualCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/spiritual-compatibility",
  financialCompatibility:
    "https://astroapi-4.divineapi.com/western-api/v1/synastry/financial-compatibility",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeLanguageCode = (language) => {
  if (!language || typeof language !== "string") {
    return "en";
  }
  return language.split("-")[0].toLowerCase();
};

const ensureStringNumber = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return "0";
  }
  return String(parsed);
};

// Parse "HH:mm" without external date libs. Fallback to midnight.
const parseTime = (value) => {
  const match =
    typeof value === "string" ? value.trim().match(/^(\d{1,2}):(\d{1,2})$/) : null;

  if (!match) {
    return { selectedTime: "00:00", hour: 0, min: 0, sec: 0 };
  }

  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const min = Math.min(59, Math.max(0, Number(match[2])));
  const pad = (n) => String(n).padStart(2, "0");

  return {
    selectedTime: `${pad(hour)}:${pad(min)}`,
    hour,
    min,
    sec: 0,
  };
};

const generateTimestampFromDateTime = (dateDdMmYyyy, timeHhMm) => {
  const [dd, mm, yyyy] = String(dateDdMmYyyy)
    .split("-")
    .map((part) => Number(part));
  const [hh, min] = String(timeHhMm)
    .split(":")
    .map((part) => Number(part));

  const safe = (n, fallback) => (Number.isFinite(n) ? n : fallback);
  const ms = Date.UTC(
    safe(yyyy, 2000),
    safe(mm, 1) - 1,
    safe(dd, 1),
    safe(hh, 0),
    safe(min, 0),
    0
  );

  return Math.floor(ms / 1000);
};

export const fetchTimeZone = async (latitude, longitude, timestamp) => {
  return astroTimezone(latitude, longitude,
    timestamp === undefined ? undefined : moment.utc(timestamp * 1000).format("YYYY-MM-DD HH:mm:ss"),
    await getAstroLocationProvider());
};

export const geocodePlace = async (query) => {
  const provider = await getAstroLocationProvider();
  const results = await searchAstroLocations(query, provider);
  if (!results.length) return null;
  const result = provider === "google" ? await resolveAstroLocation(results[0].id, provider) : results[0];
  return { lat: String(result.lat), lon: String(result.lon), formattedAddress: result.label };
};

async function fetchAstroData(endpointUrl, person) {
  const formData = new FormData();
  formData.append("api_key", String(DIVINE_API_KEY));
  formData.append("full_name", String(person.full_name));
  formData.append("day", String(person.day));
  formData.append("month", String(person.month));
  formData.append("year", String(person.year));
  formData.append("hour", String(person.hour));
  formData.append("min", String(person.min));
  formData.append("sec", String(person.sec));
  formData.append("gender", String(person.gender));
  formData.append("place", String(person.place));
  formData.append("lat", String(person.lat));
  formData.append("lon", String(person.lon));
  formData.append("tzone", String(person.tzone));

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${DIVINE_API_TOKEN}` },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Astro API HTTP ${response.status} for ${endpointUrl}`);
    }
    return await response.json();
  } catch (error) {
    console.error(
      "[astroData] fetchAstroData error:",
      endpointUrl,
      error?.message || error
    );
    return null;
  }
}

async function fetchSinastrieData(endpointUrl, person1, person2) {
  const formData = new FormData();
  formData.append("api_key", String(DIVINE_API_KEY));
  formData.append("p1_full_name", String(person1.full_name));
  formData.append("p1_day", String(person1.day));
  formData.append("p1_month", String(person1.month));
  formData.append("p1_year", String(person1.year));
  formData.append("p1_hour", String(person1.hour));
  formData.append("p1_min", String(person1.min));
  formData.append("p1_sec", String(person1.sec));
  formData.append("p1_gender", String(person1.gender));
  formData.append("p1_place", String(person1.place));
  formData.append("p1_lat", String(person1.lat));
  formData.append("p1_lon", String(person1.lon));
  formData.append("p1_tzone", String(person1.tzone));

  formData.append("p2_full_name", String(person2.full_name));
  formData.append("p2_day", String(person2.day));
  formData.append("p2_month", String(person2.month));
  formData.append("p2_year", String(person2.year));
  formData.append("p2_hour", String(person2.hour));
  formData.append("p2_min", String(person2.min));
  formData.append("p2_sec", String(person2.sec));
  formData.append("p2_gender", String(person2.gender));
  formData.append("p2_place", String(person2.place));
  formData.append("p2_lat", String(person2.lat));
  formData.append("p2_lon", String(person2.lon));
  formData.append("p2_tzone", String(person2.tzone));

  formData.append("lan", "en");

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${DIVINE_API_TOKEN}` },
      body: formData,
    });
    return await response.json();
  } catch (error) {
    console.error(
      "[astroData] fetchSinastrieData error:",
      endpointUrl,
      error?.message || error
    );
    return null;
  }
}

// ---- Translation (server-side) ----

const rapidTranslate = async (text, target, source) => {
  const rapidApiKey = process.env.RAPIDAPI_TRANSLATE_KEY;
  if (!rapidApiKey) {
    return null;
  }
  const rapidApiHost =
    process.env.RAPIDAPI_TRANSLATE_HOST || "google-translate113.p.rapidapi.com";

  try {
    const response = await fetch(
      `https://${rapidApiHost}/api/v1/translator/text`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": rapidApiKey,
          "X-RapidAPI-Host": rapidApiHost,
        },
        body: JSON.stringify({
          from: source || "auto",
          to: target,
          text,
        }),
      }
    );
    const result = await response.json().catch(() => ({}));
    const translated =
      (typeof result?.trans === "string" && result.trans) ||
      (typeof result?.translation === "string" && result.translation) ||
      "";
    return response.ok && translated ? translated : null;
  } catch (error) {
    return null;
  }
};

const googleTranslate = async (text, target, source) => {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          target,
          source: source && source !== "auto" ? source : undefined,
          format: "text",
        }),
      }
    );
    const result = await response.json().catch(() => ({}));
    const translated =
      result?.data?.translations?.[0]?.translatedText || "";
    return response.ok && translated ? translated : null;
  } catch (error) {
    return null;
  }
};

const translateTextWithFallback = async (text, targetLanguage, sourceLanguage) => {
  if (!text || typeof text !== "string") {
    return text;
  }
  if (targetLanguage === sourceLanguage) {
    return text;
  }

  let translatedText = (await rapidTranslate(text, targetLanguage, sourceLanguage)) || text;

  const didNotChange =
    translatedText.trim().toLowerCase() === text.trim().toLowerCase();

  if (didNotChange) {
    const googleResult = await googleTranslate(text, targetLanguage, sourceLanguage);
    if (googleResult && googleResult.trim().length > 0) {
      translatedText = googleResult;
    }
  }

  return translatedText || text;
};

// ---- Build person with timezone ----

const buildPersonDataWithTimezone = async (personInput) => {
  const day = ensureStringNumber(personInput.day);
  const month = ensureStringNumber(personInput.month);
  const year = ensureStringNumber(personInput.year);
  const timeData = parseTime(personInput.selectedTime);

  const timestamp = generateTimestampFromDateTime(
    `${day}-${month}-${year}`,
    timeData.selectedTime
  );
  const timezoneData = await fetchTimeZone(
    personInput.lat,
    personInput.lon,
    timestamp
  );

  if (!Number.isFinite(timezoneData?.offset)) throw new Error("Fusul orar nu a putut fi calculat.");
  const timezoneOffset = timezoneData.offset;

  return {
    full_name: (personInput.full_name || "").trim(),
    day,
    month,
    year,
    hour: timeData.hour,
    min: timeData.min,
    sec: timeData.sec,
    selectedTime: timeData.selectedTime,
    gender: personInput.gender || "male",
    place: personInput.place || "",
    adress: personInput.adress || "",
    lat: personInput.lat,
    lon: personInput.lon,
    tzone: timezoneOffset,
    actualLanguage: "en",
    actualLanguageAstrograma: "en",
    actualLanguageSinastrie: "en",
  };
};

// ---- Public builders ----

export const buildManualAstrologyAnalysis = async (personInput) => {
  const personData = await buildPersonDataWithTimezone(personInput);

  const baseResults = await Promise.all(
    Object.keys(ASTRO_ENDPOINTS)
      .filter((key) => key !== "generalSignReports" && key !== "generalHouseReports")
      .map((endpointKey) => fetchAstroData(ASTRO_ENDPOINTS[endpointKey], personData))
  );

  const signReports = await Promise.all(
    ASTRO_ENDPOINTS.generalSignReports.map((endpoint) =>
      fetchAstroData(endpoint, personData)
    )
  );

  const houseReports = await Promise.all(
    ASTRO_ENDPOINTS.generalHouseReports.map((endpoint) =>
      fetchAstroData(endpoint, personData)
    )
  );

  const [
    natalData,
    aspectsData,
    planetaryData,
    cuspsData,
    moonPhaseData,
    ascendantData,
  ] = baseResults;

  const generalSignTextData = {};
  ASTRO_CELESTIAL_BODIES.forEach((body, index) => {
    generalSignTextData[body] = signReports[index];
  });

  const generalHouseTextData = {};
  ASTRO_CELESTIAL_BODIES.forEach((body, index) => {
    generalHouseTextData[body] = houseReports[index];
  });

  return {
    ...personData,
    natalData,
    aspectsData,
    planetaryData,
    cuspsData,
    moonPhaseData,
    ascendantData,
    generalSignTextData,
    generalHouseTextData,
    type: "adminManualAstrology",
  };
};

export const buildManualSynastryAnalysis = async (person1Input, person2Input) => {
  const person1 = await buildPersonDataWithTimezone(person1Input);
  const person2 = await buildPersonDataWithTimezone(person2Input);

  const synastryResults = await Promise.all(
    Object.keys(SYNASTRY_ENDPOINTS).map((key) =>
      fetchSinastrieData(SYNASTRY_ENDPOINTS[key], person1, person2)
    )
  );

  const [
    natalWheelChart,
    houseCusps,
    planetaryPositions,
    aspect,
    harmoniousAspectReading,
    conflictingAspectReading,
    contrastingAspectReading,
    intenseCompatibility,
    physicalCompatibility,
    emotionalCompatibility,
    sexualCompatibility,
    spiritualCompatibility,
    financialCompatibility,
  ] = synastryResults;

  const synastry = {
    natalWheelChart,
    houseCusps,
    planetaryPositions,
    aspect,
    harmoniousAspectReading,
    conflictingAspectReading,
    contrastingAspectReading,
    intenseCompatibility,
    physicalCompatibility,
    emotionalCompatibility,
    sexualCompatibility,
    spiritualCompatibility,
    financialCompatibility,
  };

  return {
    type: "adminManualSynastry",
    person1,
    person2,
    synastry,
    actualLanguage: "en",
    actualLanguageAstrograma: "en",
    actualLanguageSinastrie: "en",
  };
};

// ---- Translation of full analyses ----

export const translateAstrologyAnalysis = async (analysisInput, language) => {
  const targetLanguage = normalizeLanguageCode(language);
  const sourceLanguage = normalizeLanguageCode(
    analysisInput?.actualLanguageAstrograma || "en"
  );

  if (targetLanguage === sourceLanguage) {
    return analysisInput;
  }

  const analysis = JSON.parse(JSON.stringify(analysisInput));
  const signData = analysis?.generalSignTextData || {};
  const houseData = analysis?.generalHouseTextData || {};

  if (analysis?.ascendantData?.data?.result) {
    analysis.ascendantData.data.result = await translateTextWithFallback(
      analysis.ascendantData.data.result,
      targetLanguage,
      sourceLanguage
    );
  }

  for (const key of Object.keys(signData)) {
    const planetData = signData?.[key]?.data;
    if (!planetData) {
      continue;
    }
    if (planetData.report) {
      planetData.report = await translateTextWithFallback(
        planetData.report,
        targetLanguage,
        sourceLanguage
      );
    }
    const dynamicTitle =
      planetData.title ||
      `${planetData.planet_name} is in ${planetData.sign_name}`;
    planetData.title = await translateTextWithFallback(
      dynamicTitle,
      targetLanguage,
      sourceLanguage
    );
    await sleep(200);
  }

  for (const key of Object.keys(houseData)) {
    const data = houseData?.[key]?.data;
    if (!data) {
      continue;
    }
    if (data.report) {
      data.report = await translateTextWithFallback(
        data.report,
        targetLanguage,
        sourceLanguage
      );
    }
    const dynamicTitle =
      data.title || `${data.planet_name} is in the ${data.house}th house`;
    data.title = await translateTextWithFallback(
      dynamicTitle,
      targetLanguage,
      sourceLanguage
    );
    await sleep(200);
  }

  analysis.actualLanguageAstrograma = targetLanguage;
  return analysis;
};

export const translateSynastryAnalysis = async (analysisInput, language) => {
  const targetLanguage = normalizeLanguageCode(language);
  const sourceLanguage = normalizeLanguageCode(
    analysisInput?.actualLanguageSinastrie || "en"
  );

  if (targetLanguage === sourceLanguage) {
    return analysisInput;
  }

  const analysis = JSON.parse(JSON.stringify(analysisInput));
  const synastry = analysis?.synastry || {};

  for (const category of SYNASTRY_CATEGORIES) {
    const entries = synastry?.[category]?.data;
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      const readings = Array.isArray(entry?.reading) ? entry.reading : [];
      for (const reading of readings) {
        if (reading?.description) {
          reading.description = await translateTextWithFallback(
            reading.description,
            targetLanguage,
            sourceLanguage
          );
        }
        if (reading?.title) {
          reading.title = await translateTextWithFallback(
            reading.title,
            targetLanguage,
            sourceLanguage
          );
        }
        await sleep(120);
      }
    }
  }

  analysis.actualLanguageSinastrie = targetLanguage;
  return analysis;
};
