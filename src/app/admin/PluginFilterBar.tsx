"use client";

import { Search } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { genreName, type PluginFilter, type PluginOrigin } from "@/lib/worlds/plugin-filter";

// The genre picker's "no genre" row; Radix wants a real value for it.
const EVERY_GENRE = "any";

const ORIGINS: Array<{ value: PluginOrigin; label: string }> = [
  { value: "all", label: "All" },
  { value: "original", label: "Original" },
  { value: "fan", label: "Fan-made" },
];

// The plugin browser's filter row: a search, the genres the lists use, and
// original worlds against fan works. It filters both the download list and
// the installed one, so a server with a long shelf can find its own packs too.
export function PluginFilterBar({
  filter,
  onChange,
  genres,
}: {
  filter: PluginFilter;
  onChange: (next: PluginFilter) => void;
  genres: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter campaign plugins">
      <label className="relative min-w-[12rem] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder="Search by name, setting or author"
          aria-label="Search campaign plugins"
          className={cn(ui.input, "pl-8 text-xs")}
        />
      </label>
      {genres.length > 1 ? (
        <Select
          size="sm"
          label="Genre"
          value={filter.genre || EVERY_GENRE}
          onChange={(value) => onChange({ ...filter, genre: value === EVERY_GENRE ? "" : value })}
          options={[
            { value: EVERY_GENRE, label: "Every genre" },
            ...genres.map((genre) => ({ value: genre, label: genreName(genre) })),
          ]}
          className="w-40"
        />
      ) : null}
      <SegmentedControl
        size="sm"
        label="Original or fan-made"
        options={ORIGINS}
        value={filter.origin}
        onChange={(origin) => onChange({ ...filter, origin })}
      />
    </div>
  );
}
