"use client";

import { useEffect, useRef, useState } from "react";
import { scopedParams, useContentCampaign } from "@/lib/content-scope";
import { uniqueByName } from "./pickerRows";

export type PickerEntry = {
  slug: string;
  name: string;
  // "srd" and "bundled": the bundled book's and the builder's own rows, which
  // answer when no content pack is installed.
  source: "open5e" | "homebrew" | "srd" | "bundled";
  // The book the row is from, by title.
  document?: string;
  documentSlug?: string;
  // The bundled rulebook page the row is printed on (src/lib/rulebook).
  rulebook?: string;
  // Pounds, where the catalog knows (an item).
  weight?: number;
  data: Record<string, unknown>;
  level?: number;
  school?: string;
  kind?: string;
  rarity?: string;
  cost?: string;
  // An item's price as the server would charge it at creation, worked out
  // by the server's own catalog so a pick and its purchase check agree
  // even where the pack files the name twice (src/lib/characters/catalog.ts).
  price?: { copper: number | null; magic: boolean };
  // What the engine runs for the row, when the search asked for it with
  // mechanics=1 (src/lib/workshop/catalog-mechanics.ts): a spell's block,
  // an item's gear.
  mech?: Record<string, unknown>;
  gear?: Record<string, unknown>;
  // A subclass's features by level and its always-prepared spells.
  table?: Record<string, unknown>;
};


// Debounced search against /api/content/[kind]; shared by the single-pick
// ContentPicker and the multi-select MultiContentPicker. An empty query
// still fetches: it loads a browsable default list (sorted by the API) so
// pickers can open a dropdown on focus before the user types anything.
// Only a typed query auto-opens the list; the browse prefetch stays closed
// until the component opens it (focus).
//
// Inside a table (src/lib/content-scope.tsx) the search is the table's:
// whoever runs it is whose homebrew is offered, and `unadmitted` names the
// asker's own entries that table leaves out.
//
// Three states, each from the latest answer, so a later answer clears them:
// `packMissing` (the optional content pack is not installed; homebrew, ODM's
// own rows and the bundled book still answer), `failed` (the request was
// refused or the network was gone), and `unavailable` (there is nothing
// usable to show: a failure, or no pack and no rows), which is when a picker
// says so instead of "nothing matched".
export function useContentSearch(kind: string, extraParams: Record<string, string> = {}) {
  const campaignId = useContentCampaign();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [packMissing, setPackMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unadmitted, setUnadmitted] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    const trimmed = query.trim();
    // A slow browse prefetch must not land on top of the typed results that
    // replaced it; each request is cancelled by the next.
    const controller = new AbortController();
    timer.current = setTimeout(
      async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams(scopedParams({ limit: trimmed ? "12" : "30", ...extraParams }, campaignId));
          if (trimmed) {
            params.set("q", trimmed);
          }
          const response = await fetch(`/api/content/${kind}?${params}`, {
            signal: controller.signal,
          });
          if (response.ok) {
            const data = (await response.json()) as {
              results?: PickerEntry[];
              packInstalled?: boolean;
              unadmitted?: string[];
            };
            setFailed(false);
            setPackMissing(data.packInstalled === false);
            setUnadmitted(Array.isArray(data.unadmitted) ? data.unadmitted : []);
            setResults(uniqueByName(data.results ?? []));
            if (trimmed) {
              setOpen(true);
            }
          } else {
            setFailed(true);
            setResults([]);
            if (trimmed) {
              setOpen(true);
            }
          }
        } catch (error) {
          // Aborted by a newer query: the newer one answers. The network
          // gone: said so until a later request gets through.
          if (!controller.signal.aborted && (error as { name?: string })?.name !== "AbortError") {
            setFailed(true);
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      },
      trimmed ? 250 : 0,
    );
    return () => {
      controller.abort();
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, campaignId, JSON.stringify(extraParams)]);

  const unavailable = failed || (packMissing && !results.length && !query.trim());
  return { query, setQuery, results, setResults, open, setOpen, loading, unavailable, packMissing, failed, unadmitted };
}
