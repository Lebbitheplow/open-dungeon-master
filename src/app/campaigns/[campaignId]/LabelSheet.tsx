"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Markdown } from "@/components/ui/Markdown";
import type { MapLabel } from "@/lib/battlemap/scene";

// What a pinned map label opens (docs/vtt-parity-implementation-plan.md
// section 3.5): the lore entry it points at, for whoever the entry's
// visibility allows (the lore route already filters). Other kinds show the
// label's own words until their panels grow a direct opener.

type Entry = { id: string; title: string; body: string; category?: string };

export function LabelSheet({
  campaignId,
  label,
  onClose,
}: {
  campaignId: string;
  label: MapLabel | null;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const ref = label?.ref ?? null;

  useEffect(() => {
    if (!ref || ref.kind !== "lore") {
      return;
    }
    let cancelled = false;
    // The reset rides the fetch chain rather than firing synchronously in
    // the effect, which is what the hooks rule asks for.
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setEntry(null);
          setMissing(false);
          setLoading(true);
        }
        return fetch(`/api/campaigns/${campaignId}/lore`);
      })
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((data: { entries?: Entry[] }) => {
        if (cancelled) {
          return;
        }
        const found = (data.entries ?? []).find((candidate) => candidate.id === ref.id) ?? null;
        setEntry(found);
        setMissing(!found);
      })
      .catch(() => {
        if (!cancelled) {
          setMissing(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, ref]);

  if (!label) {
    return null;
  }
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())} title={entry?.title ?? label.text}>
      <div className="space-y-2 text-sm text-stone-200">
        {ref?.kind === "lore" ? (
          loading ? (
            <p className="reveal text-xs text-stone-500">Opening the entry...</p>
          ) : entry ? (
            <Markdown source={entry.body} className="prose-sm" />
          ) : missing ? (
            <p className="reveal text-xs text-stone-500">
              That entry is not one you can read, or it has been removed.
            </p>
          ) : null
        ) : (
          <p className="text-xs text-stone-400">{label.text}</p>
        )}
      </div>
    </Sheet>
  );
}
