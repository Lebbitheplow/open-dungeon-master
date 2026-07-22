"use client";

import { Check, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import { describeContentEntry, spellSummary } from "@/lib/help";
import { useContentSearch, type PickerEntry } from "./useContentSearch";

export type MultiPick = { name: string; slug?: string };

// Searchable multi-select against /api/content/[kind]: result rows toggle
// into a pending chip strip and one "Add" commits them all, so nobody has
// to know exact names in advance. A free-text row keeps homebrew possible
// and is the only path when the content pack is not installed. The results
// render inline (not absolutely positioned) so the picker works inside
// scrolling dialogs.
export default function MultiContentPicker({
  kind,
  extraParams = {},
  placeholder,
  selectedNames = [],
  onAdd,
  renderMeta,
}: {
  kind: "spells" | "items" | "feats";
  extraParams?: Record<string, string>;
  placeholder: string;
  // Names already on the sheet; shown checked and not re-addable.
  selectedNames?: string[];
  onAdd: (entries: MultiPick[]) => void;
  renderMeta?: (entry: PickerEntry) => string;
}) {
  const { query, setQuery, results, setResults, open, setOpen, loading, unavailable } =
    useContentSearch(kind, extraParams);
  const [pending, setPending] = useState<MultiPick[]>([]);
  const container = useRef<HTMLDivElement>(null);

  // The browse list opens on focus, so clicking elsewhere must collapse it
  // (pending chips stay put until added or removed).
  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [setOpen]);

  const selectedLower = new Set(selectedNames.map((name) => name.trim().toLowerCase()));
  const pendingLower = new Set(pending.map((pick) => pick.name.trim().toLowerCase()));
  const trimmedQuery = query.trim();

  function togglePending(entry: PickerEntry) {
    const key = entry.name.trim().toLowerCase();
    setPending((picks) =>
      picks.some((pick) => pick.name.trim().toLowerCase() === key)
        ? picks.filter((pick) => pick.name.trim().toLowerCase() !== key)
        : [...picks, { name: entry.name, slug: entry.slug }],
    );
  }

  function addCustom() {
    const key = trimmedQuery.toLowerCase();
    if (!key || selectedLower.has(key) || pendingLower.has(key)) {
      return;
    }
    setPending((picks) => [...picks, { name: trimmedQuery }]);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function commit() {
    if (!pending.length) {
      return;
    }
    onAdd(pending);
    setPending([]);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={container}>
      <div className="relative">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-stone-500" />
        ) : null}
      </div>
      {open && (results.length || trimmedQuery || unavailable) ? (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg panel panel-smoke">
          {results.map((entry) => {
            const key = entry.name.trim().toLowerCase();
            const alreadyOn = selectedLower.has(key);
            const picked = pendingLower.has(key);
            return (
              <li
                key={entry.slug}
                className={cn(
                  "flex items-center gap-1 pr-2 hover:bg-stone-800",
                  alreadyOn && "opacity-50",
                )}
              >
                <button
                  type="button"
                  disabled={alreadyOn}
                  onClick={() => togglePending(entry)}
                  className="flex grow items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <span className="flex items-center gap-1.5">
                    {picked || alreadyOn ? (
                      <Check className="size-3.5 shrink-0 text-amber-200" />
                    ) : (
                      <Plus className="size-3.5 shrink-0 text-stone-600" />
                    )}
                    <span className={cn(entry.source === "homebrew" && "text-amber-300")}>
                      {entry.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">
                    {alreadyOn
                      ? "already added"
                      : entry.source === "homebrew"
                        ? "homebrew"
                        : (renderMeta?.(entry) ?? "")}
                  </span>
                </button>
                <InfoButton
                  label={entry.name}
                  meta={kind === "spells" ? spellSummary(entry.data) : undefined}
                  text={describeContentEntry(entry.data)}
                  reference={entry.source === "homebrew" ? undefined : { kind, slug: entry.slug }}
                />
              </li>
            );
          })}
          {trimmedQuery &&
          !selectedLower.has(trimmedQuery.toLowerCase()) &&
          !results.some((entry) => entry.name.trim().toLowerCase() === trimmedQuery.toLowerCase()) ? (
            <li className="border-t border-stone-800">
              <button
                type="button"
                onClick={addCustom}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-amber-300 hover:bg-stone-800"
              >
                <Plus className="size-3.5 shrink-0" /> Add &quot;{trimmedQuery}&quot; as custom
              </button>
            </li>
          ) : null}
          {unavailable ? (
            <li className="px-3 py-1.5 text-xs text-stone-500">
              Content pack not installed; add entries by name instead.
            </li>
          ) : null}
        </ul>
      ) : null}
      {pending.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {pending.map((pick) => (
            <span
              key={pick.name}
              className="flex items-center gap-1 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-200"
            >
              {pick.name}
              <button
                type="button"
                onClick={() =>
                  setPending((picks) => picks.filter((entry) => entry.name !== pick.name))
                }
                aria-label={`Remove ${pick.name}`}
                className="text-stone-500 hover:text-red-400"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={commit}
            className="rounded-full bg-amber-300 px-2.5 py-0.5 text-xs font-medium text-stone-950 hover:bg-amber-200"
          >
            Add {pending.length}
          </button>
        </div>
      ) : null}
    </div>
  );
}
