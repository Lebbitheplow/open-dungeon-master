"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ObjectEntry } from "@/lib/battlemap/render/painted";
import { FinePrint, mapInput } from "@/app/campaigns/[campaignId]/mapUi";
import { groupStamps } from "@/app/campaigns/[campaignId]/mapCatalogue";

// The stamp picker (docs/visual-overhaul-plan.md 4.5): the painted object set
// as things to put down with the Prop tool. Grouped by set, the sets this
// map's skin dresses itself from first and open, the rest folded under them;
// one search box over the lot. Picking fills the prop's name and keeps its
// kind, and the name stays editable. Rendered in the flow of the options
// column, never as a floating list, so it cannot be clipped by the sheet it
// sits in on a phone.

export function StampPicker({
  objects,
  ownSets,
  value,
  onPick,
}: {
  objects: readonly ObjectEntry[];
  // The sets the map's skin dresses from; they lead the list.
  ownSets: readonly string[];
  value: string | undefined;
  // Undefined clears the stamp and returns the prop to the plain marker.
  onPick: (object: ObjectEntry | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupStamps(objects, ownSets, query), [objects, ownSets, query]);
  const picked = value ? objects.find((object) => object.id === value) : undefined;
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">
        Drawn as
        {picked ? (
          <button type="button" onClick={() => onPick(undefined)} className="flex items-center gap-1 text-stone-400 hover:text-amber-200">
            <X className="size-3" /> <span className="font-sans text-[10px] normal-case tracking-normal">plain marker</span>
          </button>
        ) : null}
      </div>
      {picked ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-400/10 px-2 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picked.src} alt="" className="size-8 object-contain" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-amber-100">{picked.label ?? picked.id}</span>
        </div>
      ) : null}
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an object: barrel, altar, tavern"
          aria-label="Find an object"
          className={cn(mapInput, "pl-7")}
        />
      </label>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
        {groups.map((group) => {
          const open = searching || (opened[group.set] ?? group.own);
          return (
            <section key={group.set}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpened((current) => ({ ...current, [group.set]: !open }))}
                className="flex w-full items-center gap-1 py-1 text-left text-stone-400 hover:text-stone-200"
              >
                <ChevronRight className={cn("chevron-turn size-3", open && "rotate-90")} />
                <span className="text-[10px] uppercase tracking-wide">{group.label}</span>
                {group.own ? <span className="text-[10px] uppercase tracking-wide text-amber-400/80">this map</span> : null}
                <span className="ml-auto font-mono text-[10px] text-stone-600">{group.objects.length}</span>
              </button>
              {open ? (
                <div className="grid grid-cols-4 gap-1">
                  {group.objects.map((object) => (
                    <button
                      key={object.id}
                      type="button"
                      title={object.label ?? object.id}
                      aria-label={object.label ?? object.id}
                      aria-pressed={object.id === value}
                      onClick={() => onPick(object.id === value ? undefined : object)}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border bg-stone-900/60 p-1 motion-press",
                        object.id === value ? "border-amber-500/70 bg-amber-400/10" : "border-stone-800 hover:border-stone-600",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={object.src} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
        {!groups.length ? <FinePrint>Nothing in the object set matches that.</FinePrint> : null}
      </div>
    </div>
  );
}
