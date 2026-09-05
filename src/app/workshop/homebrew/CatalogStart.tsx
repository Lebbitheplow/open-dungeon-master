"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useContentSearch, type PickerEntry } from "@/app/characters/builder/useContentSearch";
import { CLASS_IDS, input, type EditorKind } from "@/app/workshop/homebrew/types";

// "Start from": a search over the content pack that hands back a row to
// copy into the draft. Pick, do not type: a DM changing one number on an
// SRD spell should not have to retype the other nine fields.

const CONTENT_KIND: Record<EditorKind, string> = {
  item: "items",
  spell: "spells",
  feat: "feats",
  background: "backgrounds",
  race: "races",
  archetype: "archetypes",
};

export function CatalogStart({
  kind,
  onPick,
}: {
  kind: EditorKind;
  onPick: (entry: PickerEntry, extra: { classSlug?: string }) => void;
}) {
  const [classSlug, setClassSlug] = useState<string>("fighter");
  const extra: Record<string, string> = kind === "archetype" ? { class: classSlug } : {};
  const { query, setQuery, results, open, setOpen, loading, unavailable } = useContentSearch(
    CONTENT_KIND[kind],
    extra,
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

  if (unavailable) {
    return null;
  }

  return (
    <div ref={container} className="relative flex flex-wrap items-center gap-1.5">
      {kind === "archetype" ? (
        <select value={classSlug} aria-label="Class to browse" onChange={(event) => setClassSlug(event.target.value)} className={input}>
          {CLASS_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : null}
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Start from something in the books..."
          aria-label="Search the content pack to start from"
          className={cn(input, "w-full pl-7")}
        />
        {loading ? <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-stone-500" /> : null}
      </div>
      {open && results.length ? (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto panel panel-smoke rounded-lg">
          {results.slice(0, 40).map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                onClick={() => {
                  onPick(entry, { classSlug });
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
