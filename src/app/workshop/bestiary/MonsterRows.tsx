"use client";

import { Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { crLabel } from "@/lib/bestiary/derive-cr";
import { RatingLine } from "@/app/campaigns/[campaignId]/MonsterFields";
import type { Monster } from "@/app/workshop/bestiary/types";

// The workshop's bestiary list: one full-width row per built monster with
// the numbers a DM scans a stat block for (rating, armour, hit points, how
// many swings, how quick) and whether the rating the block claims is the
// rating the numbers support. Tapping a row hands it to the caller, which
// opens the editor. Duplicate and delete stay on the row so a roster of
// thirty can be pruned without opening any of them.
//
// The rating marker is the panel's own RatingLine, fed the readout the
// server derived; nothing here recomputes a challenge rating.

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function MonsterRows({
  monsters,
  busy,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  monsters: Monster[];
  busy: boolean;
  onOpen: (monster: Monster) => void;
  onDuplicate: (monster: Monster) => void;
  onDelete: (monster: Monster) => void;
}) {
  if (!monsters.length) {
    return (
      <p className="text-xs text-stone-500">
        Nothing built yet. A monster made here answers to its name wherever a fight starts.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {monsters.map((monster) => {
        const { stats } = monster.draft;
        const swings = stats.attacksPerTurn ?? 1;
        return (
          <li key={monster.id} className={cn(ui.cardHover, "flex items-start gap-3 p-3")}>
            <button
              type="button"
              onClick={() => onOpen(monster)}
              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display tracking-wide text-amber-50">
                  {monster.draft.name}
                </span>
                <span className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  CR {crLabel(stats.cr)}
                </span>
              </div>
              <p className="mt-1 text-sm text-stone-300">
                AC {stats.ac} · {stats.maxHp} hp
              </p>
              <p className="text-xs text-stone-500">
                {swings} swing{swings === 1 ? "" : "s"} a turn · Dex {signed(stats.dexMod)}
              </p>
              <div className="mt-1">
                <RatingLine readout={monster.readout} />
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={busy}
                aria-label={`Duplicate ${monster.draft.name}`}
                onClick={() => onDuplicate(monster)}
                className="rounded-md p-1.5 text-stone-500 hover:text-stone-200 disabled:opacity-40"
              >
                <Copy className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${monster.draft.name}`}
                onClick={() => onDelete(monster)}
                className="rounded-md p-1.5 text-stone-500 hover:text-red-300"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
