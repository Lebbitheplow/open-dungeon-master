"use client";

import { useEffect, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { describeContentEntry, spellSummary } from "@/lib/help";
import { useContentSearch, type PickerEntry } from "@/app/characters/builder/useContentSearch";

// Search-and-pick over the content pack (/api/content/<kind>): spells,
// items, monsters, conditions. The list opens on focus with a browsable
// default and narrows as the person types; a pick hands the entry back and
// clears the box. Renders nothing when the pack is not installed, so the
// typed field beside it is all a bare server shows.
//
// Every row carries a ⓘ, reading the description off the row it already has,
// so a DM never has to add a spell to a stat block to find out what it does.
// The list is in the flow rather than absolutely positioned: these fields sit
// inside editor sheets that scroll, and an absolute list opening near the
// bottom of one is clipped away entirely.

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
    <div ref={container} className={className}>
      <div className="relative">
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
      </div>
      {open && !results.length && query.trim() && !loading ? (
        <p className="mt-1 rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-1.5 text-[11px] text-stone-500">
          Nothing matched &quot;{query.trim()}&quot;. Try fewer letters.
        </p>
      ) : null}
      {open && results.length ? (
        <ul className="panel panel-smoke mt-1 max-h-56 w-full overflow-y-auto rounded-lg">
          {results.slice(0, 40).map((entry) => (
            <li key={entry.slug} className="flex items-center gap-1 pr-2 hover:bg-stone-800">
              <button
                type="button"
                onClick={() => {
                  onPick(entry);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex grow items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
              >
                <span className={cn(entry.source === "homebrew" && "text-amber-300")}>{entry.name}</span>
                <span className="text-[11px] text-stone-500">
                  {entry.level !== undefined ? `level ${entry.level}` : entry.rarity || entry.kind || ""}
                </span>
              </button>
              <InfoButton
                label={entry.name}
                meta={kind === "spells" ? spellSummary(entry.data) : undefined}
                text={describeContentEntry(entry.data)}
                reference={
                  entry.source === "homebrew" ? undefined : { kind, slug: entry.slug, name: entry.name }
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
