"use client";

import { useEffect, useState } from "react";
import { contentSlug } from "@/lib/help";
import { authoredFeatDesc } from "@/lib/srd/feat-effects";

// The text of the feats on the sheet, by lower-case name, for what each
// grants (src/lib/srd/feat-grants.ts). ODM's own feats are bundled; a
// content pack's is fetched once from the content API and kept.
export function useFeatDescs(names: string[]): Record<string, string> {
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const wanted = names
    .map((name) => name.trim())
    .filter((name) => name && !authoredFeatDesc(name) && fetched[name.toLowerCase()] === undefined);
  const key = wanted.map((name) => name.toLowerCase()).sort().join("|");
  useEffect(() => {
    if (!key) {
      return;
    }
    let cancelled = false;
    for (const name of key.split("|")) {
      fetch(`/api/content/feats/${encodeURIComponent(contentSlug(name))}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { entry?: { data?: { desc?: unknown; description?: unknown } } } | null) => {
          if (cancelled) {
            return;
          }
          const desc = body?.entry?.data?.desc ?? body?.entry?.data?.description;
          // An unknown feat is remembered as empty, so it is asked for once.
          setFetched((current) => ({ ...current, [name]: typeof desc === "string" ? desc : "" }));
        })
        .catch(() => {
          if (!cancelled) {
            setFetched((current) => ({ ...current, [name]: "" }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return fetched;
}
