"use client";

import { useEffect, useState } from "react";
import { contentSlug } from "@/lib/help";
import { scopeQuery, useContentCampaign } from "@/lib/content-scope";
import { authoredFeatDesc, registerBrowserTableFeats } from "@/lib/srd/feat-effects";
import { packFeatText } from "@/lib/srd/feat-text";
import { registerFeatRules } from "@/lib/srd/feature-effects";

// The text of the feats on the sheet, by lower-case name, for what each
// grants (src/lib/srd/feat-grants.ts). ODM's own feats are bundled; a
// content pack's is fetched once from the content API and kept.
export function useFeatDescs(names: string[]): Record<string, string> {
  // The table the character is built for: its DMs' workshop feats, read the
  // way that table reads them (src/lib/content/scope.ts).
  const campaignId = useContentCampaign();
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
      fetch(`/api/content/feats/${encodeURIComponent(contentSlug(name))}${scopeQuery(campaignId)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { entry?: { source?: string; data?: Record<string, unknown> } } | null) => {
          if (cancelled) {
            return;
          }
          // The row's text wherever the pack keeps it, read as the server
          // reads it (src/lib/srd/feat-text.ts). An unknown feat is
          // remembered as empty, so it is asked for once.
          const data = body?.entry?.data;
          const desc = data ? packFeatText(data).desc : "";
          // The builder's own numbers (speed, initiative, passive scores)
          // read the feat through the same table the server does.
          if (body?.entry?.source === "homebrew") {
            // A workshop feat: what it runs as and its text, read the way
            // the table reads it (feat-effects.ts tableFeat).
            const runsAs = typeof data?.runsAs === "string" ? data.runsAs : undefined;
            registerBrowserTableFeats({ [name]: { ...(runsAs ? { runsAs } : {}), desc } }, campaignId);
          } else {
            // Not (or no longer) a workshop feat of this table.
            registerBrowserTableFeats({ [name]: null }, campaignId);
            if (desc) {
              registerFeatRules(name, desc);
            }
          }
          setFetched((current) => ({ ...current, [name]: desc }));
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
  }, [key, campaignId]);
  return fetched;
}
