"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import type { PlaceTree } from "@/lib/overworld/places";
import { PanelError } from "./PanelKit";
import type { CampaignLocation } from "@/app/campaigns/[campaignId]/useCampaignStream";

// Where an area belongs (issue 548), from its menu in the area list: part of
// another place, which it then shares a dot with on the region map, or a
// place of its own. The places are offered as the list shows them, nested,
// less the area itself and its own parts, which would make a loop. The
// table hears the change through location_updated, so the list and the map
// follow without a reload.
export function PlacePartOfDialog({
  campaignId,
  place,
  parentId,
  rows,
  tree,
  open,
  onOpenChange,
}: {
  campaignId: string;
  place: CampaignLocation;
  parentId: string | null;
  rows: Array<{ location: CampaignLocation; depth: number; label: string }>;
  tree: PlaceTree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function fileUnder(parentName: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/overworld`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: { locationId: place.id, parentName } }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        locations?: Array<{ id: string; parentName?: string | null }>;
      };
      if (!response.ok) {
        setError(data.error ?? "Could not file it there.");
        return;
      }
      // A host from before places had parents answers this without filing
      // anything (an app newer than its server): its places carry no
      // parentName, so say so rather than close as if it worked.
      const answered = data.locations?.find((location) => location.id === place.id);
      if (answered && !("parentName" in answered)) {
        setError("This server is too old to file places. Updating it adds this.");
        return;
      }
      onOpenChange(false);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inside = new Set(tree.descendantsOf(place.id));
  const choices = [
    { id: "", label: "Its own place on the region map", depth: 0, name: "" },
    ...rows
      .filter(({ location }) => location.id !== place.id && !inside.has(location.id))
      .map(({ location, depth, label }) => ({ id: location.id, label, depth, name: location.name })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError("");
        onOpenChange(next);
      }}
      title={`Where is ${place.name}?`}
    >
      <p className="mb-2 text-xs leading-5 text-stone-400">
        A part of a bigger place (a vault&apos;s entrance, a village&apos;s hall) shares that place&apos;s dot on the region map and is listed under it here.
      </p>
      <div role="radiogroup" aria-label={`Where ${place.name} belongs`} className="space-y-1" data-testid="place-part-of">
        {choices.map((choice) => {
          const chosen = choice.id ? parentId === choice.id : !parentId;
          return (
            <div key={choice.id || "own"} style={choice.depth ? { marginLeft: `${choice.depth * 0.75}rem` } : undefined}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={busy}
                onClick={() => void fileUnder(choice.name)}
                className={cn(
                  "pk-tap flex min-h-10 w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm motion-press disabled:opacity-60",
                  chosen
                    ? "border-amber-500/50 bg-amber-400/10 text-amber-100"
                    : "border-stone-700/60 text-stone-300 hover:bg-stone-900/70 hover:text-stone-100",
                )}
              >
                <Check className={cn("size-4 shrink-0", chosen ? "text-amber-300" : "invisible")} />
                {choice.id ? (
                  <span>
                    Part of <span className="font-semibold">{choice.name}</span>
                  </span>
                ) : (
                  choice.label
                )}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-stone-500">
        A bigger place that is not listed yet can be added first, under Add a place on the region map.
      </p>
      {error ? <PanelError className="reveal mt-2">{error}</PanelError> : null}
    </Dialog>
  );
}
