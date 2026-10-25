// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import { LANGUAGE_LABELS } from "../../../../data/constants";
import { requestVideoTranslation } from "../services/videoTranslation";
import { sortLocalesForVideoAdmin } from "../utils/videoAdminLocaleOrder";

export type ChapterDraft = {
  id: string;
  title: string;
  titles: Record<string, string>;
  startInput: string;
  endInput: string;
};

type Props = {
  open: boolean;
  initialChapter: ChapterDraft | null;
  localeIds: string[];
  onSave: (draft: ChapterDraft) => void;
  onClose: () => void;
  disabled?: boolean;
};

function createEmptyChapter(): ChapterDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    titles: { ro: "" },
    startInput: "0:00",
    endInput: "",
  };
}

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:bg-gray-50";

const labelClass = "text-xs font-medium text-gray-700";

export default function ChapterEditorDialog({
  open,
  initialChapter,
  localeIds,
  onSave,
  onClose,
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState<ChapterDraft>(createEmptyChapter());
  const [localError, setLocalError] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateMessage, setTranslateMessage] = useState("");

  const sortedLocales = useMemo(
    () => sortLocalesForVideoAdmin(localeIds.length > 0 ? localeIds : ["ro"]),
    [localeIds]
  );

  useEffect(() => {
    if (!open) return;
    setLocalError("");
    setTranslateMessage("");
    setDraft(initialChapter ? { ...initialChapter, titles: { ...initialChapter.titles } } : createEmptyChapter());
  }, [open, initialChapter]);

  const handleTitleRoChange = (value: string) => {
    setDraft((prev) => ({
      ...prev,
      title: value,
      titles: { ...prev.titles, ro: value },
    }));
  };

  const handleLocaleTitleChange = (locale: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      titles: { ...prev.titles, [locale]: value },
      title: locale === "ro" ? value : prev.title,
    }));
  };

  const generateChapterLocales = async () => {
    const baseTitle = (draft.titles.ro || draft.title || "").trim();
    if (!baseTitle) {
      setTranslateMessage("Completează titlul RO.");
      return;
    }
    setIsTranslating(true);
    setTranslateMessage("");
    let activeLocale = "";
    try {
      const nextTitles: Record<string, string> = { ...draft.titles, ro: baseTitle };
      for (const locale of sortedLocales) {
        if (locale === "ro") continue;
        activeLocale = locale;
        const translated = await requestVideoTranslation(baseTitle, locale);
        nextTitles[locale] = translated;
        setDraft((prev) => ({ ...prev, titles: { ...prev.titles, [locale]: translated } }));
      }
      setDraft((prev) => ({ ...prev, titles: nextTitles, title: baseTitle }));
      setTranslateMessage("Gata.");
    } catch (error) {
      const language = LANGUAGE_LABELS[activeLocale]?.denumire || activeLocale;
      setTranslateMessage(`Eșuat (${language}): ${error.message || "Serviciul de traducere nu este disponibil."} Traducerile reușite sunt păstrate.`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSave = () => {
    const title = (draft.titles.ro || draft.title || "").trim();
    const start = draft.startInput.trim();
    if (!title) {
      setLocalError("Titlul RO este obligatoriu.");
      return;
    }
    if (!start) {
      setLocalError("Start obligatoriu.");
      return;
    }
    onSave({
      ...draft,
      title,
      titles: { ...draft.titles, ro: title },
    });
    onClose();
  };

  const uiLocked = disabled || isTranslating;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="relative z-[101] flex h-auto max-h-[min(54vh,420px)] w-full max-w-[min(92vw,720px)] flex-col overflow-hidden p-0 sm:mx-0"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-gray-100 px-4 py-2">
          <DialogTitle className="text-sm font-semibold">
            {initialChapter ? "Editează capitol" : "Adaugă capitol"}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Start *</label>
              <input
                value={draft.startInput}
                onChange={(e) => setDraft((prev) => ({ ...prev, startInput: e.target.value }))}
                disabled={uiLocked}
                className={inputClass}
                placeholder="0:00"
              />
            </div>
            <div>
              <label className={labelClass}>Final</label>
              <input
                value={draft.endInput}
                onChange={(e) => setDraft((prev) => ({ ...prev, endInput: e.target.value }))}
                disabled={uiLocked}
                className={inputClass}
                placeholder="—"
              />
            </div>
            <div>
              <label className={labelClass}>Titlu RO *</label>
              <input
                value={draft.titles.ro ?? draft.title ?? ""}
                onChange={(e) => handleTitleRoChange(e.target.value)}
                disabled={uiLocked}
                className={inputClass}
                placeholder="Ex. Introducere"
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-800">Localizare</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void generateChapterLocales()}
                disabled={uiLocked}
              >
                {isTranslating ? "…" : "Generează"}
              </Button>
              {translateMessage ? (
                <span
                  className={`text-xs ${
                    translateMessage.includes("Eșuat") || translateMessage.includes("Completează")
                      ? "text-red-600"
                      : "text-emerald-600"
                  }`}
                >
                  {translateMessage}
                </span>
              ) : null}
            </div>

            <div className="mt-1.5 max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain pr-0.5">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {sortedLocales.map((locale) => (
                  <label key={locale} className="block min-w-0">
                    <span className="mb-0.5 block truncate text-[10px] font-semibold uppercase text-gray-500">
                      {(LANGUAGE_LABELS as Record<string, { denumire?: string }>)?.[locale]?.denumire ||
                        locale}
                    </span>
                    <input
                      value={draft.titles?.[locale] ?? (locale === "ro" ? draft.title : "")}
                      onChange={(e) => handleLocaleTitleChange(locale, e.target.value)}
                      disabled={uiLocked}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:bg-gray-50"
                      placeholder={locale}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={uiLocked}>
            Anulează
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={uiLocked}>
            Salvează
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
