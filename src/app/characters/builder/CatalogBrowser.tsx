"use client";

import { Check, ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { contentSlug, describeContentEntry, spellSummary } from "@/lib/help";
import type { PickerEntry } from "./useContentSearch";

// The whole catalog, not just what you can name.
//
// ContentPicker answers "I know the name, add it"; this answers "show me
// everything I could take, with the ones that suit this character first". A
// player who has never read a spell list cannot search for a spell they have
// never heard of, so every pick field that draws on the content pack offers
// this beside its search box.
//
// Rows are fetched per section on first expand (the item catalog alone is
// two thousand rows; nobody needs all of them to choose a rope) and every row
// carries its own ⓘ, reading its description straight off the row it already
// has rather than costing a second request.

const PAGE = 200;
// Enough for the largest single section in the bundled pack (magic items),
// with the search box as the escape hatch if a pack ever exceeds it.
const MAX_ROWS = 1600;

export type CatalogBucket = { key: string; label: string; order: number };

export type CatalogSection = {
  key: string;
  label: string;
  // Merged into the /api/content/[kind] query for this section.
  params?: Record<string, string>;
  // Shown under the section heading once it is open.
  note?: string;
  // Splits this section's rows into labelled runs. Overrides the browser's
  // own bucketOf, because what reads well inside "Magic items" (rarity) is
  // meaningless inside "Weapons".
  bucketOf?: (entry: PickerEntry) => CatalogBucket;
};

// A named pick the caller already knows about (a class's starter spells, the
// weapons it is proficient with). These need no fetch: the name is the pick,
// and the ⓘ looks the entry up from the pack only if it is opened. `level`
// rides along for spells so a cantrip picked here is counted as one.
export type CatalogSuggestion = { name: string; note?: string; level?: number };

type Loaded = { rows: PickerEntry[]; truncated: boolean };

// The pack files the same SRD spell under more than one document, so a
// browse shows Fire Bolt twice. One row per name is what a player expects.
function uniqueByName(rows: PickerEntry[]): PickerEntry[] {
  const seen = new Set<string>();
  return rows.filter((entry) => {
    const key = entry.name.trim().toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export default function CatalogBrowser({
  kind,
  buttonLabel,
  sections,
  recommended,
  bucketOf,
  metaOf,
  selectedNames,
  onPick,
  onUnpick,
  defaultOpen = false,
  openSections = [],
}: {
  kind: "spells" | "items" | "feats";
  // "Browse all spells", "Browse all items"...
  buttonLabel: string;
  sections: CatalogSection[];
  // The tier that goes above everything else: what suits this character.
  recommended?: { label: string; note?: string; entries: CatalogSuggestion[] };
  // Splits a section's rows into labelled runs (spell level, item rarity).
  // Runs render in `order`. A section may override it with its own.
  bucketOf?: (entry: PickerEntry) => CatalogBucket;
  metaOf?: (entry: PickerEntry) => string;
  selectedNames: string[];
  onPick: (entry: PickerEntry) => void;
  // Given, rows already on the sheet toggle back off from here too.
  onUnpick?: (name: string) => void;
  // Shown open from the first render: for a pick the rules require (a
  // caster's spells, a high elf's cantrip) the list is the field, not an
  // extra behind a link.
  defaultOpen?: boolean;
  // Section keys expanded (and fetched) from the first render.
  openSections?: string[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<string[]>(openSections);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [loading, setLoading] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [filter, setFilter] = useState("");
  // Sections already fetched must not refetch when the component re-renders
  // with new props (a spell level change rewrites `sections` every keystroke
  // elsewhere in the step).
  const fetched = useRef(new Set<string>());

  const selected = useMemo(
    () => new Set(selectedNames.map((name) => name.trim().toLowerCase())),
    [selectedNames],
  );

  const load = useCallback(
    async (section: CatalogSection) => {
      if (fetched.current.has(section.key)) {
        return;
      }
      fetched.current.add(section.key);
      setLoading((current) => [...current, section.key]);
      const rows: PickerEntry[] = [];
      let truncated = false;
      try {
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
          const params = new URLSearchParams({
            limit: String(PAGE),
            offset: String(offset),
            ...(section.params ?? {}),
          });
          const response = await fetch(`/api/content/${kind}?${params}`);
          if (!response.ok) {
            setUnavailable(true);
            break;
          }
          const body = (await response.json()) as {
            results?: PickerEntry[];
            packInstalled?: boolean;
          };
          // The route answers 200 with no rows when the pack is missing;
          // that is "nothing to browse", not "nothing here".
          if (body.packInstalled === false) {
            setUnavailable(true);
          }
          const page: PickerEntry[] = body.results ?? [];
          rows.push(...page);
          if (page.length < PAGE) {
            break;
          }
          if (offset + PAGE >= MAX_ROWS) {
            truncated = true;
          }
        }
        setLoaded((current) => ({
          ...current,
          [section.key]: { rows: uniqueByName(rows), truncated },
        }));
      } catch {
        // A failed browse leaves the search box, which is the same catalog by
        // another door; forgetting the attempt lets a retry through.
        fetched.current.delete(section.key);
      } finally {
        setLoading((current) => current.filter((key) => key !== section.key));
      }
    },
    [kind],
  );

  // Sections open from the start fetch from the start. `load` remembers what
  // it has fetched, so the changing identity of `sections` costs nothing.
  // Deferred a tick so the fetch's own state updates land after the render
  // that asked for them rather than inside the effect.
  useEffect(() => {
    if (!open) {
      return;
    }
    const wanted = sections.filter((section) => expanded.includes(section.key));
    if (!wanted.length) {
      return;
    }
    const timer = setTimeout(() => {
      for (const section of wanted) {
        void load(section);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, sections, expanded, load]);

  function toggleSection(section: CatalogSection) {
    setExpanded((current) =>
      current.includes(section.key)
        ? current.filter((key) => key !== section.key)
        : [...current, section.key],
    );
    void load(section);
  }

  function toggleRow(entry: PickerEntry) {
    if (selected.has(entry.name.trim().toLowerCase())) {
      onUnpick?.(entry.name);
    } else {
      onPick(entry);
    }
  }

  const needle = filter.trim().toLowerCase();

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 text-xs text-amber-300 underline-offset-2 hover:underline"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {buttonLabel}
      </button>

      {open ? (
        <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-950/60 p-2">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Narrow this list..."
            aria-label="Narrow the browsed list"
            className="mb-2 w-full rounded-md border border-stone-700/70 bg-stone-950 px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-400/60"
          />

          {recommended?.entries.length ? (
            <div className="mb-2">
              <p className="eyebrow px-1 pb-1 text-[10px] text-amber-300/80">
                {recommended.label}
              </p>
              {recommended.note ? (
                <p className="px-1 pb-1.5 text-[11px] text-stone-500">{recommended.note}</p>
              ) : null}
              <ul>
                {recommended.entries
                  .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
                  .map((entry) => {
                    const on = selected.has(entry.name.trim().toLowerCase());
                    return (
                      <li key={entry.name} className="flex items-center gap-1 pr-1 hover:bg-stone-800/60">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            on
                              ? onUnpick?.(entry.name)
                              : onPick({
                                  slug: contentSlug(entry.name),
                                  name: entry.name,
                                  source: "open5e",
                                  data: {},
                                  ...(entry.level !== undefined ? { level: entry.level } : {}),
                                })
                          }
                          className="flex grow items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
                        >
                          <span className="flex items-center gap-1.5">
                            {on ? (
                              <Check className="size-3.5 shrink-0 text-amber-200" />
                            ) : (
                              <Plus className="size-3.5 shrink-0 text-stone-600" />
                            )}
                            <span className={cn(on && "text-amber-200")}>{entry.name}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-stone-500">
                            {entry.note ?? ""}
                          </span>
                        </button>
                        <InfoButton
                          label={entry.name}
                          reference={{ kind, slug: contentSlug(entry.name), name: entry.name }}
                        />
                      </li>
                    );
                  })}
              </ul>
            </div>
          ) : null}

          {sections.map((section) => {
            const isOpen = expanded.includes(section.key);
            const isLoading = loading.includes(section.key);
            const rows = loaded[section.key]?.rows ?? [];
            const visible = needle
              ? rows.filter((entry) => entry.name.toLowerCase().includes(needle))
              : rows;
            return (
              <div key={section.key} className="border-t border-stone-800/80 first:border-t-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleSection(section)}
                  className="flex w-full items-center gap-1.5 px-1 py-1.5 text-left text-xs text-stone-300 hover:text-amber-100"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-stone-500" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-stone-500" />
                  )}
                  <span className="grow">{section.label}</span>
                  {isLoading ? <Loader2 className="size-3.5 animate-spin text-stone-500" /> : null}
                  {!isLoading && loaded[section.key] ? (
                    <span className="text-[11px] text-stone-500">{rows.length}</span>
                  ) : null}
                </button>
                {isOpen ? (
                  <div className="pb-2">
                    {section.note ? (
                      <p className="px-1 pb-1 text-[11px] text-stone-500">{section.note}</p>
                    ) : null}
                    {!isLoading && !rows.length ? (
                      <p className="px-1 py-1 text-[11px] text-stone-500">
                        {unavailable
                          ? "The content pack is not installed on this server, so there is nothing to list. Whoever runs it can install it with: node scripts/import-open5e.mjs"
                          : "Nothing here."}
                      </p>
                    ) : null}
                    <ul className="max-h-72 overflow-y-auto">
                      {groupRows(visible, section.bucketOf ?? bucketOf).map((bucket) => (
                        <li key={bucket.key}>
                          {bucket.label ? (
                            <p className="eyebrow sticky top-0 bg-stone-950/95 px-1 py-1 text-[10px] text-amber-300/70">
                              {bucket.label}
                            </p>
                          ) : null}
                          <ul>
                            {bucket.rows.map((entry) => {
                              const on = selected.has(entry.name.trim().toLowerCase());
                              return (
                                <li
                                  key={entry.slug}
                                  className="flex items-center gap-1 pr-1 hover:bg-stone-800/60"
                                >
                                  <button
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggleRow(entry)}
                                    className="flex grow items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      {on ? (
                                        <Check className="size-3.5 shrink-0 text-amber-200" />
                                      ) : (
                                        <Plus className="size-3.5 shrink-0 text-stone-600" />
                                      )}
                                      <span
                                        className={cn(
                                          on && "text-amber-200",
                                          entry.source === "homebrew" && !on && "text-amber-300",
                                        )}
                                      >
                                        {entry.name}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-[11px] text-stone-500">
                                      {entry.source === "homebrew"
                                        ? "homebrew"
                                        : (metaOf?.(entry) ?? "")}
                                    </span>
                                  </button>
                                  {/* The row already carries the full entry, so
                                      reading it before adding costs nothing. */}
                                  <InfoButton
                                    label={entry.name}
                                    meta={kind === "spells" ? spellSummary(entry.data) : undefined}
                                    text={describeContentEntry(entry.data)}
                                    reference={
                                      entry.source === "homebrew"
                                        ? undefined
                                        : { kind, slug: entry.slug, name: entry.name }
                                    }
                                  />
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    {loaded[section.key]?.truncated ? (
                      <p className="px-1 pt-1 text-[11px] text-stone-500">
                        Showing the first {rows.length}. Search by name above for the rest.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// One run per bucket, in the order the bucket function asked for. Without a
// bucket function the whole section is a single unlabelled run.
function groupRows(
  rows: PickerEntry[],
  bucketOf?: (entry: PickerEntry) => CatalogBucket,
): Array<{ key: string; label: string | null; rows: PickerEntry[] }> {
  if (!bucketOf) {
    return rows.length ? [{ key: "all", label: null, rows }] : [];
  }
  const buckets = new Map<string, { label: string; order: number; rows: PickerEntry[] }>();
  for (const entry of rows) {
    const bucket = bucketOf(entry);
    const existing = buckets.get(bucket.key);
    if (existing) {
      existing.rows.push(entry);
    } else {
      buckets.set(bucket.key, { label: bucket.label, order: bucket.order, rows: [entry] });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, bucket]) => ({ key, label: bucket.label, rows: bucket.rows }));
}
