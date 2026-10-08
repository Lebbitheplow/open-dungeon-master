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
        .then((body: { entry?: { data?: { desc?: unknown; description?: unknown; benefits?: unknown } } } | null) => {
          if (cancelled) {
            return;
          }
          const data = body?.entry?.data;
          // A 2024 row carries its text as benefits (Magic Initiate's four
          // paragraphs), read in order as the server does (catalog.ts).
          const desc =
            data?.desc ??
            data?.description ??
            (Array.isArray(data?.benefits)
              ? (data.benefits as Array<{ desc?: unknown }>).map((benefit) => String(benefit?.desc ?? "").trim()).filter(Boolean).join(" ")
              : undefined);
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
