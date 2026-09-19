"use client";

import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import { MonsterTile, ui } from "@/lib/ui";
import { crLabel } from "@/lib/bestiary/derive-cr";
import { RatingLine } from "@/app/campaigns/[campaignId]/MonsterFields";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { RowMenu } from "@/app/workshop/kit";
import { ListHead, useListHead } from "@/app/workshop/ListHead";
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

const readMonster = (monster: Monster) => ({ name: monster.draft.name, tags: monster.draft.stats.type ? [monster.draft.stats.type] : [] });

export function MonsterRows({
  monsters,
  busy,
  genre,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  monsters: Monster[];
  busy: boolean;
  // The table's setting, so a high-rating monster draws the boss plate.
  genre?: string | null;
  onOpen: (monster: Monster) => void;
  onDuplicate: (monster: Monster) => void;
  onDelete: (monster: Monster) => void;
}) {
  const head = useListHead(monsters, readMonster);
  if (!monsters.length) {
    return (
      <EmptyState size="md" art="chest" title="Nothing built yet. A monster made here answers to its name wherever a fight starts." />
    );
  }
  return (
    <>
    <ListHead head={head} noun={["monster", "monsters"]} placeholder="Find a monster" />
    <ul className="stagger space-y-2">
      {head.shown.map((monster) => {
        const { stats } = monster.draft;
        const swings = stats.attacksPerTurn ?? 1;
        // One list for both doors: the kebab on the row and the right-click
        // or long-press menu. Opening stays the row itself.
        const items: ContextMenuItem[] = [
          { id: "open", label: "Open", glyph: "system-bestiary", onSelect: () => onOpen(monster) },
          { id: "duplicate", label: "Duplicate", glyph: "tab-notes", disabled: busy, onSelect: () => onDuplicate(monster) },
          { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => onDelete(monster) },
        ];
        return (
          <ContextMenu
            as="li"
            key={monster.id}
            className={cn(ui.cardHover, "flex items-start gap-3 p-3")}
            label={monster.draft.name}
            items={items}
          >
            <MonsterTile
              type={stats.type}
              cr={stats.cr}
              genre={genre}
              seed={monster.draft.name}
              size="size-12"
            />
            <button
              type="button"
              onClick={() => onOpen(monster)}
              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display tracking-wide text-amber-50">
                  {monster.draft.name}
                </span>
                <span className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-amber-300">
                  CR {crLabel(stats.cr)}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-300">
                <span className="inline-flex items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "rest-ac" }} size="size-5" /> AC {stats.ac}
                </span>
                <span className="inline-flex items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-5" /> {stats.maxHp} hp
                </span>
              </p>
              <p className="text-xs text-stone-500">
                {swings} swing{swings === 1 ? "" : "s"} a turn · Dex {signed(stats.dexMod)}
              </p>
              <div className="mt-1">
                <RatingLine readout={monster.readout} />
              </div>
            </button>
            <RowMenu items={items} label={monster.draft.name} />
          </ContextMenu>
        );
      })}
    </ul>
    </>
  );
}
