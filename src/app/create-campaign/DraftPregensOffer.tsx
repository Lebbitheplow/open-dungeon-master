"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import { countOptions, useDraftReadiness } from "@/app/workshop/party/DraftPregens";

// The campaign creator's one offer of AI-drafted pregens
// (src/lib/dm/pregen-draft.ts): shown on the review only when the prep
// brought in is a workshop of the creator's that has no pregens. Ticked, the
// AI DM drafts them once the table is made, at its starting level, and files
// them under that workshop unticked: nothing reaches a player until the DM
// ticks Offer to players there.

export type PregenDraftChoice = { workshopId: string; count: number } | null;

export function DraftPregensOffer({
  sourceId,
  prepTitle,
  startingLevel,
  choice,
  onChoice,
}: {
  sourceId: string;
  prepTitle: string;
  startingLevel: number;
  choice: PregenDraftChoice;
  onChoice: (choice: PregenDraftChoice) => void;
}) {
  // Whether the source is the creator's own workshop with an empty roster:
  // a campaign as the source, or a roster with pregens, offers nothing.
  const [empty, setEmpty] = useState<{ sourceId: string; empty: boolean } | null>(null);
  useEffect(() => {
    if (!sourceId) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/workshops/${sourceId}/pregens`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { pregens?: unknown[] };
        if (!cancelled) setEmpty({ sourceId, empty: response.ok && Array.isArray(payload.pregens) && payload.pregens.length === 0 });
      })
      .catch(() => {
        if (!cancelled) setEmpty({ sourceId, empty: false });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);
  const shown = Boolean(sourceId) && empty?.sourceId === sourceId && empty.empty;
  const readiness = useDraftReadiness(sourceId, shown);

  // A choice made for another source, or for one that turned out to have
  // pregens, is dropped.
  useEffect(() => {
    if (choice && (!shown || choice.workshopId !== sourceId)) {
      onChoice(null);
    }
  }, [choice, shown, sourceId, onChoice]);

  if (!shown) {
    return null;
  }
  const off = !readiness?.ready;
  const count = choice?.count ?? readiness?.defaultCount ?? 4;
  return (
    <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 p-3" data-pregen-draft-offer>
      <label className="flex min-h-11 cursor-pointer items-start gap-2 text-stone-200">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-amber-500"
          checked={Boolean(choice)}
          disabled={off}
          onChange={(event) => onChoice(event.target.checked ? { workshopId: sourceId, count } : null)}
        />
        <span>
          {prepTitle} has no pregens. Have the AI DM draft some once the table is made?
          <span className="block text-xs text-stone-400">
            Built at level {startingLevel} and filed under the workshop. Players see none of them until you tick Offer
            to players there. Drafting takes about a minute.
          </span>
        </span>
      </label>
      {choice ? (
        <span className="block w-40">
          <Select
            value={String(count)}
            onChange={(value) => onChoice({ workshopId: sourceId, count: Number(value) })}
            label="How many pregens to draft"
            options={countOptions(readiness?.maxCount ?? 6)}
          />
        </span>
      ) : null}
      {readiness && !readiness.ready ? <p className="text-xs text-amber-200/90">{readiness.reason}</p> : null}
    </div>
  );
}
