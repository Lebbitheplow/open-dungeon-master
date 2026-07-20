"use client";

import type { ReactNode } from "react";
import ContentPicker from "./ContentPicker";

const STARTER_PACK: Array<{ name: string; qty: number }> = [
  { name: "Backpack", qty: 1 },
  { name: "Bedroll", qty: 1 },
  { name: "Rations (1 day)", qty: 5 },
  { name: "Rope, Hempen (50 feet)", qty: 1 },
  { name: "Torch", qty: 5 },
  { name: "Waterskin", qty: 1 },
];

// Equipment block of the character builder: class-appropriate starting
// weapons and armor arrive pre-added (removable), proficient gear is a
// one-click suggestion, and the full item catalog stays searchable.
export default function EquipmentSection({
  equipment,
  suggestions,
  onAdd,
  onAddMany,
  onRemove,
  gold,
  setGold,
  chip,
  inputClass,
}: {
  equipment: Array<{ name: string; qty: number; slug?: string }>;
  // Name plus a one-word stat to show beside it ("1d8 slashing", "AC 14").
  suggestions: Array<{ name: string; note: string }>;
  onAdd: (entry: { name: string; qty?: number; slug?: string }) => void;
  onAddMany: (entries: Array<{ name: string; qty: number }>) => void;
  onRemove: (name: string) => void;
  gold: number;
  setGold: (gold: number) => void;
  chip: (label: string, onRemove: () => void, homebrew?: boolean) => ReactNode;
  inputClass: string;
}) {
  const have = new Set(equipment.map((item) => item.name));
  const openSuggestions = suggestions.filter((entry) => !have.has(entry.name));

  return (
    <section className="panel rounded-xl p-4">
      <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Equipment</h2>
      {openSuggestions.length ? (
        <div className="mb-2">
          <p className="mb-1.5 text-xs text-stone-500">Suggested for your class:</p>
          <div className="flex flex-wrap gap-1.5">
            {openSuggestions.map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => onAdd({ name: entry.name })}
                className="rounded-full border border-amber-900/70 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-950/60"
              >
                + {entry.name}
                <span className="ml-1 text-amber-200/50">{entry.note}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAddMany(STARTER_PACK)}
          className="rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-900"
        >
          Add adventurer&apos;s starter pack
        </button>
        <span className="text-xs text-stone-500">plus search armor, weapons, and gear:</span>
      </div>
      <ContentPicker
        kind="items"
        placeholder="Search items (e.g. longsword, chain mail, rope)"
        onPick={(entry) => onAdd({ name: entry.name, slug: entry.slug })}
        renderMeta={(entry) => entry.rarity || entry.kind || ""}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {equipment.map((item) =>
          chip(
            item.qty > 1 ? `${item.name} x${item.qty}` : item.name,
            () => onRemove(item.name),
            item.slug?.startsWith("homebrew:") ?? false,
          ),
        )}
      </div>
      <label className="mt-3 block w-40">
        <span className="mb-1 block text-xs text-stone-400">Starting gold</span>
        <input
          type="number"
          min={0}
          max={100000}
          value={gold}
          onChange={(event) => setGold(Math.max(0, Number(event.target.value) || 0))}
          className={inputClass}
        />
      </label>
    </section>
  );
}
