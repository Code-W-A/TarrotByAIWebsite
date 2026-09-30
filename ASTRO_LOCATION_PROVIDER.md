# Astro location provider

The authenticated `/administrare/setari` switch writes `settings/global.astroLocationProvider` (`geonames` or `google`). Missing values mean GeoNames. Only the astro location service uses this flag; unrelated map fields retain their current Google integration.

All four mobile astro/synastry forms and both mobile/web admin PDF flows use the selected provider. Search starts after 3 characters, debounced by 700–800 ms, and shows up to 8 selectable suggestions with region/country. Editing the location clears old coordinates. Google is an explicit manual fallback; an upstream error never silently enables billable Google calls or defaults the birth offset to UTC.

## Configuration and release

- `GEONAMES_USERNAME` is server-side, default `shikatedo1`; free Web Services must be enabled on that account.
- `GOOGLE_MAPS_API_KEY` overrides the existing key for **Places API (New)**. `GOOGLE_TIMEZONE_API_KEY` optionally overrides it for timezone lookup. Keys must permit requests from the Next.js backend to Places API (New) and Time Zone API. Autocomplete uses the new POST endpoint and details request only location/formattedAddress.
- The mobile app uses its existing `EXPO_PUBLIC_API_BASE_URL` to call `POST /api/astro/locations`.
- Deploy Next.js first, then release the updated mobile JS/binary through the existing approved release process. Older installed clients continue calling Google directly until updated.
- Location requests read the provider directly from Firestore to avoid the five-minute global settings cache. Changing the switch affects subsequent requests across server instances. Existing selected coordinates remain valid. A Google detail request after a provider change returns 409 and asks the user to search again.
- GeoNames API access is free within its account quota. Existing Next.js hosting and Firestore reads still apply.

## Contracts and timezone rules

`search` accepts `query` and returns `{provider, results:[{id,label,provider,lat?,lon?}]}`. GeoNames includes numeric coordinates; Google suggestions resolve through `details` with `id` and the suggestion's `provider`.

`timezone` accepts `lat`, `lon`, and optional birth wall time `localDateTime` (`YYYY-MM-DD HH:mm:ss`). It returns `{offset, data:{timeZoneId,timeZoneName}, provider}`. Preview without a birth date uses the current time.

The mobile timestamp helper encodes the entered wall-clock fields with `moment.utc`; it is not a real UTC birth instant. Both providers supply an IANA zone, and full Moment Timezone data resolves historical offset at the entered local birth time. Fractional/negative/zero offsets are retained. Invalid dates and nonexistent spring-transition times are rejected. Repeated fall-transition times choose the earlier occurrence, consistent with Moment's default; the forms do not collect a DST disambiguation choice.

Divine serializers remain unchanged: natal `place`, `lat`, `lon`, `tzone` plus existing personal/date fields; synastry uses `p1_*` and `p2_*`. GeoNames uses locality coordinates, which need not be identical to Google's point/address coordinates. No historical saved analyses are migrated.

## Verification

- Next.js: `npx jest --runInBand lib/__tests__/astroLocations.test.js tests/api/astro-locations.test.js tests/api/astro-location-settings.test.js`
- Real GeoNames calls: `RUN_LIVE_GEONAMES=1 npx jest --runInBand lib/__tests__/astroLocations.live-smoke.test.js`. Uses fictional birth dates and public cities; does not call Divine or write settings.
- Google check: `RUN_LIVE_GOOGLE=1 npx jest --runInBand lib/__tests__/astroLocations.live-smoke.test.js` (three Google calls if successful).
- Expo: run `AstroLocationAutocomplete.test.jsx`, `astroLocations.test.ts`, existing `divineApi.test.js`, `adminPdfData.test.ts`, `adminPdfData.smoke.test.ts`, and `astrologyTimezoneRegression.test.js`.
- Manual: type/select/retype a location, check cleared coordinates, two-person independence, provider switch and error recovery. Confirm dropdown selection with keyboard open on physical iOS/Android before release.

## Live verification, 2026-09-28

GeoNames search + timezone passed for București (44.43225, 26.10626; winter/summer 1990: +2/+3), New York (40.71427, -74.00597; -5/-4), Kathmandu (27.70169, 85.3206; +5.75). The local HTTP endpoint and browser dropdown/selection were also exercised with real GeoNames.

The existing Google key rejected legacy Places with `LegacyApiNotActivatedMapError`; Places API (New) returned `403 API_KEY_SERVICE_BLOCKED`. Google Time Zone API returned `OK` for the same Bucharest summer fixture (+3). The adapter now targets Places API (New), but the account owner must enable/allow that API for the server key (or supply a configured key) before the manual Google fallback is usable. No Google Cloud settings or production provider setting were changed.
