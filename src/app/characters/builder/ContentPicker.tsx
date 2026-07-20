"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useContentSearch, type PickerEntry } from "./useContentSearch";

export type { PickerEntry } from "./useContentSearch";

// Debounced search-and-add against /api/content/[kind]. Used for spells,
// items, and feats in the character builder.
export default function ContentPicker({
  kind,
  extraParams = {},
  placeholder,
  onPick,
  renderMeta,
}: {
  kind: "spells" | "items" | "feats";
  extraParams?: Record<string, string>;
  placeholder: string;
  onPick: (entry: PickerEntry) => void;
  renderMeta?: (entry: PickerEntry) => string;
}) {
  const { query, setQuery, results, setResults, open, setOpen, loading } = useContentSearch(
    kind,
    extraParams,
  );
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [setOpen]);

  return (
    <div ref={container} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (!next.trim()) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-stone-500" />
        ) : null}
      </div>
      {open && results.length ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto panel rounded-lg">
          {results.map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                onClick={() => {
                  onPick(entry);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-stone-800"
              >
                <span className="flex items-center gap-1.5">
                  <Plus className="size-3.5 shrink-0 text-amber-200" />
                  <span
                    className={cn(entry.source === "homebrew" && "text-amber-300")}
                  >
                    {entry.name}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-stone-500">
                  {entry.source === "homebrew"
                    ? "homebrew"
                    : (renderMeta?.(entry) ?? "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
