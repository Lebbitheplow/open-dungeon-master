"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Maximize2, Swords, X } from "lucide-react";
import { useState } from "react";
import { BattleMapGrid } from "@/app/campaigns/[campaignId]/BattleMapGrid";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { PublicEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The tactical battle map tab: the caller's fogged grid with click-to-move
// on their own turn. Moves POST to the server, which enforces speed, walls,
// and turn order; the returned fresh view replaces local state instantly.
export function BattleMapPanel({
  campaignId,
  view,
  encounter,
  sheets,
  refreshBattleMap,
}: {
  campaignId: string;
  view: PlayerMapView;
  encounter: PublicEncounter | null;
  sheets: CharacterSheet[];
  refreshBattleMap: () => Promise<void>;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");

  async function moveTo(x: number, y: number) {
    if (moving) {
      return;
    }
    setMoving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/battle-map/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((data as { error?: string }).error ?? "That move was not allowed.");
        await refreshBattleMap();
        return;
      }
      await refreshBattleMap();
    } finally {
      setMoving(false);
    }
  }

  const canMove = view.reachable.length > 0;
  const grid = (
    <BattleMapGrid view={view} sheets={sheets} onTileClick={canMove ? moveTo : undefined} />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-200">
          <Swords className="size-4 text-red-400" />
          Round {view.round}
          {view.currentTurnName ? (
            <span className="text-xs font-normal text-stone-400">
              {view.currentTurnName}&apos;s turn
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          className="rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-stone-200"
          aria-label="Enlarge battle map"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
      {grid}
      <p className="text-[11px] leading-4 text-stone-500">
        {canMove
          ? `Tap a highlighted tile to move (${view.budgetLeft * 5} ft left this round).`
          : view.myTokenId
            ? "You can move on your turn. The shroud shows what your character cannot see."
            : "You have no token on this field."}
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {encounter?.orderReady ? (
        <ol className="flex flex-wrap gap-1 text-[11px] text-stone-400">
          {encounter.order.map((entry, index) => (
            <li
              key={`${entry.id}-${index}`}
              className={
                index === encounter.turnIndex
                  ? "rounded bg-amber-950/60 px-1.5 py-0.5 font-medium text-amber-300"
                  : "rounded bg-stone-900 px-1.5 py-0.5"
              }
            >
              {entry.name}
            </li>
          ))}
        </ol>
      ) : null}
      <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="font-serif text-stone-100">
                Battle map, round {view.round}
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {grid}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
