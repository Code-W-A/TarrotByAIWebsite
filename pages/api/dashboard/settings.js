import Stripe from "stripe";
import { getGlobalSettings, updateGlobalSettings } from "../../../lib/globalSettings";
import {
  assertVatPercentageMatchesStripe,
  normalizeVatPercentage,
} from "../../../lib/stripeFixedVat";
import {
  loadMobileUpdateStatus,
  setMobileForceUpdateEnabled,
  setMobileMinAppVersions,
  setMobileUpdatePromptEnabled,
  validateForceUpdateMinVersions,
} from "../../../lib/mobileUpdatePromptSettings";
import { requireDashboardAccess } from "../../../lib/requireAuth";
import { getAstroLocationProvider } from "../../../lib/astroLocations";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function mergeSettingsForResponse() {
  const [global, mobileStatus, astroLocationProvider] = await Promise.all([
    getGlobalSettings(),
    loadMobileUpdateStatus(),
    getAstroLocationProvider(),
  ]);
  return {
    ...global,
    astroLocationProvider,
    mobileUpdatePromptEnabled: mobileStatus.update,
    mobileForceUpdateEnabled: mobileStatus.forceUpdate,
    mobileMinAppVersionIos: mobileStatus.minAppVersionIos,
    mobileMinAppVersionAndroid: mobileStatus.minAppVersionAndroid,
  };
}

export default async function handler(req, res) {
  try {
    requireDashboardAccess(req);
  } catch (error) {
    return res.status(error?.statusCode || 401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    try {
      const settings = await mergeSettingsForResponse();
      return res.status(200).json({ settings });
    } catch (err) {
      console.error("[dashboard/settings] GET error", err?.message || err);
      return res.status(500).json({ error: "Failed to load settings" });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      if (body.astroLocationProvider !== undefined && !["google", "geonames"].includes(body.astroLocationProvider)) {
        return res.status(400).json({ error: "Furnizor de locații invalid." });
      }
      const subscriptionUpdate =
        typeof body.iosPremiumSubscriptionsEnabled === "boolean"
          ? body.iosPremiumSubscriptionsEnabled
          : typeof body.subscriptionSystemEnabled === "boolean"
          ? body.subscriptionSystemEnabled
          : undefined;
      const billingProviderUpdates = {};
      [
        "androidBillingAnalysesProvider",
      ].forEach((key) => {
        if (body[key] === "stripe" || body[key] === "revenuecat") {
          billingProviderUpdates[key] = body[key];
        }
      });
      ["iosBillingPremiumProvider", "iosBillingAnalysesProvider"].forEach((key) => {
        if (body[key] === "disabled" || body[key] === "revenuecat") {
          billingProviderUpdates[key] = body[key];
        }
      });
      const iosCoursesHiddenUpdate =
        typeof body.iosCoursesHidden === "boolean" ? body.iosCoursesHidden : undefined;
      const mobilePromptUpdate =
        typeof body.mobileUpdatePromptEnabled === "boolean"
          ? body.mobileUpdatePromptEnabled
          : undefined;
      const mobileForceUpdate =
        typeof body.mobileForceUpdateEnabled === "boolean"
          ? body.mobileForceUpdateEnabled
          : undefined;
      const mobileMinIosProvided = Object.prototype.hasOwnProperty.call(
        body,
        "mobileMinAppVersionIos"
      );
      const mobileMinAndroidProvided = Object.prototype.hasOwnProperty.call(
        body,
        "mobileMinAppVersionAndroid"
      );
      const vatProvided = Object.prototype.hasOwnProperty.call(body, "vatPercentage");

      if (
        subscriptionUpdate === undefined &&
        Object.keys(billingProviderUpdates).length === 0 &&
        iosCoursesHiddenUpdate === undefined &&
        mobilePromptUpdate === undefined &&
        mobileForceUpdate === undefined &&
        !mobileMinIosProvided &&
        !mobileMinAndroidProvided &&
        body.astroLocationProvider === undefined &&
        !vatProvided
      ) {
        return res.status(400).json({ error: "No valid settings to update" });
      }

      if (vatProvided) {
        const vatPercentage = normalizeVatPercentage(body.vatPercentage);
        if (vatPercentage === null) {
          return res.status(400).json({
            error:
              "Procentul de TVA este invalid. Folosește un număr între 0 și 100 (ex. 21).",
          });
        }
        try {
          await assertVatPercentageMatchesStripe(stripe, vatPercentage);
        } catch (vatError) {
          if (vatError?.message === "vat_tax_rate_not_configured") {
            return res.status(409).json({
              error:
                "Cota de TVA din Stripe nu este configurată (STRIPE_FIXED_VAT_TAX_RATE_ID). Configurează-o înainte de a schimba procentul.",
            });
          }
          if (vatError?.message === "vat_percentage_stripe_mismatch") {
            const stripePercentage = vatError.stripePercentage;
            return res.status(409).json({
              error:
                `Stripe încasează în prezent ${stripePercentage ?? "un alt"}% TVA. ` +
                `Creează mai întâi o cotă Stripe de ${vatPercentage}% și pune-o în STRIPE_FIXED_VAT_TAX_RATE_ID, ` +
                "altfel prețurile afișate ar fi diferite de cele încasate.",
            });
          }
          console.error("[dashboard/settings] vat validation failed", vatError?.message || vatError);
          return res.status(502).json({
            error: "Nu am putut verifica cota de TVA în Stripe. Încearcă din nou.",
          });
        }
        await updateGlobalSettings({ vatPercentage }, "dashboard");
      }

      const currentMobileStatus = await loadMobileUpdateStatus({ bypassCache: true });
      const nextForceEnabled =
        mobileForceUpdate !== undefined
          ? mobileForceUpdate
          : currentMobileStatus.forceUpdate;
      const nextMinIos = mobileMinIosProvided
        ? body.mobileMinAppVersionIos
        : currentMobileStatus.minAppVersionIos;
      const nextMinAndroid = mobileMinAndroidProvided
        ? body.mobileMinAppVersionAndroid
        : currentMobileStatus.minAppVersionAndroid;

      const validation = validateForceUpdateMinVersions({
        forceUpdateEnabled: nextForceEnabled,
        minAppVersionIos: nextMinIos,
        minAppVersionAndroid: nextMinAndroid,
      });
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      if (subscriptionUpdate !== undefined) {
        await updateGlobalSettings(
          { iosPremiumSubscriptionsEnabled: subscriptionUpdate },
          "dashboard"
        );
      }
      if (body.astroLocationProvider !== undefined) {
        await updateGlobalSettings({ astroLocationProvider: body.astroLocationProvider }, "dashboard");
      }
      if (Object.keys(billingProviderUpdates).length > 0) {
        await updateGlobalSettings(billingProviderUpdates, "dashboard");
      }
      if (iosCoursesHiddenUpdate !== undefined) {
        await updateGlobalSettings(
          { iosCoursesHidden: iosCoursesHiddenUpdate },
          "dashboard"
        );
      }
      if (mobileMinIosProvided || mobileMinAndroidProvided) {
        await setMobileMinAppVersions(
          {
            ...(mobileMinIosProvided ? { ios: body.mobileMinAppVersionIos } : {}),
            ...(mobileMinAndroidProvided
              ? { android: body.mobileMinAppVersionAndroid }
              : {}),
          },
          "dashboard"
        );
      }
      if (mobilePromptUpdate !== undefined) {
        await setMobileUpdatePromptEnabled(mobilePromptUpdate, "dashboard");
      }
      if (mobileForceUpdate !== undefined) {
        await setMobileForceUpdateEnabled(mobileForceUpdate, "dashboard");
      }

      const settings = await mergeSettingsForResponse();

      return res.status(200).json({ ok: true, settings });
    } catch (err) {
      if (err?.message === "invalid_vat_percentage") {
        return res.status(400).json({
          error: "Procentul de TVA este invalid. Folosește un număr între 0 și 100 (ex. 21).",
        });
      }
      if (err?.message === "invalid_min_app_version_ios") {
        return res.status(400).json({
          error: "Versiunea minimă iOS este invalidă. Folosește un număr întreg (ex. 4).",
        });
      }
      if (err?.message === "invalid_min_app_version_android") {
        return res.status(400).json({
          error: "Versiunea minimă Android este invalidă. Folosește un număr întreg (ex. 4).",
        });
      }
      console.error("[dashboard/settings] POST error", err?.message || err);
      return res.status(500).json({ error: "Failed to update settings" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
