"use client";

import { useState } from "react";
import { Pin, Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { CATEGORY_LABELS, type LoreEntryView } from "@/app/workshop/lore/types";

// The workshop's world lore as full-width rows: the title, whether it is
// pinned into every DM turn, its category, its tags, and the first line of
// what is established. A search box over title, body and tags sits above,
// because a world bible past twenty entries is read by searching, not by
// scrolling. Tapping a row hands the entry to the caller, which opens the
// editor; the last row starts a new one.
//
// The categories the campaign list groups by become a chip on each row, so
// a row still says what kind of thing it is once search has mixed them.

function matches(entry: LoreEntryView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [entry.title, entry.body, ...entry.tags].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

function firstLine(body: string): string {
  return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function LoreRows({
  entries,
  steersStory,
  onOpen,
  onNew,
}: {
  entries: LoreEntryView[];
  steersStory: boolean;
  onOpen: (entry: LoreEntryView) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = entries.filter((entry) => matches(entry, query));

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the lore"
          aria-label="Search the lore by title, body or tag"
          className={`${ui.input} pl-9`}
        />
      </label>

      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((entry) => {
          const line = firstLine(entry.body);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className={cn(
                  ui.cardHover,
                  "flex h-full w-full flex-col gap-1 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                )}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {entry.pinned ? (
                    <Pin
                      className="size-3.5 shrink-0 text-amber-400"
                      aria-label="Pinned: included in every DM turn"
                    />
                  ) : null}
                  <span className="font-display tracking-wide text-amber-50">{entry.title}</span>
                  <span className="rounded-sm border border-stone-600/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400">
                    {CATEGORY_LABELS[entry.category]}
                  </span>
                </span>
                {line ? <span className="line-clamp-1 text-sm text-stone-300">{line}</span> : null}
                {entry.tags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {steersStory ? (
          <li>
            <button
              type="button"
              onClick={onNew}
              className={cn(
                ui.cardHover,
                "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-600">
                <Plus className="size-4" />
              </span>
              <span className="font-display tracking-wide">New entry</span>
            </button>
          </li>
        ) : null}
      </ul>

      {entries.length === 0 ? (
        <p className="text-[11px] italic text-stone-600">
          {steersStory
            ? "No lore yet. Write your world's places, factions, and history; the DM treats it as canon."
            : "The party lead has not written any world lore yet."}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-stone-500">Nothing by that title, body or tag.</p>
      ) : null}
    </div>
  );
}
