import React, { useEffect, useRef, useState } from "react";
import type { VideoDoc, VideoSortDirection, VideoSortField } from "../types/video";
import { formatTimestamp } from "../utils/videoFormat";
import {
  formatVideoPublicReleaseMoment,
  resolveVideoReleasePhase,
} from "../../../../lib/videoReleaseSchedule";

function getReleaseStatus(video: VideoDoc) {
  const release = resolveVideoReleasePhase(video);
  if (release.phase === "scheduled" && release.hasDualRelease) {
    return {
      label: "Programat Premium",
      className: "bg-amber-50 text-amber-800 ring-amber-600/20",
    };
  }
  if (release.phase === "premium_early_access") {
    return {
      label: "Acces Premium",
      className: "bg-violet-50 text-violet-800 ring-violet-600/20",
    };
  }
  if (release.hasDualRelease && release.phase === "public") {
    return {
      label: "Public",
      className: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    };
  }
  if (release.phase === "premium") {
    return {
      label: "Premium permanent",
      className: "bg-violet-50 text-violet-800 ring-violet-600/20",
    };
  }
  if (release.phase === "scheduled") {
    return {
      label: video.isPremium ? "Programat Premium" : "Programat",
      className: "bg-amber-50 text-amber-800 ring-amber-600/20",
    };
  }
  return {
    label: "Public",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  };
}

function RowActionsMenu({
  video,
  isOpen,
  onToggle,
  onClose,
  onPreview,
  onEdit,
  onOpen,
  onCopy,
  onDelete,
}: {
  video: VideoDoc;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPreview: (v: VideoDoc) => void;
  onEdit: (v: VideoDoc) => void;
  onOpen: (v: VideoDoc) => void;
  onCopy: (v: VideoDoc) => void;
  onDelete: (v: VideoDoc) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const el = wrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      onClose();
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative flex justify-end" ref={wrapRef}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Acțiuni videoclip"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        onClick={onToggle}
      >
        <span className="text-lg leading-none" aria-hidden>
          ⋯
        </span>
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => {
              onPreview(video);
              onClose();
            }}
          >
            Test video
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700"
            onClick={() => {
              onEdit(video);
              onClose();
            }}
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={() => {
              onOpen(video);
              onClose();
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-amber-50 hover:text-amber-700"
            onClick={() => {
              onCopy(video);
              onClose();
            }}
          >
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
            onClick={() => {
              onDelete(video);
              onClose();
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  videos: VideoDoc[];
  loading?: boolean;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  sortField: VideoSortField;
  sortDirection: VideoSortDirection;
  onSortChange: (field: VideoSortField) => void;
  onEdit: (video: VideoDoc) => void;
  onDelete: (video: VideoDoc) => void;
  onTogglePublish: (video: VideoDoc, nextValue: boolean) => void;
  onOpen: (video: VideoDoc) => void;
  onCopy: (video: VideoDoc) => void;
  onPreview: (video: VideoDoc) => void;
};

export default function VideoTable({
  videos,
  loading = false,
  selectedIds,
  onSelectedIdsChange,
  sortField,
  sortDirection,
  onSortChange,
  onEdit,
  onDelete,
  onTogglePublish,
  onOpen,
  onCopy,
  onPreview,
}: Props) {
  const [actionsMenuVideoId, setActionsMenuVideoId] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selected = new Set(selectedIds);
  const allSelected = videos.length > 0 && videos.every((video) => selected.has(video.id));
  const someSelected = videos.some((video) => selected.has(video.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [allSelected, someSelected]);

  const toggleOne = (id: string) => {
    onSelectedIdsChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  const togglePage = () => {
    if (allSelected) {
      const visible = new Set(videos.map((video) => video.id));
      onSelectedIdsChange(selectedIds.filter((id) => !visible.has(id)));
      return;
    }
    onSelectedIdsChange([...new Set([...selectedIds, ...videos.map((video) => video.id)])]);
  };

  const getAriaSort = (field: VideoSortField): "ascending" | "descending" | "none" => {
    if (sortField !== field) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  };

  const getSortIndicator = (field: VideoSortField): string => {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  };

  const sortHeaderButtonClass =
    "inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:text-gray-900";

  if (videos.length === 0) {
    if (loading) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto inline-flex items-center gap-3 text-sm font-medium text-gray-700">
            <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Se încarcă videoclipurile...
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
        <div className="mx-auto max-w-md">
          <div className="text-lg font-semibold text-gray-900">Niciun videoclip</div>
          <div className="mt-2 text-sm text-gray-600">
            Adaugă primul videoclip și setează dacă este publicat în aplicație.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-700">
            <tr>
              <th className="w-12 px-4 py-4">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Selectează videoclipurile de pe pagină"
                  onChange={togglePage}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("order")}>
                <button
                  type="button"
                  onClick={() => onSortChange("order")}
                  className={sortHeaderButtonClass}
                >
                  <span>Ordine</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("order")}</span>
                </button>
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("title")}>
                <button
                  type="button"
                  onClick={() => onSortChange("title")}
                  className={sortHeaderButtonClass}
                >
                  <span>Titlu</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("title")}</span>
                </button>
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("platform")}>
                <button
                  type="button"
                  onClick={() => onSortChange("platform")}
                  className={sortHeaderButtonClass}
                >
                  <span>Platformă</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("platform")}</span>
                </button>
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("category")}>
                <button
                  type="button"
                  onClick={() => onSortChange("category")}
                  className={sortHeaderButtonClass}
                >
                  <span>Categorie</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("category")}</span>
                </button>
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">
                Vizualizări
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("publishAt")}>
                <button
                  type="button"
                  onClick={() => onSortChange("publishAt")}
                  className={sortHeaderButtonClass}
                >
                  <span>Publicare</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("publishAt")}</span>
                </button>
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("isPublished")}>
                <button
                  type="button"
                  onClick={() => onSortChange("isPublished")}
                  className={sortHeaderButtonClass}
                >
                  <span>Publicat</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("isPublished")}</span>
                </button>
              </th>
              <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-gray-700">
                Acces site
              </th>
              <th className="px-6 py-4" aria-sort={getAriaSort("createdAt")}>
                <button
                  type="button"
                  onClick={() => onSortChange("createdAt")}
                  className={sortHeaderButtonClass}
                >
                  <span>Creat</span>
                  <span className="text-[10px] text-gray-500">{getSortIndicator("createdAt")}</span>
                </button>
              </th>
              <th className="whitespace-nowrap px-3 py-4 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                Acțiuni
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {videos.map((video) => {
              const releaseStatus = getReleaseStatus(video);
              return (
              <tr key={video.id} className={`transition-colors hover:bg-gray-50 ${selected.has(video.id) ? "bg-red-50/60" : ""}`}>
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selected.has(video.id)}
                    aria-label={`Selectează ${video.title}`}
                    onChange={() => toggleOne(video.id)}
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                </td>
                <td className="px-6 py-4 text-gray-600">{video.order ?? "—"}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-gray-900">{video.title}</div>
                    {video.featuredOnHome ? (
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                        Evidențiat
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                    {video.platform === "bunny"
                      ? "Bunny"
                      : video.platform === "vimeo"
                        ? "Vimeo"
                        : "YouTube"}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {video.category ? (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300">
                      {video.category}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-gray-800">
                  {Number.isFinite(Number(video.viewsCount)) && Number(video.viewsCount) > 0
                    ? Math.floor(Number(video.viewsCount))
                    : 0}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {video.publishAt ? (
                    <div className="flex flex-col gap-1">
                      <span>T1: {formatTimestamp(video.publishAt)}</span>
                      {video.publicReleaseAt ? (
                        <span className="text-xs text-gray-500">
                          T2 public: {formatVideoPublicReleaseMoment(video.publicReleaseAt)}
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${releaseStatus.className}`}
                      >
                        {releaseStatus.label}
                      </span>
                    </div>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-300">
                      Activ
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => onTogglePublish(video, !video.isPublished)}
                    className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all ${
                      video.isPublished
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 hover:bg-emerald-100"
                        : "bg-gray-100 text-gray-700 ring-gray-300 hover:bg-gray-200"
                    }`}
                  >
                    {video.isPublished ? "Public" : "Ascuns"}
                  </button>
                </td>
                <td className="px-6 py-4 text-center">
                  {video.publicReleaseAt ? (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-600/15">
                      Premium → public
                    </span>
                  ) : video.isPremium === true ? (
                    <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-600/15">
                      Abonament site
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-600/15">
                      Teaser public
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-600">{formatTimestamp(video.createdAt)}</td>
                <td className="px-3 py-4">
                  <RowActionsMenu
                    video={video}
                    isOpen={actionsMenuVideoId === video.id}
                    onToggle={() =>
                      setActionsMenuVideoId((prev) => (prev === video.id ? null : video.id))
                    }
                    onClose={() => setActionsMenuVideoId(null)}
                    onPreview={onPreview}
                    onEdit={onEdit}
                    onOpen={onOpen}
                    onCopy={onCopy}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
