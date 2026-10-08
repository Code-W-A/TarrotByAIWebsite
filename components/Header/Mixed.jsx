import React, { useState, useEffect, Fragment } from "react";
import Logo from "../Logo";
import { useAuth } from "../../context/AuthContext";
import Link from "next/link";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import i18nextConfig from "../../next-i18next.config";
import { getLocaleAbbreviation, getLocaleNativeLabel } from "../../lib/localeFlags";
import { ebookSectionName } from "../Ebooks/sectionName";

// SVG Icons from the old navbar
const StarIcon = ({ style, className, ...props }) => (
  <svg
    style={style}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
  </svg>
);

const StyleIcon = ({ style, className, ...props }) => (
  <svg
    style={style}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
    <line x1="16" y1="8" x2="2" y2="22" />
    <line x1="17.5" y1="15" x2="9" y2="15" />
  </svg>
);

const PersonIcon = ({ style, className, ...props }) => (
  <svg
    style={style}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const NewspaperIcon = ({ style, className, ...props }) => (
  <svg
    style={style}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2z" />
    <path d="M10 6h8" />
    <path d="M10 10h8" />
    <path d="M10 14h8" />
    <path d="M10 18h8" />
  </svg>
);

function Mixed(props) {
  const [fixed, setFixed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  
  // 🚀 FIX: Cleanup pentru mobile menu state
  useEffect(() => {
    return () => {
      // Cleanup la demontarea componentei
      if (typeof document !== 'undefined') {
        document.body.classList.remove('mobile-menu-open');
      }
    };
  }, []);
  
  // 🚀 FIX: Închide mobile menu la resize pe desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && mobileMenuOpen) {
        setMobileMenuOpen(false);
        document.body.classList.remove('mobile-menu-open');
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileMenuOpen]);
  const [isDesktop, setIsDesktop] = useState(true);
  
  const { userData } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  // Check if we're on consultations or admin pages
  const isConsultationsPage = router.pathname.includes('/consultatii') || 
                             router.pathname.includes('/admin-consultatii') ||
                             router.pathname.includes('/calendar') ||
                             router.pathname.includes('/cont-client') ||
                             router.pathname.includes('/login-admin-consultatii') ||
                             router.pathname.includes('/facturi-client-consultatii') ||
                             router.pathname.includes('/categorii-consultatii');

  const languages = Object.fromEntries(
    (i18nextConfig.i18n?.locales ?? ["ro"]).map((locale) => [
      locale,
      {
        name: getLocaleNativeLabel(locale),
        abbreviation: getLocaleAbbreviation(locale),
      },
    ])
  );

  // Handle responsive breakpoints
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setIsDesktop(width >= 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle scroll for fixed header
  useEffect(() => {
    const handleScroll = () => {
      const scroll = window.pageYOffset;
      setFixed(scroll > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (languageDropdownOpen && !event.target.closest('.language-dropdown')) {
        setLanguageDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [languageDropdownOpen]);

  const handleMobileMenuToggle = () => {
    const newMenuState = !mobileMenuOpen;
    setMobileMenuOpen(newMenuState);
    
    // 🚀 FIX: Previne scroll-ul body-ului când mobile menu-ul este deschis
    if (typeof document !== 'undefined') {
      if (newMenuState) {
        document.body.classList.add('mobile-menu-open');
      } else {
        document.body.classList.remove('mobile-menu-open');
      }
    }
  };

  const handleLanguageChange = (locale) => {
    setLanguageDropdownOpen(false);
    router.push(router.asPath, router.asPath, { locale });
  };

  const currentLanguage = languages[router.locale] || languages['ro'];

  // Navigation items with modern icons
  const navItems = [
    {
      href: "/",
      label: t("home"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9,22 9,12 15,12 15,22"/>
        </svg>
      ),
      active: router.pathname === "/"
    },
    {
      href: "/about",
      label: t("about"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      ),
      active: router.pathname === "/about"
    },
    {
      href: "/consultatii",
      label: t("consultatii"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10,9 9,9 8,9"/>
        </svg>
      ),
      active: router.pathname === "/consultatii"
    },
    {
      href: "/news",
      label: t("blog"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2z"/>
          <path d="M6 6h4"/>
          <path d="M6 10h4"/>
          <path d="M6 14h4"/>
          <path d="M14 6h4"/>
          <path d="M14 10h4"/>
        </svg>
      ),
      active: router.pathname === "/news"
    },
    {
      href: "/videouri",
      label: t("videoLibraryNav"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      ),
      active: router.pathname === "/videouri"
    },
    // {
    //   href: "/inregistrari-descarcare",
    //   label: "Înregistrări",
    //   icon: (
    //     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    //       <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
    //       <path d="M12 12l-3-3m0 0l-3 3m3-3v12"/>
    //     </svg>
    //   ),
    //   active: router.pathname === "/inregistrari-descarcare"
    // }
  ];

  // Special navigation icons from old navbar
  if (process.env.NEXT_PUBLIC_EBOOKS_ENABLED === 'true') navItems.push({href:'/ebooks',label:ebookSectionName(router.locale),icon:<span>📖</span>,active:router.pathname.startsWith('/ebooks')});

  const specialNavItems = [
    // {
    //   href: "/main-dashboard",
    //   label: "Panel",
    //   icon: <StarIcon style={{ width: "16px", height: "16px" }} />,
    //   active: router.pathname === "/main-dashboard"
    // },
    {
      href: "/main-dashboard",
      label: t("personalReading"),
      icon: <StyleIcon style={{ width: "16px", height: "16px" }} />,
      active: router.pathname === "/main-dashboard"
    },
    {
      href: "/settings",
      label: t("settings"),
      icon: <PersonIcon style={{ width: "16px", height: "16px" }} />,
      active: router.pathname?.startsWith("/settings"),
    }
  ];

  return (
    <Fragment>
      <header style={{
        ...styles.header,
        ...(isConsultationsPage ? styles.headerWhite : {}),
        ...(fixed && (isConsultationsPage ? styles.headerWhiteFixed : styles.headerFixed))
      }}>
        <div style={styles.container}>
          <nav style={styles.navbar} className="navbar">
            {/* Logo Section */}
            <div style={styles.logoSection} className="logo-section">
              <Link href="/" style={styles.logoLink}>
                <Logo type="landscape" fixed={fixed} noLink={true} />
              </Link>
              {userData && isDesktop && (
                <span style={{
                  ...styles.userGreeting,
                  color: isConsultationsPage ? '#333' : 'white'
                }}>
                  {t("helloUser")}, {userData.first_name}!
                </span>
              )}
            </div>

            {/* Desktop Navigation */}
            {isDesktop && (
              <div style={styles.navMenu}>
                {navItems.map((item, index) => (
                  <Link
                    key={index}
                    href={item.href}
                    style={{
                      ...styles.navItem,
                      ...(item.active && styles.navItemActive),
                      color: isConsultationsPage 
                        ? (item.active ? '#667eea' : '#333')
                        : (item.active ? '#FFD700' : 'white')
                    }}
                  >
                    <span style={styles.navIcon}>{item.icon}</span>
                    <span style={styles.navLabel}>{item.label}</span>
                  </Link>
                ))}
                
                {/* Special Navigation Icons */}
                <div style={styles.specialNavSeparator}></div>
                {specialNavItems.map((item, index) => (
                  <Link
                    key={`special-${index}`}
                    href={item.href}
                    style={{
                      ...styles.specialNavItem,
                      ...(item.active && styles.specialNavItemActive),
                      color: isConsultationsPage 
                        ? (item.active ? '#667eea' : '#333')
                        : (item.active ? '#FFD700' : 'white')
                    }}
                  >
                    <span style={styles.specialNavIcon}>{item.icon}</span>
                    <span style={styles.specialNavLabel}>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}

            {/* Right Section - Language Dropdown, Store Links & Mobile Menu */}
            <div style={styles.rightSection} className="header-right-section">
              {/* Language Dropdown */}
              <div className="language-dropdown" style={styles.languageDropdown}>
                <button
                  onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  style={{
                    ...styles.languageButton,
                    color: isConsultationsPage ? '#333' : 'white',
                    backgroundColor: isConsultationsPage 
                      ? 'rgba(0, 0, 0, 0.1)' 
                      : 'rgba(255, 255, 255, 0.1)',
                    borderColor: isConsultationsPage 
                      ? 'rgba(0, 0, 0, 0.2)' 
                      : 'rgba(255, 255, 255, 0.2)'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = isConsultationsPage 
                      ? 'rgba(0, 0, 0, 0.15)' 
                      : 'rgba(255, 255, 255, 0.15)';
                    e.target.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = isConsultationsPage 
                      ? 'rgba(0, 0, 0, 0.1)' 
                      : 'rgba(255, 255, 255, 0.1)';
                    e.target.style.transform = 'translateY(0)';
                  }}
                  aria-label="Change language"
                >
                  <span style={styles.langAbbrBadge}>{currentLanguage.abbreviation}</span>
                  {isDesktop && <span style={styles.languageText}>{currentLanguage.name}</span>}
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                    style={{
                      ...styles.dropdownArrow,
                      transform: languageDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                    }}
                  >
                    <polyline points="6,9 12,15 18,9"/>
                  </svg>
                </button>
                
                {languageDropdownOpen && (
                  <div style={{
                    ...styles.languageDropdownMenu,
                    opacity: 1,
                    visibility: 'visible',
                    transform: 'translateY(0)'
                  }}>
                    {Object.entries(languages).map(([locale, lang]) => (
                      <button
                        key={locale}
                        onClick={() => handleLanguageChange(locale)}
                        style={{
                          ...styles.languageOption,
                          ...(router.locale === locale && styles.languageOptionActive)
                        }}
                        onMouseEnter={(e) => {
                          if (router.locale !== locale) {
                            e.target.style.backgroundColor = 'rgba(102, 126, 234, 0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (router.locale !== locale) {
                            e.target.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <span style={styles.languageOptionText}>{lang.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Store Links */}
              <div style={styles.storeLinks} className="store-links">
                <a 
                  href="https://play.google.com/store/apps/details?id=com.cristina.zurba.tarot"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.storeLink}
                  className="store-link"
                >
                  <img src="/gplay.png" alt="Google Play" style={styles.storeIcon} />
                  {isDesktop && <span style={styles.storeText}>{t("android")}</span>}
                </a>
                <a 
                  href="https://apps.apple.com/ro/app/cristina-zurba/id6475713937"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.storeLink}
                  className="store-link"
                >
                  <img src="/appstore.png" alt="App Store" style={styles.storeIcon} />
                  {isDesktop && <span style={styles.storeText}>{t("ios")}</span>}
                </a>
              </div>

              {/* Mobile Menu Toggle */}
              {!isDesktop && (
                <button
                  onClick={handleMobileMenuToggle}
                  style={{
                    ...styles.mobileMenuButton,
                    color: isConsultationsPage ? '#333' : (fixed ? '#333' : 'white')
                  }}
                  className="mobile-menu-button"
                  aria-label="Toggle menu"
                >
                  <div style={styles.hamburgerIcon}>
                    <span style={{
                      ...styles.hamburgerLine,
                      backgroundColor: isConsultationsPage ? '#333' : 'white',
                      ...(mobileMenuOpen && styles.hamburgerLine1Active)
                    }} />
                    <span style={{
                      ...styles.hamburgerLine,
                      backgroundColor: isConsultationsPage ? '#333' : 'white',
                      ...(mobileMenuOpen && styles.hamburgerLine2Active)
                    }} />
                    <span style={{
                      ...styles.hamburgerLine,
                      backgroundColor: isConsultationsPage ? '#333' : 'white',
                      ...(mobileMenuOpen && styles.hamburgerLine3Active)
                    }} />
                  </div>
                </button>
              )}
            </div>
          </nav>
        </div>

        {/* Mobile Menu Dropdown */}
        {!isDesktop && (
          <div style={{
            ...styles.mobileMenu,
            ...(mobileMenuOpen && styles.mobileMenuOpen)
          }}>
            <div style={styles.mobileMenuContent}>
              {/* 🚀 FIX: Adaug buton de închidere explicit pentru mobile menu */}
              <div style={styles.mobileMenuHeader}>
                <div style={styles.mobileMenuTitle}>
                  {t("menu") || "Meniu"}
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  style={styles.mobileCloseButton}
                  className="mobile-close-button"
                  aria-label="Închide meniul"
                >
                  <span style={styles.closeIcon}>✕</span>
                </button>
              </div>
              
              {userData && (
                <div style={styles.mobileUserGreeting}>
                  {t("helloUser")}, {userData.first_name}!
                </div>
              )}
              {navItems.map((item, index) => (
                <Link
                  key={index}
                  href={item.href}
                  style={{
                    ...styles.mobileNavItem,
                    ...(item.active && styles.mobileNavItemActive)
                  }}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span style={styles.mobileNavIcon}>{item.icon}</span>
                  <span style={styles.mobileNavLabel}>{item.label}</span>
                </Link>
              ))}
              
              {/* Special Navigation Items in Mobile */}
              <div style={styles.mobileSeparator}></div>
              {specialNavItems.map((item, index) => (
                <Link
                  key={`mobile-special-${index}`}
                  href={item.href}
                  style={{
                    ...styles.mobileNavItem,
                    ...(item.active && styles.mobileNavItemActive)
                  }}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span style={styles.mobileNavIcon}>{item.icon}</span>
                  <span style={styles.mobileNavLabel}>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>
    </Fragment>
  );
}

const styles = {
  header: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    background: "linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%)",
    backdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    zIndex: 1000,
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    boxShadow: "0 4px 32px rgba(102, 126, 234, 0.2)",
  },
  headerWhite: {
    background: "rgba(255, 255, 255, 0.98)",
    borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
    boxShadow: "0 4px 32px rgba(0, 0, 0, 0.1)",
  },
  headerFixed: {
    background: "linear-gradient(135deg, rgba(102, 126, 234, 0.98) 0%, rgba(118, 75, 162, 0.98) 100%)",
    backdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 4px 32px rgba(102, 126, 234, 0.25)",
  },
  headerWhiteFixed: {
    background: "rgba(255, 255, 255, 0.98)",
    borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
    boxShadow: "0 4px 32px rgba(0, 0, 0, 0.1)",
  },
  container: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "0 20px",
  },
  navbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "70px",
    gap: "1rem",
    flexWrap: "nowrap",
  },
  
  // Logo Section
  logoSection: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flex: "0 0 auto",
    minWidth: "200px",
  },
  logoLink: {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    transition: "transform 0.2s ease",
  },
  userGreeting: {
    fontSize: "12px",
    fontWeight: "500",
    opacity: 0.9,
    whiteSpace: "nowrap",
  },
  
  // Desktop Navigation
  navMenu: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    flex: "1 1 auto",
    justifyContent: "center",
    flexWrap: "nowrap",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "10px 12px",
    borderRadius: "10px",
    textDecoration: "none",
    fontSize: "13px",
    fontWeight: "500",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    position: "relative",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  navItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    backdropFilter: "blur(10px)",
    transform: "translateY(-2px)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
  },
  navIcon: {
    display: "flex",
    alignItems: "center",
    transition: "transform 0.2s ease",
  },
  navLabel: {
    transition: "all 0.2s ease",
  },
  
  // Special Navigation Items
  specialNavSeparator: {
    width: "1px",
    height: "25px",
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    margin: "0 0.5rem",
  },
  specialNavItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "8px 10px",
    borderRadius: "8px",
    textDecoration: "none",
    fontSize: "12px",
    fontWeight: "500",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    position: "relative",
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    whiteSpace: "nowrap",
  },
  specialNavItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    backdropFilter: "blur(10px)",
    transform: "translateY(-2px)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
  },
  specialNavIcon: {
    display: "flex",
    alignItems: "center",
    transition: "transform 0.2s ease",
  },
  specialNavLabel: {
    transition: "all 0.2s ease",
    fontSize: "12px",
    fontWeight: "600",
  },
  
  // Right Section - 🚀 FIX: Îmbunătățit pentru mobile
  rightSection: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flex: "0 0 auto",
    minWidth: 0, // Permite shrinking când e necesar
    overflow: "visible", // Asigură că dropdown-urile nu sunt tăiate
    maxWidth: "none", // Permite flexibilitate
    '@media (max-width: 768px)': {
      maxWidth: "50%",
      gap: "0.25rem",
    },
    '@media (max-width: 480px)': {
      maxWidth: "40%",
      gap: "0.2rem",
    },
    '@media (max-width: 360px)': {
      maxWidth: "30%",
    },
  },
  
  // Language Dropdown
  languageDropdown: {
    position: "relative",
  },
  languageButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "none",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    padding: "8px 12px",
    cursor: "pointer",
    borderRadius: "10px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  langAbbrBadge: {
    minWidth: "28px",
    height: "22px",
    padding: "0 6px",
    borderRadius: "4px",
    border: "1px solid rgba(255, 255, 255, 0.35)",
    fontSize: "11px",
    fontWeight: "700",
    lineHeight: "20px",
    textAlign: "center",
  },
  languageText: {
    fontSize: "12px",
    fontWeight: "500",
  },
  dropdownArrow: {
    transition: "transform 0.2s ease",
    marginLeft: "0.25rem",
  },
  languageDropdownMenu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: "200px",
    background: "rgba(255, 255, 255, 0.98)",
    backdropFilter: "blur(20px)",
    borderRadius: "12px",
    boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    padding: "8px",
    zIndex: 1000,
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    opacity: 0,
    visibility: "hidden",
    transform: "translateY(-10px)",
  },
  languageOption: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "10px 12px",
    width: "100%",
    background: "none",
    border: "none",
    borderRadius: "8px",
    color: "#333",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  languageOptionActive: {
    backgroundColor: "rgba(102, 126, 234, 0.15)",
    color: "#667eea",
    fontWeight: "600",
  },
  languageOptionText: {
    fontSize: "14px",
    fontWeight: "inherit",
  },
  storeLinks: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  storeLink: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "6px 8px",
    borderRadius: "8px",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    color: "white",
    textDecoration: "none",
    fontSize: "11px",
    fontWeight: "500",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    whiteSpace: "nowrap",
  },
  storeIcon: {
    width: "16px",
    height: "16px",
    borderRadius: "3px",
  },
  storeText: {
    color: "white",
    fontSize: "10px",
    fontWeight: "500",
  },
  
  // Mobile Menu Button - 🚀 FIX: Îmbunătățit pentru touch
  mobileMenuButton: {
    background: "none",
    border: "none",
    padding: "10px", // Mărit pentru touch
    cursor: "pointer",
    borderRadius: "8px",
    transition: "all 0.2s ease",
    minWidth: "44px", // Minim recomandat pentru touch
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  hamburgerIcon: {
    width: "24px",
    height: "18px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  hamburgerLine: {
    width: "100%",
    height: "2px",
    borderRadius: "2px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    transformOrigin: "center",
  },
  hamburgerLine1Active: {
    transform: "rotate(45deg) translate(5px, 5px)",
  },
  hamburgerLine2Active: {
    opacity: 0,
    transform: "scaleX(0)",
  },
  hamburgerLine3Active: {
    transform: "rotate(-45deg) translate(7px, -6px)",
  },
  
  // Mobile Menu
  mobileMenu: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "linear-gradient(135deg, rgba(102, 126, 234, 0.98) 0%, rgba(118, 75, 162, 0.98) 100%)",
    backdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    transform: "translateY(-100%)",
    opacity: 0,
    visibility: "hidden",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  mobileMenuOpen: {
    transform: "translateY(0)",
    opacity: 1,
    visibility: "visible",
  },
  mobileMenuContent: {
    padding: "1rem 20px 2rem 20px",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  
  // 🚀 FIX: Stiluri pentru header-ul mobile menu cu buton de închidere
  mobileMenuHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.5rem",
    paddingBottom: "1rem",
    borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
  },
  mobileMenuTitle: {
    color: "white",
    fontSize: "18px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  mobileCloseButton: {
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: "8px",
    padding: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "40px",
    minHeight: "40px",
  },
  closeIcon: {
    color: "white",
    fontSize: "16px",
    fontWeight: "bold",
    lineHeight: 1,
  },
  mobileUserGreeting: {
    color: "white",
    fontSize: "16px",
    fontWeight: "600",
    marginBottom: "1.5rem",
    padding: "0 16px",
    opacity: 0.9,
  },
  mobileNavItem: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "16px",
    borderRadius: "12px",
    textDecoration: "none",
    color: "white",
    fontSize: "16px",
    fontWeight: "500",
    marginBottom: "0.5rem",
    transition: "all 0.3s ease",
    border: "1px solid transparent",
  },
  mobileNavItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderColor: "rgba(255, 255, 255, 0.3)",
    color: "#FFD700",
  },
  mobileNavIcon: {
    display: "flex",
    alignItems: "center",
  },
  mobileNavLabel: {
    fontSize: "16px",
    fontWeight: "500",
  },
  mobileSeparator: {
    height: "1px",
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    margin: "1rem 0",
  },
};

// CSS hover effects and responsive styles are handled in global styles

Mixed.defaultProps = {
  home: false,
};

export default Mixed;

// 🚀 FIX: Adaug stiluri globale pentru responsive navbar
if (typeof window !== 'undefined') {
  const globalStyles = `
    /* Responsive fixes pentru navbar */
    @media (max-width: 480px) {
      .header-right-section .language-dropdown {
        display: none !important;
      }
      
      .header-right-section {
        gap: 0.25rem !important;
      }
      
      .store-links {
        gap: 0.25rem !important;
      }
      
      .store-link span {
        display: none !important;
      }
      
      .mobile-menu-button {
        margin-left: 0.25rem;
        min-width: 44px !important;
        min-height: 44px !important;
      }
    }
    
    @media (max-width: 360px) {
      .header-right-section .store-links {
        display: none !important;
      }
    }
    
    /* Hover effects pentru mobile close button */
    .mobile-close-button:hover {
      background-color: rgba(255, 255, 255, 0.2) !important;
      transform: scale(1.05);
    }
  `;
  
  // Adaugă stilurile în head dacă nu există deja
  if (!document.querySelector('#navbar-responsive-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'navbar-responsive-styles';
    styleElement.innerHTML = globalStyles;
    document.head.appendChild(styleElement);
  }
}
