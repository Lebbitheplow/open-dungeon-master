"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROLL_REF_KINDS, type RollRefKind } from "@/lib/dm/roll-table-logic";
import type { RollTable } from "@/lib/db/roll-tables";
import { AddFromList } from "@/components/ui/AddFromList";
import { ContentPick } from "@/components/ui/ContentPick";

// A row that IS a thing: "@monster: wolf", "@table: Gems". The table body
// takes them typed, which means knowing the exact name of everything in the
// workshop. This picks instead: choose what kind of thing, then the thing
// itself from what this world actually holds (its tables, the DM's own
// monsters and the catalogue's, the content pack's items, the cast, the
// lore), and the row lands in the body.

const KIND_LABELS: Record<RollRefKind, string> = {
  table: "Another table",
  monster: "A monster",
  item: "An item",
  npc: "Someone from the cast",
  lore: "A lore entry",
};

const select =
  "rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300 focus:border-amber-500/50 focus:outline-none";

type Named = { name: string };

export function RefPicker({
  campaignId,
  tables,
  editingId,
  onInsert,
}: {
  campaignId: string;
  // The world's tables when the caller already holds them (the tables tool
  // does); otherwise read here the first time that kind is chosen.
  tables?: RollTable[];
  // The table being edited, kept out of its own list.
  editingId: string;
  onInsert: (line: string) => void;
}) {
  const [kind, setKind] = useState<RollRefKind>("table");
  const [npcs, setNpcs] = useState<Named[] | null>(null);
  const [lore, setLore] = useState<Named[] | null>(null);
  const [monsters, setMonsters] = useState<Named[] | null>(null);
  const [fetchedTables, setFetchedTables] = useState<RollTable[] | null>(null);

  // Each list is fetched once, the first time its kind is chosen; the
  // state lands in .then so the effect reads as a subscription.
  useEffect(() => {
    if (kind === "table" && !tables && fetchedTables === null) {
      fetch(`/api/campaigns/${campaignId}/dm/roll-tables`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { tables?: RollTable[] } | null) => setFetchedTables(data?.tables ?? []))
        .catch(() => setFetchedTables([]));
    }
    if (kind === "npc" && npcs === null) {
      fetch(`/api/campaigns/${campaignId}/dm/npcs`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { npcs?: Named[] } | null) => setNpcs(data?.npcs ?? []))
        .catch(() => setNpcs([]));
    }
    if (kind === "lore" && lore === null) {
      fetch(`/api/campaigns/${campaignId}/lore`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { entries?: Array<{ title: string }> } | null) =>
          setLore((data?.entries ?? []).map((entry) => ({ name: entry.title }))),
        )
        .catch(() => setLore([]));
    }
    if (kind === "monster" && monsters === null) {
      fetch(`/api/campaigns/${campaignId}/dm/bestiary`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { monsters?: Array<{ draft: { name: string } }> } | null) =>
          setMonsters((data?.monsters ?? []).map((monster) => ({ name: monster.draft.name }))),
        )
        .catch(() => setMonsters([]));
    }
  }, [kind, campaignId, npcs, lore, monsters, tables, fetchedTables]);

  const insert = (name: string) => onInsert(`@${kind}: ${name}`);

  const listFor = (): Named[] | null => {
    switch (kind) {
      case "table":
        return (tables ?? fetchedTables)?.filter((table) => table.id !== editingId) ?? null;
      case "npc":
        return npcs;
      case "lore":
        return lore;
      case "monster":
        return monsters;
      default:
        return null;
    }
  };
  const list = listFor();

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="tables-ref">
      <Link2 className="size-3.5 text-stone-500" aria-hidden="true" />
      <select
        value={kind}
        aria-label="What kind of thing the row is"
        onChange={(event) => setKind(event.target.value as RollRefKind)}
        className={select}
      >
        {ROLL_REF_KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABELS[option]}
          </option>
        ))}
      </select>
      {kind === "item" ? (
        <ContentPick
          kind="items"
          label="Find an item to add as a row"
          placeholder="Potion of Healing"
          onPick={(entry) => insert(entry.name)}
          className="min-w-44 flex-1"
        />
      ) : kind === "monster" ? (
        <>
          <AddFromList
            prompt="One of yours"
            options={(list ?? []).map((entry) => entry.name)}
            onPick={insert}
          />
          <ContentPick
            kind="monsters"
            label="Find a monster in the catalogue to add as a row"
            placeholder="wolf"
            onPick={(entry) => insert(entry.name)}
            className="min-w-44 flex-1"
          />
        </>
      ) : list && list.length ? (
        <AddFromList
          prompt="Add a row for"
          options={list.map((entry) => entry.name)}
          onPick={insert}
          className={cn("min-w-44")}
        />
      ) : (
        <span className="text-[11px] text-stone-600">
          {list === null ? "Reading..." : `Nothing of that kind in this workshop yet.`}
        </span>
      )}
    </div>
  );
}
