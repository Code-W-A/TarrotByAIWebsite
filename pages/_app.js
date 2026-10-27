import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import appTheme from "../theme/appTheme";
import { AuthProvider } from "../context/AuthContext";
import ApiDataProvider from "../context/ApiContext";
import { NumberProvider } from "../context/NumberContext";
import { appWithTranslation, useTranslation } from "next-i18next";
import "./globals.css";
import { DatabaseProvider } from "../context/DatabaseContext";
import { useRouter } from "next/router";
import { useEffect } from "react";
import languageDetector from "../lib/languageDetector";
import { resolveUiLocale } from "../lib/siteLocales";
import LanguageSelectionDialog from "../components/LanguageSelectionDialog";
import PublicPageAd from "../components/Ads/PublicPageAd";
import AdsProviderScripts from "../components/Ads/AdsProviderScripts";
import { AdsEngagementProvider } from "../components/Ads/AdsEngagementContext";
import GoogleAnalytics from "../components/GoogleAnalytics";
import PremiumPriceChangeBanner from "../components/PremiumPriceChangeBanner";
import { useFirstVisit } from "../hooks/useFirstVisit";
import { initAccountSwitchMonitor } from "../utils/authUtils"; // 🚀 NEW: Import account switch monitor
import "../node_modules/bootstrap/dist/css/bootstrap.min.css";

// Load Bootstrap JavaScript only on client
if (typeof window !== "undefined") {
  require("bootstrap/dist/js/bootstrap");
}

// Import all required CSS
require("../client/assets/icons/fontawesome/css/fontawesome.min.css");
require("../client/assets/icons/fontawesome/css/all.min.css");
require("../client/assets/icons/feather/css/iconfont.css");
require("../client/assets/scss/main.scss");
require("../client/components/customstyleclient.css");
require("../client/assets/css/feather.css");
require("../styles/daily-components.css");

// Optional log filter for dev: keep console clean for Firestore read optimization
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const logFilterEnabled = process.env.NEXT_PUBLIC_LOG_FILTER !== "off";
  if (logFilterEnabled && !window.__FIRESTORE_LOG_FILTER__) {
    window.__FIRESTORE_LOG_FILTER__ = true;
    const allowlist = [
      "[CACHE",
      "📥 [CACHE",
      "🧩 [INFLIGHT",
      "📄 [PAGINATED",
      "✅ [PAGINATED",
      "[BlogArticoleAdmin]",
      "[AfirmatiiPozitive]",
      "[NotificariManuale]",
      "[DatabaseContext]",
      "[AUTH",
      "[GOOGLE_AUTH]",
      "[AUTH UTILS]",
      "[AUTH CONTEXT]",
    ];
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    const shouldAllow = (args) =>
      args.some((arg) =>
        typeof arg === "string" ? allowlist.some((key) => arg.includes(key)) : false
      );

    console.log = (...args) => {
      if (shouldAllow(args)) originalLog(...args);
    };
    console.info = (...args) => {
      if (shouldAllow(args)) originalInfo(...args);
    };
    console.debug = (...args) => {
      if (shouldAllow(args)) originalDebug(...args);
    };
  }
}

const defaultTheme = createTheme(appTheme("mainTheme", "light"));

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const { t, i18n } = useTranslation("common");
  
  // First visit detection for language selection dialog
  const { 
    showLanguageDialog, 
    isFirstVisit, 
    isLoading, 
    closeLanguageDialog, 
    resetFirstVisit 
  } = useFirstVisit();

  // Debug logging only in development or when explicitly enabled
  const shouldLog = process.env.NODE_ENV === 'development' || process.env.ENABLE_I18N_LOGS === 'true';

  if (shouldLog) {
    console.log('🚀 [CLIENT] MyApp initialized:', {
      currentLocale: router.locale,
      routerReady: router.isReady,
      i18nLanguage: i18n?.language,
      i18nIsInitialized: i18n?.isInitialized,
      hasTranslations: !!t('hello'),
      testTranslation: t('hello'),
      availableLanguages: i18n?.options?.resources ? Object.keys(i18n.options.resources) : 'none',
      timestamp: new Date().toISOString(),
      isVercel: !!process.env.VERCEL,
      environment: process.env.NODE_ENV
    });
  }

  useEffect(() => {
    // Only run on client-side to avoid hydration issues
    if (typeof window === 'undefined' || !router.isReady) return;
    
    try {
      const routingLocale = router.locale;
      const uiLocale = resolveUiLocale(routingLocale);
      const detectedLng = languageDetector.detect();

      if (shouldLog) {
        console.log('🔄 [CLIENT] Language sync:', {
          routingLocale,
          uiLocale,
          detectedLng,
          i18nLanguage: i18n?.language,
          needsSync: Boolean(i18n?.changeLanguage && i18n.language !== uiLocale),
        });
      }

      // i18next uses UI locale (English for video-only routing locales); URLs/API keep routing locale
      if (i18n?.changeLanguage && i18n.language !== uiLocale) {
        i18n.changeLanguage(uiLocale);
      }

      if (routingLocale) {
        localStorage.setItem("locale", routingLocale);
        languageDetector.cache(routingLocale);
      }

    } catch (error) {
      if (shouldLog) {
        console.error('❌ [CLIENT] Language sync failed:', error);
      }
    }
  }, [router.isReady, router.locale, i18n]); // Simplified dependencies

  // Expose reset function globally for debugging
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.resetLanguageSelection = resetFirstVisit;
    }
  }, [resetFirstVisit]);

  // 🚀 NEW: Initialize account switch monitor
  useEffect(() => {
    if (typeof window !== 'undefined') {
      initAccountSwitchMonitor();
    }
  }, []);

  const handleLanguageSelect = (language) => {
    if (shouldLog) {
      console.log('🌍 [LANGUAGE DIALOG] Language selected:', language);
    }
    closeLanguageDialog();
  };

  return (
    <DatabaseProvider>
      <AuthProvider>
        <ApiDataProvider>
          <NumberProvider>
            <CacheProvider value={createCache({ key: "css" })}>
              <ThemeProvider theme={defaultTheme}>
                <CssBaseline />
                <GoogleAnalytics />
                <AdsProviderScripts />
                
                {/* Language Selection Dialog for First Visit */}
                <LanguageSelectionDialog
                  isOpen={showLanguageDialog}
                  onClose={closeLanguageDialog}
                  onLanguageSelect={handleLanguageSelect}
                />
                
                {/* Loading Overlay for Better UX */}
                {isLoading && (
                  <div 
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      zIndex: 9999,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backdropFilter: 'blur(2px)'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '16px'
                    }}>
                      <div 
                        style={{
                          width: '40px',
                          height: '40px',
                          border: '4px solid #e5e7eb',
                          borderTop: '4px solid #667eea',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }}
                      />
                      <p style={{
                        color: '#6b7280',
                        fontSize: '14px',
                        margin: 0,
                        fontWeight: '500'
                      }}>
                        Preparing your experience...
                      </p>
                    </div>
                  </div>
                )}
                
                <AdsEngagementProvider>
                  <PremiumPriceChangeBanner />
                  <Component {...pageProps} />
                  <PublicPageAd />
                </AdsEngagementProvider>
                
                <style jsx global>{`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
              </ThemeProvider>
            </CacheProvider>
          </NumberProvider>
        </ApiDataProvider>
      </AuthProvider>
    </DatabaseProvider>
  );
}

export default appWithTranslation(MyApp);
