"use client";

import { useEffect, useRef, useState } from "react";

export type PickerEntry = {
  slug: string;
  name: string;
  source: "open5e" | "homebrew";
  data: Record<string, unknown>;
  level?: number;
  school?: string;
  kind?: string;
  rarity?: string;
  cost?: string;
};

// The pack files the same SRD entry under more than one document, so a
// search for "light" answers Light twice. One row per name.
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

// Debounced search against /api/content/[kind]; shared by the single-pick
// ContentPicker and the multi-select MultiContentPicker. An empty query
// still fetches: it loads a browsable default list (sorted by the API) so
// pickers can open a dropdown on focus before the user types anything.
// Only a typed query auto-opens the list; the browse prefetch stays closed
// until the component opens it (focus). `unavailable` flips when the
// content pack is not installed (the API answers non-OK, or 200 with
// packInstalled false) so pickers can say so instead of "nothing matched".
export function useContentSearch(kind: string, extraParams: Record<string, string> = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
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
          const params = new URLSearchParams({ limit: trimmed ? "12" : "30", ...extraParams });
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
            };
            if (data.packInstalled === false) {
              setUnavailable(true);
            }
            setResults(uniqueByName(data.results ?? []));
            if (trimmed) {
              setOpen(true);
            }
          } else {
            setUnavailable(true);
            setResults([]);
            if (trimmed) {
              setOpen(true);
            }
          }
        } catch {
          // Aborted by a newer query, or the network is gone; the next
          // request answers either way.
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
  }, [query, kind, JSON.stringify(extraParams)]);

  return { query, setQuery, results, setResults, open, setOpen, loading, unavailable };
}
