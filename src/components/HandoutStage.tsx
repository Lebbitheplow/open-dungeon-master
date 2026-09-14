"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/ui/Markdown";
import type { HandoutShown } from "@/lib/scene/state";
import type { LoreEntryView } from "@/app/workshop/lore/types";

// The handout on the table (docs/vtt-parity-implementation-plan.md 5.2):
// what the DM put in front of everyone, over a scrim, as parchment, a
// notice or a bare picture. Every allowed seat opens it; the DM takes it
// down for everyone, a player can fold their own copy away. A late joiner
// finds it still up because the event persisted.

export function HandoutStage({
  campaignId,
  handout,
  userId,
  steersStory,
  onDismiss,
}: {
  campaignId: string;
  handout: HandoutShown | null;
  userId: string;
  steersStory: boolean;
  // The DM's take-down; players fold locally.
  onDismiss: (id: string) => Promise<void>;
}) {
  const [folded, setFolded] = useState<string | null>(null);
  const [entry, setEntry] = useState<LoreEntryView | null>(null);
  const allowed =
    handout !== null &&
    !handout.dismissed &&
    (steersStory || handout.audience === null || handout.audience.includes(userId));
  const loreId = allowed && handout ? handout.loreId ?? "" : "";

  // The body comes from the binder, filtered for this seat by the server.
  useEffect(() => {
    if (!loreId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/lore`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { entries?: LoreEntryView[] } | null) => {
        if (!cancelled) {
          setEntry(data?.entries?.find((candidate) => candidate.id === loreId) ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, loreId]);

  useEffect(() => {
    if (!handout) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFolded(handout.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handout]);

  if (!allowed || !handout || folded === handout.id) {
    return null;
  }
  const style = handout.style;
  const image = handout.imagePath ?? entry?.imagePath ?? "";
  const body = loreId ? entry?.body ?? "" : "";
  const roll = async (expression: string) => {
    const response = await fetch(`/api/campaigns/${campaignId}/rolls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression }),
    });
    const data = (await response.json().catch(() => ({}))) as { roll?: { total?: number } };
    return typeof data.roll?.total === "number" ? data.roll.total : null;
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 sm:p-8" role="dialog" aria-label={handout.title}>
      <div className="handout-scrim-in absolute inset-0 bg-stone-950/80" onClick={() => setFolded(handout.id)} />
      <div className={cn("handout-in relative max-h-[90vh] w-full overflow-y-auto", style === "image" ? "max-w-4xl" : "max-w-2xl")}>
        {style === "image" ? (
          image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={handout.title} className="mx-auto max-h-[80vh] rounded-lg object-contain shadow-elev-1" />
          ) : null
        ) : (
          <div className={cn(style === "notice" ? "notice" : "parchment")}>
            {style === "parchment" ? <span className="found-stamp">Found</span> : null}
            <h2 className={cn("font-display", style === "notice" ? "text-center text-2xl uppercase tracking-[0.2em]" : "text-xl")}>
              {handout.title}
            </h2>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="my-3 max-h-72 w-full rounded object-contain" />
            ) : null}
            {body ? <Markdown source={body} style={style} onRoll={roll} className="mt-2" /> : null}
            {handout.caption ? (
              <p className={cn("mt-4 text-[11px] italic opacity-80", style === "notice" ? "text-center" : "")}>{handout.caption}</p>
            ) : null}
            <div className="mt-4 flex items-center justify-between">
              <span className="wax-seal">From the DM</span>
              {entry?.attachmentPath ? (
                <a href={entry.attachmentPath} target="_blank" rel="noreferrer" className="text-[11px] underline">
                  Open the pages
                </a>
              ) : null}
            </div>
          </div>
        )}
        {handout.caption && style === "image" ? (
          <p className="mt-2 text-center text-sm text-stone-300">{handout.caption}</p>
        ) : null}
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-6 sm:top-6">
        {image ? (
          <a
            href={image}
            download
            aria-label="Download"
            className="rounded-md border border-stone-700 bg-stone-950/80 p-2 text-stone-400 hover:text-stone-100"
          >
            <Download className="size-4" />
          </a>
        ) : null}
        {steersStory ? (
          <button
            type="button"
            onClick={() => void onDismiss(handout.id)}
            className="rounded-md border border-amber-700 bg-amber-950/60 px-2 py-1.5 text-xs text-amber-100"
          >
            Take it down
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setFolded(handout.id)}
          aria-label="Fold away"
          className="rounded-md border border-stone-700 bg-stone-950/80 p-2 text-stone-400 hover:text-stone-100"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
