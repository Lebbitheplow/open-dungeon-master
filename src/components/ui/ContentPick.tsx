"use client";

import { useEffect, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useContentSearch, type PickerEntry } from "@/app/characters/builder/useContentSearch";

// Search-and-pick over the content pack (/api/content/<kind>): spells,
// items, monsters, conditions. The list opens on focus with a browsable
// default and narrows as the person types; a pick hands the entry back and
// clears the box. Renders nothing when the pack is not installed, so the
// typed field beside it is all a bare server shows.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

export function ContentPick({
  kind,
  placeholder,
  label,
  onPick,
  className,
  extraParams,
}: {
  kind: "spells" | "items" | "monsters" | "conditions" | "feats";
  placeholder: string;
  label: string;
  onPick: (entry: PickerEntry) => void;
  className?: string;
  extraParams?: Record<string, string>;
}) {
  const { query, setQuery, results, open, setOpen, loading, unavailable } = useContentSearch(
    kind,
    extraParams ?? {},
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

  if (unavailable) return null;

  return (
    <div ref={container} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(input, "w-full pl-7")}
      />
      {loading ? (
        <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-stone-500" />
      ) : null}
      {open && results.length ? (
        <ul className="panel panel-smoke absolute left-0 top-full z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg">
          {results.slice(0, 40).map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                onClick={() => {
                  onPick(entry);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-800"
              >
                <span className={cn(entry.source === "homebrew" && "text-amber-300")}>{entry.name}</span>
                <span className="text-[11px] text-stone-500">
                  {entry.level !== undefined ? `level ${entry.level}` : entry.rarity || entry.kind || ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
