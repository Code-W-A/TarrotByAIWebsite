import React from "react";
import Link from "next/link";

const ACCESS_OPTIONS = [
  { value: "all", labelKey: "videoLibraryAccessChipAll" },
  { value: "free", labelKey: "videoLibraryBadgeFree" },
  { value: "premium", labelKey: "videoLibraryAccessChipPremium" },
];

const chipInactiveClass =
  "inline-flex shrink-0 items-center rounded-full border border-violet-200/80 bg-violet-50/40 px-4 py-2 text-sm text-slate-700 transition duration-200 hover:border-violet-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

const chipActiveClass =
  "inline-flex shrink-0 items-center rounded-full border border-violet-500 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

function CategoryChipLink({ href, active, children }) {
  return (
    <Link href={href} className={active ? chipActiveClass : chipInactiveClass}>
      <span className="max-w-[11rem] truncate sm:max-w-[14rem]">{children}</span>
    </Link>
  );
}

export default function VideoLibraryFiltersToolbar({
  searchQuery,
  onSearchChange,
  loading = false,
  searchInputId = "video-library-search",
  accessFilter,
  onAccessFilterChange,
  categories = [],
  activeCategorySlug = null,
  t,
  className = "",
}) {
  return (
    <div className={`flex flex-col gap-5 ${className}`.trim()}>
      {/* Row 1: search + access type segmented control */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="w-full lg:max-w-md lg:flex-1">
          <label htmlFor={searchInputId} className="sr-only">
            {t("videoLibrarySearchLabel")}
          </label>
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              id={searchInputId}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              disabled={loading}
              placeholder={t("videoLibrarySearchPlaceholder")}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
            />
            {searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label={t("videoLibrarySearchClear")}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="flex w-full flex-col gap-2 lg:w-auto lg:items-end"
          role="group"
          aria-label={t("videoLibraryAccessSectionLabel")}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("videoLibraryAccessSectionLabel")}
          </span>
          <div className="w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:w-auto">
            <div className="inline-flex min-w-full rounded-xl border border-violet-100 bg-violet-50/50 p-1 sm:min-w-0">
              {ACCESS_OPTIONS.map(({ value, labelKey }) => {
                const active = accessFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onAccessFilterChange(value)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition duration-200 sm:px-4 sm:text-sm ${
                      active
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-white/80 hover:text-violet-700"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: category navigation chips */}
      {categories.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("videoLibraryCategoriesLabel")}
          </span>
          <div className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto pb-1 pl-4 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            <CategoryChipLink href="/videouri" active={activeCategorySlug === null}>
              {t("videoLibraryChipAll")}
            </CategoryChipLink>
            {categories.map((cat) => (
              <CategoryChipLink
                key={cat.slug}
                href={`/videouri/categorie/${cat.slug}`}
                active={activeCategorySlug === cat.slug}
              >
                {cat.label}
              </CategoryChipLink>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
