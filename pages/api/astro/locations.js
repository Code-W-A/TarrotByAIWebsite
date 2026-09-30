import { getAstroLocationProvider, searchAstroLocations, resolveAstroLocation, astroTimezone } from "../../../lib/astroLocations";

// Public like the existing mobile location field, including guest onboarding.
// Bounded inputs, result count and upstream timeout; no user-supplied upstream URLs.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  const { action, query, id, provider: selectedProvider, lat, lon, localDateTime } = req.body || {};
  if (!["search", "details", "timezone"].includes(action) ||
      (action === "search" && (typeof query !== "string" || query.length > 160)) ||
      (action === "details" && (typeof id !== "string" || id.length > 256)) ||
      (localDateTime !== undefined && (typeof localDateTime !== "string" || localDateTime.length !== 19))) {
    return res.status(400).json({ error: "Cerere de locație invalidă." });
  }
  try {
    const provider = await getAstroLocationProvider();
    if (action === "search") return res.status(200).json({ provider, results: await searchAstroLocations(query, provider) });
    if (action === "details") {
      if (selectedProvider !== provider) return res.status(409).json({ error: "Furnizorul s-a schimbat. Caută din nou localitatea." });
      return res.status(200).json(await resolveAstroLocation(id, provider));
    }
    return res.status(200).json(await astroTimezone(lat, lon, localDateTime, provider));
  } catch (error) {
    return res.status(502).json({ error: error.name === "AbortError" ? "Serviciul de locații nu răspunde. Reîncearcă." : "Nu am putut obține locația sau fusul orar. " + (error.message?.includes("GeoNames") || error.message?.includes("Google") || error.message?.includes("nașterii") ? error.message : "Reîncearcă.") });
  }
}
