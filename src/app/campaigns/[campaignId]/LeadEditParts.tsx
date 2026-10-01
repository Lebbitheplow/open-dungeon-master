"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { KitButton } from "./PanelKit";
import { casterViewsOf, withCasterViews } from "@/lib/srd/spell-prep";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

export {
  equipmentFrom,
  highestStoredSlot,
  itemRowsOf,
  spellListOf,
  type ItemRow,
} from "./lead-edit-logic";

// The pieces the lead's Adjust dialog (LeadEditDialog.tsx) is built from,
// split out so the dialog stays about the correction it sends.

// What the row holds besides its name, as small chips: the state the save
// now keeps.
export function ItemFlags({ item }: { item: EquipmentItem }) {
  const flags = [
    item.equipped ? "worn" : null,
    item.attuned ? "attuned" : item.attuning ? "attunes at the next rest" : null,
    item.identified === false ? "unidentified" : null,
    item.charges !== undefined ? `${item.charges} charges` : null,
  ].filter((flag): flag is string => Boolean(flag));
  if (!flags.length) {
    return null;
  }
  return (
    <span className="stagger-pop flex flex-wrap gap-1 pl-8">
      {flags.map((flag) => (
        <span key={flag} className="pk-chip px-1.5 py-0 text-[10px] text-stone-400">
          {flag}
        </span>
      ))}
    </span>
  );
}

// Removable name chips backing the spell and feat lists; adding goes
// through the searchable multi-select pickers below each list.
export function ChipList({ values, onRemove }: { values: string[]; onRemove: (value: string) => void }) {
  if (!values.length) {
    return null;
  }
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className={cn("pk-chip gap-0.5 py-0 pl-2 pr-0.5 text-xs text-stone-200")}>
          {value}
          <KitButton tone="iconDanger" always onClick={() => onRemove(value)} aria-label={`Remove ${value}`} className="p-1">
            <X className="size-3" />
          </KitButton>
        </span>
      ))}
    </div>
  );
}

// Carries a lead's edit of the top-level spell lists into the per-class
// lists: whatever was removed leaves every class, whatever was added joins
// the class that holds that kind of list (the first one, failing that).
export function syncCasterLists(
  before: NonNullable<CharacterSheet["spellcasting"]>,
  after: NonNullable<CharacterSheet["spellcasting"]>,
  sheet: CharacterSheet,
): NonNullable<CharacterSheet["spellcasting"]> {
  const lower = (list: string[] = []) => new Set(list.map((name) => name.toLowerCase()));
  const keys = ["known", "prepared", "cantrips", "pending", "spellbook"] as const;
  const views = casterViewsOf(sheet);
  for (const key of keys) {
    const was = lower(before[key]);
    const now = lower(after[key]);
    const removed = (before[key] ?? []).filter((name) => !now.has(name.toLowerCase()));
    const added = (after[key] ?? []).filter((name) => !was.has(name.toLowerCase()));
    for (const view of views) {
      view[key] = view[key].filter((name) => !removed.some((gone) => gone.toLowerCase() === name.toLowerCase()));
    }
    if (added.length && views.length) {
      const home =
        views.find((view) =>
          key === "known"
            ? view.style === "known"
            : key === "spellbook"
              ? view.style === "spellbook"
              : key === "cantrips"
                ? true
                : view.style !== "known",
        ) ?? views[0];
      home[key] = [...home[key], ...added];
    }
  }
  return withCasterViews(after, views);
}

export function levelMeta(entry: { level?: number }): string {
  return entry.level !== undefined ? (entry.level === 0 ? "cantrip" : `level ${entry.level}`) : "";
}

export type SlotEdits = Record<string, { max: string; used: string }>;

// Used and maximum for each slot level the sheet stores, and the pact slots
// under the key "pact" when the sheet has them.
export function SlotSteppers({
  levels,
  slots,
  onChange,
}: {
  levels: string[];
  slots: SlotEdits;
  onChange: (update: (previous: SlotEdits) => SlotEdits) => void;
}) {
  const set = (level: string, key: "max" | "used", value: number) =>
    onChange((previous) => ({
      ...previous,
      [level]: { max: previous[level]?.max ?? "0", used: previous[level]?.used ?? "0", [key]: String(value) },
    }));
  return (
    <div className="stagger-pop flex flex-wrap gap-2">
      {levels.map((level) => {
        const title = level === "pact" ? "Pact" : `L${level}`;
        const named = level === "pact" ? "Pact" : `Level ${level}`;
        return (
          <div key={level} className="space-y-1">
            <span className="text-stone-400">{title} used/max</span>
            <div className="flex items-center gap-1">
              <NumberStepper size="sm" min={0} value={Number(slots[level]?.used ?? "0") || 0} label={`${named} slots used`} onChange={(next) => set(level, "used", next)} />
              <span className="text-stone-500">/</span>
              <NumberStepper size="sm" min={0} value={Number(slots[level]?.max ?? "0") || 0} label={`${named} slots max`} onChange={(next) => set(level, "max", next)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
