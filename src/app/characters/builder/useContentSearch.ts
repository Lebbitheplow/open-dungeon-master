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

// Debounced search against /api/content/[kind]; shared by the single-pick
// ContentPicker and the multi-select MultiContentPicker. An empty query
// still fetches: it loads a browsable default list (sorted by the API) so
// pickers can open a dropdown on focus before the user types anything.
// Only a typed query auto-opens the list; the browse prefetch stays closed
// until the component opens it (focus). `unavailable` flips when the
// content pack is not installed (the API answers non-OK) so pickers can
// fall back to free-text entry.
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
    timer.current = setTimeout(
      async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams({ limit: trimmed ? "12" : "30", ...extraParams });
          if (trimmed) {
            params.set("q", trimmed);
          }
          const response = await fetch(`/api/content/${kind}?${params}`);
          if (response.ok) {
            const data = await response.json();
            setResults(data.results ?? []);
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
        } finally {
          setLoading(false);
        }
      },
      trimmed ? 250 : 0,
    );
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, JSON.stringify(extraParams)]);

  return { query, setQuery, results, setResults, open, setOpen, loading, unavailable };
}
