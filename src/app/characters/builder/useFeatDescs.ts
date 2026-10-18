"use client";

import { useEffect, useRef, useState } from "react";
import { contentSlug } from "@/lib/help";
import { scopeQuery, useContentCampaign } from "@/lib/content-scope";
import { authoredFeatDesc, registerBrowserTableFeats } from "@/lib/srd/feat-effects";
import { packFeatText } from "@/lib/srd/feat-text";
import { registerFeatRules } from "@/lib/srd/feature-effects";

// The text of the feats on the sheet, by lower-case name, for what each
// grants (src/lib/srd/feat-grants.ts). ODM's own feats are bundled; a
// content pack's is fetched once from the content API and kept.
export function useFeatDescs(names: string[]): Record<string, string> {
  return useFeatTexts(names).descs;
}

// The same fetch, with each feat's prerequisite beside its text, by
// lower-case name, for the feat pickers' check (src/lib/srd/legality/
// features.ts checkPrerequisite). ODM's own are bundled and not here.
export function useFeatTexts(names: string[]): { descs: Record<string, string>; prerequisites: Record<string, string> } {
  // The table the character is built for: its DMs' workshop feats, read the
  // way that table reads them (src/lib/content/scope.ts).
  const campaignId = useContentCampaign();
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [prerequisites, setPrerequisites] = useState<Record<string, string>>({});
  const wanted = names
    .map((name) => name.trim())
    .filter((name) => name && !authoredFeatDesc(name) && fetched[name.toLowerCase()] === undefined);
  const key = wanted.map((name) => name.toLowerCase()).sort().join("|");
  // Each feat is asked for once per table, and its answer is kept however
  // the list changes meanwhile. The key shrinks as each answer lands, and
  // the effect used to drop every answer still on its way at that point and
  // ask again, so a sheet with several pack feats asked over and over.
  const inFlight = useRef(new Set<string>());
  const live = useRef({ mounted: true, campaignId });
  useEffect(() => {
    live.current = { mounted: true, campaignId };
    return () => {
      live.current = { mounted: false, campaignId };
    };
  }, [campaignId]);
  useEffect(() => {
    if (!key) {
      return;
    }
    for (const name of key.split("|")) {
      const flight = `${campaignId ?? ""}|${name}`;
      if (inFlight.current.has(flight)) {
        continue;
      }
      inFlight.current.add(flight);
      // An answer for a table the builder has since left, or after it
      // closed, is dropped.
      const stale = () => !live.current.mounted || live.current.campaignId !== campaignId;
      fetch(`/api/content/feats/${encodeURIComponent(contentSlug(name))}${scopeQuery(campaignId)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { entry?: { source?: string; data?: Record<string, unknown> } } | null) => {
          if (stale()) {
            return;
          }
          // The row's text wherever the pack keeps it, read as the server
          // reads it (src/lib/srd/feat-text.ts). An unknown feat is
          // remembered as empty, so it is asked for once.
          const data = body?.entry?.data;
          const text = data ? packFeatText(data) : { desc: "", prerequisite: "" };
          const desc = text.desc;
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
          setPrerequisites((current) => ({ ...current, [name]: text.prerequisite }));
        })
        .catch(() => {
          if (!stale()) {
            setFetched((current) => ({ ...current, [name]: "" }));
          }
        })
        .finally(() => inFlight.current.delete(flight));
    }
  }, [key, campaignId]);
  return { descs: fetched, prerequisites };
}
