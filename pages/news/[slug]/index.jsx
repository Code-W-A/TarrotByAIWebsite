import React from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { CalendarDays, Clock, User, ArrowLeft, Share2, BookOpen, Tag } from "lucide-react";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer/SiteMap";
import { buildArticleHref } from "../../../utils/commonUtils";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import languageDetector from "../../../lib/languageDetector";
import { getYoutubeEmbedUrl } from "../../../utils/youtubeLinkUtils";
import { resolveServerApiBaseUrl } from "../../../lib/serverApiClient";
import {
  loadPublicArticleDetail,
  loadPublicArticles,
} from "../../../lib/publicArticles";
import ArticleAdSense from "../../../components/Ads/ArticleAdSense";
import PartnerPromoSlot from "../../../components/PartnerPromotions/PartnerPromoSlot";

const SIDEBAR_ARTICLES_LIMIT = 12;
function buildArticlesPreview(articlesData = []) {
  if (!Array.isArray(articlesData) || articlesData.length === 0) {
    return {
      articlesData: [],
      latestArticles: [],
      lastArticle: null,
      latestFiveArticles: [],
    };
  }
  const sortedArticles = [...articlesData];
  return {
    articlesData,
    latestArticles: sortedArticles.slice(0, 2),
    lastArticle: sortedArticles[0],
    latestFiveArticles: sortedArticles.slice(0, 5),
  };
}

export async function getServerSideProps(context) {
  try {
    const { locale, params, req } = context;
    const rawSlug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
    const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
    const slugPrefixId = slug ? slug.split("-")[0].trim() : "";
    const localeForApi = locale || "ro";

    let filteredArticle = null;
    let relatedArticles = [];
    if (slugPrefixId) {
      try {
        const detailPayload = await loadPublicArticleDetail({
          id: slugPrefixId,
          locale: localeForApi,
          relatedLimit: 2,
        });
        filteredArticle = detailPayload?.article || null;
        relatedArticles = Array.isArray(detailPayload?.related) ? detailPayload.related : [];
      } catch (error) {
        console.error("[news.detail] detail load failed", error?.message || error);
      }
    }

    const sidebarPayload = await loadPublicArticles({
      locale: localeForApi,
      limit: SIDEBAR_ARTICLES_LIMIT,
    }).catch((error) => {
      console.error("[news.detail] sidebar load failed", error?.message || error);
      return null;
    });
    let articlesData = Array.isArray(sidebarPayload?.articles) ? sidebarPayload.articles : [];

    // Ensure current article exists in sidebar payload even if not part of latest list.
    const hasCurrentInList =
      filteredArticle &&
      articlesData.some(
        (article) =>
          String(article?.documentId || article?.id || "") ===
          String(filteredArticle?.documentId || filteredArticle?.id || "")
      );
    if (filteredArticle && !hasCurrentInList) {
      articlesData = [filteredArticle, ...articlesData].slice(0, SIDEBAR_ARTICLES_LIMIT);
    }

    const baseUrl = resolveServerApiBaseUrl(req).replace(/\/$/, "");
    const localePrefix = locale && locale !== "ro" ? `/${locale}` : "";
    const currentUrl = `${baseUrl}${localePrefix}/news/${slug}`;

    // Add current URL to article
    if (filteredArticle) {
      filteredArticle.currentUrl = currentUrl;
    }

    return {
      props: {
        articles: buildArticlesPreview(articlesData),
        filteredArticle,
        relatedArticles,
        slug,
        ...(await serverSideTranslations(locale, ["common"])),
      },
    };
  } catch (error) {
    console.error("Eroare la preluarea datelor în slug:", error.message);
    return {
      props: {
        error: error.message,
        slug: "",
      },
    };
  }
}

function BlogDetail({ articles, filteredArticle, relatedArticles, error, slug }) {
  const router = useRouter();
  const { t, i18n } = useTranslation("common");
  const detectedLng = languageDetector.detect();

  React.useEffect(() => {
    if (filteredArticle || !router.isReady) return;
    const legacyId = Array.isArray(router.query?.id) ? router.query.id[0] : router.query?.id;
    if (typeof legacyId === "string" && legacyId.trim()) {
      const safeId = encodeURIComponent(legacyId.trim());
      const safeSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "article";
      router.replace(`/news/${safeId}-${safeSlug}`);
    }
  }, [filteredArticle, router, slug]);

  // Function to get article URL with proper language and slug
  const getArticleUrl = (article) => {
    const articleTitle = detectedLng === "hi" 
      ? article?.info?.hu?.nume 
      : detectedLng === "id" 
      ? article?.info?.ru?.nume 
      : article?.info?.[detectedLng]?.nume || article?.info?.ro?.nume || "untitled";
    
    return buildArticleHref(article, articleTitle);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">{t("error")}</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!filteredArticle) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">{t("articleNotFound")}</h1>
          <button 
            onClick={() => router.push("/news")}
            className="text-indigo-600 hover:text-indigo-800 font-medium"
          >
            {t("backToBlog")}
          </button>
        </div>
      </div>
    );
  }

  const shareUrl = filteredArticle.currentUrl;
  
  // Text for display on page (current language)
  const articleTitle = detectedLng === "hi" 
    ? filteredArticle?.info?.hu?.nume 
    : detectedLng === "id" 
    ? filteredArticle?.info?.ru?.nume 
    : filteredArticle?.info?.[detectedLng]?.nume || filteredArticle?.info?.ro?.nume || t("articleNotFound");
  
  const articleDescription = detectedLng === "hi" 
    ? filteredArticle?.info?.hu?.descriere 
    : detectedLng === "id" 
    ? filteredArticle?.info?.ru?.descriere 
    : filteredArticle?.info?.[detectedLng]?.descriere || filteredArticle?.info?.ro?.descriere || '';

  // 🇷🇴 Text for social media sharing (ALWAYS Romanian)
  const shareTitle = filteredArticle?.info?.ro?.nume || "Articol Blog - Cristina Zurba";
  const shareDescription = filteredArticle?.info?.ro?.descriere || "Descoperă ghidarea spirituală și dezvoltarea personală alături de Cristina Zurba.";

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: shareTitle, // 🇷🇴 Always use Romanian for sharing
        text: shareDescription, // 🇷🇴 Always use Romanian for sharing
        url: shareUrl,
      });
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert(t('linkCopiedToClipboard'));
    }
  };

  return (
    <>
      <Head>
        <title>{articleTitle} | Blog Cristina Zurba</title>
        <meta name="description" content={articleDescription} />
        <meta name="keywords" content="spiritual, tarot, dezvoltare personală, ghidare spirituală" />
        
        {/* Open Graph / Facebook - ALWAYS Romanian */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={shareTitle} />
        <meta property="og:description" content={shareDescription} />
        <meta property="og:url" content={shareUrl} />
        <meta property="og:image" content={filteredArticle?.image?.finalUri || '/icon.png'} />
        <meta property="og:site_name" content="Cristina Zurba - Ghid Spiritual" />
        
        {/* Twitter - ALWAYS Romanian */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={shareTitle} />
        <meta name="twitter:description" content={shareDescription} />
        <meta name="twitter:image" content={filteredArticle?.image?.finalUri || '/icon.png'} />
        
        {/* Article specific meta */}
        <meta property="article:published_time" content={filteredArticle?.firstUploadTimestamp} />
        <meta property="article:author" content="Cristina Zurba" />
        <meta property="article:section" content={detectedLng === "hi" 
          ? filteredArticle?.categorie?.info?.hu?.nume 
          : detectedLng === "id" 
          ? filteredArticle?.categorie?.info?.ru?.nume 
          : filteredArticle?.categorie?.info?.[detectedLng]?.nume || filteredArticle?.categorie?.info?.ro?.nume} />
        
        {/* Schema.org structured data - ALWAYS Romanian */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              "headline": shareTitle,
              "description": shareDescription,
              "image": filteredArticle?.image?.finalUri || '/icon.png',
              "author": {
                "@type": "Person",
                "name": "Cristina Zurba"
              },
              "publisher": {
                "@type": "Organization",
                "name": "Cristina Zurba - Ghid Spiritual",
                "logo": {
                  "@type": "ImageObject",
                  "url": "/icon.png"
                }
              },
              "datePublished": filteredArticle?.firstUploadTimestamp,
              "dateModified": filteredArticle?.firstUploadTimestamp,
              "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": shareUrl
              }
            })
          }}
        />
      </Head>

      <Header />

      {/* Hero Section with Breadcrumbs */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-700 pt-20 pb-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Breadcrumbs */}
          <nav className="flex mb-8" aria-label="Breadcrumb">
            <ol className="inline-flex items-center space-x-1 md:space-x-3">
              <li className="inline-flex items-center">
                <button 
                  onClick={() => router.push("/")}
                  className="inline-flex items-center text-sm font-medium text-white/80 hover:text-white transition-colors duration-300"
                >
                  <svg className="w-3 h-3 mr-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
                  </svg>
                  Acasă
                </button>
              </li>
              <li>
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-white/60" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                  </svg>
                  <button 
                    onClick={() => router.push("/news")}
                    className="ml-1 text-sm font-medium text-white/80 hover:text-white md:ml-2 transition-colors duration-300"
                  >
                    Blog
                  </button>
                </div>
              </li>
              <li>
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-white/60" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                  </svg>
                  <span className="ml-1 text-sm font-medium text-white md:ml-2 truncate max-w-32">
                    {articleTitle}
                  </span>
                </div>
              </li>
            </ol>
          </nav>

          {/* Back Button */}
          <button 
            onClick={() => router.push("/news")}
            className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 transition-colors duration-300"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToArticles")}
          </button>

          {/* Article Category */}
          {filteredArticle?.categorie?.info && (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full mb-4">
              <Tag className="w-4 h-4 text-white" />
              <span className="text-white font-medium text-sm">
                {detectedLng === "hi" 
                  ? filteredArticle?.categorie?.info?.hu?.nume 
                  : detectedLng === "id" 
                  ? filteredArticle?.categorie?.info?.ru?.nume 
                  : filteredArticle?.categorie?.info?.[detectedLng]?.nume || filteredArticle?.categorie?.info?.ro?.nume}
              </span>
            </div>
          )}

          {/* Article Title */}
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
            {articleTitle}
          </h1>

          {/* Article Meta */}
          <div className="flex flex-wrap items-center gap-6 text-white/80">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">Cristina Zurba</span>
            </div>
            {filteredArticle?.firstUploadDate && (
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4" />
                <span className="text-sm">{filteredArticle.firstUploadDate}</span>
              </div>
            )}
            {filteredArticle?.firstUploadtime && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="text-sm">{filteredArticle.firstUploadtime}</span>
              </div>
            )}
            <button 
              onClick={handleShare}
              className="flex items-center gap-2 hover:text-white transition-colors duration-300"
            >
              <Share2 className="w-4 h-4" />
              <span className="text-sm">Distribuie</span>
            </button>
          </div>
        </div>
      </div>
      {/* Main Content */}
      <div className="bg-gray-50 min-h-screen">
        <style jsx>{`
          .article-content p {
            color: #000000 !important;
          }
          .article-content div {
            color: #000000 !important;
          }
          .article-content span {
            color: #000000 !important;
          }
        `}</style>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            
            {/* Article Content */}
            <div className="lg:col-span-2">
              <div className="space-y-8">
                
                {/* Featured Image - Modern Design */}
                {filteredArticle?.image?.finalUri && (
                  <div className="relative group">
                    <div className="bg-white rounded-3xl shadow-xl overflow-hidden p-6">
                      <div className="relative aspect-[16/9] rounded-2xl overflow-hidden">
                        <img 
                          src={filteredArticle.image.finalUri} 
                          alt={articleTitle}
                          className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-900/30 via-transparent to-transparent"></div>
                        
                        {/* Floating Category Badge */}
                        {filteredArticle?.categorie?.info?.ro?.nume && (
                          <div className="absolute top-4 left-4">
                            <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg">
                              <span className="text-sm font-semibold text-gray-800">
                                {filteredArticle.categorie.info.ro.nume}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Article Description Card */}
                {articleDescription && (
                  <div className="bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 rounded-3xl shadow-xl p-8 border border-white/20">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <BookOpen className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-lg font-bold text-gray-900 mb-3">{t("whatArticleAbout")}</h2>
                        <p className="text-lg text-gray-700 leading-relaxed">
                          {articleDescription}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <PartnerPromoSlot placement="web_article_detail" className="my-6" />

                {/* Main Article Content */}
                <article className="bg-white rounded-3xl shadow-xl overflow-hidden">
                  <div className="p-8 md:p-12">
                    
                    {/* Content Header */}
                    <div className="border-b border-gray-100 pb-6 mb-8">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                          <BookOpen className="w-6 h-6 text-white" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">{t("articleContent")}</h2>
                      </div>
                      <div className="h-1 w-24 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"></div>
                    </div>

                    {/* Article Content with Better Typography */}
                    <div className="prose prose-lg prose-slate max-w-none prose-headings:text-gray-900 prose-headings:font-bold prose-p:text-gray-900 prose-p:leading-relaxed prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50 prose-blockquote:rounded-r-lg prose-blockquote:py-4 prose-blockquote:px-6">
                      {(detectedLng === "hi" 
                          ? filteredArticle?.info?.hu?.content 
                          : detectedLng === "id" 
                          ? filteredArticle?.info?.ru?.content 
                          : filteredArticle?.info?.[detectedLng]?.content || filteredArticle?.info?.ro?.content) ? (
                        <div 
                          className="article-content"
                          style={{
                            color: '#000000'
                          }}
                          dangerouslySetInnerHTML={{ 
                            __html: detectedLng === "hi" 
                              ? filteredArticle?.info?.hu?.content 
                              : detectedLng === "id" 
                              ? filteredArticle?.info?.ru?.content 
                              : filteredArticle?.info?.[detectedLng]?.content || filteredArticle?.info?.ro?.content
                          }}
                        />
                      ) : (
                        <div className="text-center py-16">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <BookOpen className="w-8 h-8 text-gray-400" />
                          </div>
                          <p className="text-gray-500 text-lg">
                            {t("articleContentNotAvailable")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </article>

                <ArticleAdSense
                  key={slug}
                  article={filteredArticle}
                  locale={detectedLng}
                />

                {/* YouTube Videos - Enhanced Design */}
                {filteredArticle?.youtubeLinks && filteredArticle.youtubeLinks.length > 0 && (
                  console.log('YouTube Links Found:', filteredArticle.youtubeLinks) || true
                ) && (
                  <div className="bg-white rounded-3xl shadow-xl p-8">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-pink-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                      </div>
                  
                    </div>
                    
                    <div className="grid grid-cols-1 gap-6">
                      {filteredArticle.youtubeLinks.map((link, index) => {
                        // Debug: log original link
                        console.log(`Processing YouTube link ${index + 1}:`, link);
                        
                        // Curăță link-ul de prefixul @ și alte caractere nedorite
                        const cleanLink = link.replace(/^@+/, '').trim();
                        console.log(`Cleaned link:`, cleanLink);
                        
                        const embedUrl = getYoutubeEmbedUrl(cleanLink);
                        console.log(`Generated embed URL:`, embedUrl);
                        
                        // Verifică dacă avem un URL valid de embed
                        if (!embedUrl) {
                          console.warn(`Invalid YouTube link: ${link} -> ${cleanLink}`);
                          return null;
                        }
                        
                        return (
                          <div key={index} className="group">
                            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-lg bg-gray-100">
                              <iframe
                                src={embedUrl}
                                title={`Video ${index + 1} - ${articleTitle}`}
                                className="w-full h-full"
                                allowFullScreen
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              />
                            </div>
                            <div className="mt-3 px-2">
                              <p className="text-sm text-gray-600">
                                {t("videoNumber") || "Video"} {index + 1} - {t("complementaryContentForArticle") || "Conținut complementar pentru articol"}
                              </p>
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}


              </div>


              {/* Related Articles */}
              {relatedArticles.length > 0 && (
                <div className="mt-12">
                  <div className="bg-white rounded-3xl shadow-xl p-8">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <BookOpen className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900">{t("similarArticles") || "Articole similare"}</h2>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {relatedArticles.map((article) => (
                        <div key={article.id} className="group cursor-pointer" onClick={() => router.push(getArticleUrl(article))}>
                          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl overflow-hidden transform transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl border border-gray-200">
                            {article?.image?.finalUri && (
                              <div className="relative h-56 overflow-hidden">
                                <img 
                                  src={article.image.finalUri} 
                                  alt={detectedLng === "hi" 
                                    ? article?.info?.hu?.nume 
                                    : detectedLng === "id" 
                                    ? article?.info?.ru?.nume 
                                    : article?.info?.[detectedLng]?.nume || article?.info?.ro?.nume || t("articleNotFound")}
                                  className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-110"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                              </div>
                            )}
                            <div className="p-8">
                              {/* Category Badge */}
                                                    {article?.categorie?.info && (
                        <div className="inline-flex items-center px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full mb-4">
                          {detectedLng === "hi" 
                            ? article?.categorie?.info?.hu?.nume 
                            : detectedLng === "id" 
                            ? article?.categorie?.info?.ru?.nume 
                            : article?.categorie?.info?.[detectedLng]?.nume || article?.categorie?.info?.ro?.nume}
                        </div>
                      )}
                              
                                                    <h3 className="font-bold text-gray-900 text-xl mb-3 group-hover:text-indigo-600 transition-colors duration-300 leading-tight">
                        {detectedLng === "hi" 
                          ? article?.info?.hu?.nume 
                          : detectedLng === "id" 
                          ? article?.info?.ru?.nume 
                          : article?.info?.[detectedLng]?.nume || article?.info?.ro?.nume || t("articleNotFound")}
                      </h3>
                      
                      <p className="text-gray-600 text-base leading-relaxed mb-6 line-clamp-3">
                        {detectedLng === "hi" 
                          ? article?.info?.hu?.descriere 
                          : detectedLng === "id" 
                          ? article?.info?.ru?.descriere 
                          : article?.info?.[detectedLng]?.descriere || article?.info?.ro?.descriere || ''}
                      </p>
                              
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  <CalendarDays className="w-4 h-4" />
                                  <span>{article?.firstUploadDate}</span>
                                </div>
                                
                                <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm group-hover:gap-3 transition-all duration-300">
                                  <span>{t("readMore")}</span>
                                  <ArrowLeft className="w-4 h-4 rotate-180 transform group-hover:translate-x-1 transition-transform duration-300" />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-8 space-y-8">
                
                {/* Latest Articles Widget */}
                <div className="bg-white rounded-2xl shadow-xl p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-6">{t("recentArticles")}</h3>
                  <div className="space-y-4">
                    {articles?.latestFiveArticles?.slice(0, 5).map((article) => (
                      <div key={article.id} className="group cursor-pointer" onClick={() => router.push(getArticleUrl(article))}>
                        <div className="flex gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors duration-300">
                          {article?.image?.finalUri && (
                            <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden">
                              <img 
                                src={article.image.finalUri} 
                                alt={detectedLng === "hi" 
                                  ? article?.info?.hu?.nume 
                                  : detectedLng === "id" 
                                  ? article?.info?.ru?.nume 
                                  : article?.info?.[detectedLng]?.nume || article?.info?.ro?.nume || t("articleNotFound")}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-gray-900 text-sm group-hover:text-indigo-600 transition-colors duration-300 line-clamp-2">
                              {detectedLng === "hi" 
                                ? article?.info?.hu?.nume 
                                : detectedLng === "id" 
                                ? article?.info?.ru?.nume 
                                : article?.info?.[detectedLng]?.nume || article?.info?.ro?.nume || t("articleNotFound")}
                            </h4>
                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                              <CalendarDays className="w-3 h-3" />
                              <span>{article?.firstUploadDate}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

             
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default BlogDetail;
