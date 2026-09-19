"use client";

import { ArrowDownAZ, Clock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

// Search, tag filter and a sort for every workshop list (docs/vtt-parity-
// implementation-plan.md section 10.9). The list hands over its items with
// a name, tags and a time; this returns the filtered, sorted slice and the
// controls to render above it. State is local to the list.

export type ListSort = "recent" | "name";

export type Listed = { name: string; tags?: string[]; updatedAt?: string };

export function useListControls<T extends Listed>(items: T[]) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<ListSort>("recent");
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const entry of item.tags ?? []) {
        counts.set(entry, (counts.get(entry) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  }, [items]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter(
      (item) =>
        (!needle || item.name.toLowerCase().includes(needle)) && (!tag || (item.tags ?? []).includes(tag)),
    );
    return [...filtered].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name),
    );
  }, [items, query, tag, sort]);
  return { query, setQuery, tag, setTag, sort, setSort, tags, shown, filtered: shown.length !== items.length };
}

export function ListControls({
  controls,
  placeholder = "Find by name",
  className,
}: {
  controls: ReturnType<typeof useListControls>;
  placeholder?: string;
  className?: string;
}) {
  const { query, setQuery, tag, setTag, sort, setSort, tags } = controls;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <label className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 w-40 rounded-md border border-stone-700 bg-stone-950 pl-7 pr-2 text-xs text-stone-200 outline-none focus:border-amber-500"
        />
      </label>
      {tags.length ? (
        <div data-pill-group="" className="reveal flex flex-wrap items-center gap-1">
          {tags.slice(0, 8).map((entry) => (
            <button data-on={tag === entry ? "" : undefined}
              key={entry}
              type="button"
              aria-pressed={tag === entry}
              onClick={() => setTag(tag === entry ? "" : entry)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px]",
                tag === entry ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400 hover:text-stone-200",
              )}
            >
              {entry}
            </button>
          ))}
        </div>
      ) : null}
      <div data-pill-group="" className="ml-auto flex items-center gap-1">
        <button data-on={sort === "recent" ? "" : undefined}
          type="button"
          aria-pressed={sort === "recent"}
          onClick={() => setSort("recent")}
          title="Newest first"
          className={cn("rounded-md border p-1", sort === "recent" ? "border-amber-700 text-amber-200" : "border-stone-700 text-stone-500")}
        >
          <Clock className="size-3.5" />
        </button>
        <button data-on={sort === "name" ? "" : undefined}
          type="button"
          aria-pressed={sort === "name"}
          onClick={() => setSort("name")}
          title="By name"
          className={cn("rounded-md border p-1", sort === "name" ? "border-amber-700 text-amber-200" : "border-stone-700 text-stone-500")}
        >
          <ArrowDownAZ className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
