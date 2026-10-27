import * as React from "react";
import Header from "../../components/Header";
import { useRouter } from "next/router";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import { constantServices, menuOptions } from "../../data/servicesData";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../context/ApiContext";
import { collection, doc, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import Footer from "../../components/Footer";
import GoogleAdSenseBanner from "../../components/Ads/GoogleAdSenseBanner";
import { isAdsenseEnabled } from "../../lib/ads/config";


export async function getServerSideProps({ locale }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common"])),
    },
  };
}



const MediaCardConstantService = ({ item }) => {
  const { t: tCommon } = useTranslation("common");
  const route = useRouter();
  const [isMobile, setIsMobile] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      className="service-card"
      onClick={() => route.push(item.route)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.serviceCard,
        ...(isHovered ? styles.serviceCardHover : {}),
      }}
    >
      <div className="card-content" style={{
        ...styles.cardContent,
        ...(isHovered ? styles.cardContentHover : {}),
      }}>
        {/* Bottom overlay for text visibility */}
        <div style={{
          ...styles.bottomOverlay,
          ...(isHovered ? styles.bottomOverlayHover : {}),
        }}></div>
        
        {/* Service Title positioned at bottom */}
        <h3 style={{
          ...styles.serviceTitle,
          ...(isHovered ? styles.serviceTitleHover : {}),
        }}>
          {item.text}
        </h3>
      </div>
    </div>
  );
};

function MainDashboardTopAd() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID || "";
  const slotId =
    process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID || "";
  const canRequestAd = isAdsenseEnabled() && Boolean(clientId && slotId);

  if (!canRequestAd) return null;

  return (
    <>
      <div style={styles.adOuterWrap}>
        <div style={styles.adInnerWrap}>
          <p style={styles.adLabel}>Publicitate</p>
          <div style={styles.adSlotWrap}>
            <GoogleAdSenseBanner
              slot={slotId}
              shouldRequest={canRequestAd}
              className="mx-auto w-full"
              style={styles.adIns}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function Landing({ services }) {
  const { currentUser, isGuestUser } = useAuth();
  const {
    oreNorocoase,
    numereNorocoase,
    culoriNorocoase,
    citateMotivationale,
    categoriiViitor,
    cartiViitor,
    categoriiPersonalizate,
    cartiPersonalizate,
    loading,
    varianteCarti,
    error,
    fetchData,
    zilnicCitateMotivationale,
  } = useApiData();
  const { t } = useTranslation("common");
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const menuOptions = [
    { text: t("personalReading"), route: "/citire-personalizata" },
    { text: t("futureReading"), route: "/citire-viitor" },
    { text: t("luckyNumber"), route: "/numar-norocos" },
    { text: t("luckyColor"), route: "/culoare-norocoasa" },
    { text: t("luckyHours"), route: "/ora-norocoasa" },
    { text: t("motivationalQuotes"), route: "/citat-motivational" },
    { text: t("CeGandeste"), route: "/ce-gandeste" },
    { text: t("CeSimte"), route: "/ce-simte" },
    { text: t("CarteaTa"), route: "/cartea-ta" },
  ];

  const router = useRouter();

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://cristinazurba.com";

  const currentUrl = `${baseUrl}${router.asPath || ""}`;

  const handleAddToFirestore = async () => {
    const types = [
      { name: "CuloriNorocoase", arr: culoriNorocoase },
      // { name: "OreNorocoase", arr: oreNorocoase },
      // { name: "NumereNorocoase", arr: numereNorocoase },
      // { name: "CitateMotivationale", arr: citateMotivationale },
      // { name: "CategoriiViitor", arr: categoriiViitor },
      // { name: "CartiViitor", arr: cartiViitor },
      // { name: "CategoriiPersonalizate", arr: categoriiPersonalizate },
      // { name: "CartiPersonalizate", arr: cartiPersonalizate },
    ];
    console.log("culoriNorocoase..", culoriNorocoase);
    try {
      for (const type of types) {
        if (type.arr && type.arr.arr.length > 0) {
          console.log(`${type.name}.....xxx,,xxx...`, type.arr);

          const collectionName = type.name;
          const ref = doc(collection(db, collectionName));

          await setDoc(ref, type.arr);
          console.log(`Successfully added ${type.name} to Firestore.`);
        }
      }
    } catch (error) {
      console.error("Error adding data to Firestore:", error);
    }
  };

  React.useEffect(() => {
    // handleAddToFirestore();
  }, []);

  return (
    <>
      <Head>
        <title>Cristina Zurba</title>
        <meta
          name="description"
          content="Cristina Zurba is an interactive tarot card game website developed by well-known youtuber, tarot reader and astrologer Cristina Zurba."
        />
        <meta property="og:url" content={currentUrl} />
        <meta property="og:title" content="Cristina Zurba" />
        <meta
          property="og:description"
          content="Cristina Zurba is an interactive tarot card game website developed by well-known youtuber, tarot reader and astrologer Cristina Zurba."
        />
        <meta
          property="og:image"
          content="https://cristinazurba.com/images/social-share.jpg"
        />
        <meta name="format-detection" content="telephone=no" />
      </Head>
      
      {/* Main wrapper with unified design */}
      <div style={styles.mainWrapper}>
        {/* Header */}
        <section>
          <Header />
        </section>

        {/* Services Grid */}
        <section style={styles.servicesSection}>
          <div className="services-container" style={{...styles.servicesContainer, paddingTop: isMobile ? "10%" : "6%"}}>
            <MainDashboardTopAd />

            <div className="services-grid" style={styles.servicesGrid}>
              {menuOptions.map((item, index) => (
                <div key={index} style={styles.gridItem}>
                  <MediaCardConstantService item={item} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <section>
          <Footer />
        </section>
      </div>
    </>
  );
}

// Styles matching /consultatii design
const styles = {
  mainWrapper: {
    background: '#fafbfc',
    minHeight: '100vh',
    width: '100%',
  },
  servicesSection: {
    padding: '4rem 0 6rem 0',
    background: `
      radial-gradient(circle at 20% 20%, rgba(147, 51, 234, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 40% 60%, rgba(168, 85, 247, 0.02) 0%, transparent 50%)
    `,
    position: 'relative',
  },
  servicesContainer: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 20px',
  },
  adOuterWrap: {
    display: 'flex',
    justifyContent: 'center',
    margin: '0 auto 3rem auto',
    padding: '0 0.25rem',
    width: '100%',
  },
  adInnerWrap: {
    width: '100%',
    maxWidth: '860px',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    borderRadius: '24px',
    background: 'rgba(255, 255, 255, 0.88)',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
    padding: '1rem',
  },
  adLabel: {
    margin: '0 0 0.75rem 0',
    color: '#64748b',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    textAlign: 'center',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  adSlotWrap: {
    width: '100%',
    minHeight: '160px',
    borderRadius: '18px',
    border: '1px dashed rgba(148, 163, 184, 0.28)',
    background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.92) 0%, rgba(255, 255, 255, 0.96) 100%)',
    padding: '1rem',
  },
  adIns: {
    minHeight: '120px',
    width: '100%',
  },
  headerSection: {
    textAlign: 'center',
    marginBottom: '4rem',
  },
  mainTitle: {
    fontSize: '2.5rem',
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: '1rem',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  subtitle: {
    fontSize: '1.1rem',
    color: '#64748b',
    fontWeight: '400',
    margin: 0,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  servicesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 350px))',
    gap: '2.5rem',
    alignItems: 'start',
    justifyContent: 'center',
    '@media (max-width: 768px)': {
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 320px))',
      gap: '2rem',
    },
    '@media (max-width: 480px)': {
      gridTemplateColumns: '1fr',
      gap: '1.5rem',
    },
  },
  gridItem: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  serviceCard: {
    background: 'transparent',
    borderRadius: '24px',
    padding: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    width: '100%',
    border: 'none',
    textAlign: 'center',
    minHeight: '200px',
  },
  serviceCardHover: {
    transform: 'translateY(-8px)',
  },
  cardContent: {
    width: '100%',
    height: '240px',
    backgroundImage: `url('/floarea-vietii.jpg')`,
    backgroundSize: '100% auto',
    backgroundPosition: 'center 10%',
    backgroundRepeat: 'no-repeat',
    borderRadius: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 1.5rem 1rem 1.5rem',
    boxShadow: '0 4px 20px rgba(139, 92, 246, 0.15), 0 1px 3px rgba(139, 92, 246, 0.1)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    border: '1px solid rgba(139, 92, 246, 0.1)',
    position: 'relative',
    overflow: 'hidden',
  },
  cardContentHover: {
    transform: 'scale(1.05)',
    boxShadow: '0 12px 40px rgba(139, 92, 246, 0.4), 0 6px 16px rgba(139, 92, 246, 0.25)',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    background: 'linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.3) 30%, transparent 100%)',
    borderRadius: '0 0 20px 20px',
    pointerEvents: 'none',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  bottomOverlayHover: {
    background: 'linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.5) 40%, rgba(0, 0, 0, 0.2) 70%, transparent 100%)',
    height: '60%',
  },
  serviceTitle: {
    fontSize: '1.6rem',
    fontWeight: '700',
    color: '#ffffff',
    margin: 0,
    lineHeight: '1.3',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    textAlign: 'center',
    letterSpacing: '-0.02em',
    position: 'relative',
    zIndex: 1,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    textShadow: `
      -1px -1px 0 #000,
      1px -1px 0 #000,
      -1px 1px 0 #000,
      1px 1px 0 #000,
      -2px 0 0 #000,
      2px 0 0 #000,
      0 -2px 0 #000,
      0 2px 0 #000
    `,
  },
  serviceTitleHover: {
    fontSize: '1.7rem',
    textShadow: `
      -2px -2px 0 #000,
      2px -2px 0 #000,
      -2px 2px 0 #000,
      2px 2px 0 #000,
      -3px 0 0 #000,
      3px 0 0 #000,
      0 -3px 0 #000,
      0 3px 0 #000,
      0 0 8px rgba(255, 255, 255, 0.3)
    `,
    transform: 'translateY(-2px)',
  },
};



export default Landing;
