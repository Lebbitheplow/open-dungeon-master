"use client";

import { useId } from "react";
import type { AnyListGroup } from "@/lib/srd/any-list-picks-logic";
import { SpellBook, type SpellTile } from "./SpellBook";

// The picks a feature lets come from any class's spell list (Magical
// Secrets, the Book of Shadows), as their own group inside a spell step: the
// feature's name and number as the heading, one sentence on where they come
// from and how they count, and the same spell book the class's own list
// uses, its level row and search included. The level-up dialog and the
// builder's spell step both draw it (src/lib/srd/any-list-picks-logic.ts
// says what goes in it).
export function AnyListSpellGroup({
  group,
  tiles,
  maxLevel,
  picked,
  onTile,
  notice,
  loading,
}: {
  group: AnyListGroup;
  // anyListTiles' tiles, a world's names for them where the builder has one.
  tiles: SpellTile[];
  maxLevel: number;
  // The group's picks that count.
  picked: number;
  onTile: (tile: SpellTile) => void;
  notice?: string;
  loading: boolean;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-any-list-group={group.feature}
      className="reveal rounded-md border border-amber-900/50 bg-stone-950/60 px-3 py-2"
    >
      <h3 id={headingId} className="text-xs uppercase tracking-wide text-amber-200/80">
        {group.title}
      </h3>
      <p className="mb-2 mt-0.5 text-xs text-stone-400">{group.hint}</p>
      <SpellBook
        tiles={tiles}
        maxLevel={group.spells ? maxLevel : 0}
        counters={[{ label: "From any class", value: picked, max: group.slots }]}
        onTile={onTile}
        notice={notice || undefined}
        searchLabel={`Find a spell for ${group.feature}`}
        emptyText={loading ? "Loading every class's spells..." : "No spell left to choose here."}
      />
    </section>
  );
}
